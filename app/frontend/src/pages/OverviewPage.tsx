import { Suspense, lazy, useMemo } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
} from 'lucide-react'
import { AddressRow } from '../components/AddressRow'
import { CurveProgress } from '../components/CurveProgress'
import { RecentActivity } from '../components/RecentActivity'
import { ThreeStage } from '../components/ThreeStage'
import { useActivity } from '../hooks/useActivity'
import { useCurveState } from '../hooks/useCurveState'
import { useKlythData } from '../hooks/useKlythData'
import { useOhlcSnapshot } from '../hooks/useOhlcSnapshot'
import {
  MINT_ADDRESS,
  PROGRAM_ADDRESS,
  STATE_ADDRESS,
  explorerAddressUrl,
} from '../lib/addresses'
import { KLYTH_LOGO_URL } from '../lib/assets'
import {
  INITIAL_PRICE_DIVISOR,
  SLOPE_DIVISOR,
  formatNbr,
  formatSol,
  formatSolPrice,
  marginalPriceSol,
} from '../lib/curve'
import { buildExecutionPoints } from '../lib/history'
import { mergeActivityRecords } from '../lib/ohlc'
import { useNavigation } from '../lib/navigation'

const KlythCoin = lazy(() => import('../three/KlythCoin'))
const ChainField = lazy(() => import('../three/ChainField'))
const BondingCurveChart = lazy(() =>
  import('../components/BondingCurveChart').then((module) => ({
    default: module.BondingCurveChart,
  })),
)

const TOKEN_SCALE = 1_000_000
const ACTIVITY_WINDOW = 40

