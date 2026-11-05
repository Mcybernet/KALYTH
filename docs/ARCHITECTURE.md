# Architecture

This document describes how KALYTH is put together: the on-chain bonding-curve program, the accounts it owns, the automatic daily burn, the math it applies, and the client that reads and writes those accounts.

- **Network:** Solana Devnet only.
- **Program ID:** `CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw`
- **KLYTH mint:** `4MUt8MMxTDYvd35zTnysuJXt29xg5MH7Kb65sB73sN2W`
- **Toolchain:** Anchor 0.30.1, Rust edition 2021, classic SPL Token program.

For product intent, see [`../PRD.md`](../PRD.md). For trust boundaries and risks, see [`SECURITY.md`](SECURITY.md). For build/deploy steps, see [`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 1. System overview

```
┌──────────────────────────── Browser (static SPA) ────────────────────────────┐
│  React 19 + Vite 7 + TypeScript                                              │
│                                                                              │
│  Wallet adapter (Phantom) ── signs ──┐                                       │
│                                      │                                       │
│  CurveStateProvider ──┐              │        ┌── lib/rpc.ts ──────────────┐  │
│  KlythDataProvider ───┼── reads ─────┼───────▶│ single-lane JSON-RPC queue │  │
│  useActivity ─────────┘              │        │ 250 ms gap, retry/backoff  │  │
│                                      │        └─────────────┬──────────────┘  │
│  lib/curve.ts builds instructions ───┘                      │                 │
└─────────────────────────────────────────────────────────────┼─────────────────┘
                                                              │ HTTPS
                                              https://api.devnet.solana.com
                                                              │
┌─────────────────────────────────────────────────────────────▼─────────────────┐
│ Solana Devnet                                                                  │
│                                                                                │
│  Nebula curve program ── owns ──▶ BondingCurveState PDA                        │
│         │                         SOL reserve PDA                              │
│         │                         Token vault ATA (authority = state PDA)      │
│         │                                                                      │
│         └── CPI ──▶ SPL Token program ──▶ KLYTH mint / token accounts          │
└────────────────────────────────────────────────────────────────────────────────┘
```

There is no backend service and no database. The frontend is a static bundle; all state lives on Devnet and is read through the public RPC endpoint. The only write path is a wallet-signed transaction.

---

## 2. On-chain program

### 2.1 Source layout

| File | Responsibility |
| --- | --- |
| `programs/nebula_curve/src/lib.rs` | `declare_id!`, program module, instruction dispatch |
| `src/state.rs` | `BondingCurveState` account |
| `src/math/curve.rs` | fixed-point marginal price, buy cost, sell return, unit tests |
| `src/instructions/initialize.rs` | state PDA creation |
| `src/instructions/buy.rs` | buy accounts, params, handler |
| `src/instructions/sell.rs` | sell accounts, params, handler |
| `src/instructions/deposit.rs` | authority-only SOL and token deposits |
| `src/errors.rs` | `NebulaError` codes |

`src/lib_combined.rs` is a flattened copy of the same program used to build the current Devnet deployment in Solana Playground. It is not compiled by Cargo (the crate root is `lib.rs`), but it must be kept behaviorally identical.

### 2.2 Accounts and derivation

| Account | Derivation | Owner / authority |
| --- | --- | --- |
| Curve state | `PDA(["bonding_curve", mint], program)` | Program |
| SOL reserve | `PDA(["sol_reserve", mint], program)` | Program (system account) |
| Token vault | `ATA(mint, state, allowOwnerOffCurve = true)` | State PDA |
| KLYTH mint | Mint `GuaB…hkeK` | Mint authority revoked |
| Burn state | `PDA(["burn_state", mint], program)` | Program |
| Burn authority | `PDA(["burn_authority", mint], program)` | Program (off-curve) |
| Burn reserve token account | `ATA(mint, burn_authority, allowOwnerOffCurve = true)` | Burn authority PDA |

Deployed addresses:

| Account | Address |
| --- | --- |
| State | `98NZ4NrFdsk6uT6zbHuDBSf7YC6TirrpomTRW9gtP2U7` |
| Vault | `FVJq2L9UbdHbTHd3g8qW9RACNQjGnFgaag8gqNzrq6z5` |
| SOL reserve | `CKtoBdAuXB7AJR5kUjmjkHLeStQjUnYe2crtS5kp8gF1` |
| Burn state | `6dyDq8dUQq8VhE5vqXWSN1KzumsQWgeQkcDwhQptt2jj` |
| Burn authority | `75qqs7K5JXpccypy37aj3uwoZFYWKZ7wMao6y4xw3ybC` |
| Burn reserve | `6qV86Gd5SQ1YGn3TJCgXwZhmSz8m6PxDJSbL7at1Ra9v` |
| Metadata | `HFMgvqqxdzPXjR6xGN8jiJD14sXT28kYFFTTWgr5herR` |

The state account stores `token_vault` and `sol_reserve` as `Pubkey::default()`. They are **reserved fields** and are never updated. Instructions do not read them; instead they validate the supplied accounts against the PDA seeds and against the state PDA's ownership. Treat those fields as unused space.

### 2.3 State layout

`BondingCurveState` is 185 bytes including the 8-byte Anchor discriminator.

| Offset | Size | Field | Type |
| --- | --- | --- | --- |
| 0 | 8 | discriminator | `[u8; 8]` |
| 8 | 32 | `authority` | `Pubkey` |
| 40 | 32 | `mint` | `Pubkey` |
| 72 | 32 | `token_vault` | `Pubkey` (reserved, always default) |
| 104 | 32 | `sol_reserve` | `Pubkey` (reserved, always default) |
| 136 | 16 | `initial_price` | `u128` little-endian |
| 152 | 16 | `slope` | `u128` little-endian |
| 168 | 8 | `sold_supply` | `u64` little-endian, raw KLYTH units |
| 176 | 8 | `max_sold_supply` | `u64` little-endian, raw KLYTH units |
| 184 | 1 | `bump` | `u8` |

Deployed values at time of writing:

```
authority          = 2sM66rkL4FziKY9koz9wAHbtbUeLYwyTU5KCJEbRXuRN
initial_price      = 1_000_000_000_000_000   (1e15)
slope              = 80
sold_supply        = 0                        (fresh curve)
max_sold_supply    = 50_000_000_000_000      (50,000,000 KLYTH)
bump               = 255
```

The client decodes these offsets directly in `src/lib/curve.ts`; there is no IDL at runtime.

### 2.4 Instructions

Anchor discriminator = first 8 bytes of `sha256("global:<name>")`.

#### `initialize(initial_price: u128, slope: u128, max_sold_supply: u64)`

| # | Account | Flags | Constraint |
| --- | --- | --- | --- |
| 0 | `authority` | signer, writable | pays rent |
| 1 | `state` | writable | `init`, PDA `["bonding_curve", mint]` |
| 2 | `mint` | read-only | must deserialize as SPL `Mint` |
| 3 | `system_program` | read-only | — |

Writes `authority = signer`, `mint`, parameters, `sold_supply = 0`, `bump`. It does not create the vault or reserve and does not validate parameter values.

#### `buy(nbr_amount: u64, max_sol_cost: u64)`

| # | Account | Flags | Constraint |
| --- | --- | --- | --- |
| 0 | `buyer` | signer, writable | — |
| 1 | `state` | writable | PDA `["bonding_curve", mint]`, `bump = state.bump`, `mint == state.mint` |
| 2 | `mint` | read-only | `mint == state.mint` |
| 3 | `token_vault` | writable | mint matches, owner == state PDA |
| 4 | `buyer_token_account` | writable | mint matches, owner == buyer |
| 5 | `sol_reserve` | writable | PDA `["sol_reserve", mint]` |
| 6 | `token_program` | read-only | SPL Token |
| 7 | `system_program` | read-only | — |

Handler order:

1. Reject `nbr_amount == 0`.
2. Compute `new_sold_supply = sold_supply + nbr_amount` with checked add; reject if above `max_sold_supply`.
3. Compute integral cost; reject if `cost > max_sol_cost` (slippage).
4. Reject early if the vault holds less than `nbr_amount`.
5. CPI system transfer `cost` lamports from buyer to SOL reserve.
6. CPI SPL transfer `nbr_amount` from vault to buyer, signed by the state PDA seeds.
7. Store `sold_supply = new_sold_supply`.

#### `sell(nbr_amount: u64, min_sol_received: u64)`

| # | Account | Flags | Constraint |
| --- | --- | --- | --- |
| 0 | `seller` | signer, writable | — |
| 1 | `state` | writable | PDA `["bonding_curve", mint]`, `bump = state.bump`, `mint == state.mint` |
| 2 | `mint` | read-only | `mint == state.mint` |
| 3 | `token_vault` | writable | mint matches, owner == state PDA |
| 4 | `seller_token_account` | writable | mint matches, owner == seller |
| 5 | `sol_reserve` | writable | PDA `["sol_reserve", mint]` |
| 6 | `token_program` | read-only | SPL Token |
| 7 | `system_program` | read-only | — |

Handler order:

1. Reject `nbr_amount == 0` or `nbr_amount > sold_supply`.
2. Compute integral return; reject if `return < min_sol_received` (minimum output).
3. Compute `available = reserve_lamports − Rent::minimum_balance(0)`; reject if `available < return`. The reserve must remain rent-exempt.
4. CPI SPL transfer `nbr_amount` from seller to vault.
5. CPI system transfer `return` lamports from reserve to seller, signed by the reserve PDA seeds.
6. Store `sold_supply −= nbr_amount` with checked subtract.

#### `deposit_sol(amount: u64)`

| # | Account | Flags | Constraint |
| --- | --- | --- | --- |
| 0 | `authority` | signer, writable | `authority == state.authority` |
| 1 | `state` | writable | PDA `["bonding_curve", mint]` |
| 2 | `mint` | read-only | — |
| 3 | `sol_reserve` | writable | PDA `["sol_reserve", mint]` |
| 4 | `system_program` | read-only | — |

Rejects zero; transfers lamports from the authority to the reserve.

#### `deposit_tokens(amount: u64)`

| # | Account | Flags | Constraint |
| --- | --- | --- | --- |
| 0 | `authority` | signer, writable | `authority == state.authority` |
| 1 | `state` | writable | PDA `["bonding_curve", mint]` |
| 2 | `mint` | read-only | — |
| 3 | `authority_token_account` | writable | mint matches, owner == authority |
| 4 | `token_vault` | writable | mint matches, owner == state PDA |
| 5 | `token_program` | read-only | SPL Token |

Rejects zero; transfers KLYTH from the authority's ATA into the vault.

#### `initialize_burn(daily_cap: u64)`

Creates the `BurnState` PDA at `["burn_state", mint]` and validates that the supplied burn reserve token account belongs to the derived `burn_authority` PDA. The reserve is owned by the PDA, so no private key controls it.

#### `burn_daily()`

Permissionless. Anyone can pay the fee, but the program fixes the amount:

```
amount = min(daily_cap, burn_reserve_balance)
```

It burns from the burn reserve via SPL Token CPI and updates `total_burned`, `burn_count`, and `last_burn_ts`. It refuses to run again until `BURN_INTERVAL_SECONDS = 23h50m` has elapsed. The crank cannot choose the amount, destination, or timing beyond the on-chain window.

`BurnState` is 138 bytes: mint, burn authority, burn reserve, daily cap, total burned, burn count, last burn timestamp, and two bumps.

### 2.5 Curve math and units

Price is stored as a fixed-point integer per **raw** token unit (6 decimals), scaled by `1e18`.

```rust
PRICE_SCALE         = 1_000_000_000_000_000_000  // 1e18
INITIAL_PRICE_SCALED = 1_000_000_000_000_000     // 1e15  → 0.000001 SOL/KLYTH
SLOPE_SCALED        = 80                         // → 8e-14 SOL/KLYTH²
```

Marginal price at sold supply `x` (raw units):

```rust
marginal_price_scaled(x) = INITIAL_PRICE_SCALED + SLOPE_SCALED * x
```

Converted to SOL per whole KLYTH: `marginal_price_scaled(x) / 1e21`.

Integrals, with `q` = quantity in raw units and `x` = sold supply in raw units:

```rust
buy_cost(x, q) = (P0_scaled * q + SLOPE_SCALED * ((x+q)^2 - x^2) / 2) / PRICE_SCALE
sell_return(x, q) = (P0_scaled * q + SLOPE_SCALED * (x^2 - (x-q)^2) / 2) / PRICE_SCALE
```

Properties:

- `P0_scaled * q` and the slope term are accumulated in `u128`, then divided once by `1e18` and cast to `u64` lamports.
- The slope term is divided by `2` before the final division, so integer truncation can occur at two points. Both program and client truncate identically.
- All multiplications and additions use `checked_*` and map failures to `Overflow`, `Underflow`, or `DivisionByZero`.
- Round-trip `buy` then `sell` is guaranteed to return no more than was paid (`cost >= returned`), which is asserted by a unit test.

The client mirrors these formulas in `src/lib/curve.ts` (`quoteBuyCost`, `quoteSellReturn`, `quoteBuyAmount`, `marginalPrice`) so previews match the program.

### 2.6 Errors

| Variant | Message |
| --- | --- |
| `NotInitialized` | Bonding curve is not initialized |
| `InvalidAmount` | Invalid amount |
| `InsufficientVault` | Insufficient token vault balance |
| `InsufficientReserve` | Insufficient SOL reserve |
| `SlippageExceeded` | Slippage exceeded |
| `MaxSupplyExceeded` | Maximum sold supply exceeded |
| `Overflow` | Arithmetic overflow |
| `Underflow` | Arithmetic underflow |
| `DivisionByZero` | Division by zero |
| `BurnNotReady` | Burn window has not elapsed |
| `NothingToBurn` | Burn reserve is empty |
| `InvalidBurnReserve` | Burn reserve does not match the configured burn state |
| `InvalidBurnAuthority` | Burn authority does not match the configured burn state |

`InvalidAmount` is also used for account-constraint failures (wrong mint, wrong vault owner, unauthorized depositor).

### 2.7 What the program cannot do

- Mint KLYTH. The mint authority was revoked after setup, so supply is hard-capped at 100,000,000; it only decreases through SPL Token burns.
- Withdraw from the SOL reserve. The only outflow path is `sell`, which pays the computed return and preserves rent exemption.
- Change `authority` after initialization. There is no setter.
- Pause, freeze, or upgrade itself. Upgrade authority is a wallet held outside the program.

---

## 3. Frontend architecture

### 3.1 Stack

| Concern | Choice |
| --- | --- |
| Build | Vite 7 (`vite-plugin-node-polyfills` for Solana libs) |
| UI | React 19, strict TypeScript, CSS variables and plain CSS |
| Chain | `@solana/web3.js` 1.x, `@solana/spl-token` 0.4 |
| Wallet | `@solana/wallet-adapter-react` + Phantom adapter |
| Charts | ApexCharts 8 via `react-apexcharts` 2 |
| Icons | `lucide-react` |

`npm run build` runs `tsc --noEmit` before `vite build`, so type errors fail the build.

### 3.2 App shell and providers

`src/main.tsx` mounts:

```
ConnectionProvider(endpoint = https://api.devnet.solana.com)
└── WalletProvider([PhantomWalletAdapter], autoConnect)
    └── WalletModalProvider
        └── App
            └── KlythDataProvider
                └── CurveStateProvider
                    └── NavigationProvider
                        ├── SiteHeader
                        ├── TickerStrip
                        ├── page (switch on active page)
                        └── SiteFooter
```

Navigation is in-memory (`useState`), not URL-routed. `NavigationProvider` exposes `navigate(id)` so hero and rail buttons can move between pages.

Providers:

| Provider / hook | Data | Cadence |
| --- | --- | --- |
| `CurveStateProvider` | state account, vault amount, reserve lamports, rent minimum | every 20 s + manual `refresh()` |
| `KlythDataProvider` | mint supply/decimals, burn reserve balance, burn stats | on mount and `refresh()`; burn stats cached 60 s |
| `useActivity` | Buy/Sell/Burn records with pagination | per request; activity cache 20 s |
| `useWalletBalances` | connected wallet SOL and KLYTH | every 20 s while connected |

Each provider exposes `loading`, `error`, and `null` data instead of fabricated fallbacks. Components render skeletons or an error message until real data arrives.

### 3.3 RPC layer

`src/lib/rpc.ts` is a thin JSON-RPC client over `fetch`:

- One global request lane. Requests are serialized with a minimum 250 ms gap so the public Devnet endpoint is not bursted.
- Retryable HTTP statuses: `429, 500, 502, 503, 504`; also retryable RPC errors. Up to 8 attempts.
- Exponential backoff from 800 ms, capped at 8 s, with jitter.
- Every call accepts an `AbortSignal`; aborting clears pending retries.
- Non-retryable errors are surfaced to the caller immediately.

Wallet-signed transactions do not go through this queue; they use the wallet adapter's `Connection` directly.

### 3.4 Reading chain state

`src/lib/curve.ts`:

- `getStateAddress`, `getReserveAddress`, `getVaultAddress`, `getTokenAccountAddress` derive PDAs/ATAs.
- `fetchCurveState` calls `getAccountInfo` with `jsonParsed`/base64, checks that the account is at least 185 bytes, and decodes fields by offset. It does not verify the Anchor discriminator; the PDA derivation and mint check in the program are the authority.
- `fetchVaultAmount` reads the SPL token account amount at offset 64.
- `fetchReserveLamports` reads the system account lamports.

Quotes and instruction builders live in the same module. Buy and sell instructions are encoded with the hard-coded Anchor discriminators:

```
BUY_DISCRIMINATOR  = [102, 6, 61, 18, 1, 218, 235, 234]
SELL_DISCRIMINATOR = [51, 230, 133, 164, 1, 127, 131, 173]
```

The Trade page additionally prepends an idempotent `createAssociatedTokenAccount` instruction when the buyer/seller ATA does not exist. Transactions are signed by the wallet, submitted with `sendRawTransaction`, and awaited with `confirmTransaction`; any error is surfaced as a failed status and never shown as success.

### 3.5 Activity and burn parsing

`src/lib/history.ts`:

1. Fetch signatures for the program and for the burn reserve token account via `getSignaturesForAddress`.
2. Deduplicate and sort newest-first by slot.
3. Fetch transactions with `jsonParsed` and `maxSupportedTransactionVersion: 0`, three at a time.
4. For program transactions, find the first instruction whose `programId` is the curve program, base58-decode its data, and match the 8-byte discriminator. The KLYTH amount is the little-endian `u64` at offset 8. The wallet is the first signer.
5. SOL value is the reserve account's lamport delta from `meta.preBalances` / `meta.postBalances` — positive for buys, negative for sells. No price estimate is used.
6. For burns, match SPL Token `burn` instructions whose `account` is the burn reserve and whose `mint` is KLYTH; the amount comes from the parsed instruction.
7. Failed transactions are returned with `status: 'failed'`, displayed as failed, and excluded from burn totals and chart markers.

Caches: activity pages 20 s, burn stats 60 s. Burn stats scan up to 10 pages of 1,000 signatures.

`buildExecutionPoints` reconstructs each trade's sold-supply position by walking backwards from the current on-chain `sold_supply`: buys subtract, sells add, and the resulting supply is paired with the SOL actually moved. This keeps chart markers anchored to confirmed trades.

### 3.6 Chart

`BondingCurveChart` receives the live curve parameters and position, plus `ExecutionPoint[]` built from confirmed activity records:

- **Curve mode:** the `Bonding curve` area is 96 points (56 on compact screens) sampled from `P(x) = P0 + kx`. Confirmed executions are drawn as small green/red dots with no connecting line, and a gold `Live position` marker sits at the current on-chain sold supply. The `Live` range is selected by default and centres a window on the current position; `1%`, `10%`, and `Full` show fixed slices of the curve, while `Your trade` appears only while a trade is being composed.
- **Candles mode:** OHLC bars are built only from confirmed buy/sell trades. Trades are kept in execution order and split into 34 contiguous groups (18 on compact screens), so the chart always shows a natural number of evenly spaced candles rather than a few oversized bars. Within a group, open/close are the first and last real execution prices and high/low are the real extremes. Each candle uses a fixed 5 px (4 px compact) body width. No synthetic candles are created. Time labels are shown when every trade carries a `blockTime`; otherwise the axis falls back to trade-sequence labels. A dashed annotation marks the current marginal price, and the range tabs are replaced by a `Confirmed trades only` badge.
- All ranges are clamped to `[0, maxSoldSupply]`.
- A preview band shows the price impact of a prospective buy or sell in Curve mode.

### 3.7 Page map

| Page | Main data sources |
| --- | --- |
| Overview | curve state, vault, reserve, recent activity |
| Trade | curve state, wallet balances, quote math, wallet send/confirm |
| Tokenomics | mint supply, burn reserve, allocations |
| Burn Tracker | burn stats, burn reserve balance |
| Activity | paginated activity records |
| About | static content, live addresses |
| Docs | this documentation, live addresses |
| Admin | account existence checks, bootstrap transactions |
| Design system | internal visual reference |

---

## 4. Invariants

1. **No fabricated data.** Every number is either read from Devnet or computed deterministically from on-chain values with the documented formulas.
2. **One source of truth for addresses.** `src/lib/addresses.ts` re-exports values derived in `src/lib/curve.ts`; pages do not hard-code addresses.
3. **Quote parity.** Client quote functions must match `math/curve.rs` integer-for-integer. Changing either side requires updating the other and re-checking truncation.
4. **No keys in the client.** Only the wallet adapter signs. No secret material is bundled.
5. **Failure is visible.** RPC errors, wallet rejections, and failed transactions are shown as such and never converted into success states.
6. **Rent safety.** Sells cannot drain the reserve below rent exemption.
7. **Atomicity.** A failed buy/sell transaction reverts all transfers and the `sold_supply` update together.

---

## 5. Known deviations and gaps

| Item | Current state | Implication |
| --- | --- | --- |
| Deployed build | `lib_combined.rs` via Solana Playground | Keep it in sync with the modular Anchor source |
| IDL | Not used at runtime | Discriminators/account order are maintained manually |
| `token_vault` / `sol_reserve` state fields | Always `Pubkey::default()` | Reserved space; validation uses seeds/ownership |
| Automated burn keeper | Not implemented | Burn tracker observes real burns only |
| Authority transfer | Not implemented | Treasury remains authority until program is upgraded |
| Integration tests | Not implemented | Manual Devnet verification; Rust unit tests cover math only |
| URL routing | In-memory page state | Deep links and browser back/forward do not select pages |
| Public RPC | No dedicated provider | Rate limits cause slow history loads |

---

## 6. Extension points

- **Dedicated RPC:** replace the endpoint in `src/main.tsx` and `src/lib/rpc.ts` (they must stay in sync) with a provider URL.
- **New curve parameters:** re-initialize under a new mint/state PDA, then update `PRICE_SCALE`-derived constants and defaults in `src/lib/curve.ts` and `BondingCurveChart.tsx`.
- **Automated burns:** add an off-chain keeper that holds the burn reserve authority and submits SPL Token `burn` transactions; the tracker already picks them up. Do not add burns inside `buy`/`sell` without an approved economic rule.
- **Authority transfer / pause:** requires a program upgrade and new instructions; design them with explicit two-step handover and events.
- **URL routing:** wrap `NavigationProvider` with a router and map page ids to paths; no data-layer changes needed.
