import {
  BUY_DISCRIMINATOR,
  SELL_DISCRIMINATOR,
  formatNbr,
  formatSol,
} from './curve'
import {
  BURN_RESERVE_TOKEN_ACCOUNT,
  MINT_ADDRESS,
  PROGRAM_ADDRESS,
  SOL_RESERVE_ADDRESS,
  STATE_ADDRESS,
  isDemoWallet,
} from './addresses'
import { rpcRequest } from './rpc'

export type ActivityKind = 'buy' | 'sell' | 'burn'

export type ActivityRecord = {
  signature: string
  kind: ActivityKind
  slot: number
  blockTime: number | null
  wallet: string
  amountRaw: string
  amount: string
  solRaw: string | null
  sol: string | null
  status: 'confirmed' | 'failed'
  /** True when the transaction came from the flagged Devnet demo wallet. */
  demo: boolean
}

export type ActivityPage = {
  records: ActivityRecord[]
  hasMore: boolean
}

export type BurnStats = {
  totalRaw: string
  total: string
  burnCount: number
  records: ActivityRecord[]
}

type SignatureEntry = {
  signature: string
  slot: number
  blockTime: number | null
  err: unknown
}

type ParsedAccountKey = {
  pubkey: string
  signer: boolean
  writable: boolean
  source?: string
}

type ParsedInstruction = {
  program?: string
  programId?: string
  parsed?: {
    type?: string
    info?: Record<string, unknown>
  }
  accounts?: string[]
  data?: string
  stackHeight?: number | null
}

type ParsedTransaction = {
  slot: number
  blockTime: number | null
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
    innerInstructions?: Array<{
      index: number
      instructions: ParsedInstruction[]
    }> | null
  } | null
  transaction: {
    message: {
      accountKeys: ParsedAccountKey[]
      instructions: ParsedInstruction[]
    }
  }
}

const KIND_BY_DISCRIMINATOR = new Map<string, ActivityKind>([
  [BUY_DISCRIMINATOR.join(','), 'buy'],
  [SELL_DISCRIMINATOR.join(','), 'sell'],
])

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_INDEX = new Map<string, number>(
  Array.from(BASE58_ALPHABET).map((character, index) => [character, index]),
)

const BURN_PAGE_SIZE = 1_000
const BURN_MAX_PAGES = 10
const BURN_STATS_TTL = 60_000
const ACTIVITY_TTL = 20_000

/**
 * A confirmed transaction never changes, so decoded rows are kept by signature.
 * Polls then only pay for signatures they have not seen yet, which keeps the
 * candle feed fresh without hammering the public Devnet rate limit.
 */
const TRANSACTION_CACHE_LIMIT = 600

let burnStatsCache: { expiresAt: number; value: BurnStats } | null = null
const activityCache = new Map<string, { expiresAt: number; value: ActivityPage }>()
const transactionCache = new Map<string, ParsedTransaction>()

function decodeBase58(value: string): Uint8Array {
  const bytes: number[] = [0]

  for (const character of value) {
    const carryValue = BASE58_INDEX.get(character)
    if (carryValue === undefined) {
      throw new Error('Invalid base58 string')
    }

    let carry = carryValue
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58
      bytes[index] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (let index = 0; index < value.length && value[index] === '1'; index += 1) {
    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}

function readBigUInt64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index])
  }
  return value
}

async function getSignatures(
  address: string,
  limit: number,
  signal?: AbortSignal,
  before?: string,
): Promise<SignatureEntry[]> {
  // `confirmed` (not the finalized default) so a trade appears in the candle
  // feed within a poll or two instead of after finalization (~13s + poll).
  const config: { limit: number; before?: string; commitment: 'confirmed' } = {
    limit,
    commitment: 'confirmed',
  }
  if (before) {
    config.before = before
  }

  return rpcRequest<SignatureEntry[]>(
    'getSignaturesForAddress',
    [address, config],
    signal,
  )
}

