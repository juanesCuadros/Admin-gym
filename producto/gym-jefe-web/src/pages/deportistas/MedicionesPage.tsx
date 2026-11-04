import React, { useCallback, useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Table } from '../../components/ui/Table';
import { ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { MedicionesDrawer } from '../../components/mediciones/MedicionesDrawer';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import type { DeportistaMedicionItem } from '../../types/deportistas.types';

const POR_PAGINA = 15;

const conUnidad = (v: number | string | null | undefined, unidad: string) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 1 })} ${unidad}`;

/** Mediciones (GW-RF-21): quién tiene medidas al día y acceso directo a registrar y ver el progreso. */
export const MedicionesPage: React.FC = () => {
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<DeportistaMedicionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [abierto, setAbierto] = useState<{ id: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await deportistasService.listarConMediciones({
        q: buscar.trim() || undefined,
        limit: POR_PAGINA,
        offset: (pagina - 1) * POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [buscar, pagina]);

  useEffect(() => {
    const t = window.setTimeout(cargar, 250);
    return () => window.clearTimeout(t);
  }, [cargar]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mediciones</h1>
          <p className="page-subtitle">El peso y las medidas de cada deportista, y cómo van cambiando</p>
        </div>
      </div>

      <MensajeFijo tono="info" titulo="¿Cómo funciona?" style={{ marginBottom: 16 }}>
        Busca al deportista y registra sus medidas. El sexo y la estatura se piden una sola vez, porque con ellos se
        calculan el porcentaje de grasa y la masa muscular. Cada medición queda en su historial y en la gráfica de progreso.
      </MensajeFijo>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <SearchInput
          placeholder="Buscar por nombre o documento"
          aria-label="Buscar deportista"
          value={buscar}
          onChange={(e) => {
            setBuscar(e.target.value);
            setPagina(1);
          }}
        />
      </div>

      {error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : (
        <Card>
          <Table<DeportistaMedicionItem>
            columns={[
              {
                header: 'Deportista',
                render: (d) => (
                  <div>
                    <div style={{ fontWeight: 500 }}>{d.nombre}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Doc. {d.documento}</div>
                  </div>
                ),
              },
              {
                header: 'Última medición',
                accessor: (d) => (d.ultima_fecha ? formatFechaNegocio(d.ultima_fecha) : 'Sin mediciones'),
              },
              { header: 'Peso', accessor: (d) => conUnidad(d.peso, 'kg') },
              { header: 'Grasa', accessor: (d) => conUnidad(d.grasa_pct, '%') },
              { header: 'Músculo', accessor: (d) => conUnidad(d.masa_muscular, 'kg') },
              { header: 'Registros', accessor: (d) => d.total_mediciones, align: 'right', width: '90px' },
              {
                header: '',
                align: 'right',
                render: (d) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Scale size={14} />}
                    onClick={() => setAbierto({ id: d.id, nombre: d.nombre })}
                  >
                    {d.total_mediciones > 0 ? 'Ver y registrar' : 'Registrar'}
                  </Button>
                ),
              },
            ]}
            data={items}
            isLoading={cargando}
            keyExtractor={(d) => d.id}
            emptyMessage={buscar.trim() ? 'Ningún deportista coincide con la búsqueda.' : 'Aún no hay deportistas registrados.'}
            pagination={{
              currentPage: pagina,
              totalPages: Math.max(1, Math.ceil(total / POR_PAGINA)),
              onPageChange: setPagina,
            }}
          />
        </Card>
      )}

      <MedicionesDrawer deportista={abierto} onClose={() => setAbierto(null)} onRegistrada={cargar} />
    </div>
  );
};
