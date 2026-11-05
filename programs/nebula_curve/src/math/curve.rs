use crate::errors::NebulaError;

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
