import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HoldersSnapshot } from '../lib/holders'
import {
  fetchTransferGraph,
  type TransferGraph,
  type TransferScanProgress,
} from '../lib/transfers'

export type HolderTransfersState = {
  graph: TransferGraph | null
  scanning: boolean
  error: string | null
  progress: TransferScanProgress | null
  refresh: () => void
}

/**
 * The transfer scan is intentionally lazy: the holder map is useful
 * immediately, while the slower on-chain transaction replay fills in links.
 */
const START_DELAY_MS = 900

export function useHolderTransfers(
  snapshot: HoldersSnapshot | null,
): HolderTransfersState {
  const [graph, setGraph] = useState<TransferGraph | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<TransferScanProgress | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const graphRef = useRef<TransferGraph | null>(null)

  const holdersKey = useMemo(
    () =>
      snapshot
        ? snapshot.holders
            .map(
              (holder) =>
                `${holder.owner}:${holder.role}:${holder.tokenAccounts.slice().sort().join(',')}`,
            )
            .sort()
            .join('|')
        : '',
    [snapshot],
  )

  useEffect(() => {
    if (!snapshot || !holdersKey) {
      graphRef.current = null
      setGraph(null)
      setScanning(false)
      setError(null)
      setProgress(null)
      return
    }

    const controller = new AbortController()
    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      setScanning(true)
      setError(null)
      setProgress({ phase: 'signatures', done: 0, total: snapshot.holders.length })

      try {
        const value = await fetchTransferGraph(snapshot, controller.signal, {
          force: refreshKey > 0,
          onProgress: (next) => {
            if (!cancelled) setProgress(next)
          },
        })
        if (cancelled) return
        graphRef.current = value
        setGraph(value)
        setError(null)
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return
        // Keep the previous graph visible if a refresh fails.
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to scan wallet transfers on Devnet',
        )
      } finally {
        if (!cancelled) {
          setScanning(false)
          setProgress(null)
        }
      }
    }

    timer = window.setTimeout(() => {
      void run()
    }, START_DELAY_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      controller.abort()
    }
    // `holdersKey` changes only when the account/role set changes; 60s balance
    // polls should not restart an expensive transaction scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdersKey, refreshKey])

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1)
  }, [])

  return { graph: graph ?? graphRef.current, scanning, error, progress, refresh }
}
