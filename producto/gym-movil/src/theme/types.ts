export interface TenantTheme {
  tenant_id: string;
  gym_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  subdominio: string;
  app_movil_activa: boolean;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceSubtle: string;
  card: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderLight: string;
  success: string;
  warning: string;
  error: string;
}

export const DEFAULT_THEME: TenantTheme = {
  tenant_id: '',
  gym_name: 'GymOS Client',
  logo_url: null,
  primary_color: '#FF5722',
  secondary_color: '#121212',
  accent_color: '#00E676',
  subdominio: '',
  app_movil_activa: true,
};
