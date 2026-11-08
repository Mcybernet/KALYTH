import { MINT_ADDRESS } from './addresses'
import type { HolderRole, HoldersSnapshot } from './holders'
import { rpcRequest } from './rpc'
import { formatTokenAmount } from './solana'

/**
 * On-chain transfer graph builder.
 *
 * The public Devnet endpoint allows only a small number of `getTransaction`
 * calls per window, so this scanner is deliberately conservative:
 *   - read recent signatures for each current holder's token accounts,
 *   - parse the newest transactions one by one with a gap,
 *   - derive edges only from SPL token balance deltas in `meta` (no guessing),
 *   - cache the result so polls and page remounts do not rescan.
 *
 * A wallet-to-wallet edge means one owner's token account lost tokens while a
 * different owner's account gained the same amount in the same transaction.
 */

const SIGNATURE_LIMIT = 10
const MAX_TOKEN_ACCOUNTS = 12
const MAX_TRANSACTIONS = 18
const TRANSACTION_GAP_MS = 1_400
const CACHE_MS = 5 * 60_000
const PARTIAL_CACHE_MS = 45_000

export const CLUSTER_COLORS = [
  '#38bdf8',
  '#a855f7',
  '#f472b6',
  '#22d3ee',
  '#facc15',
  '#fb7185',
  '#34d399',
  '#f97316',
]

export type TransferDirection = {
  from: string
  to: string
  amountRaw: string
  amount: string
  count: number
  lastAt: number | null
  lastSignature: string
}

export type TransferEdge = {
  key: string
  kind: 'wallet' | 'curve'
  /** Both owners, sorted for a stable key. */
  owners: [string, string]
  /** Dominant direction (largest transferred amount). */
  from: string
  to: string
  amountRaw: string
  amount: string
  amountNumber: number
  count: number
  directions: TransferDirection[]
  lastAt: number | null
}

export type TraderCluster = {
  id: string
  color: string
  members: string[]
  walletCount: number
  transferCount: number
  volumeRaw: string
  volume: string
}

export type TransferGraph = {
  edges: TransferEdge[]
  clusters: TraderCluster[]
  /** owner -> cluster id for wallets that share a transfer path. */
  memberByOwner: Record<string, string>
  scannedTokenAccounts: number
  scannedSignatures: number
  parsedTransactions: number
  failedTransactions: number
  ambiguousTransactions: number
  unmatchedTransactions: number
  selfTransfers: number
  unknownOwners: number
  truncated: boolean
  windowStart: number | null
  windowEnd: number | null
  fetchedAt: number
}

export type TransferScanProgress = {
  phase: 'signatures' | 'transactions'
  done: number
  total: number
}

type FetchTransferGraphOptions = {
  force?: boolean
  onProgress?: (progress: TransferScanProgress) => void
}

