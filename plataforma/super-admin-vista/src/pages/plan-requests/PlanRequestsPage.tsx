import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/forms/FilterBar';
import { Select } from '@/components/forms/Select';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { Button } from '@/components/actions/Button';
import { ApprovePlanRequestModal } from '@/components/business/ApprovePlanRequestModal';
import { RejectPlanRequestModal } from '@/components/business/RejectPlanRequestModal';
import { usePlanRequests } from '@/hooks/usePlanRequests';
import { EstadoSolicitudPlan, SolicitudPlan } from '@/types/planRequest.types';
import { formatCOP, formatFechaHora } from '@/utils/format';
import { CheckCircle2, XCircle } from 'lucide-react';

const ESTADOS: EstadoSolicitudPlan[] = ['pendiente', 'aprobada', 'rechazada', 'cancelada'];

const ETIQUETA: Record<EstadoSolicitudPlan, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

/** Color del distintivo según el estado de la solicitud. */
const BADGE: Record<EstadoSolicitudPlan, string> = {
  pendiente: 'por_vencer',
  aprobada: 'activo',
  rechazada: 'suspendido',
  cancelada: 'cancelado',
};

/** `?estado=` de la URL. Sin parámetro → pendientes; `todas` → sin filtro. */
function leerEstado(v: string | null): EstadoSolicitudPlan | '' {
  if (v === 'todas') return '';
  return v && (ESTADOS as string[]).includes(v) ? (v as EstadoSolicitudPlan) : 'pendiente';
}

/** Solicitudes de cambio de plan hechas por los gimnasios (SA-RF-33, contrato 3.1). */
export const PlanRequestsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const estado = leerEstado(searchParams.get('estado'));
  const { solicitudes, isLoading, error, refetch } = usePlanRequests(estado);

  const [aprobando, setAprobando] = useState<SolicitudPlan | null>(null);
  const [rechazando, setRechazando] = useState<SolicitudPlan | null>(null);

  const cambiarEstado = (v: EstadoSolicitudPlan | '') => {
    setSearchParams(v === 'pendiente' ? {} : { estado: v || 'todas' }, { replace: true });
  };

  const columns: ColumnDef<SolicitudPlan>[] = [
    {
      id: 'gimnasio',
      header: 'Gimnasio',
      render: (row) => (
        <div>
          <Link
            to={`/gyms/${row.gimnasio.id}`}
            style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}
          >
            {row.gimnasio.nombre}
          </Link>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>{row.gimnasio.subdominio}</div>
        </div>
      ),
    },
    {
      id: 'plan',
      header: 'Plan solicitado',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.plan.nombre}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {formatCOP(row.plan.precio)}/mes
            {row.plan.duracion_meses ? ` · ${row.plan.duracion_meses} mes(es) por pago` : ''}
          </div>
        </div>
      ),
    },
    {
      id: 'solicitud',
      header: 'Solicitud',
      render: (row) => (
        <div style={{ fontSize: 'var(--font-size-sm)', maxWidth: '280px' }}>
          <div style={{ fontFamily: 'var(--font-mono)' }}>{formatFechaHora(row.created_at)}</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-xs)' }}>Por {row.solicitado_por}</div>
          {row.nota && <div style={{ marginTop: '4px', color: 'var(--color-text-secondary)' }}>"{row.nota}"</div>}
        </div>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (row) => (
        <div style={{ fontSize: 'var(--font-size-xs)', maxWidth: '240px' }}>
          <StatusBadge status={BADGE[row.estado] ?? row.estado} label={ETIQUETA[row.estado] ?? row.estado} size="sm" />
          {row.resuelta_en && (
            <div style={{ marginTop: '4px', color: 'var(--color-text-tertiary)' }}>{formatFechaHora(row.resuelta_en)}</div>
          )}
          {row.motivo_rechazo && <div style={{ marginTop: '2px', color: 'var(--color-text-secondary)' }}>{row.motivo_rechazo}</div>}
        </div>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) =>
        row.estado === 'pendiente' ? (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <Button variant="primary" size="sm" leftIcon={<CheckCircle2 size={14} />} onClick={() => setAprobando(row)}>
              Aprobar
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<XCircle size={14} />} onClick={() => setRechazando(row)}>
              Rechazar
            </Button>
          </div>
        ) : null,
    },
  ];

  const filtrado = estado !== 'pendiente';

  return (
    <PageContainer>
      <PageHeader
        title="Solicitudes de plan"
        subtitle="Cambios de plan pedidos por los gimnasios. Aprobar registra el pago y asigna el plan; rechazar exige un motivo."
      />

      <FilterBar>
        <div style={{ width: '220px' }}>
          <Select
            value={estado || 'todas'}
            onChange={(e) => cambiarEstado(e.target.value === 'todas' ? '' : (e.target.value as EstadoSolicitudPlan))}
            aria-label="Estado de la solicitud"
            options={[...ESTADOS.map((e) => ({ value: e, label: ETIQUETA[e] })), { value: 'todas', label: 'Todos los estados' }]}
          />
        </div>
        {filtrado && (
          <Button variant="ghost" size="sm" onClick={() => cambiarEstado('pendiente')}>
            Ver pendientes
          </Button>
        )}
      </FilterBar>

      <DataTable
        columns={columns}
        data={solicitudes}
        keyExtractor={(s) => s.id}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        emptyTitle={estado === 'pendiente' ? 'No hay solicitudes pendientes' : 'No hay resultados'}
        emptyDescription={
          estado === 'pendiente'
            ? 'Cuando un gimnasio pida cambiar de plan desde su Sistema Web, la solicitud aparecerá aquí.'
            : 'No hay solicitudes con este estado.'
        }
        emptyAction={
          filtrado ? (
            <Button variant="secondary" onClick={() => cambiarEstado('pendiente')}>
              Ver pendientes
            </Button>
          ) : undefined
        }
      />

      <ApprovePlanRequestModal
        isOpen={aprobando !== null}
        onClose={() => setAprobando(null)}
        solicitud={aprobando}
        onResuelta={refetch}
      />
      <RejectPlanRequestModal
        isOpen={rechazando !== null}
        onClose={() => setRechazando(null)}
        solicitud={rechazando}
        onResuelta={refetch}
      />
    </PageContainer>
  );
};
