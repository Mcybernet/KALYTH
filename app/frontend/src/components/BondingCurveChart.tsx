import { useEffect, useMemo, useState } from 'react'
import ReactApexChart from 'react-apexcharts'
import type { ApexOptions } from 'apexcharts'
import { CandlestickChart, LineChart } from 'lucide-react'
import { CandleChart } from './CandleChart'
import {
  TIMEFRAMES,
  buildTimeCandles,
  formatChartPrice as formatPrice,
  type TimeframeId,
} from '../lib/candles'

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
  /** Number of newest activity records the candles are built from. */
  historyWindow?: number | null
}

type ChartRange = {
  id: RangeId
  label: string
  start: number
  end: number
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

/** Pick just enough decimal places so neighbouring ticks stay distinguishable. */
function axisDecimals(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (!Number.isFinite(span) || span <= 0) {
    return 9
  }
  return Math.min(9, Math.max(6, Math.ceil(-Math.log10(span)) + 2))
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
  historyWindow = null,
}: BondingCurveChartProps) {
  const [mode, setMode] = useState<ChartMode>('curve')
  const [rangeId, setRangeId] = useState<RangeId>('live')
  const [timeframeId, setTimeframeId] = useState<TimeframeId>('1D')
  const compact = useIsCompact()

  const timeframe = TIMEFRAMES.find((item) => item.id === timeframeId) ?? TIMEFRAMES[3]

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

  const candleSet = useMemo(
    () => buildTimeCandles(trades, timeframe.seconds),
    [trades, timeframe.seconds],
  )

  const historyNote =
    historyWindow !== null && historyWindow > 0
      ? ` History is limited to the latest ${historyWindow} activity records; older candles are not loaded.`
      : ''

  const series = useMemo(
    () => [
      { name: 'Bonding curve', type: 'area' as const, data: curvePoints },
      { name: 'Executions', type: 'scatter' as const, data: executionMarkers },
      { name: 'Live price', type: 'scatter' as const, data: positionMarker },
    ],
    [curvePoints, executionMarkers, positionMarker],
  )

  const options = useMemo<ApexOptions>(() => {
    const tooltipPrice = (value: number) =>
      Number.isFinite(value) ? `${formatPrice(value)} SOL` : String(value)

    return {
      chart: {
        id: 'klyth-bonding-curve',
        type: 'area',
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
      grid: {
        borderColor: GRID_COLOR,
        strokeDashArray: 3,
        padding: { left: 8, right: 12, top: 8, bottom: 0 },
      },
      xaxis: {
        type: 'numeric',
        min: domain.start,
        max: domain.end,
        tickAmount: compact ? 4 : 5,
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
          formatter: (value: string) => formatSupplyTick(Number(value), domainSpan),
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        title: {
          text: 'KLYTH SOLD',
          style: { color: AXIS_COLOR, fontSize: '9px', fontWeight: 600 },
        },
      },
      yaxis: {
        min: yMin,
        max: yMax,
        tickAmount: compact ? 4 : 5,
        labels: {
          style: { colors: AXIS_COLOR, fontSize: compact ? '9px' : '10px' },
          formatter: (value: number) =>
            Number.isFinite(value) ? value.toFixed(tickDecimals) : '',
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
            `${formatSupply(Number(value))} KLYTH sold`,
        },
        y: {
          formatter: (value: number) => tooltipPrice(value),
        },
      },
      annotations: {
        xaxis:
          preview !== null
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
          livePrice !== null && liveInDomain
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
        text: 'Waiting for on-chain state…',
        style: { color: AXIS_COLOR, fontSize: '13px' },
      },
    }
  }, [
    compact,
    domain.start,
    domain.end,
    domainSpan,
    yMin,
    yMax,
    tickDecimals,
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
          <div
            className="curve-chart__ranges curve-chart__ranges--tf"
            role="group"
            aria-label="Candle timeframe"
          >
            {TIMEFRAMES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`curve-chart__range ${
                  item.id === timeframeId ? 'curve-chart__range--active' : ''
                }`}
                aria-pressed={item.id === timeframeId}
                onClick={() => setTimeframeId(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="curve-chart__canvas" data-chart-mode={mode}>
        {mode === 'curve' ? (
          <ReactApexChart
            type="area"
            height={chartHeight}
            series={series}
            options={options}
          />
        ) : (
          <CandleChart
            candles={candleSet.candles}
            timeframe={timeframe}
            height={chartHeight}
          />
        )}
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
            : candleSet.candles.length > 0
              ? `${candleSet.candles.length} ${timeframe.label} candles (UTC) from ${candleSet.tradeCount} confirmed trades. Open/close are the first and last real executions in each interval; high/low are the extremes.${
                  candleSet.skipped > 0
                    ? ` ${candleSet.skipped} trade${
                        candleSet.skipped === 1 ? '' : 's'
                      } without a block time excluded.`
                    : ''
                }${historyNote}`
              : `No confirmed buy/sell trades yet. Candles appear after the first on-chain trade.${historyNote}`}
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
