use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::errors::NebulaError;
use crate::math::curve::sell_return;
use crate::state::BondingCurveState;

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump = state.bump,
        constraint = mint.key() == state.mint @ NebulaError::InvalidAmount
    )]
    pub state: Account<'info, BondingCurveState>,

    #[account(constraint = mint.key() == state.mint @ NebulaError::InvalidAmount)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = token_vault.mint == state.mint @ NebulaError::InvalidAmount,
        constraint = token_vault.owner == state.key() @ NebulaError::InvalidAmount
    )]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.mint == state.mint @ NebulaError::InvalidAmount,
        constraint = seller_token_account.owner == seller.key() @ NebulaError::InvalidAmount
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: SOL reserve PDA controlled by the program.
    #[account(mut, seeds = [b"sol_reserve", mint.key().as_ref()], bump)]
    pub sol_reserve: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SellParams {
    pub nbr_amount: u64,
    pub min_sol_received: u64,
}

pub fn handler(ctx: Context<Sell>, params: SellParams) -> Result<()> {
    let state = &mut ctx.accounts.state;

    if params.nbr_amount == 0 || params.nbr_amount > state.sold_supply {
        return Err(NebulaError::InvalidAmount.into());
    }

    let sol_return = sell_return(state.sold_supply, params.nbr_amount)?;
    if sol_return < params.min_sol_received {
        return Err(NebulaError::SlippageExceeded.into());
    }

    // The reserve must stay rent-exempt after paying out, otherwise the account
    // could be purged and future sellers could not be paid.
    let rent_minimum = Rent::get()?.minimum_balance(0);
    let available = ctx.accounts.sol_reserve.lamports().saturating_sub(rent_minimum);
    if available < sol_return {
        return Err(NebulaError::InsufficientReserve.into());
    }

    // Transfer NBR from seller to token vault first.
    let transfer_token = token::Transfer {
        from: ctx.accounts.seller_token_account.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_token);
    token::transfer(cpi_ctx, params.nbr_amount)?;

    // Transfer SOL from reserve to seller.
    let mint_key = ctx.accounts.mint.key();
    let reserve_bump = ctx.bumps.sol_reserve;
    let seeds: &[&[u8]] = &[b"sol_reserve", mint_key.as_ref(), &[reserve_bump]];
    let signer_seeds = &[seeds];
    let transfer_sol = anchor_lang::system_program::Transfer {
        from: ctx.accounts.sol_reserve.to_account_info(),
        to: ctx.accounts.seller.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        transfer_sol,
        signer_seeds,
    );
    anchor_lang::system_program::transfer(cpi_ctx, sol_return)?;

    state.sold_supply = state
        .sold_supply
        .checked_sub(params.nbr_amount)
        .ok_or(NebulaError::Underflow)?;
    Ok(())
}
