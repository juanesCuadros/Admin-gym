import type { ReactNode } from 'react'
import { useTituloPagina } from '@/utils/titulo'

/** Marco de las páginas legales, con el aviso de borrador siempre visible arriba. */
export default function PaginaLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  useTituloPagina(titulo)
  return (
    <article className="contenedor seccion estrecho legal">
      <h1>{titulo}</h1>
      <div className="aviso aviso-info borrador" role="note">
        <div>
          <p className="aviso-titulo">Borrador pendiente de revisión legal</p>
          <p>
            Este texto es una base de trabajo y todavía no ha sido revisado por un abogado. Los datos marcados
            como <span className="pendiente">[pendiente]</span> se completarán antes de publicar la versión
            definitiva.
          </p>
        </div>
      </div>
      {children}
    </article>
  )
}

/** Dato que falta definir; se muestra resaltado para que no pase como dato real. */
export function Pendiente({ children }: { children: ReactNode }) {
  return <span className="pendiente">[pendiente: {children}]</span>
}
