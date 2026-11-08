export const RPC_URL = 'https://api.devnet.solana.com'

type RpcError = {
  code?: number
  message: string
}

type RpcResponse<T> = {
  result?: T
  error?: RpcError
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 8
const MIN_REQUEST_GAP = 250

class RpcRequestError extends Error {
  retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'RpcRequestError'
    this.retryable = retryable
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError')
  )
}

function abortError(): DOMException {
  return new DOMException('Request aborted', 'AbortError')
}

function backoffDelay(attempt: number): number {
  return Math.min(800 * 2 ** attempt, 8_000)
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)

    function handleAbort() {
      window.clearTimeout(timer)
      reject(abortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

/**
 * The public Devnet endpoint rate limits aggressively. All requests are queued
 * through a single lane with a small gap so activity scanning does not trigger
 * a 429 storm.
 */
let queueTail: Promise<void> = Promise.resolve()
let lastRequestAt = 0

function scheduleRequest<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const run = queueTail.then(async () => {
    if (signal?.aborted) {
      throw abortError()
    }

    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_GAP - Date.now())
    if (wait > 0) {
      await sleep(wait, signal)
    }

    lastRequestAt = Date.now()
    return task()
  })

  queueTail = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}

async function sendRequest<T>(
  method: string,
  params: unknown[],
  signal: AbortSignal | undefined,
  maxAttempts: number,
): Promise<T> {
  let lastError: unknown = new RpcRequestError('RPC request failed', true)

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw abortError()
    }

    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
      })

      if (RETRYABLE_STATUS.has(response.status)) {
        lastError = new RpcRequestError(
          `RPC request failed with status ${response.status}`,
          true,
        )
      } else if (!response.ok) {
        throw new RpcRequestError(
          `RPC request failed with status ${response.status}`,
          false,
        )
      } else {
        const json = (await response.json()) as RpcResponse<T>

        if (json.error) {
          throw new RpcRequestError(json.error.message, false)
        }
        if (json.result === undefined) {
          throw new RpcRequestError('RPC response did not include a result', false)
        }

        return json.result
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      lastError = error

      if (error instanceof RpcRequestError && !error.retryable) {
        throw error
      }
    }

    if (attempt < maxAttempts - 1) {
      await sleep(backoffDelay(attempt), signal)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new RpcRequestError('RPC request failed', true)
}

/**
 * Minimal JSON-RPC client for Solana Devnet with global throttling and
 * retry/backoff for rate limits. Uses plain `fetch` so it works for
 * `jsonParsed` responses that web3.js rejects.
 */
export type RpcRequestOptions = {
  /** Lower this for optional scans where a slow retry would block the page. */
  maxAttempts?: number
}

export function rpcRequest<T>(
  method: string,
  params: unknown[],
  signal?: AbortSignal,
  options: RpcRequestOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  return scheduleRequest(
    () => sendRequest<T>(method, params, signal, maxAttempts),
    signal,
  )
}
