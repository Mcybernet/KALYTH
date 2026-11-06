use anchor_lang::prelude::*;

#[account]
pub struct BondingCurveState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub token_vault: Pubkey,
    pub sol_reserve: Pubkey,
    pub initial_price: u128,
    pub slope: u128,
    pub sold_supply: u64,
    pub max_sold_supply: u64,
    pub bump: u8,
}

/// Fixed-size record for the permissionless daily burn.
///
/// Layout (after the 8-byte Anchor discriminator):
///   0..32   mint
///   32..64  burn_authority PDA
///   64..96  burn_reserve token account
///   96..104 daily_cap (raw NBR)
///   104..112 total_burned (raw NBR)
///   112..120 burn_count
///   120..128 last_burn_ts (unix seconds, 0 = never)
///   128     bump (BurnState PDA)
///   129     authority_bump (burn_authority PDA)
#[account]
pub struct BurnState {
    pub mint: Pubkey,
    pub burn_authority: Pubkey,
    pub burn_reserve: Pubkey,
    pub daily_cap: u64,
    pub total_burned: u64,
    pub burn_count: u64,
    pub last_burn_ts: i64,
    pub bump: u8,
    pub authority_bump: u8,
}

impl BurnState {
    pub const SPACE: usize = 8 + 32 * 3 + 8 * 3 + 8 + 1 + 1;
}

/// Minimum spacing between successful burns. The instruction is permissionless,
/// so this window is what makes the schedule "daily" rather than caller-driven.
/// 23h50m leaves a small grace for scheduler jitter while the cron still runs
/// once per day.
pub const BURN_INTERVAL_SECONDS: i64 = 23 * 60 * 60 + 50 * 60;

#[event]
pub struct BurnExecuted {
    pub mint: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
    pub burn_count: u64,
    pub timestamp: i64,
}
