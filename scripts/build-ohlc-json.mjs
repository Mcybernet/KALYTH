#!/usr/bin/env node
/**
 * Builds the trade snapshot the frontend chart turns into OHLC candles.
 *
 * The chart used to be built from the newest 40 activity rows, so the candles
 * changed whenever those rows scrolled out of the window. This script collects
 * every confirmed KLYTH buy/sell into a JSON file that the Pages build ships
 * with the site. The frontend then builds candles from the full history and
 * merges the newest live rows on top.
 *
 * Incremental by default: pass `--base` (URL or path) to reuse a previous
 * snapshot. Only transactions newer than the newest known signature are
 * fetched. `--full` rescans the whole curve history.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Connection, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  KLYTH_MINT,
  PROGRAM_ID,
  getCurveStateAddress,
} from './burn-common.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUTPUT = path.join(
  HERE,
  '..',
  'app',
  'frontend',
  'public',
  'data',
  'klyth-trades.json',
)

const RESERVE_SEED = Buffer.from('sol_reserve')
const SOL_RESERVE = PublicKey.findProgramAddressSync(
  [RESERVE_SEED, KLYTH_MINT.toBuffer()],
  PROGRAM_ID,
)[0]
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234])
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173])

const MINT = KLYTH_MINT.toBase58()
const PROGRAM = PROGRAM_ID.toBase58()
const CURVE_STATE = getCurveStateAddress()

const PAGE_SIZE = 1_000
const MAX_PAGES = 50
// The public Devnet endpoint rate-limits `getTransaction` hard. One request at
// a time with a one-second gap is slow but reliable; a dedicated RPC endpoint
// in `DEVNET_RPC_URL` makes the run much faster.
const CONCURRENCY = 1
const REQUEST_GAP_MS = 1_000

const RPC_URL =
  process.env.DEVNET_RPC_URL?.trim() || 'https://api.devnet.solana.com'
const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  disableRetryOnRateLimit: true,
})

function usage() {
  console.log(`Usage: node build-ohlc-json.mjs [options]

  --output <path>   Where to write the snapshot
                    (default: app/frontend/public/data/klyth-trades.json)
  --base <url|path> Previous snapshot to extend incrementally
  --full            Ignore --base and rescan the whole curve history
  --help            Show this message

Environment:
  DEVNET_RPC_URL    Devnet RPC endpoint (default: public endpoint)`)
}

function parseArgs(argv) {
  const options = { output: DEFAULT_OUTPUT, base: null, full: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output') {
      options.output = argv[++index]
    } else if (arg === '--base') {
      options.base = argv[++index]
    } else if (arg === '--full') {
      options.full = true
    } else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function withRetry(task, label, attempts = 8) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) {
        break
      }
      // Jitter keeps parallel runners from retrying in lockstep.
      const delay =
        Math.min(1_500 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 400)
      console.warn(
        `  ! ${label} failed (${error?.message ?? error}); retrying in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
  throw lastError
}

function normaliseTrade(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  const trade = value
  if (
    typeof trade.signature !== 'string' ||
    (trade.kind !== 'buy' && trade.kind !== 'sell') ||
    typeof trade.slot !== 'number' ||
    typeof trade.wallet !== 'string' ||
    typeof trade.amountRaw !== 'string' ||
    (trade.solRaw !== null && typeof trade.solRaw !== 'string') ||
    (trade.blockTime !== null && typeof trade.blockTime !== 'number')
  ) {
    return null
  }
  return {
    signature: trade.signature,
    kind: trade.kind,
    slot: trade.slot,
    blockTime: trade.blockTime ?? null,
    wallet: trade.wallet,
    amountRaw: trade.amountRaw,
    solRaw: trade.solRaw ?? null,
  }
}

async function loadBase(source) {
  if (!source) {
    return null
  }
  try {
    let raw
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source, { cache: 'no-store' })
      if (!response.ok) {
        console.warn(`Base snapshot not available (${response.status}); full scan.`)
        return null
      }
      raw = await response.text()
    } else {
      if (!fs.existsSync(source)) {
        console.warn(`Base snapshot ${source} not found; full scan.`)
        return null
      }
      raw = fs.readFileSync(source, 'utf8')
    }

    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.trades)) {
      console.warn('Base snapshot has no trades array; full scan.')
      return null
    }
    if (parsed.mint && parsed.mint !== MINT) {
      console.warn(`Base snapshot mint ${parsed.mint} != ${MINT}; full scan.`)
      return null
    }

    const trades = parsed.trades.map(normaliseTrade).filter(Boolean)
    console.log(`Base snapshot: ${trades.length} trades`)
    return trades
  } catch (error) {
    console.warn(`Could not read base snapshot (${error.message}); full scan.`)
    return null
  }
}

/**
 * `getSignaturesForAddress` is newest-first and has no "after" cursor. With a
 * base snapshot we page backwards and stop as soon as we reach a known
 * signature. A full scan keeps paging until the address runs dry.
 */
async function collectNewSignatures(known) {
  const entries = []
  const seen = new Set()
  let before

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await withRetry(
      () =>
        connection.getSignaturesForAddress(CURVE_STATE, {
          limit: PAGE_SIZE,
          ...(before ? { before } : {}),
        }),
      'getSignaturesForAddress',
    )

    if (batch.length === 0) {
      break
    }

    let hitKnown = false
    for (const entry of batch) {
      if (known.has(entry.signature)) {
        hitKnown = true
        continue
      }
      if (seen.has(entry.signature)) {
        continue
      }
      seen.add(entry.signature)
      entries.push(entry)
    }

    if (known.size > 0 && hitKnown) {
      break
    }
    if (batch.length < PAGE_SIZE) {
      break
    }
    before = batch[batch.length - 1].signature
  }

  return entries
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) {
          return
        }
        results[index] = await worker(items[index], index)
        await sleep(REQUEST_GAP_MS)
      }
    },
  )

  await Promise.all(runners)
  return results
}

