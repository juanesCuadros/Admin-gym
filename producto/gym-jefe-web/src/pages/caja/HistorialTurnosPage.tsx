import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { cajaService } from '../../api/caja.service';
import { personalService } from '../../api/personal.service';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { formatCOP, formatFechaHora, formatHora } from '../../utils/formato';
import { hoyBogota, sumarDias } from '../../utils/fechasBogota';
import type { ListadoTurnosResponse, MovimientoCajaItemDto, TurnoHistorialDto } from '../../types/caja.types';

const TURNOS_POR_PAGINA = 20;

const ETIQUETA_MOVIMIENTO: Record<MovimientoCajaItemDto['tipo_movimiento'], string> = {
  venta: 'Venta',
  pago_membresia: 'Membresía',
  egreso: 'Egreso',
  devolucion: 'Devolución',
};

const DiferenciaBadge: React.FC<{ turno: TurnoHistorialDto }> = ({ turno }) => {
  if (turno.diferencia === null || turno.diferencia === undefined) return <>—</>;
  const diferencia = Number(turno.diferencia);
  if (diferencia === 0) return <Badge variant="success">Cuadrado</Badge>;
  return (
    <Badge variant="danger">
      {diferencia > 0 ? 'Sobran' : 'Faltan'} {formatCOP(Math.abs(diferencia))}
    </Badge>
  );
};

/**
 * Historial de turnos (GW-RF-10, GW-RF-13): turnos cerrados con su arqueo, para revisar descuadres.
 * Un turno cerrado es inmutable: esta pantalla solo consulta.
 */
