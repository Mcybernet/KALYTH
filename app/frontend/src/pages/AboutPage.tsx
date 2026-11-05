import { PageHeader } from '../components/PageHeader'

export function AboutPage() {
  return (
    <div className="page-section">
      <PageHeader
        kicker="About KLYTH"
        title="KALYTH"
        description="A Solana-based token ecosystem that uses a linear bonding curve to determine buy and sell prices automatically."
        actions={<span className="badge badge--devnet">Devnet only</span>}
      />

      <section className="card card--glow">
        <h2>Built to be inspected</h2>
        <p className="page-section__text" style={{ marginTop: 'var(--space-3)' }}>
          KALYTH keeps the full lifecycle of the token visible: the curve parameters, the
          SOL reserve, the token vault, and every confirmed trade or burn. If the program does not
          report it, the portal does not invent it.
        </p>
      </section>

      <div className="page-grid page-grid--2">
        <section className="card">
          <h3 className="card__title">Ecosystem Vision</h3>
          <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
            A transparent ecosystem for KLYTH token trading, supply management, and on-chain activity.
            All Buy and Sell transactions are processed through a Solana program.
          </p>
        </section>

        <section className="card">
          <h3 className="card__title">Bonding Curve</h3>
          <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
            Price follows P(x) = P0 + kx, with integral pricing for Buy and Sell. Marginal price and
            execution price are intentionally distinguished in the interface.
          </p>
        </section>

        <section className="card">
          <h3 className="card__title">Development Principles</h3>
          <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
            Devnet only, no real funds, no fabricated balances or history, security-first smart
            contracts, and phased implementation with tests.
          </p>
        </section>

        <section className="card">
          <h3 className="card__title">Devnet Disclaimer</h3>
          <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
            KLYTH operates on Solana Devnet. Tokens have no real-world monetary value. Do not treat
            Devnet balances as financial assets.
          </p>
        </section>
      </div>
    </div>
  )
}
