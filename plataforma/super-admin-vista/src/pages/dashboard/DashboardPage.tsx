import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ContentSection } from '@/components/layout/ContentSection';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { MetricGrid } from '@/components/dashboard/MetricGrid';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { Button } from '@/components/actions/Button';
import { dashboardService } from '@/services/dashboardService';
import { gymService } from '@/services/gymService';
import { DashboardMetrics } from '@/types/dashboard.types';
import { GymListItem } from '@/types/gym.types';
import { parseApiError } from '@/services/api/errorHandler';
import {
  Building2,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  Users,
  PlusCircle,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [urgentGyms, setUrgentGyms] = useState<GymListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [metricsData, gymsData] = await Promise.all([
        dashboardService.getMetrics(),
        gymService.listGyms({ order_by: 'urgency', limit: 8 }),
      ]);
      setMetrics(metricsData);
      setUrgentGyms(gymsData);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const formatCOP = (val: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const columns: ColumnDef<GymListItem>[] = [
    {
      id: 'nombre',
      header: 'Gimnasio / Tenant',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'var(--font-weight-bold)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-action)',
            }}
          >
            {row.nombre.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
              {row.nombre}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              {row.subdominio}.gymos.io
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'estado',
      header: 'Estado',
      render: (row) => <StatusBadge status={row.estado} />,
    },
    {
      id: 'fecha_corte',
      header: 'Fecha de Corte',
      render: (row) => {
        if (!row.fecha_corte) return <span style={{ color: 'var(--color-text-tertiary)' }}>Sin fecha</span>;
        const dias = row.dias_restantes;
        const isUrgent = dias !== null && dias !== undefined && dias <= 5;
        const isExpired = dias !== null && dias !== undefined && dias < 0;

        return (
          <div>
            <div style={{ fontWeight: 'var(--font-weight-medium)', fontFamily: 'var(--font-mono)' }}>
              {row.fecha_corte}
            </div>
            {dias !== null && dias !== undefined && (
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: isExpired
                    ? 'var(--color-error)'
                    : isUrgent
                    ? 'var(--color-warning)'
                    : 'var(--color-text-secondary)',
                }}
              >
                {isExpired
                  ? `Vencido hace ${Math.abs(dias)} días`
                  : dias === 0
                  ? 'Vence hoy'
                  : `Vence en ${dias} días`}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'jefe',
      header: 'Dueño / Contacto',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.jefe_nombre || '—'}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
            {row.jefe_correo || row.telefono || '—'}
          </div>
        </div>
      ),
    },
    {
      id: 'tarifa',
      header: 'Tarifa Mensual',
      align: 'right',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-semibold)' }}>
          {row.valor_mensual ? formatCOP(row.valor_mensual) : '—'}
        </span>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) => (
        <Link to={`/gyms/${row.id}`}>
          <Button variant="ghost" size="sm" rightIcon={<ChevronRight size={14} />}>
            Ver Ficha
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Torre de Control"
        subtitle="Supervisión global de la red SaaS GymOS, estado de ingresos y monitoreo de clientes."
        actions={
          <div style={{ display: 'flex', gap: '10px' }}>
            <Link to="/audit">
              <Button variant="secondary" leftIcon={<ShieldCheck size={16} />}>
                Auditoría
              </Button>
            </Link>
            <Link to="/gyms/new">
              <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
                Alta de Gimnasio
              </Button>
            </Link>
          </div>
        }
      />

      {/* KPI Metric Cards */}
      <MetricGrid columns={4}>
        <MetricCard
          title="MRR Estimado"
          value={metrics ? formatCOP(metrics.mrr_estimado) : '—'}
          subtitle="Ingreso mensual recurrente"
          icon={<TrendingUp size={20} />}
          iconBg="var(--color-success-light)"
          iconColor="var(--color-success)"
        />

        <MetricCard
          title="Recaudo Mes en Curso"
          value={metrics ? formatCOP(metrics.ingresos_mes) : '—'}
          subtitle="Pagos efectivos registrados"
          icon={<DollarSign size={20} />}
          iconBg="var(--color-action-light)"
          iconColor="var(--color-action)"
        />

        <MetricCard
          title="Gimnasios Activos"
          value={metrics ? `${metrics.por_estado?.['activo'] || 0} / ${metrics.total_gimnasios}` : '—'}
          subtitle={`${metrics?.total_miembros_global || 0} miembros en plataforma`}
          icon={<Building2 size={20} />}
          iconBg="var(--color-purple-light)"
          iconColor="var(--color-purple)"
        />

        <MetricCard
          title="Urgencias de Cobro"
          value={metrics ? `${metrics.vencidos} vencidos` : '—'}
          subtitle={`${metrics?.por_vencer || 0} por vencer en 5 días`}
          icon={<AlertTriangle size={20} />}
          iconBg={metrics && metrics.vencidos > 0 ? 'var(--color-error-light)' : 'var(--color-warning-light)'}
          iconColor={metrics && metrics.vencidos > 0 ? 'var(--color-error)' : 'var(--color-warning)'}
          variant={metrics && metrics.vencidos > 0 ? 'error' : 'default'}
        />
      </MetricGrid>

      {/* Secondary Status Strip */}
      {metrics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-bg-card)',
              padding: '14px 18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="var(--color-warning)" />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                Pruebas por Vencer
              </span>
            </div>
            <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
              {metrics.pruebas_por_vencer}
            </span>
          </div>

          <div
            style={{
              backgroundColor: 'var(--color-bg-card)',
              padding: '14px 18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={16} color="var(--color-indigo)" />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                Total Miembros Red
              </span>
            </div>
            <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
              {metrics.total_miembros_global.toLocaleString('es-CO')}
            </span>
          </div>

          <div
            style={{
              backgroundColor: 'var(--color-bg-card)',
              padding: '14px 18px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building2 size={16} color="var(--color-text-tertiary)" />
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                En Suspensión / Bajas
              </span>
            </div>
            <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
              {(metrics.por_estado?.['suspendido'] || 0) + (metrics.por_estado?.['cancelado'] || 0)}
            </span>
          </div>
        </div>
      )}

      {/* Urgency Gyms Table (RF-02) */}
      <ContentSection
        title="Gimnasios Prioritarios por Urgencia (RF-02)"
        subtitle="Ordenados automáticamente con los vencidos y próximos a corte al inicio."
        actions={
          <Link to="/gyms">
            <Button variant="ghost" size="sm" rightIcon={<ExternalLink size={14} />}>
              Ver Directorio Completo
            </Button>
          </Link>
        }
        noPadding
      >
        <DataTable
          columns={columns}
          data={urgentGyms}
          keyExtractor={(item) => item.id}
          isLoading={isLoading}
          error={error}
          onRetry={loadDashboardData}
          onRowClick={(row) => navigate(`/gyms/${row.id}`)}
          emptyTitle="No hay gimnasios registrados aún"
          emptyDescription="Comienza dando de alta el primer centro deportivo cliente de GymOS con el asistente."
          emptyAction={
            <Link to="/gyms/new">
              <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
                Crear Primer Gimnasio
              </Button>
            </Link>
          }
        />
      </ContentSection>
    </PageContainer>
  );
};
