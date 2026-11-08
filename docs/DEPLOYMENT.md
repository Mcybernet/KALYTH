# Deployment

This guide covers building and deploying KALYTH to **Solana Devnet**, initializing the curve accounts, funding the vault and reserve, configuring the automatic burn, hosting the frontend, and verifying the result.

> Do not deploy to mainnet. The current program, authorities, and parameters are Devnet-only and have not been audited.

---

## 1. What is already deployed

| Item | Address |
| --- | --- |
| Program | `CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw` |
| KLYTH mint | `4MUt8MMxTDYvd35zTnysuJXt29xg5MH7Kb65sB73sN2W` |
| Metaplex metadata | `HFMgvqqxdzPXjR6xGN8jiJD14sXT28kYFFTTWgr5herR` |
| Curve state PDA | `98NZ4NrFdsk6uT6zbHuDBSf7YC6TirrpomTRW9gtP2U7` |
| Token vault | `FVJq2L9UbdHbTHd3g8qW9RACNQjGnFgaag8gqNzrq6z5` |
| SOL reserve PDA | `CKtoBdAuXB7AJR5kUjmjkHLeStQjUnYe2crtS5kp8gF1` |
| Treasury / authority | `2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN` |
| Burn state PDA | `6dyDq8dUQq8VhE5vqXWSN1KzumsQWgeQkcDwhQptt2jj` |
| Burn authority PDA | `75qqs7K5JXpccypy37aj3uwoZFYWKZ7wMao6y4xw3ybC` |
| Burn reserve | `6qV86Gd5SQ1YGn3TJCgXwZhmSz8m6PxDJSbL7at1Ra9v` |

The current deployment was built with **Solana Playground** from `programs/nebula_curve/src/lib_combined.rs`. The Anchor workspace is the reviewable source of truth. You only need to redeploy if you are changing the program; the frontend can be hosted independently.

### On-chain metadata

The mint carries Metaplex Token Metadata created **before** the mint authority
was revoked. Wallets and Explorers read it from the metadata PDA.

| Field | Value |
| --- | --- |
| Metadata program | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| Metadata PDA | `HFMgvqqxdzPXjR6xGN8jiJD14sXT28kYFFTTWgr5herR` |
| Name / symbol | `KALYTH` / `KLYTH` |
| URI | `https://mcybernet.github.io/KALYTH/metadata.json` |

The URI is served by the frontend deployment from
`app/frontend/public/metadata.json`, which points at the logo under
`public/brand/`. Because the mint authority is revoked, the metadata can never
be created again for this mint; only the update authority (the treasury) can
change mutable fields.

A rebuild with metadata is possible with `scripts/rebuild-devnet.mjs`. The
script creates the metadata account before the revoke step and refuses to
continue if metadata is missing after the authority is already gone.

---

## 2. Prerequisites

### For the frontend

- Node.js 20.19+ or 22.12+ (developed on Node 22) and npm
- A static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3/CloudFront, …)

### For a local program build

- Rust stable with the Solana toolchain expectations for Anchor 0.30.1
- Solana CLI (1.18.x line works with Anchor 0.30.1)
- Anchor CLI 0.30.1 (`avm install 0.30.1 && avm use 0.30.1`)
- A Devnet wallet with SOL for rent and fees

Check versions:

```bash
rustc --version
solana --version
anchor --version
node --version
```

### Devnet wallet

```bash
solana config set --url devnet
solana-keygen new --outfile ~/.config/solana/id.json   # if you do not have one
solana address
solana airdrop 2
solana balance
```

Use a dedicated Devnet wallet. Never reuse a wallet that holds mainnet assets, and never commit the keypair file.

---

## 3. Path A — Solana Playground (used for the current deployment)

This path needs only a browser and a Playground wallet.

