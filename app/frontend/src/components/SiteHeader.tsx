import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { NetworkBadge } from './NetworkBadge'
import { WalletBalances } from './WalletBalances'
import { WalletButton } from './WalletButton'
import { KLYTH_LOGO_URL } from '../lib/assets'

type SiteHeaderProps = {
  active: string
  onSelect: (id: string) => void
}

const primaryItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'trade', label: 'Trade' },
  { id: 'tokenomics', label: 'Tokenomics' },
  { id: 'burn', label: 'Burn Tracker' },
  { id: 'activity', label: 'Activity' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'about', label: 'About' },
  { id: 'documentation', label: 'Docs' },
]

const secondaryItems = [
  { id: 'design-system', label: 'Design system' },
  { id: 'admin', label: 'Admin (dev)' },
]

export function SiteHeader({ active, onSelect }: SiteHeaderProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const select = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <header className="site-header">
      <div className="site-header__bar">
        <button
          type="button"
          className="site-header__menu"
          aria-label={open ? 'Close navigation' : 'Toggle navigation'}
          aria-expanded={open}
          aria-controls="site-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>

        <button type="button" className="brand" onClick={() => select('overview')}>
          <img className="brand__mark" src={KLYTH_LOGO_URL} alt="" />
          <span className="brand__text">
            <strong>KALYTH</strong>
            <span>KLYTH · SOLANA DEVNET</span>
          </span>
        </button>

        <nav
          id="site-navigation"
          className={`site-nav ${open ? 'site-nav--open' : ''}`}
          aria-label="Primary navigation"
        >
          <ul className="site-nav__list">
            {primaryItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`site-nav__link ${active === item.id ? 'site-nav__link--active' : ''}`}
                  aria-current={active === item.id ? 'page' : undefined}
                  onClick={() => select(item.id)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="site-nav__foot">
            {secondaryItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`site-nav__link site-nav__link--muted ${
                  active === item.id ? 'site-nav__link--active' : ''
                }`}
                aria-current={active === item.id ? 'page' : undefined}
                onClick={() => select(item.id)}
              >
                {item.label}
              </button>
            ))}
            <span className="site-nav__status">
              <span className="status-dot status-dot--success" aria-hidden="true" />
              Devnet only · no real funds
            </span>
          </div>
        </nav>

        <div className="site-header__actions">
          <NetworkBadge />
          <WalletBalances />
          <WalletButton />
        </div>
      </div>

      {open ? (
        <button
          type="button"
          className="site-header__backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </header>
  )
}
