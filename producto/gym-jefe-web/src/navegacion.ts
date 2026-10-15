import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShieldCheck,
  CreditCard,
  Users,
  Award,
  Calendar,
  Dumbbell,
  Package,
  BarChart3,
  UserCheck,
  Settings,
  ScrollText,
} from 'lucide-react';

/**
 * Navegación del sistema (§B2). Única fuente para el sidebar y para las rutas de `App.tsx`.
 * `submodulo` es la clave de la matriz de permisos del backend (`platform.permisos_rol`).
 * Las vistas de detalle (ficha de deportista, detalle de clase, ficha de producto) no van aquí.
 */

export interface SubmoduloNav {
  /** Identificador para `VITE_MODULOS_ACTIVOS` (p. ej. `caja.punto_de_venta`). */
  id: string;
  etiqueta: string;
  ruta: string;
  /** Submódulo exclusivo del Jefe (p. ej. Mi suscripción). */
  soloJefe?: boolean;
}

export interface ModuloNav {
  /** Identificador para `VITE_MODULOS_ACTIVOS` (p. ej. `caja`). */
  id: string;
  etiqueta: string;
  ruta: string;
  icono: LucideIcon;
  /** Clave de permiso. `null` = visible para cualquier usuario autenticado (Inicio). */
  submodulo: string | null;
  /** Auditoría solo la ve el Jefe; el backend exige `require_role("jefe")`. */
  soloJefe?: boolean;
  submodulos?: SubmoduloNav[];
}

export interface GrupoNav {
  etiqueta: string;
  modulos: ModuloNav[];
}

export const NAVEGACION: GrupoNav[] = [
  {
    etiqueta: 'Operación',
    modulos: [
      { id: 'inicio', etiqueta: 'Inicio', ruta: '/', icono: LayoutDashboard, submodulo: null },
      {
        id: 'control_ingreso',
        etiqueta: 'Control de ingreso',
        ruta: '/control-ingreso',
        icono: ShieldCheck,
        submodulo: 'control_ingreso',
        submodulos: [
          { id: 'control_ingreso.checkin', etiqueta: 'Check-in', ruta: '/control-ingreso' },
          { id: 'control_ingreso.ingresos_hoy', etiqueta: 'Ingresos de hoy', ruta: '/control-ingreso/ingresos-hoy' },
          { id: 'control_ingreso.pantalla_tv', etiqueta: 'Pantalla TV', ruta: '/control-ingreso/pantalla-tv' },
        ],
      },
      {
        id: 'caja',
        etiqueta: 'Caja',
        ruta: '/caja',
        icono: CreditCard,
        submodulo: 'caja',
        submodulos: [
          { id: 'caja.turno_actual', etiqueta: 'Turno actual', ruta: '/caja' },
          { id: 'caja.punto_de_venta', etiqueta: 'Punto de venta', ruta: '/caja/punto-de-venta' },
          { id: 'caja.historial', etiqueta: 'Historial de turnos', ruta: '/caja/historial' },
        ],
      },
      { id: 'deportistas', etiqueta: 'Deportistas', ruta: '/deportistas', icono: Users, submodulo: 'deportistas' },
      {
        id: 'membresias',
        etiqueta: 'Membresías',
        ruta: '/membresias',
        icono: Award,
        submodulo: 'membresias',
        submodulos: [
          { id: 'membresias.membresias', etiqueta: 'Membresías', ruta: '/membresias' },
          { id: 'membresias.planes', etiqueta: 'Planes', ruta: '/membresias/planes' },
        ],
      },
      { id: 'clases', etiqueta: 'Clases', ruta: '/clases', icono: Calendar, submodulo: 'clases' },
      {
        id: 'entrenamiento',
        etiqueta: 'Entrenamiento',
        ruta: '/entrenamiento',
        icono: Dumbbell,
        submodulo: 'entrenamiento',
        submodulos: [
          { id: 'entrenamiento.ejercicios', etiqueta: 'Ejercicios', ruta: '/entrenamiento' },
          { id: 'entrenamiento.plantillas', etiqueta: 'Plantillas', ruta: '/entrenamiento/plantillas' },
          { id: 'entrenamiento.rutinas', etiqueta: 'Rutinas asignadas', ruta: '/entrenamiento/rutinas' },
        ],
      },
      {
        id: 'inventario',
        etiqueta: 'Inventario',
        ruta: '/inventario',
        icono: Package,
        submodulo: 'inventario',
        submodulos: [
          { id: 'inventario.productos', etiqueta: 'Productos', ruta: '/inventario' },
          { id: 'inventario.movimientos', etiqueta: 'Movimientos de stock', ruta: '/inventario/movimientos' },
        ],
      },
      {
        id: 'reportes',
        etiqueta: 'Reportes',
        ruta: '/reportes',
        icono: BarChart3,
        submodulo: 'reportes',
        submodulos: [
          { id: 'reportes.ingresos', etiqueta: 'Ingresos', ruta: '/reportes' },
          { id: 'reportes.membresias', etiqueta: 'Membresías', ruta: '/reportes/membresias' },
          { id: 'reportes.asistencia', etiqueta: 'Asistencia', ruta: '/reportes/asistencia' },
        ],
      },
    ],
  },
  {
    etiqueta: 'Administración',
    modulos: [
      {
        id: 'personal',
        etiqueta: 'Personal',
        ruta: '/personal',
        icono: UserCheck,
        submodulo: 'personal',
        submodulos: [
          { id: 'personal.staff', etiqueta: 'Staff', ruta: '/personal' },
          { id: 'personal.permisos', etiqueta: 'Permisos', ruta: '/personal/permisos' },
        ],
      },
      {
        id: 'configuracion',
        etiqueta: 'Configuración',
        ruta: '/configuracion',
        icono: Settings,
        submodulo: 'configuracion',
        submodulos: [
          { id: 'configuracion.general', etiqueta: 'General', ruta: '/configuracion' },
          { id: 'configuracion.landing', etiqueta: 'Landing', ruta: '/configuracion/landing' },
          { id: 'configuracion.metodos_pago', etiqueta: 'Métodos de pago', ruta: '/configuracion/metodos-pago' },
          { id: 'configuracion.parametros', etiqueta: 'Parámetros', ruta: '/configuracion/parametros' },
          { id: 'configuracion.suscripcion', etiqueta: 'Mi suscripción', ruta: '/configuracion/suscripcion', soloJefe: true },
          { id: 'configuracion.carga_inicial', etiqueta: 'Carga inicial', ruta: '/configuracion/carga-inicial', soloJefe: true },
        ],
      },
      { id: 'auditoria', etiqueta: 'Auditoría', ruta: '/auditoria', icono: ScrollText, submodulo: null, soloJefe: true },
    ],
  },
];

