import {
  KLYTH_MINT,
  PROGRAM_ID,
  getBurnAuthorityAddress,
  getBurnReserveAddress,
  getReserveAddress,
  getStateAddress,
  getVaultAddress,
} from './curve'

export const MINT_ADDRESS = KLYTH_MINT.toBase58()
export const PROGRAM_ADDRESS = PROGRAM_ID.toBase58()
export const STATE_ADDRESS = getStateAddress().toBase58()
export const VAULT_ADDRESS = getVaultAddress().toBase58()
export const SOL_RESERVE_ADDRESS = getReserveAddress().toBase58()

export const TREASURY_ADDRESS = '2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN'
export const BURN_AUTHORITY_ADDRESS = getBurnAuthorityAddress().toBase58()
export const BURN_RESERVE_TOKEN_ACCOUNT = getBurnReserveAddress().toBase58()

const CLUSTER_QUERY = '?cluster=devnet'

/**
 * Devnet demo wallet. When set at build time, its trades are labelled in the
 * activity tables so test activity is never mistaken for real users.
 */
export const DEMO_WALLET_ADDRESS =
  (import.meta.env.VITE_DEMO_WALLET_ADDRESS as string | undefined)?.trim() || null

export function isDemoWallet(wallet: string): boolean {
  return DEMO_WALLET_ADDRESS !== null && wallet === DEMO_WALLET_ADDRESS
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${CLUSTER_QUERY}`
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${CLUSTER_QUERY}`
}

export function shortenAddress(value: string, head = 6, tail = 6): string {
  if (value.length <= head + tail + 1) {
    return value
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
