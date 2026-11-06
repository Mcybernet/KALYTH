# Burn automation ops

On-chain program changes live in `programs/nebula_curve`. This folder contains
the one-time migration and the daily crank used by an external scheduler
(GitHub Actions or Windows Task Scheduler).

## How it works

- `initialize_burn` creates a `BurnState` PDA at `[b"burn_state", mint]`.
- The burn reserve token account is owned directly by the `burn_authority` PDA
  at `[b"burn_authority", mint]`. No wallet key controls it.
- `burn_daily` is permissionless. It burns `min(daily_cap, reserve balance)` and
  refuses to run again until 23h50m have passed (a small grace below 24h so a
  daily cron cannot skip a day on scheduler jitter).
- The crank only pays the transaction fee. It cannot choose the amount or the
  destination, and it cannot withdraw the reserve.

Default cap: `800,000 KLYTH` = `800_000_000_000` raw units. Fifty burns take
supply from 100,000,000 to 60,000,000 KLYTH. On the final day the reserve holds
less than the cap, so the program burns the remainder.

## 1. Deploy the updated program

Build and deploy `programs/nebula_curve/src/lib_combined.rs` with Solana
Playground using the existing program ID:

```
CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw
```

The program is mint-agnostic and upgradeable. The current Devnet deployment was
rebuilt with a fresh mint (`GuaB…hkeK`); the program ID stays the same.

Verify the deployment before touching any state. The script is read-only and
needs no keypair:

```bash
cd scripts
npm ci
npm run verify
node verify-burn-setup.mjs --simulate-init
node verify-burn-setup.mjs --simulate-burn
```

It checks the upgrade authority, scans the on-chain binary for the burn handlers
(a "successful" deploy can still contain old code), and reads the curve, mint,
reserve, and `BurnState`. `--simulate-init` also simulates `initialize_burn` with
signature verification disabled, so account or constraint mistakes surface
before a real transaction is sent. `--simulate-burn` does the same for
`burn_daily`; it fails with `BurnNotReady` when the 23h50m window is closed.

## 2. Run the migration once

```bash
cd scripts
npm ci
cp .env.example .env    # fill in local paths; .env is gitignored
node migrate-burn.mjs
```

`BURN_STATE_AUTHORITY_KEYPAIR` must be the curve authority
(`2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN`). The current deployment already
has `BurnState` initialized, so the migration is a no-op unless a fresh mint is
created.

The script prints the transaction and the resulting owner/cap. Re-running is
safe: it skips work that is already done.

Verify on Explorer:

- Burn reserve owner is the `burn_authority` PDA (`FuRgs…7rN9`).
- `BurnState` exists and its cap is `800000000000`.
- Reserve balance is unchanged by the migration.

## 3. Trigger one burn

```bash
cd scripts
node burn-daily.mjs
```

The first call is allowed immediately because `last_burn_ts` starts at zero.
Check that supply and reserve both decreased by exactly `800,000 KLYTH`.

## 4. Enable the GitHub Actions crank

Add repository secrets:

| Secret | Value |
| --- | --- |
| `DEVNET_RPC_URL` | Devnet RPC endpoint |
| `BURN_CRANK_KEYPAIR` | Funded Devnet keypair as a JSON array or base58 secret |

Both secrets are already configured on `Mcybernet/KALYTH`. The crank is a
dedicated wallet (`7B2P…P4sr`) holding 0.2 SOL, not the treasury key.

The workflow runs at `00:05`, `06:05`, `12:05`, and `18:05` UTC. Extra runs are
no-ops because of the on-chain 23h50m window. Scheduled workflows only run from
the default branch, and GitHub disables the schedule after 60 days without
repository activity, so check the Actions tab periodically or keep the repo
active for the full 50-day burn plan.

Never put a keypair in the repository. `BURN_CRANK_KEYPAIR` should hold only
enough Devnet SOL for transaction fees.

## 5. Demo trader (Devnet only)

`demo-trade.mjs` sends small randomized buys and sells from a dedicated wallet
so the test deployment has visible activity. It is **not** a market maker and
must never run on mainnet: the script refuses any cluster whose genesis hash is
not Devnet's `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

Safety rules baked into the script:

- It only spends its own wallet balance. It never uses the curve reserve, the
  burn reserve, or the treasury.
- It refuses to start if `DEMO_TRADE_KEYPAIR` resolves to a known protocol or
  treasury address, and it caps any single trade at 0.05 SOL.
