import React, { useEffect } from 'react';
import { Calendar, CreditCard, LogOut, Scale, User, X } from 'lucide-react';
import type { TabPortal } from '../types';

interface PortalMobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabPortal;
  onSelectTab: (tab: TabPortal) => void;
  onCerrarSesion: () => void;
  nombreUsuario: string;
  gimnasioNombre: string;
}

export const PortalMobileMenu: React.FC<PortalMobileMenuProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  onCerrarSesion,
  nombreUsuario,
  gimnasioNombre,
}) => {
  // Cerrar con Escape y bloquear scroll del body mientras está abierto
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: Array<{ id: TabPortal; label: string; desc: string; icon: React.ReactNode }> = [
    {
      id: 'perfil',
      label: 'Mi Perfil y Membresía',
      desc: 'Datos de contacto, plan y vigencia',
      icon: <User size={20} />,
    },
    {
      id: 'progreso',
      label: 'Medidas y Progreso',
      desc: 'Historial corporal, IMC y evolución',
      icon: <Scale size={20} />,
    },
    {
      id: 'finanzas',
      label: 'Pagos y Compras',
      desc: 'Membresías pagadas y consumos en tienda',
      icon: <CreditCard size={20} />,
    },
    {
      id: 'asistencias',
      label: 'Mis Asistencias',
      desc: 'Calendario mensual e historial de ingresos',
      icon: <Calendar size={20} />,
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        animation: 'fadeIn 0.18s ease-out',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Menú de navegación del portal"
    >
      {/* Fondo oscuro traslúcido para cerrar al pulsar afuera */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--bg-overlay, rgba(0, 0, 0, 0.6))',
          backdropFilter: 'blur(3px)',
        }}
      />

      {/* Cajón de navegación lateral */}
      <div
        style={{
          position: 'relative',
          width: '82%',
          maxWidth: 320,
          height: '100%',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.5))',
          animation: 'slideInLeft 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Encabezado del menú con botón cerrar */}
        <div
          style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
              {gimnasioNombre}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              Portal del socio · {nombreUsuario}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Lista de Secciones */}
        <div style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 8px' }}>
            Navegación
          </div>
          {tabs.map((t) => {
            const activo = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSelectTab(t.id);
                  onClose();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: activo ? '1px solid var(--primary)' : '1px solid transparent',
                  background: activo ? 'var(--primary-soft, rgba(234, 88, 12, 0.12))' : 'transparent',
                  color: activo ? 'var(--primary)' : 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.15s ease',
                  fontFamily: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: activo ? 'var(--primary)' : 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {t.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: activo ? 700 : 600, fontSize: '0.9rem' }}>{t.label}</div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Pie del menú con Cerrar Sesión */}
        <div
          style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-surface-elevated)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              onClose();
              onCerrarSesion();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'none',
              color: 'var(--danger, #ef4444)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.86rem',
              fontFamily: 'inherit',
            }}
          >
            <LogOut size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
};