async function getTransaction(
  signature: string,
  signal?: AbortSignal,
): Promise<ParsedTransaction | null> {
  const cached = transactionCache.get(signature)
  if (cached) {
    // Re-insert so the newest-used entries survive eviction.
    transactionCache.delete(signature)
    transactionCache.set(signature, cached)
    return cached
  }

  const transaction = await rpcRequest<ParsedTransaction | null>(
    'getTransaction',
    [
      signature,
      {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      },
    ],
    signal,
  )

  // Never cache a miss: a transaction that is not visible yet can still land.
  if (transaction) {
    transactionCache.set(signature, transaction)
    if (transactionCache.size > TRANSACTION_CACHE_LIMIT) {
      const oldest = transactionCache.keys().next().value
      if (oldest !== undefined) {
        transactionCache.delete(oldest)
      }
    }
  }

  return transaction
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) {
          return
        }
        results[index] = await worker(items[index])
      }
    },
  )

  await Promise.all(runners)
  return results
}

function isSuccessful(transaction: ParsedTransaction): boolean {
  return transaction.meta !== null && !transaction.meta.err
}

function parseProgramRecord(
  entry: SignatureEntry,
  transaction: ParsedTransaction,
): ActivityRecord | null {
  const message = transaction.transaction.message
  const instruction = message.instructions.find(
    (candidate) => candidate.programId === PROGRAM_ADDRESS && candidate.data,
  )

  if (!instruction?.data) {
    return null
  }

  // The program is mint-agnostic, so it also contains trades for older mints.
  // Only keep transactions that reference the current KLYTH mint.
  const touchedAccounts =
    instruction.accounts ?? message.accountKeys.map((key) => key.pubkey)
  if (!touchedAccounts.includes(MINT_ADDRESS)) {
    return null
  }

  const data = decodeBase58(instruction.data)
  if (data.length < 24) {
    return null
  }

  const kind = KIND_BY_DISCRIMINATOR.get(data.subarray(0, 8).join(','))
  if (!kind) {
    return null
  }

  const amountRaw = readBigUInt64LE(data, 8)
  const wallet =
    message.accountKeys.find((key) => key.signer)?.pubkey ??
    instruction.accounts?.[0] ??
    'Unknown'

  const reserve = instruction.accounts?.[5] ?? SOL_RESERVE_ADDRESS
  const reserveIndex = message.accountKeys.findIndex((key) => key.pubkey === reserve)

  let solRaw: bigint | null = null
  if (transaction.meta && reserveIndex >= 0) {
    const delta =
      transaction.meta.postBalances[reserveIndex] -
      transaction.meta.preBalances[reserveIndex]

    if (kind === 'buy' && delta > 0) {
      solRaw = BigInt(delta)
    }
    if (kind === 'sell' && delta < 0) {
      solRaw = BigInt(-delta)
    }
  }

  return {
    signature: entry.signature,
    kind,
    slot: entry.slot,
    blockTime: transaction.blockTime ?? entry.blockTime,
    wallet,
    amountRaw: amountRaw.toString(),
    amount: formatNbr(amountRaw, 4),
    solRaw: solRaw !== null ? solRaw.toString() : null,
    sol: solRaw !== null ? formatSol(solRaw, 9) : null,
    status: isSuccessful(transaction) ? 'confirmed' : 'failed',
    demo: isDemoWallet(wallet),
  }
}

