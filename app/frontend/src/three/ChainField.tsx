import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createStudioEnvironment } from './environment'

/**
 * A small blockchain: five linked blocks with value packets moving along the
 * chain. Low-poly boxes, line segments and a sparse particle field only — no
 * shadows, post-processing or imported models.
 */
export default function ChainField() {
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
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40)
    camera.position.set(0, 0.85, 5.4)
    camera.lookAt(0, 0, 0)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.className = 'three-canvas'
    mount.appendChild(renderer.domElement)

    const chain = new THREE.Group()
    scene.add(chain)

    const envMap = createStudioEnvironment(renderer)
    if (envMap) {
      scene.environment = envMap
      scene.environmentIntensity = 0.85
    }

    // ---------------------------------------------------------------- blocks --
    const blockCount = 5
    const spacing = 1.16
    const centers: THREE.Vector3[] = []

    const boxGeometry = new THREE.BoxGeometry(0.86, 0.52, 0.86)
    const edgeGeometry = new THREE.EdgesGeometry(boxGeometry)
    const blockMaterial = new THREE.MeshStandardMaterial({
      color: 0x14141a,
      metalness: 0.72,
      roughness: 0.34,
      envMapIntensity: 1.2,
    })
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xe0a64b,
      transparent: true,
      opacity: 0.85,
    })
    const markMaterial = new THREE.MeshBasicMaterial({ color: 0xf2d49a })

    const blocks: THREE.Group[] = []
    const markGeometry = new THREE.PlaneGeometry(0.18, 0.18)

    for (let i = 0; i < blockCount; i += 1) {
      const offset = i - (blockCount - 1) / 2
      const position = new THREE.Vector3(
        offset * spacing,
        Math.sin(i * 0.9) * 0.16,
        Math.cos(i * 0.7) * 0.12,
      )
      centers.push(position)

      const block = new THREE.Group()
      block.position.copy(position)

      const body = new THREE.Mesh(boxGeometry, blockMaterial)
      block.add(body)

      const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial)
      block.add(edges)

      const mark = new THREE.Mesh(markGeometry, markMaterial)
      mark.position.z = 0.431
      block.add(mark)

      const markBack = new THREE.Mesh(markGeometry, markMaterial)
      markBack.position.z = -0.431
      markBack.rotation.y = Math.PI
      block.add(markBack)

      chain.add(block)
      blocks.push(block)
    }

    // ----------------------------------------------------------------- links --
    const linkPoints: number[] = []
    for (let i = 0; i < centers.length - 1; i += 1) {
      linkPoints.push(centers[i].x, centers[i].y, centers[i].z)
      linkPoints.push(centers[i + 1].x, centers[i + 1].y, centers[i + 1].z)
    }
    const linkGeometry = new THREE.BufferGeometry()
    linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linkPoints, 3))
    const linkMaterial = new THREE.LineBasicMaterial({
      color: 0x8c8578,
      transparent: true,
      opacity: 0.38,
    })
    chain.add(new THREE.LineSegments(linkGeometry, linkMaterial))

    // --------------------------------------------------------------- packets --
    const packetGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07)
    const packetMaterial = new THREE.MeshBasicMaterial({ color: 0xf4d79a })
    const packets = [0, 1, 2].map((index) => {
      const packet = new THREE.Mesh(packetGeometry, packetMaterial)
      packet.userData.offset = index / 3
      chain.add(packet)
      return packet
    })

    // ------------------------------------------------------------- particles --
    const particleCount = 110
    const particlePositions = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i += 1) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 9
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 4.5
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 4
    }
    const particleGeometry = new THREE.BufferGeometry()
    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3),
    )
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xc9ced6,
      size: 0.022,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    })
    const particles = new THREE.Points(particleGeometry, particleMaterial)
    scene.add(particles)

    // ------------------------------------------------------------- lighting --
    scene.add(new THREE.AmbientLight(0xf4efe4, 0.7))
    const key = new THREE.DirectionalLight(0xfff0d2, 2.1)
    key.position.set(2.4, 3, 3.4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xe0a64b, 1.1)
    rim.position.set(-3, -1, -2)
    scene.add(rim)

    // A single additive sprite anchors the chain against the page void.
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = 256
    glowCanvas.height = 128
    const glowCtx = glowCanvas.getContext('2d')
    if (glowCtx) {
      const gradient = glowCtx.createRadialGradient(128, 64, 4, 128, 64, 128)
      gradient.addColorStop(0, 'rgba(224, 166, 75, 0.3)')
      gradient.addColorStop(0.45, 'rgba(201, 106, 58, 0.12)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      glowCtx.fillStyle = gradient
      glowCtx.fillRect(0, 0, 256, 128)
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
    glow.scale.set(7.4, 3.2, 1)
    glow.position.set(0, 0, -1.4)
    scene.add(glow)

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let inView = true
    let pageVisible = !document.hidden

    const resize = () => {
      const width = mount.clientWidth || 480
      const height = mount.clientHeight || 280
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

    const clock = new THREE.Clock()
    let elapsed = 0
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

      if (!reduceMotion) {
        const intro = Math.min(1, (performance.now() - introStart) / 900)
        blocks.forEach((block, index) => {
          const local = Math.max(0, Math.min(1, (intro - index * 0.12) / 0.4))
          const eased = 1 - Math.pow(1 - local, 3)
          block.scale.setScalar(eased)
        })

        chain.rotation.y = Math.sin(elapsed * 0.24) * 0.34
        chain.rotation.x = Math.sin(elapsed * 0.17) * 0.07
        chain.position.y = Math.sin(elapsed * 0.6) * 0.04

        packets.forEach((packet) => {
          const progress = (elapsed * 0.16 + packet.userData.offset) % 1
          const scaled = progress * (blockCount - 1)
          const index = Math.min(blockCount - 2, Math.floor(scaled))
          const local = scaled - index
          packet.position.lerpVectors(centers[index], centers[index + 1], local)
          packet.position.z += 0.05
        })

        particles.rotation.y = elapsed * 0.012
      } else {
        blocks.forEach((block) => block.scale.setScalar(1))
      }

      renderer.render(scene, camera)
    }

    frame()

    return () => {
      cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()

      boxGeometry.dispose()
      edgeGeometry.dispose()
      markGeometry.dispose()
      linkGeometry.dispose()
      packetGeometry.dispose()
      particleGeometry.dispose()
      blockMaterial.dispose()
      edgeMaterial.dispose()
      markMaterial.dispose()
      linkMaterial.dispose()
      packetMaterial.dispose()
      particleMaterial.dispose()
      glowTexture.dispose()
      glowMaterial.dispose()
      envMap?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  if (failed) {
    return (
      <div className="three-fallback three-fallback--wide">
        <span>Blockchain view unavailable</span>
      </div>
    )
  }

  return <div className="three-mount" ref={mountRef} aria-hidden="true" />
}
