import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { cajaService } from '../../api/caja.service';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { MensajeFijo } from '../../components/estados/Estados';
import { formatCOP } from '../../utils/formato';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import type { InfoGymResponse } from '../../types/myGym.types';
import type {
  DetallesDescuentoSuperaTope,
  PagoMembresiaResponseDto,
  RegistrarPagoMembresiaRequest,
} from '../../types/caja.types';

/** Qué se cobra: una membresía individual o un paquete de plan grupal (contrato 1.3). */
export type DestinoCobro =
  | { tipo: 'membresia'; membresiaId: string; titulo: string; detalle?: string; precioLista: number }
  | { tipo: 'paquete'; paqueteId: string; titulo: string; detalle?: string; precioLista: number };

interface CobroMembresiaModalProps {
  destino: DestinoCobro | null;
  onCerrar: () => void;
  onCobrado: (pago: PagoMembresiaResponseDto) => void;
}

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function tipoMedioDe(metodo: string): 'efectivo' | 'otro' {
  return metodo.trim().toLowerCase() === 'efectivo' ? 'efectivo' : 'otro';
}

/** Mensaje claro para los errores de descuento del contrato 1.2. */
function mensajeError(err: ApiError): string {
  switch (err.codigo) {
    case 'DESCUENTOS_DESHABILITADOS':
      return 'Este gimnasio no permite descuentos. Cobra el precio de lista.';
    case 'SIN_PERMISO_DESCUENTO':
      return 'No tienes permiso para aplicar descuentos. Cobra el precio de lista o pide al Jefe que haga el cobro.';
    case 'DESCUENTO_SUPERA_TOPE': {
      const tope = (err.detalles as DetallesDescuentoSuperaTope | null)?.tope_pct;
      return tope !== undefined && tope !== null
        ? `El descuento supera el tope del gimnasio (${Number(tope)} %).`
        : 'El descuento supera el tope permitido por el gimnasio.';
    }
    case 'NO_HAY_TURNO_ABIERTO':
      return 'Necesitas tu propio turno de caja abierto para cobrar.';
    case 'PAGO_INSUFICIENTE':
      return 'El valor recibido es menor al valor a cobrar. No se aceptan abonos.';
    default:
      return err.message;
  }
}

/**
 * Cobro de una membresía o de un paquete (GW-RF-15, contratos 1.2 y 1.3) con `POST /caja/pagos-membresia`.
 * Precio editable: si se cobra menos que el de lista exige motivo. La `X-Idempotency-Key` se crea en el
 * primer intento y se conserva en los reintentos; cambiar lo que se cobra la renueva.
 */
