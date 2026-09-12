export interface PantallaConfig {
  avisos: string[];
  logo_url: string | null;
  tiempo_saludo_segundos: number;
  mostrar_clases: boolean;
  mostrar_avisos: boolean;
}

export interface TenantConfig {
  id: string;
  nombre: string;
  subdominio: string;
  zona_horaria: string;
  dias_gracia_mora: number;
  dias_umbral_por_vencer: number;
  tope_dias_congelamiento: number;
  metodos_pago: string[];
  horarios?: Record<string, string>;
  pantalla_config: PantallaConfig;
  activo: boolean;
  
  // Custom Branding Tokens
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  logo_url?: string;
  banner_url?: string;
  theme_mode?: 'dark' | 'light';
}

export interface TenantBrandingPreset {
  id: string;
  nombre: string;
  subdominio: string;
  primary: string;
  secondary: string;
  accent: string;
  logoUrl?: string;
  descripcion: string;
}