- Buys are capped by wallet SOL, 0.5% of the token vault, and remaining supply.
- Sells are capped by 0.5% of the available reserve and 25% of the wallet's
  KLYTH balance.
- If a randomized buy is larger than the available SOL, it switches to a sell.
  If there is no KLYTH to sell, it shrinks the buy instead.
- If SOL is below the fee buffer, it exits cleanly and waits for a top-up.
- It exits without doing anything when `DEMO_TRADING_ENABLED=0`.

### Create and fund the demo wallet

Use a brand-new keypair, separate from every other role:

```bash
solana-keygen new --outfile ~/demo-trade.json
solana-keygen pubkey ~/demo-trade.json
```

Fund that address with Devnet SOL (`solana airdrop 1 <address> --url devnet`, or
any Devnet faucet). A budget of `0.1–0.5 SOL` is enough for a long demo; a
round-trip buy/sell returns most of the principal and only loses fees and
rounding. Do **not** fund it with real SOL.

### Run locally

```bash
cd scripts
npm ci
cp .env.example .env    # set DEMO_TRADE_KEYPAIR and DEVNET_RPC_URL
DRY_RUN=1 node demo-trade.mjs
node demo-trade.mjs
```

Optional tuning (defaults in parentheses):

| Variable | Default | Meaning |
| --- | ---: | --- |
| `DEMO_TRADES_PER_RUN` | `1` | Trades per invocation, clamped to 1–5 |
| `DEMO_MIN_TRADE_SOL` | `0.002` | Smallest buy budget |
| `DEMO_MAX_TRADE_SOL` | `0.02` | Largest buy budget |
| `DEMO_MIN_SOL_BUFFER` | `0.005` | SOL kept back for fees and rent |
| `DEMO_MAX_VAULT_BPS` | `50` | Max buy size as basis points of the vault |
| `DEMO_MAX_RESERVE_BPS` | `50` | Max sell payout as basis points of the reserve |
| `DEMO_MAX_SELL_WALLET_BPS` | `2500` | Max share of wallet KLYTH sold at once |
| `DEMO_SELL_PROBABILITY` | `0.45` | Chance of choosing a sell when both sides are possible |
| `DEMO_SLIPPAGE_BPS` | `100` | Slippage tolerance (1%) |
| `DEMO_MAX_DELAY_MS` | `30000` | Upper bound for the random delay between trades |

### Enable the GitHub Actions workflow

Add repository secrets:

| Secret | Value |
| --- | --- |
| `DEVNET_RPC_URL` | Devnet RPC endpoint |
| `DEMO_TRADE_KEYPAIR` | Demo wallet as a JSON array or base58 secret |

Then add a repository **variable**:

| Variable | Value |
| --- | --- |
| `DEMO_TRADING_ENABLED` | `true` to run, `false` or absent to stop |

This variable is the kill switch: the `demo-trades` job is skipped entirely
unless it is `true`. The workflow runs every 15 minutes and can also be
dispatched manually with a `dry_run` toggle and a `trades` count.

Optionally add a second variable so the frontend marks the bot's trades:

| Variable | Value |
| --- | --- |
| `DEMO_WALLET_ADDRESS` | The demo wallet's public address |

`deploy-pages.yml` passes it to Vite as `VITE_DEMO_WALLET_ADDRESS`, and the
activity tables show a `Demo` badge for that wallet. Leave it unset to hide the
badge. Changing the variable requires re-running the Pages workflow.

Scheduled workflows only run from the default branch, GitHub disables schedules
after 60 days without repository activity, and cron is best-effort. The public
Devnet RPC is heavily rate-limited, so use a dedicated provider for frequent
runs.

### What "waiting" means

When the log says `SOL is below the 0.005 SOL buffer` or `Wallet SOL exhausted;
waiting for a top-up`, the bot has stopped by design. Send more Devnet SOL to
the demo address; the next run picks it up automatically. It never tries to
refill itself from the curve reserve.

## Dry run


Set `DRY_RUN=1` to print the plan without sending:

```bash
DRY_RUN=1 node migrate-burn.mjs
DRY_RUN=1 node burn-daily.mjs
```

The GitHub workflow also accepts a `dry_run` input when dispatched manually.

## Error codes

| Code | Name | Meaning |
| --- | --- | --- |
| 6009 | `BurnNotReady` | Less than 23h50m since the last burn |
| 6010 | `NothingToBurn` | Burn reserve balance is zero |
| 6011 | `InvalidBurnReserve` | Reserve account does not match `BurnState` |
| 6012 | `InvalidBurnAuthority` | Reserve owner is not the burn authority |
