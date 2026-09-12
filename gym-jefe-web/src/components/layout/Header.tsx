import React, { useState, useEffect } from 'react';
import { Menu, Sun, Moon, LogOut, ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme, TENANT_PRESETS } from '../../contexts/TenantThemeContext';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { cajaService } from '../../api/caja.service';

interface HeaderProps {
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { tenant, applyPreset, themeMode, toggleThemeMode } = useTenantTheme();
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [showTenantMenu, setShowTenantMenu] = useState(false);

  useEffect(() => {
    // Check cash register shift status
    async function checkCaja() {
      try {
        const turno = await cajaService.getTurnoActual();
        setCajaAbierta(turno !== null && turno.estado === 'abierto');
      } catch {
        setCajaAbierta(false);
      }
    }
    checkCaja();
  }, [tenant.id]);

  return (
    <header className="app-header">
      {/* Left section: Hamburger & Tenant Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={onToggleSidebar}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: 6,
          }}
        >
          <Menu size={22} />
        </button>

        {/* Tenant Branding Selector Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowTenantMenu((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: 'var(--primary)',
                display: 'inline-block',
              }}
            />
            <span>{tenant.nombre}</span>
            <ChevronDown size={14} color="var(--text-muted)" />
          </button>

          {showTenantMenu && (
            <div
              style={{
                position: 'absolute',
                top: '110%',
                left: 0,
                minWidth: 260,
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                padding: '8px',
                zIndex: 50,
              }}
            >
              <div
                style={{
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Sparkles size={12} color="var(--primary)" /> Seleccionar Gimnasio (Tenant)
              </div>
              {TENANT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    applyPreset(preset);
                    setShowTenantMenu(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor:
                      preset.id === tenant.id ? 'var(--primary-light)' : 'transparent',
                    color: preset.id === tenant.id ? 'var(--primary)' : 'var(--text-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.875rem' }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: preset.primary,
                      }}
                    />
                    {preset.nombre}
                  </div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', paddingLeft: 16 }}>
                    {preset.descripcion}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right section: Cash shift status, Theme toggle & Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Cash Register Indicator */}
        {cajaAbierta !== null && (
          <div style={{ display: 'none', md: 'flex' } as any}>
            <Badge variant={cajaAbierta ? 'success' : 'warning'} dot>
              {cajaAbierta ? 'Caja: Turno Abierto' : 'Caja: Cerrada'}
            </Badge>
          </div>
        )}

        {/* Theme mode toggle */}
        <button
          onClick={toggleThemeMode}
          title={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          style={{
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User profile and logout */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user.nombre} status="online" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {user.nombre}
              </span>
              <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                {user.rol}
              </span>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 4,
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
