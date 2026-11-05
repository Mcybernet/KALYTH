#!/usr/bin/env node
/**
 * One-time burn migration.
 *
 * 1. Creates the BurnState PDA (if missing) with the daily cap.
 * 2. Moves the existing burn reserve token account from its current owner to
 *    the burn_authority PDA, so only the program can burn from it.
 *
 * Both steps are submitted in one transaction when both are needed.
 *
 * Required env:
 *   BURN_STATE_AUTHORITY_KEYPAIR  path/JSON/base58 for the bonding-curve authority
 *   BURN_RESERVE_OWNER_KEYPAIR    path/JSON/base58 for the reserve's current owner
 * Optional env:
 *   DEVNET_RPC_URL                defaults to https://api.devnet.solana.com
 *   DAILY_BURN_CAP_RAW            defaults to 1_000_000 KLYTH in raw units
 *   DRY_RUN=1                     print the plan without sending
 */
import { AuthorityType, createSetAuthorityInstruction } from '@solana/spl-token'
import { PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js'
import {
  BURN_INTERVAL_SECONDS,
  BURN_RESERVE_TOKEN_ACCOUNT,
  DAILY_CAP_RAW,
  KLYTH_MINT,
  PROGRAM_ID,
  connectionFromEnv,
  createInitializeBurnInstruction,
  decodeBurnState,
  decodeTokenAccount,
  explorerTxUrl,
  formatNbr,
  getBurnAuthorityAddress,
  getBurnStateAddress,
  getCurveStateAddress,
  loadKeypair,
} from './burn-common.mjs'

function parseDailyCap() {
  const raw = process.env.DAILY_BURN_CAP_RAW
  if (!raw) {
    return DAILY_CAP_RAW
  }
  const value = BigInt(raw)
  if (value <= 0n) {
    throw new Error('DAILY_BURN_CAP_RAW must be greater than zero')
  }
  return value
}

async function main() {
  const connection = connectionFromEnv()
  const dailyCap = parseDailyCap()
  const burnStateAddress = getBurnStateAddress()
  const burnAuthority = getBurnAuthorityAddress()
  const curveStateAddress = getCurveStateAddress()
  const dryRun = process.env.DRY_RUN === '1'

  console.log(`Program:          ${PROGRAM_ID.toBase58()}`)
  console.log(`Mint:             ${KLYTH_MINT.toBase58()}`)
  console.log(`Curve state:      ${curveStateAddress.toBase58()}`)
  console.log(`Burn state:       ${burnStateAddress.toBase58()}`)
  console.log(`Burn authority:   ${burnAuthority.toBase58()}`)
  console.log(`Burn reserve:     ${BURN_RESERVE_TOKEN_ACCOUNT.toBase58()}`)
  console.log(`Daily cap:        ${formatNbr(dailyCap)} KLYTH`)
  console.log('')

  const curveInfo = await connection.getAccountInfo(curveStateAddress, 'confirmed')
  if (!curveInfo) {
    throw new Error('Bonding curve state account not found on this cluster')
  }
  const curveAuthority = new PublicKey(curveInfo.data.subarray(8, 40))

  const reserveInfo = await connection.getAccountInfo(
    BURN_RESERVE_TOKEN_ACCOUNT,
    'confirmed',
  )
  if (!reserveInfo) {
    throw new Error('Burn reserve token account not found on this cluster')
  }
  const reserve = decodeTokenAccount(reserveInfo.data)
  if (!reserve.mint.equals(KLYTH_MINT)) {
    throw new Error(
      `Burn reserve mint is ${reserve.mint.toBase58()}, expected ${KLYTH_MINT.toBase58()}`,
    )
  }

  console.log(`Curve authority:  ${curveAuthority.toBase58()}`)
  console.log(`Reserve owner:    ${reserve.owner.toBase58()}`)
  console.log(`Reserve balance:  ${formatNbr(reserve.amount)} KLYTH`)
  console.log('')

  const burnStateInfo = await connection.getAccountInfo(burnStateAddress, 'confirmed')
  const instructions = []
  const signers = []

  if (!burnStateInfo) {
    const authority = loadKeypair(
      process.env.BURN_STATE_AUTHORITY_KEYPAIR,
      'BURN_STATE_AUTHORITY_KEYPAIR',
    )
    if (!authority.publicKey.equals(curveAuthority)) {
      throw new Error(
        `BURN_STATE_AUTHORITY_KEYPAIR is ${authority.publicKey.toBase58()}, but the curve authority is ${curveAuthority.toBase58()}`,
      )
    }

    console.log('Plan: initialize BurnState')
    instructions.push(createInitializeBurnInstruction(authority.publicKey, dailyCap))
    signers.push(authority)
  } else {
    const state = decodeBurnState(burnStateInfo.data)
    if (!state.mint.equals(KLYTH_MINT)) {
      throw new Error('Existing BurnState has a different mint')
    }
    if (!state.burnReserve.equals(BURN_RESERVE_TOKEN_ACCOUNT)) {
      throw new Error(
        `Existing BurnState points at ${state.burnReserve.toBase58()}, not ${BURN_RESERVE_TOKEN_ACCOUNT.toBase58()}`,
      )
    }
    console.log(
      `Plan: BurnState already exists (cap ${formatNbr(state.dailyCap)} KLYTH, ${state.burnCount} burns)`,
    )
  }

  if (!reserve.owner.equals(burnAuthority)) {
    const reserveOwner = loadKeypair(
      process.env.BURN_RESERVE_OWNER_KEYPAIR,
      'BURN_RESERVE_OWNER_KEYPAIR',
    )
    if (!reserveOwner.publicKey.equals(reserve.owner)) {
      throw new Error(
        `BURN_RESERVE_OWNER_KEYPAIR is ${reserveOwner.publicKey.toBase58()}, but the reserve owner is ${reserve.owner.toBase58()}`,
      )
    }

    console.log(`Plan: SetAuthority ${reserve.owner.toBase58()} -> ${burnAuthority.toBase58()}`)
    instructions.push(
      createSetAuthorityInstruction(
        BURN_RESERVE_TOKEN_ACCOUNT,
        reserveOwner.publicKey,
        AuthorityType.AccountOwner,
        burnAuthority,
      ),
    )
    signers.push(reserveOwner)
  } else {
    console.log('Plan: reserve is already owned by the burn authority')
  }

  if (instructions.length === 0) {
    console.log('\nNothing to do. Burn migration is complete.')
    console.log(`Next burn window: ${BURN_INTERVAL_SECONDS.toString()} seconds after the last burn`)
    return
  }

  if (dryRun) {
    console.log('\nDRY_RUN=1, not sending.')
    return
  }

  const uniqueSigners = signers.filter(
    (signer, index, all) =>
      all.findIndex((candidate) =>
        candidate.publicKey.equals(signer.publicKey),
      ) === index,
  )

  const transaction = new Transaction().add(...instructions)
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    uniqueSigners,
    { commitment: 'confirmed' },
  )

  console.log(`\nMigration confirmed: ${signature}`)
  console.log(explorerTxUrl(signature))

  const updatedReserve = decodeTokenAccount(
    (await connection.getAccountInfo(BURN_RESERVE_TOKEN_ACCOUNT, 'confirmed')).data,
  )
  const updatedState = decodeBurnState(
    (await connection.getAccountInfo(burnStateAddress, 'confirmed')).data,
  )

  console.log(`\nReserve owner now: ${updatedReserve.owner.toBase58()}`)
  console.log(`Daily cap:         ${formatNbr(updatedState.dailyCap)} KLYTH`)
  console.log(`Total burned:      ${formatNbr(updatedState.totalBurned)} KLYTH`)
  console.log(`Burn count:        ${updatedState.burnCount.toString()}`)
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`)
  process.exit(1)
})
