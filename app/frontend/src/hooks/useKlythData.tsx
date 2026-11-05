import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchBurnStats, type BurnStats } from '../lib/history'
import {
  fetchBurnReserveInfo,
  fetchMintInfo,
  type MintInfo,
  type TokenBalanceInfo,
} from '../lib/solana'

type KlythData = {
  loading: boolean
  error: string | null
  mint: MintInfo | null
  burnReserve: TokenBalanceInfo | null
  burnStats: BurnStats | null
}

type KlythDataValue = KlythData & {
  refresh: () => void
}

const initialState: KlythData = {
  loading: true,
  error: null,
  mint: null,
  burnReserve: null,
  burnStats: null,
}

const KlythDataContext = createContext<KlythDataValue | null>(null)

export function KlythDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<KlythData>(initialState)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const [mint, burnReserve, burnStats] = await Promise.all([
          fetchMintInfo(),
          fetchBurnReserveInfo(),
          fetchBurnStats(controller.signal, refreshKey > 0),
        ])

        if (cancelled) {
          return
        }

        setData({
          loading: false,
          error: null,
          mint,
          burnReserve,
          burnStats,
        })
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return
        }

        const message =
          cause instanceof Error ? cause.message : 'Failed to load on-chain data'
        setData({
          loading: false,
          error: message,
          mint: null,
          burnReserve: null,
          burnStats: null,
        })
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [refreshKey])

  const value = useMemo(() => ({ ...data, refresh }), [data, refresh])

  return <KlythDataContext.Provider value={value}>{children}</KlythDataContext.Provider>
}

export function useKlythData(): KlythDataValue {
  const value = useContext(KlythDataContext)
  if (!value) {
    throw new Error('useKlythData must be used inside KlythDataProvider')
  }
  return value
}
