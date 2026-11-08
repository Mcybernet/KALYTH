import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { explorerAddressUrl, explorerTxUrl, shortenAddress } from '../lib/addresses'
import { KLYTH_LOGO_URL } from '../lib/assets'
import {
  formatHolderPercent,
  holderTier,
  type HolderRole,
  type TokenHolder,
} from '../lib/holders'
import { formatTokenAmount } from '../lib/solana'
import {
  CLUSTER_COLORS,
  type TraderCluster,
  type TransferEdge,
  type TransferGraph,
  type TransferScanProgress,
} from '../lib/transfers'

type WalletBubbleMapProps = {
  holders: TokenHolder[]
  tradeCounts: Map<string, number>
  decimals: number
  graph: TransferGraph | null
  scanning: boolean
  scanError: string | null
  progress: TransferScanProgress | null
  onRefreshTransfers: () => void
}

const WIDTH = 1000
const HEIGHT = 640
const MAX_BUBBLE_RADIUS = 86
const MIN_BUBBLE_RADIUS = 14
const CLUSTER_COLORS_BY_ROLE: Record<HolderRole, string> = {
  wallet: '#38bdf8',
  vault: '#22c55e',
  burn: '#ef4444',
  treasury: '#f59e0b',
  demo: '#a855f7',
}

const ROLE_LABELS: Record<HolderRole, string> = {
  wallet: 'Wallet holders',
  vault: 'Curve vault',
  burn: 'Burn reserve',
  treasury: 'Treasury',
  demo: 'Demo wallet',
}

type EdgeMode = 'wallet' | 'all' | 'curve'

type LayoutNode = {
  holder: TokenHolder
  x: number
  y: number
  radius: number
}

type ForceNode = SimulationNodeDatum & LayoutNode

type ForceLink = SimulationLinkDatum<ForceNode> & {
  edge: TransferEdge
}

type PlacedEdge = {
  edge: TransferEdge
  path: string
  midX: number
  midY: number
  color: string
  width: number
  dashed: boolean
}

type ClusterHalo = {
  cluster: TraderCluster
  color: string
  percent: number
  cx: number
  cy: number
  radius: number
  label: string
  labelX: number
  labelY: number
  labelWidth: number
}

