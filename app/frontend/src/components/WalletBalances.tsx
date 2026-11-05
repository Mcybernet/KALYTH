import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletBalances } from '../hooks/useWalletBalances'

export function WalletBalances() {
  const { connected } = useWallet()
  const { loading, sol, nbr, nbrTotal, otherRaw, error } = useWalletBalances()

  if (!connected) return null

  const hasOtherAccounts = otherRaw !== null && otherRaw > 0n

  return (
    <div className="wallet-balances" aria-live="polite">
      <span className="wallet-balances__item">
        <span className="wallet-balances__label">SOL</span>
        <span className="wallet-balances__value tabular">{loading ? '…' : (sol ?? '—')}</span>
      </span>
      <span
        className="wallet-balances__item"
        title="KLYTH in your trading account (the only balance used for buy/sell)"
      >
        <span className="wallet-balances__label">KLYTH</span>
        <span className="wallet-balances__value tabular">{loading ? '…' : (nbr ?? '0')}</span>
      </span>
      {hasOtherAccounts ? (
        <span
          className="wallet-balances__item wallet-balances__item--muted"
          title="Total KLYTH in this wallet, including token accounts that are not used by the trading page"
        >
          <span className="wallet-balances__label">Total</span>
          <span className="wallet-balances__value tabular">
            {loading ? '…' : (nbrTotal ?? '0')}
          </span>
        </span>
      ) : null}
      {error ? <span className="wallet-balances__error">{error}</span> : null}
    </div>
  )
}
