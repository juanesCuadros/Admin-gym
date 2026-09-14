import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiClient } from '../api/client';
import { TenantConfig, TenantBrandingPreset } from '../types/tenant.types';

export const TENANT_PRESETS: TenantBrandingPreset[] = [
  {
    id: 'entrena-a-e9cce5',
    nombre: 'FitZone Iron Club',
    subdominio: 'entrena-a-e9cce5',
    primary: '#e11d48', // Crimson Red
    secondary: '#f43f5e',
    accent: '#f59e0b',
    descripcion: 'Gimnasio de alto rendimiento · Branding carmesí y negro',
  },
  {
    id: 'clases-a-634367',
    nombre: 'PowerPulse Fitness',
    subdominio: 'clases-a-634367',
    primary: '#4f46e5', // Deep Indigo
    secondary: '#8b5cf6',
    accent: '#06b6d4',
    descripcion: 'Centro deportivo multidisciplinar · Branding índigo y cian',
  },
  {
    id: 'gym-m5a-ae8980',
    nombre: 'Vitality Green Wellness',
    subdominio: 'gym-m5a-ae8980',
    primary: '#10b981', // Emerald
    secondary: '#059669',
    accent: '#3b82f6',
    descripcion: 'Salud y entrenamiento funcional · Branding esmeralda y azul',
  },
  {
    id: 'gym-a-73a3de',
    nombre: 'Titan Strength Center',
    subdominio: 'gym-a-73a3de',
    primary: '#f59e0b', // Amber
    secondary: '#d97706',
    accent: '#ef4444',
    descripcion: 'Powerlifting y fuerza · Branding ámbar y fuego',
  },
];

export interface PublicBrandingData {
  nombre: string;
  subdominio: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
}

interface TenantThemeContextType {
  tenant: TenantConfig;
  setTenant: React.Dispatch<React.SetStateAction<TenantConfig>>;
  themeMode: 'dark' | 'light';
  toggleThemeMode: () => void;
  applyPreset: (preset: TenantBrandingPreset) => void;
  fetchPublicBranding: (subdominio: string) => Promise<void>;
  updateBranding: (branding: {
    primary?: string;
    secondary?: string;
    accent?: string;
    nombre?: string;
    logo_url?: string;
  }) => void;
}

const defaultTenant: TenantConfig = {
  id: TENANT_PRESETS[0].id,
  nombre: TENANT_PRESETS[0].nombre,
  subdominio: TENANT_PRESETS[0].subdominio,
  zona_horaria: 'America/Bogota',
  dias_gracia_mora: 3,
  dias_umbral_por_vencer: 5,
  tope_dias_congelamiento: 30,
  metodos_pago: ['efectivo', 'nequi', 'daviplata', 'datáfono'],
  pantalla_config: {
    avisos: [
      '¡Bienvenidos a nuestra sede! Recuerda hidratarte durante tu rutina.',
      'Nueva clase de Spinning a las 6:30 PM. ¡Inscríbete en recepción!',
    ],
    logo_url: null,
    tiempo_saludo_segundos: 8,
    mostrar_clases: true,
    mostrar_avisos: true,
  },
  activo: true,
  primary_color: TENANT_PRESETS[0].primary,
  secondary_color: TENANT_PRESETS[0].secondary,
  accent_color: TENANT_PRESETS[0].accent,
  theme_mode: 'dark',
};

const TenantThemeContext = createContext<TenantThemeContextType | undefined>(undefined);

// Helper to compute color variations and inject CSS variables
function applyCssTokens(primary: string, secondary: string, accent: string) {
  const root = document.documentElement;

  root.style.setProperty('--primary', primary);
  root.style.setProperty('--secondary', secondary);
  root.style.setProperty('--accent', accent);

  // Generate lighter alpha channels
  root.style.setProperty('--primary-light', `${primary}1f`);
  root.style.setProperty('--primary-border', `${primary}55`);
  root.style.setProperty('--secondary-light', `${secondary}1f`);
  root.style.setProperty('--accent-light', `${accent}1f`);

  // Darker hover
  root.style.setProperty('--primary-hover', primary);
}

export function detectSubdomainFromHostname(): string | null {
  if (typeof window === 'undefined') return null;

  // 1. Query parameter (?subdominio=... or ?tenant=...)
  const params = new URLSearchParams(window.location.search);
  const paramSub = params.get('subdominio') || params.get('tenant');
  if (paramSub && paramSub.trim()) return paramSub.trim().toLowerCase();

  // 2. Subdomain from hostname (e.g. powergym.localhost or powergym.gymos.co)
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  if (parts.length >= 2 && parts[0] !== 'www' && parts[0] !== 'localhost' && parts[0] !== '127' && !/^\d+$/.test(parts[0])) {
    return parts[0].toLowerCase();
  }

  // 3. Subdomain stored in localStorage
  const savedSub = localStorage.getItem('gymos_tenant_subdomain');
  if (savedSub && savedSub.trim()) return savedSub.trim().toLowerCase();

  return null;
}

