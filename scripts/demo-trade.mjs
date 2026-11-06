#!/usr/bin/env node
/**
 * Devnet demo trader.
 *
 * Sends small, randomized buy/sell trades from a dedicated Devnet wallet so the
 * test deployment has visible activity. This is intentionally NOT a market
 * maker and must never run on mainnet.
 *
 * Safety rules:
 *   - Refuses to run unless the RPC is Solana Devnet.
 *   - Only spends its own wallet balance; never touches the curve reserve.
 *   - Caps buys by wallet balance, vault inventory, and max supply.
 *   - Caps sells by wallet inventory, sold supply, and reserve availability.
 *   - If SOL is below the fee buffer it exits cleanly and waits for a top-up.
 *
 * Required env:
 *   DEMO_TRADE_KEYPAIR       path/JSON/base58 for a funded Devnet keypair
 * Optional env:
 *   DEVNET_RPC_URL           defaults to https://api.devnet.solana.com
 *   DRY_RUN=1                print the plan without sending
 *   DEMO_TRADES_PER_RUN      default 1 (max 5)
 *   DEMO_MIN_TRADE_SOL       default 0.002
 *   DEMO_MAX_TRADE_SOL       default 0.02
 *   DEMO_MIN_SOL_BUFFER      default 0.005
 *   DEMO_MAX_VAULT_BPS       default 50   (0.5% of vault per buy)
 *   DEMO_MAX_RESERVE_BPS     default 50   (0.5% of reserve per sell)
 *   DEMO_MAX_SELL_WALLET_BPS default 2500 (25% of wallet KLYTH per sell)
 *   DEMO_SELL_PROBABILITY    default 0.45
 *   DEMO_SLIPPAGE_BPS        default 100  (1%)
 *   DEMO_MAX_DELAY_MS        default 30000
 */
import { sendAndConfirmTransaction, Transaction } from '@solana/web3.js'
import {
  BURN_RESERVE_TOKEN_ACCOUNT,
  KLYTH_MINT,
  connectionFromEnv,
  explorerTxUrl,
  formatNbr,
  getBurnAuthorityAddress,
  getCurveStateAddress,
  loadKeypair,
} from './burn-common.mjs'
import {
  buildBuyInstruction,
  buildCreateAtaInstruction,
  buildSellInstruction,
  decodeCurveState,
  decodeTokenBalance,
  formatSol,
  getReserveAddress,
  getTokenAccountAddress,
  getVaultAddress,
  quoteBuyCost,
  quoteNbrForSol,
  quoteSellReturn,
} from './demo-common.mjs'

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const MIN_TRADE_KLYTH_RAW = 1_000_000n // 1 KLYTH
const TOKEN_ACCOUNT_SIZE = 165
const ABSOLUTE_MAX_TRADE_LAMPORTS = 50_000_000n // 0.05 SOL, a typo guard

/** Protocol and treasury accounts that must never be used as the demo wallet. */
const FORBIDDEN_TRADERS = new Set([
  getCurveStateAddress().toBase58(),
  getReserveAddress().toBase58(),
  getVaultAddress().toBase58(),
  getBurnAuthorityAddress().toBase58(),
  BURN_RESERVE_TOKEN_ACCOUNT.toBase58(),
  '2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN',
])

function envInt(name, fallback) {
  const raw = process.env[name]
  if (!raw || !raw.trim()) {
    return fallback
  }
  const value = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer, got "${raw}"`)
  }
  return value
}

function envNumber(name, fallback) {
  const raw = process.env[name]
  if (!raw || !raw.trim()) {
    return fallback
  }
  const value = Number.parseFloat(raw.trim())
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`)
  }
  return value
}

function solToLamports(value) {
  const trimmed = value.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`Invalid SOL amount: "${value}"`)
  }
  const [whole = '', fraction = ''] = trimmed.split('.')
  const padded = (fraction + '0'.repeat(9)).slice(0, 9)
  return BigInt(whole || '0') * 1_000_000_000n + BigInt(padded || '0')
}

