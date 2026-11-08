import { useMemo } from 'react'
import { ExternalLink, Info, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { WalletBubbleMap } from '../components/WalletBubbleMap'
import { useOhlcSnapshot } from '../hooks/useOhlcSnapshot'
import { useTokenHolders } from '../hooks/useTokenHolders'
import { explorerAddressUrl, shortenAddress } from '../lib/addresses'
import { formatHolderPercent, type HolderRole } from '../lib/holders'

const roleBadges: Record<HolderRole, string> = {
  burn: 'badge--danger',
  vault: 'badge--success',
  treasury: 'badge--warning',
  demo: 'badge--devnet',
  wallet: 'badge--primary',
}

export function WalletTrackerPage() {
  const { snapshot, loading, refreshing, error, refresh } = useTokenHolders()
  const ohlc = useOhlcSnapshot()

  // The published trade snapshot covers full history, so the curves are counted
  // from real buys/sells instead of being invented wallet-to-wallet links.
  const tradeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of ohlc.records) {
      if (record.kind === 'burn') {
        continue
      }
      counts.set(record.wallet, (counts.get(record.wallet) ?? 0) + 1)
    }
    return counts
  }, [ohlc.records])

  const holders = snapshot?.holders ?? []
  const topHolder = holders[0] ?? null
  const protocolPercent = holders
    .filter(
      (holder) =>
        holder.role === 'burn' || holder.role === 'vault' || holder.role === 'treasury',
    )
    .reduce((sum, holder) => sum + holder.percent, 0)

  const statusBadge = error
    ? { className: 'badge--danger', text: 'Error' }
    : loading
      ? { className: 'badge--devnet', text: 'Loading…' }
      : { className: 'badge--success', text: 'Live' }

  return (
    <div className="page-section">
      <PageHeader
        kicker="Wallet tracker"
        title="KLYTH holder map"
        description="Every wallet that holds KLYTH, sized by its share of the live supply. Links follow each wallet's buy/sell activity against the bonding curve."
        actions={
          <>
            <span className={`badge ${statusBadge.className}`}>{statusBadge.text}</span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={refreshing ? 'is-spinning' : undefined}
              />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      <div className="page-grid page-grid--4">
        <article className="card card--glow">
          <span className="data-label">Total supply</span>
          <div className="data-value">
            {snapshot ? snapshot.supply : loading ? 'Loading…' : '—'}
            <span className="data-unit">KLYTH</span>
          </div>
          <p className="data-meta">Live mint supply from Solana Devnet.</p>
        </article>

        <article className="card">
          <span className="data-label">Holders</span>
          <div className="data-value">
            {snapshot ? holders.length : loading ? 'Loading…' : '—'}
          </div>
          <p className="data-meta">
            {snapshot
              ? `${snapshot.tokenAccountCount} token account${snapshot.tokenAccountCount === 1 ? '' : 's'} grouped by owner.`
              : 'Token accounts grouped by owner.'}
          </p>
        </article>

        <article className="card">
          <span className="data-label">Top holder</span>
          <div className="data-value">
            {topHolder ? formatHolderPercent(topHolder.percent) : loading ? 'Loading…' : '—'}
          </div>
          <p className="data-meta">
            {topHolder
              ? `${topHolder.label} · ${topHolder.amount} KLYTH`
              : 'Largest single owner of the supply.'}
          </p>
        </article>

        <article className="card">
          <span className="data-label">Protocol-held</span>
          <div className="data-value">
            {snapshot ? `${protocolPercent.toFixed(2)}%` : loading ? 'Loading…' : '—'}
          </div>
          <p className="data-meta">Burn reserve, bonding-curve vault, and treasury.</p>
        </article>
      </div>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Holder bubble map</h3>
            <p className="card__description">
              Bubble area tracks each wallet&apos;s share of supply. Edge thickness follows
              the wallet&apos;s buy/sell count against the curve.
            </p>
          </div>
          <div className="card__actions">
            <span className="badge badge--devnet">getProgramAccounts</span>
            {snapshot ? (
              <span className="data-meta">
                Updated {new Date(snapshot.fetchedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="error-state">
            <h3 className="error-state__title">Unable to load holders</h3>
            <p className="error-state__text">{error}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : loading && !snapshot ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <span aria-hidden="true">◎</span>
            </div>
            <h3 className="empty-state__title">Reading holder accounts</h3>
            <p className="empty-state__text">
              Fetching every KLYTH token account from Solana Devnet.
            </p>
          </div>
        ) : holders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <span aria-hidden="true">◎</span>
            </div>
            <h3 className="empty-state__title">No holders found</h3>
            <p className="empty-state__text">
              The mint currently has no token accounts with a positive balance.
            </p>
          </div>
        ) : (
          <WalletBubbleMap holders={holders} tradeCounts={tradeCounts} />
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Holders by share of supply</h3>
            <p className="card__description">
              Balances are aggregated per owner. Percentages use the current on-chain
              supply as the denominator.
            </p>
          </div>
          <span className="badge badge--devnet">{holders.length} owners</span>
        </div>

        {holders.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__text">
              Holder rows appear once the mint has a positive balance.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table wallets-table">
              <caption className="sr-only">KLYTH holders ranked by balance</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Holder</th>
                  <th scope="col">Role</th>
                  <th scope="col" className="data-table__num">
                    Balance
                  </th>
                  <th scope="col">Share of supply</th>
                  <th scope="col" className="data-table__num">
                    Curve trades
                  </th>
                  <th scope="col">Explorer</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((holder, index) => {
                  const trades = tradeCounts.get(holder.owner) ?? 0

                  return (
                    <tr key={holder.owner}>
                      <td className="wallets-table__rank">{index + 1}</td>
                      <td>
                        <div className="wallets-table__holder">
                          <span className="wallets-table__label">{holder.label}</span>
                          <a
                            className="wallets-table__address"
                            href={explorerAddressUrl(holder.owner)}
                            target="_blank"
                            rel="noreferrer"
                            title={holder.owner}
                          >
                            {shortenAddress(holder.owner, 6, 6)}
                          </a>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${roleBadges[holder.role]}`}>
                          {holder.role === 'wallet' ? 'Holder' : holder.label}
                        </span>
                      </td>
                      <td className="data-table__num wallets-table__amount">
                        {holder.amount}
                        <span className="data-unit">KLYTH</span>
                      </td>
                      <td>
                        <div className="holder-share">
                          <div className="holder-share__track">
                            <span
                              className={`holder-share__fill holder-share__fill--${holder.role}`}
                              style={{ width: `${Math.min(100, holder.percent)}%` }}
                            />
                          </div>
                          <span className="holder-share__value">
                            {formatHolderPercent(holder.percent)}
                          </span>
                        </div>
                      </td>
                      <td className="data-table__num data-table__muted">{trades}</td>
                      <td>
                        <a
                          className="tx-link"
                          href={explorerAddressUrl(holder.owner)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${holder.owner} on Solana Explorer`}
                        >
                          Open
                          <ExternalLink size={12} aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card holder-source">
        <Info size={16} aria-hidden="true" />
        <div>
          <h3 className="card__title">How this map is built</h3>
          <p className="card__description">
            Holders come from <code>getProgramAccounts</code> on the SPL Token program,
            filtered by the KLYTH mint and grouped by owner. Percentages are balance ÷
            current supply. Map links join each wallet to the bonding curve using its
            buy/sell count in the published trade snapshot — they are not
            wallet-to-wallet transfers, and nothing is estimated.
          </p>
        </div>
      </section>
    </div>
  )
}
