import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ActivityTable } from '../components/ActivityTable'
import { PageHeader } from '../components/PageHeader'
import { useActivity } from '../hooks/useActivity'
import type { ActivityKind } from '../lib/history'

const filters = ['All', 'Buy', 'Sell', 'Burn'] as const
type Filter = (typeof filters)[number]

const filterKinds: Record<Exclude<Filter, 'All'>, ActivityKind> = {
  Buy: 'buy',
  Sell: 'sell',
  Burn: 'burn',
}

const PAGE_SIZE = 10

export function ActivityPage() {
  const [activeFilter, setActiveFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const { records, loading, loadingMore, error, hasMore, loadMore, refresh } =
    useActivity({ pageSize: PAGE_SIZE })

  const normalizedQuery = query.trim().toLowerCase()
  const visibleRecords = records.filter((record) => {
    const matchesFilter =
      activeFilter === 'All' || record.kind === filterKinds[activeFilter]
    const matchesQuery =
      normalizedQuery.length === 0 ||
      record.wallet.toLowerCase().includes(normalizedQuery) ||
      record.signature.toLowerCase().includes(normalizedQuery)

    return matchesFilter && matchesQuery
  })

  const showSkeleton = loading && records.length === 0

  return (
    <div className="page-section">
      <PageHeader
        kicker="Activity"
        title="On-chain transaction ledger"
        description="Buy, Sell, and Burn transactions verified on Solana Devnet. Search and filters apply to the transactions already loaded in this view."
        actions={
          <span
            className={`badge ${error ? 'badge--danger' : loading ? 'badge--neutral' : 'badge--success'}`}
          >
            {error ? 'Error' : loading ? 'Loading…' : 'Live'}
          </span>
        }
      />

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Transaction ledger</h3>
            <p className="card__description">
              Buy, Sell, and Burn transactions verified on Solana Devnet.
            </p>
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
              onClick={refresh}
              aria-label="Refresh activity"
              title="Refresh"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="filter-row activity-toolbar">
          <div className="filter-row">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`btn btn--sm ${activeFilter === filter ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setActiveFilter(filter)}
                aria-pressed={activeFilter === filter}
              >
                {filter}
              </button>
            ))}
          </div>
          <input
            className="input search-input"
            type="search"
            placeholder="Search loaded wallet or signature"
            aria-label="Search loaded activity by wallet or signature"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {error ? (
          <div className="error-state">
            <h3 className="error-state__title">Unable to load activity</h3>
            <p className="error-state__text">{error}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : showSkeleton ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Wallet</th>
                  <th scope="col" className="data-table__num">
                    Amount
                  </th>
                  <th scope="col" className="data-table__num">
                    SOL Value
                  </th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Signature</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((row) => (
                  <tr key={row}>
                    {Array.from({ length: 7 }).map((_, cell) => (
                      <td key={cell}>
                        <span className="skeleton skeleton--text" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <span aria-hidden="true">◎</span>
            </div>
            <h3 className="empty-state__title">
              {records.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            </h3>
            <p className="empty-state__text">
              {records.length === 0
                ? 'Buy, Sell, and Burn transactions appear here once they are confirmed on Solana Devnet.'
                : 'No loaded transaction matches this filter or search. Try loading more history.'}
            </p>
          </div>
        ) : (
          <ActivityTable records={visibleRecords} caption="KALYTH transaction activity" />
        )}

        {records.length > 0 ? (
          <div className="table-footer">
            <p className="data-meta">
              Showing {visibleRecords.length} of {records.length} loaded transactions.
              {hasMore ? ' Older transactions are available.' : ' End of history.'}
            </p>
            <div className="table-footer__actions">
              {hasMore ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost btn--sm" onClick={refresh}>
                Refresh
              </button>
            </div>
          </div>
        ) : null}

        <p className="data-meta" style={{ marginTop: 'var(--space-4)' }}>
          Search filters only the transactions already loaded in this view.
        </p>
      </section>
    </div>
  )
}
