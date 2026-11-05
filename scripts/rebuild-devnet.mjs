#!/usr/bin/env node
/**
 * One-time Devnet rebuild for KALYTH (KLYTH).
 *
 * Creates a brand-new mint and all accounts that derive from it. The deployed
 * program is mint-agnostic, so no program upgrade is required.
 *
 * Allocation (100,000,000 KLYTH total, 6 decimals):
 *   curve vault     50,000,000  (sold through the bonding curve)
 *   burn reserve    40,000,000  (owned by the burn_authority PDA)
 *   treasury         5,000,000
 *   community        5,000,000
 *
 * Daily burn cap: 800,000 KLYTH. After 50 burns the supply is 60,000,000 KLYTH.
 *
 * The script is resumable: it checks what already exists on-chain and only
 * sends the missing steps. Safe to re-run after a failure.
 *
 * Required env:
 *   REBUILD_AUTHORITY_KEYPAIR   path/JSON/base58 for the treasury/authority
 *                               (falls back to ANCHOR_WALLET or
 *                               ~/.config/solana/id.json)
 * Optional env:
 *   DEVNET_RPC_URL              defaults to https://api.devnet.solana.com
 *   REBUILD_MINT_KEYPAIR        defaults to scripts/devnet-mint-keypair.json
 *   REBUILD_DEPLOYMENT_FILE     defaults to scripts/devnet-deployment.json
 *   DRY_RUN=1                   print the plan without sending transactions
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptAccount,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token'
import {
  PROGRAM_ID,
  anchorDiscriminator,
  connectionFromEnv,
  formatNbr,
  loadKeypair,
} from './burn-common.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const HOME = os.homedir()

const TOKEN_DECIMALS = 6
const TOTAL_SUPPLY_RAW = 100_000_000n * 10n ** 6n
const CURVE_ALLOCATION_RAW = 50_000_000n * 10n ** 6n
const BURN_ALLOCATION_RAW = 40_000_000n * 10n ** 6n
const TREASURY_ALLOCATION_RAW = 5_000_000n * 10n ** 6n
const COMMUNITY_ALLOCATION_RAW = 5_000_000n * 10n ** 6n

/** 800,000 KLYTH at 6 decimals. */
const DAILY_CAP_RAW = 800_000n * 10n ** 6n

/** Curve parameters matching the frontend (price 1e-6 -> 5e-6 SOL/KLYTH). */
const INITIAL_PRICE_SCALED = 10n ** 15n
const SLOPE_SCALED = 80n
const MAX_SOLD_SUPPLY_RAW = 50_000_000n * 10n ** 6n

/** Seed the SOL reserve so the first sellers can be paid out. */
const SOL_RESERVE_SEED_LAMPORTS = 2_000_000_000

const CURVE_SEED = Buffer.from('bonding_curve')
const SOL_RESERVE_SEED = Buffer.from('sol_reserve')
const BURN_STATE_SEED = Buffer.from('burn_state')
const BURN_AUTHORITY_SEED = Buffer.from('burn_authority')

/**
 * Metaplex Token Metadata. Metadata can only be created while the mint
 * authority is still active, so this step must run before the revoke step.
 */
const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
)
const METADATA_NAME = 'KALYTH'
const METADATA_SYMBOL = 'KLYTH'
const METADATA_URI =
  process.env.REBUILD_METADATA_URI ||
  'https://mcybernet.github.io/KALYTH/metadata.json'

/**
 * Instruction discriminator for CreateMetadataAccountV3 in
 * mpl-token-metadata 3.x (a single byte, not the 8-byte Anchor layout).
 */
const CREATE_METADATA_ACCOUNT_V3_DISCRIMINATOR = 33

/**
 * The community allocation needs its own token account, but both the treasury
 * and community accounts are controlled by the treasury wallet. A plain ATA
 * would collide with the treasury ATA, so derive a deterministic seeded
 * account instead. The seed includes a short mint prefix so a rebuild cannot
 * collide with a previous mint's community account.
 */
const COMMUNITY_ACCOUNT_SEED_PREFIX = 'community-'

function resolveAuthorityPath() {
  const configured =
    process.env.REBUILD_AUTHORITY_KEYPAIR || process.env.ANCHOR_WALLET
  if (configured) {
    return configured
  }
  const defaultPath = path.join(HOME, '.config', 'solana', 'id.json')
  if (fs.existsSync(defaultPath)) {
    return defaultPath
  }
  return null
}

