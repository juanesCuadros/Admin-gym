import type { InputHTMLAttributes, ReactNode } from 'react'

interface CampoProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string
  etiqueta: string
  error?: string | null
  ayuda?: ReactNode
}

/** Campo de texto con label, ayuda y error asociados por aria-describedby. */
export default function Campo({ id, etiqueta, error, ayuda, required, ...resto }: CampoProps) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedBy = [idAyuda, idError].filter(Boolean).join(' ') || undefined
  return (
    <div className={error ? 'campo campo-con-error' : 'campo'}>
      <label htmlFor={id}>
        {etiqueta}
        {required && <span className="obligatorio" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...resto}
      />
      {ayuda && <div id={idAyuda} className="campo-ayuda">{ayuda}</div>}
      {error && <p id={idError} className="campo-error">{error}</p>}
    </div>
  )
}
