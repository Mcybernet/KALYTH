export type TimeframeId = '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W'

export type Timeframe = {
  id: TimeframeId
  label: string
  seconds: number
}

export const TIMEFRAMES: readonly Timeframe[] = [
  { id: '1m', label: '1m', seconds: 60 },
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '1H', label: '1H', seconds: 3_600 },
  { id: '4H', label: '4H', seconds: 14_400 },
  { id: '1D', label: '1D', seconds: 86_400 },
  { id: '1W', label: '1W', seconds: 604_800 },
]

const WEEK_OFFSET = 3 * 86_400

/**
 * Older snapshots can span months. Fill at most this many empty buckets (the
 * most recent ones) so an old trade never makes the chart generate a huge flat
 * history. Real candles are always kept.
 */
const MAX_FILLED_CANDLES = 6_000

/**
 * WIB is UTC+7 all year (Indonesia has no daylight saving). Candle timestamps
 * are shifted into WIB wall-clock time because lightweight-charts renders
 * UTCTimestamp values in UTC; shifting makes the axis read as local time.
 */
const WIB_OFFSET_SECONDS = 7 * 60 * 60

export type CandleTrade = {
  price: number
  blockTime?: number | null
}

export type TimeCandle = {
  /** WIB wall-clock bucket start, stored as UTC seconds for the chart. */
  time: number
  open: number
  high: number
  low: number
  close: number
}

export type CandleUpdatePlan =
  | { kind: 'none' }
  | { kind: 'reset' }
  | { kind: 'incremental'; from: number }

function sameCandle(left: TimeCandle, right: TimeCandle): boolean {
  return (
    left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close
  )
}

/**
 * Decides how the live chart should absorb a new candle list. Appending and
 * rewriting the running candle can use `series.update()`; anything that changes
 * older history or shortens the list needs a full `series.setData()`.
 */
export function planCandleUpdate(
  previous: TimeCandle[],
  next: TimeCandle[],
): CandleUpdatePlan {
  if (previous.length === 0) {
    return next.length === 0 ? { kind: 'none' } : { kind: 'reset' }
  }
  if (next.length < previous.length) {
    return { kind: 'reset' }
  }

  let shared = 0
  while (shared < previous.length && sameCandle(previous[shared], next[shared])) {
    shared += 1
  }

  if (shared === previous.length) {
    return next.length === previous.length
      ? { kind: 'none' }
      : { kind: 'incremental', from: previous.length }
  }

  // Only the newest candle may be revised in place. Its timestamp must stay the
  // same, otherwise `update()` would append instead of replacing the last bar.
  if (
    shared === previous.length - 1 &&
    next[previous.length - 1].time === previous[previous.length - 1].time
  ) {
    return { kind: 'incremental', from: previous.length - 1 }
  }

  return { kind: 'reset' }
}

export function bucketStart(seconds: number, interval: number): number {
  // Shift the real UTC timestamp into WIB wall-clock time first, so daily and
  // weekly candles are anchored to midnight in Jakarta, not midnight UTC.
  const local = seconds + WIB_OFFSET_SECONDS
  if (interval === 604_800) {
    return (
      Math.floor((local + WEEK_OFFSET) / interval) * interval - WEEK_OFFSET
    )
  }
  return Math.floor(local / interval) * interval
}

/**
 * Aggregates confirmed executions into time-based OHLC candles.
 *
 * Empty buckets between the first and last trade are filled with a flat candle
 * at the previous close so the chart has no holes. Filled candles are not real
 * executions and are reported separately via `filled`. Set `fillGaps` to false
 * to keep only buckets that contain a trade.
 */
export function buildTimeCandles(
  trades: CandleTrade[],
  interval: number,
  fillGaps = true,
): { candles: TimeCandle[]; tradeCount: number; skipped: number; filled: number } {
  const usable = trades
    .map((trade, index) => ({ trade, index }))
    .filter(
      ({ trade }) =>
        Number.isFinite(trade.price) &&
        trade.price > 0 &&
        typeof trade.blockTime === 'number' &&
        Number.isFinite(trade.blockTime) &&
        trade.blockTime > 0,
    )
    .sort(
      (left, right) =>
        (left.trade.blockTime as number) - (right.trade.blockTime as number) ||
        left.index - right.index,
    )

  const byBucket = new Map<number, TimeCandle>()

  for (const { trade } of usable) {
    const time = bucketStart(trade.blockTime as number, interval)
    const candle = byBucket.get(time)

    if (candle) {
      candle.high = Math.max(candle.high, trade.price)
      candle.low = Math.min(candle.low, trade.price)
      candle.close = trade.price
    } else {
      byBucket.set(time, {
        time,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
      })
    }
  }

  const times = [...byBucket.keys()].sort((left, right) => left - right)
  let filled = 0
  const candles: TimeCandle[] = []

  if (!fillGaps || times.length < 2) {
    for (const time of times) {
      candles.push(byBucket.get(time) as TimeCandle)
    }
  } else {
    const firstTime = times[0]
    const lastTime = times[times.length - 1]
    const bucketCount = Math.floor((lastTime - firstTime) / interval) + 1
    // When the history is too long, fill only the newest window. The loop below
    // starts at `fillFrom`, so it never walks the discarded buckets.
    const fillFrom =
      bucketCount > MAX_FILLED_CANDLES
        ? lastTime - (MAX_FILLED_CANDLES - 1) * interval
        : firstTime

    let previous: TimeCandle | null = null
    for (const time of times) {
      const candle = byBucket.get(time) as TimeCandle
      if (previous && time > previous.time) {
        const start = Math.max(previous.time + interval, fillFrom)
        for (let empty = start; empty < time && filled < MAX_FILLED_CANDLES; empty += interval) {
          candles.push({
            time: empty,
            open: previous.close,
            high: previous.close,
            low: previous.close,
            close: previous.close,
          })
          filled += 1
        }
      }
      candles.push(candle)
      previous = candle
    }
  }

  return {
    candles,
    tradeCount: usable.length,
    skipped: trades.length - usable.length,
    filled,
  }
}

/** Enough decimals that nearby prices stay distinguishable on the axis. */
export function pricePrecision(candles: TimeCandle[]): number {
  if (candles.length === 0) {
    return 9
  }
  let min = Infinity
  let max = -Infinity
  for (const candle of candles) {
    min = Math.min(min, candle.low)
    max = Math.max(max, candle.high)
  }
  if (min === max) {
    return Math.min(12, Math.max(6, Math.ceil(-Math.log10(Math.abs(max))) + 3))
  }
  return Math.min(12, Math.max(6, Math.ceil(-Math.log10(max - min)) + 2))
}

export function formatChartPrice(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (value === 0) {
    return '0'
  }
  if (Math.abs(value) >= 0.001) {
    return value.toFixed(6)
  }
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

/** Candle timestamps are stored as WIB wall-clock time in UTC seconds. */
export function formatCandleTime(seconds: number, interval: number): string {
  const date = new Date(seconds * 1000)
  if (interval >= 604_800) {
    return `Week of ${date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })}`
  }
  const day = date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  if (interval >= 86_400) {
    return `${day} · 00:00 WIB`
  }
  const clock = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  return `${day} · ${clock} WIB`
}
