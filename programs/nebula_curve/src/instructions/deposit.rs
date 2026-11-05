use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use crate::errors::NebulaError;
use crate::state::BondingCurveState;

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump = state.bump,
        constraint = authority.key() == state.authority @ NebulaError::InvalidAmount
    )]
    pub state: Account<'info, BondingCurveState>,

    pub mint: Account<'info, Mint>,

    /// CHECK: SOL reserve PDA controlled by the program.
    #[account(mut, seeds = [b"sol_reserve", mint.key().as_ref()], bump)]
    pub sol_reserve: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump = state.bump,
        constraint = authority.key() == state.authority @ NebulaError::InvalidAmount
    )]
    pub state: Account<'info, BondingCurveState>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = authority_token_account.mint == mint.key() @ NebulaError::InvalidAmount,
        constraint = authority_token_account.owner == authority.key() @ NebulaError::InvalidAmount
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = token_vault.mint == mint.key() @ NebulaError::InvalidAmount,
        constraint = token_vault.owner == state.key() @ NebulaError::InvalidAmount
    )]
    pub token_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositSolParams {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositTokensParams {
    pub amount: u64,
}

pub fn deposit_sol_handler(ctx: Context<DepositSol>, params: DepositSolParams) -> Result<()> {
    if params.amount == 0 {
        return Err(NebulaError::InvalidAmount.into());
    }

    let transfer_sol = anchor_lang::system_program::Transfer {
        from: ctx.accounts.authority.to_account_info(),
        to: ctx.accounts.sol_reserve.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_sol);
    anchor_lang::system_program::transfer(cpi_ctx, params.amount)?;
    Ok(())
}

pub fn deposit_tokens_handler(ctx: Context<DepositTokens>, params: DepositTokensParams) -> Result<()> {
    if params.amount == 0 {
        return Err(NebulaError::InvalidAmount.into());
    }

    let transfer_token = token::Transfer {
        from: ctx.accounts.authority_token_account.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_token);
    token::transfer(cpi_ctx, params.amount)?;
    Ok(())
}
