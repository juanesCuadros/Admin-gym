export interface PaginatedParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ApiErrorResponse {
  error?: boolean;
  message?: string;
  detail?: string | Array<{ loc: string[]; msg: string; type: string }>;
  details?: {
    validation_errors?: Array<{ field: string; message: string; type: string }>;
    [key: string]: any;
  };
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
