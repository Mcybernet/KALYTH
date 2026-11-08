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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  List,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Unlock,
} from 'lucide-react'
import { explorerAddressUrl, explorerTxUrl, shortenAddress } from '../lib/addresses'
import { KLYTH_LOGO_URL } from '../lib/assets'
import {
  formatHolderPercent,
  HOLDER_TIERS,
  holderTier,
  type HolderRole,
  type TokenHolder,
} from '../lib/holders'
import { formatTokenAmount } from '../lib/solana'
import {
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
const HEIGHT = 660
const MAX_BUBBLE_RADIUS = 84
const MIN_BUBBLE_RADIUS = 16
const SUPERNODE_TRANSFERS = 100

/** Bubble factory colors, tuned to read like the vibrant v2 palette. */
const CLUSTER_COLORS_BY_ROLE: Record<HolderRole, string> = {
  wallet: '#4f8cff',
  vault: '#2dd4bf',
  burn: '#ff5f7e',
  treasury: '#f5b53f',
  demo: '#b06bff',
}

const ROLE_LABELS: Record<HolderRole, string> = {
  wallet: 'Wallets',
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
  color: string
}

type ForceNode = SimulationNodeDatum & LayoutNode

type ForceLink = SimulationLinkDatum<ForceNode> & {
  edge: TransferEdge
}

type PlacedEdge = {
  edge: TransferEdge
  path: string
  startX: number
  startY: number
  endX: number
  endY: number
  midX: number
  midY: number
  color: string
  sourceColor: string
  targetColor: string
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

type NodeKind = 'Contract' | 'EOA'

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

function parseHex(color: string): [number, number, number] {
  const raw = color.replace('#', '')
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : raw
  const value = Number.parseInt(expanded, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mixHex(color: string, target: string, ratio: number): string {
  const [red, green, blue] = parseHex(color)
  const [targetRed, targetGreen, targetBlue] = parseHex(target)
  const mix = (left: number, right: number) => Math.round(left + (right - left) * ratio)
  return `#${[mix(red, targetRed), mix(green, targetGreen), mix(blue, targetBlue)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function rgba(color: string, alpha: number): string {
  const [red, green, blue] = parseHex(color)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function hexKey(color: string): string {
  return color.replace('#', '')
}

function roleColor(role: HolderRole): string {
  return CLUSTER_COLORS_BY_ROLE[role]
}

function holderKind(role: HolderRole): NodeKind {
  return role === 'wallet' || role === 'demo' ? 'EOA' : 'Contract'
}

function displayLabel(holder: TokenHolder): string {
  return holder.role === 'wallet'
    ? shortenAddress(holder.owner, 5, 4)
    : holder.label
}

function edgeGradientId(edgeKey: string): string {
  return `wallet-map-edge-${hashString(edgeKey)}`
}

/** Cluster ids look like `C1`; the UI reads better as `Cluster 1`. */
function clusterLabel(id: string): string {
  return `Cluster ${id.replace(/^C/, '')}`
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
    const bend = edge.kind === 'curve' ? 0.1 : 0.17
    const midX = (startX + endX) / 2 - unitY * distance * bend * bendDirection
    const midY = (startY + endY) / 2 + unitX * distance * bend * bendDirection

    const sourceCluster = graph?.memberByOwner[source.holder.owner]
    const targetCluster = graph?.memberByOwner[target.holder.owner]
    const sharedCluster =
      sourceCluster && sourceCluster === targetCluster ? clusterById.get(sourceCluster) : null

    let sourceColor = source.color
    let targetColor = target.color
    let color = '#9fb6e8'
    if (edge.kind === 'wallet') {
      if (sharedCluster) {
        sourceColor = sharedCluster.color
        targetColor = sharedCluster.color
        color = sharedCluster.color
      }
    } else {
      const protocolRole =
        source.holder.role !== 'wallet' && source.holder.role !== 'demo'
          ? source.holder.role
          : target.holder.role
      color = roleColor(protocolRole)
      targetColor = color
    }

    const humanAmount = edge.amountNumber / 10 ** decimals
    const width =
      edge.kind === 'wallet'
        ? 1.2 + Math.min(4.4, Math.log10(1 + Math.max(0, humanAmount)) * 0.6)
        : 1 + Math.min(2.8, Math.log1p(edge.count) * 1.05)

    placed.push({
      edge,
      path: `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`,
      startX,
      startY,
      endX,
      endY,
      midX: 0.25 * startX + 0.5 * midX + 0.25 * endX,
      midY: 0.25 * startY + 0.5 * midY + 0.25 * endY,
      color,
      sourceColor,
      targetColor,
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
  const clusterById = new Map((graph?.clusters ?? []).map((cluster) => [cluster.id, cluster]))
  const colorFor = (holder: TokenHolder) => {
    const clusterId = graph?.memberByOwner[holder.owner]
    const cluster = clusterId ? clusterById.get(clusterId) : undefined
    return cluster?.color ?? roleColor(holder.role)
  }

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
    color: colorFor(holder),
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
      const spread = 78 + memberIndex * 24
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
    .force('charge', forceManyBody<ForceNode>().strength(-430))
    .force(
      'collide',
      forceCollide<ForceNode>()
        .radius((node) => node.radius + 16)
        .strength(1)
        .iterations(4),
    )
    .force('centerX', forceX<ForceNode>(WIDTH / 2).strength(0.055))
    .force('centerY', forceY<ForceNode>(HEIGHT / 2).strength(0.055))
    .force(
      'link',
      forceLink<ForceNode, ForceLink>(links)
        .id((node) => node.holder.owner)
        .distance((link) => {
          const source = link.source as ForceNode
          const target = link.target as ForceNode
          return source.radius + target.radius + 118
        })
        .strength(0.55),
    )
    .stop()

  simulation.tick(360)

  for (const node of nodes) {
    node.x = clamp(node.x ?? WIDTH / 2, node.radius + 40, WIDTH - node.radius - 40)
    node.y = clamp(node.y ?? HEIGHT / 2, node.radius + 58, HEIGHT - node.radius - 64)
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
        26
      const percent = clusterNodes.reduce((sum, node) => sum + node.holder.percent, 0)
      const label = `${clusterLabel(cluster.id)} · ${clusterNodes.length} wallets · ${formatHolderPercent(percent)}`
      const labelWidth = Math.max(122, label.length * 5.6 + 30)
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
  const [addressListOpen, setAddressListOpen] = useState(true)
  const [addressQuery, setAddressQuery] = useState('')
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
  const [lockedOwner, setLockedOwner] = useState<string | null>(null)
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
  }, [expanded, addressListOpen])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [expanded])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (isTyping) return

      if (event.key === 'l' || event.key === 'L') {
        if (lockedOwner) {
          setLockedOwner(null)
        } else {
          const next = hovered ?? selected
          if (next) setLockedOwner(next)
        }
      }

      if (event.key === 'Escape') {
        if (lockedOwner) {
          setLockedOwner(null)
          return
        }
        if (selected || selectedEdge) {
          setSelected(null)
          setSelectedEdge(null)
          return
        }
        if (expanded) setExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [expanded, hovered, lockedOwner, selected, selectedEdge])

  const holderByOwner = useMemo(
    () => new Map(holders.map((holder) => [holder.owner, holder])),
    [holders],
  )
  const colorByOwner = useMemo(
    () => new Map(layout.nodes.map((node) => [node.holder.owner, node.color])),
    [layout],
  )

  useEffect(() => {
    if (lockedOwner && !holderByOwner.has(lockedOwner)) setLockedOwner(null)
    if (selected && !holderByOwner.has(selected)) setSelected(null)
  }, [holderByOwner, lockedOwner, selected])

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

  const activeOwner = lockedOwner ?? hovered ?? selected
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

  const tierCounts = useMemo(
    () =>
      HOLDER_TIERS.map((tier) => ({
        tier,
        count: holders.filter((holder) => holder.tier === tier.key).length,
      })).filter((entry) => entry.count > 0),
    [holders],
  )

  const rankByOwner = useMemo(
    () => new Map(holders.map((holder, index) => [holder.owner, index + 1])),
    [holders],
  )

  const filteredHolders = useMemo(() => {
    const query = addressQuery.trim().toLowerCase()
    if (!query) return holders
    return holders.filter((holder) => {
      const tier = holderTier(holder.tier)
      return (
        holder.owner.toLowerCase().includes(query) ||
        holder.label.toLowerCase().includes(query) ||
        tier.label.toLowerCase().includes(query) ||
        holder.role.toLowerCase().includes(query)
      )
    })
  }, [addressQuery, holders])

  const allBubbleColors = useMemo(() => {
    const colors = new Set<string>()
    for (const node of layout.nodes) colors.add(node.color)
    for (const halo of layout.halos) colors.add(halo.color)
    return Array.from(colors)
  }, [layout])

  const edgeGradients = useMemo(
    () =>
      visibleEdges.map((placed) => ({
        id: edgeGradientId(placed.edge.key),
        from: placed.sourceColor,
        to: placed.targetColor,
        x1: placed.startX,
        y1: placed.startY,
        x2: placed.endX,
        y2: placed.endY,
      })),
    [visibleEdges],
  )

  const markerColors = useMemo(
    () =>
      Array.from(
        new Set([
          ...allBubbleColors,
          ...visibleEdges.map((placed) => placed.targetColor),
          '#9fb6e8',
        ]),
      ),
    [allBubbleColors, visibleEdges],
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
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (!target?.closest('.wallet-map__node')) {
      setSelected(null)
      setLockedOwner(null)
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

  function toggleLock() {
    if (lockedOwner) {
      setLockedOwner(null)
      return
    }
    const next = hovered ?? selected
    if (next) setLockedOwner(next)
  }

  function selectOwner(owner: string) {
    setSelected(owner)
    setLockedOwner(owner)
    setSelectedEdge(null)
  }

  const activeNodeColor = activeNode ? colorByOwner.get(activeNode.holder.owner) ?? null : null
  const activeStats = activeNode ? edgeStats.get(activeNode.holder.owner) : null
  const activeCluster = activeNode
    ? graph?.memberByOwner[activeNode.holder.owner]
    : undefined
  const activeTier = activeNode ? holderTier(activeNode.holder.tier) : null
  const activeTransfers =
    activeNode ? (activeStats?.count ?? 0) + (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const activeIsSupernode = activeTransfers >= SUPERNODE_TRANSFERS

  const tooltipStyle = activeNode
    ? (() => {
        const screenX = activeNode.x * view.scale + view.x
        const screenY = activeNode.y * view.scale + view.y
        const offset = activeNode.radius * view.scale + 14
        const below = screenY < HEIGHT * 0.42
        return {
          left: `${clamp((screenX / WIDTH) * 100, 15, 85)}%`,
          top: `${(screenY / HEIGHT) * 100}%`,
          transform: below
            ? `translate(-50%, ${offset}px)`
            : `translate(-50%, calc(-100% - ${offset}px))`,
        }
      })()
    : undefined

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

  const island = (
    <div className="wallet-map__island">
      <span className="wallet-map__island-logo" aria-hidden="true">
        <img src={KLYTH_LOGO_URL} alt="" />
      </span>
      <div className="wallet-map__island-body">
        <div className="wallet-map__island-top">
          <strong className="wallet-map__island-name">KLYTH</strong>
          <span className="wallet-map__island-chain">Solana Devnet</span>
        </div>
        <div className="wallet-map__island-stats">
          <span>
            <strong>{holders.length}</strong> holders
          </span>
          <span>
            <strong>{walletEdgeCount}</strong> wallet links
          </span>
          <span>
            <strong>{totalTrades}</strong> curve trades
          </span>
        </div>
        <div className="wallet-map__status">
          <span
            className={`wallet-map__status-dot${scanning ? ' is-pulsing' : ''}${
              scanError || scanRateLimited ? ' is-error' : ''
            }`}
            aria-hidden="true"
          />
          <span className="wallet-map__status-text">{statusText}</span>
        </div>
      </div>
    </div>
  )

  const canvas = (
    <div className="wallet-map__canvas">
      <svg
        ref={svgRef}
        className={`wallet-map__svg${dragging ? ' wallet-map__svg--dragging' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="KLYTH holder bubble map with on-chain transfer links"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          <radialGradient id="wallet-map-ambient" cx="50%" cy="46%" r="68%">
            <stop offset="0%" stopColor="#1a2c5e" stopOpacity="0.55" />
            <stop offset="48%" stopColor="#0b1430" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#04040b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wallet-map-vignette" cx="50%" cy="50%" r="72%">
            <stop offset="62%" stopColor="#04040b" stopOpacity="0" />
            <stop offset="100%" stopColor="#04040b" stopOpacity="0.72" />
          </radialGradient>
          <pattern
            id="wallet-map-grid"
            width="44"
            height="44"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 44 0 L 0 0 0 44"
              fill="none"
              stroke="rgba(110, 145, 220, 0.055)"
              strokeWidth="1"
            />
          </pattern>
          <filter
            id="wallet-map-node-glow"
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter
            id="wallet-map-soft-glow"
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
          >
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          {allBubbleColors.map((color) => {
            const key = hexKey(color)
            return (
              <radialGradient
                key={`bubble-${key}`}
                id={`wallet-map-bubble-${key}`}
                cx="33%"
                cy="25%"
                r="82%"
              >
                <stop offset="0%" stopColor={mixHex(color, '#ffffff', 0.46)} />
                <stop offset="38%" stopColor={color} />
                <stop offset="100%" stopColor={mixHex(color, '#04040b', 0.58)} />
              </radialGradient>
            )
          })}
          {layout.halos.map((halo) => {
            const key = hexKey(halo.color)
            return (
              <radialGradient
                key={`halo-${key}`}
                id={`wallet-map-halo-${key}`}
                cx="50%"
                cy="50%"
                r="50%"
              >
                <stop offset="0%" stopColor={halo.color} stopOpacity="0.18" />
                <stop offset="68%" stopColor={halo.color} stopOpacity="0.055" />
                <stop offset="100%" stopColor={halo.color} stopOpacity="0" />
              </radialGradient>
            )
          })}
          {edgeGradients.map((gradient) => (
            <linearGradient
              key={gradient.id}
              id={gradient.id}
              gradientUnits="userSpaceOnUse"
              x1={gradient.x1}
              y1={gradient.y1}
              x2={gradient.x2}
              y2={gradient.y2}
            >
              <stop offset="0%" stopColor={gradient.from} stopOpacity="0.65" />
              <stop offset="50%" stopColor={gradient.to} stopOpacity="0.95" />
              <stop offset="100%" stopColor={gradient.to} stopOpacity="0.65" />
            </linearGradient>
          ))}
          {markerColors.map((color) => (
            <marker
              key={color}
              id={`wallet-map-arrow-${hexKey(color)}`}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="7"
              markerHeight="7"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 6 3 L 0 6 z" fill={color} fillOpacity="0.9" />
            </marker>
          ))}
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="#04040b" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-ambient)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-grid)" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#wallet-map-vignette)" />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {layout.halos.map((halo) => (
            <g
              key={`halo-${halo.cluster.id}`}
              className="wallet-map__cluster wallet-map__cluster-halo"
            >
              <circle
                cx={halo.cx}
                cy={halo.cy}
                r={halo.radius}
                fill={`url(#wallet-map-halo-${hexKey(halo.color)})`}
              />
              <circle
                cx={halo.cx}
                cy={halo.cy}
                r={halo.radius}
                fill="none"
                stroke={halo.color}
                strokeOpacity={0.28}
                strokeWidth={1.1}
                strokeDasharray="2 8"
                className="wallet-map__cluster-ring"
              />
              <line
                className="wallet-map__cluster-stem"
                x1={halo.labelX + halo.labelWidth / 2}
                y1={halo.labelY + 24}
                x2={halo.labelX + halo.labelWidth / 2}
                y2={halo.cy - halo.radius}
                stroke={halo.color}
                strokeOpacity={0.38}
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
              activeOwner !== null ? placed.edge.owners.includes(activeOwner) : true
            const edgeActive = hoveredEdge === placed.edge.key || selectedEdge === placed.edge.key
            const dimmed =
              (activeOwner !== null && !incident) || (hoveredEdge !== null && !edgeActive)
            return (
              <g key={`edge-${placed.edge.key}`}>
                {edgeActive ? (
                  <path
                    d={placed.path}
                    fill="none"
                    stroke={placed.color}
                    strokeWidth={placed.width + 6}
                    strokeOpacity={0.22}
                    strokeLinecap="round"
                    filter="url(#wallet-map-soft-glow)"
                  />
                ) : null}
                <path
                  className={`wallet-map__edge${dimmed ? ' wallet-map__edge--dimmed' : ''}`}
                  d={placed.path}
                  fill="none"
                  stroke={`url(#${edgeGradientId(placed.edge.key)})`}
                  strokeWidth={placed.width}
                  strokeDasharray={placed.dashed ? '4 6' : undefined}
                  strokeOpacity={dimmed ? 0.05 : edgeActive ? 0.95 : 0.5}
                  strokeLinecap="round"
                  markerEnd={`url(#wallet-map-arrow-${hexKey(placed.targetColor)})`}
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
                  strokeWidth={16}
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
            const tier = holderTier(node.holder.tier)
            const percentSize = clamp(node.radius * 0.235, 10, 19)
            const showPercentInside = node.radius >= 24
            const showLabelInside = node.radius >= 52
            const showLabelOutside = node.radius >= 28 && !showLabelInside
            const showBadge = node.radius >= 30
            const label = displayLabel(node.holder)
            const transfers =
              (edgeStats.get(node.holder.owner)?.count ?? 0) +
              (tradeCounts.get(node.holder.owner) ?? 0)
            const isSupernode = transfers >= SUPERNODE_TRANSFERS

            return (
              <g
                key={node.holder.owner}
                className={`wallet-map__node${isActive ? ' wallet-map__node--active' : ''}${
                  lockedOwner === node.holder.owner ? ' wallet-map__node--locked' : ''
                }`}
                transform={`translate(${node.x} ${node.y})`}
                opacity={isDimmed ? 0.34 : 1}
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
                onClick={() => selectOwner(node.holder.owner)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectOwner(node.holder.owner)
                  }
                }}
              >
                <circle
                  r={node.radius + 12}
                  fill={node.color}
                  opacity={isActive ? 0.34 : 0.2}
                  filter="url(#wallet-map-node-glow)"
                  className="wallet-map__node-glow"
                  aria-hidden="true"
                />
                {isActive ? (
                  <>
                    <circle
                      r={node.radius + 7}
                      fill="none"
                      stroke={node.color}
                      strokeOpacity={0.5}
                      strokeWidth={2}
                      className="wallet-map__node-ring"
                      aria-hidden="true"
                    />
                    <circle
                      r={node.radius + 13}
                      fill="none"
                      stroke={node.color}
                      strokeOpacity={0.18}
                      strokeWidth={1}
                      aria-hidden="true"
                    />
                  </>
                ) : null}

                <g className="wallet-map__bubble">
                  <circle
                    className="wallet-map__bubble-body"
                    r={node.radius}
                    fill={`url(#wallet-map-bubble-${hexKey(node.color)})`}
                    stroke={rgba(node.color, 0.9)}
                    strokeWidth={1.4}
                  />
                  <circle
                    r={Math.max(0, node.radius - 1.4)}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.12)"
                    strokeWidth={1}
                    aria-hidden="true"
                  />
                  <ellipse
                    cx={-node.radius * 0.26}
                    cy={-node.radius * 0.34}
                    rx={node.radius * 0.42}
                    ry={node.radius * 0.24}
                    fill="rgba(255, 255, 255, 0.2)"
                    transform={`rotate(-26 ${-node.radius * 0.26} ${-node.radius * 0.34})`}
                    filter={node.radius >= 34 ? 'url(#wallet-map-soft-glow)' : undefined}
                    aria-hidden="true"
                  />
                </g>

                <text
                  textAnchor="middle"
                  y={showPercentInside ? percentSize * 0.34 : node.radius + 15}
                  className="wallet-map__bubble-percent"
                  style={{ fontSize: `${percentSize}px` }}
                >
                  {formatHolderPercent(node.holder.percent)}
                </text>

                {showLabelInside ? (
                  <text
                    textAnchor="middle"
                    y={percentSize * 0.34 + percentSize + 7}
                    className="wallet-map__node-label wallet-map__node-label--inside"
                  >
                    {label}
                  </text>
                ) : null}

                {!showLabelInside && (showLabelOutside || isActive) ? (
                  <text
                    textAnchor="middle"
                    y={showPercentInside ? node.radius + 16 : node.radius + 30}
                    className="wallet-map__node-label"
                  >
                    {label}
                  </text>
                ) : null}

                {showBadge ? (
                  <g
                    className="wallet-map__node-badge"
                    transform={`translate(${node.radius * 0.64} ${-node.radius * 0.64})`}
                    aria-hidden="true"
                  >
                    <circle r={9} fill="rgba(4, 4, 11, 0.82)" stroke={rgba(node.color, 0.7)} />
                    <text textAnchor="middle" y={3.5} className="wallet-map__bubble-tier">
                      {tier.emoji}
                    </text>
                  </g>
                ) : null}

                {isSupernode ? (
                  <g
                    className="wallet-map__node-badge"
                    transform={`translate(${node.radius * 0.64} ${node.radius * 0.64})`}
                    aria-hidden="true"
                  >
                    <circle r={9} fill="rgba(4, 4, 11, 0.82)" stroke="rgba(245, 181, 63, 0.7)" />
                    <text
                      textAnchor="middle"
                      y={3}
                      className="wallet-map__node-badge-text"
                    >
                      ⚡
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>

      {island}

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
        <span className="wallet-map__filter-sep" aria-hidden="true" />
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

      <div className="wallet-map__legend" aria-label="Holder clusters and tiers">
        <span className="wallet-map__legend-title">Clusters</span>
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
                style={{ background: cluster.color, boxShadow: `0 0 10px ${rgba(cluster.color, 0.7)}` }}
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

        {tierCounts.length > 0 ? (
          <>
            <span className="wallet-map__legend-title wallet-map__legend-title--spaced">
              Holder tiers
            </span>
            <div className="wallet-map__tier-row">
              {tierCounts.map(({ tier, count }) => (
                <span
                  key={tier.key}
                  className={`wallet-map__tier-chip wallet-map__tier-chip--${tier.key}`}
                  title={tier.rangeLabel}
                >
                  <span aria-hidden="true">{tier.emoji}</span>
                  {count}
                </span>
              ))}
            </div>
          </>
        ) : null}

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
            setLockedOwner(null)
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

      <button
        type="button"
        className={`wallet-map__hint${lockedOwner ? ' is-locked' : ''}`}
        onClick={toggleLock}
        disabled={!activeOwner}
        title={lockedOwner ? 'Unlock the selected bubble' : 'Lock the hovered bubble'}
      >
        {lockedOwner ? (
          <Unlock size={11} aria-hidden="true" />
        ) : (
          <Lock size={11} aria-hidden="true" />
        )}
        <kbd>L</kbd>
        <span>{lockedOwner ? 'locked' : 'to lock'}</span>
      </button>

      {activeNode ? (
        <div className="wallet-map__tooltip" style={tooltipStyle}>
          <div className="wallet-map__tooltip-head">
            <span
              className="wallet-map__tooltip-dot"
              style={{
                background: activeNodeColor ?? undefined,
                boxShadow: activeNodeColor
                  ? `0 0 10px ${rgba(activeNodeColor, 0.8)}`
                  : undefined,
              }}
              aria-hidden="true"
            />
            <span className="wallet-map__tooltip-name">{displayLabel(activeNode.holder)}</span>
            {activeCluster ? (
              <span className="wallet-map__tooltip-tag">{clusterLabel(activeCluster)}</span>
            ) : null}
          </div>
          <div className="wallet-map__tooltip-percent">
            {formatHolderPercent(activeNode.holder.percent)}
            <span> of supply</span>
          </div>
          <div className="wallet-map__tooltip-chips">
            <span className="wallet-map__tag">
              {activeTier?.emoji} {activeTier?.label}
            </span>
            <span className="wallet-map__tag">{holderKind(activeNode.holder.role)}</span>
            {activeIsSupernode ? (
              <span className="wallet-map__tag wallet-map__tag--hot">Supernode</span>
            ) : null}
          </div>
          <div className="wallet-map__tooltip-address">
            {shortenAddress(activeNode.holder.owner, 8, 8)}
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

  const addressList = addressListOpen ? (
    <aside className="wallet-map__addresses" aria-label="Address list">
      <div className="wallet-map__addresses-head">
        <div>
          <span className="wallet-map__addresses-title">Address List</span>
          <span className="wallet-map__addresses-count">{holders.length} holders</span>
        </div>
        <button
          type="button"
          className="wallet-map__addresses-toggle"
          onClick={() => setAddressListOpen(false)}
          aria-label="Hide address list"
          title="Hide address list"
        >
          <ChevronUp size={14} aria-hidden="true" />
        </button>
      </div>

      <label className="wallet-map__search">
        <Search size={12} aria-hidden="true" />
        <input
          value={addressQuery}
          onChange={(event) => setAddressQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search holder address"
          spellCheck={false}
          autoComplete="off"
        />
        {addressQuery ? (
          <button
            type="button"
            className="wallet-map__search-clear"
            onClick={() => setAddressQuery('')}
            aria-label="Clear address search"
          >
            ×
          </button>
        ) : null}
      </label>

      <ul className="wallet-map__addresses-list">
        {filteredHolders.map((holder) => {
          const tier = holderTier(holder.tier)
          const clusterId = graph?.memberByOwner[holder.owner]
          const color = colorByOwner.get(holder.owner) ?? roleColor(holder.role)
          const isActive = activeOwner === holder.owner
          const isLocked = lockedOwner === holder.owner
          const transfers =
            (edgeStats.get(holder.owner)?.count ?? 0) + (tradeCounts.get(holder.owner) ?? 0)

          return (
            <li key={holder.owner}>
              <button
                type="button"
                className={`wallet-map__address-row${isActive ? ' is-active' : ''}${
                  isLocked ? ' is-locked' : ''
                }`}
                onPointerEnter={() => setHovered(holder.owner)}
                onPointerLeave={() => setHovered(null)}
                onClick={() => {
                  if (isLocked) {
                    setLockedOwner(null)
                  } else {
                    selectOwner(holder.owner)
                  }
                }}
                title={`${holder.owner} · ${holder.amount} KLYTH · ${tier.rangeLabel}`}
              >
                <span className="wallet-map__address-rank">
                  #{rankByOwner.get(holder.owner) ?? 0}
                </span>
                <span
                  className="wallet-map__address-dot"
                  style={{
                    background: color,
                    boxShadow: `0 0 8px ${rgba(color, 0.7)}`,
                  }}
                  aria-hidden="true"
                />
                <span className="wallet-map__address-main">
                  <span className="wallet-map__address-label">
                    {displayLabel(holder)}
                  </span>
                  <span className="wallet-map__address-tags">
                    <span>{tier.emoji} {tier.label}</span>
                    {holder.role !== 'wallet' ? (
                      <span className="wallet-map__tag wallet-map__tag--mini">
                        {holderKind(holder.role)}
                      </span>
                    ) : null}
                    {transfers >= SUPERNODE_TRANSFERS ? (
                      <span className="wallet-map__tag wallet-map__tag--mini wallet-map__tag--hot">
                        Supernode
                      </span>
                    ) : null}
                    {clusterId ? (
                      <span className="wallet-map__tag wallet-map__tag--mini">
                        {clusterId}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="wallet-map__address-percent">
                  {formatHolderPercent(holder.percent)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {filteredHolders.length === 0 ? (
        <p className="wallet-map__addresses-empty">No holder matches “{addressQuery}”.</p>
      ) : null}

      <div className="wallet-map__addresses-foot">
        {graph
          ? `${graph.parsedTransactions}/${graph.scannedSignatures} txs parsed${
              graph.truncated ? ' · capped' : ''
            }`
          : 'Transfer scan pending'}
      </div>
    </aside>
  ) : (
    <button
      type="button"
      className="wallet-map__addresses-open"
      onClick={() => setAddressListOpen(true)}
      aria-label="Show address list"
      title="Show address list"
    >
      <List size={15} aria-hidden="true" />
      <span>Addresses</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
  )

  const details = (
    <div className="wallet-map__details" aria-live="polite">
      {activeNode ? (
        <>
          <span
            className="wallet-map__detail-swatch"
            style={{
              background: activeNodeColor ?? undefined,
              boxShadow: activeNodeColor
                ? `0 0 12px ${rgba(activeNodeColor, 0.8)}`
                : undefined,
            }}
            aria-hidden="true"
          />
          <div className="wallet-map__detail-main">
            <span className="data-label">
              {activeTier?.emoji} {displayLabel(activeNode.holder)}
              {activeCluster ? ` · ${clusterLabel(activeCluster)}` : ''}
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
            <span className="wallet-map__tag">{holderKind(activeNode.holder.role)}</span>
            {activeIsSupernode ? (
              <span className="wallet-map__tag wallet-map__tag--hot">Supernode</span>
            ) : null}
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
          Bubble area follows each wallet&apos;s share of supply. Solid links are parsed
          wallet-to-wallet SPL transfers; dashed links are bonding-curve flows. Hover any
          bubble or line to inspect the on-chain trace, then press <kbd>L</kbd> to lock it.
        </p>
      )}
    </div>
  )

  const stage = (
    <div className="wallet-map__stage">
      {canvas}
      {addressList}
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
            <div className="wallet-map-portal__identity">
              <span className="wallet-map-portal__logo" aria-hidden="true">
                <img src={KLYTH_LOGO_URL} alt="" />
              </span>
              <div>
                <span className="data-label">KLYTH holder map</span>
                <strong className="wallet-map-portal__title">
                  {holders.length} holders · {walletEdgeCount} wallet transfer links
                </strong>
              </div>
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
            {stage}
            {details}
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <div className="wallet-map">
      {stage}
      {details}
    </div>
  )
}
