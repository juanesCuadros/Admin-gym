import axios, { AxiosError } from 'axios'
import { API_URL } from '@/config'

/** Cliente HTTP del sitio público. Solo endpoints /public/..., sin autenticación. */
export const cliente = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

/**
 * Error normalizado de la API: `{codigo, mensaje}` (formato de super-admin-api).
 * `estado` es 0 si no hubo respuesta (sin conexión, tiempo agotado o proxy caído).
 */
export class ErrorApi extends Error {
  readonly estado: number
  readonly codigo: string

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
  }
}

const MENSAJE_SIN_CONEXION =
  'No pudimos comunicarnos con GymOS. Revisa tu conexión a internet e inténtalo de nuevo.'
const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Inténtalo de nuevo en unos minutos.'

interface CuerpoError {
  codigo?: unknown
  mensaje?: unknown
}

export function aErrorApi(error: unknown): ErrorApi {
  if (error instanceof ErrorApi) return error
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError<CuerpoError>
    if (!e.response) return new ErrorApi(0, 'SIN_CONEXION', MENSAJE_SIN_CONEXION)
    const cuerpo = e.response.data
    const esObjeto = typeof cuerpo === 'object' && cuerpo !== null
    const codigo = esObjeto && typeof cuerpo.codigo === 'string' ? cuerpo.codigo : 'ERROR'
    const mensaje = esObjeto && typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje : MENSAJE_GENERICO
    // Un 5xx sin cuerpo JSON (proxy caído) se trata como falta de servicio.
    if (e.response.status >= 500 && !esObjeto) {
      return new ErrorApi(e.response.status, 'SERVICIO_NO_DISPONIBLE', MENSAJE_GENERICO)
    }
    return new ErrorApi(e.response.status, codigo, mensaje)
  }
  return new ErrorApi(0, 'ERROR', MENSAJE_GENERICO)
}
