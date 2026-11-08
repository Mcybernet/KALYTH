import { useEffect, useState } from 'react'
import {
  fetchOhlcSnapshot,
  snapshotToActivity,
  type OhlcSnapshot,
} from '../lib/ohlc'
import type { ActivityRecord } from '../lib/history'

const REFRESH_MS = 5 * 60 * 1_000

export type OhlcSnapshotState = {
  records: ActivityRecord[]
  snapshot: OhlcSnapshot | null
  loading: boolean
  error: string | null
}

/**
 * Loads the full trade history shipped with the site. The chart merges these
 * rows with the live activity window, so candles no longer change just because
 * a row scrolled out of the newest-40 page.
 */
export function useOhlcSnapshot(): OhlcSnapshotState {
  const [records, setRecords] = useState<ActivityRecord[]>([])
  const [snapshot, setSnapshot] = useState<OhlcSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)

    fetchOhlcSnapshot(controller.signal)
      .then((value) => {
        if (cancelled) {
          return
        }
        setSnapshot(value)
        setRecords(value ? snapshotToActivity(value) : [])
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          return
        }
        // A missing snapshot is expected on a fresh checkout; the chart falls
        // back to the live activity window, so this stays non-fatal.
        setError(
          cause instanceof Error ? cause.message : 'Failed to load OHLC snapshot',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [refreshKey])

  useEffect(() => {
    const timer = window.setInterval(
      () => setRefreshKey((value) => value + 1),
      REFRESH_MS,
    )
    return () => window.clearInterval(timer)
  }, [])

  return { records, snapshot, loading, error }
}