function loadOrCreateMintKeypair(file) {
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Keypair.fromSecretKey(Uint8Array.from(raw))
  }
  const keypair = Keypair.generate()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)))
  console.log(`Generated new mint keypair: ${file}`)
  console.log('Keep this file. It is gitignored and only needed for this rebuild.')
  return keypair
}

function writeU128LE(buffer, value, offset) {
  buffer.writeBigUInt64LE(value & 0xffffffffffffffffn, offset)
  buffer.writeBigUInt64LE(value >> 64n, offset + 8)
}

function pda(seed, mint) {
  return PublicKey.findProgramAddressSync([seed, mint.toBuffer()], PROGRAM_ID)[0]
}

function metadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID,
  )[0]
}

function borshString(value) {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bytes.length, 0)
  return Buffer.concat([length, bytes])
}

/**
 * Hand-encoded CreateMetadataAccountV3 instruction. The layout is:
 *   u8 discriminator | string name | string symbol | string uri |
 *   u16 seller_fee_basis_points | Option<Vec<Creator>> |
 *   Option<Collection> | Option<Uses> | bool is_mutable |
 *   Option<CollectionDetails>
 */
function buildCreateMetadataInstruction(authority, mint, metadata) {
  const data = Buffer.concat([
    Buffer.from([CREATE_METADATA_ACCOUNT_V3_DISCRIMINATOR]),
    borshString(METADATA_NAME),
    borshString(METADATA_SYMBOL),
    borshString(METADATA_URI),
    Buffer.from([0, 0]), // seller_fee_basis_points = 0
    Buffer.from([0]), // creators = None
    Buffer.from([0]), // collection = None
    Buffer.from([0]), // uses = None
    Buffer.from([1]), // is_mutable = true
    Buffer.from([0]), // collection_details = None
  ])

  return {
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false }, // mint authority
      { pubkey: authority, isSigner: true, isWritable: true }, // payer
      { pubkey: authority, isSigner: false, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }
}

function ata(mint, owner) {
  // Both the curve state and the burn authority are off-curve PDAs.
  return getAssociatedTokenAddressSync(mint, owner, true)
}

function buildInitializeCurveInstruction(authority, mint, curveState) {
  const data = Buffer.alloc(8 + 16 + 16 + 8)
  anchorDiscriminator('initialize').copy(data, 0)
  writeU128LE(data, INITIAL_PRICE_SCALED, 8)
  writeU128LE(data, SLOPE_SCALED, 24)
  data.writeBigUInt64LE(MAX_SOLD_SUPPLY_RAW, 40)

  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: curveState, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }
}

function buildInitializeBurnInstruction(
  authority,
  mint,
  curveState,
  burnState,
  burnAuthority,
  burnReserve,
) {
  const data = Buffer.alloc(8 + 8)
  anchorDiscriminator('initialize_burn').copy(data, 0)
  data.writeBigUInt64LE(DAILY_CAP_RAW, 8)

  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: curveState, isSigner: false, isWritable: false },
      { pubkey: burnState, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: burnAuthority, isSigner: false, isWritable: false },
      { pubkey: burnReserve, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }
}

async function accountExists(connection, address) {
  const info = await connection.getAccountInfo(address, 'confirmed')
  return info
}

function decodeMint(info) {
  return {
    mintAuthorityOption: info.data.readUInt32LE(0),
    mintAuthority:
      info.data.readUInt32LE(0) === 1
        ? new PublicKey(info.data.subarray(4, 36))
        : null,
    supply: info.data.readBigUInt64LE(36),
    decimals: info.data[44],
    freezeAuthorityOption: info.data.readUInt32LE(46),
    freezeAuthority:
      info.data.readUInt32LE(46) === 1
        ? new PublicKey(info.data.subarray(50, 82))
        : null,
  }
}

function decodeToken(info) {
  return {
    mint: new PublicKey(info.data.subarray(0, 32)),
    owner: new PublicKey(info.data.subarray(32, 64)),
    amount: info.data.readBigUInt64LE(64),
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function send(connection, label, instructions, signers) {
  const transaction = new Transaction().add(...instructions)
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed')
  transaction.recentBlockhash = blockhash
  transaction.feePayer = signers[0].publicKey

  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        signers,
        { commitment: 'confirmed' },
      )
      console.log(`[ OK ] ${label}: ${signature}`)
      return signature
    } catch (error) {
      lastError = error
      if (attempt === 3) {
        break
      }
      console.log(
        `[ .. ] ${label} attempt ${attempt} failed: ${error.message} â€” retrying`,
      )
      await sleep(1500 * attempt)
      const refreshed = await connection.getLatestBlockhash('confirmed')
      transaction.recentBlockhash = refreshed.blockhash
      transaction.lastValidBlockHeight = refreshed.lastValidBlockHeight
    }
  }
  throw new Error(`${label} failed: ${lastError?.message ?? lastError}`)
}

