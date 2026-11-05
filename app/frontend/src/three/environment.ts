import * as THREE from 'three'

/**
 * A tiny procedural studio environment.
 *
 * Metals need something to reflect; with only direct lights a metalness: 1
 * surface renders almost black. This paints a 512×256 equirectangular canvas
 * (warm key, cool rim, dark floor) and pre-filters it once with PMREM. It costs
 * a single canvas and one GPU pass — no HDR download, no extra dependency.
 */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  const base = ctx.createLinearGradient(0, 0, 0, 256)
  base.addColorStop(0, '#3a2d1a')
  base.addColorStop(0.38, '#151210')
  base.addColorStop(0.68, '#0a0a0c')
  base.addColorStop(1, '#050506')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 512, 256)

  const key = ctx.createRadialGradient(150, 54, 4, 150, 54, 160)
  key.addColorStop(0, 'rgba(255, 232, 190, 0.95)')
  key.addColorStop(0.32, 'rgba(224, 166, 75, 0.42)')
  key.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = key
  ctx.fillRect(0, 0, 512, 256)

  const rim = ctx.createRadialGradient(402, 118, 4, 402, 118, 176)
  rim.addColorStop(0, 'rgba(206, 214, 226, 0.55)')
  rim.addColorStop(0.45, 'rgba(140, 150, 168, 0.16)')
  rim.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, 512, 256)

  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envMap = pmrem.fromEquirectangular(texture).texture
  pmrem.dispose()
  texture.dispose()

  return envMap
}
