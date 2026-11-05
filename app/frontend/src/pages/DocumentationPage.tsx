import { AddressRow } from '../components/AddressRow'
import { PageHeader } from '../components/PageHeader'
import {
  BURN_RESERVE_TOKEN_ACCOUNT,
  BURN_AUTHORITY_ADDRESS,
  MINT_ADDRESS,
  PROGRAM_ADDRESS,
  SOL_RESERVE_ADDRESS,
  STATE_ADDRESS,
  TREASURY_ADDRESS,
  VAULT_ADDRESS,
  explorerAddressUrl,
} from '../lib/addresses'

const toc = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'curve', label: 'Curve math' },
  { id: 'state', label: 'State layout' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'verify', label: 'Verification' },
  { id: 'limits', label: 'Limitations' },
]

const curveConstants = [
  { label: 'Initial price (P0)', value: '0.000001 SOL / KLYTH' },
  { label: 'Slope (k)', value: '0.00000000000008 SOL / KLYTH²' },
  { label: 'Maximum sold supply', value: '50,000,000 KLYTH' },
  { label: 'KLYTH decimals', value: '6' },
  { label: 'SOL unit', value: 'lamports (9 decimals)' },
  { label: 'Price scale', value: '1e18 fixed point' },
]

const stateLayout = [
  { offset: '0 – 7', field: 'Anchor discriminator', type: '8 bytes' },
  { offset: '8 – 39', field: 'authority', type: 'Pubkey' },
  { offset: '40 – 71', field: 'mint', type: 'Pubkey' },
  { offset: '72 – 103', field: 'token_vault', type: 'Pubkey (reserved)' },
  { offset: '104 – 135', field: 'sol_reserve', type: 'Pubkey (reserved)' },
  { offset: '136 – 151', field: 'initial_price', type: 'u128 LE' },
  { offset: '152 – 167', field: 'slope', type: 'u128 LE' },
  { offset: '168 – 175', field: 'sold_supply', type: 'u64 LE' },
  { offset: '176 – 183', field: 'max_sold_supply', type: 'u64 LE' },
  { offset: '184', field: 'bump', type: 'u8' },
]

const instructions = [
  {
    name: 'initialize',
    signature: 'initialize(initial_price: u128, slope: u128, max_sold_supply: u64)',
    summary:
      'Creates the bonding curve state PDA. It does not create the token vault or the SOL reserve; those are derived by seeds at use time.',
    accounts: [
      'authority — signer, writable, pays for the state account',
      'state — writable, PDA seeds ["bonding_curve", mint]',
      'mint — the KLYTH mint',
      'system_program',
    ],
  },
  {
    name: 'buy',
    signature: 'buy(nbr_amount: u64, max_sol_cost: u64)',
    summary:
      'Charges the integral cost in lamports, moves KLYTH from the vault to the buyer, and increases sold supply. Fails if the cost exceeds max_sol_cost, the vault is short, or the sale would pass the maximum supply.',
    accounts: [
      'buyer — signer, writable',
      'state — writable, PDA seeds ["bonding_curve", mint]',
      'mint',
      'token_vault — writable, must be owned by the state PDA',
      'buyer_token_account — writable, must be owned by the buyer',
      'sol_reserve — writable, PDA seeds ["sol_reserve", mint]',
      'token_program',
      'system_program',
    ],
  },
  {
    name: 'sell',
    signature: 'sell(nbr_amount: u64, min_sol_received: u64)',
    summary:
      'Moves KLYTH from the seller back into the vault, pays the integral return from the SOL reserve, and decreases sold supply. Fails if the return is below min_sol_received or the reserve cannot stay rent-exempt.',
    accounts: [
      'seller — signer, writable',
      'state — writable, PDA seeds ["bonding_curve", mint]',
      'mint',
      'token_vault — writable, must be owned by the state PDA',
      'seller_token_account — writable, must be owned by the seller',
      'sol_reserve — writable, PDA seeds ["sol_reserve", mint]',
      'token_program',
      'system_program',
    ],
  },
  {
    name: 'deposit_sol',
    signature: 'deposit_sol(amount: u64)',
    summary:
      'Operator-only funding of the SOL reserve. The signer must match the authority stored in the curve state.',
    accounts: [
      'authority — signer, writable, must equal state.authority',
      'state — writable, PDA seeds ["bonding_curve", mint]',
      'mint',
      'sol_reserve — writable, PDA seeds ["sol_reserve", mint]',
      'system_program',
    ],
  },
  {
    name: 'deposit_tokens',
    signature: 'deposit_tokens(amount: u64)',
    summary:
      'Operator-only funding of the token vault. KLYTH moves from the authority token account into the vault that the curve state controls.',
    accounts: [
      'authority — signer, writable, must equal state.authority',
      'state — writable, PDA seeds ["bonding_curve", mint]',
      'mint',
      'authority_token_account — writable, must be owned by the authority',
      'token_vault — writable, must be owned by the state PDA',
      'token_program',
    ],
  },
]