export function OverviewPage() {
  const { navigate } = useNavigation()
  const { loading: dataLoading, error: dataError, mint, burnStats } = useKlythData()
  const curve = useCurveState()
  const activity = useActivity({ pageSize: ACTIVITY_WINDOW })
  const ohlc = useOhlcSnapshot()

  const state = curve.state
  const soldSupply = state?.soldSupply ?? null
  const maxSoldSupply = state?.maxSoldSupply ?? null
  const marginal = soldSupply !== null ? marginalPriceSol(soldSupply) : null
  const initialPriceSol = state !== null ? Number(state.initialPrice) / INITIAL_PRICE_DIVISOR : null
  const slopeSol = state !== null ? Number(state.slope) / SLOPE_DIVISOR : null
  const progress =
    soldSupply !== null && maxSoldSupply !== null && maxSoldSupply > 0n
      ? Number((soldSupply * 10_000n) / maxSoldSupply) / 100
      : null

  const totalSupply = mint?.supply ?? null
  const totalBurned = burnStats?.total ?? null
  const loading = dataLoading || curve.loading
  const error = dataError ?? curve.error

  const trades = useMemo(
    () =>
      buildExecutionPoints(
        mergeActivityRecords(ohlc.records, activity.records),
        curve.state?.soldSupply ?? null,
      ),
    [ohlc.records, activity.records, curve.state?.soldSupply],
  )

  const priceValue = marginal !== null ? formatSolPrice(marginal) : loading ? '…' : '—'
  const soldValue = soldSupply !== null ? formatNbr(soldSupply) : loading ? '…' : '—'
  const reserveValue =
    curve.reserveLamports !== null ? formatSol(curve.reserveLamports) : loading ? '…' : '—'
  const burnedValue = totalBurned ?? (loading ? '…' : '—')
  const supplyValue = totalSupply ?? (loading ? '…' : '—')

  const quickLinks = [
    { id: 'trade', label: 'Trade KLYTH', hint: 'Buy or sell on the curve' },
    { id: 'tokenomics', label: 'Tokenomics', hint: 'Supply and addresses' },
    { id: 'activity', label: 'Activity', hint: 'Confirmed transactions' },
    { id: 'burn', label: 'Burn Tracker', hint: 'Every verified burn' },
  ]

  return (
    <div className="portal-page">
      <section className="hero-min" aria-labelledby="home-hero-title">
        <div className="hero-min__copy">
          <p className="eyebrow">KLYTH / Solana Devnet</p>
          <h1 className="hero-min__title" id="home-hero-title">
            A token
            <br />
            priced by time.
          </h1>
          <p className="hero-min__text">
            KALYTH is a fixed-supply token on a transparent linear curve. Every price,
            trade, and burn on this page is read from Solana Devnet. Nothing is simulated.
          </p>

          <div className="hero-min__actions">
            <button type="button" className="btn btn--primary" onClick={() => navigate('trade')}>
              Trade KLYTH
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate('tokenomics')}
            >
              Read tokenomics
            </button>
          </div>
        </div>

        <div className="hero-min__stage">
          <ThreeStage
            className="hero-min__canvas"
            fallback={<img className="coin-fallback" src={KLYTH_LOGO_URL} alt="" />}
          >
            <KlythCoin />
          </ThreeStage>
          <p className="hero-min__caption">
            <span>KLYTH</span>
            <span>{error ? 'RPC issue — retrying' : '100M minted · 60M final'}</span>
          </p>
        </div>
      </section>

      <dl className="hero-ledger" aria-label="Live on-chain metrics">
        <div>
          <dt>Marginal price</dt>
          <dd>
            {priceValue} <span>SOL</span>
          </dd>
        </div>
        <div>
          <dt>Sold supply</dt>
          <dd>
            {soldValue} <span>KLYTH</span>
          </dd>
        </div>
        <div>
          <dt>SOL reserve</dt>
          <dd>
            {reserveValue} <span>SOL</span>
          </dd>
        </div>
        <div>
          <dt>Burned</dt>
          <dd>
            {burnedValue} <span>KLYTH</span>
          </dd>
        </div>
      </dl>

      <section className="principles" aria-label="Protocol principles">
        <article>
          <p className="eyebrow">Curve</p>
          <h2>Linear, on-chain.</h2>
          <p>
            Price moves with sold supply: P(x) = P0 + kx. The program holds the token
            vault and the SOL reserve.
          </p>
        </article>
        <article>
          <p className="eyebrow">Burn</p>
          <h2>Automatic by design.</h2>
          <p>
            A permissionless daily burn releases 800,000 KLYTH from a PDA-owned reserve.
            No developer signature is involved.
          </p>
        </article>
        <article>
          <p className="eyebrow">Ledger</p>
          <h2>Read, not rendered.</h2>
          <p>
            Balances, trades, and burns come from confirmed Devnet accounts and
            transactions. Unavailable data is shown as unavailable.
          </p>
        </article>
      </section>

      <section className="chain-band" aria-labelledby="chain-title">
        <div className="chain-band__copy">
          <p className="eyebrow">Settlement</p>
          <h2 id="chain-title">Every trade is a block.</h2>
          <p>
            Buys and sells settle on Solana in a single confirmed transaction. The chain
            view is an ambient diagram of that flow, not a second data source.
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => navigate('activity')}
          >
            Open activity
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        <ThreeStage
          className="chain-band__stage"
          fallback={<div className="chain-fallback" aria-hidden="true" />}
        >
          <ChainField />
        </ThreeStage>
      </section>

      <div className="portal-grid">
        <div className="portal-main">
          <section className="card portal-panel">
            <div className="portal-panel__head">
              <div>
                <p className="eyebrow">Price discovery</p>
                <h2 className="portal-panel__title">Bonding curve</h2>
                <p className="portal-panel__text">
                  P(x) = P0 + kx, read live from the program. Buys move the price up,
                  sells move it down.
                </p>
              </div>
              <div className="portal-panel__actions">
                <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
                  {state ? 'Live' : 'Unavailable'}
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => navigate('trade')}
                >
                  Trade
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            <Suspense fallback={<div className="chart-skeleton" aria-hidden="true" />}>
              <BondingCurveChart
                soldSupply={soldSupply !== null ? Number(soldSupply) / TOKEN_SCALE : null}
                maxSoldSupply={maxSoldSupply !== null ? Number(maxSoldSupply) / TOKEN_SCALE : null}
                initialPrice={initialPriceSol}
                slope={slopeSol}
                trades={trades}
                historyWindow={ohlc.records.length > 0 ? null : ACTIVITY_WINDOW}
              />
            </Suspense>

            <div className="portal-panel__strip">
              <div>
                <span className="data-label">Marginal price</span>
                <strong>{marginal !== null ? `${formatSolPrice(marginal)} SOL` : '—'}</strong>
              </div>
              <div>
                <span className="data-label">Sold supply</span>
                <strong>{soldSupply !== null ? `${formatNbr(soldSupply)} KLYTH` : '—'}</strong>
              </div>
              <div>
                <span className="data-label">Curve progress</span>
                <CurveProgress value={progress} />
              </div>
            </div>
          </section>

          <RecentActivity
            records={activity.records}
            loading={activity.loading}
            error={activity.error}
            onRefresh={activity.refresh}
            limit={6}
          />
        </div>

        <aside className="portal-rail" aria-label="Live protocol data">
          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Live market</h2>
              <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
                {state ? 'Live' : 'Unavailable'}
              </span>
            </div>
            <dl className="rail-list">
              <div className="rail-row">
                <dt>KLYTH / SOL</dt>
                <dd>{priceValue}</dd>
              </div>
              <div className="rail-row">
                <dt>Sold supply</dt>
                <dd>{soldValue} KLYTH</dd>
              </div>
              <div className="rail-row">
                <dt>SOL reserve</dt>
                <dd>{reserveValue} SOL</dd>
              </div>
              <div className="rail-row">
                <dt>Total supply</dt>
                <dd>{supplyValue} KLYTH</dd>
              </div>
              <div className="rail-row">
                <dt>Burned</dt>
                <dd>{burnedValue} KLYTH</dd>
              </div>
            </dl>
          </section>

          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Curve parameters</h2>
              <span className="badge badge--primary">On-chain</span>
            </div>
            <dl className="rail-list">
              <div className="rail-row">
                <dt>Initial price (P0)</dt>
                <dd>{initialPriceSol !== null ? `${initialPriceSol.toExponential(2)} SOL` : '—'}</dd>
              </div>
              <div className="rail-row">
                <dt>Slope (k)</dt>
                <dd>{slopeSol !== null ? `${slopeSol.toExponential(2)} SOL/KLYTH` : '—'}</dd>
              </div>
              <div className="rail-row">
                <dt>Max sellable</dt>
                <dd>
                  {maxSoldSupply !== null ? `${formatNbr(maxSoldSupply)} KLYTH` : '—'}
                </dd>
              </div>
              <div className="rail-row">
                <dt>Vault balance</dt>
                <dd>{curve.vaultAmount !== null ? `${formatNbr(curve.vaultAmount)} KLYTH` : '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Contract</h2>
              <a
                className="rail-card__link"
                href={explorerAddressUrl(PROGRAM_ADDRESS)}
                target="_blank"
                rel="noreferrer"
              >
                Explorer
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>
            <div className="info-list">
              <AddressRow label="Mint" value={MINT_ADDRESS} />
              <AddressRow label="Program" value={PROGRAM_ADDRESS} />
              <AddressRow label="Curve state" value={STATE_ADDRESS} />
            </div>
          </section>

          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Quick links</h2>
            </div>
            <ul className="rail-links">
              {quickLinks.map((link) => (
                <li key={link.id}>
                  <button type="button" onClick={() => navigate(link.id)}>
                    <span>
                      <strong>{link.label}</strong>
                      <small>{link.hint}</small>
                    </span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
