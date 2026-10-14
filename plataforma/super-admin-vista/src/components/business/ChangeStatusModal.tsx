import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { Select } from '@/components/forms/Select';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { StatusBadge } from '@/components/data/StatusBadge';
import { PaymentFields, PagoForm, pagoFormInicial, validarPagoForm } from './PaymentFields';
import { GymDetail, GymState } from '@/types/gym.types';
import { gymService } from '@/services/gymService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { ETIQUETA_ESTADO, TRANSICIONES } from '@/utils/estados';
import { formatCOP, nuevaClaveIdempotencia } from '@/utils/format';
import { ArrowRight } from 'lucide-react';

export interface ChangeStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail | null;
  /** Recibe la ficha actualizada (al cancelar trae `export_url`, que se muestra una sola vez). */
  onSuccess?: (actualizado: GymDetail) => void;
}

/** Consecuencia de cada transición (SA-RF-09 CA2). */
function consecuencia(desde: GymState, hacia: GymState): string {
  if (hacia === 'activo' && desde === 'prueba') {
    return 'Se activa con el pago registrado aquí, en la misma operación. La fecha del pago se vuelve el ancla y la fecha de corte se calcula desde ella. Si el pago falla, el estado no cambia.';
  }
  if (hacia === 'activo') {
    return 'Se reactiva con el pago registrado aquí, en la misma operación. La fecha del pago se vuelve la nueva ancla y el Sistema Web se desbloquea. Si el pago falla, el estado no cambia.';
  }
  if (hacia === 'suspendido') {
    return 'Ningún rol del gimnasio podrá operar en el Sistema Web y la página pública mostrará "no disponible". Los datos no se modifican. Mientras esté suspendido solo recibe pagos al reactivarlo.';
  }
  if (hacia === 'cancelado') {
    return 'Bloqueo inmediato y definitivo. Se genera un archivo ZIP con sus datos y un enlace de descarga válido 30 días, que se muestra una sola vez. No acepta pagos ni cambios de plan. A los 30 días se podrá eliminar definitivamente.';
  }
  return '';
}

