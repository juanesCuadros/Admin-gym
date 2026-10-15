import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, Gift, Users, LogIn, RefreshCw } from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { KpiCard, Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatHora } from '../../utils/formato';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import { formatPermanencia, presentarResultado } from './formatoIngreso';
import { PanelAdentro } from './PanelAdentro';
import type { CheckinItemHistorialDto, ResumenIngresosHoyDto } from '../../types/controlIngreso.types';

/**
 * Ingresos de hoy (GW-RF-01.5 y contrato 2.2): métricas del día, quién está adentro y el
 * historial con hora de ingreso, hora de salida, permanencia y resultado.
 */
export const IngresosHoyPage: React.FC = () => {
  const navigate = useNavigate();
  const [resumen, setResumen] = useState<ResumenIngresosHoyDto | null>(null);
  const [items, setItems] = useState<CheckinItemHistorialDto[]>([]);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [recargarAdentro, setRecargarAdentro] = useState(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await controlIngresoService.getIngresosHoy({
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      });
      setResumen(res.resumen);
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const totalPaginas = resumen ? Math.max(1, Math.ceil(resumen.total_ingresos / FILAS_POR_PAGINA)) : 1;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Ingresos de hoy</h1>
          <p className="page-subtitle">
            {resumen ? `Movimiento del ${formatFechaNegocio(resumen.fecha)}` : 'Movimiento del día en la recepción'}
          </p>
        </div>
        <Button
          variant="outline"
          leftIcon={<RefreshCw size={16} />}
          onClick={() => {
            cargar();
            setRecargarAdentro((n) => n + 1);
          }}
          disabled={cargando}
        >
          Actualizar
        </Button>
      </div>

      {error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : !resumen ? (
        <Cargando />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard label="Registros de hoy" value={resumen.total_ingresos} icon={<LogIn size={20} />} />
            <KpiCard label="Adentro ahora" value={resumen.adentro_ahora} icon={<Users size={20} />} color="var(--primary)" />
            <KpiCard label="Permitidos" value={resumen.accesos_abiertos} icon={<CheckCircle2 size={20} />} color="var(--success)" />
            <KpiCard
              label="Con alerta de pago"
              value={resumen.alertas_mora}
              icon={<AlertTriangle size={20} />}
              color="var(--warning)"
            />
            <KpiCard label="Negados" value={resumen.accesos_negados} icon={<XCircle size={20} />} color="var(--danger)" />
            <KpiCard label="Cortesías" value={resumen.cortesias} icon={<Gift size={20} />} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <PanelAdentro
              recargar={recargarAdentro}
              onSalida={() => {
                cargar();
              }}
            />
          </div>

          <Card title="Historial del día">
            {!cargando && resumen.total_ingresos === 0 ? (
              <VacioInicial
                titulo="Aún no hay ingresos hoy"
                descripcion="Cuando la recepción registre un ingreso o una cortesía, aparecerá aquí con su hora de entrada y de salida."
                textoAccion="Ir a check-in"
                onAccion={() => navigate('/control-ingreso')}
              />
            ) : (
              <Table<CheckinItemHistorialDto>
                columns={[
                  { header: 'Ingreso', accessor: (i) => formatHora(i.ts_local), width: '80px' },
                  {
                    header: 'Persona',
                    render: (i) => (
                      <div>
                        <div style={{ fontWeight: 700 }}>
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
                    accessor: (i) => (i.salida_ts ? formatHora(i.salida_ts) : i.tipo === 'ingreso' && i.resultado !== 'negado' ? 'Adentro' : '—'),
                    width: '90px',
                  },
                  { header: 'Permanencia', accessor: (i) => formatPermanencia(i.permanencia_minutos), width: '120px' },
                  {
                    header: 'Registró',
                    accessor: (i) => `${i.metodo === 'huella' ? 'Huella' : 'Manual'}${i.registrado_por_nombre ? ` · ${i.registrado_por_nombre}` : ''}`,
                  },
                ]}
                data={items}
                isLoading={cargando}
                keyExtractor={(i) => i.id}
                emptyMessage="No hay registros en esta página."
                pagination={{ currentPage: pagina, totalPages: totalPaginas, onPageChange: setPagina }}
              />
            )}
          </Card>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 10 }}>
            ¿Necesitas registrar un ingreso? Ve a <Link to="/control-ingreso">Check-in</Link>.
          </p>
        </>
      )}
    </div>
  );
};
