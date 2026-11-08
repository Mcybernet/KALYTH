import {
  BURN_AUTHORITY_ADDRESS,
  BURN_RESERVE_TOKEN_ACCOUNT,
  DEMO_WALLET_ADDRESS,
  MINT_ADDRESS,
  STATE_ADDRESS,
  TREASURY_ADDRESS,
} from './addresses'
import { rpcRequest } from './rpc'
import { formatTokenAmount } from './solana'

/** Classic SPL Token program. KLYTH uses the original token standard. */
export const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export type HolderRole = 'burn' | 'vault' | 'treasury' | 'demo' | 'wallet'

export type TokenHolder = {
  /** Wallet that controls the token accounts below. */
  owner: string
  tokenAccounts: string[]
  amountRaw: string
  amount: string
  amountNumber: number
  percent: number
  role: HolderRole
  label: string
}

export type HoldersSnapshot = {
  holders: TokenHolder[]
  supplyRaw: string
  supply: string
  supplyNumber: number
  decimals: number
  tokenAccountCount: number
  fetchedAt: number
}

type TokenAmount = {
  amount: string
  decimals: number
  uiAmountString: string | null
}

type SupplyResult = {
  context: { slot: number }
  value: TokenAmount
}

type ParsedTokenAccount = {
  pubkey: string
  account: {
    data: {
      parsed?: {
        info?: {
          owner?: string
          tokenAmount?: TokenAmount
        }
      }
    }
  }
}

/**
 * `getProgramAccounts` returns every token account for the mint in one call
 * (~60ms, a few KB on Devnet). `getTokenLargestAccounts` is heavily rate
 * limited on the public endpoint, so it is deliberately not used here.
 */
const CACHE_MS = 30_000

let cache: { expiresAt: number; value: HoldersSnapshot } | null = null

function roleFor(owner: string, tokenAccounts: string[]): {
  role: HolderRole
  label: string
} {
  if (owner === BURN_AUTHORITY_ADDRESS || tokenAccounts.includes(BURN_RESERVE_TOKEN_ACCOUNT)) {
    return { role: 'burn', label: 'Burn reserve' }
  }
  if (owner === STATE_ADDRESS) {
    return { role: 'vault', label: 'Bonding curve vault' }
  }
  if (owner === TREASURY_ADDRESS) {
    return { role: 'treasury', label: 'Treasury' }
  }
  if (DEMO_WALLET_ADDRESS !== null && owner === DEMO_WALLET_ADDRESS) {
    return { role: 'demo', label: 'Demo wallet' }
  }
  return { role: 'wallet', label: 'Holder' }
}

function compareRaw(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue === rightValue) {
    return 0
  }
  return leftValue > rightValue ? -1 : 1
}

function aggregate(
  accounts: ParsedTokenAccount[],
  supply: SupplyResult['value'],
): HoldersSnapshot {
  const byOwner = new Map<
    string,
    { tokenAccounts: string[]; amountRaw: bigint }
  >()

  for (const item of accounts) {
    const info = item.account.data.parsed?.info
    const owner = info?.owner
    const amountRaw = info?.tokenAmount?.amount
    if (!owner || !amountRaw || amountRaw === '0') {
      continue
    }

    const entry = byOwner.get(owner) ?? { tokenAccounts: [], amountRaw: 0n }
    entry.tokenAccounts.push(item.pubkey)
    entry.amountRaw += BigInt(amountRaw)
    byOwner.set(owner, entry)
  }

  const supplyNumber = Number(supply.amount)

  const holders: TokenHolder[] = []
  for (const [owner, entry] of byOwner) {
    const amountRaw = entry.amountRaw.toString()
    const amountNumber = Number(amountRaw)
    const { role, label } = roleFor(owner, entry.tokenAccounts)
    holders.push({
      owner,
      tokenAccounts: entry.tokenAccounts.filter(Boolean),
      amountRaw,
      amount: formatTokenAmount(amountRaw, supply.decimals),
      amountNumber,
      percent: supplyNumber > 0 ? (amountNumber / supplyNumber) * 100 : 0,
      role,
      label,
    })
  }

  holders.sort((left, right) => compareRaw(left.amountRaw, right.amountRaw))

  return {
    holders,
    supplyRaw: supply.amount,
    supply: formatTokenAmount(supply.amount, supply.decimals),
    supplyNumber,
    decimals: supply.decimals,
    tokenAccountCount: accounts.length,
    fetchedAt: Date.now(),
  }
}

/**
 * Reads the current holder distribution. The module-level cache makes the page
 * cheap to remount; `force` is used by manual refreshes and the poll timer.
 */
export async function fetchHolders(
  signal?: AbortSignal,
  force = false,
): Promise<HoldersSnapshot> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache.value
  }

  const [accounts, supply] = await Promise.all([
    rpcRequest<ParsedTokenAccount[]>(
      'getProgramAccounts',
      [
        TOKEN_PROGRAM_ADDRESS,
        {
          encoding: 'jsonParsed',
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: MINT_ADDRESS } },
          ],
          commitment: 'confirmed',
        },
      ],
      signal,
    ),
    rpcRequest<SupplyResult>('getTokenSupply', [MINT_ADDRESS, { commitment: 'confirmed' }], signal),
  ])

  const value = aggregate(accounts, supply.value)
  cache = { expiresAt: Date.now() + CACHE_MS, value }
  return value
}

export function formatHolderPercent(percent: number): string {
  return `${percent >= 1 ? percent.toFixed(2) : percent.toFixed(3)}%`
}
