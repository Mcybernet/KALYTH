import { useEffect, useRef, useState } from 'react'
import {
  fetchOhlcSnapshot,
  snapshotToActivity,
  type OhlcSnapshot,
} from '../lib/ohlc'
import type { ActivityRecord } from '../lib/history'

/**
 * The snapshot is redeployed every 15 minutes, but re-reading the (small) file
 * once a minute means a fresh deploy is picked up almost immediately. Live
 * activity is merged on top, so this only feeds the deep history.
 */
const REFRESH_MS = 60 * 1_000

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
  const loadedOnceRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    // Only the first load shows a spinner; later refreshes stay silent.
    if (!loadedOnceRef.current) {
      setLoading(true)
    }

    fetchOhlcSnapshot(controller.signal)
      .then((value) => {
        if (cancelled) {
          return
        }
        setSnapshot(value)
        setRecords(value ? snapshotToActivity(value) : [])
        setError(null)
        loadedOnceRef.current = true
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          return
        }
        // A transient refresh failure keeps the rows already on the chart. A
        // missing snapshot is expected on a fresh checkout; the chart falls
        // back to the live activity window, so this stays non-fatal.
        if (!loadedOnceRef.current) {
          setError(
            cause instanceof Error ? cause.message : 'Failed to load OHLC snapshot',
          )
        }
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
