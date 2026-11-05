use anchor_lang::prelude::*;

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
