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
  etiqueta: string;
  ruta: string;
}

export interface ModuloNav {
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
      { etiqueta: 'Inicio', ruta: '/', icono: LayoutDashboard, submodulo: null },
      {
        etiqueta: 'Control de ingreso',
        ruta: '/control-ingreso',
        icono: ShieldCheck,
        submodulo: 'control_ingreso',
        submodulos: [
          { etiqueta: 'Check-in', ruta: '/control-ingreso' },
          { etiqueta: 'Ingresos de hoy', ruta: '/control-ingreso/ingresos-hoy' },
          { etiqueta: 'Pantalla TV', ruta: '/control-ingreso/pantalla-tv' },
        ],
      },
      {
        etiqueta: 'Caja',
        ruta: '/caja',
        icono: CreditCard,
        submodulo: 'caja',
        submodulos: [
          { etiqueta: 'Turno actual', ruta: '/caja' },
          { etiqueta: 'Punto de venta', ruta: '/caja/punto-de-venta' },
          { etiqueta: 'Historial de turnos', ruta: '/caja/historial' },
        ],
      },
      { etiqueta: 'Deportistas', ruta: '/deportistas', icono: Users, submodulo: 'deportistas' },
      {
        etiqueta: 'Membresías',
        ruta: '/membresias',
        icono: Award,
        submodulo: 'membresias',
        submodulos: [
          { etiqueta: 'Membresías', ruta: '/membresias' },
          { etiqueta: 'Planes', ruta: '/membresias/planes' },
        ],
      },
      { etiqueta: 'Clases', ruta: '/clases', icono: Calendar, submodulo: 'clases' },
      {
        etiqueta: 'Entrenamiento',
        ruta: '/entrenamiento',
        icono: Dumbbell,
        submodulo: 'entrenamiento',
        submodulos: [
          { etiqueta: 'Ejercicios', ruta: '/entrenamiento' },
          { etiqueta: 'Plantillas', ruta: '/entrenamiento/plantillas' },
          { etiqueta: 'Rutinas asignadas', ruta: '/entrenamiento/rutinas' },
        ],
      },
      {
        etiqueta: 'Inventario',
        ruta: '/inventario',
        icono: Package,
        submodulo: 'inventario',
        submodulos: [
          { etiqueta: 'Productos', ruta: '/inventario' },
          { etiqueta: 'Movimientos de stock', ruta: '/inventario/movimientos' },
        ],
      },
      {
        etiqueta: 'Reportes',
        ruta: '/reportes',
        icono: BarChart3,
        submodulo: 'reportes',
        submodulos: [
          { etiqueta: 'Ingresos', ruta: '/reportes' },
          { etiqueta: 'Membresías', ruta: '/reportes/membresias' },
          { etiqueta: 'Asistencia', ruta: '/reportes/asistencia' },
        ],
      },
    ],
  },
  {
    etiqueta: 'Administración',
    modulos: [
      {
        etiqueta: 'Personal',
        ruta: '/personal',
        icono: UserCheck,
        submodulo: 'personal',
        submodulos: [
          { etiqueta: 'Staff', ruta: '/personal' },
          { etiqueta: 'Permisos', ruta: '/personal/permisos' },
        ],
      },
      {
        etiqueta: 'Configuración',
        ruta: '/configuracion',
        icono: Settings,
        submodulo: 'configuracion',
        submodulos: [
          { etiqueta: 'General', ruta: '/configuracion' },
          { etiqueta: 'Landing', ruta: '/configuracion/landing' },
          { etiqueta: 'Métodos de pago', ruta: '/configuracion/metodos-pago' },
          { etiqueta: 'Parámetros', ruta: '/configuracion/parametros' },
        ],
      },
      { etiqueta: 'Auditoría', ruta: '/auditoria', icono: ScrollText, submodulo: null, soloJefe: true },
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
