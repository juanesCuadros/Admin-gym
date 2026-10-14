/**
 * Tipos de los endpoints públicos de super-admin-api (contrato 3.2).
 * Fuente exacta: app/presentation/schemas/public_schemas.py y plan_schemas.py (PlanPublicoResponse).
 */

export type TipoPlan = 'prueba' | 'pago'

/** GET /public/plans */
export interface PlanPublico {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  tipo: TipoPlan | string
  /** Precio mensual en COP enteros (0 en la prueba). */
  precio: number
  /** Solo planes de pago. */
  duracion_meses: number | null
  /** Solo el plan de prueba. */
  dias_prueba: number | null
  /** null = sin límite */
  max_clientes_activos: number | null
  /** null = sin límite */
  max_staff: number | null
}

/** GET /public/subdomain-check?nombre= */
export interface SubdominioSugerido {
  subdominio_sugerido: string
  disponible: boolean
}

/** POST /public/signup */
export interface SolicitudRegistro {
  nombre_gimnasio: string
  ciudad: string
  jefe_nombre: string
  jefe_correo: string
  telefono: string
  acepta_terminos: true
}

/** Respuesta 202 de POST /public/signup */
export interface RespuestaMensaje {
  mensaje: string
}

/** GET /public/signup/{token} */
export interface InfoEnlaceRegistro {
  valido: boolean
  nombre_gimnasio: string
  subdominio_sugerido: string
}

/** Respuesta 201 de POST /public/signup/{token}/confirm */
export interface RegistroConfirmado {
  subdominio: string
  url_login: string
}