function parseBurnRecord(
  entry: SignatureEntry,
  transaction: ParsedTransaction,
): ActivityRecord | null {
  const message = transaction.transaction.message
  // `burn_daily` performs the SPL Token burn through a CPI, so the burn shows up
  // in `meta.innerInstructions`, not in the top-level message instructions.
  const instructions = [
    ...message.instructions,
    ...(transaction.meta?.innerInstructions ?? []).flatMap(
      (group) => group.instructions,
    ),
  ]
  const instruction = instructions.find(
    (candidate) =>
      candidate.parsed?.type === 'burn' &&
      candidate.parsed.info?.account === BURN_RESERVE_TOKEN_ACCOUNT &&
      candidate.parsed.info?.mint === MINT_ADDRESS,
  )

  const info = instruction?.parsed?.info as { amount?: string; authority?: string } | undefined
  if (!info?.amount) {
    return null
  }

  const amountRaw = BigInt(info.amount)
  const wallet =
    info.authority ??
    message.accountKeys.find((key) => key.signer)?.pubkey ??
    'Unknown'

  return {
    signature: entry.signature,
    kind: 'burn',
    slot: entry.slot,
    blockTime: transaction.blockTime ?? entry.blockTime,
    wallet,
    amountRaw: amountRaw.toString(),
    amount: formatNbr(amountRaw, 4),
    solRaw: null,
    sol: null,
    status: isSuccessful(transaction) ? 'confirmed' : 'failed',
    demo: isDemoWallet(wallet),
  }
}

/**
 * Loads the newest Buy/Sell/Burn records from Devnet.
 *
 * Program transactions come from the bonding curve program; burns come from the
 * burn reserve token account. `limit` is the number of decoded records to return,
 * so the caller may request more than the raw signature page size.
 *
 * `seed` supplies records the caller already has (the OHLC snapshot). Those
 * signatures are not fetched again, which makes the first paint fast and turns
 * each poll into "fetch only what happened since the snapshot". Work stops as
 * soon as `limit` newest records are known, so old history is never requested.
 */
export async function fetchActivity(
  limit: number,
  signal?: AbortSignal,
  force = false,
  seed?: ReadonlyArray<ActivityRecord>,
): Promise<ActivityPage> {
  const cacheKey = `${limit}:${seed?.length ?? 0}`
  const cached = activityCache.get(cacheKey)
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const programLimit = Math.min(limit * 3 + 5, 150)
  const burnLimit = Math.min(limit * 2 + 5, 80)

  const [curveSignatures, burnSignatures] = await Promise.all([
    getSignatures(STATE_ADDRESS, programLimit, signal),
    getSignatures(BURN_RESERVE_TOKEN_ACCOUNT, burnLimit, signal),
  ])

  const seen = new Set<string>()
  const candidates: Array<{ entry: SignatureEntry; source: 'program' | 'burn' }> = []

  for (const [source, entries] of [
    ['program', curveSignatures],
    ['burn', burnSignatures],
  ] as const) {
    for (const entry of entries) {
      if (seen.has(entry.signature)) {
        continue
      }
      seen.add(entry.signature)
      candidates.push({ entry, source })
    }
  }

  candidates.sort((left, right) => right.entry.slot - left.entry.slot)

  const seeded = new Map<string, ActivityRecord>()
  if (seed) {
    for (const record of seed) {
      seeded.set(record.signature, record)
    }
  }

  const records: ActivityRecord[] = []
  let cursor = 0
  let reachedSeed = false

  // Walk newest-first. Everything newer than the first seeded signature must be
  // fetched, otherwise the merge with the snapshot would leave a gap. Once the
  // seed boundary is reached, remaining rows are free to copy and the walk can
  // stop as soon as `limit` rows are known. Racing workers may push a few extra
  // rows; the sort and slice below trim them.
  const runners = Array.from(
    { length: Math.min(3, candidates.length) },
    async () => {
      while (!reachedSeed || records.length < limit) {
        const index = cursor
        cursor += 1
        if (index >= candidates.length) {
          return
        }

        const { entry, source } = candidates[index]
        const known = seeded.get(entry.signature)
        if (known) {
          reachedSeed = true
          records.push(known)
          continue
        }

        const transaction = await getTransaction(entry.signature, signal)
        if (!transaction) {
          continue
        }

        const record =
          source === 'burn'
            ? parseBurnRecord(entry, transaction)
            : parseProgramRecord(entry, transaction)

        if (record) {
          records.push(record)
        }
      }
    },
  )

  await Promise.all(runners)

  records.sort((left, right) => right.slot - left.slot)

  const value: ActivityPage = {
    records: records.slice(0, limit),
    hasMore:
      curveSignatures.length === programLimit ||
      burnSignatures.length === burnLimit,
  }

  activityCache.set(cacheKey, { expiresAt: Date.now() + ACTIVITY_TTL, value })
  return value
}

