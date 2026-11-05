import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { explorerAddressUrl, explorerTxUrl, shortenAddress } from '../lib/addresses'

type AddressRowProps = {
  label: string
  value: string
  kind?: 'address' | 'tx'
}

export function AddressRow({ label, value, kind = 'address' }: AddressRowProps) {
  const [copied, setCopied] = useState(false)
  const href = kind === 'tx' ? explorerTxUrl(value) : explorerAddressUrl(value)
  const display = shortenAddress(value, kind === 'tx' ? 8 : 6, kind === 'tx' ? 8 : 6)

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="info-row">
      <span className="info-row__label">{label}</span>
      <span className="info-row__value address-inline">
        <span className="address-inline__text" title={value}>
          {display}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => void copyValue()}
          aria-label={`Copy ${label}`}
          title={copied ? 'Copied' : 'Copy address'}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
        <a
          className="icon-button"
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${label} in Solana Explorer`}
          title="Open in Solana Explorer"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      </span>
    </div>
  )
}
