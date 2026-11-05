use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};
use crate::errors::NebulaError;
use crate::state::{
    BondingCurveState, BurnExecuted, BurnState, BURN_INTERVAL_SECONDS,
};

#[derive(Accounts)]
pub struct InitializeBurn<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"bonding_curve", mint.key().as_ref()],
        bump = curve_state.bump,
        constraint = authority.key() == curve_state.authority @ NebulaError::InvalidAmount
    )]
    pub curve_state: Account<'info, BondingCurveState>,

    #[account(
        init,
        payer = authority,
        space = BurnState::SPACE,
        seeds = [b"burn_state", mint.key().as_ref()],
        bump
    )]
    pub burn_state: Account<'info, BurnState>,

    #[account(constraint = mint.key() == curve_state.mint @ NebulaError::InvalidAmount)]
    pub mint: Account<'info, Mint>,

    /// CHECK: Burn authority PDA. It owns the reserve token account after migration.
    #[account(seeds = [b"burn_authority", mint.key().as_ref()], bump)]
    pub burn_authority: UncheckedAccount<'info>,

    #[account(
        constraint = burn_reserve.mint == mint.key() @ NebulaError::InvalidBurnReserve
    )]
    pub burn_reserve: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeBurnParams {
    pub daily_cap: u64,
}

#[derive(Accounts)]
pub struct BurnDaily<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"burn_state", mint.key().as_ref()],
        bump = burn_state.bump,
        constraint = mint.key() == burn_state.mint @ NebulaError::InvalidAmount,
        constraint = burn_state.burn_authority == burn_authority.key() @ NebulaError::InvalidBurnAuthority
    )]
    pub burn_state: Account<'info, BurnState>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// CHECK: Burn authority PDA that signs the SPL burn via seeds.
    #[account(seeds = [b"burn_authority", mint.key().as_ref()], bump)]
    pub burn_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = burn_reserve.key() == burn_state.burn_reserve @ NebulaError::InvalidBurnReserve,
        constraint = burn_reserve.mint == burn_state.mint @ NebulaError::InvalidBurnReserve,
        constraint = burn_reserve.owner == burn_authority.key() @ NebulaError::InvalidBurnAuthority
    )]
    pub burn_reserve: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn initialize_burn_handler(
    ctx: Context<InitializeBurn>,
    params: InitializeBurnParams,
) -> Result<()> {
    if params.daily_cap == 0 {
        return Err(NebulaError::InvalidAmount.into());
    }

    let burn_state = &mut ctx.accounts.burn_state;
    burn_state.mint = ctx.accounts.mint.key();
    burn_state.burn_authority = ctx.accounts.burn_authority.key();
    burn_state.burn_reserve = ctx.accounts.burn_reserve.key();
    burn_state.daily_cap = params.daily_cap;
    burn_state.total_burned = 0;
    burn_state.burn_count = 0;
    burn_state.last_burn_ts = 0;
    burn_state.bump = ctx.bumps.burn_state;
    burn_state.authority_bump = ctx.bumps.burn_authority;
    Ok(())
}

/// Permissionless. Burns `min(daily_cap, reserve balance)` at most once per
/// 23h50m window. The caller only pays the transaction fee.
pub fn burn_daily_handler(ctx: Context<BurnDaily>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let reserve_amount = ctx.accounts.burn_reserve.amount;
    let authority_bump = ctx.bumps.burn_authority;
    let mint_key = ctx.accounts.mint.key();

    let burn_state = &mut ctx.accounts.burn_state;

    if burn_state.last_burn_ts != 0 {
        let elapsed = now
            .checked_sub(burn_state.last_burn_ts)
            .ok_or(NebulaError::Overflow)?;
        if elapsed < BURN_INTERVAL_SECONDS {
            return Err(NebulaError::BurnNotReady.into());
        }
    }

    let amount = burn_state.daily_cap.min(reserve_amount);
    if amount == 0 {
        return Err(NebulaError::NothingToBurn.into());
    }

    let seeds: &[&[u8]] = &[b"burn_authority", mint_key.as_ref(), &[authority_bump]];
    let signer_seeds = &[seeds];
    let cpi_accounts = Burn {
        mint: ctx.accounts.mint.to_account_info(),
        from: ctx.accounts.burn_reserve.to_account_info(),
        authority: ctx.accounts.burn_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::burn(cpi_ctx, amount)?;

    burn_state.total_burned = burn_state
        .total_burned
        .checked_add(amount)
        .ok_or(NebulaError::Overflow)?;
    burn_state.burn_count = burn_state
        .burn_count
        .checked_add(1)
        .ok_or(NebulaError::Overflow)?;
    burn_state.last_burn_ts = now;

    emit!(BurnExecuted {
        mint: mint_key,
        amount,
        total_burned: burn_state.total_burned,
        burn_count: burn_state.burn_count,
        timestamp: now,
    });

    Ok(())
}
