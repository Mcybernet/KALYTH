import { Suspense, lazy, useCallback, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { Transaction, type TransactionInstruction } from '@solana/web3.js'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { PageHeader } from '../components/PageHeader'
import { CurveProgress } from '../components/CurveProgress'
import { TransactionStatus, type TransactionStatusState } from '../components/TransactionStatus'
import { useActivity } from '../hooks/useActivity'
import { useCurveState } from '../hooks/useCurveState'
import { useWalletBalances } from '../hooks/useWalletBalances'
import {
  INITIAL_PRICE_DIVISOR,
  KLYTH_DECIMALS,
  SLOPE_DIVISOR,
  buildBuyInstruction,
  buildCreateBuyerTokenAccountInstruction,
  buildSellInstruction,
  formatNbr,
  formatSol,
  formatSolPrice,
  marginalPriceSol,
  parseDecimal,
  quoteBuyCost,
  quoteNbrForSol,
  quoteSellReturn,
} from '../lib/curve'
import { buildExecutionPoints } from '../lib/history'

const BondingCurveChart = lazy(() =>
  import('../components/BondingCurveChart').then((module) => ({
    default: module.BondingCurveChart,
  })),
)

const SLIPPAGE_OPTIONS = [50, 100, 200] as const
const DEFAULT_SLIPPAGE_BPS = 50n
const FEE_BUFFER_LAMPORTS = 3_000_000n
const TOKEN_SCALE = 10n ** BigInt(KLYTH_DECIMALS)

type TradeMode = 'buy' | 'sell'

type PendingTrade =
  | { mode: 'buy'; lamports: bigint; nbrAmount: bigint; maxSolCost: bigint }
  | { mode: 'sell'; nbrAmount: bigint; solReturn: bigint; minSolReceived: bigint }

const statusBadge: Record<TransactionStatusState, string> = {
  idle: 'badge--neutral',
  preparing: 'badge--warning',
  waiting: 'badge--warning',
  processing: 'badge--warning',
  confirmed: 'badge--success',
  failed: 'badge--danger',
}

const statusLabel: Record<TransactionStatusState, string> = {
  idle: 'Idle',
  preparing: 'Preparing',
  waiting: 'Awaiting approval',
  processing: 'Processing',
  confirmed: 'Confirmed',
  failed: 'Failed',
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function describeTrade(trade: PendingTrade): string {
  if (trade.mode === 'buy') {
    return `Spend at most ${formatSol(trade.maxSolCost)} SOL to receive at least ${formatNbr(
      trade.nbrAmount,
    )} KLYTH. Network fees and a one-time token account rent may apply.`
  }
  return `Sell ${formatNbr(trade.nbrAmount)} KLYTH for at least ${formatSol(trade.minSolReceived)} SOL. The transaction fails if the reserve cannot cover it.`
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/user rejected|rejected the request|request rejected/i.test(message)) {
    return 'Transaction cancelled in wallet.'
  }

  const codes: Record<string, string> = {
    '0x1770': 'Bonding curve is not initialized.',
    '0x1771': 'Invalid amount.',
    '0x1772': 'Token vault balance is insufficient.',
    '0x1773': 'SOL reserve balance is insufficient.',
    '0x1774': 'Slippage exceeded — the price moved. Try again.',
    '0x1775': 'Maximum sold supply exceeded.',
  }

  for (const [code, text] of Object.entries(codes)) {
    if (message.includes(code)) {
      return text
    }
  }

  return message
}

function computeImpact(
  lamports: bigint | null,
  nbrRaw: bigint | null,
  marginal: number | null,
): number | null {
  if (lamports === null || nbrRaw === null || nbrRaw === 0n || marginal === null || marginal <= 0) {
    return null
  }
  const executionPrice = Number(lamports) / Number(nbrRaw) / 1_000
  return (executionPrice / marginal - 1) * 100
}

function formatImpact(impact: number | null): string {
  if (impact === null) {
    return '—'
  }
  return `${impact >= 0 ? '+' : ''}${impact.toFixed(2)}%`
}

export function TradePage() {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const { setVisible: setWalletModalVisible } = useWalletModal()
  const curve = useCurveState()
  const balances = useWalletBalances()
  const activity = useActivity({ pageSize: 40 })

  const [mode, setMode] = useState<TradeMode>('buy')
  const [buyInput, setBuyInput] = useState('')
  const [sellInput, setSellInput] = useState('')
  const [slippageBps, setSlippageBps] = useState<bigint>(DEFAULT_SLIPPAGE_BPS)
  const [status, setStatus] = useState<TransactionStatusState>('idle')
  const [statusMessage, setStatusMessage] = useState('No transaction has been submitted yet.')
  const [signature, setSignature] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingTrade | null>(null)
  const [lastTrade, setLastTrade] = useState<PendingTrade | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const state = curve.state
  const soldSupply = state?.soldSupply ?? null
  const maxSoldSupply = state?.maxSoldSupply ?? null
  const marginal = soldSupply !== null ? marginalPriceSol(soldSupply) : null
  const initialPriceSol =
    state !== null ? Number(state.initialPrice) / INITIAL_PRICE_DIVISOR : null
  const slopeSol = state !== null ? Number(state.slope) / SLOPE_DIVISOR : null
  const progress =
    soldSupply !== null && maxSoldSupply !== null && maxSoldSupply > 0n
      ? Number((soldSupply * 10_000n) / maxSoldSupply) / 100
      : null

  const trades = useMemo(
    () => buildExecutionPoints(activity.records, curve.state?.soldSupply ?? null),
    [activity.records, curve.state?.soldSupply],
  )

  const buyLamports = useMemo(() => parseDecimal(buyInput, 9), [buyInput])
  const buyNbrAmount = useMemo(() => {
    if (soldSupply === null || buyLamports === null || buyLamports === 0n) {
      return null
    }
    return quoteNbrForSol(soldSupply, buyLamports)
  }, [soldSupply, buyLamports])
  const buyCost = useMemo(() => {
    if (soldSupply === null || buyNbrAmount === null) {
      return null
    }
    return quoteBuyCost(soldSupply, buyNbrAmount)
  }, [soldSupply, buyNbrAmount])
  const minBuyNbrAmount =
    buyNbrAmount === null ? null : (buyNbrAmount * (10_000n - slippageBps)) / 10_000n

  const sellNbrRaw = useMemo(() => parseDecimal(sellInput, KLYTH_DECIMALS), [sellInput])
  const sellReturn = useMemo(() => {
    if (soldSupply === null || sellNbrRaw === null) {
      return null
    }
    return quoteSellReturn(soldSupply, sellNbrRaw)
  }, [soldSupply, sellNbrRaw])
  const minSolReceived =
    sellReturn === null ? null : (sellReturn * (10_000n - slippageBps)) / 10_000n

  const buyImpact = computeImpact(buyCost, buyNbrAmount, marginal)
  const sellImpact = computeImpact(sellReturn, sellNbrRaw, marginal)

  const previewAmount =
    mode === 'buy'
      ? buyNbrAmount !== null
        ? Number(buyNbrAmount) / Number(TOKEN_SCALE)
        : null
      : sellNbrRaw !== null
        ? Number(sellNbrRaw) / Number(TOKEN_SCALE)
        : null

  const buyBlockedReason = (() => {
    if (curve.loading) {
      return 'Loading bonding curve state…'
    }
    if (curve.error) {
      return `Unable to load curve state: ${curve.error}`
    }
    if (!state) {
      return 'Bonding curve state is not initialized.'
    }
    if (buyInput.trim() === '') {
      return 'Enter a SOL amount.'
    }
    if (buyLamports === null) {
      return 'Enter a valid SOL amount.'
    }
    if (buyLamports === 0n) {
      return 'Amount must be greater than zero.'
    }
    if (buyNbrAmount === null || buyNbrAmount === 0n) {
      return 'Amount is too small to buy one KLYTH unit.'
    }
    if (minBuyNbrAmount === null || minBuyNbrAmount === 0n) {
      return 'Amount is too small after slippage tolerance.'
    }
    if (buyNbrAmount + state.soldSupply > state.maxSoldSupply) {
      return 'Amount exceeds the remaining curve supply.'
    }
    if (curve.vaultAmount !== null && buyNbrAmount > curve.vaultAmount) {
      return 'Token vault has insufficient KLYTH for this purchase.'
    }
    if (
      balances.solLamports !== null &&
      buyLamports + FEE_BUFFER_LAMPORTS > balances.solLamports
    ) {
      return 'Insufficient SOL for this amount plus fees.'
    }
    return null
  })()

  const sellBlockedReason = (() => {
    if (curve.loading) {
      return 'Loading bonding curve state…'
    }
    if (curve.error) {
      return `Unable to load curve state: ${curve.error}`
    }
    if (!state) {
      return 'Bonding curve state is not initialized.'
    }
    if (sellInput.trim() === '') {
      return 'Enter an KLYTH amount.'
    }
    if (sellNbrRaw === null) {
      return 'Enter a valid KLYTH amount.'
    }
    if (sellNbrRaw === 0n) {
      return 'Amount must be greater than zero.'
    }
    if (sellNbrRaw > state.soldSupply) {
      return 'Amount exceeds the sold supply available to sell.'
    }
    if (balances.nbrRaw !== null && sellNbrRaw > balances.nbrRaw) {
      return 'Insufficient KLYTH balance.'
    }
    if (sellReturn === null || sellReturn === 0n) {
      return 'Amount is too small to receive SOL.'
    }
    if (
      curve.reserveLamports !== null &&
      curve.rentExempt !== null &&
      curve.reserveLamports - curve.rentExempt < sellReturn
    ) {
      return 'SOL reserve cannot cover this sale yet.'
    }
    return null
  })()

  const executeTrade = useCallback(
    async (trade: PendingTrade) => {
      if (!publicKey || !signTransaction) {
        setStatus('failed')
        setStatusMessage('Connect a wallet first.')
        return
      }

      setSubmitting(true)
      setStatus('preparing')
      setStatusMessage('Building transaction…')

      try {
        const instructions: TransactionInstruction[] = []

        if (trade.mode === 'buy') {
          instructions.push(buildCreateBuyerTokenAccountInstruction(publicKey))
          instructions.push(
            buildBuyInstruction(publicKey, trade.nbrAmount, trade.maxSolCost),
          )
        } else {
          instructions.push(
            buildSellInstruction(publicKey, trade.nbrAmount, trade.minSolReceived),
          )
        }

        const transaction = new Transaction().add(...instructions)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        transaction.recentBlockhash = blockhash
        transaction.feePayer = publicKey

        setStatus('waiting')
        setStatusMessage('Approve the transaction in your wallet.')

        const signed = await signTransaction(transaction)
        setStatus('processing')
        setStatusMessage('Sending transaction to Solana Devnet…')

        const sentSignature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        })
        setSignature(sentSignature)

        await connection.confirmTransaction(
          { signature: sentSignature, blockhash, lastValidBlockHeight },
          'confirmed',
        )

        setStatus('confirmed')
        setStatusMessage(
          trade.mode === 'buy'
            ? `Bought ${formatNbr(trade.nbrAmount)} KLYTH.`
            : `Sold ${formatNbr(trade.nbrAmount)} KLYTH for ${formatSol(trade.solReturn)} SOL.`,
        )
        setBuyInput('')
        setSellInput('')
        curve.refresh()
        balances.refresh()
      } catch (error) {
        setStatus('failed')
        setStatusMessage(describeError(error))
      } finally {
        setSubmitting(false)
      }
    },
    [publicKey, signTransaction, connection, curve, balances],
  )

  const openBuyConfirmation = () => {
    if (!publicKey) {
      setWalletModalVisible(true)
      return
    }
    if (
      buyBlockedReason !== null ||
      buyLamports === null ||
      minBuyNbrAmount === null ||
      minBuyNbrAmount === 0n
    ) {
      return
    }
    setPending({
      mode: 'buy',
      lamports: buyLamports,
      nbrAmount: minBuyNbrAmount,
      maxSolCost: buyLamports,
    })
  }

  const openSellConfirmation = () => {
    if (!publicKey) {
      setWalletModalVisible(true)
      return
    }
    if (
      sellBlockedReason !== null ||
      sellNbrRaw === null ||
      sellReturn === null ||
      minSolReceived === null
    ) {
      return
    }
    setPending({
      mode: 'sell',
      nbrAmount: sellNbrRaw,
      solReturn: sellReturn,
      minSolReceived,
    })
  }

  const confirmPending = () => {
    const trade = pending
    setPending(null)
    if (!trade) {
      return
    }
    setLastTrade(trade)
    void executeTrade(trade)
  }

  const resetStatus = () => {
    setStatus('idle')
    setStatusMessage('No transaction has been submitted yet.')
    setSignature(null)
  }

  const previewInput =
    mode === 'buy'
      ? buyLamports !== null
        ? `${formatSol(buyLamports)} SOL`
        : '—'
      : sellNbrRaw !== null
        ? `${formatNbr(sellNbrRaw)} KLYTH`
        : '—'

  const previewOutput =
    mode === 'buy'
      ? buyNbrAmount !== null
        ? `${formatNbr(buyNbrAmount)} KLYTH`
        : '—'
      : sellReturn !== null
        ? `${formatSol(sellReturn)} SOL`
        : '—'

  return (
    <div className="page-section">
      <PageHeader
        kicker="Trade · Solana Devnet"
        title="Trade KLYTH on the curve"
        description="Quote, confirm, and settle buys and sells through the on-chain bonding curve. Every amount is calculated from live program state."
        actions={
          <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
            {state ? 'Program live' : 'State unavailable'}
          </span>
        }
      />

      <section className="card card--glow trade-curve">
        <div className="card__header">
          <div>
            <h3 className="card__title">Bonding Curve</h3>
            <p className="card__description">
              Linear price curve read live from the program. Buys move the price up, sells move it
              down.
            </p>
          </div>
          <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
            {state ? 'Live' : 'Unavailable'}
          </span>
        </div>

        <Suspense fallback={<div className="chart-skeleton" aria-hidden="true" />}>
          <BondingCurveChart
            soldSupply={soldSupply !== null ? Number(soldSupply) / Number(TOKEN_SCALE) : null}
            maxSoldSupply={
              maxSoldSupply !== null ? Number(maxSoldSupply) / Number(TOKEN_SCALE) : null
            }
            initialPrice={initialPriceSol}
            slope={slopeSol}
            previewAmount={previewAmount}
            previewMode={mode}
            trades={trades}
          />
        </Suspense>

        <div className="trade-curve__stats">
          <div className="trade-stat">
            <span className="data-label">Marginal price</span>
            <span className="trade-stat__value">
              {marginal !== null ? formatSolPrice(marginal) : '—'}
              <span className="data-unit">SOL</span>
            </span>
            <span className="trade-stat__note">Cost of the next KLYTH</span>
          </div>
          <div className="trade-stat">
            <span className="data-label">Sold supply</span>
            <span className="trade-stat__value">
              {soldSupply !== null ? formatNbr(soldSupply) : '—'}
              <span className="data-unit">KLYTH</span>
            </span>
            <span className="trade-stat__note">
              {maxSoldSupply !== null ? `of ${formatNbr(maxSoldSupply)} KLYTH` : 'Max supply unavailable'}
            </span>
          </div>
          <div className="trade-stat">
            <span className="data-label">Curve progress</span>
            <CurveProgress value={progress} />
          </div>
          <div className="trade-stat">
            <span className="data-label">SOL reserve</span>
            <span className="trade-stat__value">
              {curve.reserveLamports !== null ? formatSol(curve.reserveLamports) : '—'}
              <span className="data-unit">SOL</span>
            </span>
            <span className="trade-stat__note">Backs every sell</span>
          </div>
          <div className="trade-stat">
            <span className="data-label">Token vault</span>
            <span className="trade-stat__value">
              {curve.vaultAmount !== null ? formatNbr(curve.vaultAmount) : '—'}
              <span className="data-unit">KLYTH</span>
            </span>
            <span className="trade-stat__note">Available to buy</span>
          </div>
        </div>
      </section>

      <div className="trade-layout">
        <section className="card trade-panel">
          <div className="card__header">
            <div>
              <h3 className="card__title">Trading Panel</h3>
              <p className="card__description">Buy and Sell KLYTH through the bonding curve.</p>
            </div>
            <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
              {state ? 'Live' : 'Unavailable'}
            </span>
          </div>

          <div
            className="segmented"
            role="group"
            aria-label="Trade mode"
            style={{ marginBottom: 'var(--space-5)' }}
          >
            <button
              type="button"
              className={`segmented__item ${mode === 'buy' ? 'segmented__item--active' : ''}`}
              aria-pressed={mode === 'buy'}
              onClick={() => setMode('buy')}
            >
              Buy KLYTH
            </button>
            <button
              type="button"
              className={`segmented__item ${mode === 'sell' ? 'segmented__item--active' : ''}`}
              aria-pressed={mode === 'sell'}
              onClick={() => setMode('sell')}
            >
              Sell KLYTH
            </button>
          </div>

          <div className="trade-slippage">
            <div>
              <span className="field__label">Slippage tolerance</span>
              <p className="field__hint">Applied to the on-chain min/max limits.</p>
            </div>
            <div className="pill-group" role="group" aria-label="Slippage tolerance">
              {SLIPPAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`pill ${
                    slippageBps === BigInt(option) ? 'pill--active' : ''
                  }`}
                  aria-pressed={slippageBps === BigInt(option)}
                  onClick={() => setSlippageBps(BigInt(option))}
                >
                  {option / 100}%
                </button>
              ))}
            </div>
          </div>

          {mode === 'buy' ? (
            <div className="page-section">
              <div className="field">
                <label className="field__label" htmlFor="buy-amount">
                  Amount
                </label>
                <div className="input-wrap">
                  <input
                    className="input"
                    id="buy-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={buyInput}
                    onChange={(event) => setBuyInput(event.target.value)}
                  />
                  <span className="input-wrap__suffix">SOL</span>
                </div>
                <span className="field__hint">
                  SOL balance: {balances.loading ? '…' : (balances.sol ?? '—')}
                </span>
              </div>

              <div className="info-list">
                <div className="info-row">
                  <span className="info-row__label">Estimated KLYTH received</span>
                  <span className="info-row__value">
                    {buyNbrAmount !== null ? `${formatNbr(buyNbrAmount)} KLYTH` : '—'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Minimum KLYTH received</span>
                  <span className="info-row__value">
                    {minBuyNbrAmount !== null ? `${formatNbr(minBuyNbrAmount)} KLYTH` : '—'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Max SOL cost</span>
                  <span className="info-row__value">
                    {buyLamports !== null ? `${formatSol(buyLamports)} SOL` : '—'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Current marginal price</span>
                  <span className="info-row__value">
                    {marginal !== null ? `${formatSolPrice(marginal)} SOL` : 'Unavailable'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Price impact</span>
                  <span className="info-row__value">{formatImpact(buyImpact)}</span>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={openBuyConfirmation}
                disabled={submitting || (!!publicKey && buyBlockedReason !== null)}
              >
                {submitting ? 'Processing…' : publicKey ? 'Buy KLYTH' : 'Connect Wallet to Buy'}
              </button>

              <p className="data-meta" style={{ marginTop: 'var(--space-3)' }}>
                {!publicKey
                  ? 'Connect Phantom to trade on Solana Devnet.'
                  : (buyBlockedReason ?? 'Quoted from live on-chain state.')}
              </p>
            </div>
          ) : (
            <div className="page-section">
              <div className="field">
                <label className="field__label" htmlFor="sell-amount">
                  Amount
                </label>
                <div className="input-wrap">
                  <input
                    className="input"
                    id="sell-amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={sellInput}
                    onChange={(event) => setSellInput(event.target.value)}
                  />
                  <span className="input-wrap__suffix">KLYTH</span>
                </div>
                <span className="field__hint">
                  Tradable: {balances.loading ? '…' : (balances.nbr ?? '—')}
                  {balances.otherRaw !== null && balances.otherRaw > 0n ? (
                    <> · Total wallet: {balances.loading ? '…' : (balances.nbrTotal ?? '—')}</>
                  ) : null}
                </span>
              </div>

              <div className="info-list">
                <div className="info-row">
                  <span className="info-row__label">Estimated SOL received</span>
                  <span className="info-row__value">
                    {sellReturn !== null ? `${formatSol(sellReturn)} SOL` : '—'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Minimum SOL received</span>
                  <span className="info-row__value">
                    {minSolReceived !== null ? `${formatSol(minSolReceived)} SOL` : '—'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Current marginal price</span>
                  <span className="info-row__value">
                    {marginal !== null ? `${formatSolPrice(marginal)} SOL` : 'Unavailable'}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-row__label">Price impact</span>
                  <span className="info-row__value">{formatImpact(sellImpact)}</span>
                </div>
              </div>

              <button
                type="button"
                className="btn btn--danger btn--block"
                onClick={openSellConfirmation}
                disabled={submitting || (!!publicKey && sellBlockedReason !== null)}
              >
                {submitting ? 'Processing…' : publicKey ? 'Sell KLYTH' : 'Connect Wallet to Sell'}
              </button>

              <p className="data-meta" style={{ marginTop: 'var(--space-3)' }}>
                {!publicKey
                  ? 'Connect Phantom to trade on Solana Devnet.'
                  : (sellBlockedReason ?? 'Quoted from live on-chain state.')}
              </p>
            </div>
          )}
        </section>

        <div className="trade-side">
          <section className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">Transaction Preview</h3>
                <p className="card__description">Summary before confirmation.</p>
              </div>
              <span className={`badge ${state ? 'badge--success' : 'badge--neutral'}`}>
                {state ? 'Live' : 'Unavailable'}
              </span>
            </div>
            <div className="info-list">
              <div className="info-row">
                <span className="info-row__label">Input amount</span>
                <span className="info-row__value">{previewInput}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">
                  {mode === 'buy' ? 'Estimated output' : 'Estimated SOL received'}
                </span>
                <span className="info-row__value">{previewOutput}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">
                  {mode === 'buy' ? 'Minimum KLYTH received' : 'Minimum SOL received'}
                </span>
                <span className="info-row__value">
                  {mode === 'buy'
                    ? minBuyNbrAmount !== null
                      ? `${formatNbr(minBuyNbrAmount)} KLYTH`
                      : '—'
                    : minSolReceived !== null
                      ? `${formatSol(minSolReceived)} SOL`
                      : '—'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-row__label">Price impact</span>
                <span className="info-row__value">
                  {formatImpact(mode === 'buy' ? buyImpact : sellImpact)}
                </span>
              </div>
              <div className="info-row">
                <span className="info-row__label">Slippage tolerance</span>
                <span className="info-row__value">{Number(slippageBps) / 100}%</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">Network</span>
                <span className="info-row__value">Solana Devnet</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">Wallet</span>
                <span className="info-row__value">
                  {publicKey ? shortenAddress(publicKey.toBase58()) : 'Not connected'}
                </span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__header">
              <div>
                <h3 className="card__title">Transaction Status</h3>
                <p className="card__description">Live status of the submitted trade.</p>
              </div>
              <span className={`badge ${statusBadge[status]}`}>{statusLabel[status]}</span>
            </div>
            <TransactionStatus
              status={status}
              description={statusMessage}
              signature={signature ?? undefined}
              onRetry={
                lastTrade
                  ? () => {
                      setPending(lastTrade)
                    }
                  : undefined
              }
              onDismiss={status === 'confirmed' ? resetStatus : undefined}
            />
          </section>
        </div>
      </div>

      <ConfirmationModal
        open={pending !== null}
        title={pending?.mode === 'buy' ? 'Confirm buy' : 'Confirm sell'}
        description={pending ? describeTrade(pending) : ''}
        confirmLabel={pending?.mode === 'buy' ? 'Buy KLYTH' : 'Sell KLYTH'}
        variant={pending?.mode === 'sell' ? 'danger' : 'primary'}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />
    </div>
  )
}
