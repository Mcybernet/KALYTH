import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { useMemo } from 'react'
import App from './App'
import './styles/tokens.css'
import './styles/global.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/preview.css'
import './styles/portal.css'
import './styles/minimal.css'
import './styles/wallets.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import './styles/wallet-modal.css'

const ENDPOINT = 'https://api.devnet.solana.com'

function Root() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
