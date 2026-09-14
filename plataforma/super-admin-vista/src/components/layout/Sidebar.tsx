import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Dumbbell,
  ShieldCheck,
  PlusCircle,
  X,
} from 'lucide-react';
import { IconButton } from '@/components/actions/IconButton';

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    icon: <LayoutDashboard size={19} />,
  },
  {
    to: '/gyms',
    label: 'Gimnasios',
    icon: <Building2 size={19} />,
  },
  {
    to: '/exercises',
    label: 'Catálogo Global',
    icon: <Dumbbell size={19} />,
  },
  {
    to: '/audit',
    label: 'Auditoría Criptográfica',
    icon: <ShieldCheck size={19} />,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--color-bg-overlay)',
            backdropFilter: 'blur(4px)',
            zIndex: 900,
            display: 'block',
          }}
          className="mobile-backdrop"
        />
      )}

      {/* Sidebar Container */}
      <aside
        style={{
          width: 'var(--sidebar-width)',
          height: '100vh',
          position: 'fixed',
          top: 0,
          left: 0,
          zIndex: 950,
          backgroundColor: 'var(--color-bg-card)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform var(--transition-normal)',
          transform: isOpen ? 'translateX(0)' : undefined,
        }}
        className={`app-sidebar ${isOpen ? 'open' : ''}`}
      >
        {/* Brand Header */}
        <div
          style={{
            height: 'var(--header-height)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--color-action), #5856D6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                boxShadow: '0 2px 8px rgba(0, 122, 255, 0.35)',
              }}
            >
              <Dumbbell size={18} strokeWidth={2.5} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--font-weight-bold)',
                  color: 'var(--color-text-primary)',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                }}
              >
                GymOS
              </div>
              <div
                style={{
                  fontSize: 'var(--font-size-2xs)',
                  color: 'var(--color-action)',
                  fontWeight: 'var(--font-weight-semibold)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Super Admin
              </div>
            </div>
          </div>

          {/* Close button for mobile */}
          <div className="mobile-close-btn">
            <IconButton
              icon={<X size={18} />}
              aria-label="Cerrar menú"
              size="sm"
              onClick={onClose}
            />
          </div>
        </div>

        {/* Quick Action Button */}
        <div style={{ padding: '16px 16px 8px' }}>
          <NavLink
            to="/gyms/new"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-action)',
              color: '#FFFFFF',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-medium)',
              boxShadow: 'var(--shadow-xs)',
              transition: 'all var(--transition-fast)',
            }}
          >
            <PlusCircle size={17} />
            <span>Nuevo Gimnasio</span>
          </NavLink>
        </div>

        {/* Navigation Links */}
        <nav
          style={{
            flex: 1,
            padding: '12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 'var(--font-size-2xs)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '8px 12px 4px',
            }}
          >
            Navegación
          </div>

          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onClose}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-md)',
                fontWeight: isActive
                  ? 'var(--font-weight-semibold)'
                  : 'var(--font-weight-medium)',
                color: isActive ? 'var(--color-action)' : 'var(--color-text-secondary)',
                backgroundColor: isActive ? 'var(--color-action-light)' : 'transparent',
                transition: 'all var(--transition-fast)',
              })}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer info */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--color-border-subtle)',
            fontSize: 'var(--font-size-2xs)',
            color: 'var(--color-text-tertiary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-secondary)' }}>
            GymOS Platform v1.0.0
          </span>
          <span>SaaS B2B Fitness — Ola 1</span>
        </div>
      </aside>

      {/* Responsive CSS for mobile sidebar */}
      <style>{`
        @media (max-width: 900px) {
          .app-sidebar {
            transform: translateX(-100%);
          }
          .app-sidebar.open {
            transform: translateX(0);
          }
          .mobile-close-btn {
            display: block;
          }
        }
        @media (min-width: 901px) {
          .mobile-backdrop {
            display: none !important;
          }
          .mobile-close-btn {
            display: none;
          }
        }
      `}</style>
    </>
  );
};
