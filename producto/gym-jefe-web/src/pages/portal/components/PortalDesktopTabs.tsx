import React from 'react';
import { Calendar, CreditCard, Scale, User } from 'lucide-react';
import type { TabPortal } from '../types';

interface PortalDesktopTabsProps {
  activeTab: TabPortal;
  onSelectTab: (tab: TabPortal) => void;
}

export const PortalDesktopTabs: React.FC<PortalDesktopTabsProps> = ({
  activeTab,
  onSelectTab,
}) => {
  const tabs: Array<{ id: TabPortal; label: string; icon: React.ReactNode }> = [
    { id: 'perfil', label: 'Mi Perfil y Membresía', icon: <User size={16} /> },
    { id: 'progreso', label: 'Medidas y Progreso', icon: <Scale size={16} /> },
    { id: 'finanzas', label: 'Pagos y Compras', icon: <CreditCard size={16} /> },
    { id: 'asistencias', label: 'Mis Asistencias', icon: <Calendar size={16} /> },
  ];

  return (
    <div
      className="portal-desktop-only"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: 24,
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
        }}
      >
        {tabs.map((item) => {
          const activo = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 16px',
                background: 'none',
                border: 'none',
                borderBottom: activo ? '2px solid var(--primary)' : '2px solid transparent',
                color: activo ? 'var(--primary)' : 'var(--text-secondary)',
                fontWeight: activo ? 600 : 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

