import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createStudioEnvironment } from './environment'
import { KLYTH_LOGO_URL } from '../lib/assets'

/**
 * KLYTH coin.
 *
 * One physical coin built from real geometry rather than two painted discs:
 * a lathe-turned body with chamfered edges and a reeded band, a recessed front
 * medallion carrying the original KLYTH artwork, and a reverse face that is an
 * applied architectural clock — stepped chapter ring, raised Roman numerals,
 * minute track, counterweighted hands and a turned centre boss.
 *
 * Everything is generated at runtime (no model/font downloads). The renderer
 * only runs while the canvas is on screen and the tab is visible, and it is
 * capped at 1.75x device pixel ratio. Clock hands animate as geometry; the
 * dial is not repainted every frame.
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
    camera.position.set(0, 0, 5.45)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.domElement.className = 'three-canvas'
    mount.appendChild(renderer.domElement)

    // --------------------------------------------------------------- helpers --
    const geometries: THREE.BufferGeometry[] = []
    const materials: THREE.Material[] = []
    const textures: THREE.Texture[] = []
    const track = {
      geo: <T extends THREE.BufferGeometry>(value: T): T => {
        geometries.push(value)
        return value
      },
      mat: <T extends THREE.Material>(value: T): T => {
        materials.push(value)
        return value
      },
      tex: <T extends THREE.Texture>(value: T): T => {
        textures.push(value)
        return value
      },
    }

    const anisotropy = renderer.capabilities.getMaxAnisotropy()
    const FACE_SIZE = 1024
    const TAU = Math.PI * 2

    const makeTexture = (canvas: HTMLCanvasElement) => {
      const texture = track.tex(new THREE.CanvasTexture(canvas))
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = anisotropy
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      return texture
    }

    const newCanvas = () => {
      const canvas = document.createElement('canvas')
      canvas.width = FACE_SIZE
      canvas.height = FACE_SIZE
      return canvas
    }

    const circle = (
      ctx: CanvasRenderingContext2D,
      radius: number,
      width: number,
      style: string,
    ) => {
      ctx.strokeStyle = style
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.arc(FACE_SIZE / 2, FACE_SIZE / 2, radius, 0, TAU)
      ctx.stroke()
    }

    /** Fine engine-turned rings used on minted metal fields. */
    const engineTurning = (
      ctx: CanvasRenderingContext2D,
      from: number,
      to: number,
      step: number,
      strength: number,
    ) => {
      const c = FACE_SIZE / 2
      for (let r = from; r < to; r += step) {
        const major = Math.round((r - from) / step) % 9 === 0
        ctx.strokeStyle = major
          ? `rgba(255, 236, 189, ${strength * 1.5})`
          : `rgba(255, 226, 172, ${strength})`
        ctx.lineWidth = major ? 1.4 : 1
        ctx.beginPath()
        ctx.arc(c, c, r, 0, TAU)
        ctx.stroke()
      }
    }

    const cardinalFloret = (ctx: CanvasRenderingContext2D, radius: number) => {
      const c = FACE_SIZE / 2
      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * TAU - Math.PI / 2
        const x = c + Math.cos(angle) * radius
        const y = c + Math.sin(angle) * radius
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angle + Math.PI / 2)
        ctx.fillStyle = 'rgba(236, 205, 143, 0.34)'
        ctx.beginPath()
        ctx.moveTo(0, -9)
        ctx.quadraticCurveTo(3, -3, 0, 0)
        ctx.quadraticCurveTo(-3, -3, 0, -9)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(0, 9)
        ctx.quadraticCurveTo(3, 3, 0, 0)
        ctx.quadraticCurveTo(-3, 3, 0, 9)
        ctx.fill()
        ctx.restore()
      }
    }

    // ------------------------------------------------------------ front face --
    const frontCanvas = newCanvas()
    const frontCtx = frontCanvas.getContext('2d')
    if (frontCtx) {
      const c = FACE_SIZE / 2
      const field = frontCtx.createRadialGradient(
        c * 0.9,
        c * 0.82,
        c * 0.04,
        c,
        c,
        c,
      )
      field.addColorStop(0, '#be9a56')
      field.addColorStop(0.38, '#9c7739')
      field.addColorStop(0.72, '#6c5027')
      field.addColorStop(0.92, '#46331a')
      field.addColorStop(1, '#291d0d')
      frontCtx.fillStyle = field
      frontCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)

      engineTurning(frontCtx, 96, c - 22, 4, 0.028)

      // Faint radial burnishing across the field.
      for (let i = 0; i < 200; i += 1) {
        const angle = (i / 200) * TAU
        frontCtx.strokeStyle = 'rgba(255, 232, 184, 0.018)'
        frontCtx.lineWidth = 1
        frontCtx.beginPath()
        frontCtx.moveTo(c + Math.cos(angle) * 120, c + Math.sin(angle) * 120)
        frontCtx.lineTo(c + Math.cos(angle) * (c - 24), c + Math.sin(angle) * (c - 24))
        frontCtx.stroke()
      }

      circle(frontCtx, c - 26, 5, 'rgba(247, 220, 163, 0.52)')
      circle(frontCtx, c - 42, 2, 'rgba(247, 220, 163, 0.3)')
      circle(frontCtx, c * 0.79, 2, 'rgba(30, 20, 8, 0.55)')
      circle(frontCtx, c * 0.79, 1, 'rgba(255, 231, 178, 0.28)')

      // Recessed medallion field so the white KALYTH mark reads clearly.
      const wellRadius = c * 0.725
      const well = frontCtx.createRadialGradient(c, c * 0.96, c * 0.05, c, c, wellRadius)
      well.addColorStop(0, '#2d2313')
      well.addColorStop(0.55, '#1a140b')
      well.addColorStop(1, '#0b0805')
      frontCtx.fillStyle = well
      frontCtx.beginPath()
      frontCtx.arc(c, c, wellRadius, 0, TAU)
      frontCtx.fill()

      // Embossed rim: light above, shadow below.
      frontCtx.lineWidth = 7
      frontCtx.strokeStyle = 'rgba(255, 231, 178, 0.35)'
      frontCtx.beginPath()
      frontCtx.arc(c, c, wellRadius + 4, Math.PI * 1.08, Math.PI * 1.92)
      frontCtx.stroke()
      frontCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
      frontCtx.beginPath()
      frontCtx.arc(c, c, wellRadius + 4, Math.PI * 0.08, Math.PI * 0.92)
      frontCtx.stroke()

      const vignette = frontCtx.createRadialGradient(c, c, c * 0.62, c, c, c)
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.42)')
      frontCtx.fillStyle = vignette
      frontCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
    }

    const frontTexture = makeTexture(frontCanvas)
    let disposed = false

    if (frontCtx) {
      const logo = new Image()
      logo.src = KLYTH_LOGO_URL
      logo.onload = () => {
        if (disposed) {
          return
        }
        const c = FACE_SIZE / 2
        const radius = c * 0.76
        frontCtx.save()
        frontCtx.beginPath()
        frontCtx.arc(c, c, radius, 0, TAU)
        frontCtx.clip()
        // The mark's dark field disappears; its light ring lifts off the metal.
        frontCtx.globalCompositeOperation = 'screen'
        frontCtx.globalAlpha = 0.97
        // Contain the asset in a square without stretching its aspect ratio.
        const fit = Math.min(
          (radius * 2) / logo.naturalWidth,
          (radius * 2) / logo.naturalHeight,
        )
        const drawWidth = logo.naturalWidth * fit
        const drawHeight = logo.naturalHeight * fit
        frontCtx.drawImage(
          logo,
          c - drawWidth / 2,
          c - drawHeight / 2,
          drawWidth,
          drawHeight,
        )
        frontCtx.restore()
        frontTexture.needsUpdate = true
      }
    }

    // ------------------------------------------------------- reverse textures --
    const backCanvas = newCanvas()
    const backCtx = backCanvas.getContext('2d')
    if (backCtx) {
      const c = FACE_SIZE / 2
      const field = backCtx.createRadialGradient(c * 0.9, c * 0.8, c * 0.05, c, c, c)
      field.addColorStop(0, '#5b4827')
      field.addColorStop(0.42, '#3e3019')
      field.addColorStop(0.74, '#251d10')
      field.addColorStop(0.94, '#14100a')
      field.addColorStop(1, '#0a0907')
      backCtx.fillStyle = field
      backCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)

      engineTurning(backCtx, 120, c - 18, 5, 0.03)

      // Engraved border bands and the twelve small mint florets.
      circle(backCtx, c - 22, 5, 'rgba(236, 205, 143, 0.42)')
      circle(backCtx, c - 38, 2, 'rgba(236, 205, 143, 0.24)')
      circle(backCtx, c - 58, 1, 'rgba(236, 205, 143, 0.16)')
      circle(backCtx, c * 0.79, 1, 'rgba(236, 205, 143, 0.14)')
      cardinalFloret(backCtx, c - 50)

      const vignette = backCtx.createRadialGradient(c, c, c * 0.76, c, c, c)
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
      backCtx.fillStyle = vignette
      backCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
    }
    const backTexture = makeTexture(backCanvas)

    const chapterCanvas = newCanvas()
    const chapterCtx = chapterCanvas.getContext('2d')
    if (chapterCtx) {
      const c = FACE_SIZE / 2
      const gilt = chapterCtx.createRadialGradient(
        c * 0.86,
        c * 0.8,
        c * 0.28,
        c,
        c,
        c,
      )
      gilt.addColorStop(0, '#a07d3e')
      gilt.addColorStop(0.5, '#7d612d')
      gilt.addColorStop(0.82, '#58431e')
      gilt.addColorStop(1, '#2f220f')
      chapterCtx.fillStyle = gilt
      chapterCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
      engineTurning(chapterCtx, c * 0.36, c * 0.52, 3, 0.055)

      // Brushed, slightly mottled metal.
      for (let i = 0; i < 140; i += 1) {
        const angle = (i / 140) * TAU + 0.02
        chapterCtx.strokeStyle = `rgba(255, 233, 186, ${0.012 + (i % 5) * 0.004})`
        chapterCtx.lineWidth = 1.5 + (i % 3)
        chapterCtx.beginPath()
        chapterCtx.arc(
          c,
          c,
          c * (0.38 + (i % 7) * 0.018),
          angle,
          angle + 0.55,
        )
        chapterCtx.stroke()
      }
    }
    const chapterTexture = makeTexture(chapterCanvas)

    const dialCanvas = newCanvas()
    const dialCtx = dialCanvas.getContext('2d')
    if (dialCtx) {
      const c = FACE_SIZE / 2
      const dial = dialCtx.createRadialGradient(
        c * 0.92,
        c * 0.88,
        c * 0.04,
        c,
        c,
        c,
      )
      dial.addColorStop(0, '#3a3021')
      dial.addColorStop(0.5, '#241e16')
      dial.addColorStop(1, '#0c0a07')
      dialCtx.fillStyle = dial
      dialCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)

      engineTurning(dialCtx, 70, c - 6, 3, 0.022)

      // Fine sunburst lines radiate from the arbor.
      for (let i = 0; i < 240; i += 1) {
        const angle = (i / 240) * TAU
        dialCtx.strokeStyle = 'rgba(236, 205, 143, 0.024)'
        dialCtx.lineWidth = 1
        dialCtx.beginPath()
        dialCtx.moveTo(c + Math.cos(angle) * 26, c + Math.sin(angle) * 26)
        dialCtx.lineTo(c + Math.cos(angle) * (c - 4), c + Math.sin(angle) * (c - 4))
        dialCtx.stroke()
      }

      circle(dialCtx, c * 0.93, 2, 'rgba(236, 205, 143, 0.2)')
      circle(dialCtx, c * 0.7, 1, 'rgba(236, 205, 143, 0.12)')

      const vignette = dialCtx.createRadialGradient(c, c, c * 0.4, c, c, c)
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.62)')
      dialCtx.fillStyle = vignette
      dialCtx.fillRect(0, 0, FACE_SIZE, FACE_SIZE)
    }
    const dialTexture = makeTexture(dialCanvas)

    // ------------------------------------------------------------- materials --
    const gold = track.mat(
      new THREE.MeshStandardMaterial({
        color: 0xc7974b,
        metalness: 0.9,
        roughness: 0.32,
        envMapIntensity: 1.25,
      }),
    )
    const goldBright = track.mat(
      new THREE.MeshStandardMaterial({
        color: 0xf0cd85,
        metalness: 0.9,
        roughness: 0.26,
        envMapIntensity: 1.35,
      }),
    )
    const goldDark = track.mat(
      new THREE.MeshStandardMaterial({
        color: 0x9a7033,
        metalness: 0.86,
        roughness: 0.38,
        envMapIntensity: 1.1,
      }),
    )
    const frontMaterial = track.mat(
      new THREE.MeshStandardMaterial({
        map: frontTexture,
        metalness: 0.44,
        roughness: 0.4,
        envMapIntensity: 1.3,
      }),
    )
    const backMaterial = track.mat(
      new THREE.MeshStandardMaterial({
        map: backTexture,
        metalness: 0.46,
        roughness: 0.42,
        envMapIntensity: 1.25,
      }),
    )
    const chapterMaterial = track.mat(
      new THREE.MeshStandardMaterial({
        map: chapterTexture,
        metalness: 0.62,
        roughness: 0.36,
        envMapIntensity: 1.3,
      }),
    )
    const dialMaterial = track.mat(
      new THREE.MeshStandardMaterial({
        map: dialTexture,
        metalness: 0.42,
        roughness: 0.46,
        envMapIntensity: 1.1,
      }),
    )

    // ------------------------------------------------------------ coin build --
    const R = 1.5
    const T = 0.3
    const FACE_Z = T / 2 - 0.03
    const coin = new THREE.Group()
    scene.add(coin)

    const profile = [
      new THREE.Vector2(R - 0.055, -T / 2),
      new THREE.Vector2(R - 0.012, -T / 2 + 0.006),
      new THREE.Vector2(R - 0.002, -T / 2 + 0.024),
      new THREE.Vector2(R, -T / 2 + 0.046),
      new THREE.Vector2(R, T / 2 - 0.046),
      new THREE.Vector2(R - 0.002, T / 2 - 0.024),
      new THREE.Vector2(R - 0.012, T / 2 - 0.006),
      new THREE.Vector2(R - 0.055, T / 2),
    ]
    const bodyGeometry = track.geo(new THREE.LatheGeometry(profile, 200))
    bodyGeometry.rotateX(Math.PI / 2)
    const body = new THREE.Mesh(bodyGeometry, gold)
    coin.add(body)

    // Reeded (milled) edge: fine raised reeds around the cylindrical band.
    const REEDS = 156
    const reedGeometry = track.geo(new THREE.BoxGeometry(0.014, 0.022, 0.185))
    const reeds = new THREE.InstancedMesh(reedGeometry, goldDark, REEDS)
    const reedMatrix = new THREE.Object3D()
    for (let i = 0; i < REEDS; i += 1) {
      const angle = (i / REEDS) * TAU
      reedMatrix.position.set(Math.cos(angle) * R, Math.sin(angle) * R, 0)
      reedMatrix.rotation.set(0, 0, angle)
      reedMatrix.scale.set(1, 1, 1)
      reedMatrix.updateMatrix()
      reeds.setMatrixAt(i, reedMatrix.matrix)
    }
    reeds.instanceMatrix.needsUpdate = true
    coin.add(reeds)

    const bezelGeometry = track.geo(new THREE.TorusGeometry(R - 0.072, 0.019, 12, 220))
    const addBezel = (z: number) => {
      const bezel = new THREE.Mesh(bezelGeometry, goldBright)
      bezel.position.z = z
      bezel.scale.z = 0.62
      return bezel
    }
    coin.add(addBezel(FACE_Z + 0.016))

    const frontPlateGeometry = track.geo(new THREE.CircleGeometry(R - 0.056, 160))
    const frontPlate = new THREE.Mesh(frontPlateGeometry, frontMaterial)
    frontPlate.position.z = FACE_Z
    coin.add(frontPlate)

    // Raised die ring framing the KALYTH medallion.
    const logoRingGeometry = track.geo(new THREE.TorusGeometry(1.045, 0.009, 8, 180))
    const logoRing = new THREE.Mesh(logoRingGeometry, goldDark)
    logoRing.position.z = FACE_Z + 0.008
    logoRing.scale.z = 0.55
    coin.add(logoRing)

    // ---------------------------------------------------------- reverse group --
    // Local +z points out of the reverse face; the group is turned to the back.
    const reverse = new THREE.Group()
    reverse.rotation.y = Math.PI
    coin.add(reverse)

    reverse.add(addBezel(FACE_Z + 0.016))

    const backPlateGeometry = track.geo(new THREE.CircleGeometry(R - 0.056, 160))
    const backPlate = new THREE.Mesh(backPlateGeometry, backMaterial)
    backPlate.position.z = FACE_Z
    reverse.add(backPlate)

    // Stepped chapter ring carries the numerals and the minute track.
    const chapterGeometry = track.geo(new THREE.RingGeometry(0.86, 1.135, 200, 1))
    const chapter = new THREE.Mesh(chapterGeometry, chapterMaterial)
    chapter.position.z = FACE_Z + 0.012
    reverse.add(chapter)

    const dialGeometry = track.geo(new THREE.CircleGeometry(0.858, 160))
    const dial = new THREE.Mesh(dialGeometry, dialMaterial)
    // Sits on the faceplate but below the raised chapter ring, so the engraved
    // guilloché reads as a recessed dial rather than a decal.
    dial.position.z = FACE_Z + 0.003
    reverse.add(dial)

    const chapterEdgeGeometry = track.geo(new THREE.TorusGeometry(0.858, 0.009, 8, 180))
    const chapterEdge = new THREE.Mesh(chapterEdgeGeometry, gold)
    chapterEdge.position.z = FACE_Z + 0.014
    chapterEdge.scale.z = 0.6
    reverse.add(chapterEdge)

    const chapterOuterGeometry = track.geo(new THREE.TorusGeometry(1.135, 0.008, 8, 200))
    const chapterOuter = new THREE.Mesh(chapterOuterGeometry, gold)
    chapterOuter.position.z = FACE_Z + 0.014
    chapterOuter.scale.z = 0.6
    reverse.add(chapterOuter)

    // A short turned wall gives the raised chapter ring real edge thickness
    // instead of reading as a sheet hovering over the faceplate.
    const chapterWallGeometry = track.geo(
      new THREE.CylinderGeometry(1.135, 1.135, 0.014, 200, 1, true),
    )
    chapterWallGeometry.rotateX(Math.PI / 2)
    const chapterWall = new THREE.Mesh(chapterWallGeometry, goldDark)
    chapterWall.position.z = FACE_Z + 0.006
    reverse.add(chapterWall)

    // Fine border rail on the outer field.
    const outerRailGeometry = track.geo(new THREE.TorusGeometry(1.3, 0.005, 6, 200))
    const outerRail = new THREE.Mesh(outerRailGeometry, gold)
    outerRail.position.z = FACE_Z + 0.004
    outerRail.scale.z = 0.5
    reverse.add(outerRail)

    // Minute and hour ticks, standing proud of the chapter ring.
    const tickGeometry = track.geo(new THREE.BoxGeometry(1, 1, 1))
    const tickMatrix = new THREE.Object3D()
    const ticks = new THREE.InstancedMesh(tickGeometry, goldBright, 60)
    for (let i = 0; i < 60; i += 1) {
      const angle = (i / 60) * TAU
      const major = i % 5 === 0
      const length = major ? 0.085 : 0.046
      const width = major ? 0.021 : 0.01
      const radius = 1.11 - length / 2
      tickMatrix.position.set(
        Math.sin(angle) * radius,
        Math.cos(angle) * radius,
        FACE_Z + 0.022,
      )
      tickMatrix.rotation.set(0, 0, -angle)
      tickMatrix.scale.set(width, length, 0.013)
      tickMatrix.updateMatrix()
      ticks.setMatrixAt(i, tickMatrix.matrix)
    }
    ticks.instanceMatrix.needsUpdate = true
    reverse.add(ticks)

    // Applied Roman numerals built from solid bronze bars with the slim, upright
    // proportions of a Victorian chapter ring.
    type Stroke = { x: number; y: number; rot: number; w: number; h: number }
    const glyphs: Record<'I' | 'V' | 'X', { width: number; strokes: Stroke[] }> = {
      I: { width: 0.26, strokes: [{ x: 0, y: 0, rot: 0, w: 0.1, h: 0.96 }] },
      V: {
        width: 0.56,
        strokes: [
          { x: -0.16, y: 0, rot: 0.18, w: 0.105, h: 1 },
          { x: 0.16, y: 0, rot: -0.18, w: 0.105, h: 1 },
        ],
      },
      X: {
        width: 0.56,
        strokes: [
          { x: 0, y: 0, rot: 0.34, w: 0.095, h: 0.98 },
          { x: 0, y: 0, rot: -0.34, w: 0.095, h: 0.98 },
        ],
      },
    }
    const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
    const unitBar = new THREE.BoxGeometry(1, 1, 1)
    const numeralParts: THREE.BufferGeometry[] = []
    const numeralHeight = 0.165
    const numeralRadius = 0.97
    const glyphGap = 0.13
    const quaternion = new THREE.Quaternion()
    const zAxis = new THREE.Vector3(0, 0, 1)

    numerals.forEach((label, hour) => {
      const letters = label.split('') as Array<'I' | 'V' | 'X'>
      const totalWidth =
        letters.reduce((sum, letter) => sum + glyphs[letter].width, 0) +
        glyphGap * (letters.length - 1)
      let cursor = -totalWidth / 2
      // The array starts at I, which belongs at 1 o'clock. Shift by one hour
      // so XII lands on the 12 o'clock tick and III on the 3 o'clock tick.
      const angle = ((hour + 1) / 12) * TAU
      const centreX = Math.sin(angle) * numeralRadius
      const centreY = Math.cos(angle) * numeralRadius

      for (const letter of letters) {
        const glyph = glyphs[letter]
        const letterCentre = cursor + glyph.width / 2
        for (const stroke of glyph.strokes) {
          const bar = unitBar.clone()
          quaternion.setFromAxisAngle(zAxis, stroke.rot)
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(
              centreX + (letterCentre + stroke.x) * numeralHeight,
              centreY + stroke.y * numeralHeight,
              FACE_Z + 0.026,
            ),
            quaternion,
            new THREE.Vector3(
              stroke.w * numeralHeight,
              stroke.h * numeralHeight,
              0.014,
            ),
          )
          bar.applyMatrix4(matrix)
          numeralParts.push(bar)
        }
        cursor += glyph.width + glyphGap
      }
    })

    const mergedNumerals = mergeGeometries(numeralParts, false)
    numeralParts.forEach((part) => part.dispose())
    unitBar.dispose()
    if (mergedNumerals) {
      const numeralMesh = new THREE.Mesh(track.geo(mergedNumerals), goldBright)
      reverse.add(numeralMesh)
    }

    // Beaded ring between the chapter and the coin border.
    const beadGeometry = track.geo(new THREE.SphereGeometry(0.0085, 8, 6))
    const BEADS = 120
    const beads = new THREE.InstancedMesh(beadGeometry, gold, BEADS)
    const beadMatrix = new THREE.Object3D()
    for (let i = 0; i < BEADS; i += 1) {
      const angle = (i / BEADS) * TAU
      beadMatrix.position.set(
        Math.sin(angle) * 1.175,
        Math.cos(angle) * 1.175,
        FACE_Z + 0.014,
      )
      beadMatrix.scale.set(1, 1, 0.65)
      beadMatrix.updateMatrix()
      beads.setMatrixAt(i, beadMatrix.matrix)
    }
    beads.instanceMatrix.needsUpdate = true
    reverse.add(beads)

    // ------------------------------------------------------------- clock hands --
    const handShape = (points: Array<[number, number]>) => {
      const shape = new THREE.Shape()
      shape.moveTo(points[0][0], points[0][1])
      for (let i = 1; i < points.length; i += 1) {
        shape.lineTo(points[i][0], points[i][1])
      }
      shape.closePath()
      return shape
    }

    const extrudeHand = (points: Array<[number, number]>, depth: number) =>
      track.geo(
        new THREE.ExtrudeGeometry(handShape(points), {
          depth,
          bevelEnabled: true,
          bevelSize: 0.0028,
          bevelThickness: 0.0028,
          bevelSegments: 2,
          steps: 1,
        }),
      )

    const hourGeometry = extrudeHand(
      [
        [-0.028, -0.115],
        [-0.024, 0.2],
        [-0.062, 0.275],
        [0, 0.52],
        [0.062, 0.275],
        [0.024, 0.2],
        [0.028, -0.115],
      ],
      0.012,
    )
    const minuteGeometry = extrudeHand(
      [
        [-0.019, -0.13],
        [-0.016, 0.46],
        [-0.045, 0.535],
        [0, 0.76],
        [0.045, 0.535],
        [0.016, 0.46],
        [0.019, -0.13],
      ],
      0.011,
    )

    const hourPivot = new THREE.Group()
    hourPivot.position.z = FACE_Z + 0.034
    const hourHand = new THREE.Mesh(hourGeometry, goldBright)
    hourPivot.add(hourHand)
    reverse.add(hourPivot)

    const minutePivot = new THREE.Group()
    minutePivot.position.z = FACE_Z + 0.046
    const minuteHand = new THREE.Mesh(minuteGeometry, goldBright)
    minutePivot.add(minuteHand)
    reverse.add(minutePivot)

    const secondPivot = new THREE.Group()
    secondPivot.position.z = FACE_Z + 0.058
    const secondGeometry = track.geo(new THREE.BoxGeometry(0.011, 0.9, 0.008))
    const secondHand = new THREE.Mesh(secondGeometry, goldDark)
    secondHand.position.y = 0.34
    secondPivot.add(secondHand)
    const counterweightGeometry = track.geo(new THREE.TorusGeometry(0.03, 0.006, 8, 28))
    const counterweight = new THREE.Mesh(counterweightGeometry, goldDark)
    counterweight.position.y = -0.15
    secondPivot.add(counterweight)
    reverse.add(secondPivot)

    // Turned centre boss and the small jewels of the mechanism.
    const bossGeometry = track.geo(new THREE.CylinderGeometry(0.058, 0.07, 0.032, 40))
    bossGeometry.rotateX(Math.PI / 2)
    const boss = new THREE.Mesh(bossGeometry, gold)
    boss.position.z = FACE_Z + 0.064
    reverse.add(boss)

    const bossCapGeometry = track.geo(new THREE.SphereGeometry(0.052, 32, 16))
    const bossCap = new THREE.Mesh(bossCapGeometry, goldBright)
    bossCap.scale.set(1, 1, 0.55)
    bossCap.position.z = FACE_Z + 0.08
    reverse.add(bossCap)

    const pinGeometry = track.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.012, 16))
    pinGeometry.rotateX(Math.PI / 2)
    const pin = new THREE.Mesh(pinGeometry, goldDark)
    pin.position.z = FACE_Z + 0.094
    reverse.add(pin)

    const jewelGeometry = track.geo(new THREE.SphereGeometry(0.011, 8, 6))
    const JEWELS = 8
    const jewels = new THREE.InstancedMesh(jewelGeometry, goldBright, JEWELS)
    const jewelMatrix = new THREE.Object3D()
    for (let i = 0; i < JEWELS; i += 1) {
      const angle = (i / JEWELS) * TAU
      jewelMatrix.position.set(Math.cos(angle) * 0.105, Math.sin(angle) * 0.105, FACE_Z + 0.022)
      jewelMatrix.updateMatrix()
      jewels.setMatrixAt(i, jewelMatrix.matrix)
    }
    jewels.instanceMatrix.needsUpdate = true
    reverse.add(jewels)

    // ------------------------------------------------------------- environment --
    const envMap = createStudioEnvironment(renderer)
    if (envMap) {
      scene.environment = envMap
    }

    const ambient = new THREE.AmbientLight(0xf6efe2, 0.24)
    scene.add(ambient)

    // A warm sky / cool ground bounce keeps the broad gold fields legible
    // without flattening the controlled metallic highlights.
    const bounce = new THREE.HemisphereLight(0xffe8c2, 0x1b1510, 0.5)
    scene.add(bounce)

    const key = new THREE.DirectionalLight(0xfff1d6, 1.7)
    key.position.set(2.6, 3.1, 3.6)
    scene.add(key)

    const fill = new THREE.DirectionalLight(0xcfd6e6, 0.62)
    fill.position.set(-3.4, -0.8, 2.2)
    scene.add(fill)

    const rim = new THREE.DirectionalLight(0xe0a64b, 0.9)
    rim.position.set(-2.6, 2.2, -3.4)
    scene.add(rim)

    // ------------------------------------------------------------------- halo --
    const glowCanvas = document.createElement('canvas')
    glowCanvas.width = 256
    glowCanvas.height = 256
    const glowCtx = glowCanvas.getContext('2d')
    if (glowCtx) {
      const gradient = glowCtx.createRadialGradient(128, 128, 4, 128, 128, 110)
      gradient.addColorStop(0, 'rgba(224, 166, 75, 0.14)')
      gradient.addColorStop(0.35, 'rgba(212, 130, 62, 0.085)')
      gradient.addColorStop(0.65, 'rgba(201, 106, 58, 0.035)')
      gradient.addColorStop(0.85, 'rgba(201, 106, 58, 0.01)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      glowCtx.fillStyle = gradient
      glowCtx.fillRect(0, 0, 256, 256)
    }
    const glowTexture = makeTexture(glowCanvas)
    const glowMaterial = track.mat(
      new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    const glow = new THREE.Sprite(glowMaterial)
    glow.scale.set(4.9, 4.9, 1)
    glow.position.z = -1.5
    scene.add(glow)

    // --------------------------------------------------------------- particles --
    const starCount = 80
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i += 1) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const distance = 2.6 + Math.random() * 2.4
      starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * distance
      starPositions[i * 3 + 1] = Math.cos(phi) * distance
      starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * distance - 1.2
    }
    const starGeometry = track.geo(new THREE.BufferGeometry())
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMaterial = track.mat(
      new THREE.PointsMaterial({
        color: 0xc9ced6,
        size: 0.022,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    )
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
        manualRotationY += deltaX * 0.0075
        manualRotationX = THREE.MathUtils.clamp(
          manualRotationX + deltaY * 0.0075,
          -0.55,
          0.55,
        )
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
        mount.setPointerCapture?.(event.pointerId)
      }
    }
    const onPointerUp = (event: PointerEvent) => {
      isDragging = false
      if (mount.hasPointerCapture?.(event.pointerId)) {
        mount.releasePointerCapture(event.pointerId)
      }
    }

    mount.addEventListener('pointermove', onPointerMove)
    mount.addEventListener('pointerenter', onPointerEnter)
    mount.addEventListener('pointerleave', onPointerLeave)
    mount.addEventListener('pointerdown', onPointerDown)
    mount.addEventListener('pointerup', onPointerUp)
    mount.addEventListener('pointercancel', onPointerUp)

    // ------------------------------------------------------------------ resize --
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

    // -------------------------------------------------------------------- loop --
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

      // Real time, smooth mechanical sweep.
      const now = Date.now() / 1000
      const seconds = now % 60
      const minutes = (now / 60) % 60
      const hours = (now / 3600) % 12
      hourPivot.rotation.z = -(hours / 12) * TAU
      minutePivot.rotation.z = -(minutes / 60) * TAU
      secondPivot.rotation.z = -(seconds / 60) * TAU

      const introProgress = Math.min(1, (performance.now() - introStart) / 1400)
      const eased = 1 - Math.pow(1 - introProgress, 3)

      const baseTiltX = THREE.MathUtils.lerp(-1.15, -0.06, eased)
      const targetScale = THREE.MathUtils.lerp(0.78, 1, eased)

      const targetTiltX = hovered && !isDragging ? -pointer.y * 0.28 : 0
      const targetTiltZ = hovered && !isDragging ? pointer.x * 0.14 : 0
      const damping = Math.min(1, delta * 6)

      tiltX += (targetTiltX - tiltX) * damping
      tiltZ += (targetTiltZ - tiltZ) * damping
      scale += (targetScale - scale) * damping

      if (!hovered) {
        spin += delta * 0.17
      }

      coin.rotation.x = baseTiltX + tiltX + manualRotationX
      coin.rotation.y = spin + manualRotationY
      coin.rotation.z = tiltZ
      coin.position.y = Math.sin(elapsed * 0.85) * 0.03
      coin.scale.setScalar(scale)

      stars.rotation.y = elapsed * 0.02
      stars.rotation.x = Math.sin(elapsed * 0.12) * 0.05

      if (hovered) {
        key.position.x = 2.6 + pointer.x * 1.5
        key.position.y = 3.1 - pointer.y * 1.3
      } else {
        key.position.x += (2.6 - key.position.x) * damping
        key.position.y += (3.1 - key.position.y) * damping
      }

      renderer.render(scene, camera)
    }

    frame()

    return () => {
      disposed = true
      cancelAnimationFrame(frameId)
      mount.removeEventListener('pointermove', onPointerMove)
      mount.removeEventListener('pointerenter', onPointerEnter)
      mount.removeEventListener('pointerleave', onPointerLeave)
      mount.removeEventListener('pointerdown', onPointerDown)
      mount.removeEventListener('pointerup', onPointerUp)
      mount.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()

      geometries.forEach((geometry) => geometry.dispose())
      materials.forEach((material) => material.dispose())
      textures.forEach((texture) => texture.dispose())
      envMap?.dispose()
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