async function fetchAllBurnSignatures(signal?: AbortSignal): Promise<SignatureEntry[]> {
  const entries: SignatureEntry[] = []
  let before: string | undefined

  for (let page = 0; page < BURN_MAX_PAGES; page += 1) {
    const pageEntries = await getSignatures(
      BURN_RESERVE_TOKEN_ACCOUNT,
      BURN_PAGE_SIZE,
      signal,
      before,
    )

    entries.push(...pageEntries)

    if (pageEntries.length < BURN_PAGE_SIZE) {
      break
    }

    before = pageEntries[pageEntries.length - 1].signature
  }

  return entries
}

/**
 * Scans every transaction touching the burn reserve and sums the verified SPL
 * Token burn instructions. Failed burns are listed but not counted in the total.
 */
export async function fetchBurnStats(
  signal?: AbortSignal,
  force = false,
): Promise<BurnStats> {
  if (!force && burnStatsCache && burnStatsCache.expiresAt > Date.now()) {
    return burnStatsCache.value
  }

  const signatures = await fetchAllBurnSignatures(signal)
  const transactions = await mapWithConcurrency(signatures, 3, (entry) =>
    getTransaction(entry.signature, signal),
  )

  const records: ActivityRecord[] = []
  signatures.forEach((entry, index) => {
    const transaction = transactions[index]
    if (!transaction) {
      return
    }

    const record = parseBurnRecord(entry, transaction)
    if (record) {
      records.push(record)
    }
  })

  records.sort((left, right) => right.slot - left.slot)

  const confirmed = records.filter((record) => record.status === 'confirmed')
  const totalRaw = confirmed.reduce(
    (sum, record) => sum + BigInt(record.amountRaw),
    0n,
  )

  const value: BurnStats = {
    totalRaw: totalRaw.toString(),
    total: formatNbr(totalRaw, 4),
    burnCount: confirmed.length,
    records,
  }

  burnStatsCache = { expiresAt: Date.now() + BURN_STATS_TTL, value }
  return value
}

export type ExecutionPoint = {
  supply: number
  price: number
  kind: 'buy' | 'sell'
  blockTime: number | null
  slot: number
}

/**
 * Rebuilds the sold-supply position of each real trade by walking backwards
 * from the current on-chain sold supply. Execution price comes from the SOL
 * that actually moved in or out of the reserve, so it is not an estimate.
 */
export function buildExecutionPoints(
  records: ActivityRecord[],
  soldSupplyRaw: bigint | null,
): ExecutionPoint[] {
  if (soldSupplyRaw === null) {
    return []
  }

  let supplyAfter = soldSupplyRaw
  const points: ExecutionPoint[] = []

  for (const record of records) {
    if (record.kind === 'burn' || record.status !== 'confirmed') {
      continue
    }

    const amount = BigInt(record.amountRaw)
    const price =
      record.solRaw !== null && amount > 0n
        ? Number(record.solRaw) / Number(amount) / 1000
        : null

    if (price !== null && Number.isFinite(price) && price > 0) {
      points.push({
        supply: Number(supplyAfter) / 1_000_000,
        price,
        kind: record.kind,
        blockTime: record.blockTime,
        slot: record.slot,
      })
    }

    supplyAfter = record.kind === 'buy' ? supplyAfter - amount : supplyAfter + amount
  }

  return points.reverse()
}

export function formatBlockTime(blockTime: number | null): string {
  if (!blockTime) {
    return 'Unknown'
  }

  return `${new Date(blockTime * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })} WIB`
}
