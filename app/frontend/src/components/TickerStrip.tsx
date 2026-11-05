import { useCurveState } from '../hooks/useCurveState'
import { useKlythData } from '../hooks/useKlythData'
import { formatNbr, formatSol, formatSolPrice, marginalPriceSol } from '../lib/curve'

export function TickerStrip() {
  const curve = useCurveState()
  const { mint, burnStats, loading: dataLoading, error: dataError } = useKlythData()

  const price =
    curve.state !== null ? marginalPriceSol(curve.state.soldSupply) : null
  const error = curve.error ?? dataError
  const loading = (curve.loading || dataLoading) && !error

  const items = [
    {
      label: 'KLYTH / SOL',
      value: price !== null ? formatSolPrice(price) : loading ? '…' : '—',
      accent: true,
    },
    {
      label: 'Sold supply',
      value:
        curve.state !== null ? `${formatNbr(curve.state.soldSupply)} KLYTH` : loading ? '…' : '—',
    },
    {
      label: 'SOL reserve',
      value:
        curve.reserveLamports !== null ? `${formatSol(curve.reserveLamports)} SOL` : loading ? '…' : '—',
    },
    {
      label: 'Supply',
      value: mint !== null ? `${mint.supply} KLYTH` : loading ? '…' : '—',
    },
    {
      label: 'Burned',
      value: burnStats !== null ? `${burnStats.total} KLYTH` : loading ? '…' : '—',
    },
  ]

  return (
    <div className="ticker" aria-label="Live on-chain metrics">
      <span className="ticker__label">
        <span className="ticker__pulse" aria-hidden="true" />
        LIVE
      </span>
      <div className="ticker__track">
        {items.map((item) => (
          <span className="ticker__item" key={item.label}>
            <span className="ticker__key">{item.label}</span>
            <span className={`ticker__value ${item.accent ? 'ticker__value--accent' : ''}`}>
              {item.value}
            </span>
          </span>
        ))}
      </div>
      {error ? (
        <span className="ticker__error" title={error}>
          RPC issue — retrying
        </span>
      ) : null}
    </div>
  )
}
