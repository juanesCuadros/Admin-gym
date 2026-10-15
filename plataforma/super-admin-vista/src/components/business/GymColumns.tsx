import React from 'react';
import { ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { GymListItem } from '@/types/gym.types';
import { formatCOP, formatFecha, textoDiasRestantes } from '@/utils/format';
import { etiquetaEstadoCalculado } from '@/utils/estados';

/** Columnas del listado de gimnasios (SA-RF-03, contrato 3.3). Se pueden reutilizar en otras tablas de gimnasios. */

export const columnaGimnasio: ColumnDef<GymListItem> = {
  id: 'nombre',
  header: 'Gimnasio',
  render: (row) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div
        style={{
          width: '36px',
          height: '36px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-action)',
          flexShrink: 0,
        }}
      >
        {row.nombre.substring(0, 2).toUpperCase()}
      </div>
      <div>
        <div style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>{row.nombre}</div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>{row.subdominio}</div>
      </div>
    </div>
  ),
};

export const columnaEstados: ColumnDef<GymListItem> = {
  id: 'estado',
  header: 'Estado',
  render: (row) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
      <StatusBadge status={row.estado} size="sm" />
      {row.estado_calculado && (
        <span title={row.motivo_bloqueo || undefined}>
          <StatusBadge status={row.estado_calculado} label={etiquetaEstadoCalculado(row.estado_calculado)} size="sm" />
        </span>
      )}
    </div>
  ),
};

export const columnaCorte: ColumnDef<GymListItem> = {
  id: 'fecha_corte',
  header: 'Corte',
  render: (row) => {
    const dias = row.dias_restantes;
    const color =
      dias !== null && dias !== undefined && dias < 0
        ? 'var(--color-error)'
        : dias !== null && dias !== undefined && dias <= 5
        ? 'var(--color-warning)'
        : 'var(--color-text-secondary)';
    return (
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-medium)' }}>
          {row.fecha_corte ? formatFecha(row.fecha_corte) : 'Sin fecha'}
        </div>
        {row.estado !== 'cancelado' && (
          <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color }}>
            {textoDiasRestantes(dias)}
          </div>
        )}
      </div>
    );
  },
};

export const columnaPlan: ColumnDef<GymListItem> = {
  id: 'plan',
  header: 'Plan',
  render: (row) => (
    <div>
      <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.plan_nombre || 'Sin plan'}</div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {row.valor_mensual !== null && row.valor_mensual !== undefined ? `${formatCOP(row.valor_mensual)}/mes` : '—'}
      </div>
    </div>
  ),
};

export const columnaJefe: ColumnDef<GymListItem> = {
  id: 'jefe',
  header: 'Jefe',
  render: (row) => (
    <div>
      <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.jefe_nombre || '—'}</div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
        {row.jefe_correo || row.telefono || ''}
      </div>
    </div>
  ),
};
