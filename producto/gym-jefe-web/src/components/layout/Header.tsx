import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { BuscadorModulos } from './BuscadorModulos';

interface HeaderProps {
  onToggleSidebar: () => void;
  /** Recepcionista sin turno: no se ofrece el buscador (solo puede estar en /caja). */
  navegacionBloqueada?: boolean;
}

/** Header (§B3): nombre y logo · estado de caja · buscador. La cuenta está en la barra de módulos. Sin selector de gimnasio. */
export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, navegacionBloqueada = false }) => {
  const { hasPermission } = useAuth();
  const { tenant, themeMode, toggleThemeMode } = useTenantTheme();
  const { turno, cargando, error, turnoAbierto } = useCajaTurno();
  const navigate = useNavigate();

  const puedeVerCaja = hasPermission('caja', 'leer');

  // Estado de caja (§B3): chip clicable a la derecha del header que lleva a /caja.
  let estadoCaja: React.ReactNode = null;
  if (puedeVerCaja) {
    let clase = 'neutral';
    let texto = 'Caja: consultando…';
    let corto = 'Caja…';
    let titulo = 'Consultando el estado de la caja';
    if (!cargando && error) {
      texto = 'Caja: sin datos';
      corto = 'Caja';
      titulo = 'No se pudo consultar la caja';
    } else if (!cargando && turnoAbierto) {
      clase = 'ok';
      texto = 'Caja abierta';
      corto = 'Abierta';
      titulo = turno?.staff_nombre ? `Turno abierto por ${turno.staff_nombre}` : 'Turno abierto';
    } else if (!cargando) {
      clase = 'warn';
      texto = 'Caja cerrada';
      corto = 'Cerrada';
      titulo = 'No hay turno abierto';
    }
    estadoCaja = (
      <button
        type="button"
        className={`status-pill status-pill-btn ${clase}`}
        onClick={() => navigate('/caja')}
        title={titulo}
        aria-label={`${texto}. Ir a caja`}
      >
        <span className="status-pill-largo">{texto}</span>
        <span className="status-pill-corto">{corto}</span>
      </button>
    );
  }

  return (
    <header className="app-header">
      <div className="header-left">
        <button type="button" onClick={onToggleSidebar} className="icon-btn header-menu-btn" aria-label="Abrir menú">
          <Menu size={18} />
        </button>

        <div className="header-gym">
          {tenant.logo_url && <img src={tenant.logo_url} alt="" className="header-gym-logo" />}
          <span className="header-gym-name">{tenant.nombre}</span>
        </div>
      </div>

      <div className="header-right">
        {estadoCaja}

        <BuscadorModulos deshabilitado={navegacionBloqueada} />

        <button
          type="button"
          className="icon-btn"
          onClick={toggleThemeMode}
          title={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label={themeMode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {themeMode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>
    </header>
  );
};
