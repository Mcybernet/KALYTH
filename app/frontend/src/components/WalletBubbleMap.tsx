import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ExternalLink, Maximize2, Minus, Plus } from 'lucide-react'
import { explorerAddressUrl, shortenAddress } from '../lib/addresses'
import {
  formatHolderPercent,
  type HolderRole,
  type TokenHolder,
} from '../lib/holders'

type WalletBubbleMapProps = {
  holders: TokenHolder[]
  tradeCounts: Map<string, number>
}

const WIDTH = 1000
const HEIGHT = 640
const HUB = { x: WIDTH / 2, y: HEIGHT / 2 }
const HUB_RADIUS = 58
const MAX_BUBBLE_RADIUS = 94
const PER_RING = 6

const ROLE_COLORS: Record<HolderRole, string> = {
  burn: '#ff7a6e',
  vault: '#7fd6a4',
  treasury: '#f2c46d',
  demo: '#b9bec7',
  wallet: '#e0a64b',
}

const roleLegend: Array<{ role: HolderRole; label: string }> = [
  { role: 'wallet', label: 'Holder' },
  { role: 'vault', label: 'Curve vault' },
  { role: 'burn', label: 'Burn reserve' },
  { role: 'treasury', label: 'Treasury' },
  { role: 'demo', label: 'Demo wallet' },
]

type LayoutNode = {
  holder: TokenHolder
  x: number
  y: number
  radius: number
  color: string
}

/** A stable pseudo-random angle so the map keeps its shape between polls. */
function angleJitter(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  }
  const unit = (hash >>> 0) / 4294967295
  return (unit - 0.5) * 0.22
}

