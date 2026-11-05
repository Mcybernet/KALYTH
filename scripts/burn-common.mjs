import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import bs58 from 'bs58'

function loadLocalEnv() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env')
    if (!fs.existsSync(file)) {
      return
    }

    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const separator = trimmed.indexOf('=')
      if (separator === -1) {
        continue
      }
      const key = trimmed.slice(0, separator).trim()
      let value = trimmed.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // A malformed local .env must not break CI, which uses real env vars.
  }
}

loadLocalEnv()

export const PROGRAM_ID = new PublicKey(
  'CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw',
)
export const KLYTH_MINT = new PublicKey(
  '4MUt8MMxTDYvd35zTnysuJXt29xg5MH7Kb65sB73sN2W',
)
/** Backwards-compatible alias while scripts migrate to the KLYTH name. */
export const NBR_MINT = KLYTH_MINT
export const BURN_RESERVE_TOKEN_ACCOUNT = new PublicKey(
  '6qV86Gd5SQ1YGn3TJCgXwZhmSz8m6PxDJSbL7at1Ra9v',
)
export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
)

/** 800,000 KLYTH at 6 decimals (50 burns bring supply from 100M to 60M). */
export const DAILY_CAP_RAW = 800_000n * 1_000_000n
/** 23h50m: a small grace so a daily cron cannot skip a day on jitter. */
export const BURN_INTERVAL_SECONDS = 23n * 60n * 60n + 50n * 60n

const STATE_SEED = Buffer.from('bonding_curve')
const BURN_STATE_SEED = Buffer.from('burn_state')
const BURN_AUTHORITY_SEED = Buffer.from('burn_authority')

export function anchorDiscriminator(name) {
  return createHash('sha256')
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8)
}

export function accountDiscriminator(name) {
  return createHash('sha256')
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8)
}

export function getCurveStateAddress() {
  return PublicKey.findProgramAddressSync(
    [STATE_SEED, NBR_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getBurnStateAddress() {
  return PublicKey.findProgramAddressSync(
    [BURN_STATE_SEED, NBR_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function getBurnAuthorityAddress() {
  return PublicKey.findProgramAddressSync(
    [BURN_AUTHORITY_SEED, NBR_MINT.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export function connectionFromEnv() {
  return new Connection(
    process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    'confirmed',
  )
}

/**
 * Accepts a path to a Solana keypair JSON file, an inline JSON array, or a
 * base58 secret key. The value is only read at runtime; never commit it.
 */
export function loadKeypair(value, label) {
  if (!value || !value.trim()) {
    throw new Error(`${label} is not set`)
  }

  const trimmed = value.trim()

  try {
    if (trimmed.startsWith('[')) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)))
    }

    if (fs.existsSync(trimmed)) {
      const raw = JSON.parse(fs.readFileSync(trimmed, 'utf8'))
      return Keypair.fromSecretKey(Uint8Array.from(raw))
    }

    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch (cause) {
    throw new Error(`Could not load ${label}: ${cause.message}`)
  }
}

export function createInitializeBurnInstruction(authority, dailyCapRaw) {
  const data = Buffer.alloc(8 + 8)
  anchorDiscriminator('initialize_burn').copy(data, 0)
  data.writeBigUInt64LE(dailyCapRaw, 8)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: getCurveStateAddress(), isSigner: false, isWritable: false },
      { pubkey: getBurnStateAddress(), isSigner: false, isWritable: true },
      { pubkey: NBR_MINT, isSigner: false, isWritable: false },
      { pubkey: getBurnAuthorityAddress(), isSigner: false, isWritable: false },
      {
        pubkey: BURN_RESERVE_TOKEN_ACCOUNT,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

export function createBurnDailyInstruction(cranker) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: cranker, isSigner: true, isWritable: true },
      { pubkey: getBurnStateAddress(), isSigner: false, isWritable: true },
      { pubkey: NBR_MINT, isSigner: false, isWritable: true },
      { pubkey: getBurnAuthorityAddress(), isSigner: false, isWritable: false },
      {
        pubkey: BURN_RESERVE_TOKEN_ACCOUNT,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('burn_daily'),
  })
}

export function decodeBurnState(data) {
  if (data.length < 138) {
    throw new Error(`BurnState account is ${data.length} bytes, expected 138`)
  }

  const expected = accountDiscriminator('BurnState')
  if (!data.subarray(0, 8).equals(expected)) {
    throw new Error('Account is not a BurnState (discriminator mismatch)')
  }

  return {
    mint: new PublicKey(data.subarray(8, 40)),
    burnAuthority: new PublicKey(data.subarray(40, 72)),
    burnReserve: new PublicKey(data.subarray(72, 104)),
    dailyCap: data.readBigUInt64LE(104),
    totalBurned: data.readBigUInt64LE(112),
    burnCount: data.readBigUInt64LE(120),
    lastBurnTs: data.readBigInt64LE(128),
    bump: data[136],
    authorityBump: data[137],
  }
}

export function decodeTokenAccount(data) {
  if (data.length < 165) {
    throw new Error(`Token account is ${data.length} bytes, expected 165`)
  }

  return {
    mint: new PublicKey(data.subarray(0, 32)),
    owner: new PublicKey(data.subarray(32, 64)),
    amount: data.readBigUInt64LE(64),
  }
}

export function explorerTxUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}

export function formatNbr(raw) {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const base = 1_000_000n
  const whole = absolute / base
  const fraction = (absolute % base).toString().padStart(6, '0').replace(/0+$/, '')
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${wholeText}${fraction ? `.${fraction}` : ''}`
}
