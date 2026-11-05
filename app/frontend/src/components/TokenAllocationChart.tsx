const segments = [
  { label: 'Curve Vault', value: 50, color: '#e0a64b' },
  { label: 'Burn Reserve', value: 40, color: '#c96a3a' },
  { label: 'Treasury', value: 5, color: '#c9ced6' },
  { label: 'Community', value: 5, color: '#f4d79a' },
]

export function TokenAllocationChart() {
  const radius = 72
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="allocation-chart">
      <svg viewBox="0 0 200 200" className="allocation-chart__svg" role="img" aria-label="Token allocation chart">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="rgba(42, 38, 32, 0.5)"
          strokeWidth="28"
        />
        {segments.map((segment) => {
          const length = (segment.value / 100) * circumference
          const dashOffset = circumference - offset
          offset += length
          return (
            <circle
              key={segment.label}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="28"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              transform="rotate(-90 100 100)"
            />
          )
        })}
        <text x="100" y="96" textAnchor="middle" className="allocation-chart__center-label">
          KLYTH
        </text>
        <text x="100" y="116" textAnchor="middle" className="allocation-chart__center-value">
          100M supply
        </text>
      </svg>

      <ul className="allocation-chart__legend">
        {segments.map((segment) => (
          <li key={segment.label} className="allocation-chart__legend-item">
            <span className="allocation-chart__legend-swatch" style={{ backgroundColor: segment.color }} />
            <span className="allocation-chart__legend-label">{segment.label}</span>
            <span className="allocation-chart__legend-value">{segment.value}%</span>
          </li>
        ))}
      </ul>

      <p className="allocation-chart__note">
        50M curve, 40M burn reserve (800,000/day for 50 days), 5M treasury, 5M community.
        Supply falls to 60M after the full burn schedule.
      </p>
    </div>
  )
}
