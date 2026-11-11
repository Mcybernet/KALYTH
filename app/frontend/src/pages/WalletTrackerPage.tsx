import { useMemo } from 'react'
import { ExternalLink, Info, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { WalletBubbleMap } from '../components/WalletBubbleMap'
import { useHolderTransfers } from '../hooks/useHolderTransfers'
import { useOhlcSnapshot } from '../hooks/useOhlcSnapshot'
import { useTokenHolders } from '../hooks/useTokenHolders'
import { explorerAddressUrl, shortenAddress } from '../lib/addresses'
import {
  formatHolderPercent,
  HOLDER_TIERS,
  holderTier,
  type HolderRole,
} from '../lib/holders'

const roleBadges: Record<HolderRole, string> = {
  burn: 'badge--danger',
  vault: 'badge--success',
  treasury: 'badge--warning',
  demo: 'badge--devnet',
  wallet: 'badge--primary',
}

export function WalletTrackerPage() {
  const { snapshot, loading, refreshing, error, refresh } = useTokenHolders()
  const transfers = useHolderTransfers(snapshot)
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

  const tierCounts = useMemo(
    () =>
      HOLDER_TIERS.map((tier) => ({
        tier,
        count: holders.filter((holder) => holder.tier === tier.key).length,
      })),
    [holders],
  )

  const walletLinks =
    transfers.graph?.edges.filter((edge) => edge.kind === 'wallet').length ?? 0

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
        description="Every wallet that holds KLYTH, sized by its share of the live supply and bucketed into holder tiers. Links replay parsed Devnet transfer transactions to expose trader clusters."
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
              Bubble area tracks each wallet&apos;s share of supply. Solid links are parsed
              wallet-to-wallet SPL transfers; dashed links are bonding-curve flows.
            </p>
          </div>
          <div className="card__actions">
            <span className={`badge ${transfers.error ? 'badge--warning' : 'badge--devnet'}`}>
              {transfers.scanning
                ? 'Scanning transfers…'
                : transfers.graph
                  ? walletLinks > 0
                    ? `${walletLinks} wallet link${walletLinks === 1 ? '' : 's'}`
                    : `${transfers.graph.edges.length} curve flow${
                        transfers.graph.edges.length === 1 ? '' : 's'
                      }`
                  : 'Transfer scan'}
            </span>
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
          <>
            <WalletBubbleMap
              holders={holders}
              tradeCounts={tradeCounts}
              decimals={snapshot?.decimals ?? 6}
              graph={transfers.graph}
              scanning={transfers.scanning}
              scanError={transfers.error}
              progress={transfers.progress}
              onRefreshTransfers={transfers.refresh}
            />
            {transfers.error ? (
              <p className="wallet-map__scan-error">
                Transfer replay hit a Devnet rate limit. The map keeps the holder
                bubbles and any partial links already parsed — retry from the map
                controls.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Holders by share of supply</h3>
            <p className="card__description">
              Balances are aggregated per owner and bucketed by KLYTH holding size.
              Percentages use the current on-chain supply as the denominator.
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
          <>
            <div className="holder-tiers" aria-label="Holder tier classification">
              {tierCounts.map(({ tier, count }) => (
                <span
                  key={tier.key}
                  className={`holder-tier holder-tier--${tier.key}${count === 0 ? ' is-empty' : ''}`}
                  title={tier.rangeLabel}
                >
                  <span className="holder-tier__emoji" aria-hidden="true">
                    {tier.emoji}
                  </span>
                  <span className="holder-tier__label">{tier.label}</span>
                  <strong className="holder-tier__count">{count}</strong>
                </span>
              ))}
              <span className="holder-tiers__note">
                Tiers by total KLYTH balance, protocol wallets included.
              </span>
            </div>
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
                  const tier = holderTier(holder.tier)

                  return (
                    <tr key={holder.owner}>
                      <td className="wallets-table__rank">{index + 1}</td>
                      <td>
                        <div className="wallets-table__holder">
                          <span
                            className="wallets-table__label"
                            title={tier.rangeLabel}
                          >
                            <span aria-hidden="true">{tier.emoji}</span>{' '}
                            {holder.label}
                            <span className="sr-only"> ({tier.label} tier)</span>
                          </span>
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
          </>
        )}
      </section>

      <section className="card holder-source">
        <Info size={16} aria-hidden="true" />
        <div>
          <h3 className="card__title">How this map is built</h3>
          <p className="card__description">
            Holder balances come from <code>getProgramAccounts</code> on the SPL Token
            program, filtered by the KLYTH mint and grouped by owner. Tier thresholds use
            the whole-token balance; percentages use balance ÷ current supply. Transfer
            links come from <code>getSignaturesForAddress</code> plus{' '}
            <code>getTransaction</code> on the current holders&apos; token accounts. Each
            edge is derived from SPL token balance deltas inside a successful
            transaction, so solid wallet-to-wallet lines are real transfers, not
            estimates. Multi-party transactions and transfers to wallets that no longer
            hold KLYTH are skipped, and the public Devnet endpoint caps the recent
            transaction window.
          </p>
        </div>
      </section>
    </div>
  )
}
