import { ActivityTable } from '../components/ActivityTable'
import { AddressRow } from '../components/AddressRow'
import { PageHeader } from '../components/PageHeader'
import { useKlythData } from '../hooks/useKlythData'
import { BURN_RESERVE_TOKEN_ACCOUNT } from '../lib/addresses'

export function BurnTrackerPage() {
  const { loading, error, mint, burnReserve, burnStats, refresh } = useKlythData()

  const totalBurned = burnStats?.total ?? null
  const burnCount = burnStats?.burnCount ?? null
  const records = burnStats?.records ?? []

  return (
    <div className="page-section">
      <PageHeader
        kicker="Burn Tracker"
        title="Every verified KLYTH burn"
        description="Burn totals are reconstructed from SPL Token burn instructions that target the burn reserve account. Nothing is estimated."
        actions={<span className="badge badge--danger">Deflationary</span>}
      />

      <div className="page-grid page-grid--3">
        <article className="card card--glow">
          <div className="card__header">
            <div>
              <span className="data-label">Total KLYTH Burned</span>
              <div className="data-value">
                {loading ? 'Loading…' : error ? 'Error' : (totalBurned ?? '—')}
                <span className="data-unit">KLYTH</span>
              </div>
            </div>
            <span className={`badge ${error ? 'badge--danger' : 'badge--neutral'}`}>
              {error ? 'Error' : 'Live'}
            </span>
          </div>
          <p className="data-meta">
            {error
              ? error
              : burnCount !== null
                ? `Sum of ${burnCount} verified SPL Token burn transaction${burnCount === 1 ? '' : 's'} from the burn reserve.`
                : 'Sum of verified SPL Token burn transactions.'}
          </p>
        </article>

        <article className="card">
          <div className="card__header">
            <div>
              <span className="data-label">Current Supply</span>
              <div className="data-value">
                {loading ? 'Loading…' : error ? 'Error' : (mint?.supply ?? '—')}
                <span className="data-unit">KLYTH</span>
              </div>
            </div>
            <span className={`badge ${error ? 'badge--danger' : 'badge--neutral'}`}>
              {error ? 'Error' : 'Live'}
            </span>
          </div>
          <p className="data-meta">
            {error ? error : 'Live mint supply from Devnet (decreases only through burns).'}
          </p>
        </article>

        <article className="card">
          <div className="card__header">
            <div>
              <span className="data-label">Burn Reserve Balance</span>
              <div className="data-value">
                {loading ? 'Loading…' : error ? 'Error' : (burnReserve?.balance ?? '—')}
                <span className="data-unit">KLYTH</span>
              </div>
            </div>
            <span className={`badge ${error ? 'badge--danger' : 'badge--neutral'}`}>
              {error ? 'Error' : 'Live'}
            </span>
          </div>
          <p className="data-meta">
            {error ? error : 'Balance of the burn reserve token account.'}
          </p>
        </article>
      </div>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Burn History</h3>
            <p className="card__description">
              Date, amount, authority, signature, and status.
            </p>
          </div>
          <span className={`badge ${error ? 'badge--danger' : 'badge--success'}`}>
            {error ? 'Error' : 'Live'}
          </span>
        </div>

        {error ? (
          <div className="error-state">
            <h3 className="error-state__title">Unable to load burn history</h3>
            <p className="error-state__text">{error}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : loading && !burnStats ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <span aria-hidden="true">◎</span>
            </div>
            <h3 className="empty-state__title">Loading burn history</h3>
            <p className="empty-state__text">
              Fetching verified burn transactions from Devnet.
            </p>
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <span aria-hidden="true">◎</span>
            </div>
            <h3 className="empty-state__title">No burn history yet</h3>
            <p className="empty-state__text">
              Burn records appear here after a verified SPL Token burn from the burn
              reserve account.
            </p>
          </div>
        ) : (
          <ActivityTable records={records} caption="Verified KLYTH burn transactions" />
        )}

        <div className="card__footer">
          <AddressRow label="Burn reserve account" value={BURN_RESERVE_TOKEN_ACCOUNT} />
          <p className="data-meta">
            Read directly from SPL Token burn instructions targeting the burn reserve.
            Burns are permissionless: <code>burn_daily</code> releases at most 800,000
            KLYTH once per 23h50m window, so the schedule runs without a manual dev
            signature.
          </p>
        </div>
      </section>
    </div>
  )
}
