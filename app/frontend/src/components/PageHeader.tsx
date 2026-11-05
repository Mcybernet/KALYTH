import type { ReactNode } from 'react'

type PageHeaderProps = {
  kicker?: string
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="page-head">
      <div className="page-head__main">
        {kicker ? <p className="page-head__kicker">{kicker}</p> : null}
        <h1 className="page-head__title">{title}</h1>
        {description ? <p className="page-head__text">{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
      {children ? <div className="page-head__tabs">{children}</div> : null}
    </header>
  )
}
