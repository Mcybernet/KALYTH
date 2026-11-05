import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { PageHeader } from '../components/PageHeader'
import { KLYTH_MINT } from '../lib/curve'

const PROGRAM_ID = new PublicKey('CzAyXzhjECqNBPYMiU7eCVGYZVcc5DQKHXXxV4xGxBSw')
const MINT = KLYTH_MINT
const TOKEN_DECIMALS = 6

const DEPOSIT_TOKENS_DISCRIMINATOR = Buffer.from([176, 83, 229, 18, 191, 143, 176, 150])
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237])

type Check = 'checking' | 'missing' | 'ready'
type Action = 'initialize' | 'vault' | 'reserve' | 'deposit' | null

function toRawAmount(value: string): bigint | null {
  const trimmed = value.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    return null
  }
  const [whole, fraction = ''] = trimmed.split('.')
  const paddedFraction = (fraction + '0'.repeat(TOKEN_DECIMALS)).slice(0, TOKEN_DECIMALS)
  return BigInt(whole || '0') * 10n ** BigInt(TOKEN_DECIMALS) + BigInt(paddedFraction || '0')
}

function formatRawAmount(raw: bigint | null): string {
  if (raw === null) {
    return '—'
  }
  const whole = raw / 10n ** BigInt(TOKEN_DECIMALS)
  const fraction = (raw % 10n ** BigInt(TOKEN_DECIMALS)).toString().padStart(TOKEN_DECIMALS, '0')
  return `${whole.toLocaleString('en-US')}.${fraction.slice(0, 2)}`
}

