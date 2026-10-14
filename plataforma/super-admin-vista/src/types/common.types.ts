export interface PaginatedParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ValidationErrorItem {
  field: string;
  message: string;
  type: string;
}

/**
 * Cuerpo de error de la API del Super-Admin (docs/CONTRATOS-API.md):
 *   {codigo, mensaje, detalles}
 * El backend además repite las claves heredadas (error/message/details) mientras el panel migra;
 * el cliente lee primero las nuevas y usa las viejas solo como respaldo.
 */
export interface ApiErrorResponse {
  codigo?: string;
  mensaje?: string;
  detalles?: {
    validation_errors?: ValidationErrorItem[];
    [key: string]: unknown;
  };
  // Claves heredadas
  error?: boolean;
  message?: string;
  details?: {
    validation_errors?: ValidationErrorItem[];
    [key: string]: unknown;
  };
  // Respuesta por defecto de FastAPI (sin el manejador propio)
  detail?: string | Array<{ loc: (string | number)[]; msg: string; type: string }>;
  path?: string;
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
}
