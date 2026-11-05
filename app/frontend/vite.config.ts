import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * `VITE_BASE` lets the GitHub Pages workflow inject the repository subpath
 * (for example `/kalyth/`). It defaults to `/` for local dev and preview.
 */
const rawBase = process.env.VITE_BASE ?? '/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

export default defineConfig({
  base,
  plugins: [react(), nodePolyfills()],
})
