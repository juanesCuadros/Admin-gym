import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { clasesService } from '../../api/clases.service';
import { cajaService } from '../../api/caja.service';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { BuscadorDeportista } from '../../components/ui/BuscadorDeportista';
import { MensajeFijo } from '../../components/estados/Estados';
import { formatCOP, formatFechaHora } from '../../utils/formato';
import type { ClaseResponse, ReservaResponse } from '../../types/clases.types';
import type { DeportistaBusquedaItem } from '../../types/comun.types';

interface ReservarCupoModalProps {
  clase: ClaseResponse | null;
  isOpen: boolean;
  onClose: () => void;
  onReservada: (reserva: ReservaResponse) => void;
}

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Reservar cupo (GW-RF-33). Con membresía activa o por vencer reserva directo.
 * Sin ella el backend responde PASE_CLASE_REQUERIDO y el modal pasa a cobrar el pase de clase
 * en el mismo paso (`cobro` + `X-Idempotency-Key`): venta y reserva quedan juntas o no queda ninguna.
 */
export const ReservarCupoModal: React.FC<ReservarCupoModalProps> = ({ clase, isOpen, onClose, onReservada }) => {
  const { hasPermission } = useAuth();
  const { turnoPropio, refrescar: refrescarTurno } = useCajaTurno();
  const puedeCobrar = hasPermission('caja', 'crear');
  const puedeVerConfig = hasPermission('configuracion', 'leer');

  const [deportista, setDeportista] = useState<DeportistaBusquedaItem | null>(null);
  const [pideCobro, setPideCobro] = useState(false);
  const [precioConfigurado, setPrecioConfigurado] = useState<number | null>(null);
  const [precioManual, setPrecioManual] = useState('');
  const [metodos, setMetodos] = useState<string[] | null>(null);
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoMedioManual, setTipoMedioManual] = useState<'efectivo' | 'otro'>('efectivo');
  const [valorRecibido, setValorRecibido] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  // Misma clave en los reintentos del mismo cobro; cambiar lo que se cobra la renueva.
  const claveRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDeportista(null);
    setPideCobro(false);
    setPrecioManual('');
    setValorRecibido('');
    setError(null);
    claveRef.current = null;
  }, [isOpen, clase?.id]);

  useEffect(() => {
    claveRef.current = null;
  }, [deportista, precioManual, metodo, tipoMedioManual, valorRecibido]);

  // Datos del cobro: se cargan solo cuando hace falta cobrar.
  useEffect(() => {
    if (!pideCobro || !puedeCobrar) return;
    cajaService
      .getPreciosPases()
      .then((p) => setPrecioConfigurado(p.pase_clase))
      .catch(() => setPrecioConfigurado(null));
    if (puedeVerConfig) {
      myGymService
        .getInfo()
        .then((i) => {
          if (i.metodos_pago?.length) {
            setMetodos(i.metodos_pago);
            setMetodo(i.metodos_pago.find((m) => m.toLowerCase() === 'efectivo') ?? i.metodos_pago[0]);
          }
        })
        .catch(() => setMetodos(null));
    }
  }, [pideCobro, puedeCobrar, puedeVerConfig]);

  const tipoMedio: 'efectivo' | 'otro' = metodos
    ? metodo.trim().toLowerCase() === 'efectivo'
      ? 'efectivo'
      : 'otro'
    : tipoMedioManual;
  const precio = precioConfigurado ?? entero(precioManual);
  const recibido = entero(valorRecibido);
  const cambio = tipoMedio === 'efectivo' && recibido !== null && precio !== null ? recibido - precio : null;

  let errorCobro: string | null = null;
  if (pideCobro) {
    if (precio === null || precio <= 0) errorCobro = 'Escribe el precio del pase.';
    else if (!metodo.trim()) errorCobro = 'Elige el método de pago.';
    else if (tipoMedio === 'efectivo' && recibido !== null && recibido < precio)
      errorCobro = 'El valor recibido es menor al precio. No se aceptan abonos.';
  }

  const confirmar = async () => {
    if (!clase || !deportista || enviandoRef.current) return;
    if (pideCobro && (errorCobro || !puedeCobrar || !turnoPropio)) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      let reserva: ReservaResponse;
      if (pideCobro) {
        const clave = claveRef.current ?? crypto.randomUUID();
        claveRef.current = clave;
        reserva = await clasesService.crearReserva(
          clase.id,
          {
            deportista_id: deportista.id,
            cobro: {
              metodo: metodo.trim(),
              tipo_medio: tipoMedio,
              valor_recibido: tipoMedio === 'efectivo' && recibido !== null ? recibido : undefined,
              precio_unitario: precioConfigurado === null ? precio ?? undefined : undefined,
            },
          },
          clave
        );
        refrescarTurno();
      } else {
        reserva = await clasesService.crearReserva(clase.id, { deportista_id: deportista.id });
      }
      onReservada(reserva);
    } catch (e) {
      const err = toApiError(e);
      if (!pideCobro && err.codigo === 'PASE_CLASE_REQUERIDO') {
        setPideCobro(true);
        setError(null);
      } else {
        setError(err);
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const bloqueoCobro = pideCobro && (!puedeCobrar || !turnoPropio);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={pideCobro ? 'Reservar y cobrar pase de clase' : 'Reservar cupo'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={confirmar}
            isLoading={enviando}
            disabled={!deportista || bloqueoCobro || (pideCobro && !!errorCobro)}
            leftIcon={pideCobro ? <Ticket size={16} /> : undefined}
          >
            {pideCobro && precio !== null && precio > 0 ? `Cobrar ${formatCOP(precio)} y reservar` : 'Confirmar reserva'}
          </Button>
        </>
      }
    >
      {clase && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          {clase.nombre} · {formatFechaHora(clase.fecha_hora)}
        </p>
      )}

      <BuscadorDeportista
        label="Deportista *"
        seleccionado={deportista}
        onSeleccionar={(d) => {
          setDeportista(d);
          setPideCobro(false);
          setError(null);
        }}
        disabled={enviando}
      />

      {!pideCobro && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Con membresía activa o por vencer, la reserva no tiene costo. Si no la tiene, aquí mismo se cobra el pase de clase.
        </p>
      )}

      {pideCobro && (
        <div style={{ marginTop: 12 }}>
          <MensajeFijo tono="info" style={{ marginBottom: 12 }}>
            {deportista?.nombre ?? 'El deportista'} no tiene membresía activa: para reservar necesita un pase de clase.
          </MensajeFijo>

          {!puedeCobrar ? (
            <MensajeFijo tono="advertencia">No tienes permiso para cobrar en caja. Pide a recepción que cobre el pase.</MensajeFijo>
          ) : !turnoPropio ? (
            <MensajeFijo
              tono="advertencia"
              accion={
                <Link to="/caja" className="btn btn-primary btn-sm">
                  Ir a caja
                </Link>
              }
            >
              Para cobrar el pase necesitas tu turno de caja abierto.
            </MensajeFijo>
          ) : (
            <>
              {precioConfigurado !== null ? (
                <p style={{ marginBottom: 12 }}>
                  Precio del pase: <strong>{formatCOP(precioConfigurado)}</strong>
                </p>
              ) : (
                <Input
                  label="Precio del pase (COP) *"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={precioManual}
                  onChange={(e) => setPrecioManual(e.target.value)}
                  disabled={enviando}
                />
              )}

              {metodos ? (
                <Select
                  label="Método de pago *"
                  options={metodos.map((m) => ({ value: m, label: m }))}
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                  disabled={enviando}
                />
              ) : (
                <>
                  <Input
                    label="Método de pago *"
                    value={metodo}
                    maxLength={50}
                    onChange={(e) => setMetodo(e.target.value)}
                    disabled={enviando}
                  />
                  <Select
                    label="Tipo de medio"
                    options={[
                      { value: 'efectivo', label: 'Efectivo' },
                      { value: 'otro', label: 'Otro (datáfono, transferencia…)' },
                    ]}
                    value={tipoMedioManual}
                    onChange={(e) => setTipoMedioManual(e.target.value as 'efectivo' | 'otro')}
                    disabled={enviando}
                  />
                </>
              )}

              {tipoMedio === 'efectivo' && (
                <Input
                  label="Valor recibido (COP)"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={100}
                  value={valorRecibido}
                  onChange={(e) => setValorRecibido(e.target.value)}
                  disabled={enviando}
                />
              )}
              {cambio !== null && cambio >= 0 && (
                <p style={{ fontSize: '0.9rem' }}>
                  Cambio: <strong>{formatCOP(cambio)}</strong>
                </p>
              )}
              {errorCobro && precio !== null && (
                <p style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>{errorCobro}</p>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <MensajeFijo tono="error" titulo="No se pudo reservar" style={{ marginTop: 12 }}>
          {error.message}
        </MensajeFijo>
      )}
    </Modal>
  );
};
