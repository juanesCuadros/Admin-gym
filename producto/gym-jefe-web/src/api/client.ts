import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Claves de almacenamiento. Pendiente de decisión (§C6): hoy los tokens viven en localStorage;
// lo correcto sería refresh en cookie HttpOnly y access en memoria. No se cambia todavía.
export const STORAGE = {
  access: 'gymos_access_token',
  refresh: 'gymos_refresh_token',
  user: 'gymos_user',
  subdominio: 'gymos_tenant_subdomain',
  /** Ruta a la que volver tras iniciar sesión (sessionStorage). */
  returnTo: 'gymos_return_to',
  /** Motivo del bloqueo del gimnasio (sessionStorage). */
  bloqueoMotivo: 'gymos_bloqueo_motivo',
} as const;

/** Eventos globales que emite el interceptor. Los escuchan AuthContext y AppLayout. */
export const EVENTOS = {
  sesionExpirada: 'gymos_session_expired',
  gimnasioSuspendido: 'gymos_gimnasio_suspendido',
  permisoPerdido: 'gymos_permiso_perdido',
} as const;

/** Clasificación de errores para que cada vista los pinte según §A2. */
export type TipoApiError =
  | 'red' // sin respuesta del servidor
  | 'no_autorizado' // 401 definitivo (ya se intentó refrescar)
  | 'prohibido' // 403
  | 'no_encontrado' // 404
  | 'conflicto' // 409
  | 'validacion' // 422
  | 'limite' // 429
  | 'suspendido' // 403 GIMNASIO_SUSPENDIDO
  | 'servidor' // 5xx u otros
  | 'desconocido';

export class ApiError extends Error {
  readonly tipo: TipoApiError;
  readonly status: number | null;
  readonly codigo: string | null;
  readonly detalles: unknown;
  /** Errores 422 ya mapeados por campo (último segmento de `loc`, sin `body`). */
  readonly campos: Record<string, string>;

  constructor(args: {
    tipo: TipoApiError;
    status: number | null;
    codigo: string | null;
    mensaje: string;
    detalles?: unknown;
    campos?: Record<string, string>;
  }) {
    super(args.mensaje);
    this.name = 'ApiError';
    this.tipo = args.tipo;
    this.status = args.status;
    this.codigo = args.codigo;
    this.detalles = args.detalles ?? null;
    this.campos = args.campos ?? {};
  }
}

const MENSAJES_POR_TIPO: Record<TipoApiError, string> = {
  red: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  no_autorizado: 'Tu sesión terminó. Vuelve a iniciar sesión.',
  prohibido: 'No tienes permiso para realizar esta acción.',
  no_encontrado: 'No encontrado.',
  conflicto: 'Otra persona modificó este registro. Recarga para ver la versión actual.',
  validacion: 'Revisa los datos ingresados.',
  limite: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
  suspendido: 'El servicio del gimnasio no está disponible.',
  servidor: 'Ocurrió un error en el servidor. Inténtalo de nuevo en unos minutos.',
  desconocido: 'Ocurrió un error inesperado.',
};

function tipoPorStatus(status: number | null, codigo: string | null): TipoApiError {
  if (codigo === 'GIMNASIO_SUSPENDIDO') return 'suspendido';
  if (status === null) return 'red';
  if (status === 401) return 'no_autorizado';
  if (status === 403) return 'prohibido';
  if (status === 404) return 'no_encontrado';
  if (status === 409) return 'conflicto';
  if (status === 422) return 'validacion';
  if (status === 429) return 'limite';
  if (status >= 500) return 'servidor';
  return 'desconocido';
}

function mapearCampos(detalles: unknown): Record<string, string> {
  const campos: Record<string, string> = {};
  if (!Array.isArray(detalles)) return campos;
  for (const item of detalles) {
    if (!item || typeof item !== 'object') continue;
    const it = item as { campo?: string; mensaje?: string; loc?: unknown[]; msg?: string };
    // Formato del backend GymOS: { campo: "body -> correo", mensaje }
    // Formato crudo de FastAPI: { loc: ["body","correo"], msg }
    const ruta = it.campo ?? (Array.isArray(it.loc) ? it.loc.map(String).join(' -> ') : '');
    const nombre = ruta
      .split('->')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'body')
      .pop();
    const mensaje = it.mensaje ?? it.msg;
    if (nombre && mensaje && !campos[nombre]) campos[nombre] = mensaje;
  }
  return campos;
}

/**
 * Convierte cualquier error en `ApiError`.
 * Entiende el formato del backend GymOS `{ error: { codigo, mensaje, detalles } }`
 * y el formato crudo de FastAPI `{ detail: ... }`.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null;
    const data = error.response?.data as
      | { error?: { codigo?: string; mensaje?: string; detalles?: unknown }; detail?: unknown; message?: string }
      | undefined;

    let codigo: string | null = null;
    let mensaje: string | null = null;
    let detalles: unknown = null;

    if (data?.error && typeof data.error === 'object') {
      codigo = data.error.codigo ?? null;
      mensaje = data.error.mensaje ?? null;
      detalles = data.error.detalles ?? null;
    } else if (data?.detail !== undefined) {
      const d = data.detail as { codigo?: string; mensaje?: string; detalles?: unknown } | string | unknown[];
      if (typeof d === 'string') mensaje = d;
      else if (Array.isArray(d)) detalles = d;
      else if (d && typeof d === 'object') {
        codigo = d.codigo ?? null;
        mensaje = d.mensaje ?? null;
        detalles = d.detalles ?? null;
      }
    } else if (typeof data?.message === 'string') {
      mensaje = data.message;
    }

    const tipo = tipoPorStatus(status, codigo);
    return new ApiError({
      tipo,
      status,
      codigo,
      mensaje: mensaje || MENSAJES_POR_TIPO[tipo],
      detalles,
      campos: tipo === 'validacion' ? mapearCampos(detalles) : {},
    });
  }

  return new ApiError({
    tipo: 'desconocido',
    status: null,
    codigo: null,
    mensaje: error instanceof Error && error.message ? error.message : MENSAJES_POR_TIPO.desconocido,
  });
}

/** Texto plano del error, para mensajes fijos. */
export function parseApiError(error: unknown): string {
  return toApiError(error).message;
}

