import React from 'react';
import { Menu, Sun, Moon, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';

interface HeaderProps {
  onToggleSidebar: () => void;
}

const NOMBRE_ROL: Record<string, string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

const botonIcono: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Header (§B3): nombre y logo · estado de caja · usuario con rol · salir. Sin selector de gimnasio. */
export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user, logout, hasPermission } = useAuth();
  const { tenant, themeMode, toggleThemeMode } = useTenantTheme();
  const { turno, cargando, error, turnoAbierto } = useCajaTurno();

  const puedeVerCaja = hasPermission('caja', 'leer');

  let badgeCaja: React.ReactNode = null;
  if (puedeVerCaja) {
    if (cargando) badgeCaja = <Badge variant="neutral">Caja: consultando…</Badge>;
    else if (error) badgeCaja = <Badge variant="neutral">Caja: sin datos</Badge>;
    else if (turnoAbierto)
      badgeCaja = (
        <Badge variant="success" dot>
          Caja abierta{turno?.staff_nombre ? ` · ${turno.staff_nombre}` : ''}
        </Badge>
      );
    else
      badgeCaja = (
        <Badge variant="warning" dot>
          Caja cerrada
        </Badge>
      );
  }

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <button onClick={onToggleSidebar} style={{ ...botonIcono, color: 'var(--text-primary)' }} aria-label="Menú">
          <Menu size={22} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {tenant.logo_url && (
            <img
              src={tenant.logo_url}
              alt=""
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-xs)', objectFit: 'cover' }}
            />
          )}
          <span
            style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tenant.nombre}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {badgeCaja}

        <button
          onClick={toggleThemeMode}
          title={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          style={{
            ...botonIcono,
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            width: 36,
            height: 36,
          }}
        >
          {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={user.nombre} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {user.nombre}
              </span>
              <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                {NOMBRE_ROL[user.rol] ?? user.rol}
              </span>
            </div>
            <button onClick={logout} title="Salir" aria-label="Salir" style={{ ...botonIcono, marginLeft: 4 }}>
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
