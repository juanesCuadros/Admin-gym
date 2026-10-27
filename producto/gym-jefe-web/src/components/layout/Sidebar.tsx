import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Dumbbell, X } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { ModuloNav, SubmoduloNav, moduloDeRuta } from '../../navegacion';
import { useNavegacionVisible } from '../../hooks/useNavegacionVisible';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** Recepcionista sin turno abierto: solo puede abrir caja (§C1). */
  bloqueada?: boolean;
}

/**
 * Sidebar (§B2): dos grupos, un módulo por permiso de lectura, acordeón solo en el módulo activo.
 * Los permisos se calculan en `useNavegacionVisible` (compartido con el buscador del Header).
 */
export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, bloqueada = false }) => {
  const { tenant } = useTenantTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const grupos = useNavegacionVisible();

  const moduloActivo = moduloDeRuta(location.pathname);
  // El acordeón solo se despliega en el módulo activo; el usuario puede plegarlo a mano.
  const [plegado, setPlegado] = useState<string | null>(null);

  const cerrarEnMovil = () => {
    if (window.innerWidth <= 1024) onClose();
  };

  const irAlModulo = (m: ModuloNav, subs: SubmoduloNav[]) => {
    const yaActivo = moduloActivo?.ruta === m.ruta;
    if (m.submodulos && yaActivo) {
      setPlegado((prev) => (prev === m.ruta ? null : m.ruta));
      return;
    }
    // Si el primer submódulo está apagado en este despliegue, se entra por el primero visible.
    navigate(m.submodulos ? subs[0]?.ruta ?? m.ruta : m.ruta);
    cerrarEnMovil();
  };

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />}
      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`} aria-label="Navegación principal">
        {/* Identidad del gimnasio */}
        <div className="sidebar-brand">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} alt="" className="sidebar-brand-logo" />
          ) : (
            <div className="sidebar-brand-logo">
              <Dumbbell size={19} />
            </div>
          )}
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name" title={tenant.nombre}>
              {tenant.nombre || 'GymOS'}
            </span>
            <span className="sidebar-brand-sub">{tenant.subdominio || 'Operations'}</span>
          </div>
          <button type="button" className="icon-btn ghost sidebar-close" onClick={onClose} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>

        {/* Navegación */}
        <nav className="sidebar-nav">
          {bloqueada && (
            <p className="sidebar-bloqueada">Abre el turno de caja para habilitar el resto del sistema.</p>
          )}
          {!bloqueada &&
            grupos.map(({ grupo, modulos }) => (
              <div key={grupo.etiqueta} className="nav-seccion">
                <div className="nav-grupo">{grupo.etiqueta}</div>
                <div className="nav-lista">
                  {modulos.map(({ modulo: m, submodulos: subs }) => {
                    const Icono = m.icono;
                    const activo = moduloActivo?.ruta === m.ruta;
                    const desplegado = !!m.submodulos && activo && plegado !== m.ruta;
                    const clases = [
                      'nav-modulo',
                      activo ? 'activo' : '',
                      desplegado ? 'abierto' : '',
                      m.submodulos ? 'con-submodulos' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div key={m.ruta}>
                        <button
                          type="button"
                          className={clases}
                          onClick={() => irAlModulo(m, subs)}
                          aria-expanded={m.submodulos ? desplegado : undefined}
                          aria-current={activo && !m.submodulos ? 'page' : undefined}
                        >
                          <Icono size={18} />
                          <span>{m.etiqueta}</span>
                          {m.submodulos && <ChevronDown size={15} className="nav-chevron" />}
                        </button>
                        {desplegado && m.submodulos && (
                          <div className="nav-submodulos">
                            {subs.map((s) => (
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
            ))}
        </nav>

      </aside>
    </>
  );
};
