import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchActivity,
  type ActivityRecord,
} from '../lib/history'

type UseActivityOptions = {
  pageSize?: number
  initialSize?: number
  /** Background refresh interval in milliseconds. Zero disables polling. */
  pollIntervalMs?: number
  /**
   * Records already loaded elsewhere (the OHLC snapshot). Their signatures are
   * not fetched again, so only activity newer than the snapshot hits the RPC.
   */
  seed?: ReadonlyArray<ActivityRecord>
  /**
   * Set false to hold the first request until the seed is resolved. Prevents a
   * slow full scan when a snapshot is about to arrive.
   */
  enabled?: boolean
}

type UseActivityResult = {
  records: ActivityRecord[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

export function useActivity({
  pageSize = 10,
  initialSize,
  pollIntervalMs = 0,
  seed,
  enabled = true,
}: UseActivityOptions = {}): UseActivityResult {
  const [limit, setLimit] = useState(initialSize ?? pageSize)
  const [refreshKey, setRefreshKey] = useState(0)
  const [records, setRecords] = useState<ActivityRecord[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A ref keeps seed changes (snapshot refreshes) from restarting the poll; the
  // next request simply picks up the newer rows.
  const seedRef = useRef(seed)
  seedRef.current = seed

  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
    let cancelled = false
    let inFlight = false

    async function load(force: boolean, silent: boolean) {
      // Never let a poll overlap a foreground request (or another poll).
      if (inFlight) {
        return
      }
      inFlight = true

      if (!silent) {
        if (records.length > 0) {
          setLoadingMore(true)
        } else {
          setLoading(true)
        }
        setError(null)
      }

      try {
        const page = await fetchActivity(
          limit,
          controller.signal,
          force,
          seedRef.current,
        )
        if (cancelled) {
          return
        }
        setRecords(page.records)
        setHasMore(page.hasMore)
        if (silent) {
          setError(null)
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return
        }
        // Background polls keep the last good data instead of flashing an error.
        if (!silent) {
          const message =
            cause instanceof Error ? cause.message : 'Failed to load on-chain activity'
          setError(message)
        }
      } finally {
        inFlight = false
        if (!cancelled && !silent) {
          setLoading(false)
          setLoadingMore(false)
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
      // Hidden tabs skip the RPC call; Devnet rate limits are tight.
      if (document.visibilityState === 'visible') {
        void load(true, true)
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        poll()
        stopPolling()
        timer = window.setInterval(poll, pollIntervalMs)
      } else {
        stopPolling()
      }
    }

    if (pollIntervalMs > 0) {
      timer = window.setInterval(poll, pollIntervalMs)
      document.addEventListener('visibilitychange', handleVisibility)
    }

    return () => {
      cancelled = true
      stopPolling()
      if (pollIntervalMs > 0) {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      controller.abort()
    }
    // `records.length` is intentionally not a dependency: it only decides the
    // loading flavour and must not retrigger the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, refreshKey, pollIntervalMs, enabled])

  const loadMore = useCallback(() => {
    setLimit((value) => value + pageSize)
  }, [pageSize])

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  return {
    records,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  }
}
