import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Gift, LogIn, RefreshCw } from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { KpiCard, Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFecha, formatHora } from '../../utils/formato';
import { hoyBogota } from '../../utils/fechasBogota';
import { formatPermanencia, presentarResultado } from './formatoIngreso';
import type { CheckinItemHistorialDto, HistorialIngresosResponse } from '../../types/controlIngreso.types';

/**
 * Historial de ingresos (GW-RF-01.5): por defecto el día de hoy, con filtro de fechas de Bogotá.
 * Quién está adentro ahora se ve y se gestiona en Check-in.
 */
export const HistorialIngresosPage: React.FC = () => {
  const hoy = hoyBogota();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<HistorialIngresosResponse | null>(null);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const rangoInvalido = !desde || !hasta || hasta < desde;
  const esUnDia = desde === hasta;

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return;
    setCargando(true);
    try {
      const res = await controlIngresoService.getHistorial({
        desde,
        hasta,
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      });
      setDatos(res);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambiarDesde = (valor: string) => {
    setDesde(valor);
    setPagina(1);
  };

  const cambiarHasta = (valor: string) => {
    setHasta(valor);
    setPagina(1);
  };

  const verHoy = () => {
    setDesde(hoy);
    setHasta(hoy);
    setPagina(1);
  };

  const resumen = datos?.resumen;
  const totalPaginas = resumen ? Math.max(1, Math.ceil(resumen.total_registros / FILAS_POR_PAGINA)) : 1;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Historial de ingresos</h1>
          <p className="page-subtitle">Quién entró, a qué hora y qué resultado tuvo</p>
        </div>
        <Button variant="outline" leftIcon={<RefreshCw size={16} />} onClick={cargar} disabled={cargando || rangoInvalido}>
          Actualizar
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 20 }}>
        <Input label="Desde" type="date" value={desde} max={hoy} onChange={(e) => cambiarDesde(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} max={hoy} onChange={(e) => cambiarHasta(e.target.value)} />
        {(desde !== hoy || hasta !== hoy) && (
          <Button variant="secondary" style={{ marginTop: 26 }} onClick={verHoy}>
            Ver hoy
          </Button>
        )}
      </div>

      {rangoInvalido ? (
        <MensajeFijo tono="advertencia">Elige un rango válido: la fecha inicial no puede ser posterior a la final.</MensajeFijo>
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : !resumen ? (
        <Cargando />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard label="Registros" value={resumen.total_registros} icon={<LogIn size={20} />} />
            <KpiCard label="Permitidos" value={resumen.accesos_abiertos} icon={<CheckCircle2 size={20} />} />
            <KpiCard label="Con alerta de pago" value={resumen.alertas_mora} icon={<AlertTriangle size={20} />} />
            <KpiCard label="Negados" value={resumen.accesos_negados} icon={<XCircle size={20} />} />
            <KpiCard label="Cortesías" value={resumen.cortesias} icon={<Gift size={20} />} />
          </div>

          <Card title={esUnDia ? `Ingresos del ${formatFecha(`${desde}T12:00:00`)}` : 'Ingresos del periodo'}>
            <Table<CheckinItemHistorialDto>
              columns={[
                {
                  header: 'Ingreso',
                  accessor: (i) => (esUnDia ? formatHora(i.ts_local) : `${formatFecha(i.ts_local)} ${formatHora(i.ts_local)}`),
                  width: esUnDia ? '80px' : '170px',
                },
                {
                  header: 'Persona',
                  render: (i) => (
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {i.deportista_nombre ?? (i.tipo === 'cortesia' ? 'Cortesía' : 'Sin identificar')}
                      </div>
                      {i.deportista_documento && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{i.deportista_documento}</div>
                      )}
                      {i.motivo_cortesia && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Motivo: {i.motivo_cortesia}</div>
                      )}
                    </div>
                  ),
                },
                {
                  header: 'Resultado',
                  render: (i) => {
                    const r = presentarResultado(i.resultado);
                    return <Badge variant={r.variante}>{r.texto}</Badge>;
                  },
                },
                {
                  header: 'Salida',
                  accessor: (i) =>
                    i.salida_ts
                      ? formatHora(i.salida_ts)
                      : i.tipo === 'ingreso' && i.resultado !== 'negado'
                        ? 'Sin salida'
                        : '—',
                  width: '100px',
                },
                { header: 'Permanencia', accessor: (i) => formatPermanencia(i.permanencia_minutos), width: '120px' },
                {
                  header: 'Registró',
                  accessor: (i) =>
                    `${i.metodo === 'huella' ? 'Huella' : 'Manual'}${i.registrado_por_nombre ? ` · ${i.registrado_por_nombre}` : ''}`,
                },
              ]}
              data={datos.items}
              isLoading={cargando}
              keyExtractor={(i) => i.id}
              emptyMessage="No hay ingresos registrados en estas fechas."
              pagination={{ currentPage: pagina, totalPages: totalPaginas, onPageChange: setPagina }}
            />
          </Card>
        </>
      )}
    </div>
  );
};
