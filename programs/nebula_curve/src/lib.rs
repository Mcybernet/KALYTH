use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;
pub mod math;

use instructions::burn::{BurnDaily, InitializeBurn, InitializeBurnParams};
use instructions::buy::{Buy, BuyParams};
use instructions::deposit::{DepositSol, DepositSolParams, DepositTokens, DepositTokensParams};
use instructions::initialize::{Initialize, InitializeParams};
use instructions::sell::{Sell, SellParams};

declare_id!("CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw");

#[program]
pub mod nebula_curve {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    pub fn buy(ctx: Context<Buy>, params: BuyParams) -> Result<()> {
        instructions::buy::handler(ctx, params)
    }

    pub fn sell(ctx: Context<Sell>, params: SellParams) -> Result<()> {
        instructions::sell::handler(ctx, params)
    }

    pub fn deposit_sol(ctx: Context<DepositSol>, params: DepositSolParams) -> Result<()> {
        instructions::deposit::deposit_sol_handler(ctx, params)
    }

    pub fn deposit_tokens(ctx: Context<DepositTokens>, params: DepositTokensParams) -> Result<()> {
        instructions::deposit::deposit_tokens_handler(ctx, params)
    }

    pub fn initialize_burn(
        ctx: Context<InitializeBurn>,
        params: InitializeBurnParams,
    ) -> Result<()> {
        instructions::burn::initialize_burn_handler(ctx, params)
    }

    pub fn burn_daily(ctx: Context<BurnDaily>) -> Result<()> {
        instructions::burn::burn_daily_handler(ctx)
    }
}
