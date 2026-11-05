import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'

export const PROGRAM_ID = new PublicKey('CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw')
export const KLYTH_MINT = new PublicKey('4MUt8MMxTDYvd35zTnysuJXt29xg5MH7Kb65sB73sN2W')

export const KLYTH_DECIMALS = 6
export const SOL_DECIMALS = 9

export const PRICE_SCALE = 10n ** 18n
export const INITIAL_PRICE_SCALED = 10n ** 15n
export const SLOPE_SCALED = 80n

/**
 * The program stores price as a scaled integer per raw token unit.
 * These divisors convert the on-chain values into SOL per whole KLYTH.
 */
export const INITIAL_PRICE_DIVISOR = 1e21
export const SLOPE_DIVISOR = 1e15

const STATE_SEED = 'bonding_curve'
const RESERVE_SEED = 'sol_reserve'
const BURN_AUTHORITY_SEED = 'burn_authority'
const BURN_STATE_SEED = 'burn_state'

export const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234])
export const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173])

const STATE_ACCOUNT_SIZE = 185

export type CurveState = {
  address: string
  authority: string
  mint: string
  initialPrice: bigint
  slope: bigint
  soldSupply: bigint
  maxSoldSupply: bigint
  bump: number
}

export function getStateAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(STATE_SEED), KLYTH_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getReserveAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(RESERVE_SEED), KLYTH_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getVaultAddress(): PublicKey {
  return getAssociatedTokenAddressSync(KLYTH_MINT, getStateAddress(), true)
}

export function getBurnAuthorityAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BURN_AUTHORITY_SEED), KLYTH_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getBurnStateAddress(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BURN_STATE_SEED), KLYTH_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getBurnReserveAddress(): PublicKey {
  return getAssociatedTokenAddressSync(
    KLYTH_MINT,
    getBurnAuthorityAddress(),
    true,
  )
}

export function getTokenAccountAddress(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(KLYTH_MINT, owner)
}

function readU128LE(data: Buffer, offset: number): bigint {
  const low = data.readBigUInt64LE(offset)
  const high = data.readBigUInt64LE(offset + 8)
  return low | (high << 64n)
}

export async function fetchCurveState(connection: Connection): Promise<CurveState | null> {
  const info = await connection.getAccountInfo(getStateAddress(), 'confirmed')
  if (!info || info.data.length < STATE_ACCOUNT_SIZE) {
    return null
  }
  const data = info.data
  return {
    address: getStateAddress().toBase58(),
    authority: new PublicKey(data.subarray(8, 40)).toBase58(),
    mint: new PublicKey(data.subarray(40, 72)).toBase58(),
    initialPrice: readU128LE(data, 136),
    slope: readU128LE(data, 152),
    soldSupply: data.readBigUInt64LE(168),
    maxSoldSupply: data.readBigUInt64LE(176),
    bump: data[184],
  }
}

export async function fetchVaultAmount(connection: Connection): Promise<bigint | null> {
  const info = await connection.getAccountInfo(getVaultAddress(), 'confirmed')
  if (!info) {
    return null
  }
  return info.data.readBigUInt64LE(64)
}

export async function fetchReserveLamports(connection: Connection): Promise<bigint> {
  const lamports = await connection.getBalance(getReserveAddress(), 'confirmed')
  return BigInt(lamports)
}

/** Marginal price of one whole KLYTH, in SOL. */
export function marginalPriceSol(soldSupply: bigint): number {
  const scaled = INITIAL_PRICE_SCALED + SLOPE_SCALED * soldSupply
  return Number(scaled) / 1e21
}

/** Total lamports required to buy `nbrAmount` raw KLYTH units. Mirrors the on-chain math. */
export function quoteBuyCost(soldSupply: bigint, nbrAmount: bigint): bigint {
  const slopeTerm = (SLOPE_SCALED * ((soldSupply + nbrAmount) ** 2n - soldSupply ** 2n)) / 2n
  return (INITIAL_PRICE_SCALED * nbrAmount + slopeTerm) / PRICE_SCALE
}

/** Lamports returned for selling `nbrAmount` raw KLYTH units. Mirrors the on-chain math. */
export function quoteSellReturn(soldSupply: bigint, nbrAmount: bigint): bigint {
  if (nbrAmount === 0n || nbrAmount > soldSupply) {
    return 0n
  }
  const slopeTerm = (SLOPE_SCALED * (soldSupply ** 2n - (soldSupply - nbrAmount) ** 2n)) / 2n
  return (INITIAL_PRICE_SCALED * nbrAmount + slopeTerm) / PRICE_SCALE
}

function bigintSqrt(value: bigint): bigint {
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

/** Largest KLYTH amount (raw units) whose total cost fits inside `lamports`. */
export function quoteNbrForSol(soldSupply: bigint, lamports: bigint): bigint {
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

export function buildBuyInstruction(
  buyer: PublicKey,
  nbrAmount: bigint,
  maxSolCost: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8 + 8)
  BUY_DISCRIMINATOR.copy(data, 0)
  data.writeBigUInt64LE(nbrAmount, 8)
  data.writeBigUInt64LE(maxSolCost, 16)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: getStateAddress(), isSigner: false, isWritable: true },
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

export function buildSellInstruction(
  seller: PublicKey,
  nbrAmount: bigint,
  minSolReceived: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(8 + 8 + 8)
  SELL_DISCRIMINATOR.copy(data, 0)
  data.writeBigUInt64LE(nbrAmount, 8)
  data.writeBigUInt64LE(minSolReceived, 16)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: getStateAddress(), isSigner: false, isWritable: true },
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

export function buildCreateBuyerTokenAccountInstruction(buyer: PublicKey): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    buyer,
    getTokenAccountAddress(buyer),
    buyer,
    KLYTH_MINT,
  )
}

export function parseDecimal(value: string, decimals: number): bigint | null {
  const trimmed = value.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    return null
  }
  const [whole = '', fraction = ''] = trimmed.split('.')
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

export function formatRaw(raw: bigint, decimals: number, maxFractionDigits: number): string {
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

export function formatNbr(raw: bigint, maxFractionDigits = 2): string {
  return formatRaw(raw, KLYTH_DECIMALS, maxFractionDigits)
}

export function formatSol(lamports: bigint, maxFractionDigits = 6): string {
  return formatRaw(lamports, SOL_DECIMALS, maxFractionDigits)
}

export function formatSolPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 6,
    maximumFractionDigits: 9,
  })
}
