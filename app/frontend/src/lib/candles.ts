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

export type CandleTrade = {
  price: number
  blockTime?: number | null
}

export type TimeCandle = {
  /** UTC bucket start, in seconds. */
  time: number
  open: number
  high: number
  low: number
  close: number
}

export function bucketStart(seconds: number, interval: number): number {
  // Anchor weekly candles to Monday 00:00 UTC.
  if (interval === 604_800) {
    return Math.floor((seconds + WEEK_OFFSET) / interval) * interval - WEEK_OFFSET
  }
  return Math.floor(seconds / interval) * interval
}

/**
 * Aggregates confirmed executions into time-based OHLC candles. Buckets without
 * trades are left out instead of being filled with invented prices.
 */
export function buildTimeCandles(
  trades: CandleTrade[],
  interval: number,
): { candles: TimeCandle[]; tradeCount: number; skipped: number } {
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

  return {
    candles: Array.from(byBucket.values()).sort((left, right) => left.time - right.time),
    tradeCount: usable.length,
    skipped: trades.length - usable.length,
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

/** Candle timestamps are bucketed and displayed in UTC, like exchange charts. */
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
    return `${day} · 00:00 UTC`
  }
  const clock = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
  return `${day} · ${clock} UTC`
}