// ---------------------------------------------------------------------------
// Cliente axios
// ---------------------------------------------------------------------------

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

export function limpiarSesionLocal(): void {
  localStorage.removeItem(STORAGE.access);
  localStorage.removeItem(STORAGE.refresh);
  localStorage.removeItem(STORAGE.user);
}

const RUTAS_PUBLICAS = ['/login', '/recuperar', '/bloqueado', '/pantalla-tv', '/tv/'];

function guardarRutaParaVolver(): void {
  const ruta = `${window.location.pathname}${window.location.search}`;
  if (RUTAS_PUBLICAS.some((p) => ruta.startsWith(p))) return;
  sessionStorage.setItem(STORAGE.returnTo, ruta);
}

/** Cierra la sesión local y avisa a la app; conserva la ruta para volver tras el login. */
export function expirarSesion(): void {
  guardarRutaParaVolver();
  limpiarSesionLocal();
  window.dispatchEvent(new Event(EVENTOS.sesionExpirada));
}

function marcarGimnasioSuspendido(motivo: string): void {
  sessionStorage.setItem(STORAGE.bloqueoMotivo, motivo);
  limpiarSesionLocal();
  window.dispatchEvent(new Event(EVENTOS.gimnasioSuspendido));
}

/** Códigos 403 que significan "perdiste el permiso", no una regla de negocio. */
const CODIGOS_PERMISO = new Set(['PERMISO_DENEGADO', 'ROL_NO_AUTORIZADO', 'ACCESO_PROHIBIDO']);

let refrescando: Promise<string> | null = null;

/** Un solo refresh en vuelo; el resto de peticiones espera el mismo resultado. */
async function refrescarAccessToken(): Promise<string> {
  if (refrescando) return refrescando;

  const refreshToken = localStorage.getItem(STORAGE.refresh);
  if (!refreshToken) {
    expirarSesion();
    throw new ApiError({
      tipo: 'no_autorizado',
      status: 401,
      codigo: 'SIN_REFRESH',
      mensaje: MENSAJES_POR_TIPO.no_autorizado,
    });
  }

  refrescando = axios
    .post(`${BASE_URL}/auth/refresh`, { refresh_token: refreshToken }, { timeout: 15000 })
    .then((res) => {
      const nuevo: string = res.data.access_token;
      localStorage.setItem(STORAGE.access, nuevo);
      // El backend hoy no rota el refresh; si algún día lo devuelve, se conserva.
      if (res.data.refresh_token) localStorage.setItem(STORAGE.refresh, res.data.refresh_token);
      if (res.data.usuario) localStorage.setItem(STORAGE.user, JSON.stringify(res.data.usuario));
      return nuevo;
    })
    .catch((err) => {
      const apiErr = toApiError(err);
      if (apiErr.tipo === 'suspendido') marcarGimnasioSuspendido('suspendido');
      else if (apiErr.tipo !== 'red') expirarSesion();
      throw apiErr;
    })
    .finally(() => {
      refrescando = null;
    });

  return refrescando;
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(STORAGE.access);
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const apiErr = toApiError(error);
    const url = original?.url ?? '';
    const esAuth = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/recuperar');

    // Gimnasio bloqueado: cualquier petición manda a /bloqueado.
    if (apiErr.tipo === 'suspendido') {
      marcarGimnasioSuspendido('suspendido');
      return Promise.reject(apiErr);
    }

    // 401: un refresh y un reintento. Nunca en bucle.
    if (apiErr.status === 401 && original && !original._retry && !esAuth) {
      original._retry = true;
      try {
        const nuevo = await refrescarAccessToken();
        if (original.headers) original.headers.Authorization = `Bearer ${nuevo}`;
        return apiClient(original);
      } catch (e) {
        return Promise.reject(toApiError(e));
      }
    }

    // 403 por usuario desactivado equivale a fin de sesión.
    if (apiErr.status === 403 && apiErr.codigo === 'USUARIO_INACTIVO') {
      expirarSesion();
      return Promise.reject(apiErr);
    }

    // 403 por permiso: la vista debe sacar al usuario (§A2). Se avisa a la app.
    // Otros 403 (p. ej. DEPORTISTA_NO_ASISTIO) son reglas de negocio y los pinta la vista.
    if (apiErr.status === 403 && !esAuth && CODIGOS_PERMISO.has(apiErr.codigo ?? '')) {
      window.dispatchEvent(new CustomEvent(EVENTOS.permisoPerdido, { detail: apiErr }));
    }

    return Promise.reject(apiErr);
  }
);