type SignatureInfo = {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

type TokenBalance = {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: {
    amount: string
    decimals: number
  }
}

type ParsedTransaction = {
  blockTime: number | null
  meta: {
    err: unknown
    preTokenBalances?: TokenBalance[]
    postTokenBalances?: TokenBalance[]
  } | null
}

type RawTransferEvent = {
  from: string
  to: string
  amountRaw: bigint
  signature: string
  blockTime: number | null
}

const cache = new Map<string, { expiresAt: number; value: TransferGraph }>()

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'))
      return
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)

    function handleAbort() {
      window.clearTimeout(timer)
      reject(new DOMException('Request aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function isProtocolRole(role: HolderRole): boolean {
  return role === 'burn' || role === 'vault' || role === 'treasury'
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

function compareBigInt(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue === rightValue) return 0
  return leftValue > rightValue ? -1 : 1
}

/** Extracts one-sender/one-receiver SPL transfer events from a transaction. */
function extractTransfers(
  transaction: ParsedTransaction,
  signature: string,
  roles: Map<string, HolderRole>,
  stats: {
    ambiguousTransactions: number
    unmatchedTransactions: number
    selfTransfers: number
    unknownOwners: number
  },
): RawTransferEvent[] {
  const meta = transaction.meta
  if (!meta || meta.err) {
    return []
  }

  const accounts = new Map<number, { owner?: string; pre: bigint; post: bigint }>()

  for (const balance of meta.preTokenBalances ?? []) {
    if (balance.mint !== MINT_ADDRESS) continue
    const entry = accounts.get(balance.accountIndex) ?? { pre: 0n, post: 0n }
    entry.owner = entry.owner ?? balance.owner
    entry.pre += BigInt(balance.uiTokenAmount.amount)
    accounts.set(balance.accountIndex, entry)
  }

  for (const balance of meta.postTokenBalances ?? []) {
    if (balance.mint !== MINT_ADDRESS) continue
    const entry = accounts.get(balance.accountIndex) ?? { pre: 0n, post: 0n }
    entry.owner = balance.owner ?? entry.owner
    entry.post += BigInt(balance.uiTokenAmount.amount)
    accounts.set(balance.accountIndex, entry)
  }

  const deltaByOwner = new Map<string, bigint>()
  for (const entry of accounts.values()) {
    if (!entry.owner) continue
    const delta = entry.post - entry.pre
    if (delta === 0n) continue
    deltaByOwner.set(entry.owner, (deltaByOwner.get(entry.owner) ?? 0n) + delta)
  }

  const senders = Array.from(deltaByOwner.entries())
    .filter(([, delta]) => delta < 0n)
    .map(([owner, delta]) => ({ owner, amount: -delta }))
  const receivers = Array.from(deltaByOwner.entries())
    .filter(([, delta]) => delta > 0n)
    .map(([owner, delta]) => ({ owner, amount: delta }))

  if (senders.length === 0 || receivers.length === 0) {
    stats.unmatchedTransactions += 1
    return []
  }
  if (senders.length > 1 && receivers.length > 1) {
    stats.ambiguousTransactions += 1
    return []
  }

  const events: RawTransferEvent[] = []

  function push(from: string, to: string, amount: bigint) {
    if (from === to) {
      stats.selfTransfers += 1
      return
    }
    if (!roles.has(from) || !roles.has(to)) {
      stats.unknownOwners += 1
      return
    }
    if (amount <= 0n) return
    events.push({ from, to, amountRaw: amount, signature, blockTime: transaction.blockTime })
  }

  if (senders.length === 1) {
    for (const receiver of receivers) {
      push(senders[0].owner, receiver.owner, receiver.amount)
    }
  } else {
    for (const sender of senders) {
      push(sender.owner, receivers[0].owner, sender.amount)
    }
  }

  return events
}

function aggregateEdges(
  events: RawTransferEvent[],
  roles: Map<string, HolderRole>,
  decimals: number,
): TransferEdge[] {
  const accumulators = new Map<
    string,
    {
      kind: 'wallet' | 'curve'
      owners: [string, string]
      directions: Map<string, { amountRaw: bigint; count: number; lastAt: number | null; lastSignature: string }>
      totalRaw: bigint
      count: number
      lastAt: number | null
    }
  >()

  for (const event of events) {
    const fromRole = roles.get(event.from)
    const toRole = roles.get(event.to)
    if (!fromRole || !toRole) continue

    const kind: 'wallet' | 'curve' =
      isProtocolRole(fromRole) || isProtocolRole(toRole) ? 'curve' : 'wallet'
    const owners: [string, string] =
      event.from < event.to ? [event.from, event.to] : [event.to, event.from]
    const key = `${kind}:${owners[0]}|${owners[1]}`

    const accumulator = accumulators.get(key) ?? {
      kind,
      owners,
      directions: new Map(),
      totalRaw: 0n,
      count: 0,
      lastAt: null,
    }

    const directionKey = `${event.from}>${event.to}`
    const direction = accumulator.directions.get(directionKey) ?? {
      amountRaw: 0n,
      count: 0,
      lastAt: null,
      lastSignature: event.signature,
    }
    direction.amountRaw += event.amountRaw
    direction.count += 1
    if (event.blockTime !== null) {
      direction.lastAt = Math.max(direction.lastAt ?? 0, event.blockTime)
    }
    direction.lastSignature = event.signature
    accumulator.directions.set(directionKey, direction)

    accumulator.totalRaw += event.amountRaw
    accumulator.count += 1
    if (event.blockTime !== null) {
      accumulator.lastAt = Math.max(accumulator.lastAt ?? 0, event.blockTime)
    }
    accumulators.set(key, accumulator)
  }

  const edges: TransferEdge[] = []
  for (const [key, accumulator] of accumulators) {
    const directions = Array.from(accumulator.directions.entries())
      .map(([directionKey, direction]) => {
        const [from, to] = directionKey.split('>')
        return {
          from,
          to,
          amountRaw: direction.amountRaw.toString(),
          amount: formatTokenAmount(direction.amountRaw.toString(), decimals),
          count: direction.count,
          lastAt: direction.lastAt,
          lastSignature: direction.lastSignature,
        }
      })
      .sort((left, right) => compareBigInt(left.amountRaw, right.amountRaw))

    const primary = directions[0]
    edges.push({
      key,
      kind: accumulator.kind,
      owners: accumulator.owners,
      from: primary.from,
      to: primary.to,
      amountRaw: accumulator.totalRaw.toString(),
      amount: formatTokenAmount(accumulator.totalRaw.toString(), decimals),
      amountNumber: Number(accumulator.totalRaw),
      count: accumulator.count,
      directions,
      lastAt: accumulator.lastAt,
    })
  }

  return edges.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'wallet' ? -1 : 1
    return compareBigInt(left.amountRaw, right.amountRaw)
  })
}

