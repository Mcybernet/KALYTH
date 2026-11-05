#!/usr/bin/env node
/**
 * Permissionless daily burn crank.
 *
 * Sends `burn_daily`, which burns min(daily_cap, reserve balance) if the
 * 23h50m window has elapsed. Safe to run more often than daily: the program
 * rejects early calls, and this script skips them before sending.
 *
 * Required env:
 *   BURN_CRANK_KEYPAIR   path/JSON/base58 for a funded Devnet keypair
 * Optional env:
 *   DEVNET_RPC_URL       defaults to https://api.devnet.solana.com
 *   DRY_RUN=1            print the plan without sending
 */
import { sendAndConfirmTransaction, Transaction } from '@solana/web3.js'
import {
  BURN_INTERVAL_SECONDS,
  BURN_RESERVE_TOKEN_ACCOUNT,
  KLYTH_MINT,
  connectionFromEnv,
  createBurnDailyInstruction,
  decodeBurnState,
  decodeTokenAccount,
  explorerTxUrl,
  formatNbr,
  getBurnAuthorityAddress,
  getBurnStateAddress,
  loadKeypair,
} from './burn-common.mjs'

const WINDOW_BUFFER_SECONDS = 10n

function isAlreadyBurned(error) {
  const text = [
    error?.message ?? '',
    ...(Array.isArray(error?.logs) ? error.logs : []),
  ].join(' ')

  return (
    text.includes('BurnNotReady') ||
    text.includes('NothingToBurn') ||
    text.includes('custom program error: 0x1779') ||
    text.includes('custom program error: 0x177a')
  )
}

async function main() {
  const connection = connectionFromEnv()
  const dryRun = process.env.DRY_RUN === '1'
  const cranker = loadKeypair(
    process.env.BURN_CRANK_KEYPAIR,
    'BURN_CRANK_KEYPAIR',
  )

  const burnStateAddress = getBurnStateAddress()
  const burnAuthority = getBurnAuthorityAddress()

  console.log(`Crank wallet:     ${cranker.publicKey.toBase58()}`)
  console.log(`Burn state:       ${burnStateAddress.toBase58()}`)
  console.log(`Burn authority:   ${burnAuthority.toBase58()}`)
  console.log(`Burn reserve:     ${BURN_RESERVE_TOKEN_ACCOUNT.toBase58()}`)
  console.log('')

  const stateInfo = await connection.getAccountInfo(burnStateAddress, 'confirmed')
  if (!stateInfo) {
    throw new Error(
      'BurnState is not initialized. Run scripts/migrate-burn.mjs first.',
    )
  }

  const state = decodeBurnState(stateInfo.data)
  if (!state.mint.equals(KLYTH_MINT)) {
    throw new Error('BurnState mint does not match KLYTH')
  }
  if (!state.burnAuthority.equals(burnAuthority)) {
    throw new Error(
      `BurnState authority is ${state.burnAuthority.toBase58()}, expected ${burnAuthority.toBase58()}`,
    )
  }
  if (!state.burnReserve.equals(BURN_RESERVE_TOKEN_ACCOUNT)) {
    throw new Error(
      `BurnState reserve is ${state.burnReserve.toBase58()}, expected ${BURN_RESERVE_TOKEN_ACCOUNT.toBase58()}`,
    )
  }

  const reserveInfo = await connection.getAccountInfo(
    BURN_RESERVE_TOKEN_ACCOUNT,
    'confirmed',
  )
  if (!reserveInfo) {
    throw new Error('Burn reserve token account not found')
  }
  const reserve = decodeTokenAccount(reserveInfo.data)
  if (!reserve.mint.equals(KLYTH_MINT)) {
    throw new Error('Burn reserve mint does not match KLYTH')
  }
  if (!reserve.owner.equals(burnAuthority)) {
    throw new Error(
      `Burn reserve owner is ${reserve.owner.toBase58()}, not the burn authority. Run scripts/migrate-burn.mjs first.`,
    )
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  const nextEligible =
    state.lastBurnTs === 0n
      ? 0n
      : state.lastBurnTs + BURN_INTERVAL_SECONDS

  console.log(`Daily cap:        ${formatNbr(state.dailyCap)} KLYTH`)
  console.log(`Reserve balance:  ${formatNbr(reserve.amount)} KLYTH`)
  console.log(`Total burned:     ${formatNbr(state.totalBurned)} KLYTH`)
  console.log(`Burn count:       ${state.burnCount.toString()}`)

  if (nextEligible + WINDOW_BUFFER_SECONDS > now) {
    const wait = nextEligible + WINDOW_BUFFER_SECONDS - now
    console.log(
      `\nSkipping: burn window opens in ${wait.toString()}s (${new Date(
        Number(nextEligible) * 1000,
      ).toISOString()}).`,
    )
    return
  }

  if (reserve.amount === 0n) {
    console.log('\nSkipping: burn reserve is empty.')
    return
  }

  const expectedBurn =
    state.dailyCap < reserve.amount ? state.dailyCap : reserve.amount
  console.log(`\nBurn amount:      ${formatNbr(expectedBurn)} KLYTH`)

  if (dryRun) {
    console.log('DRY_RUN=1, not sending.')
    return
  }

  const transaction = new Transaction().add(
    createBurnDailyInstruction(cranker.publicKey),
  )

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [cranker],
      { commitment: 'confirmed' },
    )

    console.log(`\nBurn confirmed: ${signature}`)
    console.log(explorerTxUrl(signature))
  } catch (error) {
    if (isAlreadyBurned(error)) {
      console.log('\nSkipping: another crank already burned in this window.')
      return
    }
    throw error
  }

  const updatedState = decodeBurnState(
    (await connection.getAccountInfo(burnStateAddress, 'confirmed')).data,
  )
  const updatedReserve = decodeTokenAccount(
    (await connection.getAccountInfo(BURN_RESERVE_TOKEN_ACCOUNT, 'confirmed')).data,
  )

  console.log(`\nNew total burned: ${formatNbr(updatedState.totalBurned)} KLYTH`)
  console.log(`New reserve:      ${formatNbr(updatedReserve.amount)} KLYTH`)
  console.log(`Burn count:       ${updatedState.burnCount.toString()}`)
}

main().catch((error) => {
  console.error(`\nDaily burn failed: ${error.message}`)
  if (Array.isArray(error?.logs) && error.logs.length > 0) {
    console.error(error.logs.join('\n'))
  }
  process.exit(1)
})
