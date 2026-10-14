import React, { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Undo2, Ban, Wallet } from 'lucide-react';
import { reportesService } from '../../api/reportes.service';
import { Card, KpiCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatCOP, formatFechaHora } from '../../utils/formato';
import { formatFechaNegocio, hoyBogota, inicioMesBogota } from '../../utils/fechasBogota';
import type { FiltrosIngresos, ReporteIngresosResponse, TransaccionReporte } from '../../types/reportes.types';
import { ExportarReporte } from './ExportarReporte';

const ETIQUETA_FUENTE: Record<string, string> = {
  membresias: 'Membresías',
  productos: 'Productos',
  otros_mostrador: 'Otros de mostrador (pases)',
};

const ETIQUETA_TIPO: Record<string, string> = {
  venta_mostrador: 'Venta de mostrador',
  pago_membresia: 'Pago de membresía',
  devolucion: 'Devolución',
};

/** Tabla de desglose `{clave: monto}` ordenada de mayor a menor. */
const Desglose: React.FC<{ titulo: string; datos: Record<string, number | string>; etiquetas?: Record<string, string> }> = ({
  titulo,
  datos,
  etiquetas,
}) => {
  const filas = Object.entries(datos).sort((a, b) => Number(b[1]) - Number(a[1]));
  return (
    <Card title={titulo}>
      {filas.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Sin movimientos en el periodo.</p>
      ) : (
        <table className="table-base">
          <tbody>
            {filas.map(([clave, monto]) => (
              <tr key={clave}>
                <td>{etiquetas?.[clave] ?? clave}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCOP(monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

/**
 * Reportes · Ingresos (GW-RF-41, GW-RF-44). `GET /reportes/ingresos` y `GET /reportes/exportar?tipo_reporte=ingresos`.
 * Los anulados no suman a los totales, pero se ven en el detalle.
 */
export const ReporteIngresosPage: React.FC = () => {
  const [borrador, setBorrador] = useState<Required<Pick<FiltrosIngresos, 'fecha_inicio' | 'fecha_fin'>> & FiltrosIngresos>({
    fecha_inicio: inicioMesBogota(),
    fecha_fin: hoyBogota(),
    metodo: '',
    fuente: '',
  });
  const [aplicados, setAplicados] = useState<FiltrosIngresos>(borrador);
  const [reporte, setReporte] = useState<ReporteIngresosResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [pagina, setPagina] = useState(1);
  const [metodosConocidos, setMetodosConocidos] = useState<string[]>([]);

  const errorFechas = borrador.fecha_inicio > borrador.fecha_fin ? 'La fecha inicial no puede ser posterior a la final.' : null;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await reportesService.ingresos({
        fecha_inicio: aplicados.fecha_inicio,
        fecha_fin: aplicados.fecha_fin,
        metodo: aplicados.metodo || undefined,
        fuente: aplicados.fuente || undefined,
      });
      setReporte(r);
      setPagina(1);
      // El desglose por método no se filtra: sirve para ofrecer los métodos usados en el periodo.
      setMetodosConocidos((prev) => Array.from(new Set([...prev, ...Object.keys(r.desglose_por_metodo)])).sort());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [aplicados]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    if (errorFechas) return;
    setAplicados({ ...borrador });
  };

  const limpiar = () => {
    const base = { fecha_inicio: inicioMesBogota(), fecha_fin: hoyBogota(), metodo: '', fuente: '' };
    setBorrador(base);
    setAplicados(base);
  };

  const hayFiltroDetalle = !!aplicados.metodo || !!aplicados.fuente;
  const transacciones = reporte?.transacciones ?? [];
  const totalPaginas = Math.max(1, Math.ceil(transacciones.length / FILAS_POR_PAGINA));
  const visibles = transacciones.slice((pagina - 1) * FILAS_POR_PAGINA, pagina * FILAS_POR_PAGINA);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reporte de ingresos</h1>
          <p className="page-subtitle">Ventas y pagos de membresía por periodo, fuente y método</p>
        </div>
        <ExportarReporte
          parametros={{
            tipo_reporte: 'ingresos',
            fecha_inicio: aplicados.fecha_inicio,
            fecha_fin: aplicados.fecha_fin,
            metodo: aplicados.metodo || undefined,
            fuente: aplicados.fuente || undefined,
          }}
          disabled={cargando || !!error}
        />
      </div>

      <form onSubmit={aplicar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ width: 170 }}>
          <Input
            label="Desde"
            type="date"
            value={borrador.fecha_inicio}
            max={borrador.fecha_fin}
            onChange={(e) => setBorrador({ ...borrador, fecha_inicio: e.target.value })}
            error={errorFechas ?? undefined}
          />
        </div>
        <div style={{ width: 170 }}>
          <Input
            label="Hasta"
            type="date"
            value={borrador.fecha_fin}
            min={borrador.fecha_inicio}
            onChange={(e) => setBorrador({ ...borrador, fecha_fin: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ width: 200 }}>
          <label className="form-label" htmlFor="filtro-fuente">
            Fuente
          </label>
          <select
            id="filtro-fuente"
            className="form-select"
            value={borrador.fuente}
            onChange={(e) => setBorrador({ ...borrador, fuente: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="membresias">Membresías</option>
            <option value="mostrador">Mostrador</option>
          </select>
        </div>
        <div className="form-group" style={{ width: 200 }}>
          <label className="form-label" htmlFor="filtro-metodo">
            Método
          </label>
          <select
            id="filtro-metodo"
            className="form-select"
            value={borrador.metodo}
            onChange={(e) => setBorrador({ ...borrador, metodo: e.target.value })}
          >
            <option value="">Todos</option>
            {metodosConocidos.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={!!errorFechas || cargando}>
            Consultar
          </Button>
          <Button type="button" variant="ghost" onClick={limpiar} disabled={cargando}>
            Limpiar filtros
          </Button>
        </div>
      </form>

      {cargando && !reporte ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : reporte ? (
        <>
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            Periodo: {formatFechaNegocio(reporte.fecha_inicio)} a {formatFechaNegocio(reporte.fecha_fin)}
          </p>

          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KpiCard label="Ingreso neto" value={formatCOP(reporte.total_ingresos_neto)} icon={<Wallet size={18} />} subtext="Bruto menos devoluciones" />
            <KpiCard label="Ingreso bruto" value={formatCOP(reporte.total_ingresos_bruto)} icon={<TrendingUp size={18} />} subtext="Ventas y pagos no anulados" />
            <KpiCard label="Devoluciones" value={formatCOP(reporte.total_devoluciones)} icon={<Undo2 size={18} />} />
            <KpiCard label="Anulado" value={formatCOP(reporte.total_anulado)} icon={<Ban size={18} />} subtext="No suma al neto" />
          </div>

          {hayFiltroDetalle && (
            <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
              Los totales y desgloses son del periodo completo. El filtro de fuente o método aplica al detalle de
              transacciones y a la exportación.
            </MensajeFijo>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>
            <Desglose titulo="Por fuente" datos={reporte.desglose_por_fuente} etiquetas={ETIQUETA_FUENTE} />
            <Desglose titulo="Por método" datos={reporte.desglose_por_metodo} />
          </div>

          <Card title={`Transacciones (${transacciones.length})`}>
            {transacciones.length === 0 ? (
              <VacioInicial
                titulo="No hay transacciones"
                descripcion={
                  hayFiltroDetalle
                    ? 'Ninguna transacción del periodo coincide con la fuente o el método elegidos.'
                    : 'No se registraron ventas ni pagos en este periodo.'
                }
              />
            ) : (
              <Table<TransaccionReporte>
                data={visibles}
                keyExtractor={(t) => `${t.tipo}-${t.id}`}
                pagination={{ currentPage: pagina, totalPages: totalPaginas, onPageChange: setPagina }}
                columns={[
                  { header: 'Fecha', render: (t) => formatFechaHora(t.fecha_hora) },
                  { header: 'Tipo', render: (t) => ETIQUETA_TIPO[t.tipo] ?? t.tipo },
                  {
                    header: 'Descripción',
                    render: (t) => (
                      <div>
                        <div>{t.descripcion}</div>
                        {t.anulado && (
                          <Badge variant="danger" title={t.motivo_anulacion ?? undefined}>
                            Anulado{t.motivo_anulacion ? `: ${t.motivo_anulacion}` : ''}
                          </Badge>
                        )}
                      </div>
                    ),
                  },
                  { header: 'Método', render: (t) => t.metodo },
                  { header: 'Registró', render: (t) => t.registrado_por_nombre || '—' },
                  {
                    header: 'Monto',
                    align: 'right',
                    render: (t) => (
                      <strong
                        style={{
                          textDecoration: t.anulado ? 'line-through' : undefined,
                          color: Number(t.monto) < 0 ? 'var(--danger)' : undefined,
                        }}
                      >
                        {formatCOP(t.monto)}
                      </strong>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};