export const TenantThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<TenantConfig>(() => {
    const detectedSub = detectSubdomainFromHostname();
    const activeSubdomain = detectedSub || 'entrena-a-e9cce5';

    // Preset sólo como tema visual inicial si coincide
    const match = TENANT_PRESETS.find((p) => p.subdominio === activeSubdomain);
    if (match) {
      return {
        ...defaultTenant,
        id: match.id,
        nombre: match.nombre,
        subdominio: match.subdominio,
        primary_color: match.primary,
        secondary_color: match.secondary,
        accent_color: match.accent,
      };
    }

    // Fallback to localStorage si coincide con el subdominio activo
    const saved = localStorage.getItem('gymos_tenant_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.subdominio === activeSubdomain) {
          return parsed;
        }
      } catch (e) {
        console.error('Error parsing stored tenant config', e);
      }
    }

    // Si no hay preset, usar el subdominio detectado con branding por defecto
    return {
      ...defaultTenant,
      subdominio: activeSubdomain,
      nombre: activeSubdomain.charAt(0).toUpperCase() + activeSubdomain.slice(1),
    };
  });

  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('gymos_theme_mode') as 'dark' | 'light') || 'dark';
  });

  // Fetch real public branding from backend without authentication (Pre-login)
  const fetchPublicBranding = async (subdominio: string) => {
    if (!subdominio) return;
    try {
      const res = await apiClient.get<PublicBrandingData>(`/my-gym/public-branding/${subdominio}`);
      if (res.data) {
        const { nombre, primary_color, secondary_color, accent_color, logo_url } = res.data;
        setTenant((prev) => ({
          ...prev,
          nombre: nombre || prev.nombre,
          subdominio,
          primary_color: primary_color || prev.primary_color,
          secondary_color: secondary_color || prev.secondary_color,
          accent_color: accent_color || prev.accent_color,
          logo_url: logo_url !== undefined ? logo_url : prev.logo_url,
        }));
      }
    } catch (err) {
      console.warn(`[TenantTheme] No se pudo cargar branding público para '${subdominio}' desde el backend.`, err);
    }
  };

  // Load public branding from backend on initial render
  useEffect(() => {
    const detectedSub = detectSubdomainFromHostname();
    const activeSub = detectedSub || tenant.subdominio || 'entrena-a-e9cce5';
    fetchPublicBranding(activeSub);
  }, []);

  // Apply CSS tokens whenever tenant branding or theme changes
  useEffect(() => {
    const primary = tenant.primary_color || defaultTenant.primary_color!;
    const secondary = tenant.secondary_color || defaultTenant.secondary_color!;
    const accent = tenant.accent_color || defaultTenant.accent_color!;

    applyCssTokens(primary, secondary, accent);

    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('gymos_tenant_config', JSON.stringify(tenant));
    localStorage.setItem('gymos_tenant_subdomain', tenant.subdominio);
    localStorage.setItem('gymos_theme_mode', themeMode);
  }, [tenant, themeMode]);

  const toggleThemeMode = () => {
    setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const applyPreset = (preset: TenantBrandingPreset) => {
    setTenant((prev) => ({
      ...prev,
      id: preset.id,
      nombre: preset.nombre,
      subdominio: preset.subdominio,
      primary_color: preset.primary,
      secondary_color: preset.secondary,
      accent_color: preset.accent,
      logo_url: preset.logoUrl,
    }));
  };

  const updateBranding = (branding: {
    primary?: string;
    secondary?: string;
    accent?: string;
    nombre?: string;
    logo_url?: string;
  }) => {
    setTenant((prev) => ({
      ...prev,
      nombre: branding.nombre || prev.nombre,
      primary_color: branding.primary || prev.primary_color,
      secondary_color: branding.secondary || prev.secondary_color,
      accent_color: branding.accent || prev.accent_color,
      logo_url: branding.logo_url !== undefined ? branding.logo_url : prev.logo_url,
    }));
  };

  return (
    <TenantThemeContext.Provider
      value={{
        tenant,
        setTenant,
        themeMode,
        toggleThemeMode,
        applyPreset,
        fetchPublicBranding,
        updateBranding,
      }}
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
