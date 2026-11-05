# Security

This document covers the trust model, on-chain controls, client-side assumptions, known threats, and residual risks for KALYTH on Solana **Devnet**.

> Devnet only. KLYTH has no monetary value. Do not deploy this code to mainnet or use it with real funds without an independent audit and the pre-mainnet work listed at the end.

---

## 1. Scope and reporting

In scope:

- `programs/nebula_curve` (Anchor program)
- `app/frontend` (React client, instruction encoding, RPC handling)
- Deployment and initialization procedure

Out of scope:

- Solana runtime, SPL Token program, Anchor framework, wallet extensions
- The public `api.devnet.solana.com` endpoint
- Social engineering and phishing outside the app

There is no bug bounty and no formal security contact for this Devnet project. If you find an issue, open an issue in the repository with reproduction steps. Do not exploit a finding against accounts you do not own.

---

## 2. Trust model

| Actor | Trusted for | Not trusted for |
| --- | --- | --- |
| User wallet (Phantom) | Signing exactly the transaction shown | Correctness of the dApp |
| Curve authority / treasury wallet `2sM66…RXuRN` | Deposits, upgrade authority | Not putting the program or users at risk |
| Program upgrade authority | The deployed bytecode | Future upgrades |
| Solana Devnet + public RPC | Returning chain state | Availability, latency, censorship |
| Frontend bundle | Displaying data and building transactions | Custody of funds or keys |
| Burn authority PDA `FuRgs…7rN9` | Authority over the burn reserve | Burning more than `daily_cap` or before the window elapses (enforced by the program) |

Key points:

- The program is **non-custodial**. It never holds user keys and cannot move tokens out of a user's account without a user-signed transaction.
- The SOL reserve and token vault are controlled by program PDAs. Only `buy`, `sell`, `deposit_sol`, and `deposit_tokens` can move value, and each has fixed rules.
- The frontend has **no backend**. There is no server-side key, session, or database to compromise.
- The mint authority was revoked after the initial allocation, so supply is hard-capped at 100,000,000 KLYTH. The treasury wallet still holds the upgrade authority, so a compromise could replace the program even though user balances are not directly withdrawable.
- The burn reserve is owned by a program PDA, not a wallet. There is no key to steal or lose; the only outflow is the capped, rate-limited `burn_daily` instruction.

---

## 3. Key management

- No private keys, seed phrases, or keypair files exist in the repository or the frontend bundle.
- The browser never asks for a seed phrase. Phantom signs through the wallet adapter.
- `Anchor.toml` references `~/.config/solana/id.json` for local CLI use only; that file is outside the repo and must never be committed.
- The treasury wallet is the curve `authority` and (per the current deployment) the program upgrade authority. The mint authority is revoked. On Devnet this is acceptable; on mainnet these roles should be separated and held by multisigs.
- The burn reserve token account is owned by the `burn_authority` PDA. No private key controls it; the frontend only displays its address and balance.
- `.gitignore` excludes `node_modules`, build output, `.env*`, keypair files, and Rust `target/`.

Operational rules:

1. Never paste a secret into the app, an issue, or a chat.
2. Verify the transaction in the wallet before signing, especially the program ID and account list.
3. Use a dedicated Devnet wallet, not a wallet holding mainnet assets.

---

## 4. On-chain controls

### 4.1 Account validation

| Check | Where |
| --- | --- |
| State PDA seeds `["bonding_curve", mint]` + stored bump | `buy`, `sell`, `deposit_sol`, `deposit_tokens` |
| `mint == state.mint` | `buy`, `sell` |
| Vault mint == state mint, vault owner == state PDA | `buy`, `sell`, `deposit_tokens` |
| User token account mint and owner | `buy` (buyer), `sell` (seller), `deposit_tokens` (authority) |
| SOL reserve PDA seeds `["sol_reserve", mint]` | `buy`, `sell`, `deposit_sol` |
| `authority == state.authority` | `deposit_sol`, `deposit_tokens` |
| Token program type | All token CPIs use `Program<'info, Token>`, rejecting a look-alike program |
| Rent exemption after payout | `sell` |

### 4.2 Arithmetic

- All curve math uses `u128` with `checked_mul`, `checked_add`, `checked_sub`, and `checked_div`.
- Zero and out-of-range amounts are rejected before any transfer.
- Division truncates toward zero. Buys round down the cost (never more than the exact integral) and sells round down the return (never more than the exact integral). A buy→sell round trip cannot return more than was paid.
- `sold_supply` uses checked add/subtract and is bounded by `max_sold_supply` on buys.

