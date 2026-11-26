import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Globe, Lock } from 'lucide-react'
import { DOMINIO_BASE } from '@/config'

const PRESETS = ['titanfit', 'ironclub', 'zonaactiva']

function slugify(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'tugimnasio'
  )
}

/**
 * Vista previa interactiva de la arquitectura multi-tenant de GymDesk.
 * Muestra cómo cada gimnasio recibe su propia dirección web aislada ({subdominio}.gymdeskcolombia.com).
 */
export default function SubdomainPreview3D() {
  const [nombre, setNombre] = useState('titanfit')
  const slug = slugify(nombre)

  return (
    <div className="tenant-card">
      <div className="tenant-card-top">
        <div className="tenant-browser-bar">
          <Lock size={14} className="text-emerald" aria-hidden="true" />
          <span className="tenant-url-prefix">https://</span>
          <span className="tenant-url-slug">{slug}</span>
          <span className="tenant-url-domain">.{DOMINIO_BASE}</span>
        </div>
        <span className="tenant-live-chip">
          <Globe size={13} aria-hidden="true" /> Espacio aislado
        </span>
      </div>

      <div className="tenant-input-row">
        <label htmlFor="demo-subdominio" className="solo-lector">
          Prueba cómo se verá la dirección de tu gimnasio
        </label>
        <input
          id="demo-subdominio"
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Escribe el nombre de tu gimnasio…"
          className="tenant-input"
          maxLength={40}
        />
        <Link to="/registro" className="boton boton-acento boton-compacto">
          Reservar espacio <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>

      <div className="tenant-presets">
        <span>Ejemplos:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`tenant-preset-btn ${slug === preset ? 'is-active' : ''}`}
            onClick={() => setNombre(preset)}
          >
            {preset}.{DOMINIO_BASE}
          </button>
        ))}
      </div>
    </div>
  )
}