function randomInt(min, max) {
  if (max <= min) {
    return min
  }
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randomLogUniform(min, max) {
  if (max <= min) {
    return min
  }
  const ratio = Number(max) / Number(min)
  const value = Number(min) * Math.pow(ratio, Math.random())
  return BigInt(Math.max(Number(min), Math.floor(value)))
}

function minBigInt(...values) {
  let result = values[0]
  for (const value of values) {
    if (value < result) {
      result = value
    }
  }
  return result
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isInsufficientFunds(error) {
  const text = [error?.message ?? '', ...(Array.isArray(error?.logs) ? error.logs : [])].join(' ')
  return /insufficient (lamports|funds)|InsufficientFundsForFee|0x1\b/i.test(text)
}

function isExpectedTradeError(error) {
  const text = [error?.message ?? '', ...(Array.isArray(error?.logs) ? error.logs : [])].join(' ')
  return /SlippageExceeded|InsufficientReserve|InsufficientVault|MaxSupplyExceeded|InvalidAmount|0x177[0-9a-f]/i.test(
    text,
  )
}

async function loadChainState(connection, trader) {
  const stateInfo = await connection.getAccountInfo(getCurveStateAddress(), 'confirmed')
  if (!stateInfo) {
    throw new Error('Bonding curve state not found. Is the program deployed?')
  }

  const state = decodeCurveState(stateInfo.data)
  if (!state.mint.equals(KLYTH_MINT)) {
    throw new Error('Bonding curve mint does not match KLYTH')
  }

  const vaultInfo = await connection.getAccountInfo(state.tokenVault, 'confirmed')
  if (!vaultInfo) {
    throw new Error('Bonding curve token vault not found')
  }

  const reserveBalance = BigInt(
    await connection.getBalance(state.solReserve, 'confirmed'),
  )
  const reserveRent = BigInt(await connection.getMinimumBalanceForRentExemption(0))
  const reserveAvailable =
    reserveBalance > reserveRent ? reserveBalance - reserveRent : 0n

  const walletSol = BigInt(await connection.getBalance(trader.publicKey, 'confirmed'))
  const ataAddress = getTokenAccountAddress(trader.publicKey)
  const ataInfo = await connection.getAccountInfo(ataAddress, 'confirmed')
  const klythBalance = ataInfo ? decodeTokenBalance(ataInfo.data) : 0n
  const ataRent = ataInfo
    ? 0n
    : BigInt(await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE))

  return {
    state,
    vaultAmount: decodeTokenBalance(vaultInfo.data),
    reserveBalance,
    reserveAvailable,
    walletSol,
    klythBalance,
    ataAddress,
    ataExists: ataInfo !== null,
    ataRent,
  }
}

async function executeBuy({
  connection,
  trader,
  state,
  vaultAmount,
  walletSol,
  ataExists,
  ataRent,
  desiredSpend,
  config,
  dryRun,
}) {
  const spendable =
    walletSol > config.minSolBuffer + ataRent
      ? walletSol - config.minSolBuffer - ataRent
      : 0n

  if (spendable < config.minTradeLamports) {
    return 'skipped'
  }

  const vaultCap = (vaultAmount * BigInt(config.maxVaultBps)) / 10_000n
  const supplyCap = state.maxSoldSupply - state.soldSupply
  const quoted = quoteNbrForSol(state.soldSupply, desiredSpend)
  const amountRaw = minBigInt(quoted, vaultCap, supplyCap, vaultAmount)

  if (amountRaw < MIN_TRADE_KLYTH_RAW) {
    console.log('Skipping buy: amount is below the minimum trade size.')
    return 'skipped'
  }

  const cost = quoteBuyCost(state.soldSupply, amountRaw)
  if (cost === 0n || cost > spendable) {
    console.log('Skipping buy: quoted cost exceeds the spendable balance.')
    return 'skipped'
  }

  const slippage = (cost * BigInt(config.slippageBps)) / 10_000n
  const maxSolCost = cost + slippage + 1n

  console.log(
    `Plan: BUY ${formatNbr(amountRaw)} KLYTH for ~${formatSol(cost)} SOL (max ${formatSol(maxSolCost)})`,
  )

  if (dryRun) {
    return 'dry'
  }

  const transaction = new Transaction()
  if (!ataExists) {
    transaction.add(buildCreateAtaInstruction(trader.publicKey, trader.publicKey))
  }
  transaction.add(buildBuyInstruction(trader.publicKey, amountRaw, maxSolCost))

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [trader],
    { commitment: 'confirmed', maxRetries: 3 },
  )

  console.log(`Buy confirmed: ${signature}`)
  console.log(explorerTxUrl(signature))
  return 'confirmed'
}

