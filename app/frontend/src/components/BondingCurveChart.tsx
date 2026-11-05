import { useEffect, useMemo, useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { CandlestickChart, LineChart } from 'lucide-react'

const DEFAULT_INITIAL_PRICE = 0.000001
const DEFAULT_SLOPE = 0.00000000000008
const DEFAULT_MAX_SOLD = 50_000_000

const PRICE_COLOR = '#e0a64b'
const POSITION_COLOR = '#f4d79a'
const UP_COLOR = '#7fd6a4'
const DOWN_COLOR = '#ff7a6e'
const AXIS_COLOR = '#9c9488'
const GRID_COLOR = 'rgba(42, 38, 32, 0.7)'
const SURFACE_COLOR = '#050506'
const MAX_MARKERS = 300

type ChartMode = 'curve' | 'candles'
type RangeId = 'live' | 'trade' | 'p1' | 'p10' | 'full'

export type ChartTrade = {
  /** Whole KLYTH sold after this trade. */
  supply: number
  /** Execution price in SOL per whole KLYTH. */
  price: number
  kind: 'buy' | 'sell'
  /** Unix seconds from the confirmed transaction. */
  blockTime?: number | null
  slot?: number
}

type BondingCurveChartProps = {
  soldSupply?: number | null
  maxSoldSupply?: number | null
  /** Marginal price of one KLYTH at zero sold supply, in SOL. */
  initialPrice?: number | null
  /** Price increase per KLYTH sold, in SOL. */
  slope?: number | null
  /** Absolute KLYTH amount of the trade currently being composed. */
  previewAmount?: number | null
  previewMode?: 'buy' | 'sell'
  /** Real execution prices, plotted as markers on top of the chart. */
  trades?: ChartTrade[]
}

type ChartRange = {
  id: RangeId
  label: string
  start: number
  end: number
}

type CandlePoint = {
  /** Unique category key; the visible label comes from `labels`. */
  x: string
  y: [number, number, number, number]
}

type CandleBuild = {
  points: CandlePoint[]
  labels: string[]
  timeMode: boolean
  tradeCount: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatSupply(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (absolute >= 10_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  if (absolute >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  if (absolute >= 0.01) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  if (absolute === 0) {
    return '0'
  }
  return value.toPrecision(3)
}

/** Compact but precise enough that neighbouring buckets stay distinct. */
function formatSupplyTick(value: number, span: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (span >= 5_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`
  }
  if (span >= 500_000) {
    return `${(value / 1_000_000).toFixed(3)}M`
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatPrice(value: number): string {
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

/** Pick just enough decimal places so neighbouring ticks stay distinguishable. */
function axisDecimals(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (!Number.isFinite(span) || span <= 0) {
    return 9
  }
  return Math.min(9, Math.max(6, Math.ceil(-Math.log10(span)) + 2))
}

function formatCandleLabel(timeSeconds: number, spanSeconds: number): string {
  const date = new Date(timeSeconds * 1000)
  if (spanSeconds >= 172_800) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (spanSeconds >= 86_400) {
    return `${date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} ${date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }
  if (spanSeconds < 1_800) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Builds candlesticks from confirmed buy/sell executions only.
 *
 * Trades are kept in execution order and split into `target` contiguous groups,
 * so the chart always has a natural number of evenly spaced candles instead of a
 * handful of oversized bars. Within a group, open/close are the first and last
 * real execution prices and high/low are the real extremes. No synthetic bars
 * are invented for periods without trades.
 */
function buildCandles(trades: ChartTrade[], target: number): CandleBuild {
  const usable = trades.filter(
    (trade) =>
      Number.isFinite(trade.supply) &&
      Number.isFinite(trade.price) &&
      trade.price > 0,
  )

  if (usable.length === 0) {
    return { points: [], labels: [], timeMode: false, tradeCount: 0 }
  }

  const timeMode = usable.every(
    (trade) =>
      typeof trade.blockTime === 'number' &&
      Number.isFinite(trade.blockTime) &&
      trade.blockTime > 0,
  )

  const firstTime = timeMode ? (usable[0].blockTime as number) : 0
  const lastTime = timeMode ? (usable[usable.length - 1].blockTime as number) : 0
  const spanSeconds = Math.max(lastTime - firstTime, 1)

  const count = Math.min(target, usable.length)
  const base = Math.floor(usable.length / count)
  const extra = usable.length % count

  const points: CandlePoint[] = []
  const labels: string[] = []
  let cursor = 0

  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0)
    const group = usable.slice(cursor, cursor + size)
    cursor += size

    let high = group[0].price
    let low = group[0].price
    for (const trade of group) {
      high = Math.max(high, trade.price)
      low = Math.min(low, trade.price)
    }

    points.push({
      x: String(index),
      y: [group[0].price, high, low, group[group.length - 1].price],
    })

    if (timeMode) {
      labels.push(formatCandleLabel(group[group.length - 1].blockTime as number, spanSeconds))
    } else {
      labels.push(`#${index + 1}`)
    }
  }

  return { points, labels, timeMode, tradeCount: usable.length }
}

function useIsCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)')
    const handleChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return compact
}

export function BondingCurveChart({
  soldSupply = null,
  maxSoldSupply = null,
  initialPrice = null,
  slope = null,
  previewAmount = null,
  previewMode = 'buy',
  trades = [],
}: BondingCurveChartProps) {
  const [mode, setMode] = useState<ChartMode>('curve')
  const [rangeId, setRangeId] = useState<RangeId>('live')
  const compact = useIsCompact()

  const initial = initialPrice ?? DEFAULT_INITIAL_PRICE
  const gradient = slope ?? DEFAULT_SLOPE
  const maxSold =
    maxSoldSupply !== null && Number.isFinite(maxSoldSupply) && maxSoldSupply > 0
      ? maxSoldSupply
      : DEFAULT_MAX_SOLD

  const priceAt = (sold: number) => initial + gradient * sold

  const position =
    soldSupply !== null && Number.isFinite(soldSupply) ? clamp(soldSupply, 0, maxSold) : null
  const livePrice = position !== null ? priceAt(position) : null

  const preview = useMemo(() => {
    if (
      previewAmount === null ||
      !Number.isFinite(previewAmount) ||
      previewAmount <= 0 ||
      position === null
    ) {
      return null
    }
    const start = previewMode === 'sell' ? Math.max(0, position - previewAmount) : position
    const end =
      previewMode === 'sell' ? position : Math.min(maxSold, position + previewAmount)
    if (end <= start) {
      return null
    }
    return { start, end, amount: end - start }
  }, [previewAmount, previewMode, position, maxSold])

  const ranges = useMemo<ChartRange[]>(() => {
    const focus = position ?? 0
    const liveSpan = Math.max(maxSold * 0.002, focus * 0.08, maxSold * 0.000002)
    const liveStart = Math.max(0, focus - liveSpan)
    const liveEnd = Math.min(maxSold, focus + liveSpan)

    const list: ChartRange[] = [
      {
        id: 'live',
        label: 'Live',
        start: liveStart,
        end: Math.max(liveEnd, liveStart + maxSold * 0.000004),
      },
    ]

    if (preview !== null) {
      const span = Math.max(
        preview.amount * 4,
        maxSold * 0.0004,
        focus * 0.08,
        maxSold * 0.000002,
      )
      const start = Math.max(0, focus - span)
      const end = Math.min(maxSold, focus + span)
      list.push({
        id: 'trade',
        label: 'Your trade',
        start,
        end: Math.max(end, start + maxSold * 0.000004),
      })
    }

    list.push(
      { id: 'p1', label: '1%', start: 0, end: maxSold * 0.01 },
      { id: 'p10', label: '10%', start: 0, end: maxSold * 0.1 },
      { id: 'full', label: 'Full', start: 0, end: maxSold },
    )

    return list
  }, [maxSold, position, preview])

  const previewActive = preview !== null

  useEffect(() => {
    setRangeId(previewActive ? 'trade' : 'live')
  }, [previewActive])

  useEffect(() => {
    if (!ranges.some((range) => range.id === rangeId)) {
      setRangeId('live')
    }
  }, [ranges, rangeId])

  const domain = ranges.find((range) => range.id === rangeId) ?? ranges[0]
  const domainSpan = Math.max(domain.end - domain.start, 1e-9)

  const rawPriceStart = priceAt(domain.start)
  const rawPriceEnd = priceAt(domain.end)
  const priceSpan =
    Math.abs(rawPriceEnd - rawPriceStart) || Math.max(Math.abs(rawPriceStart) * 0.2, 1e-9)
  const yMin = Math.max(0, Math.min(rawPriceStart, rawPriceEnd) - priceSpan * 0.14)
  const yMax = Math.max(rawPriceStart, rawPriceEnd) + priceSpan * 0.14
  const tickDecimals = axisDecimals(yMin, yMax)

  const pointCount = compact ? 56 : 96

  const curvePoints = useMemo(
    () =>
      Array.from({ length: pointCount }, (_, index) => {
        const sold = domain.start + (domainSpan * index) / (pointCount - 1)
        return { x: sold, y: initial + gradient * sold }
      }),
    [domain.start, domainSpan, pointCount, initial, gradient],
  )

  const executionMarkers = useMemo(
    () =>
      trades
        .filter(
          (trade) =>
            Number.isFinite(trade.supply) &&
            Number.isFinite(trade.price) &&
            trade.price > 0 &&
            trade.supply >= domain.start &&
            trade.supply <= domain.end,
        )
        .slice(-MAX_MARKERS)
        .map((trade) => ({
          x: trade.supply,
          y: trade.price,
          fillColor: trade.kind === 'buy' ? UP_COLOR : DOWN_COLOR,
        })),
    [trades, domain.start, domain.end],
  )

  const liveInDomain =
    position !== null && position >= domain.start && position <= domain.end

  const positionMarker = useMemo(
    () =>
      liveInDomain && position !== null
        ? [{ x: position, y: initial + gradient * position }]
        : [],
    [liveInDomain, position, initial, gradient],
  )

  const candles = useMemo(
    () => buildCandles(trades, compact ? 18 : 34),
    [trades, compact],
  )

  const candleBounds = useMemo(() => {
    const values = candles.points.flatMap((candle) => candle.y)
    if (livePrice !== null) {
      values.push(livePrice)
    }
    if (values.length === 0) {
      return { min: undefined, max: undefined, decimals: 9 }
    }
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max((max - min) * 0.16, max * 0.02, 1e-9)
    const paddedMin = Math.max(0, min - pad)
    const paddedMax = max + pad
    return {
      min: paddedMin,
      max: paddedMax,
      decimals: axisDecimals(paddedMin, paddedMax),
    }
  }, [candles.points, livePrice])

  const series = useMemo(() => {
    if (mode === 'curve') {
      return [
        { name: 'Bonding curve', type: 'area' as const, data: curvePoints },
        { name: 'Executions', type: 'scatter' as const, data: executionMarkers },
        { name: 'Live price', type: 'scatter' as const, data: positionMarker },
      ]
    }
    return [{ name: 'Confirmed trades', type: 'candlestick' as const, data: candles.points }]
  }, [mode, curvePoints, executionMarkers, positionMarker, candles.points])

  const options = useMemo<ApexOptions>(() => {
    const tooltipPrice = (value: number) =>
      Number.isFinite(value) ? `${formatPrice(value)} SOL` : String(value)

    const shared: ApexOptions = {
      chart: {
        id: 'klyth-bonding-curve',
        type: mode === 'curve' ? 'area' : 'candlestick',
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, speed: 260 },
        fontFamily:
          "'IBM Plex Mono', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        foreColor: AXIS_COLOR,
      },
      theme: { mode: 'dark' },
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: {
        borderColor: GRID_COLOR,
        strokeDashArray: 3,
        padding: { left: 8, right: 12, top: 8, bottom: 0 },
      },
      xaxis: {
        type: mode === 'curve' ? 'numeric' : 'category',
        min: mode === 'curve' ? domain.start : undefined,
        max: mode === 'curve' ? domain.end : undefined,
        tickAmount: mode === 'curve' ? (compact ? 4 : 5) : compact ? 3 : 5,
        crosshairs: {
          show: true,
          width: 1,
          position: 'back',
          stroke: { color: 'rgba(224, 166, 75, 0.28)', width: 1, dashArray: 3 },
        },
        labels: {
          rotate: 0,
          hideOverlappingLabels: true,
          style: { colors: AXIS_COLOR, fontSize: compact ? '9px' : '10px' },
          formatter:
            mode === 'curve'
              ? (value: string) => formatSupplyTick(Number(value), domainSpan)
              : (value: string) => candles.labels[Number(value)] ?? '',
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        title: {
          text: mode === 'curve' ? 'KLYTH SOLD' : candles.timeMode ? 'TRADE TIME' : 'TRADE SEQUENCE',
          style: { color: AXIS_COLOR, fontSize: '9px', fontWeight: 600 },
        },
      },
      yaxis: {
        min: mode === 'curve' ? yMin : candleBounds.min,
        max: mode === 'curve' ? yMax : candleBounds.max,
        tickAmount: compact ? 4 : 5,
        labels: {
          style: { colors: AXIS_COLOR, fontSize: compact ? '9px' : '10px' },
          formatter: (value: number) =>
            Number.isFinite(value)
              ? value.toFixed(mode === 'curve' ? tickDecimals : candleBounds.decimals)
              : '',
        },
        title: {
          text: 'PRICE · SOL',
          style: { color: AXIS_COLOR, fontSize: '9px', fontWeight: 600 },
        },
      },
      tooltip: {
        theme: 'dark',
        shared: false,
        intersect: false,
        x: {
          formatter: (value: number | string) =>
            mode === 'curve'
              ? `${formatSupply(Number(value))} KLYTH sold`
              : candles.labels[Number(value)] ?? String(value),
        },
        y: {
          formatter: (value: number) => tooltipPrice(value),
        },
      },
      annotations: {
        xaxis:
          mode === 'curve' && preview !== null
            ? [
                {
                  x: preview.start,
                  x2: preview.end,
                  fillColor:
                    previewMode === 'sell'
                      ? 'rgba(255, 122, 110, 0.12)'
                      : 'rgba(127, 214, 164, 0.12)',
                  borderColor: 'transparent',
                  label: {
                    text: `${previewMode === 'sell' ? 'Sell' : 'Buy'} ${formatSupply(
                      preview.amount,
                    )} KLYTH`,
                    style: {
                      background: '#0a0a0c',
                      color: previewMode === 'sell' ? DOWN_COLOR : UP_COLOR,
                      fontSize: '10px',
                    },
                  },
                },
              ]
            : undefined,
        yaxis:
          livePrice !== null && (mode === 'candles' || liveInDomain)
            ? [
                {
                  y: livePrice,
                  borderColor: 'rgba(244, 215, 154, 0.5)',
                  strokeDashArray: 4,
                },
              ]
            : undefined,
      },
      noData: {
        text:
          mode === 'curve'
            ? 'Waiting for on-chain state…'
            : 'No confirmed buy/sell trades yet.',
        style: { color: AXIS_COLOR, fontSize: '13px' },
      },
    }

    if (mode === 'curve') {
      return {
        ...shared,
        colors: [PRICE_COLOR, UP_COLOR, POSITION_COLOR],
        stroke: { curve: 'straight', width: [2, 0, 0] },
        fill: {
          type: ['gradient', 'solid', 'solid'],
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.22,
            opacityTo: 0.01,
            stops: [0, 92, 100],
          },
        },
        markers: {
          size: [0, 3, 6],
          strokeWidth: [0, 0, 2],
          strokeColors: ['transparent', 'transparent', SURFACE_COLOR],
          hover: { size: 6 },
        },
      }
    }

    return {
      ...shared,
      colors: [UP_COLOR],
      plotOptions: {
        bar: {
          // Fixed pixel width keeps every candle thin no matter how few trades exist.
          columnWidth: compact ? 4 : 5,
        },
        candlestick: {
          colors: {
            upward: UP_COLOR,
            downward: DOWN_COLOR,
          },
          wick: {
            useFillColor: true,
          },
        },
      },
      stroke: { width: 1 },
      fill: { type: 'solid' },
      markers: { size: 0 },
    }
  }, [
    mode,
    compact,
    domain.start,
    domain.end,
    domainSpan,
    yMin,
    yMax,
    tickDecimals,
    candleBounds,
    candles.labels,
    candles.timeMode,
    preview,
    previewMode,
    livePrice,
    liveInDomain,
  ])

  const chartHeight = compact ? 300 : 380

  return (
    <div className="curve-chart">
      <div className="curve-chart__toolbar">
        <div className="segmented segmented--compact" role="group" aria-label="Chart mode">
          <button
            type="button"
            className={`segmented__item ${mode === 'curve' ? 'segmented__item--active' : ''}`}
            aria-pressed={mode === 'curve'}
            onClick={() => setMode('curve')}
          >
            <LineChart size={14} aria-hidden="true" />
            Curve
          </button>
          <button
            type="button"
            className={`segmented__item ${mode === 'candles' ? 'segmented__item--active' : ''}`}
            aria-pressed={mode === 'candles'}
            onClick={() => setMode('candles')}
          >
            <CandlestickChart size={14} aria-hidden="true" />
            Candles
          </button>
        </div>

        {mode === 'curve' ? (
          <div className="curve-chart__ranges" role="group" aria-label="Chart range">
            {ranges.map((range) => (
              <button
                key={range.id}
                type="button"
                className={`curve-chart__range ${
                  range.id === rangeId ? 'curve-chart__range--active' : ''
                }`}
                aria-pressed={range.id === rangeId}
                onClick={() => setRangeId(range.id)}
              >
                {range.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="badge badge--neutral">Confirmed trades only</span>
        )}
      </div>

      <div className="curve-chart__canvas" data-chart-mode={mode}>
        <ReactApexChart
          key={mode}
          type={mode === 'curve' ? 'area' : 'candlestick'}
          height={chartHeight}
          series={series}
          options={options}
        />
      </div>

      <div className="curve-chart__footer">
        <p className="curve-chart__note">
          {mode === 'curve'
            ? `P(x) = ${formatPrice(initial)} + ${gradient.toExponential(
                2,
              )} × sold. Showing ${formatSupply(domain.start)}–${formatSupply(
                domain.end,
              )} KLYTH.${
                executionMarkers.length > 0
                  ? ' Dots are confirmed buy and sell executions.'
                  : ' No confirmed executions in this range yet.'
              }`
            : candles.points.length > 0
              ? `${candles.points.length} candles from ${candles.tradeCount} confirmed trades. Each candle groups consecutive executions; open/close are the first and last prices, high/low are the extremes.`
              : 'No confirmed buy/sell trades yet. Candles appear after the first on-chain trade.'}
        </p>
        <p className="curve-chart__position">
          <span className="curve-chart__position-dot" aria-hidden="true" />
          {position !== null
            ? `${formatSupply(position)} KLYTH sold · ${
                livePrice !== null ? formatPrice(livePrice) : '—'
              } SOL`
            : 'Waiting for on-chain state'}
        </p>
      </div>
    </div>
  )
}