/** Union-find over wallet-to-wallet edges to surface trader clusters. */
function buildClusters(
  edges: TransferEdge[],
  holders: HoldersSnapshot,
): { clusters: TraderCluster[]; memberByOwner: Record<string, string> } {
  const holderByOwner = new Map(holders.holders.map((holder) => [holder.owner, holder]))
  const parent = new Map<string, string>()

  function find(owner: string): string {
    const current = parent.get(owner) ?? owner
    if (current === owner) {
      parent.set(owner, owner)
      return owner
    }
    const root = find(current)
    parent.set(owner, root)
    return root
  }

  function union(left: string, right: string) {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) {
      parent.set(leftRoot, rightRoot)
    }
  }

  for (const edge of edges) {
    if (edge.kind !== 'wallet') continue
    if (!holderByOwner.has(edge.owners[0]) || !holderByOwner.has(edge.owners[1])) continue
    union(edge.owners[0], edge.owners[1])
  }

  const byRoot = new Map<string, string[]>()
  for (const owner of parent.keys()) {
    const root = find(owner)
    const members = byRoot.get(root) ?? []
    members.push(owner)
    byRoot.set(root, members)
  }

  const transferTotals = new Map<string, { count: number; volumeRaw: bigint }>()
  for (const edge of edges) {
    if (edge.kind !== 'wallet') continue
    if (!holderByOwner.has(edge.owners[0]) || !holderByOwner.has(edge.owners[1])) continue
    const root = find(edge.owners[0])
    const total = transferTotals.get(root) ?? { count: 0, volumeRaw: 0n }
    total.count += edge.count
    total.volumeRaw += BigInt(edge.amountRaw)
    transferTotals.set(root, total)
  }

  const groups = Array.from(byRoot.values())
    .filter((members) => members.length > 1)
    .sort((left, right) => {
      const leftTotal = transferTotals.get(find(left[0]))?.volumeRaw ?? 0n
      const rightTotal = transferTotals.get(find(right[0]))?.volumeRaw ?? 0n
      if (leftTotal === rightTotal) {
        return left.slice().sort().join('|').localeCompare(right.slice().sort().join('|'))
      }
      return rightTotal > leftTotal ? 1 : -1
    })

  const usedColors = new Set<number>()
  const memberByOwner: Record<string, string> = {}

  const clusters = groups.map((members, index) => {
    const sortedMembers = members.slice().sort()
    let colorIndex = hashString(sortedMembers.join('|')) % CLUSTER_COLORS.length
    let guard = 0
    while (usedColors.has(colorIndex) && guard < CLUSTER_COLORS.length) {
      colorIndex = (colorIndex + 1) % CLUSTER_COLORS.length
      guard += 1
    }
    usedColors.add(colorIndex)

    const id = `C${index + 1}`
    for (const owner of sortedMembers) {
      memberByOwner[owner] = id
    }

    const total = transferTotals.get(find(sortedMembers[0])) ?? {
      count: 0,
      volumeRaw: 0n,
    }

    return {
      id,
      color: CLUSTER_COLORS[colorIndex],
      members: sortedMembers,
      walletCount: sortedMembers.length,
      transferCount: total.count,
      volumeRaw: total.volumeRaw.toString(),
      volume: formatTokenAmount(total.volumeRaw.toString(), holders.decimals),
    }
  })

  return { clusters, memberByOwner }
}

function cacheKey(holders: HoldersSnapshot): string {
  return holders.holders
    .map(
      (holder) =>
        `${holder.owner}:${holder.role}:${holder.tokenAccounts.slice().sort().join(',')}`,
    )
    .sort()
    .join('|')
}

/**
 * Scans recent KLYTH transfers for the current holder set and builds the
 * wallet graph plus its trader clusters. The returned edges are parsed from
 * transaction token-balance deltas; nothing is inferred from trade counts.
 */
