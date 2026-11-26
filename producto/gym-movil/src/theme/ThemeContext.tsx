import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_THEME, TenantTheme, ThemeColors } from './types';

interface ThemeContextValue {
  theme: TenantTheme;
  colors: ThemeColors;
  setTenantTheme: (theme: Partial<TenantTheme>) => Promise<void>;
  resetTheme: () => Promise<void>;
  isLoadingTheme: boolean;
}

const STORAGE_THEME_KEY = '@gymos_tenant_theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<TenantTheme>(DEFAULT_THEME);
  const [isLoadingTheme, setIsLoadingTheme] = useState<boolean>(true);

  // Carga inicial del branding cacheado para arranque instantáneo (Offline / Splash)
  useEffect(() => {
    const loadCachedTheme = async () => {
      try {
        const cached = await AsyncStorage.getItem(STORAGE_THEME_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          setTheme((prev) => ({ ...prev, ...parsed }));
        }
      } catch (err) {
        console.warn('[ThemeContext] Error al cargar tema en cache:', err);
      } finally {
        setIsLoadingTheme(false);
      }
    };
    loadCachedTheme();
  }, []);

  const setTenantTheme = async (newTheme: Partial<TenantTheme>) => {
    setTheme((prev) => {
      const updated: TenantTheme = {
        ...prev,
        ...newTheme,
        primary_color: newTheme.primary_color || prev.primary_color || DEFAULT_THEME.primary_color,
        secondary_color: newTheme.secondary_color || prev.secondary_color || DEFAULT_THEME.secondary_color,
        accent_color: newTheme.accent_color || prev.accent_color || DEFAULT_THEME.accent_color,
      };
      AsyncStorage.setItem(STORAGE_THEME_KEY, JSON.stringify(updated)).catch((e) =>
        console.warn('[ThemeContext] Error guardando tema:', e)
      );
      return updated;
    });
  };

  const resetTheme = async () => {
    setTheme(DEFAULT_THEME);
    await AsyncStorage.removeItem(STORAGE_THEME_KEY).catch(() => {});
  };

  // Construcción reactiva de la paleta basada en los colores del gimnasio (White-labeling dinámico)
  const colors: ThemeColors = useMemo(() => {
    const primary = theme.primary_color || DEFAULT_THEME.primary_color;
    const secondary = theme.secondary_color || DEFAULT_THEME.secondary_color;
    const accent = theme.accent_color || DEFAULT_THEME.accent_color;

    return {
      primary,
      secondary,
      accent,
      background: '#0B0F19',
      surface: '#151C2C',
      surfaceSubtle: '#1E283D',
      card: '#182033',
      text: '#FFFFFF',
      textSecondary: '#94A3B8',
      textMuted: '#64748B',
      border: 'rgba(255, 255, 255, 0.08)',
      borderLight: 'rgba(255, 255, 255, 0.16)',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
    };
  }, [theme.primary_color, theme.secondary_color, theme.accent_color]);

  return (
    <ThemeContext.Provider value={{ theme, colors, setTenantTheme, resetTheme, isLoadingTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe ser usado dentro de un ThemeProvider');
  }
  return context;
};
