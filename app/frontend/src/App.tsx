import { useEffect, useState } from 'react'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { TickerStrip } from './components/TickerStrip'
import { CurveStateProvider } from './hooks/useCurveState'
import { KlythDataProvider } from './hooks/useKlythData'
import { NavigationProvider } from './lib/navigation'
import { AboutPage } from './pages/AboutPage'
import { AdminPage } from './pages/AdminPage'
import { ActivityPage } from './pages/ActivityPage'
import { BurnTrackerPage } from './pages/BurnTrackerPage'
import DesignSystemPage from './pages/DesignSystemPage'
import { DocumentationPage } from './pages/DocumentationPage'
import { OverviewPage } from './pages/OverviewPage'
import { TokenomicsPage } from './pages/TokenomicsPage'
import { TradePage } from './pages/TradePage'
import { WalletTrackerPage } from './pages/WalletTrackerPage'

function renderPage(active: string) {
  switch (active) {
    case 'overview':
      return <OverviewPage />
    case 'trade':
      return <TradePage />
    case 'tokenomics':
      return <TokenomicsPage />
    case 'burn':
      return <BurnTrackerPage />
    case 'activity':
      return <ActivityPage />
    case 'wallets':
      return <WalletTrackerPage />
    case 'about':
      return <AboutPage />
    case 'documentation':
      return <DocumentationPage />
    case 'admin':
      return <AdminPage />
    case 'design-system':
      return <DesignSystemPage />
    default:
      return null
  }
}

export default function App() {
  const [activePage, setActivePage] = useState('overview')

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activePage])

  return (
    <KlythDataProvider>
      <CurveStateProvider>
        <NavigationProvider active={activePage} navigate={setActivePage}>
          <div className="app-shell app-shell--portal">
            <a className="skip-link" href="#main-content">
              Skip to main content
            </a>
            <SiteHeader active={activePage} onSelect={setActivePage} />
            <TickerStrip />
            <main className="app-content" id="main-content" role="main" tabIndex={-1}>
              {renderPage(activePage)}
            </main>
            <SiteFooter active={activePage} onSelect={setActivePage} />
          </div>
        </NavigationProvider>
      </CurveStateProvider>
    </KlythDataProvider>
  )
}
