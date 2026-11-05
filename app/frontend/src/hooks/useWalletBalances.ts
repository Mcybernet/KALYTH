import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

const KLYTH_MINT = new PublicKey('GuaBwGkmwKJqU5AkxCoFQdGqY1UsDGtswJ9KGphvhkeK')
const POLL_INTERVAL = 20_000

type WalletBalances = {
  loading: boolean
  sol: string | null
  nbr: string | null
  solLamports: bigint | null
  nbrRaw: bigint | null
  error: string | null
}

const emptyBalances: WalletBalances = {
  loading: false,
  sol: null,
  nbr: null,
  solLamports: null,
  nbrRaw: null,
  error: null,
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
        try {
          const ata = await getAssociatedTokenAddress(KLYTH_MINT, publicKey as PublicKey)
          const balance = await connection.getTokenAccountBalance(ata)
          nbrRaw = BigInt(balance.value.amount)
        } catch {
          nbrRaw = 0n
        }

        if (!cancelled) {
          setState({
            loading: false,
            sol: (Number(solLamports) / 1_000_000_000).toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 6,
            }),
            nbr: (Number(nbrRaw) / 10 ** 6).toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 6,
            }),
            solLamports,
            nbrRaw,
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
