import { useState } from 'react'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { TransactionStatus } from '../components/TransactionStatus'
import { ArrowUpRight, Check, Copy, Orbit, TriangleAlert } from 'lucide-react'
import { KLYTH_LOGO_URL } from '../lib/assets'
import { MINT_ADDRESS } from '../lib/addresses'

const colorTokens = [
  { name: 'Background', value: '#050506', varName: '--color-bg' },
  { name: 'Background secondary', value: '#0A0A0C', varName: '--color-bg-secondary' },
  { name: 'Surface', value: '#101013', varName: '--color-surface' },
  { name: 'Surface elevated', value: '#17161A', varName: '--color-surface-elevated' },
  { name: 'Primary gold', value: '#E0A64B', varName: '--color-primary' },
  { name: 'Accent light', value: '#F4D79A', varName: '--color-accent-light' },
  { name: 'Corona ember', value: '#C96A3A', varName: '--color-ember' },
  { name: 'Moon silver', value: '#C9CED6', varName: '--color-silver' },
  { name: 'Text primary', value: '#F4EFE4', varName: '--color-text' },
  { name: 'Text secondary', value: '#9C9488', varName: '--color-text-secondary' },
  { name: 'Border', value: '#2A2620', varName: '--color-border' },
  { name: 'Success', value: '#7FD6A4', varName: '--color-success' },
  { name: 'Danger', value: '#FF7A6E', varName: '--color-danger' },
  { name: 'Warning', value: '#F2C46D', varName: '--color-warning' },
]

const gradients = [
  {
    name: 'Primary gradient',
    description: '120deg · gold → ember → ivory',
    css: 'var(--gradient-primary)',
  },
  {
    name: 'Eclipse ambient',
    description: 'radial · corona, ember, moon silver',
    css: 'var(--gradient-cosmos)',
  },
]

const typeSamples = [
  {
    label: 'Main heading',
    meta: '32–44px / Bold',
    className: 'ds-type-sample--3xl',
    text: 'Explore the KALYTH Universe.',
  },
  {
    label: 'Section heading',
    meta: '20–26px / Semibold',
    className: 'ds-type-sample--xl',
    text: 'Bonding Curve',
  },
  {
    label: 'Card heading',
    meta: '15–18px / Semibold',
    className: 'ds-type-sample--lg',
    text: 'KLYTH Price',
  },
  {
    label: 'Data value',
    meta: '22–32px / Bold / tabular',
    className: 'ds-type-sample--2xl tabular',
    text: '12,345.678901',
  },
  {
    label: 'Body',
    meta: '13–15px / Regular',
    className: 'ds-type-sample--base',
    text: 'A transparent ecosystem for KLYTH token trading, supply management and on-chain activity.',
  },
  {
    label: 'Small metadata',
    meta: '10–11px / Medium',
    className: 'ds-type-sample--xs',
    text: 'LIVE · ESTIMATE · UNAVAILABLE',
  },
]

const spacingTokens = [
  { name: '--space-1', value: '4px' },
  { name: '--space-2', value: '8px' },
  { name: '--space-3', value: '12px' },
  { name: '--space-4', value: '16px' },
  { name: '--space-5', value: '20px' },
  { name: '--space-6', value: '24px' },
  { name: '--space-8', value: '32px' },
  { name: '--space-10', value: '40px' },
  { name: '--space-12', value: '48px' },
  { name: '--space-16', value: '64px' },
  { name: '--space-20', value: '80px' },
]