async function executeSell({
  connection,
  trader,
  state,
  reserveAvailable,
  klythBalance,
  config,
  dryRun,
}) {
  const walletCap = (klythBalance * BigInt(config.maxSellWalletBps)) / 10_000n
  let maxSell = minBigInt(walletCap, klythBalance, state.soldSupply)

  // Dust below the percentage cap would otherwise lock the bot: sell the small
  // remainder whole instead of skipping forever.
  if (maxSell < MIN_TRADE_KLYTH_RAW && klythBalance >= MIN_TRADE_KLYTH_RAW) {
    maxSell = minBigInt(klythBalance, state.soldSupply)
  }

  if (maxSell < MIN_TRADE_KLYTH_RAW) {
    console.log('Skipping sell: wallet KLYTH is below the minimum trade size.')
    return 'skipped'
  }

  let amountRaw = randomLogUniform(MIN_TRADE_KLYTH_RAW, maxSell)
  let solReturn = quoteSellReturn(state.soldSupply, amountRaw)
  const maxReturn = (reserveAvailable * BigInt(config.maxReserveBps)) / 10_000n

  // Keep the sell small enough that it cannot meaningfully drain the reserve.
  let guard = 0
  while (solReturn > maxReturn && amountRaw > MIN_TRADE_KLYTH_RAW && guard < 20) {
    amountRaw = (amountRaw * 8n) / 10n
    solReturn = quoteSellReturn(state.soldSupply, amountRaw)
    guard += 1
  }

  if (solReturn === 0n || solReturn > maxReturn) {
    console.log('Skipping sell: reserve safety cap would be exceeded.')
    return 'skipped'
  }

  const slippage = (solReturn * BigInt(config.slippageBps)) / 10_000n
  const minSolReceived = solReturn > slippage ? solReturn - slippage : 1n

  console.log(
    `Plan: SELL ${formatNbr(amountRaw)} KLYTH for ~${formatSol(solReturn)} SOL (min ${formatSol(minSolReceived)})`,
  )

  if (dryRun) {
    return 'dry'
  }

  const transaction = new Transaction().add(
    buildSellInstruction(trader.publicKey, amountRaw, minSolReceived),
  )

  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [trader],
    { commitment: 'confirmed', maxRetries: 3 },
  )

  console.log(`Sell confirmed: ${signature}`)
  console.log(explorerTxUrl(signature))
  return 'confirmed'
}

async function runOneTrade({ connection, trader, config, dryRun, index, total }) {
  const {
    state,
    vaultAmount,
    reserveAvailable,
    walletSol,
    klythBalance,
    ataExists,
    ataRent,
  } = await loadChainState(connection, trader)

  const spendable =
    walletSol > config.minSolBuffer + ataRent
      ? walletSol - config.minSolBuffer - ataRent
      : 0n

  console.log('')
  console.log(
    `[${index}/${total}] wallet ${formatSol(walletSol)} SOL · ${formatNbr(klythBalance)} KLYTH · reserve ${formatSol(reserveAvailable)} SOL`,
  )

  if (walletSol < config.minSolBuffer) {
    console.log(
      `SOL is below the ${formatSol(config.minSolBuffer)} buffer. Waiting for a Devnet top-up.`,
    )
    return 'waiting'
  }

  const canBuy =
    spendable >= config.minTradeLamports &&
    vaultAmount >= MIN_TRADE_KLYTH_RAW &&
    state.soldSupply < state.maxSoldSupply
  const canSell = klythBalance >= MIN_TRADE_KLYTH_RAW && reserveAvailable > 0n

  if (!canBuy && !canSell) {
    console.log('No trade is possible yet. Waiting for inventory or a top-up.')
    return 'waiting'
  }

  let action
  if (canBuy && canSell) {
    action = Math.random() < config.sellProbability ? 'sell' : 'buy'
  } else {
    action = canBuy ? 'buy' : 'sell'
  }

  // If the randomized buy would not fit the wallet, prefer selling. If there is
  // nothing to sell, shrink the buy to the spendable balance.
  let desiredSpend = 0n
  if (action === 'buy') {
    desiredSpend = randomLogUniform(
      config.minTradeLamports,
      config.maxTradeLamports,
    )
    if (desiredSpend > spendable) {
      if (canSell) {
        console.log('Buy size exceeds available SOL; switching to sell.')
        action = 'sell'
      } else {
        console.log('Buy size exceeds available SOL; shrinking to fit.')
        desiredSpend = spendable
      }
    }
  } else if (!canSell) {
    // Only reachable if inventory disappeared between the checks above.
    action = 'buy'
    desiredSpend = minBigInt(
      randomLogUniform(config.minTradeLamports, config.maxTradeLamports),
      spendable,
    )
  }

  try {
    if (action === 'buy') {
      return await executeBuy({
        connection,
        trader,
        state,
        vaultAmount,
        walletSol,
        ataExists,
        ataRent,
        desiredSpend,
        config,
        dryRun,
      })
    }

    return await executeSell({
      connection,
      trader,
      state,
      reserveAvailable,
      klythBalance,
      config,
      dryRun,
    })
  } catch (error) {
    if (isInsufficientFunds(error)) {
      console.log('Wallet SOL exhausted; waiting for a top-up.')
      return 'waiting'
    }
    if (isExpectedTradeError(error)) {
      console.log(`Trade skipped: ${error.message}`)
      if (Array.isArray(error?.logs) && error.logs.length > 0) {
        console.log(error.logs.join('\n'))
      }
      return 'skipped'
    }
    throw error
  }
}