type Layout = {
  nodes: LayoutNode[]
  edges: PlacedEdge[]
  halos: ClusterHalo[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

function roleColor(role: HolderRole): string {
  return CLUSTER_COLORS_BY_ROLE[role]
}

function buildPlacedEdges(
  nodes: LayoutNode[],
  edges: TransferEdge[],
  graph: TransferGraph | null,
  decimals: number,
): PlacedEdge[] {
  const nodeByOwner = new Map(nodes.map((node) => [node.holder.owner, node]))
  const clusterById = new Map((graph?.clusters ?? []).map((cluster) => [cluster.id, cluster]))
  const placed: PlacedEdge[] = []

  for (const edge of edges) {
    const source = nodeByOwner.get(edge.owners[0])
    const target = nodeByOwner.get(edge.owners[1])
    if (!source || !target) continue

    const deltaX = target.x - source.x
    const deltaY = target.y - source.y
    const distance = Math.hypot(deltaX, deltaY)
    if (distance < 1) continue

    const unitX = deltaX / distance
    const unitY = deltaY / distance
    const startX = source.x + unitX * (source.radius + 3)
    const startY = source.y + unitY * (source.radius + 3)
    const endX = target.x - unitX * (target.radius + 13)
    const endY = target.y - unitY * (target.radius + 13)

    const bendDirection = hashString(edge.key) % 2 === 0 ? 1 : -1
    const bend = edge.kind === 'curve' ? 0.1 : 0.16
    const midX = (startX + endX) / 2 - unitY * distance * bend * bendDirection
    const midY = (startY + endY) / 2 + unitX * distance * bend * bendDirection

    const sourceCluster = graph?.memberByOwner[source.holder.owner]
    const targetCluster = graph?.memberByOwner[target.holder.owner]
    const sharedCluster =
      sourceCluster && sourceCluster === targetCluster ? clusterById.get(sourceCluster) : null

    let color = '#94a3b8'
    if (edge.kind === 'wallet') {
      color = sharedCluster?.color ?? '#7dd3fc'
    } else {
      const protocolRole =
        source.holder.role !== 'wallet' && source.holder.role !== 'demo'
          ? source.holder.role
          : target.holder.role
      color = roleColor(protocolRole)
    }

    const humanAmount = edge.amountNumber / 10 ** decimals
    const width =
      edge.kind === 'wallet'
        ? 1.2 + Math.min(4.8, Math.log10(1 + Math.max(0, humanAmount)) * 0.62)
        : 1 + Math.min(3.2, Math.log1p(edge.count) * 1.15)

    placed.push({
      edge,
      path: `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`,
      midX: 0.25 * startX + 0.5 * midX + 0.25 * endX,
      midY: 0.25 * startY + 0.5 * midY + 0.25 * endY,
      color,
      width,
      dashed: edge.kind === 'curve',
    })
  }

  return placed
}

function computeLayout(
  holders: TokenHolder[],
  graph: TransferGraph | null,
  decimals: number,
): Layout {
  if (holders.length === 0) {
    return { nodes: [], edges: [], halos: [] }
  }

  const holderByOwner = new Map(holders.map((holder) => [holder.owner, holder]))
  const maxPercent = Math.max(...holders.map((holder) => holder.percent), 0.0001)
  const radiusFor = (percent: number) =>
    MIN_BUBBLE_RADIUS +
    (MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS) *
      Math.sqrt(Math.max(percent, 0) / maxPercent)

  const percentByOwner = new Map(holders.map((holder) => [holder.owner, holder.percent]))

  const clusters = (graph?.clusters ?? [])
    .map((cluster) => ({
      ...cluster,
      members: cluster.members.filter((owner) => holderByOwner.has(owner)),
    }))
    .filter((cluster) => cluster.members.length > 1)

  const clusteredOwners = new Set(clusters.flatMap((cluster) => cluster.members))
  const groups: string[][] = [
    ...clusters.map((cluster) => cluster.members),
    ...holders
      .filter((holder) => !clusteredOwners.has(holder.owner))
      .map((holder) => [holder.owner]),
  ]

  groups.sort((left, right) => {
    const leftPercent = left.reduce((sum, owner) => sum + (percentByOwner.get(owner) ?? 0), 0)
    const rightPercent = right.reduce(
      (sum, owner) => sum + (percentByOwner.get(owner) ?? 0),
      0,
    )
    return rightPercent - leftPercent
  })

  const nodes: ForceNode[] = holders.map((holder) => ({
    holder,
    x: WIDTH / 2,
    y: HEIGHT / 2,
    radius: radiusFor(holder.percent),
  }))
  const nodeByOwner = new Map(nodes.map((node) => [node.holder.owner, node]))

  groups.forEach((group, groupIndex) => {
    const angle =
      -Math.PI / 2 +
      (groupIndex / Math.max(1, groups.length)) * Math.PI * 2 +
      (hashString(group.join('|')) / 4294967295 - 0.5) * 0.35
    const centerX = WIDTH / 2 + Math.cos(angle) * 185
    const centerY = HEIGHT / 2 + Math.sin(angle) * 150

    group.forEach((owner, memberIndex) => {
      const node = nodeByOwner.get(owner)
      if (!node) return
      if (memberIndex === 0) {
        node.x = centerX
        node.y = centerY
        return
      }
      const memberAngle =
        angle +
        Math.PI / 2 +
        ((memberIndex - 1) / Math.max(1, group.length - 1)) * Math.PI * 2
      const spread = 76 + memberIndex * 24
      node.x = centerX + Math.cos(memberAngle) * spread
      node.y = centerY + Math.sin(memberAngle) * spread
    })
  })

  const links: ForceLink[] = (graph?.edges ?? [])
    .filter(
      (edge) =>
        edge.kind === 'wallet' &&
        nodeByOwner.has(edge.owners[0]) &&
        nodeByOwner.has(edge.owners[1]),
    )
    .map((edge) => ({
      source: edge.owners[0],
      target: edge.owners[1],
      edge,
    }))

  const simulation = forceSimulation<ForceNode>(nodes)
    .force('charge', forceManyBody<ForceNode>().strength(-360))
    .force(
      'collide',
      forceCollide<ForceNode>()
        .radius((node) => node.radius + 9)
        .strength(1)
        .iterations(3),
    )
    .force('centerX', forceX<ForceNode>(WIDTH / 2).strength(0.06))
    .force('centerY', forceY<ForceNode>(HEIGHT / 2).strength(0.06))
    .force(
      'link',
      forceLink<ForceNode, ForceLink>(links)
        .id((node) => node.holder.owner)
        .distance((link) => {
          const source = link.source as ForceNode
          const target = link.target as ForceNode
          return source.radius + target.radius + 110
        })
        .strength(0.55),
    )
    .stop()

  simulation.tick(320)

  for (const node of nodes) {
    node.x = clamp(node.x ?? WIDTH / 2, node.radius + 26, WIDTH - node.radius - 26)
    node.y = clamp(node.y ?? HEIGHT / 2, node.radius + 34, HEIGHT - node.radius - 30)
  }

  const edges = buildPlacedEdges(nodes, graph?.edges ?? [], graph, decimals)

  const halos: ClusterHalo[] = clusters
    .map((cluster) => {
      const clusterNodes = cluster.members
        .map((owner) => nodeByOwner.get(owner))
        .filter((node): node is ForceNode => Boolean(node))
      if (clusterNodes.length === 0) {
        return null
      }
      const cx = clusterNodes.reduce((sum, node) => sum + node.x, 0) / clusterNodes.length
      const cy = clusterNodes.reduce((sum, node) => sum + node.y, 0) / clusterNodes.length
      const radius =
        Math.max(...clusterNodes.map((node) => Math.hypot(node.x - cx, node.y - cy) + node.radius)) +
        24
      const percent = clusterNodes.reduce(
        (sum, node) => sum + node.holder.percent,
        0,
      )
      const label = `Cluster ${cluster.id} · ${clusterNodes.length} wallets · ${formatHolderPercent(percent)}`
      const labelWidth = Math.max(116, label.length * 5.75 + 30)
      const labelX = clamp(cx - labelWidth / 2, 12, WIDTH - labelWidth - 12)
      const labelY = clamp(cy - radius - 36, 12, HEIGHT - 34)

      return {
        cluster,
        color: cluster.color,
        percent,
        cx,
        cy,
        radius,
        label,
        labelX,
        labelY,
        labelWidth,
      }
    })
    .filter((halo): halo is ClusterHalo => Boolean(halo))

  return { nodes, edges, halos }
}

export function WalletBubbleMap({
  holders,
  tradeCounts,
  decimals,
  graph,
  scanning,
  scanError,
  progress,
  onRefreshTransfers,
}: WalletBubbleMapProps) {
  const [edgeMode, setEdgeMode] = useState<EdgeMode>('wallet')
  const autoShiftedRef = useRef(false)
  const layout = useMemo(
    () => computeLayout(holders, graph, decimals),
    [holders, graph, decimals],
  )
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
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
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
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', handleKey)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
    }
  }, [expanded])

  const holderByOwner = useMemo(
    () => new Map(holders.map((holder) => [holder.owner, holder])),
    [holders],
  )
  const clusterById = useMemo(
    () => new Map((graph?.clusters ?? []).map((cluster) => [cluster.id, cluster])),
    [graph],
  )

  const edgeStats = useMemo(() => {
    const stats = new Map<string, { count: number; volumeRaw: bigint; peers: Set<string> }>()
    for (const edge of graph?.edges ?? []) {
      for (const [owner, peer] of [
        [edge.owners[0], edge.owners[1]],
        [edge.owners[1], edge.owners[0]],
      ]) {
        if (!holderByOwner.has(owner)) continue
        const entry = stats.get(owner) ?? { count: 0, volumeRaw: 0n, peers: new Set<string>() }
        entry.count += edge.count
        entry.volumeRaw += BigInt(edge.amountRaw)
        entry.peers.add(peer)
        stats.set(owner, entry)
      }
    }
    return stats
  }, [graph, holderByOwner])

  const activeOwner = hovered ?? selected
  const activeNode =
    layout.nodes.find((node) => node.holder.owner === activeOwner) ?? null
  const activeTrades = activeNode ? (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const activeEdge =
    (hoveredEdge ?? selectedEdge)
      ? graph?.edges.find((edge) => edge.key === (hoveredEdge ?? selectedEdge)) ?? null
      : null

  const visibleEdges = layout.edges.filter((placed) => {
    if (edgeMode === 'all') return true
    return edgeMode === 'wallet'
      ? placed.edge.kind === 'wallet'
      : placed.edge.kind === 'curve'
  })

  const walletEdgeCount = graph?.edges.filter((edge) => edge.kind === 'wallet').length ?? 0

  // Show the wallet-only view when real wallet-to-wallet links exist. If the
  // recent trace only contains curve flows, fall back to all flows once so the
  // map never looks empty on a fresh scan.
  useEffect(() => {
    if (!graph || autoShiftedRef.current || graph.edges.length === 0) return
    autoShiftedRef.current = true
    if (walletEdgeCount === 0) {
      setEdgeMode('all')
    }
  }, [graph, walletEdgeCount])

  const totalTrades = useMemo(
    () => Array.from(tradeCounts.values()).reduce((sum, count) => sum + count, 0),
    [tradeCounts],
  )

  const clusterLegend = (graph?.clusters ?? [])
    .map((cluster) => {
      const members = cluster.members
        .map((owner) => holderByOwner.get(owner))
        .filter((holder): holder is TokenHolder => Boolean(holder))
      const percent = members.reduce((sum, holder) => sum + holder.percent, 0)
      return { cluster, percent }
    })
    .filter((entry) => entry.percent > 0)

  const unclusteredByRole = useMemo(() => {
    const result = new Map<HolderRole, { percent: number; count: number }>()
    for (const holder of holders) {
      if (graph?.memberByOwner[holder.owner]) continue
      const entry = result.get(holder.role) ?? { percent: 0, count: 0 }
      entry.percent += holder.percent
      entry.count += 1
      result.set(holder.role, entry)
    }
    return result
  }, [graph, holders])

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
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (!target?.closest('.wallet-map__node')) {
      setSelected(null)
    }
    if (!target?.closest('.wallet-map__edge-hit')) {
      setSelectedEdge(null)
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
    if (!drag || drag.pointerId !== event.pointerId) return
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

  const activeNodeColor = activeNode
    ? (graph?.memberByOwner[activeNode.holder.owner]
        ? clusterById.get(graph.memberByOwner[activeNode.holder.owner])?.color
        : null) ?? roleColor(activeNode.holder.role)
    : null

  const activeStats = activeNode ? edgeStats.get(activeNode.holder.owner) : null
  const activeCluster = activeNode
    ? graph?.memberByOwner[activeNode.holder.owner]
    : undefined
  const activeTier = activeNode ? holderTier(activeNode.holder.tier) : null

  const tooltipStyle = activeNode
    ? (() => {
        const screenX = activeNode.x * view.scale + view.x
        const screenY = activeNode.y * view.scale + view.y
        const offset = activeNode.radius * view.scale + 12
        const below = screenY < 250
        return {
          left: `${clamp((screenX / WIDTH) * 100, 18, 82)}%`,
          top: `${(screenY / HEIGHT) * 100}%`,
          transform: below
            ? `translate(-50%, ${offset}px)`
            : `translate(-50%, calc(-100% - ${offset}px))`,
        }
      })()
    : undefined

  const markerColors = Array.from(
    new Set([
      ...CLUSTER_COLORS,
      ...Object.values(CLUSTER_COLORS_BY_ROLE),
      '#94a3b8',
      '#7dd3fc',
    ]),
  )

  const scanRateLimited =
    !scanning &&
    graph !== null &&
    graph.parsedTransactions === 0 &&
    graph.failedTransactions > 0

  const statusText = scanning
    ? progress
      ? `Scanning ${progress.done}/${progress.total} ${progress.phase === 'signatures' ? 'signatures' : 'txs'}`
      : 'Scanning transfers…'
    : scanError
      ? 'Transfer scan limited · retry'
      : graph
        ? `${graph.clusters.length} cluster${graph.clusters.length === 1 ? '' : 's'} · ${graph.edges.length} flow${
            graph.edges.length === 1 ? '' : 's'
          } · ${walletEdgeCount} wallet link${walletEdgeCount === 1 ? '' : 's'}${
            graph.failedTransactions > 0
              ? ` · ${graph.failedTransactions} limited`
              : ''
          }`
        : 'Transfer scan pending'

  const canvas = (
    <div className="wallet-map__canvas">
      <svg
        ref={svgRef}
        className={`wallet-map__svg${dragging ? ' wallet-map__svg--dragging' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="KLYTH holder bubble map with on-chain transfer links"
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
          <clipPath id="wallet-watermark-clip">
            <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={92} />
          </clipPath>
          {markerColors.map((color) => (
            <marker
              key={color}
              id={`wallet-map-arrow-${color.slice(1)}`}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 6 3 L 0 6 z" fill={color} />
            </marker>
          ))}
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="#04040b" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-glow)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-dots)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <image
            href={KLYTH_LOGO_URL}
            x={WIDTH / 2 - 92}
            y={HEIGHT / 2 - 92}
            width={184}
            height={184}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#wallet-watermark-clip)"
            className="wallet-map__watermark"
            aria-hidden="true"
          />

          {layout.halos.map((halo) => (
            <g key={`halo-${halo.cluster.id}`} className="wallet-map__cluster wallet-map__cluster-halo">
              <circle
                cx={halo.cx}
                cy={halo.cy}
                r={halo.radius}
                fill={halo.color}
                fillOpacity={0.055}
                stroke={halo.color}
                strokeOpacity={0.32}
                strokeWidth={1.2}
                strokeDasharray="4 7"
              />
              <line
                className="wallet-map__cluster-stem"
                x1={halo.labelX + halo.labelWidth / 2}
                y1={halo.labelY + 24}
                x2={halo.labelX + halo.labelWidth / 2}
                y2={halo.cy - halo.radius}
                stroke={halo.color}
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <rect
                x={halo.labelX}
                y={halo.labelY}
                width={halo.labelWidth}
                height={24}
                rx={12}
                className="wallet-map__cluster-pill"
              />
              <circle
                cx={halo.labelX + 14}
                cy={halo.labelY + 12}
                r={4}
                fill={halo.color}
              />
              <text
                x={halo.labelX + 24}
                y={halo.labelY + 15.5}
                className="wallet-map__cluster-text"
              >
                {halo.label}
              </text>
            </g>
          ))}

          {visibleEdges.map((placed) => {
            const incident =
              activeOwner !== null
                ? placed.edge.owners.includes(activeOwner)
                : true
            const edgeActive = hoveredEdge === placed.edge.key || selectedEdge === placed.edge.key
            const dimmed =
              (activeOwner !== null && !incident) || (hoveredEdge !== null && !edgeActive)
            return (
              <g key={`edge-${placed.edge.key}`}>
                <path
                  className={`wallet-map__edge${dimmed ? ' wallet-map__edge--dimmed' : ''}`}
                  d={placed.path}
                  fill="none"
                  stroke={placed.color}
                  strokeWidth={placed.width}
                  strokeDasharray={placed.dashed ? '4 6' : undefined}
                  strokeOpacity={dimmed ? 0.06 : edgeActive ? 0.95 : 0.52}
                  strokeLinecap="round"
                  markerEnd={`url(#wallet-map-arrow-${placed.color.slice(1)})`}
                >
                  <title>
                    {`${shortenAddress(placed.edge.from, 6, 4)} → ${shortenAddress(
                      placed.edge.to,
                      6,
                      4,
                    )}: ${placed.edge.amount} KLYTH across ${placed.edge.count} transfer${
                      placed.edge.count === 1 ? '' : 's'
                    }`}
                  </title>
                </path>
                <path
                  className="wallet-map__edge-hit"
                  d={placed.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  onPointerEnter={() => setHoveredEdge(placed.edge.key)}
                  onPointerLeave={() => setHoveredEdge(null)}
                  onClick={() => setSelectedEdge(placed.edge.key)}
                />
              </g>
            )
          })}

          {layout.nodes.map((node) => {
            const isActive = activeOwner === node.holder.owner
            const isDimmed = activeOwner !== null && !isActive
            const clusterId = graph?.memberByOwner[node.holder.owner]
            const cluster = clusterId ? clusterById.get(clusterId) : null
            const color = cluster?.color ?? roleColor(node.holder.role)
            const tier = holderTier(node.holder.tier)
            const inside = node.radius >= 25
            const percentSize = Math.max(10, Math.min(19, node.radius * 0.27))

            return (
              <g
                key={node.holder.owner}
                className={`wallet-map__node${isActive ? ' wallet-map__node--active' : ''}`}
                transform={`translate(${node.x} ${node.y})`}
                opacity={isDimmed ? 0.42 : 1}
                role="button"
                tabIndex={0}
                aria-label={`${tier.emoji} ${tier.label} ${node.holder.label} ${shortenAddress(
                  node.holder.owner,
                  4,
                  4,
                )}, ${formatHolderPercent(node.holder.percent)} of supply`}
                onPointerEnter={() => setHovered(node.holder.owner)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.holder.owner)}
                onBlur={() => setHovered(null)}
                onClick={() => {
                  setSelected(node.holder.owner)
                  setSelectedEdge(null)
                }}
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
                  fillOpacity={0.9}
                  stroke="rgba(255, 255, 255, 0.3)"
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
                {inside && node.radius >= 48 ? (
                  <text
                    textAnchor="middle"
                    y={percentSize * 0.32 + 17}
                    className="wallet-map__bubble-sub"
                  >
                    {shortenAddress(node.holder.owner, 5, 4)}
                  </text>
                ) : null}
                {node.radius >= 28 ? (
                  <text
                    x={node.radius * 0.58}
                    y={-node.radius * 0.58}
                    textAnchor="middle"
                    className="wallet-map__bubble-tier"
                    aria-hidden="true"
                  >
                    {tier.emoji}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>

      <div className="wallet-map__status">
        <span
          className={`wallet-map__status-dot${scanning ? ' is-pulsing' : ''}${
            scanError || scanRateLimited ? ' is-error' : ''
          }`}
          aria-hidden="true"
        />
        {statusText}
      </div>

      <div className="wallet-map__filters" role="group" aria-label="Transfer edge filter">
        {(
          [
            ['wallet', 'Wallets'],
            ['all', 'All flows'],
            ['curve', 'Curve'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`wallet-map__filter${edgeMode === mode ? ' is-active' : ''}`}
            aria-pressed={edgeMode === mode}
            onClick={() => setEdgeMode(mode)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="wallet-map__filter wallet-map__filter--icon"
          onClick={onRefreshTransfers}
          disabled={scanning}
          title="Rescan on-chain transfers"
          aria-label="Rescan on-chain transfers"
        >
          <RefreshCw
            size={12}
            aria-hidden="true"
            className={scanning ? 'is-spinning' : undefined}
          />
        </button>
      </div>

      <div className="wallet-map__legend" aria-label="Holder clusters">
        <span className="wallet-map__legend-title">Trader clusters</span>
        {clusterLegend.length === 0 ? (
          <span className="wallet-map__legend-empty">
            {scanning
              ? 'Scanning transfer paths…'
              : scanRateLimited
                ? 'Transfer scan rate-limited · retry above'
                : 'No wallet-to-wallet links yet'}
          </span>
        ) : (
          clusterLegend.map(({ cluster, percent }) => (
            <div className="wallet-map__legend-row" key={`legend-${cluster.id}`}>
              <span
                className="wallet-map__legend-dot"
                style={{ background: cluster.color }}
                aria-hidden="true"
              />
              <span className="wallet-map__legend-label">
                Cluster {cluster.id} · {cluster.walletCount} wallets
              </span>
              <span className="wallet-map__legend-percent">
                {formatHolderPercent(percent)}
              </span>
            </div>
          ))
        )}

        <span className="wallet-map__legend-title wallet-map__legend-title--spaced">
          Protocol &amp; unlinked
        </span>
        {Array.from(unclusteredByRole.entries()).map(([role, entry]) => (
          <div className="wallet-map__legend-row" key={`role-${role}`}>
            <span
              className="wallet-map__legend-dot"
              style={{ background: roleColor(role) }}
              aria-hidden="true"
            />
            <span className="wallet-map__legend-label">
              {ROLE_LABELS[role]}
              {entry.count > 1 ? ` · ${entry.count}` : ''}
            </span>
            <span className="wallet-map__legend-percent">
              {formatHolderPercent(entry.percent)}
            </span>
          </div>
        ))}
        <div className="wallet-map__legend-foot">
          {graph
            ? `${graph.parsedTransactions}/${graph.scannedSignatures} txs parsed${
                graph.failedTransactions > 0
                  ? ` · ${graph.failedTransactions} rate-limited`
                  : ''
              }${graph.truncated ? ' · window capped' : ''}${
                walletEdgeCount === 0 && graph.edges.length > 0
                  ? ' · curve-only window'
                  : ''
              }`
            : `${totalTrades} curve trades`}
        </div>
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
            setSelectedEdge(null)
            setHovered(null)
            setHoveredEdge(null)
          }}
          aria-label="Reset map view"
          title="Reset view"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Exit full screen map' : 'Open full screen map'}
          title={expanded ? 'Exit full screen' : 'Full screen'}
        >
          {expanded ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
        </button>
      </div>

      {activeNode ? (
        <div className="wallet-map__tooltip" style={tooltipStyle}>
          <div className="wallet-map__tooltip-head">
            <span
              className="wallet-map__tooltip-dot"
              style={{ background: activeNodeColor ?? undefined }}
              aria-hidden="true"
            />
            {activeNode.holder.label}
            {activeCluster ? <span className="wallet-map__tooltip-tag">{activeCluster}</span> : null}
          </div>
          <div className="wallet-map__tooltip-percent">
            {formatHolderPercent(activeNode.holder.percent)}
            <span> of supply</span>
          </div>
          <div className="wallet-map__tooltip-address">
            {activeTier?.emoji} {activeTier?.label} · {shortenAddress(activeNode.holder.owner, 8, 8)}
          </div>
          <div className="wallet-map__tooltip-row">
            <span>Balance</span>
            <strong>{activeNode.holder.amount} KLYTH</strong>
          </div>
          <div className="wallet-map__tooltip-row">
            <span>Transfer links</span>
            <strong>{activeStats?.count ?? 0}</strong>
          </div>
          <div className="wallet-map__tooltip-row">
            <span>Transferred</span>
            <strong>
              {formatTokenAmount((activeStats?.volumeRaw ?? 0n).toString(), decimals)} KLYTH
            </strong>
          </div>
          <div className="wallet-map__tooltip-row">
            <span>Curve trades</span>
            <strong>{activeTrades}</strong>
          </div>
        </div>
      ) : null}
    </div>
  )

  const details = (
    <div className="wallet-map__details" aria-live="polite">
      {activeNode ? (
        <>
          <span
            className="wallet-map__detail-swatch"
            style={{ background: activeNodeColor ?? undefined }}
            aria-hidden="true"
          />
          <div className="wallet-map__detail-main">
            <span className="data-label">
              {activeTier?.emoji} {activeNode.holder.label}
              {activeCluster ? ` · Cluster ${activeCluster}` : ''}
            </span>
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
              <strong>{activeStats?.count ?? 0}</strong> transfer links
            </span>
            <span>
              <strong>{activeTrades}</strong> curve trades
            </span>
          </div>
        </>
      ) : activeEdge ? (
        <>
          <span
            className="wallet-map__detail-swatch"
            style={{ background: visibleEdges.find((item) => item.edge.key === activeEdge.key)?.color }}
            aria-hidden="true"
          />
          <div className="wallet-map__detail-main">
            <span className="data-label">
              {activeEdge.kind === 'wallet' ? 'Wallet transfer' : 'Curve flow'} ·{' '}
              {activeEdge.count} tx{activeEdge.count === 1 ? '' : 's'}
            </span>
            <span className="wallet-map__detail-address">
              {shortenAddress(activeEdge.from, 8, 6)} → {shortenAddress(activeEdge.to, 8, 6)}
            </span>
          </div>
          <div className="wallet-map__detail-stats">
            <span>
              <strong>{activeEdge.amount}</strong> KLYTH total
            </span>
            {activeEdge.directions.map((direction) => (
              <span key={`${direction.from}-${direction.to}`}>
                {direction.from === activeEdge.from ? '↗' : '↘'}{' '}
                <strong>{direction.amount}</strong> KLYTH · {direction.count} tx
              </span>
            ))}
            <a
              className="tx-link"
              href={explorerTxUrl(activeEdge.directions[0].lastSignature)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </>
      ) : (
        <p className="data-meta">
          Bubble area follows each wallet&apos;s share of supply. Lines are parsed SPL
          token transfers between current holders — solid for wallet-to-wallet flows,
          dashed for bonding-curve flows. Hover a bubble or a line to inspect the
          on-chain trace.
        </p>
      )}
    </div>
  )

  if (expanded) {
    return createPortal(
      <div
        className="wallet-map-portal"
        role="dialog"
        aria-modal="true"
        aria-label="KLYTH holder bubble map full screen"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpanded(false)
        }}
      >
        <div className="wallet-map-portal__panel">
          <div className="wallet-map-portal__head">
            <div>
              <span className="data-label">KLYTH holder map</span>
              <strong className="wallet-map-portal__title">
                {holders.length} holders · {walletEdgeCount} wallet transfer links
              </strong>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setExpanded(false)}
              aria-label="Close full screen map"
              title="Close"
            >
              <Minimize2 size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="wallet-map-portal__content">
            {canvas}
            {details}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <div className="wallet-map">
      {canvas}
      {details}
    </div>
  )
}
