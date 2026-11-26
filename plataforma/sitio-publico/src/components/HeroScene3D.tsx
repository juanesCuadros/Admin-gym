import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

interface AnimatedPart {
  mesh: THREE.Object3D
  targetX: number
  startX: number
  delay: number
  duration: number
}

function easeOutBack(t: number): number {
  const c1 = 1.45
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * Escena 3D interactiva (Three.js) para el Hero de GymDesk:
 * Mancuerna olímpica de precisión que se arma progresivamente con 3 discos por lado
 * (de mayor a menor) + seguros de cierre en #0066EE.
 * El usuario puede arrastrar con el mouse o dedo para girarla libremente en 3D con inercia.
 */
export default function HeroScene3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [webglFallback, setWebglFallback] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
    } catch {
      setWebglFallback(true)
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(dpr)
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.18
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      38,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100,
    )
    camera.position.set(0, 0.35, 7.6)
    camera.lookAt(0, 0, 0)

    // ---------- Iluminación de estudio claro (Blanco + Azul #0066EE) ----------
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45)
    scene.add(ambientLight)

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.3)
    keyLight.position.set(5, 7, 6)
    scene.add(keyLight)

    const blueRimLight = new THREE.PointLight(0x0066ee, 4.8, 22)
    blueRimLight.position.set(-5, 3.2, 4.5)
    scene.add(blueRimLight)

    const skyFillLight = new THREE.PointLight(0x3388ff, 3.2, 18)
    skyFillLight.position.set(4.5, -3.2, 4.5)
    scene.add(skyFillLight)

    const backLight = new THREE.DirectionalLight(0xdbeafe, 1.4)
    backLight.position.set(0, 2, -6)
    scene.add(backLight)

    // ---------- Materiales industriales ----------
    const chromeSteel = new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.16,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
    })

    const knurledSteel = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.42,
    })

    const obsidianRubber = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      metalness: 0.35,
      roughness: 0.34,
      clearcoat: 0.55,
      clearcoatRoughness: 0.25,
    })

    const darkGraphite = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      metalness: 0.48,
      roughness: 0.28,
      clearcoat: 0.65,
      clearcoatRoughness: 0.2,
    })

    const ceramicWhite = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      metalness: 0.2,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    })

    const brandBlue = new THREE.MeshPhysicalMaterial({
      color: 0x0066ee,
      emissive: 0x0052cc,
      emissiveIntensity: 0.35,
      metalness: 0.58,
      roughness: 0.18,
      clearcoat: 1.0,
    })

    const brightBlue = new THREE.MeshStandardMaterial({
      color: 0x3388ff,
      emissive: 0x0066ee,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.2,
    })

    // ---------- Grupo principal de la mancuerna ----------
    const dumbbellGroup = new THREE.Group()
    scene.add(dumbbellGroup)

    // 1. Barra olímpica central (orientada a lo largo del eje X)
    const barLength = 4.35
    const barGeo = new THREE.CylinderGeometry(0.115, 0.115, barLength, 32)
    barGeo.rotateZ(Math.PI / 2)
    const barMesh = new THREE.Mesh(barGeo, chromeSteel)
    dumbbellGroup.add(barMesh)

    // Empuñadura central moleteada (knurling visual con anillos de agarre)
    const gripGeo = new THREE.CylinderGeometry(0.132, 0.132, 1.32, 32)
    gripGeo.rotateZ(Math.PI / 2)
    const gripMesh = new THREE.Mesh(gripGeo, knurledSteel)
    dumbbellGroup.add(gripMesh)

    // Ranuras de precisión en el agarre
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.133, 0.008, 10, 32),
        i % 3 === 0 ? brandBlue : obsidianRubber,
      )
      ring.rotation.y = Math.PI / 2
      ring.position.x = i * 0.105
      dumbbellGroup.add(ring)
    }

    // Topes interiores de la barra (donde apoya el primer disco)
    for (const side of [-1, 1]) {
      const stopperGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 32)
      stopperGeo.rotateZ(Math.PI / 2)
      const stopper = new THREE.Mesh(stopperGeo, chromeSteel)
      stopper.position.x = side * 0.78
      dumbbellGroup.add(stopper)

      const stopperAccent = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.014, 12, 32),
        brandBlue,
      )
      stopperAccent.rotation.y = Math.PI / 2
      stopperAccent.position.x = side * 0.78
      dumbbellGroup.add(stopperAccent)
    }

    // ---------- Constructor de discos realistas (biselado + aro de color + centro metálico) ----------
    function createWeightPlate(
      radius: number,
      thickness: number,
      bodyMat: THREE.Material,
      accentMat: THREE.Material,
    ): THREE.Group {
      const plate = new THREE.Group()

      // Cuerpo principal del disco
      const bodyGeo = new THREE.CylinderGeometry(radius, radius, thickness, 48)
      bodyGeo.rotateZ(Math.PI / 2)
      const body = new THREE.Mesh(bodyGeo, bodyMat)
      plate.add(body)

      // Bordes biselados (torus en ambos cantos para volumen real)
      const bevelRadius = thickness * 0.42
      const rimGeo = new THREE.TorusGeometry(radius - bevelRadius * 0.45, bevelRadius, 18, 48)
      rimGeo.rotateY(Math.PI / 2)
      const rim = new THREE.Mesh(rimGeo, bodyMat)
      plate.add(rim)

      // Aros luminosos en azul #0066EE en ambas caras
      for (const face of [-1, 1]) {
        const stripe = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 0.74, 0.022, 14, 48),
          accentMat,
        )
        stripe.rotation.y = Math.PI / 2
        stripe.position.x = face * (thickness * 0.5 + 0.005)
        plate.add(stripe)

        // Buje central metálico
        const hubGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 28)
        hubGeo.rotateZ(Math.PI / 2)
        const hub = new THREE.Mesh(hubGeo, chromeSteel)
        hub.position.x = face * (thickness * 0.5)
        plate.add(hub)
      }

      return plate
    }

    // ---------- 3 discos por lado (de mayor a menor hacia afuera) + seguro ----------
    const plateSpecs = [
      { radius: 1.24, thickness: 0.25, offset: 0.99, bodyMat: obsidianRubber, accentMat: brandBlue, delay: 0.25 },
      { radius: 0.98, thickness: 0.23, offset: 1.27, bodyMat: darkGraphite, accentMat: brightBlue, delay: 0.65 },
      { radius: 0.74, thickness: 0.21, offset: 1.53, bodyMat: ceramicWhite, accentMat: brandBlue, delay: 1.05 },
    ]

    const animatedParts: AnimatedPart[] = []

    for (const spec of plateSpecs) {
      for (const side of [-1, 1]) {
        const plate = createWeightPlate(spec.radius, spec.thickness, spec.bodyMat, spec.accentMat)
        const targetX = side * spec.offset
        const startX = side * (spec.offset + 3.2)
        plate.position.x = reducedMotion ? targetX : startX
        dumbbellGroup.add(plate)

        animatedParts.push({
          mesh: plate,
          targetX,
          startX,
          delay: spec.delay,
          duration: 0.72,
        })
      }
    }

    // Seguros olímpicos de cierre en #0066EE
    for (const side of [-1, 1]) {
      const collar = new THREE.Group()
      const collarGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.18, 28)
      collarGeo.rotateZ(Math.PI / 2)
      collar.add(new THREE.Mesh(collarGeo, brandBlue))

      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.08), chromeSteel)
      latch.position.y = 0.18
      collar.add(latch)

      const targetX = side * 1.77
      const startX = side * 4.7
      collar.position.x = reducedMotion ? targetX : startX
      dumbbellGroup.add(collar)

      animatedParts.push({
        mesh: collar,
        targetX,
        startX,
        delay: 1.42,
        duration: 0.55,
      })
    }

    // Partículas ambientales sutiles en azul #0066EE
    const particleCount = window.innerWidth < 768 ? 70 : 130
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const cBlue = new THREE.Color(0x0066ee)
    const cSky = new THREE.Color(0x3388ff)
    const cSlate = new THREE.Color(0x94a3b8)

    for (let i = 0; i < particleCount; i++) {
      const r = 3.2 + Math.random() * 4.2
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7
      positions[i * 3 + 2] = (Math.random() - 0.5) * 4.5 - 1.5

      const pick = Math.random()
      const col = pick < 0.5 ? cBlue : pick < 0.8 ? cSky : cSlate
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }

    const particlesGeo = new THREE.BufferGeometry()
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    particlesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const particles = new THREE.Points(
      particlesGeo,
      new THREE.PointsMaterial({
        size: 0.045,
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    )
    scene.add(particles)

    // ---------- Rotación interactiva con el mouse (arrastrar + inercia) ----------
    let rotX = 0.24
    let rotY = -0.52
    let velX = 0
    let velY = 0
    let dragging = false
    let lastX = 0
    let lastY = 0
    let assemblyStart = performance.now()
    let isVisible = true

    const domEl = renderer.domElement

    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      setIsDragging(true)
      lastX = e.clientX
      lastY = e.clientY
      velX = 0
      velY = 0
      domEl.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY

      velY = dx * 0.0085
      velX = dy * 0.0075
      rotY += velY
      rotX = Math.max(-1.25, Math.min(1.25, rotX + velX))
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      setIsDragging(false)
      if (domEl.hasPointerCapture(e.pointerId)) {
        domEl.releasePointerCapture(e.pointerId)
      }
    }

    const onDoubleClick = () => {
      if (reducedMotion) return
      assemblyStart = performance.now()
    }

    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = Math.max(container.clientHeight, 1)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true
      },
      { threshold: 0.05 },
    )
    observer.observe(container)

    domEl.addEventListener('pointerdown', onPointerDown)
    domEl.addEventListener('pointermove', onPointerMove)
    domEl.addEventListener('pointerup', onPointerUp)
    domEl.addEventListener('pointercancel', onPointerUp)
    domEl.addEventListener('dblclick', onDoubleClick)
    window.addEventListener('resize', handleResize)

    // ---------- Ciclo de animación ----------
    let frameId = 0
    const clock = new THREE.Clock()

    const renderFrame = () => {
      frameId = window.requestAnimationFrame(renderFrame)
      if (!isVisible) return

      const t = clock.getElapsedTime()
      const elapsedAssembly = (performance.now() - assemblyStart) / 1000

      // Animación de armado secuencial de los 3 discos por lado + seguros
      if (!reducedMotion) {
        for (const part of animatedParts) {
          const localT = Math.max(0, Math.min(1, (elapsedAssembly - part.delay) / part.duration))
          const eased = localT === 0 ? 0 : localT === 1 ? 1 : easeOutBack(localT)
          part.mesh.position.x = part.startX + (part.targetX - part.startX) * eased
          // Pequeña rotación de encaje mientras entra el disco
          part.mesh.rotation.x = (1 - localT) * 1.4
        }
      }

      // Inercia tras soltar el mouse + rotación suave automática cuando está libre
      if (!dragging) {
        rotY += velY
        rotX = Math.max(-1.25, Math.min(1.25, rotX + velX))
        velX *= 0.93
        velY *= 0.93

        if (!reducedMotion && Math.abs(velY) < 0.002) {
          rotY += 0.0038
        }
      }

      dumbbellGroup.rotation.y = rotY
      dumbbellGroup.rotation.x = rotX
      dumbbellGroup.rotation.z = Math.sin(t * 0.7) * 0.06
      dumbbellGroup.position.y = reducedMotion ? 0 : Math.sin(t * 1.1) * 0.09

      particles.rotation.y = t * 0.025 + rotY * 0.15

      renderer.render(scene, camera)
    }

    renderFrame()

    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
      domEl.removeEventListener('pointerdown', onPointerDown)
      domEl.removeEventListener('pointermove', onPointerMove)
      domEl.removeEventListener('pointerup', onPointerUp)
      domEl.removeEventListener('pointercancel', onPointerUp)
      domEl.removeEventListener('dblclick', onDoubleClick)
      window.removeEventListener('resize', handleResize)

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  if (webglFallback) {
    return (
      <div className="hero-3d-fallback" aria-hidden="true">
        <div className="fallback-ring fallback-ring-outer" />
        <div className="fallback-ring fallback-ring-inner" />
        <div className="fallback-core" />
      </div>
    )
  }

  return (
    <div className="hero-3d-stage">
      <div
        ref={containerRef}
        className={`hero-3d-canvas ${isDragging ? 'is-dragging' : ''}`}
        role="img"
        aria-label="Mancuerna 3D interactiva de GymDesk. Arrastra para girar o haz doble clic para volver a armarla."
      />
      <span className="hero-3d-hint" aria-hidden="true">
        Arrastra para girar 360° · Doble clic para rearmar
      </span>
    </div>
  )
}
