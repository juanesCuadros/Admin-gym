import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiClient, toApiError, STORAGE } from '../api/client';
import { TenantConfig, PublicBrandingData, EstadoBranding } from '../types/tenant.types';
import { ZONA_HORARIA } from '../utils/formato';

/** Colores del sistema cuando el gimnasio no tiene branding propio. No son datos del gimnasio. */
const COLORES_BASE = {
  primary: '#4f46e5',
  secondary: '#06b6d4',
  accent: '#f59e0b',
};

interface TenantThemeContextType {
  tenant: TenantConfig;
  /** Estado de la carga del branding público; el login lo usa para decidir si va a /bloqueado. */
  estadoBranding: EstadoBranding;
  themeMode: 'dark' | 'light';
  toggleThemeMode: () => void;
  /** Vuelve a consultar el branding público del subdominio activo. */
  recargarBranding: () => Promise<EstadoBranding>;
  /** Actualiza nombre/colores tras un guardado real en Configuración. */
  aplicarBranding: (b: Partial<Pick<TenantConfig, 'nombre' | 'primary_color' | 'secondary_color' | 'accent_color' | 'logo_url'>>) => void;
}

const TenantThemeContext = createContext<TenantThemeContextType | undefined>(undefined);

function applyCssTokens(primary: string, secondary: string, accent: string) {
  const root = document.documentElement;
  root.style.setProperty('--primary', primary);
  root.style.setProperty('--secondary', secondary);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--primary-light', `${primary}1f`);
  root.style.setProperty('--primary-border', `${primary}55`);
  root.style.setProperty('--secondary-light', `${secondary}1f`);
  root.style.setProperty('--accent-light', `${accent}1f`);
  root.style.setProperty('--primary-hover', primary);
}

/**
 * Detección del tenant. Orden: `?subdominio=` → subdominio del hostname → último subdominio usado.
 * No hay override manual: el gimnasio lo decide la URL.
 */
export function detectarSubdominio(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const paramSub = params.get('subdominio') || params.get('tenant');
  if (paramSub && paramSub.trim()) return paramSub.trim().toLowerCase();

  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  if (
    parts.length >= 2 &&
    parts[0] !== 'www' &&
    parts[0] !== 'localhost' &&
    parts[0] !== '127' &&
    !/^\d+$/.test(parts[0])
  ) {
    return parts[0].toLowerCase();
  }

  const savedSub = localStorage.getItem(STORAGE.subdominio);
  if (savedSub && savedSub.trim()) return savedSub.trim().toLowerCase();

  return null;
}

export const TenantThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<TenantConfig>(() => {
    const sub = detectarSubdominio() ?? '';
    return { subdominio: sub, nombre: sub, zona_horaria: ZONA_HORARIA };
  });
  const [estadoBranding, setEstadoBranding] = useState<EstadoBranding>(
    tenant.subdominio ? 'cargando' : 'sin_subdominio'
  );
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('gymos_theme_mode') as 'dark' | 'light') || 'dark';
  });

  const recargarBranding = useCallback(async (): Promise<EstadoBranding> => {
    const sub = tenant.subdominio;
    if (!sub) {
      setEstadoBranding('sin_subdominio');
      return 'sin_subdominio';
    }
    setEstadoBranding('cargando');
    try {
      const res = await apiClient.get<PublicBrandingData>(`/my-gym/public-branding/${sub}`);
      const b = res.data;
      setTenant((prev) => ({
        ...prev,
        nombre: b.nombre || prev.nombre,
        primary_color: b.primary_color || undefined,
        secondary_color: b.secondary_color || undefined,
        accent_color: b.accent_color || undefined,
        logo_url: b.logo_url ?? null,
      }));
      setEstadoBranding('ok');
      return 'ok';
    } catch (err) {
      const e = toApiError(err);
      // Solo el 404 significa que el gimnasio no existe o está inactivo; cualquier otro fallo
      // (red, 5xx) es un error de carga y no debe mandar a /bloqueado.
      const estado: EstadoBranding = e.tipo === 'no_encontrado' ? 'no_disponible' : 'error_carga';
      setEstadoBranding(estado);
      return estado;
    }
  }, [tenant.subdominio]);

  useEffect(() => {
    recargarBranding();
  }, [recargarBranding]);

  useEffect(() => {
    applyCssTokens(
      tenant.primary_color || COLORES_BASE.primary,
      tenant.secondary_color || COLORES_BASE.secondary,
      tenant.accent_color || COLORES_BASE.accent
    );
    document.documentElement.setAttribute('data-theme', themeMode);
    if (tenant.subdominio) localStorage.setItem(STORAGE.subdominio, tenant.subdominio);
    localStorage.setItem('gymos_theme_mode', themeMode);
  }, [tenant, themeMode]);

  const toggleThemeMode = () => setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const aplicarBranding: TenantThemeContextType['aplicarBranding'] = (b) => {
    setTenant((prev) => ({ ...prev, ...b }));
  };

  return (
    <TenantThemeContext.Provider
      value={{ tenant, estadoBranding, themeMode, toggleThemeMode, recargarBranding, aplicarBranding }}
    >
      {children}
    </TenantThemeContext.Provider>
  );
};

export const useTenantTheme = () => {
  const context = useContext(TenantThemeContext);
  if (!context) {
    throw new Error('useTenantTheme must be used within a TenantThemeProvider');
  }
  return context;
};