### 4.3 Economic protections

| Protection | Implementation |
| --- | --- |
| Buy slippage | `max_sol_cost`; transaction fails if the integral cost exceeds it |
| Sell slippage | `min_sol_received`; transaction fails if the return is lower |
| Supply cap | `sold_supply + nbr_amount <= max_sold_supply` |
| Vault coverage | Buy fails early if the vault lacks the KLYTH amount |
| Reserve coverage | Sell fails if the payout would break rent exemption |
| No free withdrawal | No instruction transfers reserve SOL to an arbitrary account |
| No minting by curve | The program has no mint CPI; KLYTH supply is unchanged by buys/sells |
| Burn cap | `burn_daily` burns `min(daily_cap, reserve)` only |
| Burn window | `burn_daily` refuses to run again until 23h50m have elapsed |
| Burn destination | Tokens can only be burned, never transferred to the crank |

### 4.4 Atomicity

A Solana transaction is all-or-nothing. In `buy`, if the SOL transfer succeeds but the token transfer fails, the entire transaction reverts, including the SOL transfer and the `sold_supply` write. The same applies to `sell`: tokens are moved into the vault first, then SOL is paid; any failure reverts both legs and the supply update.

The client signs and sends the transaction through the wallet, waits for confirmation, then re-reads balances from chain. A failed transaction never updates displayed balances because no optimistic balance state is written.

### 4.5 Access control

- `initialize` is permissionless by design: the first caller becomes `state.authority`. On Devnet the state already exists, so this path is closed for the KLYTH mint.
- `deposit_sol` and `deposit_tokens` require the signer to equal `state.authority`.
- `buy` and `sell` are permissionless and require only the user's signature.
- `burn_daily` is permissionless: anyone can pay the fee, but the program fixes the amount, destination, and timing.
- There is no withdraw, pause, authority-change, or arbitrary-CPI instruction.

---

## 5. Client-side security

| Area | Control |
| --- | --- |
| Keys | Wallet adapter only; no secret storage in the app |
| Transaction building | Fixed program ID, fixed account order, hard-coded discriminators; amounts encoded as little-endian `u64` |
| Preflight | None in the app. The program re-validates amounts and accounts on-chain, and the wallet shows the full transaction before signing. |
| Confirmation | Waits for `confirmed` and re-reads chain state |
| RPC | HTTPS endpoint, single-lane queue, bounded retries, abortable requests |
| Rendering | React escapes text; no `dangerouslySetInnerHTML`; no user-supplied HTML |
| External links | `target="_blank"` with `rel="noreferrer"` to Solana Explorer |
| Dependencies | Standard Solana/React packages; `npm audit` should be run before any public deployment |
| Static hosting | The bundle contains only public addresses and public RPC URL |

The app does not read or write `localStorage` for secrets and does not persist signatures or wallet data beyond the in-memory session.

---

## 6. Threat model

| # | Threat | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| 1 | Someone initializes the state first with hostile parameters | Wrong curve economics | State already initialized for KLYTH; deploy + init should be atomic in future | A future mint could be front-run; no parameter validation in `initialize` |
| 2 | Supply inflation | Dilution, broken tokenomics | Mint authority revoked after the 100,000,000 KLYTH allocation; supply is observable on-chain | None known while the authority stays revoked |
| 3 | Upgrade authority replaces program | Total loss of program guarantees | Devnet only; authority is a known wallet | Single wallet; no timelock or multisig |
| 4 | Malicious RPC returns false state | User trades on wrong numbers | HTTPS; quotes recomputed locally from on-chain fields; the wallet may simulate; the program re-checks amounts and accounts on-chain | A compromised RPC can mislead the UI; users should verify in Explorer |
| 5 | Frontend compromise / tampered bundle | Malicious transaction signed | Static bundle, no server; user reviews wallet prompt; program constrains account order and amounts | Host compromise is out of scope; use a reputable host and integrity monitoring |
| 6 | Account substitution (fake vault/reserve/mint) | Theft of tokens or SOL | PDA seeds, mint match, owner checks, token program type | None known |
| 7 | Reentrancy-style state manipulation | Incorrect supply accounting | State updated after CPIs; only system/token programs invoked; Solana rolls back on failure | None known for this instruction set |
| 8 | Integer overflow/underflow | Wrong cost or panic | Checked arithmetic; `u128` intermediates; bounded `u64` outputs | None known within `max_sold_supply` |
| 9 | Slippage / MEV | Worse execution than expected | `max_sol_cost`, `min_sol_received` enforced on-chain | User must set sane limits; default UI tolerances matter |
| 10 | Reserve drained below rent exemption | Account purge; sellers cannot be paid | `sell` preserves `Rent::minimum_balance(0)` | Reserve can still be exhausted by legitimate sells; buys refill it |
| 11 | Vault underfunded | Buys fail | Early `InsufficientVault` check; explicit `deposit_tokens` | Liveness depends on the authority topping up |
| 12 | Burn authority compromised | Unexpected burns | Reserve is owned by a PDA; `burn_daily` enforces the cap and 23h50m window; burns are public | None known; the program is the only signer path |
| 13 | Burn reserve receives transfers but no burns | Misleading "burned" expectations | Tracker counts only real `burn` instructions, not transfers | Users may confuse transfers with burns |
| 14 | RPC rate limiting / outage | App appears empty or slow | Queue, retry/backoff, explicit loading/error states | No SLA on public Devnet RPC |
| 15 | Phishing clone of the site | Key theft | Out of scope; users should use the canonical URL | No domain/DNS controls documented here |
| 16 | Dependency compromise | Malicious code in bundle | Lockfile, review, `npm audit` | Supply-chain risk remains |
| 17 | Wallet drainer via malicious dApp | Loss of user funds | Only the program's instructions are built; no `approve` or arbitrary transfer | Users can still sign anything in their wallet |