const radiusTokens = [
  { name: '--radius-sm', value: '8px' },
  { name: '--radius-md', value: '12px' },
  { name: '--radius-lg', value: '18px' },
  { name: '--radius-xl', value: '22px' },
  { name: '--radius-full', value: '999px' },
]

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="address__copy"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function DesignSystemPage() {
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy')
  const [demoStatus, setDemoStatus] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const mintAddress = MINT_ADDRESS
  const shortMint = `${mintAddress.slice(0, 8)}…${mintAddress.slice(-6)}`

  return (
    <div className="ds-shell">
      <header className="ds-header">
        <div className="ds-brand">
          <img className="ds-brand__mark" src={KLYTH_LOGO_URL} alt="KALYTH logo" />
          <div>
            <span className="ds-brand__eyebrow">Design System · Phase 2</span>
            <h1 className="ds-brand__title">KALYTH</h1>
          </div>
        </div>
        <div className="ds-header__meta">
          <span className="badge badge--devnet">
            <span className="badge__dot" aria-hidden="true" />
            Devnet
          </span>
          <span className="badge badge--neutral">Preview only</span>
        </div>
      </header>

      <div className="ds-main">
        <section className="card card--glow ds-hero" aria-labelledby="ds-hero-title">
          <p className="ds-kicker">A Financial Ecosystem Beyond Boundaries</p>
          <h2 className="ds-hero__title" id="ds-hero-title">
            Design tokens and core components.
          </h2>
          <p className="ds-hero__text">
            Fondasi visual KALYTH: palet deep space, tipografi, surface, tombol, form,
            dan state data. Halaman ini adalah style guide, bukan dashboard aplikasi.
          </p>
          <div className="ds-hero__note">
            <TriangleAlert size={14} aria-hidden="true" />
            Semua nilai di halaman ini adalah contoh tampilan. Tidak ada data blockchain live.
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-colors-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-colors-title">
                Color tokens
              </h2>
              <p className="ds-section__text">
                Palet utama dari PRD-DESIGN. Tidak ada warna arbitrer di luar token ini.
              </p>
            </div>
            <span className="ds-section__index">01 / 06</span>
          </div>
          <div className="ds-swatches">
            {colorTokens.map((token) => (
              <div className="ds-swatch" key={token.varName}>
                <div className="ds-swatch__chip" style={{ backgroundColor: token.value }} />
                <div className="ds-swatch__name">{token.name}</div>
                <div className="ds-swatch__value">{token.varName}</div>
              </div>
            ))}
          </div>
          <div className="ds-grid ds-grid--2">
            {gradients.map((gradient) => (
              <div className="ds-swatch" key={gradient.name}>
                <div className="ds-swatch__chip" style={{ backgroundImage: gradient.css }} />
                <div className="ds-swatch__name">{gradient.name}</div>
                <div className="ds-swatch__value">{gradient.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-type-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-type-title">
                Typography
              </h2>
              <p className="ds-section__text">
                Space Grotesk untuk display, Inter untuk body, dan IBM Plex Mono untuk
                label serta data finansial.
              </p>
            </div>
            <span className="ds-section__index">02 / 06</span>
          </div>
          <div className="card">
            {typeSamples.map((sample) => (
              <div className="ds-type-row" key={sample.label}>
                <div className="ds-type-row__meta">
                  {sample.label}
                  <br />
                  {sample.meta}
                </div>
                <div className={sample.className}>{sample.text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-buttons-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-buttons-title">
                Buttons & badges
              </h2>
              <p className="ds-section__text">
                Semua aksi memiliki state hover, focus, disabled, dan loading.
              </p>
            </div>
            <span className="ds-section__index">03 / 06</span>
          </div>
          <div className="ds-grid ds-grid--2">
            <div className="card">
              <div className="card__header">
                <div>
                  <h3 className="card__title">Buttons</h3>
                  <p className="card__description">
                    Primary, secondary, danger, disabled, dan loading.
                  </p>
                </div>
              </div>
              <div className="ds-row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() =>
                    setDemoStatus('Contoh aksi tombol. Tidak ada transaksi blockchain yang dikirim.')
                  }
                >
                  Primary action
                </button>
                <button type="button" className="btn btn--secondary">
                  Secondary
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                <button type="button" className="btn btn--danger">
                  Danger action
                </button>
                <button type="button" className="btn btn--ghost">
                  Ghost action
                </button>
                <button type="button" className="btn btn--primary" disabled>
                  Disabled
                </button>
                <button type="button" className="btn btn--primary" aria-busy="true">
                  <span className="btn__spinner" aria-hidden="true" />
                  Preparing…
                </button>
              </div>
              <p className="ds-status" role="status" aria-live="polite">
                {demoStatus}
              </p>
            </div>

            <div className="card">
              <div className="card__header">
                <div>
                  <h3 className="card__title">Badges & status</h3>
                  <p className="card__description">
                    Status selalu disertai teks, bukan hanya warna.
                  </p>
                </div>
              </div>
              <div className="ds-row">
                <span className="badge badge--devnet">
                  <span className="badge__dot" aria-hidden="true" />
                  Devnet
                </span>
                <span className="badge badge--success">
                  <span className="badge__dot" aria-hidden="true" />
                  Confirmed
                </span>
                <span className="badge badge--warning">
                  <span className="badge__dot" aria-hidden="true" />
                  Pending
                </span>
                <span className="badge badge--danger">
                  <span className="badge__dot" aria-hidden="true" />
                  Failed
                </span>
                <span className="badge badge--primary">KLYTH</span>
                <span className="badge badge--neutral">Unavailable</span>
              </div>
              <hr className="divider" />
              <div className="ds-row">
                <span className="status-dot status-dot--success" aria-hidden="true" />
                <span className="ds-inline-note">Confirmed</span>
                <span className="status-dot status-dot--danger" aria-hidden="true" />
                <span className="ds-inline-note">Failed</span>
              </div>
            </div>
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-surfaces-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-surfaces-title">
                Surfaces & data display
              </h2>
              <p className="ds-section__text">
                Card, metric, dan address display dengan status data yang eksplisit.
              </p>
            </div>
            <span className="ds-section__index">04 / 06</span>
          </div>
          <div className="ds-grid ds-grid--3">
            <article className="card">
              <div className="card__header">
                <div>
                  <span className="data-label">KLYTH Price</span>
                  <div className="data-value">
                    —<span className="data-unit">SOL</span>
                  </div>
                </div>
                <span className="badge badge--neutral">Unavailable</span>
              </div>
              <p className="data-meta">
                MetricCard menampilkan status UNAVAILABLE sampai data on-chain terhubung.
              </p>
            </article>

            <article className="card card--elevated">
              <div className="card__header">
                <div>
                  <span className="data-label">Total Supply</span>
                  <div className="data-value">
                    —<span className="data-unit">KLYTH</span>
                  </div>
                </div>
                <span className="badge badge--neutral">Unavailable</span>
              </div>
              <p className="data-meta">
                Nilai live hanya akan berasal dari pembacaan mint supply di Devnet.
              </p>
            </article>

            <article className="card card--glow">
              <div className="card__header">
                <div>
                  <span className="data-label">SOL Reserve</span>
                  <div className="data-value">
                    —<span className="data-unit">SOL</span>
                  </div>
                </div>
                <span className="badge badge--neutral">Unavailable</span>
              </div>
              <p className="data-meta">
                Reserve balance akan dibaca dari akun program, bukan nilai statis.
              </p>
            </article>
          </div>

          <div className="ds-grid ds-grid--2">
            <div className="card">
              <span className="data-label">Data value (sample)</span>
              <div className="data-value">
                12,345.678901<span className="data-unit">KLYTH</span>
              </div>
              <p className="data-meta">Contoh format angka tabular. Bukan data on-chain.</p>
            </div>

            <div className="card">
              <span className="data-label">Address display</span>
              <div className="address">
                <span className="address__value" title={mintAddress}>
                  {shortMint}
                </span>
                <CopyButton value={mintAddress} label="KLYTH mint address" />
              </div>
              <p className="data-meta">Alamat penuh disalin, tampilan disingkat.</p>
            </div>
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-forms-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-forms-title">
                Forms & segmented control
              </h2>
              <p className="ds-section__text">
                Input, hint, error, suffix unit, dan state aktif untuk Buy/Sell.
              </p>
            </div>
            <span className="ds-section__index">05 / 06</span>
          </div>
          <div className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">Trading form primitives</h3>
                <p className="card__description">
                  Belum terhubung ke wallet atau program on-chain.
                </p>
              </div>
            </div>
            <div className="ds-grid ds-grid--2">
              <div className="field">
                <label className="field__label" htmlFor="demo-amount">
                  Amount
                </label>
                <div className="input-wrap">
                  <input
                    className="input"
                    id="demo-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <span className="input-wrap__suffix">SOL</span>
                </div>
                <span className="field__hint">Saldo: — (UNAVAILABLE)</span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="demo-error">
                  Amount (error state)
                </label>
                <input
                  className="input input--error"
                  id="demo-error"
                  defaultValue="0"
                  aria-invalid="true"
                  aria-describedby="demo-error-message"
                />
                <span className="field__error" id="demo-error-message">
                  Jumlah harus lebih besar dari nol.
                </span>
              </div>
            </div>

            <hr className="divider" />

            <div className="ds-row ds-row--between">
              <div>
                <span className="data-label">Trade mode</span>
                <p className="data-meta">Segmented control dengan state aktif.</p>
              </div>
              <div className="segmented" role="group" aria-label="Trade mode">
                <button
                  type="button"
                  className={`segmented__item ${tradeMode === 'buy' ? 'segmented__item--active' : ''}`}
                  aria-pressed={tradeMode === 'buy'}
                  onClick={() => setTradeMode('buy')}
                >
                  Buy KLYTH
                </button>
                <button
                  type="button"
                  className={`segmented__item ${tradeMode === 'sell' ? 'segmented__item--active' : ''}`}
                  aria-pressed={tradeMode === 'sell'}
                  onClick={() => setTradeMode('sell')}
                >
                  Sell KLYTH
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-states-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-states-title">
                Data table & states
              </h2>
              <p className="ds-section__text">
                Loading skeleton, empty state, dan error state tanpa data transaksi palsu.
              </p>
            </div>
            <span className="ds-section__index">06 / 06</span>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">Activity table</h3>
                <p className="card__description">Skeleton loading untuk struktur tabel.</p>
              </div>
              <span className="badge badge--warning">Preview only</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Wallet</th>
                    <th scope="col">Amount</th>
                    <th scope="col">SOL Value</th>
                    <th scope="col">Status</th>
                    <th scope="col">Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((row) => (
                    <tr key={row}>
                      {['type', 'wallet', 'amount', 'sol', 'status', 'signature'].map((cell) => (
                        <td key={cell}>
                          <span className="skeleton skeleton--text" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="data-meta">
              Skeleton loading untuk tabel. Tidak ada transaksi contoh yang ditampilkan.
            </p>
          </div>

          <div className="ds-grid ds-grid--2">
            <div className="empty-state">
              <div className="empty-state__icon">
                <Orbit size={20} aria-hidden="true" />
              </div>
              <h3 className="empty-state__title">No activity yet</h3>
              <p className="empty-state__text">
                Transaksi akan muncul setelah ada aktivitas on-chain yang terverifikasi.
              </p>
            </div>

            <div className="error-state">
              <TriangleAlert size={20} aria-hidden="true" />
              <h3 className="error-state__title">Unable to load data</h3>
              <p className="error-state__text">
                Data tidak dapat diambil dari Devnet RPC. Coba lagi nanti.
              </p>
            </div>
          </div>
        </section>

        <section className="ds-section" aria-labelledby="ds-scales-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-scales-title">
                Spacing & radius
              </h2>
              <p className="ds-section__text">
                Skala 4px base dan radius sesuai PRD-DESIGN.
              </p>
            </div>
            <span className="ds-section__index">Reference</span>
          </div>
          <div className="ds-grid ds-grid--2">
            <div className="card">
              <h3 className="card__title">Spacing scale</h3>
              <p className="card__description">Konsistensi layout dan padding.</p>
              <div className="ds-token-list">
                {spacingTokens.map((token) => (
                  <div className="ds-token" key={token.name}>
                    <span className="ds-token__name">{token.name}</span>
                    <span className="ds-token__value">{token.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="card__title">Radius scale</h3>
              <p className="card__description">8 / 12 / 18 / 22 px.</p>
              <div className="ds-token-list">
                {radiusTokens.map((token) => (
                  <div className="ds-token" key={token.name}>
                    <span className="ds-token__name">{token.name}</span>
                    <span className="ds-token__value">{token.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="ds-section" aria-labelledby="ds-interactions-title">
          <div className="ds-section__head">
            <div>
              <h2 className="ds-section__title" id="ds-interactions-title">
                Interaction states
              </h2>
              <p className="ds-section__text">
                Transaction lifecycle, confirmation modal, loading, empty, and error states.
              </p>
            </div>
            <span className="ds-section__index">07 / 07</span>
          </div>

          <div className="ds-grid ds-grid--2">
            <div className="card">
              <h3 className="card__title">Transaction status</h3>
              <p className="card__description">Explicit lifecycle states with retry and dismiss.</p>
              <div className="ds-stack" style={{ marginTop: 'var(--space-4)' }}>
                <TransactionStatus
                  status="preparing"
                  description="Building transaction payload."
                />
                <TransactionStatus
                  status="confirmed"
                  description="Transaction confirmed on Devnet."
                  signature="5K...example"
                  onDismiss={() => undefined}
                />
                <TransactionStatus
                  status="failed"
                  description="Transaction was rejected or failed."
                  onRetry={() => undefined}
                />
              </div>
            </div>

            <div className="card">
              <h3 className="card__title">Confirmation modal</h3>
              <p className="card__description">Accessible dialog with keyboard close.</p>
              <div className="ds-row" style={{ marginTop: 'var(--space-4)' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setModalOpen(true)}
                >
                  Open confirmation modal
                </button>
              </div>
              <p className="data-meta" style={{ marginTop: 'var(--space-3)' }}>
                Press Escape or click outside to close.
              </p>
            </div>
          </div>

          <ConfirmationModal
            open={modalOpen}
            title="Confirm action"
            description="This is a UI-only confirmation dialog. No blockchain transaction will be sent."
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            onConfirm={() => setModalOpen(false)}
            onCancel={() => setModalOpen(false)}
          />
        </section>

      </div>

      <footer className="ds-footer">
        <span>KALYTH · Design System v1</span>
        <span>Phase 2 · Design tokens & core components · No blockchain data displayed</span>
      </footer>
    </div>
  )
}

export default DesignSystemPage
