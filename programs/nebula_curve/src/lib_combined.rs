use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

declare_id!("CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw");

#[program]
pub mod nebula_curve {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
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

    pub fn buy(ctx: Context<Buy>, params: BuyParams) -> Result<()> {
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

        let cost = math::buy_cost(state.sold_supply, params.nbr_amount)?;
        if cost > params.max_sol_cost {
            return Err(NebulaError::SlippageExceeded.into());
        }

        // Fail early with a clear error if the vault cannot cover the sale.
        if ctx.accounts.token_vault.amount < params.nbr_amount {
            return Err(NebulaError::InsufficientVault.into());
        }

        let transfer_sol = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.sol_reserve.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), transfer_sol);
        anchor_lang::system_program::transfer(cpi_ctx, cost)?;

        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[b"bonding_curve", mint_key.as_ref(), &[state.bump]];
        let signer_seeds = &[seeds];
        let transfer_token = anchor_spl::token::Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_token,
            signer_seeds,
        );
        anchor_spl::token::transfer(cpi_ctx, params.nbr_amount)?;

        state.sold_supply = new_sold_supply;
        Ok(())
    }

    pub fn sell(ctx: Context<Sell>, params: SellParams) -> Result<()> {
        let state = &mut ctx.accounts.state;

        if params.nbr_amount == 0 || params.nbr_amount > state.sold_supply {
            return Err(NebulaError::InvalidAmount.into());
        }

        let sol_return = math::sell_return(state.sold_supply, params.nbr_amount)?;
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

        let transfer_token = anchor_spl::token::Transfer {
            from: ctx.accounts.seller_token_account.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.seller.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_token);
        anchor_spl::token::transfer(cpi_ctx, params.nbr_amount)?;

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

    pub fn deposit_sol(ctx: Context<DepositSol>, params: DepositSolParams) -> Result<()> {
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

    pub fn deposit_tokens(ctx: Context<DepositTokens>, params: DepositTokensParams) -> Result<()> {
        if params.amount == 0 {
            return Err(NebulaError::InvalidAmount.into());
        }

        let transfer_token = anchor_spl::token::Transfer {
            from: ctx.accounts.authority_token_account.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_token);
        anchor_spl::token::transfer(cpi_ctx, params.amount)?;
        Ok(())
    }

    pub fn initialize_burn(
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
    pub fn burn_daily(ctx: Context<BurnDaily>) -> Result<()> {
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
        let cpi_accounts = anchor_spl::token::Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.burn_reserve.to_account_info(),
            authority: ctx.accounts.burn_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_spl::token::burn(cpi_ctx, amount)?;

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
}

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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BuyParams {
    pub nbr_amount: u64,
    pub max_sol_cost: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SellParams {
    pub nbr_amount: u64,
    pub min_sol_received: u64,
}

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
    pub token_vault: Account<'info, anchor_spl::token::TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.mint == state.mint @ NebulaError::InvalidAmount,
        constraint = seller_token_account.owner == seller.key() @ NebulaError::InvalidAmount
    )]
    pub seller_token_account: Account<'info, anchor_spl::token::TokenAccount>,

    /// CHECK: SOL reserve PDA controlled by the program.
    #[account(mut, seeds = [b"sol_reserve", mint.key().as_ref()], bump)]
    pub sol_reserve: UncheckedAccount<'info>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

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
    pub token_vault: Account<'info, anchor_spl::token::TokenAccount>,

    #[account(
        mut,
        constraint = buyer_token_account.mint == state.mint @ NebulaError::InvalidAmount,
        constraint = buyer_token_account.owner == buyer.key() @ NebulaError::InvalidAmount
    )]
    pub buyer_token_account: Account<'info, anchor_spl::token::TokenAccount>,

    /// CHECK: SOL reserve PDA controlled by the program.
    #[account(mut, seeds = [b"sol_reserve", mint.key().as_ref()], bump)]
    pub sol_reserve: UncheckedAccount<'info>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

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
/// once per UTC day.
pub const BURN_INTERVAL_SECONDS: i64 = 23 * 60 * 60 + 50 * 60;

#[event]
pub struct BurnExecuted {
    pub mint: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
    pub burn_count: u64,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeBurnParams {
    pub daily_cap: u64,
}

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
    pub burn_reserve: Account<'info, anchor_spl::token::TokenAccount>,

