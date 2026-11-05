use anchor_lang::prelude::*;
use anchor_spl::token::Mint;


declare_id!("11111111111111111111111111111111111111111111");

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
        state.bump = 0;
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
        space = 8 + 32 * 3 + 16 * 2 + 8 * 2 + 1
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

#[error_code]
pub enum NebulaError {
    #[msg("Bonding curve is not initialized")]
    NotInitialized,
}
