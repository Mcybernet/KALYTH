import { ExternalLink } from 'lucide-react'
import {
  MINT_ADDRESS,
  PROGRAM_ADDRESS,
  explorerAddressUrl,
} from '../lib/addresses'
import { KLYTH_LOGO_URL } from '../lib/assets'

type SiteFooterProps = {
  active: string
  onSelect: (id: string) => void
}

const columns = [
  {
    title: 'Protocol',
    links: [
      { id: 'overview', label: 'Overview' },
      { id: 'trade', label: 'Trade KLYTH' },
      { id: 'tokenomics', label: 'Tokenomics' },
    ],
  },
  {
    title: 'On-chain',
    links: [
      { id: 'activity', label: 'Activity' },
      { id: 'burn', label: 'Burn Tracker' },
      { id: 'documentation', label: 'Documentation' },
    ],
  },
  {
    title: 'Project',
    links: [
      { id: 'about', label: 'About KLYTH' },
      { id: 'design-system', label: 'Design system' },
      { id: 'admin', label: 'Admin (dev)' },
    ],
  },
]

export function SiteFooter({ active, onSelect }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__brand">
          <div className="site-footer__brand-row">
            <img className="brand__mark" src={KLYTH_LOGO_URL} alt="" />
            <div>
              <strong>KALYTH</strong>
              <span>KLYTH · Solana Devnet</span>
            </div>
          </div>
          <p>
            A transparent bonding-curve token ecosystem. Every balance, trade, and burn shown here
            is read from Solana Devnet.
          </p>
          <p className="site-footer__disclaimer">
            Devnet only. KLYTH has no real-world monetary value. No private keys are stored in this
            app.
          </p>
        </div>

        {columns.map((column) => (
          <div className="site-footer__column" key={column.title}>
            <h3>{column.title}</h3>
            <ul>
              {column.links.map((link) => (
                <li key={link.id}>
                  <button
                    type="button"
                    className={active === link.id ? 'site-footer__link--active' : undefined}
                    onClick={() => onSelect(link.id)}
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="site-footer__column">
          <h3>Explorer</h3>
          <ul>
            <li>
              <a href={explorerAddressUrl(PROGRAM_ADDRESS)} target="_blank" rel="noreferrer">
                Program account
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </li>
            <li>
              <a href={explorerAddressUrl(MINT_ADDRESS)} target="_blank" rel="noreferrer">
                KLYTH mint
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} KALYTH · Devnet build</span>
        <span className="site-footer__status">
          <span className="status-dot status-dot--success" aria-hidden="true" />
          Solana Devnet operational
        </span>
      </div>
    </footer>
  )
}
