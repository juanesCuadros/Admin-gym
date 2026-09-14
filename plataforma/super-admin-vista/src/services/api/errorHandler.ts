import axios, { AxiosError } from 'axios';
import { ApiErrorResponse } from '@/types/common.types';

export interface ParsedError {
  message: string;
  fieldErrors?: Record<string, string>;
  status?: number;
}

export function parseApiError(error: unknown): ParsedError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    // Handle 401 Unauthorized
    if (status === 401) {
      return {
        message: data?.message || 'Tu sesión ha expirado o las credenciales son inválidas. Por favor, inicia sesión de nuevo.',
        status: 401,
      };
    }

    // Handle 403 Forbidden
    if (status === 403) {
      return {
        message: data?.message || 'No tienes permisos suficientes para realizar esta acción.',
        status: 403,
      };
    }

    // Handle 404 Not Found
    if (status === 404) {
      return {
        message: data?.message || 'El recurso solicitado no fue encontrado.',
        status: 404,
      };
    }

    // Handle 409 Conflict (e.g. duplicate idempotency key, subdomain taken)
    if (status === 409) {
      return {
        message: data?.message || 'Ya existe un registro con estos datos o la operación ya fue procesada.',
        status: 409,
      };
    }

    // Handle 422 Validation Error
    if (status === 422) {
      const fieldErrors: Record<string, string> = {};
      
      // Pydantic validation errors format
      if (Array.isArray(data?.detail)) {
        data.detail.forEach((err: any) => {
          const field = err.loc ? err.loc[err.loc.length - 1] : 'general';
          fieldErrors[field] = err.msg;
        });
      } else if (data?.details?.validation_errors) {
        data.details.validation_errors.forEach((err) => {
          fieldErrors[err.field] = err.message;
        });
      }

      return {
        message: data?.message || 'Por favor corrige los errores indicados en el formulario.',
        fieldErrors,
        status: 422,
      };
    }

    // Handle 500 Internal Server Error
    if (status && status >= 500) {
      return {
        message: 'Ocurrió un error en el servidor. Por favor intenta de nuevo más tarde.',
        status,
      };
    }

    // Fallback message from response body
    if (data?.message) {
      return { message: data.message, status };
    }

    if (typeof data?.detail === 'string') {
      return { message: data.detail, status };
    }

    // Network error
    if (axiosError.code === 'ERR_NETWORK') {
      return {
        message: 'No se pudo conectar con el servidor. Verifica tu conexión o que la API esté disponible.',
        status: 0,
      };
    }
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: 'Ha ocurrido un error inesperado.' };
}
