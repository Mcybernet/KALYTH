import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletBalances } from '../hooks/useWalletBalances'

export function WalletBalances() {
  const { connected } = useWallet()
  const { loading, sol, nbr, error } = useWalletBalances()

  if (!connected) return null

  return (
    <div className="wallet-balances" aria-live="polite">
      <span className="wallet-balances__item">
        <span className="wallet-balances__label">SOL</span>
        <span className="wallet-balances__value tabular">{loading ? '…' : (sol ?? '—')}</span>
      </span>
      <span className="wallet-balances__item">
        <span className="wallet-balances__label">KLYTH</span>
        <span className="wallet-balances__value tabular">{loading ? '…' : (nbr ?? '0')}</span>
      </span>
      {error ? <span className="wallet-balances__error">{error}</span> : null}
    </div>
  )
}
