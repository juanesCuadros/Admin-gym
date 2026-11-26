import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import { enlaceWhatsApp } from '@/config'

function Logo() {
  return (
    <Link to="/" className="logo" aria-label="GymDesk, ir al inicio">
      <span className="logo-marca" aria-hidden="true">G</span>
      <span className="logo-texto">
        Gym<strong>Desk</strong>
      </span>
    </Link>
  )
}

export default function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const botonMenuRef = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  const whatsapp = enlaceWhatsApp('Hola, quiero saber más de GymDesk para mi gimnasio.')

  const primeraCarga = useRef(true)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Al cambiar de página: cerrar el menú móvil, volver arriba y llevar el foco al contenido
  // para que un lector de pantalla anuncie la página nueva (no en la primera carga).
  useEffect(() => {
    setMenuAbierto(false)
    window.scrollTo(0, 0)
    if (primeraCarga.current) {
      primeraCarga.current = false
      return
    }
    document.getElementById('contenido')?.focus({ preventScroll: true })
  }, [pathname])

  // Escape cierra el menú móvil y devuelve el foco al botón.
  useEffect(() => {
    if (!menuAbierto) return
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuAbierto(false)
        botonMenuRef.current?.focus()
      }
    }
    document.addEventListener('keydown', alPresionar)
    return () => document.removeEventListener('keydown', alPresionar)
  }, [menuAbierto])

  return (
    <>
      <a className="saltar" href="#contenido">Saltar al contenido</a>
      <header className={scrolled ? 'cabecera cabecera-scrolled' : 'cabecera'}>
        <div className="contenedor cabecera-fila">
          <Logo />
          <button
            type="button"
            ref={botonMenuRef}
            className="boton-menu"
            aria-expanded={menuAbierto}
            aria-controls="navegacion"
            onClick={() => setMenuAbierto((v) => !v)}
          >
            {menuAbierto ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            <span className="solo-lector">{menuAbierto ? 'Cerrar menú' : 'Abrir menú'}</span>
          </button>
          <nav id="navegacion" aria-label="Principal" className={menuAbierto ? 'nav abierta' : 'nav'}>
            <NavLink to="/" end>Inicio</NavLink>
            <NavLink to="/planes">Planes</NavLink>
            <Link to="/registro" className="boton boton-acento boton-compacto">
              Prueba gratis <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <main id="contenido" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="pie">
        <div className="contenedor pie-fila">
          <div className="pie-marca">
            <Logo />
            <p className="pie-sub">Software para gimnasios en Colombia · 100% en el navegador.</p>
          </div>
          <nav aria-label="Legal y contacto" className="pie-enlaces">
            <Link to="/planes">Planes</Link>
            <Link to="/registro">Prueba gratis</Link>
            <Link to="/terminos">Términos</Link>
            <Link to="/privacidad">Privacidad</Link>
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            )}
          </nav>
        </div>
      </footer>
    </>
  )
}