function toAddress(value) {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object' && typeof value.toBase58 === 'function') {
    return value.toBase58()
  }
  if (typeof value === 'object' && value.pubkey !== undefined) {
    return toAddress(value.pubkey)
  }
  return String(value)
}

function decodeTrade(entry, transaction) {
  if (!transaction || !transaction.meta || transaction.meta.err) {
    return null
  }

  const message = transaction.transaction?.message
  if (!message) {
    return null
  }

  const instructions = message.instructions ?? []
  const instruction = instructions.find(
    (candidate) => toAddress(candidate.programId) === PROGRAM && candidate.data,
  )
  if (!instruction) {
    return null
  }

  const accountKeys = (message.accountKeys ?? []).map((key) =>
    toAddress(key?.pubkey ?? key),
  )
  const accounts =
    Array.isArray(instruction.accounts) && instruction.accounts.length > 0
      ? instruction.accounts.map(toAddress)
      : accountKeys
  if (!accounts.includes(MINT)) {
    return null
  }

  let data
  try {
    data = Buffer.from(bs58.decode(instruction.data))
  } catch {
    return null
  }
  if (data.length < 16) {
    return null
  }

  const discriminator = Buffer.from(data.subarray(0, 8))
  let kind = null
  if (discriminator.equals(BUY_DISCRIMINATOR)) {
    kind = 'buy'
  } else if (discriminator.equals(SELL_DISCRIMINATOR)) {
    kind = 'sell'
  }
  if (!kind) {
    return null
  }

  const amountRaw = data.readBigUInt64LE(8)
  if (amountRaw <= 0n) {
    return null
  }

  const signerEntry = (message.accountKeys ?? []).find(
    (key) => typeof key === 'object' && key !== null && key.signer,
  )
  const wallet =
    (signerEntry ? toAddress(signerEntry.pubkey ?? signerEntry) : null) ??
    accountKeys[0] ??
    'Unknown'

  const reserve = accounts[5] ?? SOL_RESERVE.toBase58()
  const reserveIndex = accountKeys.indexOf(reserve)
  let solRaw = null
  if (
    reserveIndex >= 0 &&
    Array.isArray(transaction.meta.preBalances) &&
    Array.isArray(transaction.meta.postBalances)
  ) {
    const delta =
      transaction.meta.postBalances[reserveIndex] -
      transaction.meta.preBalances[reserveIndex]
    if (kind === 'buy' && delta > 0) {
      solRaw = BigInt(delta)
    } else if (kind === 'sell' && delta < 0) {
      solRaw = BigInt(-delta)
    }
  }

  return {
    signature: entry.signature,
    kind,
    slot: entry.slot ?? transaction.slot ?? 0,
    blockTime: transaction.blockTime ?? entry.blockTime ?? null,
    wallet,
    amountRaw: amountRaw.toString(),
    solRaw: solRaw === null ? null : solRaw.toString(),
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  console.log(`RPC: ${RPC_URL}`)
  console.log(`Curve state: ${CURVE_STATE.toBase58()}`)

  const baseTrades = options.full ? null : await loadBase(options.base)
  const known = new Set((baseTrades ?? []).map((trade) => trade.signature))
  if (!baseTrades) {
    console.log('Scanning the full trade history...')
  }

  const signatures = await collectNewSignatures(known)
  console.log(`New signatures: ${signatures.length}`)

  let fetched = 0
  const transactions = await mapWithConcurrency(
    signatures,
    CONCURRENCY,
    async (entry) => {
      const transaction = await withRetry(
        () =>
          connection.getParsedTransaction(entry.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          }),
        `getTransaction ${entry.signature.slice(0, 8)}`,
      )
      fetched += 1
      if (fetched % 50 === 0 || fetched === signatures.length) {
        console.log(`  fetched ${fetched}/${signatures.length}`)
      }
      return transaction
    },
  )

  const fresh = []
  for (let index = 0; index < signatures.length; index += 1) {
    const trade = decodeTrade(signatures[index], transactions[index])
    if (trade) {
      fresh.push(trade)
    }
  }

  const bySignature = new Map()
  for (const trade of baseTrades ?? []) {
    bySignature.set(trade.signature, trade)
  }
  for (const trade of fresh) {
    bySignature.set(trade.signature, trade)
  }

  const trades = [...bySignature.values()].sort(
    (left, right) =>
      (left.blockTime ?? 0) - (right.blockTime ?? 0) || left.slot - right.slot,
  )

  const payload = {
    version: 1,
    mint: MINT,
    program: PROGRAM,
    generatedAt: new Date().toISOString(),
    trades,
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true })
  fs.writeFileSync(options.output, `${JSON.stringify(payload)}\n`)

  console.log(
    `Wrote ${trades.length} trades (${fresh.length} new) to ${options.output}`,
  )
  if (trades.length > 0) {
    const first = trades[0]
    const last = trades[trades.length - 1]
    const format = (trade) =>
      trade.blockTime
        ? new Date(trade.blockTime * 1_000).toISOString()
        : 'unknown time'
    console.log(`Range: ${format(first)} -> ${format(last)}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
