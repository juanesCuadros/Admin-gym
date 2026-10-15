import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CreditCard, Lock, Unlock, DollarSign, ShoppingCart, MinusCircle, TrendingUp, UserX } from 'lucide-react';
import { cajaService } from '../../api/caja.service';
import { useAuth } from '../../contexts/AuthContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useToast } from '../../contexts/ToastContext';
import { ApiError, toApiError } from '../../api/client';
import { Card, KpiCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import { formatCOP, formatFechaHora, formatHora } from '../../utils/formato';
import type { DetallesTurnoAjeno, MovimientoCajaItemDto, TurnoResumenDto } from '../../types/caja.types';

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Turno ajeno que se va a cerrar: viene del turno actual del gimnasio o del 409 al intentar abrir. */
interface TurnoAjeno {
  turno_id: string;
  abierto_por_nombre: string;
  abierto_en: string;
  total_esperado_efectivo?: number;
}

const ETIQUETA_MOVIMIENTO: Record<string, string> = {
  venta: 'Venta',
  pago_membresia: 'Membresía',
  egreso: 'Egreso',
  devolucion: 'Devolución',
};

/**
 * Caja · turno actual (GW-RF-08 a 10, contratos 1.1 y 2.8). Un solo turno abierto por gimnasio:
 * si lo abrió otra persona se muestra quién y desde cuándo, y se ofrece cerrarlo con el conteo.
 */
export const CajaPage: React.FC = () => {
  const { isRecepcionista, hasPermission, refrescarUsuario } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const { turno, turnoAbierto, turnoPropio, cargando, error, refrescar } = useCajaTurno();
  const puedeOperar = hasPermission('caja', 'crear');
  // Recepcionista sin turno: llega aquí redirigida y debe abrir caja antes de continuar (§C1, contrato 2.8).
  const llegoRedirigida = !!(location.state as { abrirTurno?: boolean } | null)?.abrirTurno;

  const [movimientos, setMovimientos] = useState<MovimientoCajaItemDto[]>([]);
  const [cargandoMovs, setCargandoMovs] = useState(false);
  const [errorMovs, setErrorMovs] = useState<unknown>(null);

  // Abrir turno
  const [showAbrirModal, setShowAbrirModal] = useState(false);
  const [baseInicial, setBaseInicial] = useState('');
  const [errorAbrir, setErrorAbrir] = useState<ApiError | null>(null);
  const [ajenoDelError, setAjenoDelError] = useState<TurnoAjeno | null>(null);

  // Cerrar turno propio
  const [showCerrarModal, setShowCerrarModal] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState('');
  const [errorCerrar, setErrorCerrar] = useState<string | null>(null);

  // Cerrar turno ajeno
  const [ajenoACerrar, setAjenoACerrar] = useState<TurnoAjeno | null>(null);
  const [conteoAjeno, setConteoAjeno] = useState('');
  const [notaAjeno, setNotaAjeno] = useState('');
  const [confirmarAjeno, setConfirmarAjeno] = useState(false);
  const [errorAjeno, setErrorAjeno] = useState<string | null>(null);
  const [cierreAjeno, setCierreAjeno] = useState<TurnoResumenDto | null>(null);

  // Egreso
  const [showEgresoModal, setShowEgresoModal] = useState(false);
  const [egresoMonto, setEgresoMonto] = useState('');
  const [egresoMotivo, setEgresoMotivo] = useState('');
  const [errorEgreso, setErrorEgreso] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);

  const cargarMovimientos = useCallback(async () => {
    if (!turno || !turnoPropio) {
      setMovimientos([]);
      return;
    }
    setCargandoMovs(true);
    try {
      const movs = await cajaService.getMovimientos(turno.id);
      setMovimientos(movs.items);
      setErrorMovs(null);
    } catch (e) {
      setErrorMovs(e);
    } finally {
      setCargandoMovs(false);
    }
  }, [turno, turnoPropio]);

  useEffect(() => {
    cargarMovimientos();
  }, [cargarMovimientos]);

  // Si llegó redirigida y no hay turno en el gimnasio, se le abre directo el formulario de apertura.
  useEffect(() => {
    if (llegoRedirigida && !cargando && !turnoAbierto && puedeOperar) setShowAbrirModal(true);
  }, [llegoRedirigida, cargando, turnoAbierto, puedeOperar]);

  const trasCambioDeTurno = async () => {
    await refrescar();
    // Contrato 2.8: el indicador requiere_abrir_caja de /auth/me cambia con el turno.
    refrescarUsuario();
  };

  // ---- Abrir ----
  const base = entero(baseInicial);
  const handleAbrirTurno = async () => {
    if (isProcessing || base === null || base < 0) return;
    setIsProcessing(true);
    setErrorAbrir(null);
    try {
      await cajaService.abrirTurno({ base_inicial: base });
      setShowAbrirModal(false);
      setBaseInicial('');
      setAjenoDelError(null);
      showToast('success', 'Turno abierto', 'La caja quedó lista para vender y cobrar.');
      await trasCambioDeTurno();
    } catch (err) {
      const e = toApiError(err);
      if (e.codigo === 'TURNO_AJENO_ABIERTO' && e.detalles) {
        const d = e.detalles as DetallesTurnoAjeno;
        setAjenoDelError({ turno_id: d.turno_id, abierto_por_nombre: d.abierto_por_nombre, abierto_en: d.abierto_en });
        setShowAbrirModal(false);
        refrescar();
      } else {
        setErrorAbrir(e);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // ---- Cerrar propio ----
  const contado = entero(efectivoContado);
  const diferencia = turno && contado !== null ? contado - Number(turno.total_esperado_efectivo) : null;
  const handleCerrarTurno = async () => {
    if (isProcessing || contado === null || contado < 0) return;
    setIsProcessing(true);
    setErrorCerrar(null);
    try {
      const res = await cajaService.cerrarTurno({ efectivo_contado: contado });
      setShowCerrarModal(false);
      setEfectivoContado('');
      const dif = Number(res.diferencia ?? 0);
      showToast('success', 'Turno cerrado', dif === 0 ? 'Caja cuadrada.' : `Diferencia: ${formatCOP(dif)}`);
      await trasCambioDeTurno();
    } catch (err) {
      setErrorCerrar(toApiError(err).message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ---- Cerrar ajeno ----
  const abrirCierreAjeno = (t: TurnoAjeno) => {
    setAjenoACerrar(t);
    setConteoAjeno('');
    setNotaAjeno('');
    setErrorAjeno(null);
  };
  const conteoAjenoNum = entero(conteoAjeno);
  const errorConteoAjeno =
    conteoAjeno.trim() !== '' && (conteoAjenoNum === null || conteoAjenoNum < 0) ? 'Escribe un valor válido.' : null;

  const handleCerrarAjeno = async () => {
    if (!ajenoACerrar || isProcessing || conteoAjenoNum === null || conteoAjenoNum < 0) return;
    setIsProcessing(true);
    setErrorAjeno(null);
    try {
      const res = await cajaService.cerrarTurnoAjeno(ajenoACerrar.turno_id, {
        conteo_efectivo: conteoAjenoNum,
        nota: notaAjeno.trim() || undefined,
      });
      setConfirmarAjeno(false);
      setAjenoACerrar(null);
      setAjenoDelError(null);
      setCierreAjeno(res);
      showToast('success', 'Turno cerrado', `Ya puedes abrir tu turno.`);
      await trasCambioDeTurno();
    } catch (err) {
      setConfirmarAjeno(false);
      const e = toApiError(err);
      setErrorAjeno(e.codigo === 'TURNO_YA_CERRADO' ? 'Ese turno ya fue cerrado por otra persona. Recarga la caja.' : e.message);
      if (e.codigo === 'TURNO_YA_CERRADO') refrescar();
    } finally {
      setIsProcessing(false);
    }
  };

  // ---- Egreso ----
  const montoEgreso = entero(egresoMonto);
  const handleRegistrarEgreso = async () => {
    if (isProcessing) return;
    if (montoEgreso === null || montoEgreso <= 0) {
      setErrorEgreso('Escribe el monto del egreso.');
      return;
    }
    if (egresoMotivo.trim().length < 4) {
      setErrorEgreso('Escribe el motivo (mínimo 4 caracteres).');
      return;
    }
    setIsProcessing(true);
    setErrorEgreso(null);
    try {
      await cajaService.registrarEgreso({ monto: montoEgreso, motivo: egresoMotivo.trim() });
      setShowEgresoModal(false);
      setEgresoMonto('');
      setEgresoMotivo('');
      showToast('success', 'Egreso registrado', formatCOP(montoEgreso));
      refrescar();
      cargarMovimientos();
    } catch (err) {
      setErrorEgreso(toApiError(err).message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Turno ajeno visible: el actual del gimnasio (si no es propio) o el que reportó el 409.
  const turnoAjeno: TurnoAjeno | null =
    turno && turnoAbierto && !turnoPropio
      ? {
          turno_id: turno.id,
          abierto_por_nombre: turno.abierto_por_nombre ?? turno.staff_nombre ?? 'otra persona',
          abierto_en: turno.abierto_en,
          total_esperado_efectivo: Number(turno.total_esperado_efectivo),
        }
      : ajenoDelError;

  if (cargando) return <Cargando />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Caja</h1>
          <p className="page-subtitle">Turno único del gimnasio: apertura, egresos y arqueo</p>
        </div>

        {turnoPropio && puedeOperar && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/caja/punto-de-venta" className="btn btn-primary">
              <ShoppingCart size={16} /> Punto de venta
            </Link>
            <Button
              variant="outline"
              leftIcon={<MinusCircle size={16} />}
              onClick={() => {
                setErrorEgreso(null);
                setShowEgresoModal(true);
              }}
            >
              Registrar egreso
            </Button>
            <Button
              variant="secondary"
              leftIcon={<Lock size={16} color="var(--warning)" />}
              onClick={() => {
                setErrorCerrar(null);
                setShowCerrarModal(true);
              }}
            >
              Cerrar turno
            </Button>
          </div>
        )}
      </div>

      {error && <ErrorCarga error={error} onReintentar={refrescar} />}

      {cierreAjeno && (
        <MensajeFijo
          tono="info"
          titulo="Turno ajeno cerrado"
          style={{ marginBottom: 20 }}
          accion={
            <Button variant="ghost" size="sm" onClick={() => setCierreAjeno(null)}>
              Cerrar
            </Button>
          }
        >
          Cerraste el turno de {cierreAjeno.abierto_por_nombre ?? cierreAjeno.staff_nombre}. Esperado{' '}
          {formatCOP(cierreAjeno.total_esperado_efectivo)} · contado {formatCOP(cierreAjeno.efectivo_contado)} · diferencia{' '}
          <strong>{formatCOP(cierreAjeno.diferencia)}</strong>
          {cierreAjeno.descuadre_atribuido_a_nombre && Number(cierreAjeno.diferencia ?? 0) !== 0
            ? `, atribuida a ${cierreAjeno.descuadre_atribuido_a_nombre}.`
            : '.'}
        </MensajeFijo>
      )}

      {!error && turnoAjeno && (
        <MensajeFijo
          tono="advertencia"
          titulo={`La caja está abierta por ${turnoAjeno.abierto_por_nombre}`}
          style={{ marginBottom: 20 }}
          accion={
            puedeOperar && (
              <Button variant="primary" size="sm" leftIcon={<UserX size={14} />} onClick={() => abrirCierreAjeno(turnoAjeno)}>
                Cerrar ese turno
              </Button>
            )
          }
        >
          Turno abierto el {formatFechaHora(turnoAjeno.abierto_en)}. En el gimnasio solo puede haber un turno abierto: para
          vender o cobrar con tu usuario, ciérralo con el conteo del efectivo y abre el tuyo. El descuadre, si lo hay, queda a
          nombre de {turnoAjeno.abierto_por_nombre}.
        </MensajeFijo>
      )}

      {!error && turnoPropio && turno ? (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Base inicial"
              value={formatCOP(turno.base_inicial)}
              icon={<DollarSign size={20} />}
              subtext={`Abierto el ${formatFechaHora(turno.abierto_en)}`}
            />
            <KpiCard
              label="Ventas en efectivo"
              value={formatCOP(turno.ventas_efectivo)}
              icon={<TrendingUp size={20} />}
              subtext={`+${formatCOP(turno.pagos_membresia_efectivo)} en membresías`}
              color="var(--success)"
            />
            <KpiCard
              label="Egresos"
              value={formatCOP(turno.egresos_efectivo)}
              icon={<MinusCircle size={20} />}
              subtext={`Devoluciones: ${formatCOP(turno.devoluciones_efectivo)}`}
              color="var(--danger)"
            />
            <KpiCard
              label="Efectivo esperado"
              value={formatCOP(turno.total_esperado_efectivo)}
              icon={<CreditCard size={20} />}
              subtext="Para el arqueo"
              color="var(--primary)"
            />
          </div>

          <Card title="Movimientos del turno">
            {errorMovs ? (
              <ErrorCarga error={errorMovs} onReintentar={cargarMovimientos} />
            ) : (
              <Table<MovimientoCajaItemDto>
                columns={[
                  { header: 'Hora', accessor: (m) => formatHora(m.ts), width: '80px' },
                  {
                    header: 'Tipo',
                    render: (m) => (
                      <Badge variant={m.tipo_movimiento === 'venta' || m.tipo_movimiento === 'pago_membresia' ? 'success' : 'danger'}>
                        {ETIQUETA_MOVIMIENTO[m.tipo_movimiento] ?? m.tipo_movimiento}
                      </Badge>
                    ),
                    width: '130px',
                  },
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
                      return (
                        <span style={{ fontWeight: 700, color: salida ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {salida ? '−' : '+'}
                          {formatCOP(m.monto)}
                        </span>
                      );
                    },
                  },
                ]}
                data={movimientos}
                isLoading={cargandoMovs}
                keyExtractor={(m) => `${m.tipo_movimiento}-${m.id}`}
                emptyMessage="Aún no hay movimientos en este turno."
              />
            )}
          </Card>
        </>
      ) : (
        !error &&
        !turnoAjeno && (
          <Card style={{ textAlign: 'center', padding: '40px 20px', marginBottom: 28 }}>
            {(isRecepcionista || llegoRedirigida) && (
              <MensajeFijo tono="info" titulo="Primero abre la caja" style={{ marginBottom: 20, textAlign: 'left' }}>
                No hay un turno de caja abierto en el gimnasio. Ábrelo con la base de efectivo para empezar la jornada; mientras
                tanto el resto del sistema queda bloqueado.
              </MensajeFijo>
            )}
            <Lock size={48} color="var(--text-muted)" style={{ marginBottom: 12 }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>No hay turno de caja abierto</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 450, margin: '8px auto 20px auto' }}>
              Para vender, cobrar membresías o registrar egresos, abre el turno con la base de efectivo para dar cambio.
            </p>
            {puedeOperar ? (
              <Button
                variant="primary"
                onClick={() => {
                  setErrorAbrir(null);
                  setShowAbrirModal(true);
                }}
                leftIcon={<Unlock size={16} />}
              >
                Abrir turno
              </Button>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>No tienes permiso para abrir la caja.</p>
            )}
          </Card>
        )
      )}

      {/* Abrir turno */}
      <Modal
        isOpen={showAbrirModal}
        onClose={() => !isProcessing && setShowAbrirModal(false)}
        title="Abrir turno de caja"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAbrirModal(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleAbrirTurno}
              isLoading={isProcessing}
              disabled={base === null || base < 0}
            >
              Abrir turno
            </Button>
          </>
        }
      >
        <Input
          id="caja-base-inicial"
          label="Base inicial en efectivo (COP)"
          type="number"
          min={0}
          step={100}
          value={baseInicial}
          onChange={(e) => setBaseInicial(e.target.value)}
          leftIcon={<DollarSign size={16} />}
          error={base !== null && base < 0 ? 'La base no puede ser negativa.' : undefined}
        />
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          El efectivo con el que empieza el turno para dar cambio. Si no hay base, escribe 0.
        </p>
        {errorAbrir && <MensajeFijo tono="error">{errorAbrir.message}</MensajeFijo>}
      </Modal>

      {/* Cerrar turno propio */}
      <Modal
        isOpen={showCerrarModal}
        onClose={() => !isProcessing && setShowCerrarModal(false)}
        title="Arqueo y cierre del turno"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCerrarModal(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleCerrarTurno}
              isLoading={isProcessing}
              disabled={contado === null || contado < 0}
            >
              Cerrar turno
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Efectivo esperado</span>
          <strong>{formatCOP(turno?.total_esperado_efectivo)}</strong>
        </div>
        <Input
          id="caja-efectivo-contado"
          label="Efectivo contado (COP)"
          type="number"
          min={0}
          step={100}
          value={efectivoContado}
          onChange={(e) => setEfectivoContado(e.target.value)}
          autoFocus
          leftIcon={<DollarSign size={16} />}
        />
        {diferencia !== null && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface-elevated)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Diferencia</span>
            <strong style={{ color: diferencia === 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCOP(diferencia)}</strong>
          </div>
        )}
        {errorCerrar && <MensajeFijo tono="error" style={{ marginTop: 12 }}>{errorCerrar}</MensajeFijo>}
      </Modal>

      {/* Cerrar turno ajeno: conteo y nota, luego confirmación */}
      <Modal
        isOpen={!!ajenoACerrar && !confirmarAjeno}
        onClose={() => !isProcessing && setAjenoACerrar(null)}
        title={`Cerrar el turno de ${ajenoACerrar?.abierto_por_nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAjenoACerrar(null)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmarAjeno(true)}
              disabled={conteoAjenoNum === null || conteoAjenoNum < 0}
            >
              Continuar
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Abierto el {ajenoACerrar ? formatFechaHora(ajenoACerrar.abierto_en) : ''}. Cuenta el efectivo de la caja y escríbelo:
          la diferencia con lo esperado queda a nombre de {ajenoACerrar?.abierto_por_nombre}.
        </p>
        {ajenoACerrar?.total_esperado_efectivo !== undefined && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Efectivo esperado</span>
            <strong>{formatCOP(ajenoACerrar.total_esperado_efectivo)}</strong>
          </div>
        )}
        <Input
          id="caja-conteo-ajeno"
          label="Efectivo contado (COP)"
          type="number"
          min={0}
          step={100}
          value={conteoAjeno}
          onChange={(e) => setConteoAjeno(e.target.value)}
          error={errorConteoAjeno ?? undefined}
        />
        <Textarea
          id="caja-nota-ajeno"
          label="Nota (opcional)"
          maxLength={500}
          value={notaAjeno}
          onChange={(e) => setNotaAjeno(e.target.value)}
          placeholder="Ej. Bruno se fue sin cerrar el turno de la mañana"
        />
        {errorAjeno && <MensajeFijo tono="error">{errorAjeno}</MensajeFijo>}
      </Modal>

      <ConfirmDialog
        isOpen={confirmarAjeno}
        onClose={() => !isProcessing && setConfirmarAjeno(false)}
        onConfirm={handleCerrarAjeno}
        isLoading={isProcessing}
        isDestructive
        title="Confirmar cierre de turno ajeno"
        message={`Vas a cerrar el turno de ${ajenoACerrar?.abierto_por_nombre ?? ''} con ${formatCOP(conteoAjenoNum ?? 0)} contados. Esta acción no se puede deshacer y queda en la auditoría.`}
        confirmText="Cerrar turno"
      />

      {/* Egreso */}
      <Modal
        isOpen={showEgresoModal}
        onClose={() => !isProcessing && setShowEgresoModal(false)}
        title="Registrar egreso"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowEgresoModal(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleRegistrarEgreso} isLoading={isProcessing}>
              Registrar egreso
            </Button>
          </>
        }
      >
        <Input
          id="caja-egreso-monto"
          label="Monto (COP)"
          type="number"
          min={1}
          step={100}
          value={egresoMonto}
          onChange={(e) => setEgresoMonto(e.target.value)}
        />
        <Input
          id="caja-egreso-motivo"
          label="Motivo"
          placeholder="Ej. Compra de botellones de agua"
          maxLength={255}
          value={egresoMotivo}
          onChange={(e) => setEgresoMotivo(e.target.value)}
        />
        {errorEgreso && <MensajeFijo tono="error">{errorEgreso}</MensajeFijo>}
      </Modal>
    </div>
  );
};
