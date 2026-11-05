use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::errors::NebulaError;
use crate::math::curve::buy_cost;
use crate::state::BondingCurveState;

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

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
        constraint = buyer_token_account.mint == state.mint @ NebulaError::InvalidAmount,
        constraint = buyer_token_account.owner == buyer.key() @ NebulaError::InvalidAmount
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: SOL reserve PDA controlled by the program.
    #[account(mut, seeds = [b"sol_reserve", mint.key().as_ref()], bump)]
    pub sol_reserve: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuyParams {
    pub nbr_amount: u64,
    pub max_sol_cost: u64,
}

pub fn handler(ctx: Context<Buy>, params: BuyParams) -> Result<()> {
    let state = &mut ctx.accounts.state;

    if params.nbr_amount == 0 {
        return Err(NebulaError::InvalidAmount.into());
    }

    let new_sold_supply = state
        .sold_supply
        .checked_add(params.nbr_amount)
        .ok_or(NebulaError::Overflow)?;
    if new_sold_supply > state.max_sold_supply {
        return Err(NebulaError::MaxSupplyExceeded.into());
    }

    let cost = buy_cost(state.sold_supply, params.nbr_amount)?;
    if cost > params.max_sol_cost {
        return Err(NebulaError::SlippageExceeded.into());
    }

    // Fail early with a clear error if the vault cannot cover the sale.
    if ctx.accounts.token_vault.amount < params.nbr_amount {
        return Err(NebulaError::InsufficientVault.into());
    }

    // Transfer SOL from buyer to SOL reserve.
    let transfer_sol = anchor_lang::system_program::Transfer {
        from: ctx.accounts.buyer.to_account_info(),
        to: ctx.accounts.sol_reserve.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_sol);
    anchor_lang::system_program::transfer(cpi_ctx, cost)?;

    // Transfer NBR from token vault to buyer.
    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[b"bonding_curve", mint_key.as_ref(), &[state.bump]];
    let signer_seeds = &[seeds];
    let transfer_token = token::Transfer {
        from: ctx.accounts.token_vault.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
        authority: state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_token,
        signer_seeds,
    );
    token::transfer(cpi_ctx, params.nbr_amount)?;

    state.sold_supply = new_sold_supply;
    Ok(())
}