async function main() {
  if (process.env.DEMO_TRADING_ENABLED === '0' || process.env.DEMO_TRADING_ENABLED === 'false') {
    console.log('DEMO_TRADING_ENABLED is off. Exiting without trading.')
    return
  }

  const connection = connectionFromEnv()
  const genesis = await connection.getGenesisHash()
  if (genesis !== DEVNET_GENESIS) {
    throw new Error(
      'Refusing to run: this bot only works on Solana Devnet. Mainnet is not allowed.',
    )
  }

  const trader = loadKeypair(process.env.DEMO_TRADE_KEYPAIR, 'DEMO_TRADE_KEYPAIR')
  if (FORBIDDEN_TRADERS.has(trader.publicKey.toBase58())) {
    throw new Error(
      'Refusing to run: DEMO_TRADE_KEYPAIR points at a protocol or treasury account. Use a dedicated demo wallet.',
    )
  }

  const dryRun = process.env.DRY_RUN === '1'
  const config = {
    tradesPerRun: Math.min(Math.max(envInt('DEMO_TRADES_PER_RUN', 1), 1), 5),
    minTradeLamports: solToLamports(process.env.DEMO_MIN_TRADE_SOL || '0.002'),
    maxTradeLamports: solToLamports(process.env.DEMO_MAX_TRADE_SOL || '0.02'),
    minSolBuffer: solToLamports(process.env.DEMO_MIN_SOL_BUFFER || '0.005'),
    maxVaultBps: envInt('DEMO_MAX_VAULT_BPS', 50),
    maxReserveBps: envInt('DEMO_MAX_RESERVE_BPS', 50),
    maxSellWalletBps: envInt('DEMO_MAX_SELL_WALLET_BPS', 2_500),
    sellProbability: Math.min(
      Math.max(envNumber('DEMO_SELL_PROBABILITY', 0.45), 0),
      1,
    ),
    slippageBps: envInt('DEMO_SLIPPAGE_BPS', 100),
    maxDelayMs: envInt('DEMO_MAX_DELAY_MS', 30_000),
  }

  if (config.maxTradeLamports < config.minTradeLamports) {
    throw new Error('DEMO_MAX_TRADE_SOL must be >= DEMO_MIN_TRADE_SOL')
  }
  if (config.minTradeLamports <= 0n) {
    throw new Error('DEMO_MIN_TRADE_SOL must be greater than zero')
  }
  if (config.maxTradeLamports > ABSOLUTE_MAX_TRADE_LAMPORTS) {
    throw new Error(
      `DEMO_MAX_TRADE_SOL must be <= ${formatSol(ABSOLUTE_MAX_TRADE_LAMPORTS)} SOL; this is a Devnet demo bot, not a market maker`,
    )
  }

  console.log('KALYTH Devnet demo trader')
  console.log(`Wallet:     ${trader.publicKey.toBase58()}`)
  console.log(`RPC:        ${process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com'}`)
  console.log(`Dry run:    ${dryRun ? 'yes' : 'no'}`)
  console.log(
    `Trade size: ${formatSol(config.minTradeLamports)}–${formatSol(config.maxTradeLamports)} SOL`,
  )
  console.log(`Trades:     ${config.tradesPerRun} per run`)

  for (let index = 0; index < config.tradesPerRun; index += 1) {
    if (index > 0) {
      const delay = randomInt(1_000, config.maxDelayMs)
      console.log(`\nWaiting ${(delay / 1000).toFixed(1)}s before the next trade…`)
      await sleep(delay)
    }

    const outcome = await runOneTrade({
      connection,
      trader,
      config,
      dryRun,
      index: index + 1,
      total: config.tradesPerRun,
    })

    if (outcome === 'waiting') {
      break
    }
  }
}

main().catch((error) => {
  console.error(`\nDemo trade failed: ${error.message}`)
  if (Array.isArray(error?.logs) && error.logs.length > 0) {
    console.error(error.logs.join('\n'))
  }
  process.exit(1)
})