export function DocumentationPage() {
  return (
    <div className="page-section">
      <PageHeader
        kicker="Documentation"
        title="Program and interface reference"
        description="How the KALYTH bonding curve is deployed, how the client builds transactions, and how every number in the portal is derived from Solana Devnet."
        actions={<span className="badge badge--devnet">Devnet only</span>}
      >
        {toc.map((item) => (
          <a className="page-head__tab" href={`#${item.id}`} key={item.id}>
            {item.label}
          </a>
        ))}
      </PageHeader>

      <div className="portal-grid">
        <div className="portal-main">
          <section className="card docs-section" id="overview">
            <h2 className="docs-title">Overview</h2>
            <p className="docs-text">
              KALYTH (KLYTH) is a classic SPL Token on Solana Devnet. Buys and sells are
              priced by a linear bonding curve program. The curve never mints: supply is
              fixed at 100,000,000 KLYTH, and a separate permissionless{' '}
              <code>burn_daily</code> instruction burns up to 800,000 KLYTH from the burn
              reserve once per 23h50m window. The frontend reads all balances, supply
              figures, and history directly from the cluster.
            </p>

            <div className="docs-facts">
              <div>
                <span className="data-label">Network</span>
                <strong>Solana Devnet</strong>
              </div>
              <div>
                <span className="data-label">Program</span>
                <strong>CzAyXzhj…GxBSw</strong>
              </div>
              <div>
                <span className="data-label">Anchor version</span>
                <strong>0.30.1</strong>
              </div>
              <div>
                <span className="data-label">Token standard</span>
                <strong>Classic SPL Token</strong>
              </div>
            </div>

            <h3 className="docs-subtitle">Repository layout</h3>
            <pre className="docs-code">{`programs/nebula_curve/        Anchor program (Rust)
  src/lib.rs                  instruction entrypoints
  src/state.rs                BondingCurveState account
  src/math/curve.rs           fixed-point curve math + unit tests
  src/instructions/           initialize, buy, sell, deposit, burn
app/frontend/                 Vite + React + TypeScript client
  src/lib/curve.ts            PDAs, quotes, instruction builders
  src/lib/rpc.ts              throttled JSON-RPC client
  src/lib/history.ts          activity and burn parsing
  src/hooks/                  shared on-chain data providers
docs/                         architecture, security, deployment`}</pre>

            <p className="docs-note">
              The current Devnet program was built with Solana Playground using the combined
              single-file source in <code>programs/nebula_curve/src/lib_combined.rs</code>. The
              Anchor workspace is the source of truth for review; keep both in sync if the program
              changes.
            </p>
          </section>

          <section className="card docs-section" id="accounts">
            <h2 className="docs-title">Accounts</h2>
            <p className="docs-text">
              The state and SOL reserve are program-derived addresses. The token vault is an
              associated token account whose authority is the state PDA, so only the program can
              move KLYTH out of it during a buy.
            </p>

            <div className="docs-account-grid">
              <div className="docs-account-block">
                <h3 className="docs-subtitle">Curve accounts</h3>
                <div className="info-list">
                  <AddressRow label="KLYTH mint" value={MINT_ADDRESS} />
                  <AddressRow label="Curve state PDA" value={STATE_ADDRESS} />
                  <AddressRow label="Token vault" value={VAULT_ADDRESS} />
                  <AddressRow label="SOL reserve PDA" value={SOL_RESERVE_ADDRESS} />
                </div>
              </div>

              <div className="docs-account-block">
                <h3 className="docs-subtitle">Authority and burn</h3>
                <div className="info-list">
                  <AddressRow label="Treasury / upgrade authority" value={TREASURY_ADDRESS} />
                  <AddressRow label="Burn authority (PDA)" value={BURN_AUTHORITY_ADDRESS} />
                  <AddressRow label="Burn reserve token account" value={BURN_RESERVE_TOKEN_ACCOUNT} />
                </div>
              </div>
            </div>

            <h3 className="docs-subtitle">Derivation</h3>
            <pre className="docs-code">{`state   = PDA(["bonding_curve", mint], program)
reserve = PDA(["sol_reserve",   mint], program)
vault   = ATA(mint, state, allowOwnerOffCurve = true)`}</pre>
            <p className="docs-text">
              The mint authority is the treasury wallet. The freeze authority is disabled. The
              program has no instruction to change the authority or withdraw from the SOL reserve.
            </p>
          </section>

          <section className="card docs-section" id="instructions">
            <h2 className="docs-title">Instructions</h2>
            <p className="docs-text">
              The client builds instructions manually with the Anchor discriminators and{' '}
              <code>@solana/web3.js</code>. There is no IDL dependency at runtime. Account order
              below matches the on-chain structs.
            </p>

            {instructions.map((instruction) => (
              <article className="docs-instruction" key={instruction.name}>
                <h3 className="docs-subtitle">{instruction.name}</h3>
                <pre className="docs-code">{instruction.signature}</pre>
                <p className="docs-text">{instruction.summary}</p>
                <ul className="docs-list">
                  {instruction.accounts.map((account) => (
                    <li key={account}>{account}</li>
                  ))}
                </ul>
              </article>
            ))}

            <p className="docs-note">
              All amounts are raw base units: KLYTH uses 6 decimals and SOL uses lamports. Buy and
              sell are atomic Solana transactions, so a failed transfer rolls back every balance
              change in the same transaction.
            </p>
          </section>

          <section className="card docs-section" id="curve">
            <h2 className="docs-title">Curve math</h2>
            <p className="docs-text">
              Price is linear in the net sold supply. Trades use the integral of the curve, not the
              marginal price multiplied by the amount.
            </p>
            <pre className="docs-code">{`P(x) = P0 + k·x

buy cost   = P0·q + (k/2)·((x + q)² − x²)
sell return = P0·q + (k/2)·(x² − (x − q)²)

marginal price (SOL per whole KLYTH) = (P0_scaled + k_scaled·sold_raw) / 1e21`}</pre>

            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">Deployed curve parameters</caption>
                <thead>
                  <tr>
                    <th scope="col">Parameter</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {curveConstants.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="docs-mono">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="docs-text">
              On-chain constants are <code>PRICE_SCALE = 1e18</code>,{' '}
              <code>INITIAL_PRICE_SCALED = 1e15</code>, and <code>SLOPE_SCALED = 80</code>. Every
              division truncates toward zero. The frontend quote functions mirror this integer
              math exactly so the preview matches the program.
            </p>
            <p className="docs-note">
              The portal mirrors the deployed constants in <code>src/lib/curve.ts</code>. If the
              curve is ever re-initialized with different parameters, update those constants and
              re-run the quote tests.
            </p>
          </section>

          <section className="card docs-section" id="state">
            <h2 className="docs-title">State layout</h2>
            <p className="docs-text">
              <code>BondingCurveState</code> is 185 bytes including the Anchor discriminator. The
              client decodes these offsets directly.
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">BondingCurveState byte layout</caption>
                <thead>
                  <tr>
                    <th scope="col">Offset</th>
                    <th scope="col">Field</th>
                    <th scope="col">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {stateLayout.map((row) => (
                    <tr key={row.field}>
                      <td className="docs-mono">{row.offset}</td>
                      <td className="docs-mono">{row.field}</td>
                      <td>{row.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="docs-note">
              <code>token_vault</code> and <code>sol_reserve</code> are written as{' '}
              <code>Pubkey::default()</code> during initialization and are not updated later.
              Runtime instructions validate the vault and reserve by PDA seeds and ownership
              instead. Treat the two fields as reserved space.
            </p>
          </section>

          <section className="card docs-section" id="frontend">
            <h2 className="docs-title">Frontend data flow</h2>
            <p className="docs-text">
              The client uses React 19, Vite 7, strict TypeScript, and the Solana wallet adapter.
              Phantom signs every transaction in the browser; the app never sees a private key.
            </p>

            <h3 className="docs-subtitle">Shared providers</h3>
            <ul className="docs-list">
              <li>
                <code>KlythDataProvider</code> loads mint supply, the burn reserve balance, and
                aggregated burn statistics once per app shell.
              </li>
              <li>
                <code>CurveStateProvider</code> reads the state account, vault amount, and reserve
                lamports every 20 seconds.
              </li>
              <li>
                <code>useActivity</code> paginates Buy/Sell/Burn records with a 20-second cache.
              </li>
            </ul>

            <h3 className="docs-subtitle">RPC client</h3>
            <p className="docs-text">
              The public Devnet endpoint rate-limits aggressively, so <code>src/lib/rpc.ts</code>{' '}
              sends every request through one global lane with a 250 ms gap. Retryable responses
              (429, 500, 502, 503, 504) get up to eight attempts with exponential backoff from
              800 ms to 8 s. Requests are cancellable through <code>AbortSignal</code>.
            </p>

            <h3 className="docs-subtitle">Activity parsing</h3>
            <ul className="docs-list">
              <li>
                Buy and Sell records come from program signatures decoded by the Anchor
                discriminators.
              </li>
              <li>
                Burn records come from SPL Token <code>burn</code> instructions whose account is
                the burn reserve token account and whose mint matches KLYTH.
              </li>
              <li>
                SOL value is derived from the reserve account&apos;s lamport delta in the
                transaction metadata.
              </li>
              <li>
                Failed transactions are labelled <code>Failed</code> and are not counted as
                successful activity.
              </li>
            </ul>

            <h3 className="docs-subtitle">Chart honesty</h3>
            <p className="docs-text">
              Curve mode plots the actual linear price function and marks confirmed buy/sell
              executions as dots. Candle mode groups consecutive confirmed executions into candles:
              open and close are the first and last execution prices, high and low are the real
              extremes, and no synthetic candles are invented. All trade markers are rebuilt from
              confirmed activity records, never fabricated.
            </p>
          </section>

          <section className="card docs-section" id="verify">
            <h2 className="docs-title">Verification</h2>
            <p className="docs-text">
              Every account in the portal links to Solana Explorer with the Devnet cluster query.
              You can verify the program, mint, curve state, vault, SOL reserve, and burn reserve
              independently of this site.
            </p>
            <ul className="docs-list docs-list--links">
              <li>
                <a href={explorerAddressUrl(PROGRAM_ADDRESS)} target="_blank" rel="noreferrer">
                  Program account
                </a>
              </li>
              <li>
                <a href={explorerAddressUrl(MINT_ADDRESS)} target="_blank" rel="noreferrer">
                  KLYTH mint
                </a>
              </li>
              <li>
                <a href={explorerAddressUrl(STATE_ADDRESS)} target="_blank" rel="noreferrer">
                  Bonding curve state
                </a>
              </li>
              <li>
                <a href={explorerAddressUrl(VAULT_ADDRESS)} target="_blank" rel="noreferrer">
                  Token vault
                </a>
              </li>
              <li>
                <a href={explorerAddressUrl(SOL_RESERVE_ADDRESS)} target="_blank" rel="noreferrer">
                  SOL reserve
                </a>
              </li>
              <li>
                <a href={explorerAddressUrl(BURN_RESERVE_TOKEN_ACCOUNT)} target="_blank" rel="noreferrer">
                  Burn reserve token account
                </a>
              </li>
            </ul>

            <h3 className="docs-subtitle">Local checks</h3>
            <pre className="docs-code">{`cd app/frontend
npm run typecheck
npm run build

# Rust unit tests (needs a Solana-compatible Rust toolchain)
cd programs/nebula_curve
cargo test --lib`}</pre>
            <p className="docs-note">
              The program was deployed from Solana Playground, so an Anchor CLI installation is not
              required to verify the live Devnet deployment. See{' '}
              <code>docs/DEPLOYMENT.md</code> for the full procedure.
            </p>
          </section>

          <section className="card docs-section" id="limits">
            <h2 className="docs-title">Limitations</h2>
            <ul className="docs-list">
              <li>
                Devnet only. KLYTH has no real-world monetary value and must not be treated as a
                financial asset.
              </li>
              <li>
                The public RPC endpoint throttles history scans, so the activity list can take
                15–30 seconds to appear.
              </li>
              <li>
                Burns are permissionless and automatic. A scheduler (GitHub Actions or
                Windows Task Scheduler) calls <code>burn_daily</code>; the program itself
                enforces the 23h50m window and the 800,000 KLYTH daily cap. No dev wallet
                signature is needed to execute a burn.
              </li>
              <li>
                The program has no authority-transfer or reserve-withdrawal instruction. The
                upgrade authority remains the treasury wallet.
              </li>
              <li>
                Candle mode plots confirmed buy/sell trades from Devnet; it is not a
                market data feed.
              </li>
            </ul>
          </section>
        </div>

        <aside className="portal-rail" aria-label="Documentation navigation">
          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">On this page</h2>
            </div>
            <ul className="rail-links">
              {toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`}>{item.label}</a>
                </li>
              ))}
            </ul>
          </section>

          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Network</h2>
              <span className="badge badge--devnet">Devnet</span>
            </div>
            <dl className="rail-list">
              <div className="rail-row">
                <dt>Cluster</dt>
                <dd>api.devnet.solana.com</dd>
              </div>
              <div className="rail-row">
                <dt>Program</dt>
                <dd>CzAyXzhj…GxBSw</dd>
              </div>
              <div className="rail-row">
                <dt>Mint</dt>
                <dd>GuaBwGkm…hkeK</dd>
              </div>
            </dl>
          </section>

          <section className="card rail-card">
            <div className="rail-card__head">
              <h2 className="rail-card__title">Repository docs</h2>
            </div>
            <ul className="docs-links">
              <li>
                <code>README.md</code>
                <span>Quick start and status</span>
              </li>
              <li>
                <code>docs/ARCHITECTURE.md</code>
                <span>Program and client design</span>
              </li>
              <li>
                <code>docs/SECURITY.md</code>
                <span>Trust model and limits</span>
              </li>
              <li>
                <code>docs/DEPLOYMENT.md</code>
                <span>Build, deploy, initialize</span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
