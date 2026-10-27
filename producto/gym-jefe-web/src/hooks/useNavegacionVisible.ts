import { useAuth } from '../contexts/AuthContext';
import {
  NAVEGACION,
  GrupoNav,
  ModuloNav,
  SubmoduloNav,
  moduloActivoEnDespliegue,
  submodulosActivos,
} from '../navegacion';

export interface ModuloVisible {
  modulo: ModuloNav;
  /** Submódulos que este usuario puede ver (vacío si el módulo no tiene submódulos). */
  submodulos: SubmoduloNav[];
}

export interface GrupoVisible {
  grupo: GrupoNav;
  modulos: ModuloVisible[];
}

/**
 * Navegación filtrada por permisos (§B2) y por `VITE_MODULOS_ACTIVOS`.
 * Única fuente para el Sidebar y el buscador de módulos del Header,
 * así ambos muestran exactamente lo mismo.
 */
export function useNavegacionVisible(): GrupoVisible[] {
  const { hasPermission, isJefe } = useAuth();

  const subsVisibles = (m: ModuloNav): SubmoduloNav[] =>
    submodulosActivos(m).filter((s) => !s.soloJefe || isJefe);

  const puedeVer = (m: ModuloNav): boolean => {
    if (!moduloActivoEnDespliegue(m)) return false;
    if (m.submodulos && subsVisibles(m).length === 0) return false;
    if (m.soloJefe) return isJefe;
    if (m.submodulo === null) return true;
    return hasPermission(m.submodulo, 'leer');
  };

  return NAVEGACION.map((grupo) => ({
    grupo,
    modulos: grupo.modulos.filter(puedeVer).map((modulo) => ({
      modulo,
      submodulos: modulo.submodulos ? subsVisibles(modulo) : [],
    })),
  })).filter((g) => g.modulos.length > 0);
}
