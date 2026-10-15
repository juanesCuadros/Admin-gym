import React, { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { Button } from '@/components/actions/Button';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { Alert } from '@/components/feedback/Alert';
import { PlanFormModal } from '@/components/business/PlanFormModal';
import { usePlans } from '@/hooks/usePlans';
import { useToast } from '@/hooks/useToast';
import { planService } from '@/services/planService';
import { parseApiError } from '@/services/api/errorHandler';
import { Plan } from '@/types/plan.types';
import { formatCOP } from '@/utils/format';
import { Pencil, PlusCircle, Power } from 'lucide-react';

function limite(v: number | null | undefined): string {
  return v !== null && v !== undefined ? v.toLocaleString('es-CO') : 'Sin límite';
}

/** Planes de suscripción del SaaS (SA-RF-33, contrato 3.1). */
export const PlansPage: React.FC = () => {
  const { success } = useToast();
  const { plans, isLoading, error, refetch, reemplazar } = usePlans();

  const [formAbierto, setFormAbierto] = useState(false);
  const [editando, setEditando] = useState<Plan | null>(null);

  const [cambiandoEstado, setCambiandoEstado] = useState<Plan | null>(null);
  const [enviandoEstado, setEnviandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  const abrirCrear = () => {
    setEditando(null);
    setFormAbierto(true);
  };
  const abrirEditar = (plan: Plan) => {
    setEditando(plan);
    setFormAbierto(true);
  };

  const recargarPlan = async (planId: string) => {
    const lista = await refetch();
    return lista?.find((p) => p.id === planId) ?? null;
  };

  const abrirCambioEstado = (plan: Plan) => {
    setErrorEstado(null);
    setCambiandoEstado(plan);
  };

  const confirmarCambioEstado = async () => {
    if (!cambiandoEstado || enviandoEstado) return;
    const activar = !cambiandoEstado.activo;
    setEnviandoEstado(true);
    setErrorEstado(null);
    try {
      const actualizado = await planService.setPlanStatus(cambiandoEstado.id, activar);
      reemplazar(actualizado);
      success(`Plan "${actualizado.nombre}" ${activar ? 'activado' : 'desactivado'}.`);
      setCambiandoEstado(null);
    } catch (err) {
      setErrorEstado(parseApiError(err).message);
    } finally {
      setEnviandoEstado(false);
    }
  };

  const columns: ColumnDef<Plan>[] = [
    {
      id: 'nombre',
      header: 'Plan',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>{row.nombre}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {row.codigo}
          </div>
        </div>
      ),
    },
    {
      id: 'tipo',
      header: 'Tipo',
      render: (row) => (row.tipo === 'prueba' ? `Prueba · ${row.dias_prueba ?? '—'} días` : `Pago · ${row.duracion_meses ?? '—'} mes(es)`),
    },
    {
      id: 'precio',
      header: 'Precio mensual',
      align: 'right',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-semibold)' }}>{formatCOP(row.precio)}</span>
      ),
    },
    {
      id: 'limites',
      header: 'Límites',
      render: (row) => (
        <div style={{ fontSize: 'var(--font-size-sm)' }}>
          <div>Clientes activos: {limite(row.max_clientes_activos)}</div>
          <div style={{ color: 'var(--color-text-tertiary)' }}>Staff: {limite(row.max_staff)}</div>
        </div>
      ),
    },
    {
      id: 'gimnasios',
      header: 'Gimnasios',
      align: 'right',
      render: (row) => <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{row.gimnasios_actuales}</span>,
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
          <StatusBadge status={row.activo ? 'activo' : 'cancelado'} label={row.activo ? 'Activo' : 'Inactivo'} size="sm" />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
            {row.publico ? 'Público' : 'Solo interno'}
          </span>
        </div>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" leftIcon={<Pencil size={14} />} onClick={() => abrirEditar(row)}>
            Editar
          </Button>
          <Button
            variant={row.activo ? 'ghost' : 'secondary'}
            size="sm"
            leftIcon={<Power size={14} />}
            onClick={() => abrirCambioEstado(row)}
          >
            {row.activo ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      ),
    },
  ];

  const desactivando = cambiandoEstado?.activo ?? false;
  const n = cambiandoEstado?.gimnasios_actuales ?? 0;
  const mensajeEstado = cambiandoEstado
    ? desactivando
      ? `¿Desactivar "${cambiandoEstado.nombre}"? No se podrá asignar a gimnasios nuevos ni aparecerá en el sitio público. ` +
        (n > 0
          ? `Los ${n} gimnasio(s) que lo tienen hoy lo conservan hasta que se les cambie el plan.`
          : 'Ningún gimnasio lo tiene como plan vigente.')
      : `¿Activar "${cambiandoEstado.nombre}"? Se podrá asignar a gimnasios` +
        (cambiandoEstado.publico ? ' y aparecerá en el sitio público.' : '.')
    : '';

  return (
    <PageContainer>
      <PageHeader
        title="Planes de suscripción"
        subtitle="Catálogo de planes del SaaS: precio mensual, duración por pago y límites de clientes y staff."
        actions={
          <Button variant="primary" leftIcon={<PlusCircle size={16} />} onClick={abrirCrear}>
            Crear plan
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={plans}
        keyExtractor={(p) => p.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyTitle="Aún no hay planes"
        emptyDescription="Los planes definen el precio y los límites de cada gimnasio. Crea el primero para poder dar de alta gimnasios."
        emptyAction={
          <Button variant="primary" leftIcon={<PlusCircle size={16} />} onClick={abrirCrear}>
            Crear el primer plan
          </Button>
        }
      />

      <PlanFormModal
        isOpen={formAbierto}
        onClose={() => setFormAbierto(false)}
        plan={editando}
        onSaved={reemplazar}
        onRecargar={recargarPlan}
      />

      <ConfirmationDialog
        isOpen={cambiandoEstado !== null}
        onClose={() => {
          if (!enviandoEstado) setCambiandoEstado(null);
        }}
        onConfirm={confirmarCambioEstado}
        title={desactivando ? 'Desactivar plan' : 'Activar plan'}
        message={mensajeEstado}
        confirmLabel={desactivando ? 'Desactivar' : 'Activar'}
        cancelLabel="Volver"
        isDestructive={desactivando}
        isLoading={enviandoEstado}
      >
        {errorEstado && <Alert type="error" message={errorEstado} style={{ marginBottom: 0 }} />}
      </ConfirmationDialog>
    </PageContainer>
  );
};
