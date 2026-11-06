/**
 * Shared helpers for the Devnet demo trader.
 *
 * The demo trader is deliberately separate from the burn crank: it only moves
 * its own Devnet SOL/KLYTH and never touches the curve reserve or burn reserve
 * directly. Everything here mirrors the on-chain instruction layout used by
 * `app/frontend/src/lib/curve.ts`.
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  KLYTH_MINT,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTokenAccount,
  formatNbr,
  getCurveStateAddress,
} from './burn-common.mjs'

export const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234])
export const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173])

export const PRICE_SCALE = 10n ** 18n
export const INITIAL_PRICE_SCALED = 10n ** 15n
export const SLOPE_SCALED = 80n

export const KLYTH_DECIMALS = 6
export const SOL_DECIMALS = 9
export const KLYTH_BASE = 10n ** BigInt(KLYTH_DECIMALS)

function readU128LE(data, offset) {
  const low = data.readBigUInt64LE(offset)
  const high = data.readBigUInt64LE(offset + 8)
  return low | (high << 64n)
}

export function getReserveAddress() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('sol_reserve'), KLYTH_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getVaultAddress() {
  return getAssociatedTokenAddressSync(KLYTH_MINT, getCurveStateAddress(), true)
}

export function getTokenAccountAddress(owner) {
  return getAssociatedTokenAddressSync(KLYTH_MINT, owner)
}

export function decodeCurveState(data) {
  if (data.length < 185) {
    throw new Error(`Bonding curve account is ${data.length} bytes, expected 185`)
  }

  return {
    // The program stores `Pubkey::default()` for these two fields and derives
    // the real addresses at instruction time, so use the derived values.
    address: getCurveStateAddress().toBase58(),
    authority: new PublicKey(data.subarray(8, 40)),
    mint: new PublicKey(data.subarray(40, 72)),
    tokenVault: getVaultAddress(),
    solReserve: getReserveAddress(),
    initialPrice: readU128LE(data, 136),
    slope: readU128LE(data, 152),
    soldSupply: data.readBigUInt64LE(168),
    maxSoldSupply: data.readBigUInt64LE(176),
    bump: data[184],
  }
}

export function decodeTokenBalance(data) {
  return decodeTokenAccount(data).amount
}

/** Total lamports required to buy `amountRaw` KLYTH. Mirrors the on-chain math. */
export function quoteBuyCost(soldSupply, amountRaw) {
  const slopeTerm =
    (SLOPE_SCALED *
      ((soldSupply + amountRaw) ** 2n - soldSupply ** 2n)) /
    2n
  return (INITIAL_PRICE_SCALED * amountRaw + slopeTerm) / PRICE_SCALE
}

/** Lamports returned for selling `amountRaw` KLYTH. Mirrors the on-chain math. */
export function quoteSellReturn(soldSupply, amountRaw) {
  if (amountRaw === 0n || amountRaw > soldSupply) {
    return 0n
  }
  const slopeTerm =
    (SLOPE_SCALED *
      (soldSupply ** 2n - (soldSupply - amountRaw) ** 2n)) /
    2n
  return (INITIAL_PRICE_SCALED * amountRaw + slopeTerm) / PRICE_SCALE
}

function bigintSqrt(value) {
  if (value < 2n) {
    return value
  }
  let current = value
  let next = (current + value / current) / 2n
  while (next < current) {
    current = next
    next = (current + value / current) / 2n
  }
  return current
}

/** Largest KLYTH amount whose total cost fits inside `lamports`. */
export function quoteNbrForSol(soldSupply, lamports) {
  if (lamports <= 0n) {
    return 0n
  }

  const linear = INITIAL_PRICE_SCALED + SLOPE_SCALED * soldSupply
  const discriminant = linear ** 2n + 2n * SLOPE_SCALED * lamports * PRICE_SCALE
  const root = bigintSqrt(discriminant)

  let amount = (root - linear) / SLOPE_SCALED
  if (amount < 0n) {
    amount = 0n
  }

  let guard = 0
  while (amount > 0n && quoteBuyCost(soldSupply, amount) > lamports && guard < 10_000) {
    amount -= 1n
    guard += 1
  }
  guard = 0
  while (quoteBuyCost(soldSupply, amount + 1n) <= lamports && guard < 10_000) {
    amount += 1n
    guard += 1
  }

  return amount
}

export function buildBuyInstruction(buyer, amountRaw, maxSolCost) {
  const data = Buffer.alloc(8 + 8 + 8)
  BUY_DISCRIMINATOR.copy(data, 0)
  data.writeBigUInt64LE(amountRaw, 8)
  data.writeBigUInt64LE(maxSolCost, 16)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: getCurveStateAddress(), isSigner: false, isWritable: true },
      { pubkey: KLYTH_MINT, isSigner: false, isWritable: false },
      { pubkey: getVaultAddress(), isSigner: false, isWritable: true },
      { pubkey: getTokenAccountAddress(buyer), isSigner: false, isWritable: true },
      { pubkey: getReserveAddress(), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

export function buildSellInstruction(seller, amountRaw, minSolReceived) {
  const data = Buffer.alloc(8 + 8 + 8)
  SELL_DISCRIMINATOR.copy(data, 0)
  data.writeBigUInt64LE(amountRaw, 8)
  data.writeBigUInt64LE(minSolReceived, 16)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: getCurveStateAddress(), isSigner: false, isWritable: true },
      { pubkey: KLYTH_MINT, isSigner: false, isWritable: false },
      { pubkey: getVaultAddress(), isSigner: false, isWritable: true },
      { pubkey: getTokenAccountAddress(seller), isSigner: false, isWritable: true },
      { pubkey: getReserveAddress(), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

export function buildCreateAtaInstruction(payer, owner) {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getTokenAccountAddress(owner),
    owner,
    KLYTH_MINT,
  )
}

export function formatSol(lamports, maxFractionDigits = 6) {
  return formatRaw(lamports, SOL_DECIMALS, maxFractionDigits)
}

export function formatRaw(raw, decimals, maxFractionDigits) {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const whole = absolute / base
  const fraction = (absolute % base).toString().padStart(decimals, '0')
  const visibleFraction = fraction
    .slice(0, Math.min(maxFractionDigits, decimals))
    .replace(/0+$/, '')
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${wholeText}${visibleFraction ? `.${visibleFraction}` : ''}`
}

export { formatNbr }
