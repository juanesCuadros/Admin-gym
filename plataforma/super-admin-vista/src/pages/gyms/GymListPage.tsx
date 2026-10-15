import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/forms/FilterBar';
import { SearchInput } from '@/components/forms/SearchInput';
import { Select } from '@/components/forms/Select';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { Button } from '@/components/actions/Button';
import { useGyms } from '@/hooks/useGyms';
import { useDebounce } from '@/hooks/useDebounce';
import { FiltroEstadoCalculado, GymListItem, GymState } from '@/types/gym.types';
import { OrdenGimnasios } from '@/services/gymService';
import { ETIQUETA_ESTADO, ETIQUETA_ESTADO_CALCULADO } from '@/utils/estados';
import {
  columnaCorte,
  columnaEstados,
  columnaGimnasio,
  columnaJefe,
  columnaPlan,
} from '@/components/business/GymColumns';
import { PlusCircle, ChevronRight, ChevronLeft } from 'lucide-react';

const ESTADOS: GymState[] = ['prueba', 'activo', 'suspendido', 'cancelado'];
const CALCULADOS: FiltroEstadoCalculado[] = ['bloqueado', 'en_gracia', 'prueba_por_vencer', 'por_vencer', 'al_dia'];

function leerEstado(v: string | null): GymState | '' {
  return v && (ESTADOS as string[]).includes(v) ? (v as GymState) : '';
}
function leerCalculado(v: string | null): FiltroEstadoCalculado | '' {
  return v && (CALCULADOS as string[]).includes(v) ? (v as FiltroEstadoCalculado) : '';
}

/** Listado de gimnasios (SA-RF-03): búsqueda, filtros por estado guardado y calculado, 20 por página. */
export const GymListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    gyms,
    hayMas,
    isLoading,
    error,
    search,
    setSearch,
    estado,
    setEstado,
    estadoCalculado,
    setEstadoCalculado,
    orderBy,
    setOrderBy,
    limit,
    offset,
    setOffset,
    refetch,
  } = useGyms({
    estado: leerEstado(searchParams.get('estado')),
    estado_calculado: leerCalculado(searchParams.get('estado_calculado')),
    search: searchParams.get('q') || '',
  });

  // Búsqueda con espera para no pedir en cada tecla.
  const [texto, setTexto] = useState(search);
  const textoDebounced = useDebounce(texto, 350);
  useEffect(() => {
    if (textoDebounced !== search) setSearch(textoDebounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoDebounced]);

  // Los filtros quedan en la URL para poder compartir o volver al mismo listado.
  useEffect(() => {
    const p = new URLSearchParams();
    if (estado) p.set('estado', estado);
    if (estadoCalculado) p.set('estado_calculado', estadoCalculado);
    if (search) p.set('q', search);
    setSearchParams(p, { replace: true });
  }, [estado, estadoCalculado, search, setSearchParams]);

  const hayFiltros = !!(search || estado || estadoCalculado);
  const pagina = Math.floor(offset / limit) + 1;

  const columns: ColumnDef<GymListItem>[] = [
    columnaGimnasio,
    columnaEstados,
    columnaCorte,
    columnaPlan,
    columnaJefe,
    {
      id: 'ciudad',
      header: 'Ciudad',
      render: (row) => <span>{row.ciudad || '—'}</span>,
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) => (
        <Link to={`/gyms/${row.id}`} onClick={(e) => e.stopPropagation()}>
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
        title="Gimnasios"
        subtitle="Ordenados por urgencia: bloqueados, en gracia, pruebas por vencer y por vencer primero."
        actions={
          <Link to="/gyms/new">
            <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
              Crear gimnasio
            </Button>
          </Link>
        }
      />

      <FilterBar>
        <SearchInput
          value={texto}
          onChange={setTexto}
          onClear={() => setTexto('')}
          placeholder="Buscar por nombre, subdominio, NIT o ciudad…"
          style={{ maxWidth: '320px' }}
        />

        <div style={{ width: '190px' }}>
          <Select
            value={estado}
            onChange={(e) => setEstado(e.target.value as GymState | '')}
            aria-label="Estado guardado"
            options={[
              { value: '', label: 'Estado: todos' },
              ...ESTADOS.map((e) => ({ value: e, label: ETIQUETA_ESTADO[e] })),
            ]}
          />
        </div>

        <div style={{ width: '220px' }}>
          <Select
            value={estadoCalculado}
            onChange={(e) => setEstadoCalculado(e.target.value as FiltroEstadoCalculado | '')}
            aria-label="Estado calculado"
            options={[
              { value: '', label: 'Estado calculado: todos' },
              ...CALCULADOS.map((c) => ({ value: c, label: ETIQUETA_ESTADO_CALCULADO[c] })),
            ]}
          />
        </div>

        <div style={{ width: '210px' }}>
          <Select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value as OrdenGimnasios)}
            aria-label="Orden"
            options={[
              { value: 'urgency', label: 'Orden: urgencia' },
              { value: 'nombre', label: 'Orden: nombre' },
              { value: 'fecha_corte', label: 'Orden: fecha de corte' },
              { value: 'created_at', label: 'Orden: más recientes' },
            ]}
          />
        </div>

        {hayFiltros && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTexto('');
              setSearch('');
              setEstado('');
              setEstadoCalculado('');
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </FilterBar>

      {estadoCalculado && estado === 'cancelado' && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '12px' }}>
          Los cancelados no tienen estado calculado: esta combinación no devuelve resultados.
        </div>
      )}

      <DataTable
        columns={columns}
        data={gyms}
        keyExtractor={(item) => item.id}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => navigate(`/gyms/${row.id}`)}
        emptyTitle={hayFiltros ? 'Sin resultados' : 'Aún no hay gimnasios'}
        emptyDescription={
          hayFiltros ? 'Ningún gimnasio coincide con la búsqueda o los filtros.' : 'Crea el primer gimnasio para empezar.'
        }
        emptyAction={
          hayFiltros ? undefined : (
            <Link to="/gyms/new">
              <Button variant="primary" leftIcon={<PlusCircle size={16} />}>
                Crear el primer gimnasio
              </Button>
            </Link>
          )
        }
      />

      {(offset > 0 || hayMas) && !error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '12px',
            padding: '12px 0',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>Página {pagina}</span>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft size={14} />}
            disabled={offset === 0 || isLoading}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight size={14} />}
            disabled={!hayMas || isLoading}
            onClick={() => setOffset(offset + limit)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </PageContainer>
  );
};
