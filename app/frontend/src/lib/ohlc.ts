import { isDemoWallet, MINT_ADDRESS } from './addresses'
import { formatNbr, formatSol } from './curve'
import type { ActivityRecord } from './history'

/**
 * A confirmed buy/sell as stored in `public/data/klyth-trades.json`.
 *
 * Raw amounts are strings so the 64-bit values survive JSON without losing
 * precision. Prices and supplies are derived in the browser, which keeps the
 * snapshot small and lets the chart change timeframe without a new download.
 */
export type OhlcTrade = {
  signature: string
  kind: 'buy' | 'sell'
  slot: number
  blockTime: number | null
  wallet: string
  amountRaw: string
  solRaw: string | null
}

export type OhlcSnapshot = {
  version: number
  mint: string
  program: string
  generatedAt: string
  trades: OhlcTrade[]
}

/**
 * The file is tiny and the Pages deploy refreshes it every 15 minutes. A
 * one-minute bucket (plus the hook's minute refresh) picks up a new deploy
 * quickly without re-downloading on every poll.
 */
const CACHE_BUCKET_MS = 60 * 1_000

export function snapshotUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  const bucket = Math.floor(Date.now() / CACHE_BUCKET_MS)
  return `${base}data/klyth-trades.json?v=${bucket}`
}

function isSnapshotTrade(value: unknown): value is OhlcTrade {
  if (!value || typeof value !== 'object') {
    return false
  }
  const trade = value as Partial<OhlcTrade>
  return (
    typeof trade.signature === 'string' &&
    (trade.kind === 'buy' || trade.kind === 'sell') &&
    typeof trade.slot === 'number' &&
    typeof trade.wallet === 'string' &&
    typeof trade.amountRaw === 'string' &&
    (trade.solRaw === null || typeof trade.solRaw === 'string') &&
    (trade.blockTime === null || typeof trade.blockTime === 'number')
  )
}

/**
 * Loads the snapshot if the current build has one. A missing file is not an
 * error: the chart falls back to the live activity window.
 */
export async function fetchOhlcSnapshot(
  signal?: AbortSignal,
): Promise<OhlcSnapshot | null> {
  const response = await fetch(snapshotUrl(), { signal, cache: 'default' })
  if (!response.ok) {
    return null
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  const payload = (await response.json()) as Partial<OhlcSnapshot>
  if (!payload || !Array.isArray(payload.trades)) {
    return null
  }
  if (typeof payload.mint === 'string' && payload.mint !== MINT_ADDRESS) {
    return null
  }

  return {
    version: typeof payload.version === 'number' ? payload.version : 1,
    mint: typeof payload.mint === 'string' ? payload.mint : MINT_ADDRESS,
    program: typeof payload.program === 'string' ? payload.program : '',
    generatedAt:
      typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
    trades: payload.trades.filter(isSnapshotTrade),
  }
}

/** Converts snapshot rows into the activity shape the chart already consumes. */
export function snapshotToActivity(snapshot: OhlcSnapshot): ActivityRecord[] {
  const records: ActivityRecord[] = []

  for (const trade of snapshot.trades) {
    let amountRaw: bigint
    let solRaw: bigint | null
    try {
      amountRaw = BigInt(trade.amountRaw)
      solRaw = trade.solRaw === null ? null : BigInt(trade.solRaw)
    } catch {
      continue
    }

    records.push({
      signature: trade.signature,
      kind: trade.kind,
      slot: trade.slot,
      blockTime: trade.blockTime,
      wallet: trade.wallet,
      amountRaw: amountRaw.toString(),
      amount: formatNbr(amountRaw, 4),
      solRaw: solRaw === null ? null : solRaw.toString(),
      sol: solRaw === null ? null : formatSol(solRaw, 9),
      status: 'confirmed',
      demo: isDemoWallet(trade.wallet),
    })
  }

  return records
}

/**
 * Merges activity groups and keeps the newest row per signature. Later groups
 * win, so live rows refresh anything the snapshot already contains.
 *
 * Result is newest-first, matching `fetchActivity`.
 */
export function mergeActivityRecords(
  ...groups: ReadonlyArray<ReadonlyArray<ActivityRecord>>
): ActivityRecord[] {
  const bySignature = new Map<string, ActivityRecord>()

  for (const group of groups) {
    for (const record of group) {
      bySignature.set(record.signature, record)
    }
  }

  return [...bySignature.values()].sort(
    (left, right) =>
      (right.blockTime ?? 0) - (left.blockTime ?? 0) || right.slot - left.slot,
  )
}
