import { ExternalLink } from 'lucide-react'
import { explorerTxUrl, shortenAddress } from '../lib/addresses'
import { formatBlockTime, type ActivityKind, type ActivityRecord } from '../lib/history'

const kindLabels: Record<ActivityKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  burn: 'Burn',
}

const kindBadges: Record<ActivityKind, string> = {
  buy: 'badge--success',
  sell: 'badge--primary',
  burn: 'badge--danger',
}

type ActivityTableProps = {
  records: ActivityRecord[]
  caption: string
}

export function ActivityTable({ records, caption }: ActivityTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Wallet</th>
            <th scope="col" className="data-table__num">
              Amount
            </th>
            <th scope="col" className="data-table__num">
              SOL Value
            </th>
            <th scope="col">Time</th>
            <th scope="col">Status</th>
            <th scope="col">Signature</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.signature}>
              <td>
                <span className={`badge ${kindBadges[record.kind]}`}>
                  {kindLabels[record.kind]}
                </span>
              </td>
              <td className="data-table__mono" title={record.wallet}>
                {shortenAddress(record.wallet, 4, 4)}
              </td>
              <td className="data-table__num">{record.amount} KLYTH</td>
              <td className="data-table__num data-table__muted">
                {record.sol !== null ? `${record.sol} SOL` : '—'}
              </td>
              <td className="data-table__time">{formatBlockTime(record.blockTime)}</td>
              <td>
                <span
                  className={`badge ${record.status === 'confirmed' ? 'badge--success' : 'badge--danger'}`}
                >
                  {record.status === 'confirmed' ? 'Confirmed' : 'Failed'}
                </span>
              </td>
              <td>
                <a
                  className="tx-link"
                  href={explorerTxUrl(record.signature)}
                  target="_blank"
                  rel="noreferrer"
                  title={record.signature}
                >
                  {shortenAddress(record.signature, 8, 8)}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