async function main() {
  const connection = connectionFromEnv()
  const dryRun = process.env.DRY_RUN === '1'
  const authorityPath = resolveAuthorityPath()
  if (!authorityPath) {
    throw new Error(
      'Set REBUILD_AUTHORITY_KEYPAIR (or ANCHOR_WALLET) to the treasury keypair path.',
    )
  }

  const authority = loadKeypair(authorityPath, 'REBUILD_AUTHORITY_KEYPAIR')
  const mintKeypairPath =
    process.env.REBUILD_MINT_KEYPAIR ||
    path.join(SCRIPT_DIR, 'devnet-mint-keypair.json')
  const mintKeypair = loadOrCreateMintKeypair(mintKeypairPath)
  const mint = mintKeypair.publicKey

  const curveState = pda(CURVE_SEED, mint)
  const solReserve = pda(SOL_RESERVE_SEED, mint)
  const burnState = pda(BURN_STATE_SEED, mint)
  const burnAuthority = pda(BURN_AUTHORITY_SEED, mint)
  const metadata = metadataPda(mint)
  const vault = ata(mint, curveState)
  const burnReserve = ata(mint, burnAuthority)
  const treasuryAta = getAssociatedTokenAddressSync(mint, authority.publicKey)
  const communitySeed = `${COMMUNITY_ACCOUNT_SEED_PREFIX}${mint
    .toBase58()
    .slice(0, 8)}`
  const communityAccount = await PublicKey.createWithSeed(
    authority.publicKey,
    communitySeed,
    TOKEN_PROGRAM_ID,
  )

  const deploymentFile =
    process.env.REBUILD_DEPLOYMENT_FILE ||
    path.join(SCRIPT_DIR, 'devnet-deployment.json')

  console.log('')
  console.log('=== KALYTH - Devnet rebuild ===')
  console.log(`RPC:              ${connection.rpcEndpoint}`)
  console.log(`Program:          ${PROGRAM_ID.toBase58()}`)
  console.log(`Authority:        ${authority.publicKey.toBase58()}`)
  console.log(`Mint (new):       ${mint.toBase58()}`)
  console.log(`Curve state:      ${curveState.toBase58()}`)
  console.log(`Curve vault:      ${vault.toBase58()}`)
  console.log(`SOL reserve:      ${solReserve.toBase58()}`)
  console.log(`Burn state:       ${burnState.toBase58()}`)
  console.log(`Burn authority:   ${burnAuthority.toBase58()}`)
  console.log(`Burn reserve:     ${burnReserve.toBase58()}`)
  console.log(`Metadata:         ${metadata.toBase58()}`)
  console.log(`Metadata URI:     ${METADATA_URI}`)
  console.log(`Treasury ATA:     ${treasuryAta.toBase58()}`)
  console.log(`Community acct:   ${communityAccount.toBase58()}`)
  console.log('')
  console.log('Allocation:')
  console.log(`  curve      ${formatNbr(CURVE_ALLOCATION_RAW)} KLYTH`)
  console.log(`  burn       ${formatNbr(BURN_ALLOCATION_RAW)} KLYTH`)
  console.log(`  treasury   ${formatNbr(TREASURY_ALLOCATION_RAW)} KLYTH`)
  console.log(`  community  ${formatNbr(COMMUNITY_ALLOCATION_RAW)} KLYTH`)
  console.log(`  total      ${formatNbr(TOTAL_SUPPLY_RAW)} KLYTH`)
  console.log(`Daily cap:  ${formatNbr(DAILY_CAP_RAW)} KLYTH`)
  console.log('')

  const balance = await connection.getBalance(authority.publicKey, 'confirmed')
  console.log(`Authority balance: ${(balance / 1e9).toFixed(4)} SOL`)

  const signatures = {}
  const plan = []

  // 1. Mint account ---------------------------------------------------------
  let mintInfo = await accountExists(connection, mint)
  if (!mintInfo) {
    plan.push('create mint (6 decimals, authority = treasury)')
  } else {
    const decoded = decodeMint(mintInfo)
    console.log(
      `Mint already exists: decimals=${decoded.decimals} supply=${formatNbr(
        decoded.supply,
      )} authority=${
        decoded.mintAuthority ? decoded.mintAuthority.toBase58() : 'revoked'
      }`,
    )
    if (decoded.decimals !== TOKEN_DECIMALS) {
      throw new Error(`Existing mint has ${decoded.decimals} decimals, expected 6`)
    }
    if (decoded.mintAuthority && !decoded.mintAuthority.equals(authority.publicKey)) {
      throw new Error(
        `Existing mint authority is ${decoded.mintAuthority.toBase58()}, not the treasury. Refusing to touch it.`,
      )
    }
  }

  // 2. Token accounts -------------------------------------------------------
  const tokenAccounts = [
    { label: 'curve vault', address: vault, owner: curveState, allocation: CURVE_ALLOCATION_RAW, kind: 'ata' },
    { label: 'burn reserve', address: burnReserve, owner: burnAuthority, allocation: BURN_ALLOCATION_RAW, kind: 'ata' },
    { label: 'treasury ATA', address: treasuryAta, owner: authority.publicKey, allocation: TREASURY_ALLOCATION_RAW, kind: 'ata' },
    { label: 'community account', address: communityAccount, owner: authority.publicKey, allocation: COMMUNITY_ALLOCATION_RAW, kind: 'seed' },
  ]

  const existingAccounts = {}
  for (const account of tokenAccounts) {
    const info = await accountExists(connection, account.address)
    existingAccounts[account.label] = info
    if (!info) {
      plan.push(`create ${account.label}`)
    } else {
      const decoded = decodeToken(info)
      if (!decoded.mint.equals(mint)) {
        throw new Error(`${account.label} exists but has a different mint`)
      }
      if (!decoded.owner.equals(account.owner)) {
        throw new Error(
          `${account.label} owner is ${decoded.owner.toBase58()}, expected ${account.owner.toBase58()}`,
        )
      }
    }
  }

  // 3. Curve state ----------------------------------------------------------
  const curveInfo = await accountExists(connection, curveState)
  if (!curveInfo) {
    plan.push('initialize bonding curve')
  } else {
    const stateAuthority = new PublicKey(curveInfo.data.subarray(8, 40))
    const stateMint = new PublicKey(curveInfo.data.subarray(40, 72))
    if (!stateAuthority.equals(authority.publicKey) || !stateMint.equals(mint)) {
      throw new Error('Existing curve state does not match this mint/authority')
    }
  }

  // 4. Mint allocations -----------------------------------------------------
  const mintDeficits = []
  for (const account of tokenAccounts) {
    const info = existingAccounts[account.label]
    const current = info ? decodeToken(info).amount : 0n
    if (current > account.allocation) {
      throw new Error(
        `${account.label} already holds ${formatNbr(current)} KLYTH, more than its ${formatNbr(
          account.allocation,
        )} allocation`,
      )
    }
    if (current < account.allocation) {
      mintDeficits.push({ ...account, amount: account.allocation - current })
    }
  }
  if (mintDeficits.length > 0) {
    plan.push(
      `mint ${mintDeficits.map((item) => `${item.label} ${formatNbr(item.amount)}`).join(', ')}`,
    )
  }

  // 5. Metaplex metadata -----------------------------------------------------
  const metadataInfo = await accountExists(connection, metadata)
  if (!metadataInfo) {
    if (mintInfo) {
      const metadataMint = decodeMint(mintInfo)
      if (!metadataMint.mintAuthority?.equals(authority.publicKey)) {
        throw new Error(
          'Metadata is missing but the mint authority is already revoked. ' +
            'Create metadata before revoking, or use a fresh mint.',
        )
      }
    }
    plan.push(
      `create Metaplex metadata (${METADATA_NAME} / ${METADATA_SYMBOL})`,
    )
  }

  // 6. Burn state -----------------------------------------------------------
  const burnStateInfo = await accountExists(connection, burnState)
  if (!burnStateInfo) {
    plan.push(`initialize burn (cap ${formatNbr(DAILY_CAP_RAW)}/day)`)
  }

  // 7. Revoke mint authority ------------------------------------------------
  const currentMintInfo = mintInfo ?? (await accountExists(connection, mint))
  const currentMint = currentMintInfo ? decodeMint(currentMintInfo) : null
  const needsRevoke = Boolean(
    currentMint?.mintAuthority?.equals(authority.publicKey),
  )
  if (needsRevoke) {
    plan.push('revoke mint authority')
  }

  // 8. Fund SOL reserve -----------------------------------------------------
  const reserveLamports = await connection.getBalance(solReserve, 'confirmed')
  const reserveTopUp = SOL_RESERVE_SEED_LAMPORTS - reserveLamports
  if (reserveTopUp > 0) {
    plan.push(`fund SOL reserve with ${(reserveTopUp / 1e9).toFixed(4)} SOL`)
  }

  console.log('')
  if (plan.length === 0) {
    console.log('Everything already exists. Nothing to send.')
  } else {
    console.log('Plan:')
    plan.forEach((step, index) => console.log(`  ${index + 1}. ${step}`))
  }
  console.log('')

  if (dryRun) {
    console.log('DRY_RUN=1, no transactions sent.')
    writeDeployment({
      deploymentFile,
      mint,
      authority,
      curveState,
      vault,
      solReserve,
      burnState,
      burnAuthority,
      burnReserve,
      metadata,
      treasuryAta,
      communityAccount,
      signatures,
      dryRun,
    })
    return
  }

  // Execute ----------------------------------------------------------------
  if (!mintInfo) {
    const rent = await getMinimumBalanceForRentExemptMint(connection)
    const instructions = [
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mint,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint,
        TOKEN_DECIMALS,
        authority.publicKey,
        null,
        TOKEN_PROGRAM_ID,
      ),
    ]
    signatures.createMint = await send(
      connection,
      'create mint',
      instructions,
      [authority, mintKeypair],
    )
    mintInfo = await accountExists(connection, mint)
  }

  const missingAccounts = tokenAccounts.filter(
    (account) => !existingAccounts[account.label],
  )
  if (missingAccounts.length > 0) {
    const instructions = []
    for (const account of missingAccounts) {
      if (account.kind === 'seed') {
        const rent = await getMinimumBalanceForRentExemptAccount(connection)
        instructions.push(
          SystemProgram.createAccountWithSeed({
            fromPubkey: authority.publicKey,
            basePubkey: authority.publicKey,
            seed: communitySeed,
            newAccountPubkey: account.address,
            lamports: rent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
          }),
          createInitializeAccountInstruction(
            account.address,
            mint,
            account.owner,
            TOKEN_PROGRAM_ID,
          ),
        )
      } else {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            authority.publicKey,
            account.address,
            account.owner,
            mint,
          ),
        )
      }
    }
    signatures.createTokenAccounts = await send(
      connection,
      `create ${missingAccounts.map((item) => item.label).join(', ')}`,
      instructions,
      [authority],
    )
    for (const account of missingAccounts) {
      existingAccounts[account.label] = await accountExists(
        connection,
        account.address,
      )
    }
  }

  if (!curveInfo) {
    signatures.initializeCurve = await send(
      connection,
      'initialize bonding curve',
      [buildInitializeCurveInstruction(authority.publicKey, mint, curveState)],
      [authority],
    )
  }

  if (mintDeficits.length > 0) {
    const instructions = mintDeficits.map((account) =>
      createMintToInstruction(
        mint,
        account.address,
        authority.publicKey,
        account.amount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    )
    signatures.mintAllocations = await send(
      connection,
      `mint allocations (${mintDeficits.map((item) => item.label).join(', ')})`,
      instructions,
      [authority],
    )
  }

  if (!metadataInfo) {
    signatures.createMetadata = await send(
      connection,
      'create Metaplex metadata',
      [buildCreateMetadataInstruction(authority.publicKey, mint, metadata)],
      [authority],
    )
  }

  if (!burnStateInfo) {
    signatures.initializeBurn = await send(
      connection,
      'initialize burn state',
      [
        buildInitializeBurnInstruction(
          authority.publicKey,
          mint,
          curveState,
          burnState,
          burnAuthority,
          burnReserve,
        ),
      ],
      [authority],
    )
  }

  const mintAfterAllocations = decodeMint(
    await accountExists(connection, mint),
  )
  if (mintAfterAllocations.mintAuthority?.equals(authority.publicKey)) {
    signatures.revokeMintAuthority = await send(
      connection,
      'revoke mint authority',
      [
        createSetAuthorityInstruction(
          mint,
          authority.publicKey,
          AuthorityType.MintTokens,
          null,
        ),
      ],
      [authority],
    )
  }

  if (reserveTopUp > 0) {
    signatures.fundSolReserve = await send(
      connection,
      'fund SOL reserve',
      [
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: solReserve,
          lamports: reserveTopUp,
        }),
      ],
      [authority],
    )
  }

  // Final state ------------------------------------------------------------
  const finalMintInfo = await accountExists(connection, mint)
  const finalMint = decodeMint(finalMintInfo)
  const finalReserve = decodeToken(
    await accountExists(connection, burnReserve),
  )
  const finalVault = decodeToken(await accountExists(connection, vault))
  const finalTreasury = decodeToken(await accountExists(connection, treasuryAta))
  const finalCommunity = decodeToken(
    await accountExists(connection, communityAccount),
  )

  console.log('')
  console.log('=== Final state ===')
  console.log(`Mint supply:       ${formatNbr(finalMint.supply)} KLYTH`)
  console.log(
    `Mint authority:    ${
      finalMint.mintAuthority ? finalMint.mintAuthority.toBase58() : 'revoked'
    }`,
  )
  console.log(`Curve vault:       ${formatNbr(finalVault.amount)} KLYTH`)
  console.log(`Burn reserve:      ${formatNbr(finalReserve.amount)} KLYTH`)
  console.log(`Treasury ATA:      ${formatNbr(finalTreasury.amount)} KLYTH`)
  console.log(`Community acct:    ${formatNbr(finalCommunity.amount)} KLYTH`)
  console.log(`SOL reserve:       ${((await connection.getBalance(solReserve)) / 1e9).toFixed(4)} SOL`)
  console.log(
    `Metadata:          ${
      (await accountExists(connection, metadata)) ? metadata.toBase58() : 'missing'
    }`,
  )

  writeDeployment({
    deploymentFile,
    mint,
    authority,
    curveState,
    vault,
    solReserve,
    burnState,
    burnAuthority,
    burnReserve,
    metadata,
    treasuryAta,
    communityAccount,
    signatures,
    dryRun: false,
  })

  console.log('')
  console.log('Next steps:')
  console.log('  1. Update scripts/burn-common.mjs with the new mint + burn reserve.')
  console.log('  2. Update the frontend addresses (curve.ts, addresses.ts, etc.).')
  console.log('  3. Run: npm run verify --prefix scripts')
  console.log('  4. Run the first burn: npm run burn:daily --prefix scripts')
}