export const CobroMembresiaModal: React.FC<CobroMembresiaModalProps> = ({ destino, onCerrar, onCobrado }) => {
  const { hasPermission } = useAuth();
  const { turnoPropio, turno, refrescar: refrescarTurno } = useCajaTurno();
  const puedeCobrar = hasPermission('caja', 'crear');
  const puedeVerConfig = hasPermission('configuracion', 'leer');

  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [precioCobrado, setPrecioCobrado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoMedioManual, setTipoMedioManual] = useState<'efectivo' | 'otro'>('efectivo');
  const [valorRecibido, setValorRecibido] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<PagoMembresiaResponseDto | null>(null);

  // Configuración del gimnasio (métodos de pago y regla de descuentos). Sin permiso, decide el backend.
  useEffect(() => {
    if (!destino || !puedeVerConfig) return;
    myGymService
      .getInfo()
      .then((i) => {
        setInfo(i);
        if (i.metodos_pago?.length) setMetodo(i.metodos_pago.find((m) => m.toLowerCase() === 'efectivo') ?? i.metodos_pago[0]);
      })
      .catch(() => setInfo(null));
  }, [destino, puedeVerConfig]);

  useEffect(() => {
    if (!destino) return;
    setPrecioCobrado(String(destino.precioLista));
    setMotivo('');
    setValorRecibido('');
    setIdempotencyKey(null);
    setError(null);
    setErrorMotivo(null);
    setRecibo(null);
  }, [destino]);

  // Cualquier cambio en lo que se cobra es otra operación: la clave anterior deja de servir.
  useEffect(() => {
    setIdempotencyKey(null);
  }, [precioCobrado, motivo, metodo, tipoMedioManual, valorRecibido]);

  if (!destino) return null;

  const metodosConfigurados = info?.metodos_pago?.length ? info.metodos_pago : null;
  const tipoMedio = metodosConfigurados ? tipoMedioDe(metodo) : tipoMedioManual;
  const descuentosApagados = info?.permitir_descuentos === false;
  const tope = info?.tope_descuento_pct;

  const lista = destino.precioLista;
  const cobrado = entero(precioCobrado);
  const hayDescuento = cobrado !== null && cobrado < lista;
  const pct = hayDescuento && lista > 0 ? ((lista - (cobrado as number)) / lista) * 100 : 0;
  const recibido = entero(valorRecibido);

  let errorPrecio: string | null = null;
  if (cobrado === null || cobrado <= 0) errorPrecio = 'Escribe el valor a cobrar.';
  else if (cobrado > lista) errorPrecio = 'El valor cobrado no puede superar el precio de lista.';
  else if (hayDescuento && descuentosApagados) errorPrecio = 'Este gimnasio no permite descuentos.';
  else if (hayDescuento && tope !== undefined && pct > tope) errorPrecio = `El descuento supera el tope del gimnasio (${tope} %).`;
  const motivoFaltante = hayDescuento && !motivo.trim();
  const errorRecibido =
    tipoMedio === 'efectivo' && recibido !== null && cobrado !== null && recibido < cobrado
      ? 'El valor recibido es menor al valor a cobrar. No se aceptan abonos.'
      : null;
  const cambio = tipoMedio === 'efectivo' && recibido !== null && cobrado !== null ? recibido - cobrado : null;

  const listo = puedeCobrar && turnoPropio && !errorPrecio && !errorRecibido && !!metodo.trim() && !enviando;

  const cobrar = async () => {
    if (motivoFaltante) {
      setErrorMotivo('El descuento exige un motivo.');
      return;
    }
    if (!listo || cobrado === null) return;
    const clave = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(clave);
    setEnviando(true);
    setError(null);
    setErrorMotivo(null);

    const data: RegistrarPagoMembresiaRequest = {
      monto: cobrado,
      metodo: metodo.trim(),
      tipo_medio: tipoMedio,
      dias_agregados: 0,
      valor_recibido: tipoMedio === 'efectivo' && recibido !== null ? recibido : undefined,
    };
    if (destino.tipo === 'membresia') data.membresia_id = destino.membresiaId;
    else data.paquete_id = destino.paqueteId;
    if (hayDescuento) {
      data.precio_cobrado = cobrado;
      data.motivo_descuento = motivo.trim();
    }

    try {
      const pago = await cajaService.registrarPagoMembresia(data, clave);
      setRecibo(pago);
      setIdempotencyKey(null);
      refrescarTurno();
      onCobrado(pago);
    } catch (e) {
      // La clave se conserva: reintentar sin cambiar nada no cobra dos veces.
      const err = toApiError(e);
      if (err.codigo === 'MOTIVO_DESCUENTO_REQUERIDO') setErrorMotivo(err.message);
      else setError(err);
      if (err.codigo === 'NO_HAY_TURNO_ABIERTO') refrescarTurno();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      isOpen={!!destino}
      onClose={() => !enviando && onCerrar()}
      title={destino.tipo === 'paquete' ? 'Cobrar plan grupal' : 'Cobrar membresía'}
      maxWidth="560px"
      footer={
        recibo ? (
          <Button variant="primary" onClick={onCerrar}>
            Listo
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onCerrar} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" leftIcon={<Receipt size={16} />} onClick={cobrar} isLoading={enviando} disabled={!listo}>
              Cobrar {cobrado !== null && cobrado > 0 ? formatCOP(cobrado) : ''}
            </Button>
          </>
        )
      }
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700 }}>{destino.titulo}</div>
        {destino.detalle && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{destino.detalle}</div>}
      </div>

      {recibo ? (
        <MensajeFijo tono="info" titulo={`Pago registrado · ${formatCOP(recibo.monto)}`}>
          <div>
            Precio de lista {formatCOP(recibo.precio_lista ?? lista)} · cobrado {formatCOP(recibo.precio_cobrado ?? recibo.monto)}
            {Number(recibo.descuento_pct ?? 0) > 0 && <> · descuento {Number(recibo.descuento_pct)} %</>}
          </div>
          {recibo.nueva_fecha_vencimiento && <div>Nuevo vencimiento: {formatFechaNegocio(recibo.nueva_fecha_vencimiento)}</div>}
          {recibo.cambio_devuelto !== null && recibo.cambio_devuelto !== undefined && Number(recibo.cambio_devuelto) > 0 && (
            <div>
              Cambio: <strong>{formatCOP(recibo.cambio_devuelto)}</strong>
            </div>
          )}
          {recibo.idempotente_reintento && <div>Este pago ya estaba registrado: no se cobró dos veces.</div>}
        </MensajeFijo>
      ) : (
        <>
          {!puedeCobrar && (
            <MensajeFijo tono="info" style={{ marginBottom: 12 }}>
              No tienes permiso para cobrar en caja.
            </MensajeFijo>
          )}
          {puedeCobrar && !turnoPropio && (
            <MensajeFijo
              tono="advertencia"
              titulo={turno ? `La caja está abierta por ${turno.abierto_por_nombre ?? turno.staff_nombre}` : 'No tienes un turno de caja abierto'}
              accion={
                <Link to="/caja" className="btn btn-primary btn-sm">
                  Ir a caja
                </Link>
              }
              style={{ marginBottom: 12 }}
            >
              Para cobrar necesitas tu propio turno abierto.
            </MensajeFijo>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              marginBottom: 12,
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>Precio de lista</span>
            <strong>{formatCOP(lista)}</strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Input
              id="cobro-precio-cobrado"
              label="Valor a cobrar (COP)"
              type="number"
              min={1}
              step={100}
              value={precioCobrado}
              disabled={descuentosApagados || enviando}
              onChange={(e) => setPrecioCobrado(e.target.value)}
              error={errorPrecio ?? undefined}
            />
            <Input
              id="cobro-motivo-descuento"
              label={hayDescuento ? 'Motivo del descuento *' : 'Motivo del descuento'}
              value={motivo}
              maxLength={255}
              disabled={!hayDescuento || enviando}
              onChange={(e) => {
                setMotivo(e.target.value);
                setErrorMotivo(null);
              }}
              error={errorMotivo ?? (motivoFaltante && motivo !== '' ? 'El descuento exige un motivo.' : undefined)}
            />
          </div>
          {descuentosApagados && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -6 }}>
              Este gimnasio no permite descuentos: se cobra el precio de lista.
            </p>
          )}
          {hayDescuento && !errorPrecio && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: -6 }}>
              Descuento de {formatCOP(lista - (cobrado as number))} ({Math.round(pct * 100) / 100} %)
              {tope !== undefined ? ` · tope del gimnasio ${tope} %` : ''}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {metodosConfigurados ? (
              <Select
                id="cobro-metodo"
                label="Método de pago"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                options={metodosConfigurados.map((m) => ({ value: m, label: m }))}
              />
            ) : (
              <>
                <Input
                  id="cobro-metodo"
                  label="Método de pago"
                  value={metodo}
                  maxLength={50}
                  onChange={(e) => setMetodo(e.target.value)}
                  error={!metodo.trim() ? 'Escribe el método de pago.' : undefined}
                />
                <Select
                  id="cobro-tipo-medio"
                  label="Tipo de medio"
                  value={tipoMedioManual}
                  onChange={(e) => setTipoMedioManual(e.target.value as 'efectivo' | 'otro')}
                  options={[
                    { value: 'efectivo', label: 'Efectivo' },
                    { value: 'otro', label: 'Otro medio' },
                  ]}
                />
              </>
            )}
            {tipoMedio === 'efectivo' && (
              <Input
                id="cobro-valor-recibido"
                label="Valor recibido (opcional)"
                type="number"
                min={0}
                step={100}
                value={valorRecibido}
                onChange={(e) => setValorRecibido(e.target.value)}
                error={errorRecibido ?? undefined}
              />
            )}
          </div>
          {cambio !== null && cambio >= 0 && (
            <div style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
              Cambio: <strong>{formatCOP(cambio)}</strong>
            </div>
          )}

          {error && (
            <MensajeFijo tono="error" titulo="No se registró el pago" style={{ marginTop: 12 }}>
              {mensajeError(error)}
              {idempotencyKey && error.tipo === 'red' && (
                <div style={{ marginTop: 4 }}>Puedes reintentar: si el pago sí quedó registrado, no se cobrará dos veces.</div>
              )}
            </MensajeFijo>
          )}
        </>
      )}
    </Modal>
  );
};
