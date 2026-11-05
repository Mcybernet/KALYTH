import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { KLYTH_MINT } from '../lib/curve'

const POLL_INTERVAL = 20_000

type WalletBalances = {
  loading: boolean
  sol: string | null
  nbr: string | null
  nbrTotal: string | null
  solLamports: bigint | null
  nbrRaw: bigint | null
  nbrTotalRaw: bigint | null
  otherRaw: bigint | null
  error: string | null
}

const emptyBalances: WalletBalances = {
  loading: false,
  sol: null,
  nbr: null,
  nbrTotal: null,
  solLamports: null,
  nbrRaw: null,
  nbrTotalRaw: null,
  otherRaw: null,
  error: null,
}

function formatToken(raw: bigint | null): string | null {
  if (raw === null) {
    return null
  }
  return (Number(raw) / 10 ** 6).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

export function useWalletBalances(): WalletBalances & { refresh: () => void } {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const [state, setState] = useState<WalletBalances>(emptyBalances)
  const [refreshKey, setRefreshKey] = useState(0)
  const lastWallet = useRef<string | null>(null)

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!publicKey) {
      lastWallet.current = null
      setState(emptyBalances)
      return
    }

    let cancelled = false
    const wallet = publicKey.toBase58()
    const walletChanged = lastWallet.current !== wallet
    lastWallet.current = wallet

    if (walletChanged) {
      setState({ ...emptyBalances, loading: true })
    }

    async function load() {
      try {
        const solLamports = BigInt(await connection.getBalance(publicKey as PublicKey))

        let nbrRaw = 0n
        let nbrTotalRaw = 0n
        try {
          const ata = await getAssociatedTokenAddress(KLYTH_MINT, publicKey as PublicKey)
          const accounts = await connection.getParsedTokenAccountsByOwner(publicKey as PublicKey, {
            mint: KLYTH_MINT,
          })

          for (const entry of accounts.value) {
            const data = entry.account.data as {
              parsed?: { info?: { tokenAmount?: { amount?: string } } }
            }
            const amount = data.parsed?.info?.tokenAmount?.amount
            if (typeof amount !== 'string') {
              continue
            }
            const raw = BigInt(amount)
            nbrTotalRaw += raw
            if (entry.pubkey.equals(ata)) {
              nbrRaw = raw
            }
          }
        } catch {
          nbrRaw = 0n
          nbrTotalRaw = 0n
        }

        const otherRaw = nbrTotalRaw > nbrRaw ? nbrTotalRaw - nbrRaw : 0n

        if (!cancelled) {
          setState({
            loading: false,
            sol: (Number(solLamports) / 1_000_000_000).toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 6,
            }),
            nbr: formatToken(nbrRaw),
            nbrTotal: formatToken(nbrTotalRaw),
            solLamports,
            nbrRaw,
            nbrTotalRaw,
            otherRaw,
            error: null,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load balances',
          }))
        }
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), POLL_INTERVAL)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [connection, publicKey, refreshKey])

  return { ...state, refresh }
}
