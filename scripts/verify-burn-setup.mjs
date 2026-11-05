#!/usr/bin/env node
/**
 * Read-only verification of the burn automation deployment.
 *
 * Needs no keypair. It:
 *   1. Checks the deployed program and its upgrade authority.
 *   2. Scans the on-chain binary for the burn instruction discriminators, so a
 *      successful "deploy" that still runs old code is caught.
 *   3. Reads the curve state, mint, burn reserve, and BurnState (if present).
 *
 * Usage:
 *   node verify-burn-setup.mjs
 */
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js'
import {
  BURN_RESERVE_TOKEN_ACCOUNT,
  DAILY_CAP_RAW,
  KLYTH_MINT,
  PROGRAM_ID,
  connectionFromEnv,
  createBurnDailyInstruction,
  createInitializeBurnInstruction,
  decodeBurnState,
  decodeTokenAccount,
  formatNbr,
  getBurnAuthorityAddress,
  getBurnStateAddress,
  getCurveStateAddress,
} from './burn-common.mjs'

const PROGRAM_DATA_ADDRESS = new PublicKey(
  '7AdXceJQSsEHZqHYAv5sHrBkZaDtoZy6ULjJHu2mqBis',
)
const UPGRADE_AUTHORITY = new PublicKey(
  '2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN',
)
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
)
const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
)
const METADATA_NAME = 'KALYTH'
const METADATA_SYMBOL = 'KLYTH'
const METADATA_URI = 'https://mcybernet.github.io/KALYTH/metadata.json'

function getMetadataAddress() {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      KLYTH_MINT.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  )[0]
}

const checks = []

function check(label, pass, detail) {
  checks.push({ label, pass, detail })
  console.log(`${pass ? '[ OK ]' : '[FAIL]'} ${label}${detail ? `: ${detail}` : ''}`)
}

function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + 1)
  }
  return count
}

async function simulateInitializeBurn(connection) {
  const authority = UPGRADE_AUTHORITY
  const balance = await connection.getBalance(authority, 'confirmed')

  console.log('\nSimulating initialize_burn (signature check disabled, no key used)')
  console.log(`       authority balance: ${balance / 1e9} SOL`)

  const transaction = new Transaction().add(
    createInitializeBurnInstruction(authority, DAILY_CAP_RAW),
  )
  transaction.feePayer = authority
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash('confirmed')
  ).blockhash

  const versioned = new VersionedTransaction(transaction.compileMessage())
  const response = await connection.simulateTransaction(versioned, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  })
  const result = response.value ?? response
  const logs = result.logs ?? []

  if (result.err) {
    check(
      'initialize_burn simulation succeeds',
      false,
      JSON.stringify(result.err),
    )
    for (const line of logs) {
      console.log(`       ${line}`)
    }
    return
  }

  check(
    'initialize_burn simulation succeeds',
    true,
    `${result.unitsConsumed ?? '?'} compute units`,
  )
  for (const line of logs.slice(-6)) {
    console.log(`       ${line}`)
  }
}

async function simulateBurnDaily(connection) {
  const cranker = UPGRADE_AUTHORITY

  console.log('\nSimulating burn_daily (signature check disabled, no key used)')

  const transaction = new Transaction().add(
    createBurnDailyInstruction(cranker),
  )
  transaction.feePayer = cranker
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash('confirmed')
  ).blockhash

  const versioned = new VersionedTransaction(transaction.compileMessage())
  const response = await connection.simulateTransaction(versioned, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  })
  const result = response.value ?? response
  const logs = result.logs ?? []

  if (result.err) {
    check('burn_daily simulation succeeds', false, JSON.stringify(result.err))
    for (const line of logs.slice(-10)) {
      console.log(`       ${line}`)
    }
    return
  }

  check(
    'burn_daily simulation succeeds',
    true,
    `${result.unitsConsumed ?? '?'} compute units`,
  )
  for (const line of logs.slice(-6)) {
    console.log(`       ${line}`)
  }
}

