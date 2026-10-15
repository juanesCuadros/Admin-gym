import axios, { AxiosError } from 'axios';
import { ApiErrorResponse } from '@/types/common.types';

export interface ParsedError {
  /** Mensaje listo para mostrar al usuario. */
  message: string;
  /** Código del contrato (`PAGO_YA_ANULADO`, `AUN_NO_ELIMINABLE`…). */
  codigo?: string;
  /** Detalles que acompañan el error (por ejemplo `version_actual`). */
  detalles?: Record<string, unknown>;
  /** Errores por campo (validación 422). La clave es el último segmento de la ruta del campo. */
  fieldErrors?: Record<string, string>;
  status?: number;
}

/** Último segmento útil de `body -> suscripcion -> plan_id` → `plan_id`. */
function campoDe(ruta: string | (string | number)[]): string {
  const partes = Array.isArray(ruta) ? ruta.map(String) : ruta.split('->').map((p) => p.trim());
  const utiles = partes.filter((p) => p && p !== 'body' && p !== 'query' && p !== 'header');
  return utiles.length ? utiles[utiles.length - 1] : 'general';
}

export function parseApiError(error: unknown): ParsedError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    if (!axiosError.response) {
      if (axiosError.code === 'ECONNABORTED') {
        return { message: 'El servidor tardó demasiado en responder. Intenta de nuevo.', status: 0 };
      }
      return {
        message: 'No se pudo conectar con el servidor. Verifica tu conexión o que la API esté disponible.',
        status: 0,
      };
    }

    // Formato nuevo primero; claves heredadas como respaldo.
    const codigo = data?.codigo;
    const detalles = (data?.detalles ?? data?.details) as Record<string, unknown> | undefined;
    const mensajeServidor =
      data?.mensaje || data?.message || (typeof data?.detail === 'string' ? data.detail : undefined);

    const fieldErrors: Record<string, string> = {};
    const validacion = (data?.detalles ?? data?.details)?.validation_errors;
    if (Array.isArray(validacion)) {
      validacion.forEach((err) => {
        fieldErrors[campoDe(err.field)] = err.message;
      });
    } else if (Array.isArray(data?.detail)) {
      data.detail.forEach((err) => {
        fieldErrors[campoDe(err.loc || [])] = err.msg;
      });
    }
    const conCampos = Object.keys(fieldErrors).length ? fieldErrors : undefined;

    if (status && status >= 500) {
      return {
        message: 'Ocurrió un error en el servidor. Intenta de nuevo más tarde.',
        codigo,
        status,
      };
    }

    const porDefecto: Record<number, string> = {
      401: 'Tu sesión expiró o las credenciales no son válidas. Inicia sesión de nuevo.',
      403: 'No tienes permisos para realizar esta acción.',
      404: 'El recurso solicitado no existe.',
      409: 'La operación entra en conflicto con el estado actual. Recarga e intenta de nuevo.',
      410: 'El recurso ya no está disponible.',
      422: 'Corrige los datos indicados e intenta de nuevo.',
    };

    return {
      message: mensajeServidor || (status && porDefecto[status]) || 'Ha ocurrido un error inesperado.',
      codigo,
      detalles,
      fieldErrors: conCampos,
      status,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: 'Ha ocurrido un error inesperado.' };
}
