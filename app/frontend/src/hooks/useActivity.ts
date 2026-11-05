import { useCallback, useEffect, useState } from 'react'
import {
  fetchActivity,
  type ActivityRecord,
} from '../lib/history'

type UseActivityOptions = {
  pageSize?: number
  initialSize?: number
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
}: UseActivityOptions = {}): UseActivityResult {
  const [limit, setLimit] = useState(initialSize ?? pageSize)
  const [refreshKey, setRefreshKey] = useState(0)
  const [records, setRecords] = useState<ActivityRecord[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      if (records.length > 0) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const page = await fetchActivity(limit, controller.signal, refreshKey > 0)
        if (cancelled) {
          return
        }
        setRecords(page.records)
        setHasMore(page.hasMore)
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return
        }
        const message =
          cause instanceof Error ? cause.message : 'Failed to load on-chain activity'
        setError(message)
      } finally {
        if (!cancelled) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
    // `records.length` is intentionally not a dependency: it only decides the
    // loading flavour and must not retrigger the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, refreshKey])

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