1. Open [Solana Playground](https://beta.solpg.io/) and create or import an **Anchor** project.
2. Set the cluster to **Devnet** and fund the Playground wallet from the built-in airdrop.
3. Replace the program source with the contents of `programs/nebula_curve/src/lib_combined.rs`, and use the dependency versions from `programs/nebula_curve/Cargo.toml` (`anchor-lang = "0.30.1"`, `anchor-spl = { version = "0.30.1", features = ["token"] }`).
4. Build, then deploy. Record the program ID and the deployment signature.
5. Initialize the state and create the accounts using the Playground client or the frontend Admin page (section 5).

Notes:

- Playground generates a program keypair for new projects. Reproducing the existing program ID requires that keypair, which is not in this repository. Treat the live ID as fixed; a fresh deployment will have a different ID.
- If the program ID changes, update all of the following before building the frontend:
  - `declare_id!` in `lib.rs` and `lib_combined.rs`
  - `[programs.devnet]` in `Anchor.toml`
  - `PROGRAM_ID` in `app/frontend/src/lib/curve.ts`
- Keep `lib_combined.rs` in sync with the modular source. The deployed bytecode must match what reviewers read.

---

## 4. Path B — Anchor CLI

From the repository root:

```bash
anchor keys list
anchor build
anchor deploy --provider.cluster devnet
```

`Anchor.toml` is configured for:

```toml
[toolchain]
anchor_version = "0.30.1"

[programs.devnet]
nebula_curve = "CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
```

Before deploying:

1. Confirm `anchor keys list` prints the program ID you expect.
2. Confirm the wallet is the upgrade authority for that program (only relevant for an upgrade).
3. Fund the wallet with enough Devnet SOL for the program account rent and fees.

If you deploy a **new** program ID:

1. Run `anchor keys sync` (or manually update `declare_id!` and `Anchor.toml`).
2. Update `PROGRAM_ID` in `app/frontend/src/lib/curve.ts`.
3. Re-derive the state, reserve, and vault addresses (they are seed-derived from the program ID and mint). The old accounts will not be used by the new program.
4. Re-initialize and re-fund the new accounts.

### Upgrading an existing program

```bash
anchor build
anchor upgrade target/deploy/nebula_curve.so \
  --program-id CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw \
  --provider.cluster devnet
```

Keep the previous `.so` so you can roll back. Upgrades preserve the state account as long as the account layout is unchanged. This project has no migration framework: changing `BondingCurveState` requires a deliberate migration plan.

---

## 5. Initialization sequence

These steps are one-time per program/mint pair. They must run in order, and each is a real Devnet transaction.

### Option 1 — Admin page (recommended)

Open the app, go to **Admin (dev)** (overflow menu → *Admin (dev)*), connect the authority wallet, and use the bootstrap rows:

| Step | Action | What it does |
| --- | --- | --- |
| 1 | **Initialize State** | Creates the 185-byte `BondingCurveState` PDA with the deployed parameters |
| 2 | **Create Token Vault** | Creates the ATA owned by the state PDA |
| 3 | **Create SOL Reserve** | Sends the rent-exempt minimum (`890,880` lamports) to the reserve PDA |
| 4 | **Deposit KLYTH** | Moves KLYTH from the authority wallet into the vault |

Each button is disabled once its target account exists. The page shows the derived addresses, the current state size, the vault balance, and your wallet balance. It only enables deposits when the connected wallet equals `state.authority`.

### Option 2 — Manual client / script

Use the same parameters and account order as [`ARCHITECTURE.md`](ARCHITECTURE.md):

```
initialize(
  initial_price  = 1000000000000000,   // 1e15
  slope          = 80,                 // u128
  max_sold_supply = 50000000000000     // 50,000,000 KLYTH in raw units
)

state   = PDA(["bonding_curve", mint], program)
reserve = PDA(["sol_reserve", mint], program)
vault   = ATA(mint, state, allowOwnerOffCurve = true)
```

After `initialize`, the signer becomes `state.authority`. Create the vault, fund the reserve with at least `Rent::minimum_balance(0)`, then call `deposit_tokens` from the authority wallet. `deposit_sol` is optional and can top up the reserve later.

### Funding guidance

- The reserve only needs to cover seller payouts. Buys add to it automatically.
- The vault must hold enough KLYTH to serve buys. The curve allocation is `50,000,000 KLYTH`; it is deposited once during the rebuild and never topped up by hand.
- Keep the reserve above rent exemption at all times. Sells refuse to pay out below that floor.

---

## 6. Frontend deployment (GitHub Pages)

Live site: **https://mcybernet.github.io/KALYTH/**

### How it works

`.github/workflows/deploy-pages.yml` builds `app/frontend` and publishes it with
the official GitHub Pages actions. It runs on every push to `main` that touches
the frontend (or the snapshot scripts), every 15 minutes on a schedule, and can
be triggered manually from the Actions tab.

Before building the bundle, the workflow refreshes
`app/frontend/public/data/klyth-trades.json` with `scripts/build-ohlc-json.mjs`.
That file holds every confirmed KLYTH buy/sell; the chart merges it with the
newest live activity rows so candles cover the full history instead of only the
newest 40 records. The refresh is incremental (`--base` points at the deployed
file) and non-fatal: if the RPC is rate-limited, the snapshot already committed
to the repository is shipped instead.

The workflow reads `steps.pages.outputs.base_path` from
`actions/configure-pages` and passes it to Vite as `VITE_BASE`. This makes the
bundle work both for project sites (`https://user.github.io/repo/`) and for
user sites (`https://user.github.io/`).

### One-time repository setup (already done)

1. Push this repository to GitHub with `main` as the default branch.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy frontend to GitHub Pages** manually.
4. The first successful run prints the public URL in the job summary.

The current repository already has Pages enabled with `build_type: workflow`.

No secrets are required for the frontend. The snapshot step uses the public
Devnet RPC unless the optional `DEVNET_RPC_URL` secret is set.

### Trade snapshot

`app/frontend/public/data/klyth-trades.json` is generated by
`scripts/build-ohlc-json.mjs`. It is committed as a baseline; the scheduled
workflow extends it from the deployed copy and redeploys. Refresh it manually
when you need the local build to contain the newest trades:

```bash
cd scripts
npm ci
npm run ohlc:snapshot            # extend the committed file
node build-ohlc-json.mjs --full  # rescan everything
```

`DEVNET_RPC_URL` is honoured here too. The public endpoint works but is slow
because it rate-limits `getTransaction`; the script retries with backoff.

### Chart behaviour

Candles are bucketed in WIB. Empty intervals between the first and last trade
are filled with flat candles at the previous close (the most recent 6,000
buckets per timeframe at most), so small timeframes have no visual holes. The
chart footer reports how many candles are flat fills rather than real trades.

### Local build

```bash
cd app/frontend
npm ci
npm run typecheck
npm run build
```

To reproduce a project-site build locally:

```bash
VITE_BASE=/your-repo/ npm run build
npm run preview
```

The output is a static bundle in `app/frontend/dist/`.

### Hosting notes

- **HTTPS:** provided by GitHub Pages.
- **SPA fallback:** not required today because navigation is in-memory. If you
  add URL routing, add a `404.html` that mirrors `index.html`.
- **Caching:** hashed assets can be cached long-term; `index.html` should not be.
- **Base path:** handled by `VITE_BASE`; do not hard-code `/brand/...` in source.
  Use `publicAsset()` from `src/lib/assets.ts`.
- **Jekyll:** `public/.nojekyll` keeps GitHub Pages from processing the bundle.

### Endpoint configuration

The Devnet RPC URL is currently hard-coded in two places and must match:

- `app/frontend/src/main.tsx` → `ConnectionProvider` endpoint
- `app/frontend/src/lib/rpc.ts` → `RPC_URL`

If you switch to a dedicated RPC provider, update both. Do not put API keys in a public bundle; use a provider that supports domain-restricted keys or a proxy.

### Environment rules

- No private keys, seed phrases, or signing secrets in the frontend or its environment variables.
- No backend is required. If you add one, it must never hold user keys or sign for users.
- Keep the bundle free of test-only data or fake balances.

---

## 7. Burn automation

The burn reserve is owned by the `burn_authority` PDA, so no private key can
move it. The only path out is the program's `burn_daily` instruction, which
burns `min(daily_cap, reserve)` once per 23h50m window.

Verify the setup:

```bash
cd scripts
npm ci
npm run verify
```

Run one burn manually (the first call is allowed immediately):

```bash
node burn-daily.mjs
```

For unattended operation, the GitHub Actions keeper is configured:

- **GitHub Actions:** `.github/workflows/burn-daily.yml` runs four times a day
  at `00:05`, `06:05`, `12:05`, and `18:05` WIB. GitHub cron only accepts UTC,
  so the workflow file schedules `17:05`, `23:05`, `05:05`, and `11:05` UTC
  respectively.
  Repository secrets `DEVNET_RPC_URL` and `BURN_CRANK_KEYPAIR` are already set
  on `Mcybernet/KALYTH`. The crank wallet is dedicated and holds only fee SOL.

The workflow sends the same permissionless instruction as the manual script, so
extra runs cannot double-burn. The crank only pays the fee. It cannot choose the
amount or destination, and it cannot withdraw the reserve. GitHub cron is
best-effort; a delayed or dropped run is harmless because the 23h50m window
still allows the next slot.

A safe test without sending a transaction:

```bash
gh workflow run burn-daily.yml -f dry_run=true
```

or trigger **Daily KLYTH burn → Run workflow** with `dry_run` checked in the
Actions tab.

---

## 8. Verification

### On-chain

Use Solana Explorer with `?cluster=devnet`, or the CLI:

```bash
solana program show CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw
solana account 98NZ4NrFdsk6uT6zbHuDBSf7YC6TirrpomTRW9gtP2U7
solana account CKtoBdAuXB7AJR5kUjmjkHLeStQjUnYe2crtS5kp8gF1
```

Check:

- The program is executable and owned by the BPF loader.
- The state account is owned by the program, is `185` bytes, and its `authority`/`mint` fields match the expected values.
- The state's `sold_supply`, `max_sold_supply`, `initial_price`, and `slope` match the parameters you intended.
- The vault is an SPL token account whose mint is KLYTH and whose owner is the state PDA.
- The reserve holds at least the rent-exempt minimum.

With `spl-token` installed:

```bash
spl-token account-info FVJq2L9UbdHbTHd3g8qW9RACNQjGnFgaag8gqNzrq6z5
spl-token supply 4MUt8MMxTDYvd35zTnysuJXt29xg5MH7Kb65sB73sN2W
```

### Application smoke test

1. Open the site over HTTPS, connect Phantom on **Devnet**.
2. Confirm the header ticker and overview show live price, sold supply, and reserve.
3. Buy a small amount. Approve in Phantom, wait for confirmation, and verify the signature in Explorer.
4. Confirm wallet balances, sold supply, and reserve update after the 20-second poll or a manual refresh.
5. Confirm the trade appears in **Activity** with the correct amount and SOL value.
6. Sell a small amount and repeat the checks.
7. Force a failure (for example, set an impossibly low maximum cost) and confirm the app reports an error and balances are unchanged.
8. Open **Burn Tracker** and confirm it shows only real SPL Token burns.
9. Open the chart, switch between timeframes, and confirm candles cover the
   full history. If the "History is limited to the latest 40 activity records"
   note is visible, the snapshot failed to load — check
   `/data/klyth-trades.json` on the deployed site.

### Build checks

```bash
cd app/frontend
npm run typecheck
npm run build

cd ../../programs/nebula_curve
cargo test --lib        # requires a working Rust linker
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `429 Too Many Requests` | Public Devnet RPC throttling | Wait; the client retries with backoff. Use a dedicated RPC for demos. |
| Candles end at an old date or show the "latest 40 records" note | Snapshot file missing or the deploy skipped it | Confirm `/data/klyth-trades.json` loads; rerun `npm run ohlc:snapshot` and redeploy. |
| Activity list is empty or slow | Signature/transaction scan is rate-limited | Refresh after 15–30 s; reduce page size; use a dedicated RPC. |
| `Blockhash not found` / expired | Slow approval or network lag | Retry the transaction. |
| `insufficient funds for rent` | Wallet has too little Devnet SOL | `solana airdrop 2` (rate limits apply) or fund from another Devnet wallet. |
| `account already in use` | State or vault already exists | Skip that bootstrap step; the Admin page disables it automatically. |
| `custom program error: 0x1771` (6001) | `InvalidAmount`: zero amount or wrong mint/owner/account | Check amount, mint, and account ownership. |
| `0x1772` / `0x1773` | Vault or reserve is short | Deposit KLYTH or SOL; sells must leave rent exemption. |
| `0x1774` | `SlippageExceeded` | Raise `max_sol_cost` or lower `min_sol_received`. |
| `0x1775` | `MaxSupplyExceeded` | Reduce the buy size; the 50M sold-supply cap is reached. |
| `owner does not match` on the vault | Vault ATA was created with the wrong authority | Recreate it with owner = state PDA. |
| Admin deposit button disabled | Wrong wallet, missing state/vault, or zero amount | Connect the authority wallet; complete steps 1–2; enter a positive amount. |
| Phantom not detected | Extension missing or disabled | Install/enable Phantom and reload. |
| App shows an error instead of numbers | RPC failure or aborted request | Use refresh; check the browser console and Devnet status. |

Anchor custom errors start at `6000`; the enum order is in [`../programs/nebula_curve/src/errors.rs`](../programs/nebula_curve/src/errors.rs). Always confirm the actual error text in Explorer or the transaction logs before acting.

---

## 10. Redeploy, reset, and rollback

- **Frontend-only change:** rebuild and redeploy the static bundle. No on-chain action.
- **Program upgrade:** build, keep the old `.so`, upgrade with the upgrade authority, then verify the state still decodes and a small buy/sell succeeds.
- **New program ID:** re-derive and re-initialize state/vault/reserve, update frontend constants, and re-fund. Old accounts are orphaned.
- **Devnet reset:** Devnet may be wiped. Redeploy, re-initialize, re-fund, and re-verify; there is no backup of Devnet state.
- **Rollback:** upgrade back to the previous `.so`. If the state layout changed, rollback may make the account unreadable; test on a fresh state first.

---

## 11. Deployment checklist

- [ ] Program ID in `Anchor.toml`, `declare_id!`, and `src/lib/curve.ts` all match.
- [ ] `anchor keys list` matches the intended program.
- [ ] Wallet is on Devnet and funded.
- [ ] State PDA initialized with `1e15`, `80`, `50_000_000_000_000`.
- [ ] Vault ATA exists with owner = state PDA.
- [ ] SOL reserve funded at least rent-exempt.
- [ ] Vault funded with the intended KLYTH amount (50,000,000).
- [ ] Burn reserve funded with 40,000,000 KLYTH and owned by the burn authority PDA.
- [ ] `BurnState` initialized with an 800,000 KLYTH daily cap.
- [ ] Mint authority revoked; total supply is exactly 100,000,000 KLYTH.
- [ ] SOL reserve funded with 2 SOL for early sells.
- [ ] Frontend `npm run typecheck` and `npm run build` pass.
- [ ] `RPC_URL` and `ConnectionProvider` endpoint match and are HTTPS.
- [ ] Explorer links resolve with `?cluster=devnet`.
- [ ] Buy, sell, failure, activity, and burn tracker verified manually.
- [ ] No keys, `.env` secrets, or fake data in the bundle.