---

## 7. Residual risks and known gaps

1. **Permissionless `initialize` with unvalidated parameters.** The program accepts any `initial_price`, `slope`, and `max_sold_supply`, and stores the first signer as authority. The live KLYTH state is already initialized, but any new mint/state would be exposed to front-running. Fix: validate expected constants, require a hard-coded admin, or deploy and initialize atomically.
2. **Single-key upgrade authority.** The treasury wallet holds the upgrade authority. A compromise can replace the program. Fix: multisig + timelock, separated roles.
3. **Burn automation liveness.** Supply is hard-capped and the mint authority is revoked, but burns only happen when an external crank sends `burn_daily`. If the crank stops, supply stays higher than the 60,000,000 target. Fix: monitor the crank and alert on missed windows.
4. **No events.** The program emits no Anchor events; the client reconstructs activity from transaction data and instruction discriminators. This works but is brittle if instruction layouts change.
5. **Reserved state fields.** `token_vault` and `sol_reserve` are always default. Any external tool that trusts them will be wrong. Use PDA derivation instead.
6. **No pause or emergency stop.** If a bug is found, the only response is an upgrade.
7. **External burn crank.** The on-chain cap and window are enforced, but the transaction still needs a keeper (GitHub Actions or Task Scheduler). Monitor for missed burns.
8. **No integration test suite.** Math is unit-tested; instruction-level and end-to-end paths are verified manually on Devnet.
9. **Public RPC.** Availability and ordering are not guaranteed; history scans can be slow or incomplete under rate limits.
10. **In-memory navigation.** A reload returns to the overview; no deep-link integrity concerns, but no shareable state either.
11. **Devnet data is disposable.** Devnet can be reset; addresses and history may disappear without notice.

---

## 8. Pre-mainnet checklist

Do not deploy to mainnet until all of these are addressed:

- [ ] Independent security audit of the program and client.
- [ ] Validate `initialize` parameters against expected constants, or make initialization part of the upgrade/deploy transaction.
- [x] Revoke the mint authority (done for the current Devnet mint).
- [ ] Move upgrade authority to a multisig with a timelock.
- [ ] Separate treasury, curve authority, burn authority, and upgrade authority.
- [ ] Add program events for initialize, buy, sell, and deposits.
- [ ] Add authority transfer and pause/emergency instructions with explicit two-step handover.
- [ ] Add an instruction-level and end-to-end test suite, including failure/atomicity cases.
- [ ] Use a dedicated RPC provider with monitoring and fallbacks.
- [ ] Add a content security policy, SRI where applicable, and a monitored production domain.
- [ ] Run `npm audit` and pin dependency versions.
- [ ] Document incident response, key rotation, and reserve top-up procedures.
- [ ] Re-verify the deployed bytecode against the reviewed source.

---

## 9. Devnet operating notes

- Treat all KLYTH and SOL here as test data. Do not send mainnet assets to any Devnet address.
- Airdrop or fund the Devnet wallet explicitly; the app never requests an airdrop.
- The app shows failed transactions as failed. If a transaction fails, no partial balance change persists on-chain.
- If the UI shows stale data, use the refresh controls; providers poll every 20 seconds.
- Verify any address in the app against the canonical list in [`../README.md`](../README.md) before signing.
