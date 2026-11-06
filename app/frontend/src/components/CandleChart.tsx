import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  formatCandleTime,
  formatChartPrice,
  pricePrecision,
  type TimeCandle,
  type Timeframe,
} from '../lib/candles'

type CandleChartProps = {
  candles: TimeCandle[]
  timeframe: Timeframe
  height: number
}

type Hover = {
  candle: TimeCandle
  x: number
  y: number
  flipX: boolean
  flipY: boolean
}

const UP_COLOR = '#26a69a'
const DOWN_COLOR = '#ef5350'
const AXIS_COLOR = '#9c9488'
const GRID_COLOR = 'rgba(60, 54, 44, 0.32)'
const FONT =
  "'IBM Plex Mono', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

/**
 * Fits the candles without stretching a handful of bars across the whole pane:
 * sparse datasets get a flat empty time window around them instead.
 */
function fitView(chart: IChartApi, candles: TimeCandle[]) {
  if (candles.length === 0) {
    chart.timeScale().fitContent()
    return
  }

  // Reserve empty bars on both sides so a couple of candles do not become slabs.
  const span = Math.max(candles.length + 4, 50)
  const start = -Math.round((span - candles.length) / 2)
  chart.timeScale().setVisibleLogicalRange({ from: start, to: start + span - 1 })
  chart.priceScale('right').applyOptions({ autoScale: true })
}

export function CandleChart({ candles, timeframe, height }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceLineRef = useRef<IPriceLine | null>(null)
  const candleMapRef = useRef<Map<number, TimeCandle>>(new Map())
  const intervalRef = useRef(timeframe.seconds)
  const viewKeyRef = useRef<string | null>(null)

  const [hover, setHover] = useState<Hover | null>(null)

  intervalRef.current = timeframe.seconds

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: AXIS_COLOR,
        fontSize: 11,
        fontFamily: FONT,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(224, 166, 75, 0.38)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#17150f',
        },
        horzLine: {
          color: 'rgba(224, 166, 75, 0.38)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#17150f',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(60, 54, 44, 0.7)',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: 'rgba(60, 54, 44, 0.7)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 9,
        minBarSpacing: 3,
      },
      localization: {
        priceFormatter: formatChartPrice,
        timeFormatter: (time: number | string) =>
          formatCandleTime(Number(time), intervalRef.current),
      },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderVisible: true,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: 9, minMove: 1e-9 },
    })

    const handleMove = (param: MouseEventParams) => {
      if (!param.point || param.time === undefined) {
        setHover(null)
        return
      }
      const candle = candleMapRef.current.get(Number(param.time))
      if (!candle) {
        setHover(null)
        return
      }
      setHover({
        candle,
        x: param.point.x,
        y: param.point.y,
        flipX: param.point.x > container.clientWidth - 180,
        flipY: param.point.y > container.clientHeight - 140,
      })
    }

    chart.subscribeCrosshairMove(handleMove)
    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.unsubscribeCrosshairMove(handleMove)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      priceLineRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) {
      return
    }

    const map = new Map<number, TimeCandle>()
    const data: CandlestickData<UTCTimestamp>[] = candles.map((candle) => {
      map.set(candle.time, candle)
      return {
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }
    })

    candleMapRef.current = map
    series.setData(data)
    setHover(null)

    const precision = pricePrecision(candles)
    series.applyOptions({
      priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
    })

    if (priceLineRef.current) {
      series.removePriceLine(priceLineRef.current)
      priceLineRef.current = null
    }

    const last = candles[candles.length - 1]
    if (last) {
      priceLineRef.current = series.createPriceLine({
        price: last.close,
        color: 'rgba(224, 166, 75, 0.55)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Last',
      })
    }

    // Keep bodies proportional: never hairline-thin, never slabs. Only refit
    // when the timeframe changes, so a data refresh keeps the user's view.
    if (viewKeyRef.current !== timeframe.id) {
      fitView(chart, candles)
      viewKeyRef.current = timeframe.id
    }
  }, [candles, timeframe])

  const reset = () => {
    const chart = chartRef.current
    if (!chart) {
      return
    }
    fitView(chart, candles)
  }

  const shown = hover?.candle ?? candles[candles.length - 1]
  const change =
    shown && shown.open > 0 ? ((shown.close - shown.open) / shown.open) * 100 : null

  return (
    <div className="candle-chart">
      <div className="candle-chart__legend">
        <span className="candle-chart__pair">KLYTH / SOL</span>
        <span className="candle-chart__tf">{timeframe.label}</span>
        {shown ? (
          <>
            <span className="candle-chart__time">
              {formatCandleTime(shown.time, timeframe.seconds)}
            </span>
            <span className="candle-chart__ohlc">
              <span>
                O <b>{formatChartPrice(shown.open)}</b>
              </span>
              <span>
                H <b>{formatChartPrice(shown.high)}</b>
              </span>
              <span>
                L <b>{formatChartPrice(shown.low)}</b>
              </span>
              <span>
                C <b>{formatChartPrice(shown.close)}</b>
              </span>
            </span>
            {change !== null ? (
              <span
                className={`candle-chart__change ${
                  change >= 0 ? 'candle-chart__change--up' : 'candle-chart__change--down'
                }`}
              >
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            ) : null}
          </>
        ) : (
          <span className="candle-chart__time">No candles for this timeframe</span>
        )}
        <button
          type="button"
          className="curve-chart__range candle-chart__reset"
          onClick={reset}
          title="Fit all candles"
        >
          Reset
        </button>
      </div>

      <div className="candle-chart__stage" ref={containerRef} style={{ height }}>
        {candles.length === 0 ? (
          <div className="candle-chart__empty">
            <p>No confirmed buy/sell trades yet.</p>
            <p>Candles appear after the first on-chain trade.</p>
          </div>
        ) : null}
        {hover ? (
          <div
            className="candle-chart__tooltip"
            style={{
              left: hover.x,
              top: hover.y,
              transform: `translate(${
                hover.flipX ? 'calc(-100% - 10px)' : '10px'
              }, ${hover.flipY ? 'calc(-100% - 10px)' : '10px'})`,
            }}
          >
            <div className="candle-chart__tooltip-time">
              {formatCandleTime(hover.candle.time, timeframe.seconds)}
            </div>
            {(
              [
                ['O', hover.candle.open],
                ['H', hover.candle.high],
                ['L', hover.candle.low],
                ['C', hover.candle.close],
              ] as const
            ).map(([label, value]) => (
              <div className="candle-chart__tooltip-row" key={label}>
                <span>{label}</span>
                <span>{formatChartPrice(value)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
