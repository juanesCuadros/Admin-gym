export type TabPortal = 'perfil' | 'progreso' | 'finanzas' | 'asistencias';
export type MetricaGrafica = 'peso' | 'grasa_pct' | 'masa_muscular' | 'cintura';

export function etiquetaEstadoMembresia(estado: string): { texto: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  switch (estado) {
    case 'activo':
      return { texto: 'Membresía Activa', variant: 'success' };
    case 'por_vencer':
      return { texto: 'Por Vencer', variant: 'warning' };
    case 'en_gracia':
      return { texto: 'En Días de Gracia', variant: 'warning' };
    case 'congelado':
      return { texto: 'Congelada', variant: 'info' };
    case 'vencido':
      return { texto: 'Vencida', variant: 'danger' };
    case 'cancelado':
      return { texto: 'Cancelada', variant: 'danger' };
    default:
      return { texto: 'Sin Membresía Activa', variant: 'neutral' };
  }
}

