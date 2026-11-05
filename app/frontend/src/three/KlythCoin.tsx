import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { KLYTH_LOGO_URL } from '../lib/assets'

/**
 * KLYTH coin.
 *
 * A single low-poly cylinder with canvas-drawn faces, two rim rings and a soft
 * additive halo. Everything is generated at runtime so there are no model
 * downloads. The renderer only runs while the canvas is on screen and the tab
 * is visible, and it is capped at 1.75x device pixel ratio.
 */
export default function KlythCoin() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      })
    } catch {
      setFailed(true)
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60)
    camera.position.set(0, 0, 5.6)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.className = 'three-canvas'
    mount.appendChild(renderer.domElement)

    const coin = new THREE.Group()
    scene.add(coin)

    // ---------------------------------------------------------------- faces --
    const FACE_SIZE = 768

    function drawRing(ctx: CanvasRenderingContext2D) {
      const c = FACE_SIZE / 2
      ctx.strokeStyle = '#e0a64b'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(c, c, c - 14, 0, Math.PI * 2)
      ctx.stroke()

      ctx.strokeStyle = 'rgba(224, 166, 75, 0.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(c, c, c - 34, 0, Math.PI * 2)
      ctx.stroke()

      // Reeded edge marks.
      for (let i = 0; i < 72; i += 1) {
        const angle = (i / 72) * Math.PI * 2
        const inner = c - 52
        const outer = c - 40
        ctx.strokeStyle = i % 6 === 0 ? 'rgba(244, 215, 154, 0.8)' : 'rgba(224, 166, 75, 0.28)'
        ctx.lineWidth = i % 6 === 0 ? 3 : 1.5
        ctx.beginPath()
        ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner)
        ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer)
        ctx.stroke()
      }
    }

    function paintFace(ctx: CanvasRenderingContext2D, top: string, mid: string, low: string) {
      const c = FACE_SIZE / 2
      const base = ctx.createRadialGradient(
        c * 0.82,
        c * 0.74,
        c * 0.06,
        c,
        c,
        c,
      )
      base.addColorStop(0, top)
      base.addColorStop(0.46, mid)
      base.addColorStop(0.84, low)
      base.addColorStop(1, '#08080a')
      ctx.fillStyle = base
      ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
    }

    function makeFaceCanvas() {
      const canvas = document.createElement('canvas')
      canvas.width = FACE_SIZE
      canvas.height = FACE_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return canvas
      }

      paintFace(ctx, '#4c3a22', '#2a2117', '#14121a')
      drawRing(ctx)
      return canvas
    }

    const faceCanvas = makeFaceCanvas()
    const faceTexture = new THREE.CanvasTexture(faceCanvas)
    faceTexture.colorSpace = THREE.SRGBColorSpace
    faceTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    const faceContext = faceCanvas.getContext('2d')
    if (faceContext) {
      const c = FACE_SIZE / 2
      const logo = new Image()
      logo.src = KLYTH_LOGO_URL
      logo.onload = () => {
        const radius = c - 96
        faceContext.save()
        faceContext.beginPath()
        faceContext.arc(c, c, radius, 0, Math.PI * 2)
        faceContext.clip()
        // Screen keeps the mark's dark field invisible and lifts its light.
        faceContext.globalCompositeOperation = 'screen'
        faceContext.globalAlpha = 0.95
        faceContext.drawImage(logo, c - radius, c - radius, radius * 2, radius * 2)
        faceContext.restore()

        faceContext.strokeStyle = 'rgba(244, 215, 154, 0.7)'
        faceContext.lineWidth = 3
        faceContext.beginPath()
        faceContext.arc(c, c, radius, 0, Math.PI * 2)
        faceContext.stroke()

        faceTexture.needsUpdate = true
      }
    }

    // Back face: animated black hole with galaxy debris, redrawn every frame.
    const backCanvas = document.createElement('canvas')
    backCanvas.width = FACE_SIZE
    backCanvas.height = FACE_SIZE
    const backCtx = backCanvas.getContext('2d')

    const backTexture = new THREE.CanvasTexture(backCanvas)
    backTexture.colorSpace = THREE.SRGBColorSpace
    backTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()

    const debris = Array.from({ length: 46 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 30 + Math.random() * (FACE_SIZE / 2 - 90),
      speed: 0.006 + Math.random() * 0.018,
      size: 0.9 + Math.random() * 2.3,
      warm: Math.random() > 0.35,
    }))

    const drawBackFace = (delta: number) => {
      if (!backCtx) {
        return
      }
      const c = FACE_SIZE / 2

      // Trails: fade previous frame into the background.
      backCtx.globalCompositeOperation = 'source-over'
      backCtx.fillStyle = 'rgba(6, 6, 9, 0.22)'
      backCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)

      // Black hole core.
      const core = backCtx.createRadialGradient(c, c, 2, c, c, 42)
      core.addColorStop(0, 'rgba(0, 0, 0, 1)')
      core.addColorStop(0.55, 'rgba(0, 0, 0, 0.98)')
      core.addColorStop(0.75, 'rgba(34, 18, 12, 0.92)')
      core.addColorStop(1, 'rgba(0, 0, 0, 0)')
      backCtx.fillStyle = core
      backCtx.beginPath()
      backCtx.arc(c, c, 42, 0, Math.PI * 2)
      backCtx.fill()

      // Accretion glow ring around the black hole.
      const ring = backCtx.createRadialGradient(c, c, 40, c, c, 74)
      ring.addColorStop(0, 'rgba(224, 166, 75, 0.05)')
      ring.addColorStop(0.6, 'rgba(224, 166, 75, 0.22)')
      ring.addColorStop(0.85, 'rgba(224, 166, 75, 0.08)')
      ring.addColorStop(1, 'rgba(0, 0, 0, 0)')
      backCtx.fillStyle = ring
      backCtx.beginPath()
      backCtx.arc(c, c, 74, 0, Math.PI * 2)
      backCtx.fill()

      // Galaxy debris particles orbiting the black hole.
      for (const particle of debris) {
        particle.angle += particle.speed * delta
        const x = c + Math.cos(particle.angle) * particle.radius
        const y = c + Math.sin(particle.angle) * particle.radius
        const alpha = 0.35 * particle.size
        backCtx.fillStyle = particle.warm
          ? `rgba(224, 166, 75, ${alpha})`
          : `rgba(190, 200, 220, ${alpha * 0.8})`
        backCtx.beginPath()
        backCtx.arc(x, y, particle.size, 0, Math.PI * 2)
        backCtx.fill()
      }

      backTexture.needsUpdate = true
    }

    const radius = 1.5
    const thickness = 0.2
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 96, 1, false)
    geometry.rotateX(Math.PI / 2)

    const edgeMaterial = new THREE.MeshLambertMaterial({
      color: 0xb07a2c,
    })
    const faceMaterial = new THREE.MeshLambertMaterial({
      map: faceTexture,
    })
    const backMaterial = new THREE.MeshLambertMaterial({
      map: backTexture,
    })

    const disc = new THREE.Mesh(geometry, [edgeMaterial, faceMaterial, backMaterial])
    coin.add(disc)

    const rimGeometry = new THREE.TorusGeometry(radius - 0.004, 0.022, 8, 96)
    const rimMaterial = new THREE.MeshLambertMaterial({
      color: 0xe0a64b,
    })
    const frontRim = new THREE.Mesh(rimGeometry, rimMaterial)
    frontRim.position.z = thickness / 2 + 0.006
    coin.add(frontRim)
    const backRim = new THREE.Mesh(rimGeometry, rimMaterial)
    backRim.position.z = -thickness / 2 - 0.006
    coin.add(backRim)

    // ------------------------------------------------------------- lighting --
    const ambient = new THREE.AmbientLight(0xf4efe4, 0.7)
    scene.add(ambient)

    const key = new THREE.DirectionalLight(0xfff0d2, 1.8)
    key.position.set(2.4, 2.8, 3.4)
    scene.add(key)

    const rim = new THREE.DirectionalLight(0xe0a64b, 1.1)
    rim.position.set(-3.2, -0.6, -2.2)
    scene.add(rim)

    const fill = new THREE.PointLight(0xc96a3a, 8, 12, 2)
    fill.position.set(-1.6, 1.4, 2.4)
    scene.add(fill)

    // ----------------------------------------------------------------- halo --
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = 256
    glowCanvas.height = 256
    const glowCtx = glowCanvas.getContext('2d')
    if (glowCtx) {
      // Smooth radial falloff well inside the texture bounds so the sprite never
      // gets clipped by the canvas edge, even when scaled large.
      const gradient = glowCtx.createRadialGradient(128, 128, 4, 128, 128, 110)
      gradient.addColorStop(0, 'rgba(224, 166, 75, 0.28)')
      gradient.addColorStop(0.35, 'rgba(212, 130, 62, 0.16)')
      gradient.addColorStop(0.65, 'rgba(201, 106, 58, 0.07)')
      gradient.addColorStop(0.85, 'rgba(201, 106, 58, 0.02)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      glowCtx.fillStyle = gradient
      glowCtx.fillRect(0, 0, 256, 256)
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas)
    glowTexture.colorSpace = THREE.SRGBColorSpace
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Sprite(glowMaterial)
    glow.scale.set(4.8, 4.8, 1)
    glow.position.z = -1.4
    scene.add(glow)

    // ------------------------------------------------------------- particles --
    const starCount = 90
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const distance = 2.6 + Math.random() * 2.4
      starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * distance
      starPositions[i * 3 + 1] = Math.cos(phi) * distance
      starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * distance - 1.2
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMaterial = new THREE.PointsMaterial({
      color: 0xc9ced6,
      size: 0.022,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)

    // ------------------------------------------------------------- interaction --
    const pointer = { x: 0, y: 0 }
    let hovered = false
    let inView = true
    let pageVisible = !document.hidden

    let isDragging = false
    let previousMouse = { x: 0, y: 0 }
    let manualRotationX = 0
    let manualRotationY = 0

    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        return
      }
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1

      if (isDragging && hovered) {
        const deltaX = event.clientX - previousMouse.x
        const deltaY = event.clientY - previousMouse.y
        manualRotationY += deltaX * 0.008
        manualRotationX += deltaY * 0.008
        previousMouse = { x: event.clientX, y: event.clientY }
      }
    }
    const onPointerEnter = () => {
      hovered = true
    }
    const onPointerLeave = () => {
      hovered = false
      isDragging = false
      pointer.x = 0
      pointer.y = 0
    }
    const onPointerDown = (event: PointerEvent) => {
      if (hovered) {
        isDragging = true
        previousMouse = { x: event.clientX, y: event.clientY }
      }
    }
    const onPointerUp = () => {
      isDragging = false
    }

    mount.addEventListener('pointermove', onPointerMove)
    mount.addEventListener('pointerenter', onPointerEnter)
    mount.addEventListener('pointerleave', onPointerLeave)
    mount.addEventListener('pointerdown', onPointerDown)
    mount.addEventListener('pointerup', onPointerUp)

    // ---------------------------------------------------------------- resize --
    const resize = () => {
      const width = mount.clientWidth || 360
      const height = mount.clientHeight || 360
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(mount)
    resize()

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
      },
      { threshold: 0.01 },
    )
    intersectionObserver.observe(mount)

    const onVisibility = () => {
      pageVisible = !document.hidden
    }
    document.addEventListener('visibilitychange', onVisibility)

    // ------------------------------------------------------------------ loop --
    const clock = new THREE.Clock()
    let elapsed = 0
    let spin = 0.4
    let tiltX = 0
    let tiltZ = 0
    let scale = 0.78
    const introStart = performance.now()
    let frameId = 0

    const frame = () => {
      frameId = requestAnimationFrame(frame)
      if (!inView || !pageVisible) {
        clock.getDelta()
        return
      }

      const delta = Math.min(clock.getDelta(), 0.05)
      elapsed += delta

      drawBackFace(delta)

      const introProgress = Math.min(1, (performance.now() - introStart) / 1400)
      const eased = 1 - Math.pow(1 - introProgress, 3)

      const baseTiltX = THREE.MathUtils.lerp(-1.15, -0.08, eased)
      const baseScale = THREE.MathUtils.lerp(0.78, 1, eased)
      const targetScale = baseScale

      const targetTiltX = hovered && !isDragging ? -pointer.y * 0.32 : 0
      const targetTiltZ = hovered && !isDragging ? pointer.x * 0.16 : 0
      const damping = Math.min(1, delta * 6)

      tiltX += (targetTiltX - tiltX) * damping
      tiltZ += (targetTiltZ - tiltZ) * damping
      scale += (targetScale - scale) * damping

      if (!hovered) {
        spin += delta * 0.19
      }

      coin.rotation.x = baseTiltX + tiltX + manualRotationX
      coin.rotation.y = spin + manualRotationY
      coin.rotation.z = tiltZ
      coin.position.y = Math.sin(elapsed * 0.85) * 0.035
      coin.scale.setScalar(scale)

      stars.rotation.y = elapsed * 0.02
      stars.rotation.x = Math.sin(elapsed * 0.12) * 0.05

      if (hovered) {
        key.position.x = 2.4 + pointer.x * 1.6
        key.position.y = 2.8 - pointer.y * 1.4
      } else {
        key.position.x += (2.4 - key.position.x) * damping
        key.position.y += (2.8 - key.position.y) * damping
      }

      renderer.render(scene, camera)
    }

    frame()

    return () => {
      cancelAnimationFrame(frameId)
      mount.removeEventListener('pointermove', onPointerMove)
      mount.removeEventListener('pointerenter', onPointerEnter)
      mount.removeEventListener('pointerleave', onPointerLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()

      geometry.dispose()
      rimGeometry.dispose()
      faceTexture.dispose()
      backTexture.dispose()
      glowTexture.dispose()
      starGeometry.dispose()
      edgeMaterial.dispose()
      faceMaterial.dispose()
      backMaterial.dispose()
      rimMaterial.dispose()
      glowMaterial.dispose()
      starMaterial.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  if (failed) {
    return (
      <div className="three-fallback">
        <img src={KLYTH_LOGO_URL} alt="KALYTH" />
        <span>WebGL unavailable</span>
      </div>
    )
  }

  return <div className="three-mount" ref={mountRef} aria-hidden="true" />
}