    pub system_program: Program<'info, System>,
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
    pub burn_reserve: Account<'info, anchor_spl::token::TokenAccount>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[error_code]
pub enum NebulaError {
    #[msg("Bonding curve is not initialized")]
    NotInitialized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient token vault balance")]
    InsufficientVault,
    #[msg("Insufficient SOL reserve")]
    InsufficientReserve,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Maximum sold supply exceeded")]
    MaxSupplyExceeded,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Arithmetic underflow")]
    Underflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Burn window has not elapsed")]
    BurnNotReady,
    #[msg("Burn reserve is empty")]
    NothingToBurn,
    #[msg("Burn reserve does not match the configured burn state")]
    InvalidBurnReserve,
    #[msg("Burn authority does not match the configured burn state")]
    InvalidBurnAuthority,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositSolParams {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DepositTokensParams {
    pub amount: u64,
}

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
    pub authority_token_account: Account<'info, anchor_spl::token::TokenAccount>,

    #[account(
        mut,
        constraint = token_vault.mint == mint.key() @ NebulaError::InvalidAmount,
        constraint = token_vault.owner == state.key() @ NebulaError::InvalidAmount
    )]
    pub token_vault: Account<'info, anchor_spl::token::TokenAccount>,

    pub token_program: Program<'info, anchor_spl::token::Token>,
}

pub mod math {
    use super::NebulaError;

    pub const PRICE_SCALE: u128 = 1_000_000_000_000_000_000;
    pub const INITIAL_PRICE_SCALED: u128 = 1_000_000_000_000_000;
    pub const SLOPE_SCALED: u128 = 80;

    pub fn marginal_price_scaled(sold_supply: u64) -> u128 {
        INITIAL_PRICE_SCALED + SLOPE_SCALED * sold_supply as u128
    }

    pub fn buy_cost(sold_supply: u64, quantity: u64) -> Result<u64, NebulaError> {
        if quantity == 0 {
            return Err(NebulaError::InvalidAmount);
        }

        let x = sold_supply as u128;
        let q = quantity as u128;

        let x_squared = x.checked_mul(x).ok_or(NebulaError::Overflow)?;
        let new_x = x.checked_add(q).ok_or(NebulaError::Overflow)?;
        let new_x_squared = new_x.checked_mul(new_x).ok_or(NebulaError::Overflow)?;
        let squared_diff = new_x_squared
            .checked_sub(x_squared)
            .ok_or(NebulaError::Underflow)?;
        let slope_term = SLOPE_SCALED
            .checked_mul(squared_diff)
            .ok_or(NebulaError::Overflow)?
            .checked_div(2)
            .ok_or(NebulaError::DivisionByZero)?;
        let price_term = INITIAL_PRICE_SCALED
            .checked_mul(q)
            .ok_or(NebulaError::Overflow)?;
        let cost_scaled = price_term
            .checked_add(slope_term)
            .ok_or(NebulaError::Overflow)?;

        Ok((cost_scaled / PRICE_SCALE) as u64)
    }

    pub fn sell_return(sold_supply: u64, quantity: u64) -> Result<u64, NebulaError> {
        if quantity == 0 || quantity > sold_supply {
            return Err(NebulaError::InvalidAmount);
        }

        let x = sold_supply as u128;
        let q = quantity as u128;

        let x_squared = x.checked_mul(x).ok_or(NebulaError::Overflow)?;
        let new_x = x.checked_sub(q).ok_or(NebulaError::Underflow)?;
        let new_x_squared = new_x.checked_mul(new_x).ok_or(NebulaError::Overflow)?;
        let squared_diff = x_squared
            .checked_sub(new_x_squared)
            .ok_or(NebulaError::Underflow)?;
        let slope_term = SLOPE_SCALED
            .checked_mul(squared_diff)
            .ok_or(NebulaError::Overflow)?
            .checked_div(2)
            .ok_or(NebulaError::DivisionByZero)?;
        let price_term = INITIAL_PRICE_SCALED
            .checked_mul(q)
            .ok_or(NebulaError::Overflow)?;
        let return_scaled = price_term
            .checked_add(slope_term)
            .ok_or(NebulaError::Overflow)?;

        Ok((return_scaled / PRICE_SCALE) as u64)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn marginal_price_at_zero() {
            assert_eq!(marginal_price_scaled(0), INITIAL_PRICE_SCALED);
        }

        #[test]
        fn buy_cost_is_positive() {
            let cost = buy_cost(0, 1_000_000).unwrap();
            assert!(cost > 0);
        }

        #[test]
        fn sell_cannot_exceed_sold_supply() {
            assert!(sell_return(100, 200).is_err());
        }

        #[test]
        fn buy_then_sell_round_trip_is_consistent() {
            let sold = 1_000_000u64;
            let qty = 500_000u64;
            let cost = buy_cost(sold, qty).unwrap();
            let returned = sell_return(sold + qty, qty).unwrap();
            assert!(cost >= returned);
        }
    }
}