function writeDeployment({
  deploymentFile,
  mint,
  authority,
  curveState,
  vault,
  solReserve,
  burnState,
  burnAuthority,
  burnReserve,
  metadata,
  treasuryAta,
  communityAccount,
  signatures,
  dryRun,
}) {
  const deployment = {
    network: 'devnet',
    programId: PROGRAM_ID.toBase58(),
    authority: authority.publicKey.toBase58(),
    mint: mint.toBase58(),
    decimals: TOKEN_DECIMALS,
    curveState: curveState.toBase58(),
    curveVault: vault.toBase58(),
    solReserve: solReserve.toBase58(),
    burnState: burnState.toBase58(),
    burnAuthority: burnAuthority.toBase58(),
    burnReserve: burnReserve.toBase58(),
    metadataProgram: METADATA_PROGRAM_ID.toBase58(),
    metadata: metadata.toBase58(),
    metadataUri: METADATA_URI,
    treasuryAta: treasuryAta.toBase58(),
    communityAccount: communityAccount.toBase58(),
    allocation: {
      curve: CURVE_ALLOCATION_RAW.toString(),
      burn: BURN_ALLOCATION_RAW.toString(),
      treasury: TREASURY_ALLOCATION_RAW.toString(),
      community: COMMUNITY_ALLOCATION_RAW.toString(),
      total: TOTAL_SUPPLY_RAW.toString(),
    },
    dailyCapRaw: DAILY_CAP_RAW.toString(),
    curveParams: {
      initialPriceScaled: INITIAL_PRICE_SCALED.toString(),
      slopeScaled: SLOPE_SCALED.toString(),
      maxSoldSupplyRaw: MAX_SOLD_SUPPLY_RAW.toString(),
    },
    solReserveSeedLamports: SOL_RESERVE_SEED_LAMPORTS,
    dryRun,
    signatures,
    updatedAt: new Date().toISOString(),
  }

  fs.writeFileSync(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`)
  console.log(`\nDeployment file: ${deploymentFile}`)
}

main().catch((error) => {
  console.error(`\nRebuild failed: ${error.message}`)
  if (Array.isArray(error?.logs) && error.logs.length > 0) {
    console.error(error.logs.join('\n'))
  }
  process.exit(1)
})