export function AdminPage() {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const [status, setStatus] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [stateCheck, setStateCheck] = useState<Check>('checking')
  const [vaultCheck, setVaultCheck] = useState<Check>('checking')
  const [reserveCheck, setReserveCheck] = useState<Check>('checking')
  const [stateSize, setStateSize] = useState<number | null>(null)
  const [stateAuthority, setStateAuthority] = useState<string | null>(null)
  const [vaultAmount, setVaultAmount] = useState<bigint | null>(null)
  const [authorityAmount, setAuthorityAmount] = useState<bigint | null>(null)
  const [depositInput, setDepositInput] = useState('')

  const statePda = useMemo(
    () =>
      PublicKey.findProgramAddressSync(
        [Buffer.from('bonding_curve'), MINT.toBuffer()],
        PROGRAM_ID,
      )[0],
    [],
  )

  const reservePda = useMemo(
    () =>
      PublicKey.findProgramAddressSync(
        [Buffer.from('sol_reserve'), MINT.toBuffer()],
        PROGRAM_ID,
      )[0],
    [],
  )

  const vaultPda = useMemo(() => getAssociatedTokenAddressSync(MINT, statePda, true), [statePda])

  const authorityPda = useMemo(
    () => (publicKey ? getAssociatedTokenAddressSync(MINT, publicKey) : null),
    [publicKey],
  )

  const refresh = useCallback(async () => {
    setStateCheck('checking')
    setVaultCheck('checking')
    setReserveCheck('checking')
    try {
      const [state, vault, reserve, authorityAta] = await Promise.all([
        connection.getAccountInfo(statePda, 'confirmed'),
        connection.getAccountInfo(vaultPda, 'confirmed'),
        connection.getAccountInfo(reservePda, 'confirmed'),
        authorityPda ? connection.getAccountInfo(authorityPda, 'confirmed') : Promise.resolve(null),
      ])
      setStateSize(state?.data.length ?? null)
      setStateAuthority(state ? new PublicKey(state.data.subarray(8, 40)).toBase58() : null)
      setStateCheck(state ? 'ready' : 'missing')
      setVaultCheck(vault ? 'ready' : 'missing')
      setReserveCheck(reserve ? 'ready' : 'missing')
      setVaultAmount(vault ? vault.data.readBigUInt64LE(64) : null)
      setAuthorityAmount(authorityAta ? authorityAta.data.readBigUInt64LE(64) : null)
    } catch {
      setStateCheck('missing')
      setVaultCheck('missing')
      setReserveCheck('missing')
    }
  }, [connection, statePda, vaultPda, reservePda, authorityPda])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = async (instructions: TransactionInstruction[]): Promise<string> => {
    if (!publicKey || !signTransaction) {
      throw new Error('Connect a wallet first.')
    }
    const tx = new Transaction().add(...instructions)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    tx.recentBlockhash = blockhash
    tx.feePayer = publicKey
    const signed = await signTransaction(tx)
    const signature = await connection.sendRawTransaction(signed.serialize())
    setStatus(`Sent: ${signature}`)
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    )
    return signature
  }

  const run = async (kind: Action, label: string, build: () => Promise<TransactionInstruction[]>) => {
    setAction(kind)
    setStatus(`Preparing ${label}…`)
    try {
      const signature = await send(await build())
      setStatus(`Confirmed ${label}: ${signature}`)
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed`)
    } finally {
      setAction(null)
    }
  }

  const handleInitialize = () =>
    run('initialize', 'initialize', async () => {
      if (!publicKey) {
        throw new Error('Connect a wallet first.')
      }
      const buf = Buffer.alloc(8 + 16 + 16 + 8)
      let off = 0
      INITIALIZE_DISCRIMINATOR.copy(buf, off)
      off += 8
      const ip = BigInt('1000000000000000')
      buf.writeBigUInt64LE(ip & BigInt('0xffffffffffffffff'), off)
      off += 8
      buf.writeBigUInt64LE(ip >> BigInt(64), off)
      off += 8
      const slope = BigInt(80)
      buf.writeBigUInt64LE(slope & BigInt('0xffffffffffffffff'), off)
      off += 8
      buf.writeBigUInt64LE(slope >> BigInt(64), off)
      off += 8
      buf.writeBigUInt64LE(BigInt('50000000000000'), off)

      return [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: statePda, isSigner: false, isWritable: true },
            { pubkey: MINT, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: buf,
        }),
      ]
    })

  const handleCreateVault = () =>
    run('vault', 'token vault', async () => {
      if (!publicKey) {
        throw new Error('Connect a wallet first.')
      }
      return [createAssociatedTokenAccountInstruction(publicKey, vaultPda, statePda, MINT)]
    })

  const handleFundReserve = () =>
    run('reserve', 'SOL reserve', async () => {
      if (!publicKey) {
        throw new Error('Connect a wallet first.')
      }
      const lamports = await connection.getMinimumBalanceForRentExemption(0)
      return [
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: reservePda,
          lamports,
        }),
      ]
    })

  const rawDeposit = toRawAmount(depositInput)
  const depositBlockedReason = !publicKey
    ? 'Connect the authority wallet to deposit.'
    : stateCheck !== 'ready'
      ? 'Initialize the state PDA first.'
      : publicKey.toBase58() !== stateAuthority
        ? `Only the authority wallet (${stateAuthority ?? 'unknown'}) can deposit.`
        : vaultCheck !== 'ready'
          ? 'Create the token vault first.'
          : !authorityPda
            ? 'No token account found for this wallet.'
            : rawDeposit === null || rawDeposit === 0n
              ? 'Enter an amount greater than zero.'
              : authorityAmount !== null && rawDeposit > authorityAmount
                ? 'Amount exceeds your token balance.'
                : null

  const handleDeposit = () =>
    run('deposit', 'token deposit', async () => {
      if (!publicKey || !authorityPda) {
        throw new Error('Connect the authority wallet first.')
      }
      if (rawDeposit === null || rawDeposit === 0n) {
        throw new Error('Enter an amount greater than zero.')
      }
      const buf = Buffer.alloc(8 + 8)
      DEPOSIT_TOKENS_DISCRIMINATOR.copy(buf, 0)
      buf.writeBigUInt64LE(rawDeposit, 8)

      return [
        new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: statePda, isSigner: false, isWritable: true },
            { pubkey: MINT, isSigner: false, isWritable: false },
            { pubkey: authorityPda, isSigner: false, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: buf,
        }),
      ]
    })

  const rows: Array<{
    title: string
    description: string
    address: string
    check: Check
    kind: Action
    label: string
    doneLabel: string
    onRun: () => Promise<void>
  }> = [
    {
      title: 'State PDA',
      description: 'Bonding curve state account (185 bytes).',
      address:
        statePda.toBase58() +
        (stateCheck === 'ready' && stateSize !== null ? ` · ${stateSize} bytes` : ''),
      check: stateCheck,
      kind: 'initialize',
      label: 'Initialize State',
      doneLabel: 'State ready',
      onRun: handleInitialize,
    },
    {
      title: 'Token Vault',
      description: 'Token account owned by the State PDA; holds KLYTH for buyers.',
      address: vaultPda.toBase58(),
      check: vaultCheck,
      kind: 'vault',
      label: 'Create Token Vault',
      doneLabel: 'Vault ready',
      onRun: handleCreateVault,
    },
    {
      title: 'SOL Reserve',
      description: 'PDA that holds buyer SOL and pays sellers. Funded rent-exempt.',
      address: reservePda.toBase58(),
      check: reserveCheck,
      kind: 'reserve',
      label: 'Create SOL Reserve',
      doneLabel: 'Reserve ready',
      onRun: handleFundReserve,
    },
  ]

  return (
    <div className="page-section">
      <PageHeader
        kicker="Admin · Devnet"
        title="Program setup"
        description="Prepare the bonding curve accounts. Each step needs a wallet with SOL and is only available while its target account is still missing."
        actions={<span className="badge badge--warning">Operator only</span>}
      />

      <section className="card card--glow">
        <h2>Bootstrap accounts</h2>
        <p className="page-section__text">
          Each action below sends a real Devnet transaction and is disabled once its target
          account already exists.
        </p>
        <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          {rows.map((row) => {
            const busy = action === row.kind
            const disabled = action !== null || row.check !== 'missing'
            return (
              <div key={row.title}>
                <h3 style={{ marginBottom: 'var(--space-2)' }}>{row.title}</h3>
                <p className="page-section__text">{row.description}</p>
                <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
                  {row.address} ·{' '}
                  {row.check === 'ready' ? 'exists' : row.check === 'missing' ? 'missing' : 'checking…'}
                </p>
                <div className="ds-row" style={{ marginTop: 'var(--space-3)' }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void row.onRun()}
                    disabled={disabled}
                  >
                    {busy ? 'Processing…' : row.check === 'ready' ? row.doneLabel : row.label}
                  </button>
                </div>
              </div>
            )
          })}

          <div>
            <h3 style={{ marginBottom: 'var(--space-2)' }}>Deposit KLYTH</h3>
            <p className="page-section__text">
              Move KLYTH from the authority wallet into the vault so buyers can be served.
            </p>
            <div className="field" style={{ marginTop: 'var(--space-3)' }}>
              <label className="field__label" htmlFor="deposit-amount">
                Amount
              </label>
              <div className="input-wrap">
                <input
                  className="input"
                  id="deposit-amount"
                  inputMode="decimal"
                  value={depositInput}
                  onChange={(event) => setDepositInput(event.target.value)}
                />
                <span className="input-wrap__suffix">KLYTH</span>
              </div>
              <span className="field__hint">
                Vault: {formatRawAmount(vaultAmount)} KLYTH · Your wallet: {formatRawAmount(authorityAmount)} KLYTH
              </span>
            </div>
            <div className="ds-row" style={{ marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleDeposit()}
                disabled={action !== null || depositBlockedReason !== null}
              >
                {action === 'deposit' ? 'Processing…' : 'Deposit KLYTH'}
              </button>
            </div>
            {depositBlockedReason ? (
              <p className="data-meta" style={{ marginTop: 'var(--space-2)' }}>
                {depositBlockedReason}
              </p>
            ) : null}
          </div>
        </div>
        {status ? <p className="data-meta" style={{ marginTop: 'var(--space-4)' }}>{status}</p> : null}
      </section>
    </div>
  )
}
