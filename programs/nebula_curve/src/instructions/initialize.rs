use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::state::BondingCurveState;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 * 4 + 16 * 2 + 8 * 2 + 1,
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump
    )]
    pub state: Account<'info, BondingCurveState>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub initial_price: u128,
    pub slope: u128,
    pub max_sold_supply: u64,
}

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let state = &mut ctx.accounts.state;
    state.authority = ctx.accounts.authority.key();
    state.mint = ctx.accounts.mint.key();
    state.token_vault = Pubkey::default();
    state.sol_reserve = Pubkey::default();
    state.initial_price = params.initial_price;
    state.slope = params.slope;
    state.sold_supply = 0;
    state.max_sold_supply = params.max_sold_supply;
    state.bump = ctx.bumps.state;
    Ok(())
}