function computeNodes(holders: TokenHolder[]): LayoutNode[] {
  if (holders.length === 0) {
    return []
  }

  const maxPercent = Math.max(...holders.map((holder) => holder.percent), 0.0001)
  const maxRadius = MAX_BUBBLE_RADIUS
  const orbitBase = HUB_RADIUS + maxRadius + 42
  const ringGap = maxRadius * 1.7 + 24

  return holders.map((holder, index) => {
    const ring = Math.floor(index / PER_RING)
    const ringStart = ring * PER_RING
    const ringCount = Math.min(PER_RING, holders.length - ringStart)
    const withinRing = index - ringStart
    const spacing = (Math.PI * 2) / Math.max(ringCount, 1)
    const angle =
      -Math.PI / 2 + withinRing * spacing + angleJitter(holder.owner) * (ringCount >= 5 ? 0.5 : 1)
    const radius =
      14 + (maxRadius - 14) * Math.sqrt(Math.max(holder.percent, 0) / maxPercent)
    const orbit = orbitBase + ring * ringGap

    return {
      holder,
      x: HUB.x + Math.cos(angle) * orbit,
      y: HUB.y + Math.sin(angle) * orbit,
      radius,
      color: ROLE_COLORS[holder.role],
    }
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function WalletBubbleMap({ holders, tradeCounts }: WalletBubbleMapProps) {
  const nodes = useMemo(() => computeNodes(holders), [holders])
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })

  // React attaches wheel handlers passively, so zoom needs a native listener.
  useEffect(() => {
    const element = svgRef.current
    if (!element) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const pointerX = ((event.clientX - rect.left) / rect.width) * WIDTH
      const pointerY = ((event.clientY - rect.top) / rect.height) * HEIGHT

      setView((previous) => {
        const scale = clamp(previous.scale * Math.exp(-event.deltaY * 0.0015), 0.6, 4)
        const ratio = scale / previous.scale
        return {
          scale,
          x: pointerX - (pointerX - previous.x) * ratio,
          y: pointerY - (pointerY - previous.y) * ratio,
        }
      })
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  const activeOwner = hovered ?? selected
  const activeNode = nodes.find((node) => node.holder.owner === activeOwner) ?? null

  function zoomBy(factor: number) {
    setView((previous) => {
      const scale = clamp(previous.scale * factor, 0.6, 4)
      const ratio = scale / previous.scale
      return {
        scale,
        x: WIDTH / 2 - (WIDTH / 2 - previous.x) * ratio,
        y: HEIGHT / 2 - (HEIGHT / 2 - previous.y) * ratio,
      }
    })
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    }
    setDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const deltaX = ((event.clientX - drag.startX) / rect.width) * WIDTH
    const deltaY = ((event.clientY - drag.startY) / rect.height) * HEIGHT

    setView((previous) => ({
      ...previous,
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
    }))
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  const activeTrades = activeNode ? (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const totalTrades = useMemo(
    () => Array.from(tradeCounts.values()).reduce((sum, count) => sum + count, 0),
    [tradeCounts],
  )

  return (
    <div className="wallet-map">
      <div className="wallet-map__toolbar">
        <div className="wallet-map__legend">
          {roleLegend.map((item) => (
            <span className="wallet-map__legend-item" key={item.role}>
              <span
                className="wallet-map__legend-dot"
                style={{ background: ROLE_COLORS[item.role] }}
                aria-hidden="true"
              />
              {item.label}
            </span>
          ))}
        </div>
        <span className="wallet-map__hint">
          {totalTrades} curve trades · scroll to zoom · drag to pan
        </span>
      </div>

      <div className="wallet-map__canvas">
        <svg
          ref={svgRef}
          className={`wallet-map__svg${dragging ? ' wallet-map__svg--dragging' : ''}`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="KLYTH holder bubble map"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <defs>
            <pattern
              id="wallet-map-grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 40 0 L 0 0 0 40" className="wallet-map__grid-line" />
            </pattern>
          </defs>

          <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-grid)" />

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS + 74} className="wallet-map__orbit" />
            <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS + 154} className="wallet-map__orbit" />

            {nodes.map((node) => {
              const count = tradeCounts.get(node.holder.owner) ?? 0
              const dx = HUB.x - node.x
              const dy = HUB.y - node.y
              const length = Math.hypot(dx, dy) || 1
              const ux = dx / length
              const uy = dy / length
              const startX = node.x + ux * (node.radius + 4)
              const startY = node.y + uy * (node.radius + 4)
              const endX = HUB.x - ux * (HUB_RADIUS + 6)
              const endY = HUB.y - uy * (HUB_RADIUS + 6)
              const bend = Math.min(70, length * 0.22) * (node.x < HUB.x ? -1 : 1)
              const controlX = (startX + endX) / 2 - uy * bend
              const controlY = (startY + endY) / 2 + ux * bend
              const isActive = activeOwner === node.holder.owner
              const isDimmed = activeOwner !== null && !isActive

              return (
                <path
                  key={`edge-${node.holder.owner}`}
                  d={`M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`}
                  className="wallet-map__edge"
                  stroke={node.color}
                  strokeWidth={count === 0 ? 1 : 1 + Math.min(count, 18) * 0.45}
                  strokeDasharray={count === 0 ? '3 6' : undefined}
                  strokeOpacity={isDimmed ? 0.1 : isActive ? 0.75 : 0.34}
                />
              )
            })}

            <g className="wallet-map__hub">
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS} className="wallet-map__hub-disc" />
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS - 9} className="wallet-map__hub-ring" />
              <text x={HUB.x} y={HUB.y - 4} className="wallet-map__hub-title">
                KLYTH
              </text>
              <text x={HUB.x} y={HUB.y + 12} className="wallet-map__hub-sub">
                BONDING CURVE
              </text>
            </g>

            {nodes.map((node) => {
              const isActive = activeOwner === node.holder.owner
              const isDimmed = activeOwner !== null && !isActive
              const insideLabel = node.radius >= 32
              const shortOwner = shortenAddress(node.holder.owner, 4, 4)

              return (
                <g
                  key={node.holder.owner}
                  className={`wallet-map__node${isActive ? ' wallet-map__node--active' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={isDimmed ? 0.55 : 1}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.holder.label} ${shortOwner}, ${formatHolderPercent(node.holder.percent)} of supply`}
                  onPointerEnter={() => setHovered(node.holder.owner)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(node.holder.owner)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setSelected(node.holder.owner)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(node.holder.owner)
                    }
                  }}
                >
                  {isActive ? (
                    <circle
                      r={node.radius + 6}
                      fill="none"
                      stroke={node.color}
                      strokeOpacity={0.4}
                      strokeWidth={1}
                    />
                  ) : null}
                  <circle
                    r={node.radius}
                    fill={node.color}
                    fillOpacity={isActive ? 0.3 : 0.16}
                    stroke={node.color}
                    strokeWidth={isActive ? 2.4 : 1.4}
                  />
                  {insideLabel ? (
                    <text textAnchor="middle" y={2} className="wallet-map__bubble-percent">
                      {formatHolderPercent(node.holder.percent)}
                    </text>
                  ) : null}
                  <text
                    textAnchor="middle"
                    y={insideLabel ? 20 : node.radius + 14}
                    className="wallet-map__bubble-label"
                  >
                    {shortOwner}
                  </text>
                  {insideLabel ? null : (
                    <text
                      textAnchor="middle"
                      y={node.radius + 26}
                      className="wallet-map__bubble-percent wallet-map__bubble-percent--outside"
                    >
                      {formatHolderPercent(node.holder.percent)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        <div className="wallet-map__controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => zoomBy(0.8)}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setView({ x: 0, y: 0, scale: 1 })
              setSelected(null)
              setHovered(null)
            }}
            aria-label="Reset map view"
            title="Reset view"
          >
            <Maximize2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="wallet-map__details" aria-live="polite">
        {activeNode ? (
          <>
            <span
              className="wallet-map__detail-swatch"
              style={{ background: activeNode.color }}
              aria-hidden="true"
            />
            <div className="wallet-map__detail-main">
              <span className="data-label">{activeNode.holder.label}</span>
              <a
                className="wallet-map__detail-address"
                href={explorerAddressUrl(activeNode.holder.owner)}
                target="_blank"
                rel="noreferrer"
              >
                {activeNode.holder.owner}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            </div>
            <div className="wallet-map__detail-stats">
              <span>
                <strong>{formatHolderPercent(activeNode.holder.percent)}</strong> of supply
              </span>
              <span>
                <strong>{activeNode.holder.amount}</strong> KLYTH
              </span>
              <span>
                <strong>{activeTrades}</strong> curve trades
              </span>
            </div>
          </>
        ) : (
          <p className="data-meta">
            Hover or tap a bubble to inspect a wallet. Bubble area follows the share of
            supply; each link shows that wallet&apos;s buy/sell activity against the
            bonding curve.
          </p>
        )}
      </div>
    </div>
  )
}
