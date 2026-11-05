import { BURN_RESERVE_TOKEN_ACCOUNT, MINT_ADDRESS } from './addresses'
import { rpcRequest } from './rpc'

const TOKEN_DECIMALS = 6

export type MintInfo = {
  supply: string
  supplyRaw: string
  decimals: number
}

export type TokenBalanceInfo = {
  balance: string
  balanceRaw: string
  decimals: number
}

type TokenAmountResult = {
  value: {
    amount: string
    decimals: number
    uiAmountString: string | null
  }
}

/**
 * Formats a raw token amount as a grouped decimal string without going through
 * `Number`, so large supplies keep every digit.
 */
function formatTokenAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith('-')
  const digits = negative ? raw.slice(1) : raw
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

export async function fetchMintInfo(): Promise<MintInfo> {
  const result = await rpcRequest<TokenAmountResult>('getTokenSupply', [MINT_ADDRESS])
  const value = result.value

  return {
    supply: formatTokenAmount(value.amount, value.decimals),
    supplyRaw: value.amount,
    decimals: value.decimals,
  }
}

export async function fetchBurnReserveInfo(): Promise<TokenBalanceInfo> {
  const result = await rpcRequest<TokenAmountResult>('getTokenAccountBalance', [
    BURN_RESERVE_TOKEN_ACCOUNT,
  ])
  const value = result.value

  return {
    balance: formatTokenAmount(value.amount, value.decimals),
    balanceRaw: value.amount,
    decimals: value.decimals,
  }
}

export async function fetchMintSupply(): Promise<string> {
  return (await fetchMintInfo()).supply
}

export async function fetchBurnReserveBalance(): Promise<string> {
  return (await fetchBurnReserveInfo()).balance
}

export { TOKEN_DECIMALS, MINT_ADDRESS, BURN_RESERVE_TOKEN_ACCOUNT }