/** Módulo al que pertenece una ruta (por prefijo más largo). */
export function moduloDeRuta(pathname: string): ModuloNav | null {
  let mejor: ModuloNav | null = null;
  for (const grupo of NAVEGACION) {
    for (const m of grupo.modulos) {
      if (m.ruta === '/') {
        if (pathname === '/') return m;
        continue;
      }
      if (pathname === m.ruta || pathname.startsWith(`${m.ruta}/`)) {
        if (!mejor || m.ruta.length > mejor.ruta.length) mejor = m;
      }
    }
  }
  return mejor;
}

// ---------------------------------------------------------------------------
// Submódulos activos por despliegue (`VITE_MODULOS_ACTIVOS`)
// ---------------------------------------------------------------------------

/**
 * Lista separada por comas. Vacía o ausente = todo activo.
 * Acepta el id de un módulo (`caja`: activa todos sus submódulos) o de un submódulo
 * (`caja.punto_de_venta`: activa solo ese y deja visible su módulo). Inicio siempre está activo.
 * Ejemplo: `VITE_MODULOS_ACTIVOS=control_ingreso,caja.turno_actual,deportistas,membresias`.
 */
function leerModulosActivos(): Set<string> | null {
  const crudo = (import.meta.env.VITE_MODULOS_ACTIVOS ?? '').trim();
  if (!crudo) return null;
  const ids = crudo
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

const MODULOS_ACTIVOS = leerModulosActivos();

/** ¿El submódulo está activo en este despliegue? */
export function submoduloActivo(modulo: ModuloNav, sub: SubmoduloNav): boolean {
  if (!MODULOS_ACTIVOS) return true;
  return MODULOS_ACTIVOS.has(modulo.id) || MODULOS_ACTIVOS.has(sub.id);
}

/** ¿El módulo está activo? Lo está si el módulo o alguno de sus submódulos está en la lista. */
export function moduloActivoEnDespliegue(modulo: ModuloNav): boolean {
  if (!MODULOS_ACTIVOS || modulo.id === 'inicio') return true;
  if (MODULOS_ACTIVOS.has(modulo.id)) return true;
  return (modulo.submodulos ?? []).some((s) => MODULOS_ACTIVOS.has(s.id));
}

/** Submódulos del menú que quedan visibles para este despliegue (sin contar permisos). */
export function submodulosActivos(modulo: ModuloNav): SubmoduloNav[] {
  return (modulo.submodulos ?? []).filter((s) => submoduloActivo(modulo, s));
}

/**
 * ¿La ruta está habilitada en este despliegue? (capa de rutas de `VITE_MODULOS_ACTIVOS`).
 * Una ruta de submódulo exige ese submódulo; una ruta de detalle fuera del menú exige su módulo.
 */
export function rutaHabilitada(pathname: string): boolean {
  if (!MODULOS_ACTIVOS) return true;
  const modulo = moduloDeRuta(pathname);
  if (!modulo) return true; // rutas fuera del menú (p. ej. /cambiar-clave): no las gobierna esta lista
  if (!moduloActivoEnDespliegue(modulo)) return false;
  const sub = (modulo.submodulos ?? []).find((s) => s.ruta === pathname);
  return sub ? submoduloActivo(modulo, sub) : true;
}
