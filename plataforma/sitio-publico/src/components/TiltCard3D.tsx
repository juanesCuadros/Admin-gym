import { useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'

interface TiltCard3DProps {
  children: ReactNode
  className?: string
  glowColor?: string
  maxTilt?: number
}

/**
 * Tarjeta interactiva con perspectiva 3D suave y foco de luz (spotlight) que sigue al cursor.
 * Se desactiva automáticamente en pantallas táctiles o cuando el usuario prefiere movimiento reducido.
 */
export default function TiltCard3D({
  children,
  className = '',
  glowColor = 'rgba(0, 102, 238, 0.14)',
  maxTilt = 6,
}: TiltCard3DProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const mouseX = useMotionValue(50)
  const mouseY = useMotionValue(50)

  const springX = useSpring(rotateX, { stiffness: 260, damping: 24 })
  const springY = useSpring(rotateY, { stiffness: 260, damping: 24 })

  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${mouseX}% ${mouseY}%, ${glowColor}, transparent 68%)`

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const px = x / rect.width
    const py = y / rect.height

    mouseX.set(px * 100)
    mouseY.set(py * 100)
    rotateY.set((px - 0.5) * maxTilt * 2)
    rotateX.set((0.5 - py) * maxTilt * 2)
  }

  const handleMouseLeave = () => {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      ref={cardRef}
      className={`tilt-card-3d ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX: springX,
        rotateY: springY,
        transformStyle: 'preserve-3d',
      }}
    >
      <motion.div className="tilt-card-spotlight" style={{ background: spotlight }} aria-hidden="true" />
      <div className="tilt-card-inner">{children}</div>
    </motion.div>
  )
}
