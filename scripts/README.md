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

The workflow runs at `00:05` and `00:35` UTC. The second run is a safety net for
scheduler delay; the on-chain window makes it a no-op if the first one
succeeded. Scheduled workflows only run from the default branch, and GitHub
disables the schedule after 60 days without repository activity, so check the
Actions tab periodically or keep the repo active for the full 50-day burn plan.

Never put a keypair in the repository. `BURN_CRANK_KEYPAIR` should hold only
enough Devnet SOL for transaction fees.

## Dry run

Set `DRY_RUN=1` to print the plan without sending:

```bash
DRY_RUN=1 node migrate-burn.mjs
DRY_RUN=1 node burn-daily.mjs
```

## Error codes

| Code | Name | Meaning |
| --- | --- | --- |
| 6009 | `BurnNotReady` | Less than 23h50m since the last burn |
| 6010 | `NothingToBurn` | Burn reserve balance is zero |
| 6011 | `InvalidBurnReserve` | Reserve account does not match `BurnState` |
| 6012 | `InvalidBurnAuthority` | Reserve owner is not the burn authority |
