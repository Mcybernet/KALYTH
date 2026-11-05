import { AddressRow } from '../components/AddressRow'
import { PageHeader } from '../components/PageHeader'
import { TokenAllocationChart } from '../components/TokenAllocationChart'
import { useCurveState } from '../hooks/useCurveState'
import { useKlythData } from '../hooks/useKlythData'
import {
  BURN_RESERVE_TOKEN_ACCOUNT,
  BURN_AUTHORITY_ADDRESS,
  MINT_ADDRESS,
  PROGRAM_ADDRESS,
  SOL_RESERVE_ADDRESS,
  STATE_ADDRESS,
  TREASURY_ADDRESS,
  VAULT_ADDRESS,
} from '../lib/addresses'
import { formatNbr, formatSol } from '../lib/curve'

export function TokenomicsPage() {
  const { loading, error, mint, burnReserve, burnStats } = useKlythData()
  const curve = useCurveState()

  const supplyValue = loading ? 'Loading…' : error ? 'Error' : (mint?.supply ?? 'Unavailable')
  const burnedValue = loading ? 'Loading…' : error ? 'Error' : (burnStats?.total ?? 'Unavailable')
  const reserveValue = loading
    ? 'Loading…'
    : error
      ? 'Error'
      : (burnReserve?.balance ?? 'Unavailable')

  const soldSupply = curve.state?.soldSupply ?? null
  const maxSoldSupply = curve.state?.maxSoldSupply ?? null
  const vaultValue =
    curve.vaultAmount !== null ? `${formatNbr(curve.vaultAmount)} KLYTH` : 'Unavailable'
  const solReserveValue =
    curve.reserveLamports !== null ? `${formatSol(curve.reserveLamports, 9)} SOL` : 'Unavailable'

  return (
    <div className="page-section">
      <PageHeader
        kicker="Tokenomics"
        title="Supply, curve, and addresses"
        description="The economic configuration of KLYTH, together with every account the program uses on Solana Devnet."
        actions={<span className="badge badge--devnet">Classic SPL Token</span>}
      />

      <section className="card card--glow">
        <h2>Token Information</h2>
        <p className="page-section__text">
          Economic configuration of the KLYTH token on Solana Devnet.
        </p>
        <div className="info-list" style={{ marginTop: 'var(--space-4)' }}>
          <div className="info-row">
            <span className="info-row__label">Name</span>
            <span className="info-row__value">KALYTH</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Symbol</span>
            <span className="info-row__value">KLYTH</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Network</span>
            <span className="info-row__value">Solana Devnet</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Decimals</span>
            <span className="info-row__value">
              {mint ? mint.decimals : loading ? 'Loading…' : 'Unavailable'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Token standard</span>
            <span className="info-row__value">Classic SPL Token</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Total supply (live)</span>
            <span className="info-row__value">{supplyValue}</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Total burned (live)</span>
            <span className="info-row__value">{burnedValue}</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Sold supply (live)</span>
            <span className="info-row__value">
              {soldSupply !== null
                ? `${formatNbr(soldSupply)}${maxSoldSupply !== null ? ` / ${formatNbr(maxSoldSupply)}` : ''} KLYTH`
                : 'Unavailable'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Bonding curve vault (live)</span>
            <span className="info-row__value">{vaultValue}</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">SOL reserve (live)</span>
            <span className="info-row__value">{solReserveValue}</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Burn reserve balance (live)</span>
            <span className="info-row__value">{reserveValue}</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Burn schedule</span>
            <span className="info-row__value">800,000 KLYTH/day · 50 days</span>
          </div>
          <div className="info-row">
            <span className="info-row__label">Supply after full burn</span>
            <span className="info-row__value">60,000,000 KLYTH</span>
          </div>
        </div>
      </section>

      <div className="page-grid page-grid--2">
        <section className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Addresses</h3>
              <p className="card__description">
                Live addresses with copy and Solana Explorer links.
              </p>
            </div>
            <span className="badge badge--neutral">Configured</span>
          </div>
          <div className="info-list">
            <AddressRow label="Mint" value={MINT_ADDRESS} />
            <AddressRow label="Treasury" value={TREASURY_ADDRESS} />
            <AddressRow label="Program ID" value={PROGRAM_ADDRESS} />
            <AddressRow label="Bonding curve state" value={STATE_ADDRESS} />
            <AddressRow label="Token vault" value={VAULT_ADDRESS} />
            <AddressRow label="SOL reserve" value={SOL_RESERVE_ADDRESS} />
            <AddressRow label="Burn authority (PDA)" value={BURN_AUTHORITY_ADDRESS} />
            <AddressRow label="Burn reserve token account" value={BURN_RESERVE_TOKEN_ACCOUNT} />
          </div>
        </section>

        <section className="card">
          <div className="card__header">
            <div>
              <h3 className="card__title">Allocation</h3>
              <p className="card__description">
                50% curve, 40% burn reserve, 5% treasury, 5% community.
              </p>
            </div>
            <span className="badge badge--warning">50 / 40 / 5 / 5</span>
          </div>
          <TokenAllocationChart />
        </section>
      </div>
    </div>
  )
}