export const HistorialTurnosPage: React.FC = () => {
  const { hasPermission, isJefe } = useAuth();
  const { showToast } = useToast();
  const puedeVerPersonal = hasPermission('personal', 'leer');

  const hoy = hoyBogota();
  const [desde, setDesde] = useState(sumarDias(hoy, -30));
  const [hasta, setHasta] = useState(hoy);
  const [staffId, setStaffId] = useState('');
  const [soloDescuadre, setSoloDescuadre] = useState(false);
  const [pagina, setPagina] = useState(1);

  const [datos, setDatos] = useState<ListadoTurnosResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [personal, setPersonal] = useState<{ value: string; label: string }[]>([]);

  const [detalle, setDetalle] = useState<TurnoHistorialDto | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCajaItemDto[]>([]);
  const [cargandoMovs, setCargandoMovs] = useState(false);
  const [errorMovs, setErrorMovs] = useState<unknown>(null);
  const [notaRevision, setNotaRevision] = useState('');
  const [guardandoRevision, setGuardandoRevision] = useState(false);
  const [errorRevision, setErrorRevision] = useState<string | null>(null);

  const rangoInvalido = !desde || !hasta || hasta < desde;

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return;
    setCargando(true);
    try {
      const res = await cajaService.listarTurnos({
        desde,
        hasta,
        staff_id: staffId || undefined,
        con_descuadre: soloDescuadre || undefined,
        pagina,
        limite: TURNOS_POR_PAGINA,
      });
      setDatos(res);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, staffId, soloDescuadre, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!puedeVerPersonal) return;
    personalService
      .listar({ limite: 100 })
      .then((res) => setPersonal(res.items.map((s) => ({ value: s.id, label: s.nombre }))))
      .catch(() => setPersonal([]));
  }, [puedeVerPersonal]);

  const cargarMovimientos = useCallback(async (turnoId: string) => {
    setCargandoMovs(true);
    try {
      const res = await cajaService.getMovimientos(turnoId);
      setMovimientos(res.items);
      setErrorMovs(null);
    } catch (e) {
      setErrorMovs(e);
    } finally {
      setCargandoMovs(false);
    }
  }, []);

  const abrirDetalle = (turno: TurnoHistorialDto) => {
    setDetalle(turno);
    setMovimientos([]);
    setNotaRevision('');
    setErrorRevision(null);
    cargarMovimientos(turno.id);
  };

  const guardarRevision = async () => {
    if (!detalle) return;
    if (notaRevision.trim().length < 4) {
      setErrorRevision('Escribe qué encontraste (mínimo 4 caracteres).');
      return;
    }
    setGuardandoRevision(true);
    setErrorRevision(null);
    try {
      await cajaService.revisarTurno(detalle.id, notaRevision.trim());
      showToast('success', 'Descuadre revisado', 'La nota quedó guardada en el turno.');
      setDetalle(null);
      cargar();
    } catch (e) {
      setErrorRevision(parseApiError(e));
    } finally {
      setGuardandoRevision(false);
    }
  };

  const conFiltro = <T,>(setter: (valor: T) => void) => (valor: T) => {
    setter(valor);
    setPagina(1);
  };

  const hayFiltrosExtra = !!staffId || soloDescuadre;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Historial de turnos</h1>
          <p className="page-subtitle">Turnos de caja cerrados, con su arqueo y descuadre</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 20 }}>
        <Input label="Desde" type="date" value={desde} max={hoy} onChange={(e) => conFiltro(setDesde)(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} max={hoy} onChange={(e) => conFiltro(setHasta)(e.target.value)} />
        {puedeVerPersonal && (
          <Select
            label="Persona"
            value={staffId}
            onChange={(e) => conFiltro(setStaffId)(e.target.value)}
            options={[{ value: '', label: 'Todas' }, ...personal]}
          />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 34, fontSize: 'var(--fs-sm)' }}>
          <input
            type="checkbox"
            checked={soloDescuadre}
            onChange={(e) => conFiltro(setSoloDescuadre)(e.target.checked)}
          />
          Solo con descuadre
        </label>
      </div>

      {rangoInvalido ? (
        <MensajeFijo tono="advertencia">Elige un rango válido: la fecha inicial no puede ser posterior a la final.</MensajeFijo>
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : !datos ? (
        <Cargando />
      ) : datos.total === 0 && !cargando ? (
        <Card>
          <VacioInicial
            icono={<History size={24} />}
            titulo={hayFiltrosExtra ? 'Ningún turno coincide con los filtros' : 'No hay turnos cerrados en estas fechas'}
            descripcion="Aquí aparecen los turnos de caja una vez se cierran, con lo esperado, lo contado y la diferencia."
          />
        </Card>
      ) : (
        <Card>
          <Table<TurnoHistorialDto>
            columns={[
              { header: 'Abierto', accessor: (t) => formatFechaHora(t.abierto_en) },
              { header: 'Cerrado', accessor: (t) => (t.cerrado_en ? formatFechaHora(t.cerrado_en) : '—') },
              { header: 'Persona', accessor: (t) => t.staff_nombre ?? '—' },
              { header: 'Esperado', align: 'right', accessor: (t) => formatCOP(t.total_esperado_efectivo) },
              {
                header: 'Contado',
                align: 'right',
                accessor: (t) =>
                  t.efectivo_contado === null || t.efectivo_contado === undefined ? '—' : formatCOP(t.efectivo_contado),
              },
              {
                header: 'Diferencia',
                render: (t) => (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <DiferenciaBadge turno={t} />
                    {Number(t.diferencia ?? 0) !== 0 && (
                      <Badge variant={t.estado_revision === 'revisado' ? 'info' : 'warning'}>
                        {t.estado_revision === 'revisado' ? 'Revisado' : 'Por revisar'}
                      </Badge>
                    )}
                  </div>
                ),
              },
              {
                header: '',
                align: 'right',
                render: (t) => (
                  <Button variant="ghost" size="sm" onClick={() => abrirDetalle(t)}>
                    Ver detalle
                  </Button>
                ),
              },
            ]}
            data={datos.items}
            isLoading={cargando}
            keyExtractor={(t) => t.id}
            pagination={{ currentPage: pagina, totalPages: datos.total_paginas, onPageChange: setPagina }}
          />
        </Card>
      )}

      <Modal isOpen={!!detalle} onClose={() => setDetalle(null)} title="Detalle del turno" maxWidth="760px">
        {detalle && (
          <>
            <div className="checkin-stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              <div className="checkin-stat">
                <small>Base inicial</small>
                <strong>{formatCOP(detalle.base_inicial)}</strong>
              </div>
              <div className="checkin-stat">
                <small>Efectivo esperado</small>
                <strong>{formatCOP(detalle.total_esperado_efectivo)}</strong>
              </div>
              <div className="checkin-stat">
                <small>Efectivo contado</small>
                <strong>
                  {detalle.efectivo_contado === null || detalle.efectivo_contado === undefined
                    ? '—'
                    : formatCOP(detalle.efectivo_contado)}
                </strong>
              </div>
              <div className="checkin-stat">
                <small>Otros medios</small>
                <strong>{formatCOP(Number(detalle.ventas_otro) + Number(detalle.pagos_membresia_otro))}</strong>
              </div>
            </div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
              {detalle.staff_nombre ?? 'Sin nombre'} · <DiferenciaBadge turno={detalle} />
              {detalle.cierre_forzado && <> · Cierre forzado</>}
              {detalle.estado_revision === 'revisado' && (
                <> · Revisado{detalle.revisado_por_nombre ? ` por ${detalle.revisado_por_nombre}` : ''}</>
              )}
            </p>
            {detalle.nota_revision && (
              <MensajeFijo tono="info" titulo="Nota de la revisión" style={{ marginBottom: 12 }}>
                {detalle.nota_revision}
              </MensajeFijo>
            )}
            {isJefe && Number(detalle.diferencia ?? 0) !== 0 && detalle.estado_revision !== 'revisado' && (
              <div style={{ marginBottom: 12 }}>
                <Input
                  label="Nota de la revisión"
                  placeholder="Ej. Faltó registrar un vale de $5.000"
                  value={notaRevision}
                  maxLength={500}
                  onChange={(e) => setNotaRevision(e.target.value)}
                  error={errorRevision ?? undefined}
                />
                <Button variant="primary" size="sm" onClick={guardarRevision} isLoading={guardandoRevision}>
                  Marcar como revisado
                </Button>
              </div>
            )}
            {errorMovs ? (
              <ErrorCarga error={errorMovs} onReintentar={() => cargarMovimientos(detalle.id)} />
            ) : (
              <Table<MovimientoCajaItemDto>
                columns={[
                  { header: 'Hora', accessor: (m) => formatHora(m.ts), width: '80px' },
                  { header: 'Tipo', accessor: (m) => ETIQUETA_MOVIMIENTO[m.tipo_movimiento] ?? m.tipo_movimiento, width: '110px' },
                  {
                    header: 'Concepto',
                    render: (m) => (
                      <span style={{ textDecoration: m.anulado ? 'line-through' : undefined }}>
                        {m.concepto}
                        {m.anulado ? ' (anulado)' : ''}
                      </span>
                    ),
                  },
                  { header: 'Método', accessor: (m) => m.metodo ?? '—' },
                  {
                    header: 'Monto',
                    align: 'right',
                    render: (m) => {
                      const salida = m.tipo_movimiento === 'egreso' || m.tipo_movimiento === 'devolucion';
                      return `${salida ? '−' : '+'}${formatCOP(m.monto)}`;
                    },
                  },
                ]}
                data={movimientos}
                isLoading={cargandoMovs}
                keyExtractor={(m) => `${m.tipo_movimiento}-${m.id}`}
                emptyMessage="Este turno no tuvo movimientos."
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
};
