/** Configuración de la pantalla TV (`/pantalla-tv/config`). */
export interface PantallaConfig {
  avisos: string[];
  logo_url: string | null;
  tiempo_saludo_segundos: number;
  mostrar_clases: boolean;
  mostrar_avisos: boolean;
}

/** Branding público del gimnasio: `GET /my-gym/public-branding/{subdominio}` (sin sesión). */
export interface PublicBrandingData {
  nombre: string;
  subdominio: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

/**
 * Identidad del gimnasio activo en el cliente. Sale del subdominio; los colores y el nombre
 * llegan del branding público. No contiene parámetros operativos: esos se consultan a la API.
 */
export interface TenantConfig {
  subdominio: string;
  /** Nombre del gimnasio. Hasta que cargue el branding, es el subdominio. */
  nombre: string;
  zona_horaria: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  logo_url?: string | null;
}

/** Resultado de la carga del branding público. */
export type EstadoBranding =
  | 'cargando'
  | 'ok'
  /** 404: el subdominio no existe o el gimnasio está inactivo. */
  | 'no_disponible'
  /** Sin respuesta del servidor. */
  | 'error_red'
  /** No se pudo detectar subdominio. */
  | 'sin_subdominio';
