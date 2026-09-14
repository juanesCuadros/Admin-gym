import React from 'react';
import { Menu, Sun, Moon, LogOut, Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { IconButton } from '@/components/actions/IconButton';

export interface HeaderProps {
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { actualTheme, toggleTheme } = useTheme();

  return (
    <header
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky',
        top: 0,
        zIndex: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-6)',
      }}
    >
      {/* Left section */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="mobile-menu-trigger">
          <IconButton
            icon={<Menu size={20} />}
            aria-label="Abrir menú"
            onClick={onToggleSidebar}
          />
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            fontWeight: 'var(--font-weight-medium)',
          }}
          className="header-environment-badge"
        >
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-success)',
              marginRight: '6px',
            }}
          />
          Producción Interna • MVC
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Theme Toggle */}
        <IconButton
          icon={actualTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          aria-label="Cambiar tema"
          size="md"
          onClick={toggleTheme}
        />

        {/* User Info & Logout */}
        {user && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              paddingLeft: '12px',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--color-purple-light)',
                  color: 'var(--color-purple)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'var(--font-weight-semibold)',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <Shield size={16} />
              </div>

              <div className="header-user-text">
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--color-text-primary)',
                    lineHeight: 1.2,
                  }}
                >
                  {user.nombre}
                </div>
                <div
                  style={{
                    fontSize: 'var(--font-size-2xs)',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  {user.correo}
                </div>
              </div>
            </div>

            <IconButton
              icon={<LogOut size={16} />}
              aria-label="Cerrar sesión"
              size="sm"
              onClick={logout}
              style={{ color: 'var(--color-error)' }}
            />
          </div>
        )}
      </div>

      <style>{`
        @media (min-width: 901px) {
          .mobile-menu-trigger {
            display: none;
          }
        }
        @media (max-width: 640px) {
          .header-user-text, .header-environment-badge {
            display: none;
          }
        }
      `}</style>
    </header>
  );
};
