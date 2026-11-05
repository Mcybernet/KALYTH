import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'

export type TransactionStatusState =
  | 'idle'
  | 'preparing'
  | 'waiting'
  | 'processing'
  | 'confirmed'
  | 'failed'

type TransactionStatusProps = {
  status: TransactionStatusState
  title?: string
  description?: string
  signature?: string
  onRetry?: () => void
  onDismiss?: () => void
}

const labels: Record<TransactionStatusState, string> = {
  idle: 'Idle',
  preparing: 'Preparing transaction',
  waiting: 'Waiting for wallet approval',
  processing: 'Processing on-chain',
  confirmed: 'Confirmed',
  failed: 'Failed',
}

export function TransactionStatus({
  status,
  title,
  description,
  signature,
  onRetry,
  onDismiss,
}: TransactionStatusProps) {
  const isBusy = status === 'preparing' || status === 'waiting' || status === 'processing'

  return (
    <div
      className={`transaction-status transaction-status--${status}`}
      role="status"
      aria-live="polite"
      aria-busy={isBusy}
    >
      <div className="transaction-status__icon" aria-hidden="true">
        {status === 'idle' ? <Circle size={20} /> : null}
        {isBusy ? <Loader2 size={20} className="transaction-status__spinner" /> : null}
        {status === 'confirmed' ? <CheckCircle2 size={20} /> : null}
        {status === 'failed' ? <XCircle size={20} /> : null}
      </div>
      <div className="transaction-status__body">
        <h3 className="transaction-status__title">{title ?? labels[status]}</h3>
        {description ? <p className="transaction-status__text">{description}</p> : null}
        {signature ? (
          <p className="transaction-status__signature">
            Signature: <span className="mono">{signature}</span>
          </p>
        ) : null}
        <div className="transaction-status__actions">
          {status === 'failed' && onRetry ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {status === 'confirmed' && onDismiss ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
