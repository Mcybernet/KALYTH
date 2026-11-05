# KALYTH (KLYTH)

A bonding-curve token ecosystem on **Solana Devnet**: an Anchor program that prices KLYTH buys and sells with a linear curve, an automatic daily burn, and a React portal that reads every figure directly from the cluster.

> **Devnet only.** KLYTH has no real-world monetary value, is not listed anywhere, and must not be treated as an investment. Nothing in this repository is financial advice. Mainnet deployment is explicitly out of scope.

---

## Status

| Area | State |
| --- | --- |
| Anchor program | Deployed to Devnet at `CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw` |
| Curve state | Initialized (`185` bytes, fresh curve with `sold_supply = 0 KLYTH`) |
| Token vault / SOL reserve | Created and funded (50M KLYTH vault, 2 SOL reserve) |
| Frontend | Complete: overview, trade, tokenomics, burn tracker, activity, about, docs, admin |
| Tests | Rust unit tests for curve math; no TypeScript integration suite yet |
| Burn keeper | On-chain `burn_daily` + external crank (GitHub Actions workflow or Task Scheduler) |

Live values shown in the portal are read from Devnet at runtime. Nothing is mocked or seeded: when the cluster is slow or rate-limited, the UI shows a loading or error state instead of placeholder data.

---

## Live Devnet addresses

| Account | Address |
| --- | --- |
| Program | `CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw` |
| KLYTH mint | `GuaBwGkmwKJqU5AkxCoFQdGqY1UsDGtswJ9KGphvhkeK` |
| Curve state PDA | `DGEu6BDgzQrb2h1rLNiPaAS4wZRxnwg7DVn9Yg2K3QPv` |
| Token vault (ATA) | `86ay5krMiVDKc1HQfpCJ65hwcJKkZLZzHaXuRTmApRBo` |
| SOL reserve PDA | `83r1wg2j89ME5mjFJYrXQg9DiVHh3K6GPjD2CG6tWp3J` |
| Burn state PDA | `Erm5f4LCVMmejQrAUVfhTfHKzzs6Au66qtdRoTbd5hQ6` |
| Burn authority PDA | `FuRgsStULTV2enAXEkAv9NYypxbv6Vcp6vXo2nWh7rN9` |
| Burn reserve token account | `V6yBiGHso17rfhD8qVCiJqHdSVAfPL5QWfp3EKevJzG` |
| Treasury ATA | `5TXgUjRmKyDV7kFK4Uni3uieLyMGQG3xd5riNmBZAuMW` |
| Community account | `AhMsWehAnHQKNGYmdHXDEbuPfoMqoLC81X3VfZbzpJCg` |
| Treasury / upgrade authority | `2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN` |

The canonical values are defined in [`app/frontend/src/lib/addresses.ts`](app/frontend/src/lib/addresses.ts) and [`app/frontend/src/lib/curve.ts`](app/frontend/src/lib/curve.ts). Explorer links in the app append `?cluster=devnet`.

---

## What is implemented

### On-chain program (`programs/nebula_curve`)

| Instruction | Purpose |
| --- | --- |
| `initialize` | Creates the `BondingCurveState` PDA and stores curve parameters |
| `buy` | Charges the integral cost in lamports and transfers KLYTH from the vault to the buyer |
| `sell` | Accepts KLYTH back into the vault and pays the integral return from the SOL reserve |
| `deposit_sol` | Authority-only funding of the SOL reserve |
| `deposit_tokens` | Authority-only funding of the token vault |
| `initialize_burn` | Creates the `BurnState` PDA and records the daily cap |
| `burn_daily` | Permissionless daily burn of `min(daily_cap, reserve)` from the burn reserve |

There is **no** withdraw instruction, no authority-transfer instruction, and no pause switch. The program cannot mint KLYTH; supply changes only through the SPL Token mint and the automatic burn.

### Frontend (`app/frontend`)

- Vite 7 + React 19 + strict TypeScript, minimalist eclipse palette with sharp corners, fully responsive down to 360 px.
- Phantom wallet adapter; the browser signs every transaction and the app never sees a private key.
- Shared providers poll the curve state every 20 seconds and mint/burn data on its own cadence.
- Manual instruction encoding with Anchor discriminators (no IDL dependency at runtime).
- ApexCharts curve view with a Curve/Candles switch. Curve mode plots `P(x)` with confirmed executions as dots and the live position; Candles mode groups consecutive confirmed buy/sell executions into thin OHLC candles. No synthetic trades or candles are drawn.
- Activity history decoded from real program transactions and SPL Token burn instructions.
- Admin page for the one-time bootstrap steps (initialize, create vault, fund reserve, deposit KLYTH).

---

## Repository layout

```
programs/nebula_curve/          Anchor program (Rust)
  src/lib.rs                    instruction entrypoints
  src/lib_combined.rs           single-file source used for the Playground deployment
  src/state.rs                  BondingCurveState
  src/math/curve.rs             fixed-point math + unit tests
  src/instructions/             initialize, buy, sell, deposit
app/frontend/                   Vite + React + TypeScript client
  src/lib/curve.ts              PDAs, quotes, instruction builders, state decoding
  src/lib/rpc.ts                throttled JSON-RPC client with retry
  src/lib/history.ts            activity/burn parsing and caches
  src/lib/addresses.ts          canonical Devnet addresses + explorer helpers
  src/hooks/                    CurveStateProvider, KlythDataProvider, wallet balances
  src/pages/                    Overview, Trade, Tokenomics, Burn Tracker, Activity, About, Docs, Admin
docs/                           Architecture, security, deployment
Anchor.toml                     Anchor 0.30.1 workspace config
PRD.md / PRD-DESIGN.md          Product and design requirements
```

