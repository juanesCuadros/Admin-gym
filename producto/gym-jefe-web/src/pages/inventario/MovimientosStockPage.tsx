import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inventarioService } from '../../api/inventario.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, VacioFiltro, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFechaHora } from '../../utils/formato';
import type { StockMovimientoResponse } from '../../types/inventario.types';
import { ETIQUETA_MOVIMIENTO, VARIANTE_MOVIMIENTO } from './movimientos';

/**
 * Inventario · Movimientos de stock (GW-RF-37): kardex general del gimnasio.
 * `GET /inventario/kardex?tipo=&limit=&offset=`. El backend no filtra por fechas ni por producto aquí;
 * el kardex de un producto se ve desde Productos.
 */
export const MovimientosStockPage: React.FC = () => {
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<StockMovimientoResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await inventarioService.kardexGeneral({
        tipo: tipo || undefined,
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [tipo, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  let contenido: React.ReactNode;
  if (cargando && items.length === 0 && !error) contenido = <Cargando />;
  else if (error) contenido = <ErrorCarga error={error} onReintentar={cargar} />;
  else if (total === 0 && !tipo)
    contenido = (
      <VacioInicial
        titulo="Aún no hay movimientos de stock"
        descripcion="Aquí aparecen las entradas, los ajustes, las ventas y las devoluciones de productos. Empieza registrando productos y su stock en Inventario · Productos."
      />
    );
  else if (total === 0)
    contenido = (
      <VacioFiltro
        onLimpiar={() => {
          setTipo('');
          setPagina(1);
        }}
      />
    );
  else
    contenido = (
      <Card>
        <Table<StockMovimientoResponse>
          data={items}
          isLoading={cargando}
          keyExtractor={(m) => m.id}
          pagination={{
            currentPage: pagina,
            totalPages: Math.max(1, Math.ceil(total / FILAS_POR_PAGINA)),
            onPageChange: setPagina,
          }}
          columns={[
            { header: 'Fecha', render: (m) => formatFechaHora(m.created_at) },
            { header: 'Producto', render: (m) => <span style={{ fontWeight: 600 }}>{m.producto_nombre || '—'}</span> },
            {
              header: 'Tipo',
              render: (m) => (
                <Badge variant={VARIANTE_MOVIMIENTO[m.tipo] ?? 'neutral'}>{ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo}</Badge>
              ),
            },
            {
              header: 'Cantidad',
              align: 'right',
              render: (m) => (
                <strong style={{ color: m.cantidad < 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                </strong>
              ),
            },
            { header: 'Motivo', render: (m) => m.motivo || '—' },
            { header: 'Registró', render: (m) => m.registrado_por_nombre || '—' },
          ]}
        />
      </Card>
    );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Movimientos de stock</h1>
          <p className="page-subtitle">
            Kardex del gimnasio: entradas, ajustes, ventas y devoluciones. Para un solo producto, ve a{' '}
            <Link to="/inventario">Productos</Link>.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select
          className="form-select"
          style={{ maxWidth: 220 }}
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value);
            setPagina(1);
          }}
          aria-label="Filtrar por tipo de movimiento"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(ETIQUETA_MOVIMIENTO).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
        {tipo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTipo('');
              setPagina(1);
            }}
          >
            Limpiar filtros
          </Button>
        )}
        {!cargando && !error && total > 0 && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{total} movimientos</span>
        )}
      </div>

      {contenido}
    </div>
  );
};
