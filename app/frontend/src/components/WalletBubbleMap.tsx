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
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import {
  ExternalLink,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Unlock,
} from 'lucide-react'
import { explorerTxUrl, shortenAddress } from '../lib/addresses'
import {
  formatHolderPercent,
  holderTier,
  isContractWallet,
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

/** World units of the canvas scene. The viewport stretches this box with `meet`. */
const WIDTH = 1000
const HEIGHT = 700
const MAX_BUBBLE_RADIUS = 56
const MIN_BUBBLE_RADIUS = 18
const HUB_RADIUS = 62
const SUPERNODE_TRANSFERS = 100
const GRID_STEP = 40
const TAU = Math.PI * 2
const GRID_STROKE = 'rgba(224, 166, 75, 0.07)'
const FONT_SANS =
  "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const ZERO_OFFSET = { x: 0, y: 0 }

/** SIDARA-style palette: one calm hue per protocol role. */
const CLUSTER_COLORS_BY_ROLE: Record<HolderRole, string> = {
  wallet: '#4ADE80',
  vault: '#2DD4BF',
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

const HUB_COLOR = '#E0A64B'
/** Warm neutral for links that do not belong to a cluster or protocol role. */
const DEFAULT_EDGE_COLOR = '#B99A6B'

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

/**
 * Live physics node. Home is the settled layout position; d3 springs the node
 * back to it after a drag, exactly like the SIDARA bubble monitor.
 */
type SimNode = SimulationNodeDatum &
  LayoutNode & {
    /** Current spring target; hub dragging shifts this away from rest. */
    homeX: number
    homeY: number
    /** Settled layout position, kept so the hub can pull and release cleanly. */
    restX: number
    restY: number
  }

type SimLink = SimulationLinkDatum<SimNode> & {
  edge: TransferEdge
}

type PlacedEdge = {
  edge: TransferEdge
  startX: number
  startY: number
  endX: number
  endY: number
  /** Quadratic control point; sits on the line for straight links. */
  controlX: number
  controlY: number
  straight: boolean
  color: string
  sourceColor: string
  targetColor: string
  width: number
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

type AmbientDot = {
  x: number
  y: number
  r: number
  alpha: number
}

type BubbleParticle = {
  /** Starting angle around the bubble centre, in radians. */
  angle: number
  /** Orbit radius as a fraction of the bubble radius. */
  orbit: number
  /** Angular speed in radians per second; negative spins the other way. */
  speed: number
  size: number
  /** Vertical squash so the orbit feels like a drifting ellipse. */
  squash: number
  /** Per-particle offset that desynchronises every speck's pulse. */
  phase: number
  /** Irrational-ish multiplier so breathing never falls into lockstep. */
  harmonic: number
}

type DrawState = {
  layout: Layout
  graph: TransferGraph | null
  decimals: number
  edgeMode: EdgeMode
  selectionOwner: string | null
  hoveredEdge: string | null
  selectedEdge: string | null
  reduceMotion: boolean
  ambientDots: AmbientDot[]
  particles: Map<string, BubbleParticle[]>
  supernodes: Set<string>
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

/**
 * Small specks that orbit inside each bubble. Seeded from the owner address so
 * every wallet keeps its own constellation and nothing jitters between frames.
 */
function bubbleParticles(owner: string, radius: number): BubbleParticle[] {
  const count = radius >= 52 ? 9 : radius >= 34 ? 7 : radius >= 22 ? 5 : 4
  const particles: BubbleParticle[] = []
  for (let index = 0; index < count; index += 1) {
    const hash = hashString(`${owner}:${index}`)
    particles.push({
      angle: ((hash & 0xffff) / 0xffff) * TAU,
      orbit: 0.34 + (((hash >>> 7) & 0xff) / 255) * 0.5,
      speed:
        (index % 2 === 0 ? 1 : -1) *
        (0.5 + (((hash >>> 12) & 0xff) / 255) * 1.15),
      size: 1.1 + (((hash >>> 16) & 0xff) / 255) * 2.1,
      squash: 0.5 + (((hash >>> 24) & 0xff) / 255) * 0.44,
      phase: (((hash >>> 3) & 0xff) / 255) * TAU,
      harmonic: 1.4 + (((hash >>> 20) & 0xff) / 255) * 2.2,
    })
  }
  return particles
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

function roleColor(role: HolderRole): string {
  return CLUSTER_COLORS_BY_ROLE[role]
}

function holderKind(role: HolderRole): NodeKind {
  return isContractWallet(role) ? 'Contract' : 'EOA'
}

function displayLabel(holder: TokenHolder): string {
  return holder.role === 'wallet'
    ? shortenAddress(holder.owner, 5, 4)
    : holder.label
}

/** Cluster ids look like `C1`; the UI reads better as `Cluster 1`. */
function clusterLabel(id: string): string {
  return `Cluster ${id.replace(/^C/, '')}`
}

type FitBox = {
  scale: number
  offsetX: number
  offsetY: number
}

function fitBox(width: number, height: number): FitBox {
  const scale = Math.min(width / WIDTH, height / HEIGHT)
  return {
    scale,
    offsetX: (width - WIDTH * scale) / 2,
    offsetY: (height - HEIGHT * scale) / 2,
  }
}

/** Element-local coordinates to the untransformed viewBox coordinate space. */
function viewBoxPoint(
  localX: number,
  localY: number,
  fit: FitBox,
): { x: number; y: number } {
  return {
    x: (localX - fit.offsetX) / fit.scale,
    y: (localY - fit.offsetY) / fit.scale,
  }
}

/** viewBox coordinates to the layout/world space under the camera transform. */
function toWorld(
  point: { x: number; y: number },
  view: ViewState,
): { x: number; y: number } {
  const scale = view.scale || 1
  return {
    x: (point.x - view.x) / scale,
    y: (point.y - view.y) / scale,
  }
}

function distanceToSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= 0.0001) {
    return Math.hypot(pointX - startX, pointY - startY)
  }
  const t = clamp(
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
    0,
    1,
  )
  return Math.hypot(pointX - (startX + deltaX * t), pointY - (startY + deltaY * t))
}

function distanceToEdge(
  pointX: number,
  pointY: number,
  placed: PlacedEdge,
): number {
  const samples = placed.straight ? 1 : 10
  let previousX = placed.startX
  let previousY = placed.startY
  let best = Number.POSITIVE_INFINITY

  for (let index = 1; index <= samples; index += 1) {
    const t = index / samples
    const inverse = 1 - t
    const x =
      inverse * inverse * placed.startX +
      2 * inverse * t * placed.controlX +
      t * t * placed.endX
    const y =
      inverse * inverse * placed.startY +
      2 * inverse * t * placed.controlY +
      t * t * placed.endY
    best = Math.min(
      best,
      distanceToSegment(pointX, pointY, previousX, previousY, x, y),
    )
    previousX = x
    previousY = y
  }

  return best
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
    // Curve-flow links are drawn as plain straight strokes so the vault leg
    // reads as a normal connection instead of a dashed arc.
    const straight = edge.kind === 'curve'
    const bend = 0.18
    let controlX = (startX + endX) / 2
    let controlY = (startY + endY) / 2

    if (!straight) {
      controlX -= unitY * distance * bend * bendDirection
      controlY += unitX * distance * bend * bendDirection

      // Never let a link cut straight through the KLYTH hub.
      const hubDeltaX = controlX - hubX
      const hubDeltaY = controlY - hubY
      const hubDistance = Math.hypot(hubDeltaX, hubDeltaY)
      const safeHubDistance = HUB_RADIUS + 34
      if (hubDistance < safeHubDistance) {
        const angle =
          hubDistance < 0.001 ? Math.PI / 2 : Math.atan2(hubDeltaY, hubDeltaX)
        controlX = hubX + Math.cos(angle) * safeHubDistance
        controlY = hubY + Math.sin(angle) * safeHubDistance
      }
    }

    const sourceCluster = graph?.memberByOwner[source.holder.owner]
    const targetCluster = graph?.memberByOwner[target.holder.owner]
    const sharedCluster =
      sourceCluster && sourceCluster === targetCluster ? clusterById.get(sourceCluster) : null

    let sourceColor = source.color
    let targetColor = target.color
    let color = DEFAULT_EDGE_COLOR
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
      startX,
      startY,
      endX,
      endY,
      controlX,
      controlY,
      straight,
      color,
      sourceColor,
      targetColor,
      width,
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

function traceEdge(context: CanvasRenderingContext2D, placed: PlacedEdge) {
  context.beginPath()
  context.moveTo(placed.startX, placed.startY)
  if (placed.straight) {
    context.lineTo(placed.endX, placed.endY)
  } else {
    context.quadraticCurveTo(
      placed.controlX,
      placed.controlY,
      placed.endX,
      placed.endY,
    )
  }
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
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [lockedOwner, setLockedOwner] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [reduceMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawStateRef = useRef<DrawState | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const viewRef = useRef<ViewState>({ x: 0, y: 0, scale: 1 })
  const viewAnimationRef = useRef<number | null>(null)
  const dirtyRef = useRef(true)
  const visibleRef = useRef(true)
  const autoShiftedRef = useRef(false)
  const draggingOwnerRef = useRef<string | null>(null)
  const displayNodesRef = useRef<LayoutNode[]>([])
  const displayEdgesRef = useRef<PlacedEdge[]>([])
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const simNodesRef = useRef(new Map<string, SimNode>())
  const simRunningRef = useRef(false)
  /** Live position of the KLYTH hub in world space; it starts centred. */
  const hubRef = useRef({ x: WIDTH / 2, y: HEIGHT / 2 })
  /** Ease-back animation for the hub after a drag. */
  const hubAnimationRef = useRef<{
    fromX: number
    fromY: number
    start: number
  } | null>(null)
  /** Drives the post-drag convergence until every bubble is back home. */
  const hubReturnRef = useRef<{ start: number } | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
    nodeOwner: string | null
    /** True when this gesture drags the central KLYTH hub instead of a bubble. */
    hub: boolean
    /** Pointer offset from the hub centre, in world units. */
    hubGrabX: number
    hubGrabY: number
    /** True once the bubble physics has been woken for this gesture. */
    pinned: boolean
    /** Pointer offset from the bubble centre, in world units. */
    grabX: number
    grabY: number
    /** Last pinned world position, kept so a mid-drag rebuild can restore it. */
    targetX: number | null
    targetY: number | null
  } | null>(null)

  const layout = useMemo(
    () => computeLayout(holders, graph, decimals),
    [holders, graph, decimals],
  )
  const layoutByOwner = useMemo(
    () => new Map(layout.nodes.map((node) => [node.holder.owner, node])),
    [layout],
  )

  // SIDARA-style live physics. The simulation is built once per layout and only
  // ticked while the user is dragging or a bubble is easing back home, so idle
  // frames stay as cheap as before.
  useEffect(() => {
    const simNodes: SimNode[] = layout.nodes.map((node) => ({
      ...node,
      homeX: node.x,
      homeY: node.y,
      restX: node.x,
      restY: node.y,
    }))
    const nodeByOwner = new Map(
      simNodes.map((node) => [node.holder.owner, node]),
    )
    const links: SimLink[] = (graph?.edges ?? [])
      .filter(
        (edge) =>
          edge.kind === 'wallet' &&
          nodeByOwner.has(edge.owners[0]) &&
          nodeByOwner.has(edge.owners[1]),
      )
      .map((edge) => ({
        source: nodeByOwner.get(edge.owners[0]) as SimNode,
        target: nodeByOwner.get(edge.owners[1]) as SimNode,
        edge,
      }))

    const simulation = forceSimulation<SimNode>(simNodes)
      // Link distance equals the settled home distance, so the link force is
      // zero while bubbles rest in place and only tugs during a drag.
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((node) => node.holder.owner)
          .distance((link) => {
            const source = link.source as SimNode
            const target = link.target as SimNode
            const distance = Math.hypot(
              target.homeX - source.homeX,
              target.homeY - source.homeY,
            )
            return distance > 0
              ? distance
              : source.radius + target.radius + 90
          })
          .strength(0.02),
      )
      .force(
        'collide',
        forceCollide<SimNode>()
          .radius((node) => node.radius + (node.radius >= 44 ? 26 : 18))
          .strength(1)
          .iterations(3),
      )
      .force('x', forceX<SimNode>((node) => node.homeX).strength(0.85))
      .force('y', forceY<SimNode>((node) => node.homeY).strength(0.85))
      // forceX/forceY cache their targets at initialize, so a separate force is
      // needed for the hub pull: it reads the live hub position every tick and
      // nudges the whole constellation toward a distance-weighted offset.
      .force('hub', (alpha: number) => {
        const hub = hubRef.current
        const deltaX = hub.x - WIDTH / 2
        const deltaY = hub.y - HEIGHT / 2
        if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) return
        const reach = Math.hypot(WIDTH, HEIGHT)
        for (const node of simNodes) {
          const distance = Math.hypot(
            node.restX - WIDTH / 2,
            node.restY - HEIGHT / 2,
          )
          const pull = (0.92 - 0.5 * clamp(distance / reach, 0, 1)) * 0.85
          node.vx = (node.vx ?? 0) + deltaX * pull * alpha
          node.vy = (node.vy ?? 0) + deltaY * pull * alpha
        }
      })
      .alphaDecay(0.05)
      .velocityDecay(0.7)
      .alphaMin(0.001)
      .stop()
    // Never let the very first tick apply full alpha to a settled layout.
    simulation.alpha(0)

    simulationRef.current = simulation
    simNodesRef.current = nodeByOwner

    // Keep an in-flight drag alive when the graph refreshes mid-gesture.
    const drag = dragRef.current
    if (drag?.hub) {
      simulation.alpha(0.25).alphaTarget(0.25)
      simRunningRef.current = true
    }
    const dragOwner = drag?.pinned ? drag.nodeOwner : null
    const dragNode = dragOwner ? nodeByOwner.get(dragOwner) : null
    if (dragNode) {
      const targetX = drag?.targetX ?? dragNode.homeX
      const targetY = drag?.targetY ?? dragNode.homeY
      dragNode.x = targetX
      dragNode.y = targetY
      dragNode.fx = targetX
      dragNode.fy = targetY
      simulation.alpha(0.2).alphaTarget(0.3)
      simRunningRef.current = true
    } else {
      simRunningRef.current = false
    }

    return () => {
      simulation.stop()
      if (simulationRef.current === simulation) {
        simulationRef.current = null
      }
    }
  }, [layout, graph])

  const holderByOwner = useMemo(
    () => new Map(holders.map((holder) => [holder.owner, holder])),
    [holders],
  )

  const ambientDots = useMemo<AmbientDot[]>(
    () =>
      Array.from({ length: 34 }, (_, index) => {
        const hash = hashString(`klyth-ambient-${index}`)
        return {
          x: hash % WIDTH,
          y: (hash >>> 10) % HEIGHT,
          r: 0.6 + ((hash >>> 20) % 26) / 10,
          alpha: 0.05 + ((hash >>> 24) % 10) / 100,
        }
      }),
    [],
  )

  const particles = useMemo(() => {
    const result = new Map<string, BubbleParticle[]>()
    for (const node of layout.nodes) {
      result.set(
        node.holder.owner,
        bubbleParticles(node.holder.owner, node.radius),
      )
    }
    return result
  }, [layout])

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

  const supernodes = useMemo(() => {
    const result = new Set<string>()
    for (const node of layout.nodes) {
      const owner = node.holder.owner
      const transfers =
        (edgeStats.get(owner)?.count ?? 0) + (tradeCounts.get(owner) ?? 0)
      if (transfers >= SUPERNODE_TRANSFERS) result.add(owner)
    }
    return result
  }, [layout, edgeStats, tradeCounts])

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

  useEffect(() => {
    if (lockedOwner && !holderByOwner.has(lockedOwner)) setLockedOwner(null)
    if (selected && !holderByOwner.has(selected)) setSelected(null)
  }, [holderByOwner, lockedOwner, selected])

  // Keep the imperative renderer in sync with the latest props and UI state.
  useEffect(() => {
    drawStateRef.current = {
      layout,
      graph,
      decimals,
      edgeMode,
      selectionOwner,
      hoveredEdge,
      selectedEdge,
      reduceMotion,
      ambientDots,
      particles,
      supernodes,
    }
    dirtyRef.current = true
  })

  function cancelViewAnimation() {
    if (viewAnimationRef.current !== null) {
      cancelAnimationFrame(viewAnimationRef.current)
      viewAnimationRef.current = null
    }
  }

  function animateView(
    target: ViewState,
    duration = 720,
    follow?: () => ViewState | null,
  ) {
    cancelViewAnimation()
    const from = { ...viewRef.current }
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration)
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const current = follow?.() ?? target
      viewRef.current = {
        x: from.x + (current.x - from.x) * k,
        y: from.y + (current.y - from.y) * k,
        scale: from.scale + (current.scale - from.scale) * k,
      }
      dirtyRef.current = true
      if (t < 1) {
        viewAnimationRef.current = requestAnimationFrame(step)
      } else {
        viewAnimationRef.current = null
      }
    }
    step()
  }

  useEffect(() => () => cancelViewAnimation(), [])

  // Canvas keeps every camera change inside the rAF loop: wheel and drag no
  // longer re-render React, which is what made the SVG camera feel heavy.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      cancelViewAnimation()
      const { width, height } = sizeRef.current
      const fit = fitBox(width, height)
      const point = viewBoxPoint(event.offsetX, event.offsetY, fit)
      const previous = viewRef.current
      const scale = clamp(
        previous.scale * Math.exp(-event.deltaY * 0.0015),
        0.55,
        3.4,
      )
      const ratio = scale / previous.scale
      viewRef.current = {
        scale,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      }
      dirtyRef.current = true
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        sizeRef.current = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }
      }
      dirtyRef.current = true
    })
    observer.observe(canvas)
    const rect = canvas.getBoundingClientRect()
    sizeRef.current = { width: rect.width, height: rect.height }
    const visibility = new IntersectionObserver((entries) => {
      visibleRef.current = entries[0]?.isIntersecting ?? true
      dirtyRef.current = true
    })
    visibility.observe(canvas)
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
      observer.disconnect()
      visibility.disconnect()
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [expanded])

  function computeDisplayNodes(now: number, state: DrawState): LayoutNode[] {
    const phase = state.reduceMotion ? 0 : now
    const dragOwner = draggingOwnerRef.current
    const simNodes = simNodesRef.current

    return state.layout.nodes.map((node) => {
      const sim = simNodes.get(node.holder.owner)
      const baseX = sim?.x ?? node.x
      const baseY = sim?.y ?? node.y
      if (node.holder.owner === dragOwner) {
        // Freeze drift under the pointer so the bubble stays glued to the grab
        // point while the simulation pushes its neighbours around.
        return { ...node, x: baseX, y: baseY }
      }
      const drift = state.reduceMotion
        ? ZERO_OFFSET
        : driftOffset(node.holder.owner, node.radius, phase)
      return {
        ...node,
        x: baseX + drift.x,
        y: baseY + drift.y,
      }
    })
  }

  function wakeHubPhysics(target: number): void {
    const simulation = simulationRef.current
    if (!simulation) return
    // A hub drag can offset bubbles by a couple of hundred world units, so the
    // return trip needs more energy than a single-bubble drag.
    simulation.alpha(Math.max(simulation.alpha(), 0.8))
    simulation.alphaTarget(target)
    simRunningRef.current = true
  }

  /** Ease the hub back to the centre and let the bubbles spring home with it. */
  function returnHubHome(): void {
    hubReturnRef.current = { start: performance.now() }
    const hub = hubRef.current
    if (Math.hypot(hub.x - WIDTH / 2, hub.y - HEIGHT / 2) < 0.5) {
      hubRef.current = { x: WIDTH / 2, y: HEIGHT / 2 }
      wakeHubPhysics(0)
      return
    }
    hubAnimationRef.current = {
      fromX: hub.x,
      fromY: hub.y,
      start: performance.now(),
    }
    wakeHubPhysics(0)
  }

  function resetHub(): void {
    hubAnimationRef.current = null
    hubReturnRef.current = { start: performance.now() }
    hubRef.current = { x: WIDTH / 2, y: HEIGHT / 2 }
    wakeHubPhysics(0)
  }

  function stepSimulation(): void {
    const simulation = simulationRef.current
    if (!simulation) return
    simulation.tick()

    const hub = hubRef.current
    const dragOwner = draggingOwnerRef.current
    for (const node of simulation.nodes()) {
      const margin = node.radius + 10
      node.x = clamp(node.x ?? margin, margin, WIDTH - margin)
      node.y = clamp(node.y ?? margin, margin, HEIGHT - margin)

      // Keep neighbours out of the hub, but let a dragged bubble pass over it
      // so the pointer never feels blocked.
      if (node.holder.owner === dragOwner) continue
      const deltaX = node.x - hub.x
      const deltaY = node.y - hub.y
      const distance = Math.hypot(deltaX, deltaY)
      const minimum = HUB_RADIUS + node.radius + 10
      if (distance >= minimum) continue
      const angle = distance < 0.001 ? 0 : Math.atan2(deltaY, deltaX)
      node.x = hub.x + Math.cos(angle) * minimum
      node.y = hub.y + Math.sin(angle) * minimum
    }
  }

  useEffect(() => {
    let frame = 0
    let lastPaint = 0

    const loop = (now: number) => {
      const canvas = canvasRef.current
      const state = drawStateRef.current

      if (canvas && state && !document.hidden && visibleRef.current) {
        let simulated = false
        const hubAnimation = hubAnimationRef.current
        if (hubAnimation) {
          const t = clamp((now - hubAnimation.start) / 640, 0, 1)
          // Ease-out cubic: quick release, gentle settle.
          const k = 1 - Math.pow(1 - t, 3)
          const hubX = hubAnimation.fromX + (WIDTH / 2 - hubAnimation.fromX) * k
          const hubY = hubAnimation.fromY + (HEIGHT / 2 - hubAnimation.fromY) * k
          hubRef.current = { x: hubX, y: hubY }
          simulated = true
          simRunningRef.current = true
          if (t >= 1) {
            hubRef.current = { x: WIDTH / 2, y: HEIGHT / 2 }
            hubAnimationRef.current = null
            simulationRef.current?.alphaTarget(0)
          }
        }
        const hubReturn = hubReturnRef.current
        if (hubReturn && !hubAnimationRef.current) {
          const simulation = simulationRef.current
          if (simulation) {
            let maxDelta = 0
            for (const node of simulation.nodes()) {
              maxDelta = Math.max(
                maxDelta,
                Math.hypot(
                  (node.x ?? 0) - node.homeX,
                  (node.y ?? 0) - node.homeY,
                ),
              )
            }
            if (maxDelta < 0.75 || now - hubReturn.start > 3200) {
              // Snap the last sub-pixel so the resting frame is pixel-stable.
              for (const node of simulation.nodes()) {
                node.x = node.homeX
                node.y = node.homeY
                node.vx = 0
                node.vy = 0
              }
              hubReturnRef.current = null
              simulation.alpha(0)
              simulation.alphaTarget(0)
              simRunningRef.current = false
              dirtyRef.current = true
            } else {
              // Hold a little energy so forceX finishes the trip instead of the
              // simulation falling asleep a dozen pixels short of home.
              simulation.alpha(0.16)
              simulation.alphaTarget(0)
              simulated = true
              simRunningRef.current = true
            }
          } else {
            hubReturnRef.current = null
          }
        }
        if (simRunningRef.current) {
          const simulation = simulationRef.current
          if (simulation) {
            stepSimulation()
            simulated = true
            if (
              draggingOwnerRef.current === null &&
              dragRef.current?.hub !== true &&
              simulation.alphaTarget() === 0 &&
              simulation.alpha() < 0.02
            ) {
              simulation.alpha(0)
              simRunningRef.current = false
            }
          } else {
            simRunningRef.current = false
          }
        }

        const interacting =
          dragRef.current !== null ||
          hubAnimationRef.current !== null ||
          simulated ||
          viewAnimationRef.current !== null
        const animateSelection = !state.reduceMotion && state.selectionOwner !== null
        const needsPaint =
          dirtyRef.current ||
          interacting ||
          animateSelection ||
          (!state.reduceMotion && !dragRef.current)
        // Idle drift can breathe at 24fps; direct manipulation always paints
        // at the display refresh rate.
        const throttle = interacting ? 0 : 1000 / 24

        if (needsPaint && now - lastPaint >= throttle) {
          lastPaint = now
          const nodes = computeDisplayNodes(now, state)
          displayNodesRef.current = nodes
          const placed = buildPlacedEdges(
            nodes,
            state.graph?.edges ?? [],
            state.graph,
            state.decimals,
          )
          const visible =
            state.edgeMode === 'all'
              ? placed
              : placed.filter((edge) => edge.edge.kind === state.edgeMode)
          displayEdgesRef.current = visible
          drawScene(canvas, now, nodes, visible, state)
          dirtyRef.current = false
        }
      }

      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [])

  function drawScene(
    canvas: HTMLCanvasElement,
    now: number,
    nodes: LayoutNode[],
    edges: PlacedEdge[],
    state: DrawState,
  ) {
    const context = canvas.getContext('2d')
    if (!context) return
    // Cached by the ResizeObserver: reading layout every frame was forcing a
    // synchronous style/layout flush inside the rAF loop.
    let { width, height } = sizeRef.current
    if (width < 2 || height < 2) {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      sizeRef.current = { width, height }
    }
    if (width < 2 || height < 2) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The warm background and vignette live in CSS so the canvas only repaints
    // the moving map instead of three full-screen gradient fills per frame.
    context.clearRect(0, 0, width, height)

    const fit = fitBox(width, height)
    const view = viewRef.current
    const scale = view.scale || 1

    // Ambient dots stay pinned to the viewBox like the old SVG layer.
    for (const dot of state.ambientDots) {
      context.beginPath()
      context.arc(
        fit.offsetX + dot.x * fit.scale,
        fit.offsetY + dot.y * fit.scale,
        Math.max(0.4, dot.r * fit.scale),
        0,
        TAU,
      )
      context.fillStyle = `rgba(232, 193, 130, ${dot.alpha})`
      context.fill()
    }

    context.save()
    context.translate(fit.offsetX, fit.offsetY)
    context.scale(fit.scale, fit.scale)
    context.translate(view.x, view.y)
    context.scale(scale, scale)

    const viewBoxLeft = -fit.offsetX / fit.scale
    const viewBoxTop = -fit.offsetY / fit.scale
    const viewBoxRight = (width - fit.offsetX) / fit.scale
    const viewBoxBottom = (height - fit.offsetY) / fit.scale
    const localLeft = (viewBoxLeft - view.x) / scale - 24
    const localTop = (viewBoxTop - view.y) / scale - 24
    const localRight = (viewBoxRight - view.x) / scale + 24
    const localBottom = (viewBoxBottom - view.y) / scale + 24

    context.strokeStyle = GRID_STROKE
    context.lineWidth = 1
    context.beginPath()
    for (
      let x = Math.floor(localLeft / GRID_STEP) * GRID_STEP;
      x <= localRight;
      x += GRID_STEP
    ) {
      context.moveTo(x, localTop)
      context.lineTo(x, localBottom)
    }
    for (
      let y = Math.floor(localTop / GRID_STEP) * GRID_STEP;
      y <= localBottom;
      y += GRID_STEP
    ) {
      context.moveTo(localLeft, y)
      context.lineTo(localRight, y)
    }
    context.stroke()

    for (const placed of edges) {
      const edgeKey = placed.edge.key
      const incident = state.selectionOwner
        ? placed.edge.owners.includes(state.selectionOwner)
        : true
      const edgeActive =
        state.hoveredEdge === edgeKey || state.selectedEdge === edgeKey
      const dimmed =
        (state.selectionOwner !== null && !incident) ||
        (state.hoveredEdge !== null && !edgeActive)
      const opacity = dimmed
        ? 0.05
        : edgeActive
          ? 0.92
          : state.selectionOwner !== null && incident
            ? 0.72
            : 0.4

      context.lineCap = 'round'

      if (edgeActive) {
        context.save()
        context.globalAlpha = 0.2
        context.strokeStyle = placed.color
        context.lineWidth = placed.width + 7
        traceEdge(context, placed)
        context.stroke()
        context.restore()
      }

      const gradient = context.createLinearGradient(
        placed.startX,
        placed.startY,
        placed.endX,
        placed.endY,
      )
      gradient.addColorStop(0, rgba(placed.sourceColor, 0.55))
      gradient.addColorStop(0.5, rgba(placed.targetColor, 0.9))
      gradient.addColorStop(1, rgba(placed.targetColor, 0.55))

      context.save()
      context.globalAlpha = opacity
      context.strokeStyle = gradient
      context.lineWidth = placed.width
      traceEdge(context, placed)
      context.stroke()
      context.restore()

      const angle = Math.atan2(
        placed.endY - placed.controlY,
        placed.endX - placed.controlX,
      )
      context.save()
      context.translate(placed.endX, placed.endY)
      context.rotate(angle)
      context.globalAlpha = opacity
      context.beginPath()
      context.moveTo(0, 0)
      context.lineTo(-6.5, 3.1)
      context.lineTo(-6.5, -3.1)
      context.closePath()
      context.fillStyle = rgba(placed.targetColor, 0.85)
      context.fill()
      context.restore()
    }

    const hubX = hubRef.current.x
    const hubY = hubRef.current.y
    const hubDragging = dragRef.current?.hub === true

    // Faint straight threads from the hub to every surrounding bubble. They
    // stop at the rims so the lines never cut across a bubble or the hub label,
    // and read as taut string between the two centres.
    for (const node of nodes) {
      const deltaX = node.x - hubX
      const deltaY = node.y - hubY
      const distance = Math.hypot(deltaX, deltaY)
      if (distance <= HUB_RADIUS + node.radius + 4) continue
      const unitX = deltaX / distance
      const unitY = deltaY / distance
      const startX = hubX + unitX * (HUB_RADIUS + 3)
      const startY = hubY + unitY * (HUB_RADIUS + 3)
      const endX = node.x - unitX * (node.radius + 3)
      const endY = node.y - unitY * (node.radius + 3)
      const incident =
        state.selectionOwner === null ||
        state.selectionOwner === node.holder.owner
      const shimmer = state.reduceMotion
        ? 0.5
        : 0.5 + Math.sin(now / 1200 + distance * 0.012) * 0.5
      const opacity = !incident
        ? 0.03
        : hubDragging
          ? 0.26 + shimmer * 0.1
          : 0.09 + shimmer * 0.04

      context.save()
      context.globalAlpha = opacity
      context.strokeStyle = HUB_COLOR
      context.lineWidth = hubDragging ? 1.3 : 1
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(startX, startY)
      context.lineTo(endX, endY)
      context.stroke()
      context.restore()
    }

    const orbitPulse = state.reduceMotion
      ? 0.375
      : 0.375 + Math.sin(now / 1400) * 0.075

    context.beginPath()
    context.arc(hubX, hubY, HUB_RADIUS + 12, 0, TAU)
    context.strokeStyle = HUB_COLOR
    context.globalAlpha = orbitPulse * 0.2
    context.lineWidth = 2
    context.stroke()

    const hubGlow = context.createRadialGradient(
      hubX,
      hubY,
      0,
      hubX,
      hubY,
      HUB_RADIUS,
    )
    hubGlow.addColorStop(0, rgba(HUB_COLOR, 0.2))
    hubGlow.addColorStop(1, rgba(HUB_COLOR, 0))
    context.globalAlpha = 0.75
    context.fillStyle = hubGlow
    context.beginPath()
    context.arc(hubX, hubY, HUB_RADIUS, 0, TAU)
    context.fill()

    context.globalAlpha = 1
    context.beginPath()
    context.arc(hubX, hubY, HUB_RADIUS, 0, TAU)
    context.strokeStyle = HUB_COLOR
    context.globalAlpha = 0.6
    context.lineWidth = 2.5
    context.stroke()
    context.globalAlpha = 1

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `700 16px ${FONT_SANS}`
    context.fillStyle = 'rgba(255, 255, 255, 0.92)'
    context.fillText('KLYTH', hubX, hubY - 6)
    context.font = `600 10px ${FONT_SANS}`
    context.fillStyle = 'rgba(255, 255, 255, 0.4)'
    context.fillText(`${state.layout.nodes.length} holders`, hubX, hubY + 12)

    for (const node of nodes) {
      const isActive = state.selectionOwner === node.holder.owner
      const isDimmed = state.selectionOwner !== null && !isActive
      const label = displayLabel(node.holder)
      const percentSize = clamp(node.radius * 0.3, 10, 17)
      const nameCapacity = Math.floor((node.radius * 2 - 14) / 5.6)
      const showNameInside = node.radius >= 36 && label.length <= nameCapacity
      const nameY = showNameInside ? -6 : node.radius + 14
      const percentY = showNameInside ? 10 : 0
      const strokeWidth = isActive ? 2.5 : node.radius >= 30 ? 1.5 : 1
      const bodyAlpha = isActive ? 1 : 0.6
      const pulse = state.reduceMotion ? 1 : 0.825 + Math.sin(now / 950) * 0.175
      const baseAlpha = isDimmed ? 0.2 : 1

      context.save()
      context.globalAlpha = baseAlpha

      if (isActive) {
        context.beginPath()
        context.arc(node.x, node.y, node.radius + 20, 0, TAU)
        context.fillStyle = rgba(node.color, 0.08 * pulse)
        context.fill()

        context.beginPath()
        context.arc(node.x, node.y, node.radius + 14, 0, TAU)
        context.strokeStyle = rgba(node.color, 0.45 * pulse)
        context.lineWidth = 3
        context.stroke()
      } else if (!isDimmed) {
        const orbitAlpha = state.reduceMotion
          ? 0.12
          : 0.12 * (0.7 + 0.3 * Math.sin(now / 1100 + node.x * 0.01))
        context.beginPath()
        context.arc(node.x, node.y, node.radius + 8, 0, TAU)
        context.strokeStyle = rgba(node.color, orbitAlpha)
        context.lineWidth = 1
        context.stroke()
      }

      const glow = context.createRadialGradient(
        node.x,
        node.y,
        0,
        node.x,
        node.y,
        node.radius,
      )
      glow.addColorStop(0, rgba(node.color, isActive ? 0.2 : 0.08))
      glow.addColorStop(1, rgba(node.color, 0))
      context.fillStyle = glow
      context.beginPath()
      context.arc(node.x, node.y, node.radius, 0, TAU)
      context.fill()

      context.globalAlpha = baseAlpha * bodyAlpha
      context.beginPath()
      context.arc(node.x, node.y, node.radius, 0, TAU)
      context.strokeStyle = node.color
      context.lineWidth = strokeWidth
      context.stroke()

      context.globalAlpha = baseAlpha
      context.beginPath()
      context.arc(node.x, node.y, node.radius * 0.25, 0, TAU)
      context.fillStyle = rgba(node.color, 0.1)
      context.fill()

      const nodeParticles = state.particles.get(node.holder.owner)
      if (nodeParticles && !isDimmed) {
        // Orbiting specks keep the bubble feeling alive without animating the
        // ring itself. Each one breathes, drifts and twinkles on its own phase
        // so the swarm churns instead of tracing a fixed ring. Positions stay
        // inside the circle so nothing spills out.
        const seconds = state.reduceMotion ? 0 : now / 1000
        const speck = isActive ? 1 : 0.82
        // Quantised alpha palettes: a handful of cached strings per bubble
        // instead of one allocation per particle per frame.
        const warmStyle = [
          rgba(node.color, 0.34 * speck),
          rgba(node.color, 0.56 * speck),
          rgba(node.color, 0.82 * speck),
        ]
        const lightStyle = [
          `rgba(255, 255, 255, ${0.5 * speck})`,
          `rgba(255, 255, 255, ${0.74 * speck})`,
          `rgba(255, 255, 255, ${0.98 * speck})`,
        ]
        for (let index = 0; index < nodeParticles.length; index += 1) {
          const particle = nodeParticles[index]
          const cycle = seconds * particle.speed + particle.phase
          // Radial breathing keeps the swarm churning off its base ellipse.
          const breathe = 0.62 + 0.38 * Math.sin(cycle * particle.harmonic)
          const orbit = Math.max(
            2,
            Math.min(
              particle.orbit * node.radius * breathe,
              node.radius - particle.size * 1.6 - 2,
            ),
          )
          const angle = particle.angle + cycle
          // Sideways sway adds a second harmonic so motion never looks circular.
          const sway = Math.sin(cycle * 2.1 + particle.phase) * node.radius * 0.12
          const particleX = node.x + Math.cos(angle) * orbit
          const particleY =
            node.y + Math.sin(angle) * orbit * particle.squash + sway
          // Twinkle drives brightness and size together for a clear pulse.
          const twinkle = 0.5 + 0.5 * Math.sin(cycle * 3.3 + particle.phase * 1.9)
          const level = twinkle < 0.34 ? 0 : twinkle < 0.67 ? 1 : 2
          const palette = index % 3 === 0 ? lightStyle : warmStyle
          context.fillStyle = palette[level]
          const size = Math.max(
            1,
            Math.round(particle.size * (0.7 + twinkle * 0.8)),
          )
          // Integer, square fillRects are much cheaper than arcs and read as
          // specks at this size, which keeps 60-bubble maps at full frame rate.
          context.fillRect(
            Math.round(particleX - size / 2),
            Math.round(particleY - size / 2),
            size,
            size,
          )
        }
      }

      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillStyle = '#ffffff'
      context.font = `700 ${percentSize}px ${FONT_SANS}`
      context.fillText(
        formatHolderPercent(node.holder.percent),
        node.x,
        node.y + percentY,
      )

      context.fillStyle = node.color
      context.font = `600 10px ${FONT_SANS}`
      context.fillText(
        state.supernodes.has(node.holder.owner) ? `${label} ⚡` : label,
        node.x,
        node.y + nameY,
      )

      context.restore()
    }

    context.restore()
  }

  function localPointFromEvent(
    event: ReactPointerEvent<HTMLCanvasElement> | WheelEvent,
  ): { x: number; y: number } {
    // `offsetX/offsetY` is already relative to the canvas, which avoids the
    // per-event `getBoundingClientRect()` layout flush that made drag janky.
    const native = 'nativeEvent' in event ? event.nativeEvent : event
    const { width, height } = sizeRef.current
    return toWorld(
      viewBoxPoint(native.offsetX, native.offsetY, fitBox(width, height)),
      viewRef.current,
    )
  }

  function hitTestNode(point: { x: number; y: number }): LayoutNode | null {
    const nodes = displayNodesRef.current
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      if (
        Math.hypot(point.x - node.x, point.y - node.y) <=
        node.radius + 2
      ) {
        return node
      }
    }
    return null
  }

  function hitTestEdge(point: { x: number; y: number }): PlacedEdge | null {
    let best: PlacedEdge | null = null
    let bestDistance = 8
    for (const placed of displayEdgesRef.current) {
      const distance = distanceToEdge(point.x, point.y, placed)
      if (distance < bestDistance) {
        bestDistance = distance
        best = placed
      }
    }
    return best
  }

  function hitTestHub(point: { x: number; y: number }): boolean {
    const hub = hubRef.current
    return Math.hypot(point.x - hub.x, point.y - hub.y) <= HUB_RADIUS + 12
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return
    cancelViewAnimation()
    hubReturnRef.current = null

    const point = localPointFromEvent(event)
    const node = hitTestNode(point)
    const edge = node ? null : hitTestEdge(point)
    const hub = !node && !edge && hitTestHub(point)

    if (!node && !edge && !hub) {
      setSelected(null)
      setLockedOwner(null)
      setSelectedEdge(null)
    }

    if (hub) {
      // Grabbing the hub cancels any ease-back so the pointer owns it.
      hubAnimationRef.current = null
    }

    const { width, height } = sizeRef.current
    const start = viewBoxPoint(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      fitBox(width, height),
    )

    dragRef.current = {
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      moved: false,
      nodeOwner: node?.holder.owner ?? null,
      hub,
      hubGrabX: hub ? point.x - hubRef.current.x : 0,
      hubGrabY: hub ? point.y - hubRef.current.y : 0,
      pinned: false,
      grabX: node ? point.x - node.x : 0,
      grabY: node ? point.y - node.y : 0,
      targetX: node?.x ?? null,
      targetY: node?.y ?? null,
    }

    if (node) {
      setHovered(null)
    }

    setDragging(true)
    dirtyRef.current = true
  }

  function updateHover(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = localPointFromEvent(event)
    const node = hitTestNode(point)
    const edge = node ? null : hitTestEdge(point)
    const nextHovered = node?.holder.owner ?? null
    const nextEdge = edge?.edge.key ?? null

    setHovered((current) => (current === nextHovered ? current : nextHovered))
    setHoveredEdge((current) => (current === nextEdge ? current : nextEdge))
    if (node || edge) {
      setPointer({ x: event.clientX, y: event.clientY })
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      updateHover(event)
      return
    }

    const { width, height } = sizeRef.current
    const current = viewBoxPoint(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      fitBox(width, height),
    )
    const deltaX = current.x - drag.startX
    const deltaY = current.y - drag.startY

    if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) {
      drag.moved = true
      // Capture only once a real drag starts. Capturing on pointerdown retargets
      // the follow-up click to the canvas root, which would swallow bubble clicks.
      event.currentTarget.setPointerCapture(event.pointerId)

      if (drag.nodeOwner) {
        const simulation = simulationRef.current
        const simNode = simNodesRef.current.get(drag.nodeOwner)
        if (simulation && simNode) {
          // Wake the SIDARA physics only for real drags: pin the bubble at the
          // spot the user grabbed, then let collisions shove its neighbours.
          const displayNode = displayNodesRef.current.find(
            (item) => item.holder.owner === drag.nodeOwner,
          )
          const fromX = drag.targetX ?? displayNode?.x ?? simNode.x ?? simNode.homeX
          const fromY = drag.targetY ?? displayNode?.y ?? simNode.y ?? simNode.homeY
          simNode.x = fromX
          simNode.y = fromY
          simNode.fx = fromX
          simNode.fy = fromY
          simNode.vx = 0
          simNode.vy = 0
          drag.targetX = fromX
          drag.targetY = fromY
          drag.pinned = true
          draggingOwnerRef.current = drag.nodeOwner
          simulation.alpha(Math.max(simulation.alphaTarget(), 0.2))
          simulation.alphaTarget(0.3)
          simRunningRef.current = true
        }
      }
    }
    if (!drag.moved) return

    if (drag.hub) {
      hubAnimationRef.current = null
      const world = toWorld(current, viewRef.current)
      hubRef.current = {
        x: clamp(world.x - drag.hubGrabX, 32, WIDTH - 32),
        y: clamp(world.y - drag.hubGrabY, 32, HEIGHT - 32),
      }
      const simulation = simulationRef.current
      if (simulation) {
        simulation.alpha(Math.max(simulation.alpha(), 0.2))
        simulation.alphaTarget(0.25)
        simRunningRef.current = true
      }
      dirtyRef.current = true
      return
    }

    if (drag.nodeOwner) {
      const simNode = simNodesRef.current.get(drag.nodeOwner)
      if (!simNode) return
      const node = layoutByOwner.get(drag.nodeOwner)
      const radius = node?.radius ?? simNode.radius
      const margin = radius + 10
      const world = toWorld(current, viewRef.current)
      // Pin the bubble to the pointer; d3 keeps the spring and collisions
      // running so the motion stays soft instead of snapping 1:1.
      simNode.fx = clamp(world.x - drag.grabX, margin, WIDTH - margin)
      simNode.fy = clamp(world.y - drag.grabY, margin, HEIGHT - margin)
      drag.targetX = simNode.fx ?? null
      drag.targetY = simNode.fy ?? null
      simRunningRef.current = true
    } else {
      viewRef.current = {
        ...viewRef.current,
        x: clamp(drag.originX + deltaX, -WIDTH * 0.45, WIDTH * 0.45),
        y: clamp(drag.originY + deltaY, -HEIGHT * 0.45, HEIGHT * 0.45),
      }
    }

    dirtyRef.current = true
  }

  function finishDrag(
    event: ReactPointerEvent<HTMLCanvasElement>,
    allowClick: boolean,
  ) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)

    if (drag.nodeOwner && drag.pinned) {
      const simNode = simNodesRef.current.get(drag.nodeOwner)
      if (simNode) {
        // Unpin and let the SIDARA spring carry the bubble back home.
        simNode.fx = null
        simNode.fy = null
      }
      const simulation = simulationRef.current
      if (simulation) {
        simulation.alphaTarget(0)
        simRunningRef.current = true
      }
      draggingOwnerRef.current = null
    }

    if (drag.hub) {
      if (drag.moved) {
        returnHubHome()
      } else if (allowClick) {
        resetMap()
      }
    }

    if (!drag.hub && !drag.moved && allowClick) {
      if (drag.nodeOwner) {
        selectOwner(drag.nodeOwner)
      } else {
        const point = localPointFromEvent(event)
        if (hitTestHub(point)) {
          resetMap()
        } else {
          const edge = hitTestEdge(point)
          if (edge) {
            setSelectedEdge((current) =>
              current === edge.edge.key ? null : edge.edge.key,
            )
          } else {
            setSelected(null)
            setLockedOwner(null)
            setSelectedEdge(null)
          }
        }
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dirtyRef.current = true
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    finishDrag(event, true)
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    finishDrag(event, false)
  }

  function handlePointerLeave(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (drag) {
      // A press that leaves the canvas without capture would otherwise keep the
      // physics awake forever. Release the pin and let it settle.
      if (event.currentTarget.hasPointerCapture(drag.pointerId)) return
      dragRef.current = null
      setDragging(false)
      if (drag.hub) {
        returnHubHome()
      } else if (drag.pinned && drag.nodeOwner) {
        const simNode = simNodesRef.current.get(drag.nodeOwner)
        if (simNode) {
          simNode.fx = null
          simNode.fy = null
        }
        const simulation = simulationRef.current
        if (simulation) {
          simulation.alphaTarget(0)
          simRunningRef.current = true
        }
        draggingOwnerRef.current = null
      }
      return
    }
    setHovered(null)
    setHoveredEdge(null)
  }

  function zoomBy(factor: number) {
    cancelViewAnimation()
    const previous = viewRef.current
    const scale = clamp(previous.scale * factor, 0.55, 3.4)
    const ratio = scale / previous.scale
    viewRef.current = {
      scale,
      x: WIDTH / 2 - (WIDTH / 2 - previous.x) * ratio,
      y: HEIGHT / 2 - (HEIGHT / 2 - previous.y) * ratio,
    }
    dirtyRef.current = true
  }

  function focusOwner(owner: string) {
    const node = layoutByOwner.get(owner)
    if (!node) return
    const targetScale = node.radius >= 44 ? 1.18 : 1.36
    // Keep the focused bubble centred while drift is still moving it.
    const follow = () => {
      const live = displayNodesRef.current.find(
        (item) => item.holder.owner === owner,
      )
      if (!live) return null
      return {
        scale: targetScale,
        x: WIDTH / 2 - live.x * targetScale,
        y: HEIGHT / 2 - live.y * targetScale,
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
    draggingOwnerRef.current = null
    resetHub()

    // Let any in-flight physics finish instead of freezing mid-bounce.
    const simulation = simulationRef.current
    if (simulation) {
      for (const node of simulation.nodes()) {
        node.fx = null
        node.fy = null
      }
      simulation.alphaTarget(0)
      simRunningRef.current = simulation.alpha() > 0
    }

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
        if (expanded) setExpanded(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [expanded, hovered, lockedOwner, selected, selectedEdge])

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

  const activeNodeColor = activeNode ? activeNode.color : null
  const activeStats = activeNode ? edgeStats.get(activeNode.holder.owner) : null
  const activeCluster = activeNode
    ? graph?.memberByOwner[activeNode.holder.owner]
    : undefined
  const activeIsContract = activeNode
    ? isContractWallet(activeNode.holder.role)
    : false
  const activeTier =
    activeNode && !activeIsContract ? holderTier(activeNode.holder.tier) : null
  const activeTransfers =
    activeNode ? (activeStats?.count ?? 0) + (tradeCounts.get(activeNode.holder.owner) ?? 0) : 0
  const activeIsSupernode = activeTransfers >= SUPERNODE_TRANSFERS

  const edgeColor = activeEdge
    ? layout.edges.find((item) => item.edge.key === activeEdge.key)?.color ??
      DEFAULT_EDGE_COLOR
    : DEFAULT_EDGE_COLOR

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

  const mapView = (
    <div className="wallet-map__canvas">
      <canvas
        ref={canvasRef}
        className={`wallet-map__gl${dragging ? ' wallet-map__gl--dragging' : ''}`}
        role="img"
        aria-label="KLYTH holder bubble map with on-chain transfer links"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
      >
        KLYTH holder bubble map with on-chain transfer links
      </canvas>

      <div className="wallet-map__a11y">
        <p>
          Holder bubbles. Use the controls to zoom, or activate a wallet below
          to focus its bubble.
        </p>
        <ul>
          {layout.nodes.map((node) => {
            const contract = isContractWallet(node.holder.role)
            const tier = holderTier(node.holder.tier)
            return (
              <li key={node.holder.owner}>
                <button
                  type="button"
                  onFocus={() => setHovered(node.holder.owner)}
                  onBlur={() => setHovered(null)}
                  onClick={() => selectOwner(node.holder.owner)}
                >
                  {contract ? 'Contract wallet' : `${tier.emoji} ${tier.label}`}{' '}
                  {node.holder.label}{' '}
                  {shortenAddress(node.holder.owner, 4, 4)},{' '}
                  {formatHolderPercent(node.holder.percent)} of supply
                </button>
              </li>
            )
          })}
        </ul>
      </div>

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

        <div className="wallet-map__legend" aria-label="Holder clusters and wallet roles">
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
          {activeTier ? (
            <div className="wallet-map__tooltip-row">
              <span className="wallet-map__tooltip-label">Tier</span>
              <span className="wallet-map__tooltip-value">
                {activeTier.emoji} {activeTier.label}
              </span>
            </div>
          ) : null}
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

  const stage = <div className="wallet-map__stage">{mapView}</div>

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
