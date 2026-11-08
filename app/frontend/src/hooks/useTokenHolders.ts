import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHolders, type HoldersSnapshot } from '../lib/holders'

/**
 * Holder balances move only when someone trades, so a one-minute poll is plenty
 * and keeps the public Devnet endpoint comfortable. Hidden tabs skip the call.
 */
const POLL_MS = 60_000

export type TokenHoldersState = {
  snapshot: HoldersSnapshot | null
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: () => void
}

export function useTokenHolders(): TokenHoldersState {
  const [snapshot, setSnapshot] = useState<HoldersSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const loadedOnceRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let inFlight = false

    async function load(force: boolean, silent: boolean) {
      if (inFlight) {
        return
      }
      inFlight = true

      if (!silent) {
        if (loadedOnceRef.current) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }
        setError(null)
      }

      try {
        const value = await fetchHolders(controller.signal, force)
        if (cancelled) {
          return
        }
        setSnapshot(value)
        setError(null)
        loadedOnceRef.current = true
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return
        }
        // A background poll keeps the last good map instead of flashing an error.
        if (!silent || !loadedOnceRef.current) {
          setError(
            cause instanceof Error ? cause.message : 'Failed to load token holders',
          )
        }
      } finally {
        inFlight = false
        if (!cancelled && !silent) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void load(refreshKey > 0, false)

    let timer: number | undefined
    const stopPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const poll = () => {
      if (document.visibilityState === 'visible') {
        void load(true, true)
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        poll()
        stopPolling()
        timer = window.setInterval(poll, POLL_MS)
      } else {
        stopPolling()
      }
    }

    timer = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibility)
      controller.abort()
    }
  }, [refreshKey])

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  return { snapshot, loading, refreshing, error, refresh }
}
