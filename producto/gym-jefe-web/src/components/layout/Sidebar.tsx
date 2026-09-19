import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Dumbbell } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { NAVEGACION, ModuloNav, moduloDeRuta } from '../../navegacion';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** Recepcionista sin turno abierto: solo puede abrir caja (§C1). */
  bloqueada?: boolean;
}

/**
 * Sidebar (§B2): dos grupos, un módulo por permiso de lectura, acordeón solo en el módulo activo.
 */
export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, bloqueada = false }) => {
  const { hasPermission, isJefe } = useAuth();
  const { tenant } = useTenantTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const moduloActivo = moduloDeRuta(location.pathname);
  // El acordeón solo se despliega en el módulo activo; el usuario puede plegarlo a mano.
  // Al cambiar de módulo, el plegado anterior deja de aplicar porque ya no coincide la ruta.
  const [plegado, setPlegado] = useState<string | null>(null);

  const puedeVer = (m: ModuloNav): boolean => {
    if (m.soloJefe) return isJefe;
    if (m.submodulo === null) return true;
    return hasPermission(m.submodulo, 'leer');
  };

  const cerrarEnMovil = () => {
    if (window.innerWidth <= 1024) onClose();
  };

  const irAlModulo = (m: ModuloNav) => {
    const yaActivo = moduloActivo?.ruta === m.ruta;
    if (m.submodulos && yaActivo) {
      setPlegado((prev) => (prev === m.ruta ? null : m.ruta));
      return;
    }
    navigate(m.ruta);
    cerrarEnMovil();
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Identidad del gimnasio */}
        <div
          style={{
            height: 68,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          {tenant.logo_url ? (
            <img
              src={tenant.logo_url}
              alt=""
              style={{ width: 38, height: 38, borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--primary)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Dumbbell size={22} />
            </div>
          )}
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
              title={tenant.nombre}
            >
              {tenant.nombre}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tenant.subdominio}</div>
          </div>
        </div>

        {/* Navegación */}
        <nav style={{ flex: 1, padding: '6px 12px 16px', overflowY: 'auto' }}>
          {bloqueada && (
            <p style={{ padding: '14px 12px', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Abre el turno de caja para habilitar el resto del sistema.
            </p>
          )}
          {!bloqueada && NAVEGACION.map((grupo) => {
            const visibles = grupo.modulos.filter(puedeVer);
            if (visibles.length === 0) return null;
            return (
              <div key={grupo.etiqueta}>
                <div className="nav-grupo">{grupo.etiqueta}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {visibles.map((m) => {
                    const Icono = m.icono;
                    const activo = moduloActivo?.ruta === m.ruta;
                    const desplegado = !!m.submodulos && activo && plegado !== m.ruta;
                    return (
                      <div key={m.ruta}>
                        <button
                          type="button"
                          className={`nav-modulo ${activo ? 'activo' : ''} ${desplegado ? 'abierto' : ''}`}
                          onClick={() => irAlModulo(m)}
                          aria-expanded={m.submodulos ? desplegado : undefined}
                        >
                          <Icono size={18} />
                          <span>{m.etiqueta}</span>
                          {m.submodulos && <ChevronDown size={16} className="nav-chevron" />}
                        </button>
                        {desplegado && m.submodulos && (
                          <div className="nav-submodulos">
                            {m.submodulos.map((s) => (
                              <NavLink
                                key={s.ruta}
                                to={s.ruta}
                                end
                                onClick={cerrarEnMovil}
                                className={({ isActive }) => `nav-submodulo ${isActive ? 'activo' : ''}`}
                              >
                                {s.etiqueta}
                              </NavLink>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
};