async function main() {
  const connection = connectionFromEnv()

  console.log(`RPC:             ${connection.rpcEndpoint}`)
  console.log(`Program:         ${PROGRAM_ID.toBase58()}`)
  console.log(`Mint:            ${KLYTH_MINT.toBase58()}`)
  console.log(`Curve state:     ${getCurveStateAddress().toBase58()}`)
  console.log(`Burn state:      ${getBurnStateAddress().toBase58()}`)
  console.log(`Burn authority:  ${getBurnAuthorityAddress().toBase58()}`)
  console.log(`Burn reserve:    ${BURN_RESERVE_TOKEN_ACCOUNT.toBase58()}`)
  console.log('')

  const programInfo = await connection.getAccountInfo(PROGRAM_ID, 'confirmed')
  check('program account exists', Boolean(programInfo))
  if (!programInfo) {
    process.exit(1)
  }
  check(
    'program is executable',
    programInfo.executable,
    `owner ${programInfo.owner.toBase58()}`,
  )
  check(
    'program owned by upgradeable loader',
    programInfo.owner.equals(BPF_LOADER_UPGRADEABLE),
  )

  const programData = await connection.getAccountInfo(
    PROGRAM_DATA_ADDRESS,
    'confirmed',
  )
  check('program data account exists', Boolean(programData))
  if (programData) {
    // tag u32 | last deploy slot u64 | option tag u8 | authority 32 | binary
    const lastDeploySlot = programData.data.readBigUInt64LE(4)
    const hasAuthority = programData.data[12] === 1
    const authority = hasAuthority
      ? new PublicKey(programData.data.subarray(13, 45))
      : null
    const binary = programData.data.subarray(45)

    console.log(`       last deploy slot: ${lastDeploySlot.toString()}`)
    check(
      'upgrade authority is the treasury',
      Boolean(authority) && authority.equals(UPGRADE_AUTHORITY),
      authority ? authority.toBase58() : 'none (immutable)',
    )

    const expected = [
      ['InitializeBurn handler', 'Instruction: InitializeBurn'],
      ['BurnDaily handler', 'Instruction: BurnDaily'],
      ['burn window check', 'Burn window has not elapsed'],
      ['burn reserve check', 'Burn reserve is empty'],
      ['BurnState account', 'BurnState'],
    ]
    for (const [name, marker] of expected) {
      const hits = countOccurrences(binary, Buffer.from(marker))
      check(
        `binary contains ${name}`,
        hits > 0,
        `${hits} match(es) in ${binary.length} bytes`,
      )
    }
  }

  const curveInfo = await connection.getAccountInfo(
    getCurveStateAddress(),
    'confirmed',
  )
  check('curve state exists', Boolean(curveInfo))
  if (curveInfo) {
    const curveAuthority = new PublicKey(curveInfo.data.subarray(8, 40))
    const curveMint = new PublicKey(curveInfo.data.subarray(40, 72))
    check(
      'curve authority unchanged',
      curveAuthority.equals(UPGRADE_AUTHORITY),
      curveAuthority.toBase58(),
    )
    check(
      'curve mint is KLYTH',
      curveMint.equals(KLYTH_MINT),
      curveMint.toBase58(),
    )
  }

  const mintInfo = await connection.getAccountInfo(KLYTH_MINT, 'confirmed')
  check('KLYTH mint exists', Boolean(mintInfo))
  if (mintInfo) {
    const supply = mintInfo.data.readBigUInt64LE(36)
    const mintAuthorityRevoked = mintInfo.data.readUInt32LE(0) === 0
    console.log(`       mint supply: ${formatNbr(supply)} KLYTH`)
    check('mint authority is revoked', mintAuthorityRevoked)
    check(
      'supply is within the burn plan',
      supply <= 100_000_000n * 1_000_000n && supply >= 60_000_000n * 1_000_000n,
      formatNbr(supply),
    )
  }

  const metadataInfo = await connection.getAccountInfo(
    getMetadataAddress(),
    'confirmed',
  )
  check(
    'Metaplex metadata exists',
    Boolean(metadataInfo),
    getMetadataAddress().toBase58(),
  )
  if (metadataInfo) {
    check(
      'metadata owned by the Metaplex program',
      metadataInfo.owner.equals(METADATA_PROGRAM_ID),
      metadataInfo.owner.toBase58(),
    )
    check(
      'metadata mint is KLYTH',
      new PublicKey(metadataInfo.data.subarray(33, 65)).equals(KLYTH_MINT),
    )

    let offset = 65
    const readMetadataString = () => {
      const length = metadataInfo.data.readUInt32LE(offset)
      offset += 4
      const value = metadataInfo.data
        .subarray(offset, offset + length)
        .toString('utf8')
        .replace(/\0+$/, '')
      offset += length
      return value
    }
    const name = readMetadataString()
    const symbol = readMetadataString()
    const uri = readMetadataString()

    check('metadata name is KALYTH', name === METADATA_NAME, name)
    check('metadata symbol is KLYTH', symbol === METADATA_SYMBOL, symbol)
    check('metadata URI is published', uri === METADATA_URI, uri)
  }

  const burnStateInfo = await connection.getAccountInfo(
    getBurnStateAddress(),
    'confirmed',
  )

  const reserveInfo = await connection.getAccountInfo(
    BURN_RESERVE_TOKEN_ACCOUNT,
    'confirmed',
  )
  check('burn reserve exists', Boolean(reserveInfo))
  if (reserveInfo) {
    const reserve = decodeTokenAccount(reserveInfo.data)
    const burnAuthority = getBurnAuthorityAddress()
    check(
      'reserve mint is KLYTH',
      reserve.mint.equals(KLYTH_MINT),
      reserve.mint.toBase58(),
    )
    if (burnStateInfo) {
      check(
        'reserve owned by burn authority',
        reserve.owner.equals(burnAuthority),
        reserve.owner.toBase58(),
      )
    } else {
      console.log(
        `[ .. ] reserve owner: ${reserve.owner.toBase58()} (migration pending)`,
      )
    }
    console.log(`       reserve balance: ${formatNbr(reserve.amount)} KLYTH`)
  }

  if (!burnStateInfo) {
    console.log('\nBurnState: not initialized yet (migration pending)')
    if (process.argv.includes('--simulate-init')) {
      await simulateInitializeBurn(connection)
    }
  } else {
    const state = decodeBurnState(burnStateInfo.data)
    console.log('\nBurnState:')
    console.log(`       mint:         ${state.mint.toBase58()}`)
    console.log(`       authority:    ${state.burnAuthority.toBase58()}`)
    console.log(`       reserve:      ${state.burnReserve.toBase58()}`)
    console.log(`       daily cap:    ${formatNbr(state.dailyCap)} KLYTH`)
    console.log(`       total burned: ${formatNbr(state.totalBurned)} KLYTH`)
    console.log(`       burn count:   ${state.burnCount.toString()}`)
    console.log(`       last burn ts: ${state.lastBurnTs.toString()}`)
    check(
      'BurnState cap is 800,000 KLYTH',
      state.dailyCap === DAILY_CAP_RAW,
      formatNbr(state.dailyCap),
    )
    check('BurnState mint is KLYTH', state.mint.equals(KLYTH_MINT))
    check(
      'BurnState reserve matches ATA',
      state.burnReserve.equals(BURN_RESERVE_TOKEN_ACCOUNT),
    )
    check(
      'BurnState authority matches PDA',
      state.burnAuthority.equals(getBurnAuthorityAddress()),
    )
  }

  if (process.argv.includes('--simulate-burn')) {
    await simulateBurnDaily(connection)
  }

  const failed = checks.filter((entry) => !entry.pass)
  console.log('')
  if (failed.length === 0) {
    console.log(`All ${checks.length} checks passed.`)
    return
  }
  console.log(`${failed.length} of ${checks.length} checks failed:`)
  for (const entry of failed) {
    console.log(`  - ${entry.label}${entry.detail ? ` (${entry.detail})` : ''}`)
  }
  process.exit(1)
}

main().catch((error) => {
  console.error(`\nVerification failed: ${error.message}`)
  process.exit(1)
})
