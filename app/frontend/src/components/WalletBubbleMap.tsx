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
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import {
  ExternalLink,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Unlock,
  X,
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

/** World units of the SVG scene. The canvas stretches this box with `meet`. */
const WIDTH = 1000
const HEIGHT = 700
const MAX_BUBBLE_RADIUS = 56
const MIN_BUBBLE_RADIUS = 18
const HUB_RADIUS = 62
const SUPERNODE_TRANSFERS = 100

/** SIDARA-style palette: one calm hue per protocol role. */
const CLUSTER_COLORS_BY_ROLE: Record<HolderRole, string> = {
  wallet: '#4ADE80',
  vault: '#6366F1',
  burn: '#F87171',
  treasury: '#FBBF24',
  demo: '#A78BFA',
}

const ROLE_LABELS: Record<HolderRole, string> = {
  wallet: 'Unlinked wallets',
  vault: 'Curve vault',
  burn: 'Burn reserve',
  treasury: 'Treasury',
  demo: 'Demo wallet',
}

const HUB_COLOR = '#6366F1'

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

type Layout = {
  nodes: LayoutNode[]
  edges: PlacedEdge[]
}

type ViewState = {
  x: number
  y: number
  scale: number
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

/**
 * Deterministic idle drift: same wallet always floats along the same path, so
 * the layout stays stable across renders and only the phase changes.
 */
function driftOffset(
  owner: string,
  radius: number,
  phaseMs: number,
): { x: number; y: number } {
  const t = phaseMs / 1000
  const seed = (hashString(owner) / 4294967295) * Math.PI * 2
  const amplitude = 3.5 + radius * 0.07
  return {
    x:
      Math.cos(t * 0.38 + seed) * amplitude +
      Math.cos(t * 0.91 + seed * 1.7) * amplitude * 0.2,
    y:
      Math.sin(t * 0.31 + seed * 1.3) * amplitude * 0.85 +
      Math.sin(t * 0.73 + seed) * amplitude * 0.18,
  }
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

function isNarrowViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 900px)').matches
  )
}

function svgPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  // `preserveAspectRatio="xMidYMid meet"` keeps the world box centred and
  // uniformly scaled inside the element.
  const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT)
  const renderedWidth = WIDTH * scale
  const renderedHeight = HEIGHT * scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale,
  }
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
  const hubX = WIDTH / 2
  const hubY = HEIGHT / 2

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
    const bend = edge.kind === 'curve' ? 0.1 : 0.18
    let midX = (startX + endX) / 2 - unitY * distance * bend * bendDirection
    let midY = (startY + endY) / 2 + unitX * distance * bend * bendDirection

    // Never let a link cut straight through the KLYTH hub.
    const hubDeltaX = midX - hubX
    const hubDeltaY = midY - hubY
    const hubDistance = Math.hypot(hubDeltaX, hubDeltaY)
    const safeHubDistance = HUB_RADIUS + 34
    if (hubDistance < safeHubDistance) {
      const angle =
        hubDistance < 0.001 ? Math.PI / 2 : Math.atan2(hubDeltaY, hubDeltaX)
      midX = hubX + Math.cos(angle) * safeHubDistance
      midY = hubY + Math.sin(angle) * safeHubDistance
    }

    const sourceCluster = graph?.memberByOwner[source.holder.owner]
    const targetCluster = graph?.memberByOwner[target.holder.owner]
    const sharedCluster =
      sourceCluster && sourceCluster === targetCluster ? clusterById.get(sourceCluster) : null

    let sourceColor = source.color
    let targetColor = target.color
    let color = '#A5B4FC'
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
    return { nodes: [], edges: [] }
  }

  const holderByOwner = new Map(holders.map((holder) => [holder.owner, holder]))
  const maxPercent = Math.max(...holders.map((holder) => holder.percent), 0.0001)
  const radiusFor = (percent: number) =>
    MIN_BUBBLE_RADIUS +
    (MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS) *
      Math.sqrt(Math.max(percent, 0) / maxPercent)

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
    const leftPercent = left.reduce(
      (sum, owner) => sum + (holderByOwner.get(owner)?.percent ?? 0),
      0,
    )
    const rightPercent = right.reduce(
      (sum, owner) => sum + (holderByOwner.get(owner)?.percent ?? 0),
      0,
    )
    return rightPercent - leftPercent
  })

  const ringRadius = clamp(170 + Math.sqrt(holders.length) * 16, 195, 330)
  const nodes: ForceNode[] = holders.map((holder, index) => {
    const angle =
      -Math.PI / 2 +
      (index / Math.max(1, holders.length)) * Math.PI * 2 +
      (hashString(holder.owner) / 4294967295 - 0.5) * 0.22
    return {
      holder,
      x: WIDTH / 2 + Math.cos(angle) * ringRadius,
      y: HEIGHT / 2 + Math.sin(angle) * ringRadius,
      radius: radiusFor(holder.percent),
      color: colorFor(holder),
    }
  })
  const nodeByOwner = new Map(nodes.map((node) => [node.holder.owner, node]))

  // Seed cluster members near their strongest sibling so linked wallets form
  // a readable local group before the simulation settles.
  groups.forEach((group) => {
    if (group.length < 2) return
    const anchor = nodeByOwner.get(group[0])
    if (!anchor) return
    group.slice(1).forEach((owner, memberIndex) => {
      const node = nodeByOwner.get(owner)
      if (!node) return
      const angle =
        (memberIndex / Math.max(1, group.length - 1)) * Math.PI * 2 +
        (hashString(group.join('|')) / 4294967295 - 0.5) * 0.4
      const spread = 72 + memberIndex * 16
      node.x = anchor.x + Math.cos(angle) * spread
      node.y = anchor.y + Math.sin(angle) * spread
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
    .force('charge', forceManyBody<ForceNode>().strength(-560))
    .force(
      'collide',
      forceCollide<ForceNode>()
        .radius((node) => node.radius + (node.radius >= 44 ? 32 : 22))
        .strength(1)
        .iterations(4),
    )
    .force(
      'radial',
      forceRadial<ForceNode>(ringRadius, WIDTH / 2, HEIGHT / 2).strength(0.34),
    )
    .force('centerX', forceX<ForceNode>(WIDTH / 2).strength(0.02))
    .force('centerY', forceY<ForceNode>(HEIGHT / 2).strength(0.02))
    .force(
      'link',
      forceLink<ForceNode, ForceLink>(links)
        .id((node) => node.holder.owner)
        .distance((link) => {
          const source = link.source as ForceNode
          const target = link.target as ForceNode
          return source.radius + target.radius + 90
        })
        .strength(0.5),
    )
    .stop()

  simulation.tick(320)

  const hubX = WIDTH / 2
  const hubY = HEIGHT / 2
  for (const node of nodes) {
    node.x = clamp(node.x ?? hubX, node.radius + 54, WIDTH - node.radius - 54)
    node.y = clamp(node.y ?? hubY, node.radius + 72, HEIGHT - node.radius - 72)

    const deltaX = node.x - hubX
    const deltaY = node.y - hubY
    const distance = Math.hypot(deltaX, deltaY)
    const minDistance = HUB_RADIUS + node.radius + 22
    if (distance < minDistance) {
      const angle =
        distance < 0.001
          ? (hashString(node.holder.owner) / 4294967295) * Math.PI * 2
          : Math.atan2(deltaY, deltaX)
      node.x = hubX + Math.cos(angle) * minDistance
      node.y = hubY + Math.sin(angle) * minDistance
    }
  }

  const edges = buildPlacedEdges(nodes, graph?.edges ?? [], graph, decimals)

  return { nodes, edges }
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
  const [addressQuery, setAddressQuery] = useState('')
  const [sideOpen, setSideOpen] = useState(
    () => typeof window === 'undefined' || !isNarrowViewport(),
  )
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [lockedOwner, setLockedOwner] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1 })
  const [motionPhase, setMotionPhase] = useState(0)
  const [draggingOwner, setDraggingOwner] = useState<string | null>(null)
  const [dragOffsets, setDragOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({})

  const svgRef = useRef<SVGSVGElement>(null)
  const viewRef = useRef<ViewState>(view)
  const animationRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const autoShiftedRef = useRef(false)
  const motionPhaseRef = useRef(0)
  const draggingOwnerRef = useRef<string | null>(null)
  const displayNodesRef = useRef<LayoutNode[]>([])
  const reactionRef = useRef<{
    owner: string
    x: number
    y: number
    radius: number
    strength: number
  } | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
    nodeOwner: string | null
    nodeOriginX: number
    nodeOriginY: number
    nodeX: number
    nodeY: number
  } | null>(null)
  const settleRef = useRef<{
    owner: string
    fromX: number
    fromY: number
    toX: number
    toY: number
    progress: number
  } | null>(null)

  const layout = useMemo(
    () => computeLayout(holders, graph, decimals),
    [holders, graph, decimals],
  )

  // Gentle idle drift keeps the map alive like the SIDARA monitor while the
  // base layout stays deterministic. Edges are rebuilt from the animated
  // positions so links never detach from their bubbles.
  useEffect(() => {
    let frame = 0
    let last = 0
    const step = (now: number) => {
      if (now - last >= 33) {
        last = now
        motionPhaseRef.current = now
        const reaction = reactionRef.current
        if (reaction) {
          // Ramp the neighbour push up while dragging, then ease it back so
          // released bubbles settle instead of snapping.
          const target = draggingOwnerRef.current === reaction.owner ? 1 : 0
          reaction.strength += (target - reaction.strength) * 0.22
          if (reaction.strength < 0.02) reactionRef.current = null
        }
        const settle = settleRef.current
        if (settle) {
          settle.progress = Math.min(1, settle.progress + 0.14)
          const k = 1 - Math.pow(1 - settle.progress, 3)
          setDragOffsets((current) => ({
            ...current,
            [settle.owner]: {
              x: settle.fromX + (settle.toX - settle.fromX) * k,
              y: settle.fromY + (settle.toY - settle.fromY) * k,
            },
          }))
          if (settle.progress >= 1) settleRef.current = null
        }
        setMotionPhase(now)
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])

  const displayNodes = useMemo(() => {
    const positioned = layout.nodes.map((node) => {
      const owner = node.holder.owner
      const offset = dragOffsets[owner] ?? { x: 0, y: 0 }
      if (owner === draggingOwner) {
        // Freeze drift under the pointer so the bubble tracks the cursor
        // exactly while it is being dragged.
        return { ...node, x: node.x + offset.x, y: node.y + offset.y }
      }
      const drift = driftOffset(owner, node.radius, motionPhase)
      return {
        ...node,
        x: node.x + offset.x + drift.x,
        y: node.y + offset.y + drift.y,
      }
    })

    const reaction = reactionRef.current
    if (!reaction || reaction.strength <= 0.02) return positioned

    // Other bubbles gently make room while a neighbour is dragged.
    return positioned.map((node) => {
      if (node.holder.owner === reaction.owner) return node
      const dx = node.x - reaction.x
      const dy = node.y - reaction.y
      const distance = Math.hypot(dx, dy)
      if (distance < 0.001) return node
      const influence = node.radius + reaction.radius + 72
      const soft =
        Math.pow(Math.max(0, 1 - distance / influence), 2) *
        20 *
        reaction.strength
      // Hard floor so a bubble dragged straight into a neighbour cannot
      // overlap it while the push ramps up.
      const collision =
        Math.max(0, node.radius + reaction.radius + 8 - distance) *
        reaction.strength
      const push = Math.max(soft, collision)
      if (push < 0.05) return node
      return {
        ...node,
        x: node.x + (dx / distance) * push,
        y: node.y + (dy / distance) * push,
      }
    })
  }, [layout, dragOffsets, draggingOwner, motionPhase])

  useEffect(() => {
    displayNodesRef.current = displayNodes
  }, [displayNodes])


  const displayEdges = useMemo(
    () => buildPlacedEdges(displayNodes, graph?.edges ?? [], graph, decimals),
    [displayNodes, graph, decimals],
  )

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

  function commitView(next: ViewState) {
    viewRef.current = next
    setView(next)
  }

  function cancelViewAnimation() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }

  function animateView(
    target: ViewState,
    duration = 720,
    follow?: () => ViewState | null,
  ) {
    cancelViewAnimation()
    const from = viewRef.current
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration)
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const current = follow?.() ?? target
      commitView({
        x: from.x + (current.x - from.x) * k,
        y: from.y + (current.y - from.y) * k,
        scale: from.scale + (current.scale - from.scale) * k,
      })
      if (t < 1) {
        animationRef.current = requestAnimationFrame(step)
      } else {
        animationRef.current = null
      }
    }
    step()
  }

  useEffect(() => () => cancelViewAnimation(), [])

  // React attaches wheel handlers passively, so zoom needs a native listener.
  useEffect(() => {
    const element = svgRef.current
    if (!element) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      cancelViewAnimation()
      const rect = element.getBoundingClientRect()
      const point = svgPoint(event.clientX, event.clientY, rect)
      const previous = viewRef.current
      const scale = clamp(
        previous.scale * Math.exp(-event.deltaY * 0.0015),
        0.55,
        3.4,
      )
      const ratio = scale / previous.scale
      commitView({
        scale,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      })
    }

    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [expanded])

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
          setSelected(null)
        } else {
          const next = hovered ?? selected
          if (next) {
            setLockedOwner(next)
            setSelected(next)
          }
        }
      }

      if (event.key === 'Escape') {
        if (lockedOwner) {
          setLockedOwner(null)
          setSelected(null)
          return
        }
        if (selected || selectedEdge) {
          setSelected(null)
          setSelectedEdge(null)
          return
        }
        if (sideOpen && isNarrowViewport()) {
          setSideOpen(false)
          return
        }
        if (expanded) setExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [expanded, hovered, lockedOwner, selected, selectedEdge, sideOpen])

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

  // Selection drives map emphasis; hover only drives the tooltip so the map
  // never dims just because the pointer crossed a bubble.
  const selectionOwner = lockedOwner ?? selected
  const tooltipOwner = dragging ? null : hovered ?? selectionOwner
  const activeNode =
    layout.nodes.find((node) => node.holder.owner === tooltipOwner) ?? null
  const activeTrades = activeNode ? (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const activeEdge =
    (hoveredEdge ?? selectedEdge)
      ? graph?.edges.find((edge) => edge.key === (hoveredEdge ?? selectedEdge)) ?? null
      : null

  const visibleEdges = displayEdges.filter((placed) => {
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

  const searchActive = addressQuery.trim().length > 0
  const matchedOwners = useMemo(
    () => new Set(filteredHolders.map((holder) => holder.owner)),
    [filteredHolders],
  )

  const allBubbleColors = useMemo(() => {
    const colors = new Set<string>([HUB_COLOR])
    for (const node of layout.nodes) colors.add(node.color)
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
        new Set([...visibleEdges.map((placed) => placed.targetColor), '#A5B4FC']),
      ),
    [visibleEdges],
  )

  const ambientDots = useMemo(
    () =>
      Array.from({ length: 34 }, (_, index) => {
        const hash = hashString(`klyth-ambient-${index}`)
        return {
          key: `ambient-${index}`,
          x: hash % WIDTH,
          y: (hash >>> 10) % HEIGHT,
          r: 0.6 + ((hash >>> 20) % 26) / 10,
          alpha: 0.05 + ((hash >>> 24) % 10) / 100,
          delay: `${((hash >>> 27) % 60) / 10}s`,
        }
      }),
    [],
  )

  function zoomBy(factor: number) {
    cancelViewAnimation()
    const previous = viewRef.current
    const scale = clamp(previous.scale * factor, 0.55, 3.4)
    const ratio = scale / previous.scale
    commitView({
      scale,
      x: WIDTH / 2 - (WIDTH / 2 - previous.x) * ratio,
      y: HEIGHT / 2 - (HEIGHT / 2 - previous.y) * ratio,
    })
  }

  function focusOwner(owner: string) {
    const node = layout.nodes.find((item) => item.holder.owner === owner)
    if (!node) return
    const scale = node.radius >= 44 ? 1.18 : 1.36
    // Keep the focused bubble centred while drift is still moving it.
    const follow = () => {
      const live = displayNodesRef.current.find(
        (item) => item.holder.owner === owner,
      )
      if (!live) return null
      return {
        scale,
        x: WIDTH / 2 - live.x * scale,
        y: HEIGHT / 2 - live.y * scale,
      }
    }
    const target = follow()
    if (!target) return
    animateView(target, 760, follow)
  }

  function resetMap() {
    setSelected(null)
    setLockedOwner(null)
    setSelectedEdge(null)
    setHovered(null)
    setHoveredEdge(null)
    setDraggingOwner(null)
    draggingOwnerRef.current = null
    reactionRef.current = null
    settleRef.current = null
    setDragOffsets({})
    animateView({ x: 0, y: 0, scale: 1 }, 640)
  }

  function selectOwner(owner: string) {
    if (lockedOwner === owner) {
      resetMap()
      return
    }
    setSelected(owner)
    setLockedOwner(owner)
    setSelectedEdge(null)
    focusOwner(owner)
    if (isNarrowViewport()) setSideOpen(false)
  }

  function toggleLock() {
    if (lockedOwner) {
      setLockedOwner(null)
      setSelected(null)
      return
    }
    const next = hovered ?? selected
    if (next) {
      setLockedOwner(next)
      setSelected(next)
      focusOwner(next)
    }
  }

  function resolveDropOffset(
    owner: string,
    x: number,
    y: number,
  ): { x: number; y: number } {
    const node = layout.nodes.find((item) => item.holder.owner === owner)
    if (!node) return { x, y }
    const resolved = { x, y }
    // Nudge the dropped bubble out of any overlap so releasing it on top of a
    // neighbour does not leave two bubbles stacked forever.
    for (let pass = 0; pass < 8; pass += 1) {
      let moved = false
      for (const other of layout.nodes) {
        if (other.holder.owner === owner) continue
        const otherOffset = dragOffsets[other.holder.owner] ?? { x: 0, y: 0 }
        const drift = driftOffset(
          other.holder.owner,
          other.radius,
          motionPhaseRef.current,
        )
        const otherX = other.x + otherOffset.x + drift.x
        const otherY = other.y + otherOffset.y + drift.y
        const centerX = node.x + resolved.x
        const centerY = node.y + resolved.y
        let dx = centerX - otherX
        let dy = centerY - otherY
        const distance = Math.hypot(dx, dy)
        const minimum = node.radius + other.radius + 8
        if (distance >= minimum) continue
        if (distance < 0.001) {
          dx = 1
          dy = 0
        }
        const length = Math.hypot(dx, dy) || 1
        resolved.x += (dx / length) * (minimum - distance)
        resolved.y += (dy / length) * (minimum - distance)
        moved = true
      }
      if (!moved) break
    }
    const margin = node.radius + 10
    resolved.x = clamp(resolved.x, margin - node.x, WIDTH - margin - node.x)
    resolved.y = clamp(resolved.y, margin - node.y, HEIGHT - margin - node.y)
    return resolved
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    cancelViewAnimation()
    settleRef.current = null
    const target = event.target as Element | null
    const nodeOwner =
      target?.closest('.wallet-map__node')?.getAttribute('data-owner') ?? null
    if (!target?.closest('.wallet-map__node, .wallet-map__hub, .wallet-map__edge-hit')) {
      setSelected(null)
      setLockedOwner(null)
      setSelectedEdge(null)
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const start = svgPoint(event.clientX, event.clientY, rect)
    const existingOffset = nodeOwner ? dragOffsets[nodeOwner] : null
    const node = nodeOwner
      ? layout.nodes.find((item) => item.holder.owner === nodeOwner)
      : null
    // Bake the current drift into the drag origin so freezing the idle motion
    // does not make the bubble jump on pointerdown.
    const drift =
      nodeOwner && node
        ? driftOffset(nodeOwner, node.radius, motionPhaseRef.current)
        : { x: 0, y: 0 }
    const originX = (existingOffset?.x ?? 0) + drift.x
    const originY = (existingOffset?.y ?? 0) + drift.y
    dragRef.current = {
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
      nodeOwner,
      nodeOriginX: originX,
      nodeOriginY: originY,
      nodeX: originX,
      nodeY: originY,
    }
    if (nodeOwner && node) {
      setDraggingOwner(nodeOwner)
      draggingOwnerRef.current = nodeOwner
      setHovered(null)
      reactionRef.current = {
        owner: nodeOwner,
        x: node.x + originX,
        y: node.y + originY,
        radius: node.radius,
        strength: reactionRef.current?.strength ?? 0,
      }
    }
    setDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const current = svgPoint(event.clientX, event.clientY, rect)
    const deltaX = current.x - drag.startX
    const deltaY = current.y - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) {
      drag.moved = true
      // Capture only once a real drag starts. Capturing on pointerdown retargets
      // the follow-up click to the SVG root, which would swallow bubble clicks.
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    if (!drag.moved) return
    if (drag.nodeOwner) {
      const node = layout.nodes.find(
        (item) => item.holder.owner === drag.nodeOwner,
      )
      if (!node) return
      const scale = viewRef.current.scale || 1
      const margin = node.radius + 10
      const nextX = clamp(
        drag.nodeOriginX + deltaX / scale,
        margin - node.x,
        WIDTH - margin - node.x,
      )
      const nextY = clamp(
        drag.nodeOriginY + deltaY / scale,
        margin - node.y,
        HEIGHT - margin - node.y,
      )
      reactionRef.current = {
        owner: drag.nodeOwner,
        x: node.x + nextX,
        y: node.y + nextY,
        radius: node.radius,
        strength: reactionRef.current?.strength ?? 0,
      }
      drag.nodeX = nextX
      drag.nodeY = nextY
      setDragOffsets((currentOffsets) => ({
        ...currentOffsets,
        [drag.nodeOwner as string]: { x: nextX, y: nextY },
      }))
      return
    }
    commitView({
      ...viewRef.current,
      x: clamp(drag.originX + deltaX, -WIDTH * 0.45, WIDTH * 0.45),
      y: clamp(drag.originY + deltaY, -HEIGHT * 0.45, HEIGHT * 0.45),
    })
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (drag?.pointerId === event.pointerId) {
      suppressClickRef.current = drag.moved
      if (drag.moved) {
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      dragRef.current = null
      setDragging(false)
      if (drag.nodeOwner) {
        if (drag.moved) {
          const resolved = resolveDropOffset(
            drag.nodeOwner,
            drag.nodeX,
            drag.nodeY,
          )
          if (
            Math.abs(resolved.x - drag.nodeX) > 0.5 ||
            Math.abs(resolved.y - drag.nodeY) > 0.5
          ) {
            // Ease the collision nudge instead of teleporting on drop.
            settleRef.current = {
              owner: drag.nodeOwner,
              fromX: drag.nodeX,
              fromY: drag.nodeY,
              toX: resolved.x,
              toY: resolved.y,
              progress: 0,
            }
          }
        }
        setDraggingOwner(null)
        draggingOwnerRef.current = null
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
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

  const edgeColor = activeEdge
    ? visibleEdges.find((item) => item.edge.key === activeEdge.key)?.color ?? '#A5B4FC'
    : '#A5B4FC'

  const tooltipAnchor = pointer ?? {
    x: typeof window === 'undefined' ? 320 : window.innerWidth * 0.56,
    y: 120,
  }
  const tooltipStyle = {
    left: `${clamp(tooltipAnchor.x + 16, 12, Math.max(12, window.innerWidth - 276))}px`,
    top: `${clamp(tooltipAnchor.y + 16, 12, Math.max(12, window.innerHeight - 230))}px`,
  }

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
        ? `${holders.length} holders · ${walletEdgeCount} wallet link${
            walletEdgeCount === 1 ? '' : 's'
          } · ${graph.edges.length} flow${graph.edges.length === 1 ? '' : 's'}${
            graph.failedTransactions > 0
              ? ` · ${graph.failedTransactions} limited`
              : ''
          }`
        : `${holders.length} holders · ${totalTrades} curve trades`

  const footText = graph
    ? `${graph.parsedTransactions}/${graph.scannedSignatures} txs parsed${
        graph.failedTransactions > 0
          ? ` · ${graph.failedTransactions} rate-limited`
          : ''
      }${graph.truncated ? ' · window capped' : ''}${
        walletEdgeCount === 0 && graph.edges.length > 0 ? ' · curve-only window' : ''
      }`
    : scanning
      ? 'Scanning transfer paths…'
      : 'Transfer scan pending'

  const legendEntries = [
    ...clusterLegend.map(({ cluster, percent }) => ({
      key: `legend-${cluster.id}`,
      color: cluster.color,
      label: `${clusterLabel(cluster.id)} · ${cluster.walletCount} · ${formatHolderPercent(percent)}`,
    })),
    ...Array.from(unclusteredByRole.entries()).map(([role, entry]) => ({
      key: `role-${role}`,
      color: roleColor(role),
      label: `${ROLE_LABELS[role]}${entry.count > 1 ? ` · ${entry.count}` : ''}`,
    })),
  ]

  const side = (
    <aside className={`wallet-map__side${sideOpen ? ' is-open' : ''}`} aria-label="Holder list">
      <div className="wallet-map__side-head">
        <span className="wallet-map__side-logo" aria-hidden="true">
          <img src={KLYTH_LOGO_URL} alt="" />
        </span>
        <div className="wallet-map__side-brand">
          <b>KLYTH</b>
          <small>Holder map</small>
        </div>
        <div className="wallet-map__side-actions">
          {expanded ? (
            <button
              type="button"
              className="wallet-map__icon-btn"
              onClick={() => setExpanded(false)}
              aria-label="Exit full screen map"
              title="Exit full screen"
            >
              <Minimize2 size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="wallet-map__side-close wallet-map__icon-btn"
            onClick={() => setSideOpen(false)}
            aria-label="Hide holder list"
            title="Hide holder list"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="wallet-map__side-sec">
        <div className="wallet-map__list-head">
          <span className="wallet-map__side-label">Holders</span>
          <span className="wallet-map__side-count">
            {searchActive
              ? `${filteredHolders.length} of ${holders.length}`
              : `${holders.length} holder${holders.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <label className="wallet-map__search">
          <Search size={13} aria-hidden="true" />
          <input
            value={addressQuery}
            onChange={(event) => setAddressQuery(event.target.value)}
            placeholder="Search holder, address, tier…"
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
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      <div className="wallet-map__list">
        {filteredHolders.length === 0 ? (
          <p className="wallet-map__empty">No holder matches “{addressQuery}”.</p>
        ) : (
          <ul>
            {filteredHolders.map((holder) => {
              const tier = holderTier(holder.tier)
              const clusterId = graph?.memberByOwner[holder.owner]
              const color = colorByOwner.get(holder.owner) ?? roleColor(holder.role)
              const isActive = lockedOwner === holder.owner || selected === holder.owner
              const transfers =
                (edgeStats.get(holder.owner)?.count ?? 0) +
                (tradeCounts.get(holder.owner) ?? 0)
              const isSupernode = transfers >= SUPERNODE_TRANSFERS

              return (
                <li
                  key={holder.owner}
                  className={`wallet-map__item${isActive ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="wallet-map__item-btn"
                    onPointerEnter={() => setHovered(holder.owner)}
                    onPointerLeave={() => setHovered(null)}
                    onClick={() => selectOwner(holder.owner)}
                    title={`${holder.owner} · ${holder.amount} KLYTH · ${tier.rangeLabel}`}
                  >
                    <span className="wallet-map__field" data-label="Holder">
                      <span className="wallet-map__value">{displayLabel(holder)}</span>
                    </span>
                    <span className="wallet-map__field" data-label="Share">
                      <span className="wallet-map__value wallet-map__value--mono">
                        {formatHolderPercent(holder.percent)}
                      </span>
                    </span>
                    <span className="wallet-map__field" data-label="Tier">
                      <span
                        className="wallet-map__value wallet-map__value--tier"
                        style={{ color }}
                      >
                        {tier.emoji} {tier.label}
                      </span>
                    </span>
                    <span className="wallet-map__field" data-label="Balance">
                      <span className="wallet-map__value wallet-map__value--mono">
                        {holder.amount}
                      </span>
                    </span>
                  </button>

                  {isActive ? (
                    <div className="wallet-map__item-detail">
                      <a
                        className="wallet-map__item-address"
                        href={explorerAddressUrl(holder.owner)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {shortenAddress(holder.owner, 10, 8)}
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                      <div className="wallet-map__item-stats">
                        <span>
                          <strong>{edgeStats.get(holder.owner)?.count ?? 0}</strong>
                          {(edgeStats.get(holder.owner)?.count ?? 0) === 1 ? ' link' : ' links'}
                        </span>
                        <span>
                          <strong>{tradeCounts.get(holder.owner) ?? 0}</strong> curve
                        </span>
                        <span className="wallet-map__tag">{holderKind(holder.role)}</span>
                        {clusterId ? (
                          <span className="wallet-map__tag">{clusterLabel(clusterId)}</span>
                        ) : null}
                        {isSupernode ? (
                          <span className="wallet-map__tag wallet-map__tag--hot">Supernode</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="wallet-map__side-foot">
        <div className="wallet-map__foot-status">
          <span
            className={`wallet-map__foot-dot${scanning ? ' is-pulsing' : ''}${
              scanError || scanRateLimited ? ' is-error' : ''
            }`}
            aria-hidden="true"
          />
          <span className="wallet-map__foot-text">{footText}</span>
        </div>
        <div className="wallet-map__foot-hint">
          <kbd>L</kbd> lock bubble · <kbd>Esc</kbd> clear
        </div>
      </div>
    </aside>
  )

  const canvas = (
    <div className="wallet-map__canvas">
      <button
        type="button"
        className="wallet-map__side-toggle"
        onClick={() => setSideOpen(true)}
        aria-label="Show holder list"
        title="Show holder list"
      >
        <Menu size={15} aria-hidden="true" />
        <span>Holders</span>
      </button>

      {sideOpen ? (
        <button
          type="button"
          className="wallet-map__side-scrim"
          onClick={() => setSideOpen(false)}
          aria-label="Close holder list"
          tabIndex={-1}
        />
      ) : null}

      <svg
        ref={svgRef}
        className={`wallet-map__svg${dragging ? ' wallet-map__svg--dragging' : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="KLYTH holder bubble map with on-chain transfer links"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          <radialGradient id="wallet-map-ambient" cx="50%" cy="46%" r="68%">
            <stop offset="0%" stopColor="#141f3d" stopOpacity="0.55" />
            <stop offset="52%" stopColor="#0a1022" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#060A13" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wallet-map-vignette" cx="50%" cy="50%" r="74%">
            <stop offset="58%" stopColor="#060A13" stopOpacity="0" />
            <stop offset="100%" stopColor="#060A13" stopOpacity="0.7" />
          </radialGradient>
          <pattern
            id="wallet-map-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(59, 130, 246, 0.06)"
              strokeWidth="1"
            />
          </pattern>
          {allBubbleColors.map((color) => {
            const key = hexKey(color)
            return (
              <radialGradient
                key={`glow-${key}`}
                id={`wallet-map-glow-${key}`}
                cx="50%"
                cy="50%"
                r="50%"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
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
              <stop offset="0%" stopColor={gradient.from} stopOpacity="0.55" />
              <stop offset="50%" stopColor={gradient.to} stopOpacity="0.9" />
              <stop offset="100%" stopColor={gradient.to} stopOpacity="0.55" />
            </linearGradient>
          ))}
          {markerColors.map((color) => (
            <marker
              key={color}
              id={`wallet-map-arrow-${hexKey(color)}`}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="6.5"
              markerHeight="6.5"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 6 3 L 0 6 z" fill={color} fillOpacity="0.85" />
            </marker>
          ))}
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="#060A13" />

        <g className="wallet-map__ambient" aria-hidden="true">
          {ambientDots.map((dot) => (
            <circle
              key={dot.key}
              cx={dot.x}
              cy={dot.y}
              r={dot.r}
              fill={`rgba(129, 140, 248, ${dot.alpha})`}
              className="wallet-map__ambient-dot"
              style={{ animationDelay: dot.delay }}
            />
          ))}
        </g>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <rect
            x={-WIDTH}
            y={-HEIGHT}
            width={WIDTH * 3}
            height={HEIGHT * 3}
            fill="url(#wallet-map-grid)"
          />
          <rect
            x={-WIDTH}
            y={-HEIGHT}
            width={WIDTH * 3}
            height={HEIGHT * 3}
            fill="url(#wallet-map-ambient)"
          />

          {visibleEdges.map((placed) => {
            const incident =
              selectionOwner !== null ? placed.edge.owners.includes(selectionOwner) : true
            const edgeActive = hoveredEdge === placed.edge.key || selectedEdge === placed.edge.key
            const searchRelevant =
              !searchActive ||
              placed.edge.owners.some((owner) => matchedOwners.has(owner))
            const dimmed =
              !searchRelevant ||
              (selectionOwner !== null && !incident) ||
              (hoveredEdge !== null && !edgeActive)
            const opacity = dimmed
              ? 0.05
              : edgeActive
                ? 0.92
                : selectionOwner !== null && incident
                  ? 0.72
                  : 0.4

            return (
              <g key={`edge-${placed.edge.key}`}>
                {edgeActive ? (
                  <path
                    d={placed.path}
                    fill="none"
                    stroke={placed.color}
                    strokeWidth={placed.width + 7}
                    strokeOpacity={0.2}
                    strokeLinecap="round"
                    strokeDasharray={placed.dashed ? '4 7' : undefined}
                  />
                ) : null}
                <path
                  className={`wallet-map__edge${dimmed ? ' wallet-map__edge--dimmed' : ''}`}
                  d={placed.path}
                  fill="none"
                  stroke={`url(#${edgeGradientId(placed.edge.key)})`}
                  strokeWidth={placed.width}
                  strokeDasharray={placed.dashed ? '4 7' : undefined}
                  strokeOpacity={opacity}
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
                  onPointerEnter={(event) => {
                    setHoveredEdge(placed.edge.key)
                    setPointer({ x: event.clientX, y: event.clientY })
                  }}
                  onPointerMove={(event) =>
                    setPointer({ x: event.clientX, y: event.clientY })
                  }
                  onPointerLeave={() => setHoveredEdge(null)}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (suppressClickRef.current) return
                    setSelectedEdge((current) =>
                      current === placed.edge.key ? null : placed.edge.key,
                    )
                  }}
                />
              </g>
            )
          })}

          <g
            className="wallet-map__hub"
            transform={`translate(${WIDTH / 2} ${HEIGHT / 2})`}
            role="button"
            tabIndex={0}
            aria-label={`KLYTH hub, ${holders.length} holders`}
            onClick={resetMap}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                resetMap()
              }
            }}
          >
            <circle
              className="wallet-map__hub-orbit"
              r={HUB_RADIUS + 12}
              fill="none"
              stroke={HUB_COLOR}
              strokeOpacity={0.2}
              strokeWidth={2}
              aria-hidden="true"
            />
            <circle
              r={HUB_RADIUS}
              fill={`url(#wallet-map-glow-${hexKey(HUB_COLOR)})`}
              opacity={0.75}
              aria-hidden="true"
            />
            <circle
              r={HUB_RADIUS}
              fill="none"
              stroke={HUB_COLOR}
              strokeOpacity={0.6}
              strokeWidth={2.5}
            />
            <text y={-6} className="wallet-map__hub-name">
              KLYTH
            </text>
            <text y={12} className="wallet-map__hub-sub">
              {holders.length} holders
            </text>
          </g>

          {displayNodes.map((node) => {
            const isActive = selectionOwner === node.holder.owner
            const matchesSearch =
              !searchActive || matchedOwners.has(node.holder.owner)
            const isDimmed =
              !matchesSearch || (selectionOwner !== null && !isActive)
            const tier = holderTier(node.holder.tier)
            const percentSize = clamp(node.radius * 0.3, 10, 17)
            const label = displayLabel(node.holder)
            // Keep the name inside only when the bubble is wide enough for the
            // actual label; long role names move below the bubble instead.
            const nameCapacity = Math.floor((node.radius * 2 - 14) / 5.6)
            const showNameInside = node.radius >= 36 && label.length <= nameCapacity
            const transfers =
              (edgeStats.get(node.holder.owner)?.count ?? 0) +
              (tradeCounts.get(node.holder.owner) ?? 0)
            const isSupernode = transfers >= SUPERNODE_TRANSFERS
            const nameY = showNameInside ? -6 : node.radius + 14
            const percentY = showNameInside ? 10 : 0
            const metaY = showNameInside ? node.radius + 12 : node.radius + 26
            const key = hexKey(node.color)
            const strokeWidth = isActive ? 2.5 : node.radius >= 30 ? 1.5 : 1
            const bodyOpacity = isActive ? 1 : 0.6

            return (
              <g
                key={node.holder.owner}
                className={`wallet-map__node${isActive ? ' wallet-map__node--active' : ''}${
                  lockedOwner === node.holder.owner ? ' wallet-map__node--locked' : ''
                }`}
                transform={`translate(${node.x} ${node.y})`}
                opacity={isDimmed ? 0.2 : 1}
                data-owner={node.holder.owner}
                role="button"
                tabIndex={0}
                aria-label={`${tier.emoji} ${tier.label} ${node.holder.label} ${shortenAddress(
                  node.holder.owner,
                  4,
                  4,
                )}, ${formatHolderPercent(node.holder.percent)} of supply`}
                onPointerEnter={(event) => {
                  setHovered(node.holder.owner)
                  setPointer({ x: event.clientX, y: event.clientY })
                }}
                onPointerMove={(event) =>
                  setPointer({ x: event.clientX, y: event.clientY })
                }
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.holder.owner)}
                onBlur={() => setHovered(null)}
                onClick={(event) => {
                  event.stopPropagation()
                  if (suppressClickRef.current) return
                  selectOwner(node.holder.owner)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectOwner(node.holder.owner)
                  }
                }}
              >
                {isActive ? (
                  <>
                    <circle
                      className="wallet-map__node-halo"
                      r={node.radius + 20}
                      fill={node.color}
                      fillOpacity={0.08}
                      aria-hidden="true"
                    />
                    <circle
                      className="wallet-map__node-selection"
                      r={node.radius + 14}
                      fill="none"
                      stroke={node.color}
                      strokeOpacity={0.45}
                      strokeWidth={3}
                      aria-hidden="true"
                    />
                  </>
                ) : !isDimmed ? (
                  <circle
                    className="wallet-map__node-orbit"
                    r={node.radius + 8}
                    fill="none"
                    stroke={node.color}
                    strokeOpacity={0.12}
                    strokeWidth={1}
                    aria-hidden="true"
                  />
                ) : null}
                <circle
                  r={node.radius}
                  fill={`url(#wallet-map-glow-${key})`}
                  opacity={isActive ? 1 : 0.4}
                  aria-hidden="true"
                />
                <circle
                  className="wallet-map__bubble-body"
                  r={node.radius}
                  fill="none"
                  stroke={node.color}
                  strokeOpacity={bodyOpacity}
                  strokeWidth={strokeWidth}
                />
                <circle
                  r={node.radius * 0.25}
                  fill={node.color}
                  opacity={0.1}
                  aria-hidden="true"
                />

                <text
                  textAnchor="middle"
                  y={percentY}
                  className="wallet-map__node-percent"
                  style={{ fontSize: `${percentSize}px` }}
                >
                  {formatHolderPercent(node.holder.percent)}
                </text>

                <text
                  textAnchor="middle"
                  y={nameY}
                  className="wallet-map__node-name"
                  style={{ fill: node.color }}
                >
                  {label}
                </text>

                <text
                  textAnchor="middle"
                  y={metaY}
                  className="wallet-map__node-meta"
                >
                  {tier.emoji} {tier.label}
                  {isSupernode ? ' · ⚡' : ''}
                </text>
              </g>
            )
          })}
        </g>

        <rect
          width={WIDTH}
          height={HEIGHT}
          fill="url(#wallet-map-vignette)"
          pointerEvents="none"
        />
      </svg>

      <div className="wallet-map__overlay">
        <div className="wallet-map__filters" role="group" aria-label="Transfer edge filter">
          {(
            [
              ['all', 'All flows'],
              ['wallet', 'Wallets'],
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
          {legendEntries.length === 0 ? (
            <span className="wallet-map__legend-empty">
              {scanning
                ? 'Scanning transfer paths…'
                : scanRateLimited
                  ? 'Transfer scan rate-limited · retry above'
                  : 'No wallet-to-wallet links yet'}
            </span>
          ) : (
            legendEntries.map((entry) => (
              <span className="wallet-map__legend-item" key={entry.key}>
                <span
                  className="wallet-map__legend-dot"
                  style={{ background: entry.color }}
                  aria-hidden="true"
                />
                <span className="wallet-map__legend-label">{entry.label}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="wallet-map__status" role="status">
        <span
          className={`wallet-map__status-dot${scanning ? ' is-pulsing' : ''}${
            scanError || scanRateLimited ? ' is-error' : ''
          }`}
          aria-hidden="true"
        />
        <span className="wallet-map__status-text">{statusText}</span>
      </div>

      <div className="wallet-map__controls">
        <button
          type="button"
          className="icon-button"
          onClick={toggleLock}
          disabled={!tooltipOwner}
          aria-label={lockedOwner ? 'Unlock the selected bubble' : 'Lock the hovered bubble'}
          title={lockedOwner ? 'Unlock bubble (L)' : 'Lock bubble (L)'}
        >
          {lockedOwner ? (
            <Unlock size={13} aria-hidden="true" />
          ) : (
            <Lock size={13} aria-hidden="true" />
          )}
        </button>
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
          onClick={resetMap}
          aria-label="Reset map view"
          title="Reset view"
        >
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Exit full screen map' : 'Open full screen map'}
          title={expanded ? 'Exit full screen' : 'Full screen'}
        >
          {expanded ? (
            <Minimize2 size={13} aria-hidden="true" />
          ) : (
            <Maximize2 size={13} aria-hidden="true" />
          )}
        </button>
      </div>

      {activeNode ? (
        <div className="wallet-map__tooltip" style={tooltipStyle} aria-live="polite">
          <div className="wallet-map__tooltip-head">
            <span
              className="wallet-map__tooltip-dot"
              style={{
                background: activeNodeColor ?? undefined,
                boxShadow: activeNodeColor
                  ? `0 0 10px ${rgba(activeNodeColor, 0.7)}`
                  : undefined,
              }}
              aria-hidden="true"
            />
            <span
              className="wallet-map__tooltip-name"
              style={{ color: activeNodeColor ?? undefined }}
            >
              {displayLabel(activeNode.holder)}
            </span>
            {activeCluster ? (
              <span className="wallet-map__tooltip-tag">{clusterLabel(activeCluster)}</span>
            ) : null}
          </div>
          <div className="wallet-map__tooltip-percent">
            {formatHolderPercent(activeNode.holder.percent)}
            <span> of supply</span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Balance</span>
            <span className="wallet-map__tooltip-value">
              {activeNode.holder.amount} KLYTH
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Tier</span>
            <span className="wallet-map__tooltip-value">
              {activeTier?.emoji} {activeTier?.label}
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Type</span>
            <span className="wallet-map__tooltip-value">
              {holderKind(activeNode.holder.role)}
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Wallet links</span>
            <span className="wallet-map__tooltip-value">{activeStats?.count ?? 0}</span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Transferred</span>
            <span className="wallet-map__tooltip-value">
              {formatTokenAmount((activeStats?.volumeRaw ?? 0n).toString(), decimals)} KLYTH
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Curve trades</span>
            <span className="wallet-map__tooltip-value">{activeTrades}</span>
          </div>
          {activeIsSupernode ? (
            <div className="wallet-map__tooltip-chips">
              <span className="wallet-map__tag wallet-map__tag--hot">Supernode</span>
            </div>
          ) : null}
          <div className="wallet-map__tooltip-address">
            {shortenAddress(activeNode.holder.owner, 8, 8)}
          </div>
        </div>
      ) : activeEdge ? (
        <div className="wallet-map__tooltip" style={tooltipStyle} aria-live="polite">
          <div className="wallet-map__tooltip-head">
            <span
              className="wallet-map__tooltip-dot"
              style={{ background: edgeColor, boxShadow: `0 0 10px ${rgba(edgeColor, 0.7)}` }}
              aria-hidden="true"
            />
            <span className="wallet-map__tooltip-name" style={{ color: edgeColor }}>
              {activeEdge.kind === 'wallet' ? 'Wallet transfer' : 'Curve flow'}
            </span>
            <span className="wallet-map__tooltip-tag">
              {activeEdge.count} tx
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">From</span>
            <span className="wallet-map__tooltip-value">
              {shortenAddress(activeEdge.from, 6, 4)}
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">To</span>
            <span className="wallet-map__tooltip-value">
              {shortenAddress(activeEdge.to, 6, 4)}
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Volume</span>
            <span className="wallet-map__tooltip-value">
              {activeEdge.amount} KLYTH
            </span>
          </div>
          <div className="wallet-map__tooltip-row">
            <span className="wallet-map__tooltip-label">Direction</span>
            <span className="wallet-map__tooltip-value">
              {activeEdge.directions.map((direction) => `${direction.count}×`).join(' · ')}
            </span>
          </div>
          <a
            className="wallet-map__tooltip-address wallet-map__tooltip-address--link"
            href={explorerTxUrl(activeEdge.directions[0].lastSignature)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  )

  const stage = (
    <div className="wallet-map__stage">
      {side}
      {canvas}
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
        <div className="wallet-map-portal__panel">{stage}</div>
      </div>,
      document.body,
    )
  }

  return <div className="wallet-map">{stage}</div>
}
