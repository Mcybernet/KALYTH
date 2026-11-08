import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ExternalLink, Maximize2, Minus, Plus } from 'lucide-react'
import { explorerAddressUrl, shortenAddress } from '../lib/addresses'
import { KLYTH_LOGO_URL } from '../lib/assets'
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
const HUB = { x: WIDTH / 2, y: 330 }
const HUB_RADIUS = 40
const MAX_BUBBLE_RADIUS = 86
const ORBIT = HUB_RADIUS + MAX_BUBBLE_RADIUS + 56

/** Bright, saturated cluster colors in the spirit of Bubblemaps. */
const ROLE_COLORS: Record<HolderRole, string> = {
  wallet: '#38bdf8',
  vault: '#22c55e',
  burn: '#ef4444',
  treasury: '#f59e0b',
  demo: '#a855f7',
}

const ROLE_LABELS: Record<HolderRole, string> = {
  wallet: 'Holders',
  vault: 'Curve vault',
  burn: 'Burn reserve',
  treasury: 'Treasury',
  demo: 'Demo wallet',
}

type LayoutNode = {
  holder: TokenHolder
  x: number
  y: number
  radius: number
}

type ClusterLayout = {
  role: HolderRole
  label: string
  color: string
  percent: number
  nodes: LayoutNode[]
  labelX: number
  labelY: number
  labelWidth: number
  stemTop: number
  stemBottom: number
}

type Layout = {
  nodes: LayoutNode[]
  clusters: ClusterLayout[]
}