export const ChangeStatusModal: React.FC<ChangeStatusModalProps> = ({ isOpen, onClose, gym, onSuccess }) => {
  const { success } = useToast();

  const destinos: GymState[] = gym ? TRANSICIONES[gym.estado] : [];
  const [nuevoEstado, setNuevoEstado] = useState<GymState | ''>('');
  const [motivo, setMotivo] = useState<string>('');
  const [pago, setPago] = useState<PagoForm>(pagoFormInicial());
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [pagoErrors, setPagoErrors] = useState<Record<string, string>>({});
  const [motivoError, setMotivoError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && gym) {
      const opciones = TRANSICIONES[gym.estado];
      setNuevoEstado(opciones.length === 1 ? opciones[0] : '');
      setMotivo('');
      setPago(pagoFormInicial(gym.suscripcion_actual?.valor_mensual ?? null));
      setIdempotencyKey(nuevaClaveIdempotencia('estado'));
      setPagoErrors({});
      setMotivoError(null);
      setErrorMsg(null);
    }
  }, [isOpen, gym]);

  if (!gym) return null;

  const requierePago = nuevoEstado === 'activo';
  const requiereMotivo = nuevoEstado === 'suspendido' || nuevoEstado === 'cancelado';
  const valorMensual = gym.suscripcion_actual?.valor_mensual ?? null;
  const esperado =
    requierePago && valorMensual !== null && Number(pago.meses) > 0 ? Math.round(valorMensual) * Number(pago.meses) : null;
  const avisoMonto =
    esperado !== null && pago.monto.trim() !== '' && Number(pago.monto) !== esperado
      ? `El monto no coincide con el valor mensual × meses (${formatCOP(esperado)}). Puedes registrarlo igual.`
      : null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);
    setMotivoError(null);

    if (!nuevoEstado) {
      setErrorMsg('Selecciona el estado de destino.');
      return;
    }
    if (requiereMotivo && motivo.trim().length < 5) {
      setMotivoError('El motivo es obligatorio (mínimo 5 caracteres).');
      return;
    }
    if (requierePago) {
      const errs = validarPagoForm(pago);
      setPagoErrors(errs);
      if (Object.keys(errs).length) return;
    }

    setIsSubmitting(true);
    try {
      const actualizado = await gymService.changeGymStatus(gym.id, {
        nuevo_estado: nuevoEstado,
        motivo: requiereMotivo ? motivo.trim() : undefined,
        pago: requierePago
          ? {
              monto: Number(pago.monto),
              meses: Number(pago.meses),
              fecha_pago: pago.fecha_pago,
              metodo: pago.metodo.trim(),
              nota: pago.nota.trim() || undefined,
              idempotency_key: idempotencyKey,
            }
          : undefined,
      });

      success(`"${gym.nombre}" pasó a ${ETIQUETA_ESTADO[nuevoEstado].toLowerCase()}.`);
      onSuccess?.(actualizado);
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'IDEMPOTENCY_KEY_DUPLICADA') {
        // El pago y el cambio van en una sola transacción: si la clave ya existe, el cambio ya se hizo.
        setErrorMsg('Este pago ya se había registrado. Cierra y recarga la ficha para ver el estado actual.');
        return;
      }
      if (parsed.codigo === 'MOTIVO_REQUERIDO') setMotivoError(parsed.message);
      if (parsed.codigo === 'FECHA_PAGO_FUTURA') setPagoErrors((prev) => ({ ...prev, fecha_pago: parsed.message }));
      if (parsed.fieldErrors) setPagoErrors((prev) => ({ ...prev, ...parsed.fieldErrors }));
      // La clave de idempotencia se conserva para el reintento.
      setErrorMsg(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const etiquetaBoton =
    nuevoEstado === 'activo'
      ? gym.estado === 'suspendido'
        ? 'Registrar pago y reactivar'
        : 'Registrar pago y activar'
      : nuevoEstado === 'suspendido'
      ? 'Suspender'
      : nuevoEstado === 'cancelado'
      ? 'Cancelar gimnasio'
      : 'Cambiar estado';

  return (
    <Modal
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      title="Cambiar estado"
      description={`Gimnasio "${gym.nombre}".`}
      maxWidth="580px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cerrar
          </Button>
          <Button
            variant={requiereMotivo ? 'destructive' : 'primary'}
            onClick={() => handleSubmit()}
            isLoading={isSubmitting}
            disabled={!nuevoEstado}
          >
            {etiquetaBoton}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {errorMsg && <Alert type="error" title="No se cambió el estado" message={errorMsg} />}

        {destinos.length === 0 ? (
          <Alert type="info" message="Un gimnasio cancelado no admite cambios de estado." />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Estado actual</div>
                <StatusBadge status={gym.estado} />
              </div>
              <ArrowRight size={18} color="var(--color-text-tertiary)" style={{ marginTop: '16px' }} />
              <div style={{ flex: 1, minWidth: '200px' }}>
                <FormField label="Estado de destino" required style={{ marginBottom: 0 }}>
                  <Select
                    value={nuevoEstado}
                    onChange={(e) => {
                      setNuevoEstado(e.target.value as GymState);
                      setErrorMsg(null);
                    }}
                    placeholder="Selecciona"
                    disabled={isSubmitting}
                    options={destinos.map((d) => ({ value: d, label: ETIQUETA_ESTADO[d] }))}
                  />
                </FormField>
              </div>
            </div>

            {nuevoEstado && (
              <Alert
                type={requiereMotivo ? 'warning' : 'info'}
                title="Consecuencia"
                message={consecuencia(gym.estado, nuevoEstado)}
              />
            )}

            {requiereMotivo && (
              <FormField label="Motivo" required error={motivoError || undefined} helperText="Queda en la auditoría.">
                <TextInput
                  value={motivo}
                  onChange={(e) => {
                    setMotivo(e.target.value);
                    if (motivoError) setMotivoError(null);
                  }}
                  disabled={isSubmitting}
                  hasError={!!motivoError}
                  placeholder={nuevoEstado === 'cancelado' ? 'ej. Cierre de la sede' : 'ej. Mora de dos meses'}
                />
              </FormField>
            )}

            {requierePago && (
              <div>
                <div style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-sm)', margin: '4px 0 12px' }}>
                  Pago {gym.estado === 'suspendido' ? 'de reactivación' : 'de activación'}
                </div>
                <PaymentFields form={pago} onChange={setPago} errors={pagoErrors} disabled={isSubmitting} />
                {avisoMonto && <Alert type="warning" message={avisoMonto} style={{ marginBottom: 0 }} />}
              </div>
            )}
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
