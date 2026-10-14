import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react'

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="estado estado-cargando" role="status" aria-live="polite">
      <Loader2 className="girando" size={22} aria-hidden="true" />
      <span>{texto}</span>
    </div>
  )
}

type TipoAviso = 'error' | 'exito' | 'info'

const ICONOS: Record<TipoAviso, typeof Info> = {
  error: AlertCircle,
  exito: CheckCircle2,
  info: Info,
}

/** Caja de mensaje. Los errores se anuncian a lectores de pantalla con role="alert". */
export function Aviso({
  tipo, titulo, children,
}: { tipo: TipoAviso; titulo?: string; children?: ReactNode }) {
  const Icono = ICONOS[tipo]
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <Icono size={20} aria-hidden="true" className="aviso-icono" />
      <div>
        {titulo && <p className="aviso-titulo">{titulo}</p>}
        {children}
      </div>
    </div>
  )
}