export async function fetchTransferGraph(
  holders: HoldersSnapshot,
  signal?: AbortSignal,
  options: FetchTransferGraphOptions = {},
): Promise<TransferGraph> {
  const key = cacheKey(holders)
  const cached = cache.get(key)
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const roles = new Map(holders.holders.map((holder) => [holder.owner, holder.role]))
  const tokenAccounts: string[] = []
  for (const holder of holders.holders) {
    for (const account of holder.tokenAccounts) {
      if (!tokenAccounts.includes(account)) {
        tokenAccounts.push(account)
      }
    }
    if (tokenAccounts.length >= MAX_TOKEN_ACCOUNTS) break
  }

  const signatureMap = new Map<string, SignatureInfo>()
  let signatureFailures = 0
  let signaturesDone = 0

  options.onProgress?.({
    phase: 'signatures',
    done: 0,
    total: tokenAccounts.length,
  })

  await Promise.allSettled(
    tokenAccounts.map(async (tokenAccount) => {
      try {
        const signatures = await rpcRequest<SignatureInfo[]>(
          'getSignaturesForAddress',
          [tokenAccount, { limit: SIGNATURE_LIMIT, commitment: 'confirmed' }],
          signal,
          { maxAttempts: 4 },
        )
        for (const info of signatures) {
          if (info.err) continue
          const existing = signatureMap.get(info.signature)
          if (!existing || (info.blockTime ?? 0) > (existing.blockTime ?? 0)) {
            signatureMap.set(info.signature, info)
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error
        signatureFailures += 1
      } finally {
        signaturesDone += 1
        options.onProgress?.({
          phase: 'signatures',
          done: signaturesDone,
          total: tokenAccounts.length,
        })
      }
    }),
  )

  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError')
  }

  if (signatureFailures === tokenAccounts.length && tokenAccounts.length > 0) {
    throw new Error('Devnet rate limit blocked the transfer scan. Try again in a moment.')
  }

  const signatures = Array.from(signatureMap.values()).sort(
    (left, right) => (right.blockTime ?? 0) - (left.blockTime ?? 0),
  )
  const truncated = signatures.length > MAX_TRANSACTIONS
  const scanSet = signatures.slice(0, MAX_TRANSACTIONS)

  const events: RawTransferEvent[] = []
  const stats = {
    ambiguousTransactions: 0,
    unmatchedTransactions: 0,
    selfTransfers: 0,
    unknownOwners: 0,
  }
  let parsedTransactions = 0
  let failedTransactions = 0
  let done = 0

  options.onProgress?.({
    phase: 'transactions',
    done: 0,
    total: scanSet.length,
  })

  for (const info of scanSet) {
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError')
    }
    if (done > 0) {
      await sleep(TRANSACTION_GAP_MS, signal)
    }

    try {
      const transaction = await rpcRequest<ParsedTransaction>(
        'getTransaction',
        [
          info.signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          },
        ],
        signal,
        { maxAttempts: 3 },
      )
      parsedTransactions += 1
      events.push(...extractTransfers(transaction, info.signature, roles, stats))
    } catch (error) {
      if (signal?.aborted) throw error
      failedTransactions += 1
    }

    done += 1
    options.onProgress?.({
      phase: 'transactions',
      done,
      total: scanSet.length,
    })
  }

  const edges = aggregateEdges(events, roles, holders.decimals)
  const { clusters, memberByOwner } = buildClusters(edges, holders)

  const times = events
    .map((event) => event.blockTime)
    .filter((value): value is number => value !== null)

  const value: TransferGraph = {
    edges,
    clusters,
    memberByOwner,
    scannedTokenAccounts: tokenAccounts.length,
    scannedSignatures: signatures.length,
    parsedTransactions,
    failedTransactions,
    ambiguousTransactions: stats.ambiguousTransactions,
    unmatchedTransactions: stats.unmatchedTransactions,
    selfTransfers: stats.selfTransfers,
    unknownOwners: stats.unknownOwners,
    truncated,
    windowStart: times.length > 0 ? Math.min(...times) : null,
    windowEnd: times.length > 0 ? Math.max(...times) : null,
    fetchedAt: Date.now(),
  }

  const partial = failedTransactions > 0 || parsedTransactions < scanSet.length
  cache.set(key, {
    expiresAt: Date.now() + (partial ? PARTIAL_CACHE_MS : CACHE_MS),
    value,
  })
  return value
}

export function clearTransferCache(): void {
  cache.clear()
}
