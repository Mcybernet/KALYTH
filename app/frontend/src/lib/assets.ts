/**
 * GitHub Pages serves project sites from a subpath (for example
 * `/klyth/`), so every public asset must be resolved against the Vite
 * base URL instead of a hard-coded leading slash.
 */
export function publicAsset(path: string): string {
  const clean = path.replace(/^\/+/, '')
  return `${import.meta.env.BASE_URL}${clean}`
}

export const KLYTH_LOGO_URL = publicAsset('brand/klyth-logo.png')
