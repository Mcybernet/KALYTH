import { ExternalLink, RefreshCw } from 'lucide-react'
import { explorerTxUrl, shortenAddress } from '../lib/addresses'
import { formatBlockTime, type ActivityKind, type ActivityRecord } from '../lib/history'

const kindLabels: Record<ActivityKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  burn: 'Burn',
}

const kindBadges: Record<ActivityKind, string> = {
  buy: 'badge--success',
  sell: 'badge--primary',
  burn: 'badge--danger',
}

type RecentActivityProps = {
  records: ActivityRecord[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  title?: string
  description?: string
  limit?: number
  className?: string
}

export function RecentActivity({
  records,
  loading,
  error,
  onRefresh,
  title = 'Recent Activity',
  description = 'Buy, Sell, and Burn transactions confirmed on Solana Devnet.',
  limit = 6,
  className,
}: RecentActivityProps) {
  const visible = records.slice(0, limit)

  return (
    <section className={`card portal-panel recent-activity-card ${className ?? ''}`.trim()}>
      <div className="portal-panel__head">
        <div>
          <h2 className="portal-panel__title">{title}</h2>
          <p className="portal-panel__text">{description}</p>
        </div>
        <div className="card__actions">
          <span
            className={`badge ${error ? 'badge--danger' : loading ? 'badge--neutral' : 'badge--success'}`}
          >
            {error ? 'Error' : loading ? 'Loading…' : 'Live'}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={onRefresh}
            aria-label="Refresh recent activity"
            title="Refresh"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-state">
          <h3 className="error-state__title">Unable to load activity</h3>
          <p className="error-state__text">{error}</p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRefresh}>
            Retry
          </button>
        </div>
      ) : loading && records.length === 0 ? (
        <div className="recent-activity__loading" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => (
            <span key={row} className="skeleton skeleton--text" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">
            <span aria-hidden="true">◎</span>
          </div>
          <h3 className="empty-state__title">No activity yet</h3>
          <p className="empty-state__text">
            Buy, Sell, and Burn transactions appear here once they are confirmed on
            Solana Devnet.
          </p>
        </div>
      ) : (
        <ul className="recent-activity">
          {visible.map((record) => (
            <li className="recent-activity__item" key={record.signature}>
              <span className={`badge ${kindBadges[record.kind]}`}>
                {kindLabels[record.kind]}
              </span>
              <span className="recent-activity__amount">{record.amount} KLYTH</span>
              <span className="recent-activity__wallet" title={record.wallet}>
                {shortenAddress(record.wallet, 4, 4)}
              </span>
              <span className="recent-activity__time">
                {record.status === 'failed' ? (
                  <span className="badge badge--danger">Failed</span>
                ) : (
                  formatBlockTime(record.blockTime)
                )}
              </span>
              <a
                className="icon-button"
                href={explorerTxUrl(record.signature)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open transaction in Solana Explorer"
                title="Open in Solana Explorer"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