---

## Quick start

Prerequisites: Node.js 20.19+ or 22.12+ (developed on Node 22) and npm.

```bash
cd app/frontend
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production bundle in dist/
npm run preview      # serve the production build
```

The app talks to `https://api.devnet.solana.com` directly. No backend, no environment file, no API key.

### Deploying the frontend

The frontend is published with **GitHub Pages** through
`.github/workflows/deploy-pages.yml`. Pushes to `main` that touch
`app/frontend` rebuild and deploy automatically.

One-time setup: **Settings → Pages → Source: GitHub Actions**. The workflow
derives the subpath from `actions/configure-pages` and passes it to Vite as
`VITE_BASE`, so no repository name is hard-coded.

---

## Curve parameters

| Parameter | Value |
| --- | --- |
| Curve type | Linear: `P(x) = P0 + k·x` |
| Initial price `P0` | `0.000001 SOL / KLYTH` |
| Slope `k` | `0.00000000000008 SOL / KLYTH²` |
| Maximum sold supply | `50,000,000 KLYTH` |
| KLYTH decimals | `6` |
| SOL unit | lamports (`9` decimals) |
| Fixed-point scale | `1e18` |

On-chain constants: `PRICE_SCALE = 1e18`, `INITIAL_PRICE_SCALED = 1e15`, `SLOPE_SCALED = 80`.

Buy and sell use the integral of the curve, not `price × amount`:

```
buy cost    = P0·q + (k/2)·((x + q)² − x²)
sell return = P0·q + (k/2)·(x² − (x − q)²)
```

All division truncates toward zero, and every arithmetic step is checked for overflow/underflow.

---

## Token facts

| Field | Value |
| --- | --- |
| Standard | Classic SPL Token |
| Decimals | 6 |
| Current supply | 100,000,000 KLYTH (mint authority revoked, hard-capped) |
| Mint authority | `null` (revoked after setup) |
| Freeze authority | `null` (disabled) |
| Curve allocation | 50,000,000 KLYTH |
| Burn reserve allocation | 40,000,000 KLYTH |
| Treasury allocation | 5,000,000 KLYTH |
| Community allocation | 5,000,000 KLYTH |
| Daily burn cap | 800,000 KLYTH |
| Burn horizon | 50 days → final supply 60,000,000 KLYTH |

Supply is fixed at 100,000,000 KLYTH because the mint authority was revoked. Burns reduce supply and are verifiable through SPL Token `burn` transactions.

---

## Program build and deploy

The live Devnet program was built and deployed with **Solana Playground** using `programs/nebula_curve/src/lib_combined.rs`. The Anchor workspace is the reviewable source of truth; keep the two in sync if the program changes.

With the Anchor CLI installed (0.30.1):

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Initialization, vault creation, reserve funding, and the first token deposit are covered step by step in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The same steps are available in the app's **Admin (dev)** page, which sends real Devnet transactions and disables each action once its target account exists.

---

## Testing

```bash
# Frontend
cd app/frontend
npm run typecheck
npm run build

# Rust curve math (requires a Solana-compatible Rust toolchain with a working linker)
cd programs/nebula_curve
cargo test --lib
```

The curve module covers initial price, buy cost positivity, sell bounds, and buy→sell round-trip consistency. There is currently no TypeScript integration test harness; the PRD's end-to-end checks are performed manually against Devnet.

---

## Honesty rules

These constraints are part of the product, not just the implementation:

- Every balance, supply figure, reserve amount, and activity row comes from Solana Devnet.
- Failed transactions are shown as failed and are never counted as successful activity or burn volume.
- Candles are built only from confirmed buy/sell executions; no synthetic bars are invented for periods without trades.
- No private keys, seed phrases, or signing secrets exist in the frontend or the repository.
- No fake historical rows, simulated success states, or placeholder numbers.

---

## Limitations

- Devnet only; no mainnet support and no real funds.
- The public Devnet RPC rate-limits aggressively. Activity history can take 15–30 seconds to load, and requests are queued with retry/backoff.
- Burn automation depends on an external crank (GitHub Actions or Task Scheduler). The on-chain program enforces the 23h50m window and the daily cap, but someone must send the transaction.
- No authority transfer or reserve withdrawal instruction; the upgrade authority remains the treasury wallet.
- `token_vault` and `sol_reserve` fields in the state account are reserved and never written after initialization; runtime validation uses PDA seeds and account ownership instead.
- No IDL is shipped to the client; discriminators and account orders are maintained by hand.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — program accounts, instructions, math, and client data flow
- [`docs/SECURITY.md`](docs/SECURITY.md) — trust model, on-chain controls, threat table, residual risks
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Playground and Anchor CLI deployment, initialization, frontend hosting, troubleshooting

Product requirements live in [`PRD.md`](PRD.md); the visual direction lives in [`PRD-DESIGN.md`](PRD-DESIGN.md).
