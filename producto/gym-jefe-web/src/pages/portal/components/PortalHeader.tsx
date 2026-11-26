import React from 'react';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { etiquetaEstadoMembresia } from '../types';
import type { PerfilDeportistaResponse } from '../../../types/portal.types';

interface PortalHeaderProps {
  perfil: PerfilDeportistaResponse;
  onCerrarSesion: () => void;
  onAbrirMenu: () => void;
}

export const PortalHeader: React.FC<PortalHeaderProps> = ({
  perfil,
  onCerrarSesion,
  onAbrirMenu,
}) => {
  const infoEstado = etiquetaEstadoMembresia(perfil.estado_general);

  return (
    <header
      className="portal-header"
      style={{
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        padding: '14px 24px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* Lado izquierdo: Botón hamburguesa (móvil) + Avatar + Nombre */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {/* Botón de 3 líneas para móvil */}
          <button
            type="button"
            className="portal-mobile-only portal-menu-trigger"
            onClick={onAbrirMenu}
            aria-label="Abrir menú de secciones"
            title="Abrir menú"
            style={{
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: 7,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Menu size={20} />
          </button>

          {/* Avatar con inicial */}
          <div
            className="portal-header-avatar"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '1rem',
              flexShrink: 0,
            }}
          >
            {perfil.nombre.charAt(0).toUpperCase()}
          </div>

          {/* Nombre y datos */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                className="portal-header-name"
                style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}
              >
                {perfil.nombre}
              </span>
              <span className="portal-desktop-only">
                <Badge variant={infoEstado.variant}>{infoEstado.texto}</Badge>
              </span>
            </div>
            <div className="portal-desktop-only" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {perfil.gimnasio_nombre} · Doc: {perfil.documento}
            </div>
          </div>
        </div>

        {/* Lado derecho: Botón Salir */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div className="portal-desktop-only">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<LogOut size={15} />}
              onClick={onCerrarSesion}
            >
              Salir
            </Button>
          </div>
          <div className="portal-mobile-only">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              onClick={onCerrarSesion}
              style={{ padding: '6px 8px' }}
            >
              <LogOut size={18} />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

