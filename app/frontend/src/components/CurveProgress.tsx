type CurveProgressProps = {
  value: number | null
  label?: string
}

export function CurveProgress({ value, label = 'Curve progress' }: CurveProgressProps) {
  const safeValue = value === null ? 0 : Math.min(100, Math.max(0, value))

  return (
    <div className="curve-progress" aria-label={label}>
      <div className="curve-progress__track">
        <div
          className="curve-progress__fill"
          style={{ width: `${safeValue}%` }}
          role="progressbar"
          aria-valuenow={safeValue}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className="curve-progress__value">
        {value === null ? 'Unavailable' : `${safeValue.toFixed(1)}%`}
      </span>
    </div>
  )
}
