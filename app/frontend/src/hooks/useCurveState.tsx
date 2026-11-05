import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useConnection } from '@solana/wallet-adapter-react'
import {
  fetchCurveState,
  fetchReserveLamports,
  fetchVaultAmount,
  type CurveState,
} from '../lib/curve'

type CurveSnapshot = {
  loading: boolean
  error: string | null
  state: CurveState | null
  vaultAmount: bigint | null
  reserveLamports: bigint | null
  rentExempt: bigint | null
}

type CurveStateValue = CurveSnapshot & {
  refresh: () => void
}

const initialState: CurveSnapshot = {
  loading: true,
  error: null,
  state: null,
  vaultAmount: null,
  reserveLamports: null,
  rentExempt: null,
}

const POLL_INTERVAL = 20_000

const CurveStateContext = createContext<CurveStateValue | null>(null)

export function CurveStateProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection()
  const [snapshot, setSnapshot] = useState<CurveSnapshot>(initialState)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [state, vaultAmount, reserveLamports, rentExempt] = await Promise.all([
          fetchCurveState(connection),
          fetchVaultAmount(connection),
          fetchReserveLamports(connection),
          connection.getMinimumBalanceForRentExemption(0),
        ])
        if (!cancelled) {
          setSnapshot({
            loading: false,
            error: null,
            state,
            vaultAmount,
            reserveLamports,
            rentExempt: BigInt(rentExempt),
          })
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load curve state',
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
  }, [connection, refreshKey])

  const value = useMemo(() => ({ ...snapshot, refresh }), [snapshot, refresh])

  return <CurveStateContext.Provider value={value}>{children}</CurveStateContext.Provider>
}

export function useCurveState(): CurveStateValue {
  const value = useContext(CurveStateContext)
  if (!value) {
    throw new Error('useCurveState must be used inside CurveStateProvider')
  }
  return value
}
