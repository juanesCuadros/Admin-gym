import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/forms/FilterBar';
import { SearchInput } from '@/components/forms/SearchInput';
import { Select } from '@/components/forms/Select';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { Pagination } from '@/components/navigation/Pagination';
import { Button } from '@/components/actions/Button';
import { useGyms } from '@/hooks/useGyms';
import { GymListItem } from '@/types/gym.types';
import { PlusCircle, Building2, ChevronRight, Phone, Mail } from 'lucide-react';

export const GymListPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    gyms,
    isLoading,
    error,
    search,
    setSearch,
    estado,
    setEstado,
    orderBy,
    setOrderBy,
    limit,
    offset,
    setOffset,
    refetch,
  } = useGyms();

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
      header: 'Gimnasio',
      sortable: true,
      accessorKey: 'nombre',
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
      accessorKey: 'estado',
      render: (row) => <StatusBadge status={row.estado} />,
    },
    {
      id: 'fecha_corte',
      header: 'Corte / Vencimiento',
      sortable: true,
      accessorKey: 'fecha_corte',
      render: (row) => {
        if (!row.fecha_corte) return <span style={{ color: 'var(--color-text-tertiary)' }}>Sin fecha</span>;
        const dias = row.dias_restantes;
        const isUrgent = dias !== null && dias !== undefined && dias <= 5;
        const isExpired = dias !== null && dias !== undefined && dias < 0;

        return (
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-medium)' }}>
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
                  ? `Vencido (${Math.abs(dias)}d)`
                  : dias === 0
                  ? 'Vence hoy'
                  : `En ${dias} días`}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'ubicacion',
      header: 'Ciudad / Teléfono',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.ciudad || 'Colombia'}</div>
          {row.telefono && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Phone size={12} />
              <span>{row.telefono}</span>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'jefe',
      header: 'Jefe / Dueño',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{row.jefe_nombre || '—'}</div>
          {row.jefe_correo && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Mail size={12} />
              <span>{row.jefe_correo}</span>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'valor_mensual',
      header: 'Tarifa Mensual',
      align: 'right',
      accessorKey: 'valor_mensual',
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
            Ficha
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Directorio de Gimnasios"
        subtitle="Administración centralizada de centros afiliados, estados de suscripción y accesos (RF-02/RF-03)."
        actions={
          <Link to="/gyms/new">
            <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
              Nuevo Gimnasio
            </Button>
          </Link>
        }
      />

      {/* Filter Bar */}
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre, subdominio o ciudad…"
          style={{ maxWidth: '340px' }}
        />

        <div style={{ width: '180px' }}>
          <Select
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            options={[
              { value: '', label: 'Todos los estados' },
              { value: 'activo', label: 'Activo' },
              { value: 'prueba', label: 'En prueba' },
              { value: 'suspendido', label: 'Suspendido' },
              { value: 'cancelado', label: 'Cancelado' },
            ]}
          />
        </div>

        <div style={{ width: '220px' }}>
          <Select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value as any)}
            options={[
              { value: 'urgency', label: 'Orden: Por Urgencia (Corte)' },
              { value: 'nombre', label: 'Orden: Nombre Alfabético' },
              { value: 'fecha_corte', label: 'Orden: Fecha de Corte' },
              { value: 'created_at', label: 'Orden: Más recientes' },
            ]}
          />
        </div>
      </FilterBar>

      {/* Main Table */}
      <DataTable
        columns={columns}
        data={gyms}
        keyExtractor={(item) => item.id}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => navigate(`/gyms/${row.id}`)}
        emptyTitle="No se encontraron gimnasios"
        emptyDescription={
          search || estado
            ? 'Prueba ajustando los filtros de búsqueda o estado.'
            : 'Aún no se han dado de alta gimnasios en el sistema.'
        }
        emptyAction={
          <Link to="/gyms/new">
            <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
              Crear Gimnasio
            </Button>
          </Link>
        }
      />

      {/* Pagination */}
      {gyms.length > 0 && (
        <Pagination
          limit={limit}
          offset={offset}
          totalCount={gyms.length >= limit ? offset + limit + 1 : offset + gyms.length}
          onPageChange={setOffset}
        />
      )}
    </PageContainer>
  );
};