/** A stable pseudo-random angle so clusters keep their shape between polls. */
function seedUnit(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function computeLayout(holders: TokenHolder[]): Layout {
  if (holders.length === 0) {
    return { nodes: [], clusters: [] }
  }

  const groups = new Map<HolderRole, TokenHolder[]>()
  for (const holder of holders) {
    const group = groups.get(holder.role) ?? []
    group.push(holder)
    groups.set(holder.role, group)
  }

  const maxPercent = Math.max(...holders.map((holder) => holder.percent), 0.0001)
  const radiusFor = (percent: number) =>
    13 + (MAX_BUBBLE_RADIUS - 13) * Math.sqrt(Math.max(percent, 0) / maxPercent)

  const roles = Array.from(groups.keys()).sort((left, right) => {
    const leftPercent = groups.get(left)!.reduce((sum, holder) => sum + holder.percent, 0)
    const rightPercent = groups.get(right)!.reduce((sum, holder) => sum + holder.percent, 0)
    return rightPercent - leftPercent
  })

  const nodes: LayoutNode[] = []
  const clusters: ClusterLayout[] = []

  roles.forEach((role, clusterIndex) => {
    const clusterHolders = groups.get(role)!
    const color = ROLE_COLORS[role]
    const angle =
      -Math.PI / 2 +
      (clusterIndex / roles.length) * Math.PI * 2 +
      (seedUnit(role) - 0.5) * 0.5
    const orbit = ORBIT + (clusterIndex % 2 === 0 ? 0 : 18)
    const centerX = HUB.x + Math.cos(angle) * orbit
    const centerY = HUB.y + Math.sin(angle) * orbit

    const largestRadius = Math.max(
      ...clusterHolders.map((holder) => radiusFor(holder.percent)),
    )
    const clusterNodes = clusterHolders.map((holder, memberIndex) => {
      const radius = radiusFor(holder.percent)
      if (memberIndex === 0) {
        return { holder, x: centerX, y: centerY, radius }
      }

      // Satellites orbit the largest wallet tangentially, so small holders stay
      // in the same cluster without landing inside the big bubble.
      const memberAngle =
        angle +
        Math.PI / 2 +
        ((memberIndex - 1) / Math.max(1, clusterHolders.length - 1)) * Math.PI * 2 +
        (seedUnit(holder.owner) - 0.5) * 0.35
      const spread = largestRadius + radius + 16
      return {
        holder,
        x: centerX + Math.cos(memberAngle) * spread,
        y: centerY + Math.sin(memberAngle) * spread,
        radius,
      }
    })

    nodes.push(...clusterNodes)

    const percent = clusterHolders.reduce((sum, holder) => sum + holder.percent, 0)
    const label =
      clusterHolders.length > 1
        ? `${ROLE_LABELS[role]} · ${formatHolderPercent(percent)}`
        : ROLE_LABELS[role]
    const labelWidth = Math.max(74, label.length * 6.1 + 34)
    const minY = Math.min(...clusterNodes.map((node) => node.y - node.radius))
    const maxY = Math.max(...clusterNodes.map((node) => node.y + node.radius))
    const labelCenterX = Math.min(
      WIDTH - labelWidth / 2 - 10,
      Math.max(labelWidth / 2 + 10, centerX),
    )
    const above = minY > 34
    const labelY = above ? minY - 34 : maxY + 12

    clusters.push({
      role,
      label,
      color,
      percent,
      nodes: clusterNodes,
      labelX: labelCenterX - labelWidth / 2,
      labelY,
      labelWidth,
      stemTop: above ? labelY + 24 : labelY,
      stemBottom: above ? minY - 4 : maxY + 4,
    })
  })

  return { nodes, clusters }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function WalletBubbleMap({ holders, tradeCounts }: WalletBubbleMapProps) {
  const layout = useMemo(() => computeLayout(holders), [holders])
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
  const activeNode = layout.nodes.find((node) => node.holder.owner === activeOwner) ?? null
  const activeTrades = activeNode ? (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const totalTrades = useMemo(
    () => Array.from(tradeCounts.values()).reduce((sum, count) => sum + count, 0),
    [tradeCounts],
  )

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
    const target = event.target as Element | null
    if (!target?.closest('.wallet-map__node')) {
      setSelected(null)
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

  const tooltipStyle = activeNode
    ? (() => {
        const screenX = activeNode.x * view.scale + view.x
        const screenY = activeNode.y * view.scale + view.y
        const offset = activeNode.radius * view.scale + 12
        const below = screenY < 240
        return {
          left: `${clamp((screenX / WIDTH) * 100, 17, 83)}%`,
          top: `${(screenY / HEIGHT) * 100}%`,
          transform: below
            ? `translate(-50%, ${offset}px)`
            : `translate(-50%, calc(-100% - ${offset}px))`,
        }
      })()
    : undefined

  return (
    <div className="wallet-map">
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
            <radialGradient id="wallet-map-glow" cx="50%" cy="42%" r="72%">
              <stop offset="0%" stopColor="#15204d" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#0a1029" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#04040b" stopOpacity="0" />
            </radialGradient>
            <pattern id="wallet-map-dots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1" fill="rgba(148, 163, 184, 0.12)" />
            </pattern>
            <clipPath id="wallet-hub-clip">
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS - 2} />
            </clipPath>
            <filter id="wallet-hub-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <rect width={WIDTH} height={HEIGHT} fill="#04040b" />
          <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-glow)" />
          <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-dots)" />

          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {layout.clusters.map((cluster) => (
              <g key={`label-${cluster.role}`} className="wallet-map__cluster">
                <line
                  x1={cluster.labelX + cluster.labelWidth / 2}
                  y1={cluster.stemTop}
                  x2={cluster.labelX + cluster.labelWidth / 2}
                  y2={cluster.stemBottom}
                  stroke={cluster.color}
                  strokeOpacity={0.4}
                  strokeWidth={1}
                />
                <rect
                  x={cluster.labelX}
                  y={cluster.labelY}
                  width={cluster.labelWidth}
                  height={24}
                  rx={12}
                  className="wallet-map__cluster-pill"
                />
                <circle
                  cx={cluster.labelX + 14}
                  cy={cluster.labelY + 12}
                  r={4}
                  fill={cluster.color}
                />
                <text
                  x={cluster.labelX + 24}
                  y={cluster.labelY + 15.5}
                  className="wallet-map__cluster-text"
                >
                  {cluster.label}
                </text>
              </g>
            ))}

            {layout.nodes.map((node) => {
              const count = tradeCounts.get(node.holder.owner) ?? 0
              const isActive = activeOwner === node.holder.owner
              const isDimmed = activeOwner !== null && !isActive

              return (
                <line
                  key={`edge-${node.holder.owner}`}
                  className="wallet-map__edge"
                  x1={HUB.x}
                  y1={HUB.y}
                  x2={node.x}
                  y2={node.y}
                  stroke={ROLE_COLORS[node.holder.role]}
                  strokeWidth={count === 0 ? 1 : 1 + Math.min(count, 18) * 0.35}
                  strokeDasharray={count === 0 ? '3 6' : undefined}
                  strokeOpacity={isDimmed ? 0.08 : isActive ? 0.85 : 0.32}
                  strokeLinecap="round"
                />
              )
            })}

            <g className="wallet-map__hub" filter="url(#wallet-hub-glow)">
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS + 3} className="wallet-map__hub-ring" />
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS} fill="#0a1024" />
              <image
                href={KLYTH_LOGO_URL}
                x={HUB.x - HUB_RADIUS}
                y={HUB.y - HUB_RADIUS}
                width={HUB_RADIUS * 2}
                height={HUB_RADIUS * 2}
                preserveAspectRatio="xMidYMid slice"
                clipPath="url(#wallet-hub-clip)"
              />
              <circle cx={HUB.x} cy={HUB.y} r={HUB_RADIUS} className="wallet-map__hub-outline" />
            </g>

            {layout.nodes.map((node) => {
              const isActive = activeOwner === node.holder.owner
              const isDimmed = activeOwner !== null && !isActive
              const color = ROLE_COLORS[node.holder.role]
              const inside = node.radius >= 24
              const percentSize = Math.max(10, Math.min(19, node.radius * 0.27))

              return (
                <g
                  key={node.holder.owner}
                  className={`wallet-map__node${isActive ? ' wallet-map__node--active' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={isDimmed ? 0.5 : 1}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.holder.label} ${shortenAddress(node.holder.owner, 4, 4)}, ${formatHolderPercent(node.holder.percent)} of supply`}
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
                      r={node.radius + 7}
                      fill="none"
                      stroke={color}
                      strokeOpacity={0.55}
                      strokeWidth={3}
                    />
                  ) : null}
                  <circle
                    r={node.radius}
                    fill={color}
                    fillOpacity={0.88}
                    stroke="rgba(255, 255, 255, 0.28)"
                    strokeWidth={1.5}
                  />
                  <text
                    textAnchor="middle"
                    y={inside ? percentSize * 0.32 : node.radius + 15}
                    className="wallet-map__bubble-percent"
                    style={{ fontSize: `${percentSize}px` }}
                  >
                    {formatHolderPercent(node.holder.percent)}
                  </text>
                  {inside && node.radius >= 46 ? (
                    <text
                      textAnchor="middle"
                      y={percentSize * 0.32 + 17}
                      className="wallet-map__bubble-sub"
                    >
                      {shortenAddress(node.holder.owner, 5, 4)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        </svg>

        <div className="wallet-map__legend" aria-label="Holder clusters">
          <span className="wallet-map__legend-title">Clusters</span>
          {layout.clusters.map((cluster) => (
            <div className="wallet-map__legend-row" key={`legend-${cluster.role}`}>
              <span
                className="wallet-map__legend-dot"
                style={{ background: cluster.color }}
                aria-hidden="true"
              />
              <span className="wallet-map__legend-label">{ROLE_LABELS[cluster.role]}</span>
              <span className="wallet-map__legend-percent">
                {formatHolderPercent(cluster.percent)}
              </span>
            </div>
          ))}
          <div className="wallet-map__legend-foot">{totalTrades} curve trades</div>
        </div>

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

        {activeNode ? (
          <div className="wallet-map__tooltip" style={tooltipStyle}>
            <div className="wallet-map__tooltip-head">
              <span
                className="wallet-map__tooltip-dot"
                style={{ background: ROLE_COLORS[activeNode.holder.role] }}
                aria-hidden="true"
              />
              {activeNode.holder.label}
            </div>
            <div className="wallet-map__tooltip-percent">
              {formatHolderPercent(activeNode.holder.percent)}
              <span> of supply</span>
            </div>
            <div className="wallet-map__tooltip-address">
              {shortenAddress(activeNode.holder.owner, 8, 8)}
            </div>
            <div className="wallet-map__tooltip-row">
              <span>Balance</span>
              <strong>{activeNode.holder.amount} KLYTH</strong>
            </div>
            <div className="wallet-map__tooltip-row">
              <span>Curve trades</span>
              <strong>{activeTrades}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="wallet-map__details" aria-live="polite">
        {activeNode ? (
          <>
            <span
              className="wallet-map__detail-swatch"
              style={{ background: ROLE_COLORS[activeNode.holder.role] }}
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
