import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { Alert } from '@/components/feedback/Alert';
import { PaymentFields, PagoForm, pagoFormInicial, validarPagoForm } from './PaymentFields';
import { planRequestService } from '@/services/planRequestService';
import { parseApiError } from '@/services/api/errorHandler';
import { useToast } from '@/hooks/useToast';
import { SolicitudPlan } from '@/types/planRequest.types';
import { formatCOP, formatFecha, nuevaClaveIdempotencia } from '@/utils/format';
import { CheckCircle2 } from 'lucide-react';

export interface ApprovePlanRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  solicitud: SolicitudPlan | null;
  /** Se llama después de aprobar, o cuando el servidor dice que la solicitud ya no está pendiente. */
  onResuelta: () => void;
}

/**
 * Aprobar una solicitud de plan registrando su pago (`POST /admin/plan-requests/{id}/approve`).
 * Los meses los fija el plan (`duracion_meses`). La `Idempotency-Key` se genera al abrir el
 * formulario (un intento de aprobación) y se conserva en los reintentos para no duplicar el pago.
 */
export const ApprovePlanRequestModal: React.FC<ApprovePlanRequestModalProps> = ({
  isOpen,
  onClose,
  solicitud,
  onResuelta,
}) => {
  const { success, warning } = useToast();

  const meses = solicitud?.plan.duracion_meses ?? null;
  const esperado = solicitud && meses ? solicitud.plan.precio * meses : null;

  const [form, setForm] = useState<PagoForm>(pagoFormInicial(esperado, meses ?? 1));
  const [clave, setClave] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [yaResuelta, setYaResuelta] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(pagoFormInicial(esperado, meses ?? 1));
      setClave(nuevaClaveIdempotencia('aprobacion-plan'));
      setFormErrors({});
      setErrorMsg(null);
      setYaResuelta(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, solicitud?.id]);

  if (!solicitud) return null;

  const cerrar = () => {
    if (isSubmitting) return;
    if (yaResuelta) onResuelta();
    onClose();
  };

  // SA-RF-16 CA5: aviso que NO bloquea si el monto no coincide con precio del plan × meses.
  const avisoMonto =
    esperado !== null && form.monto.trim() !== '' && Number(form.monto) !== esperado
      ? `El monto no coincide con el precio del plan × meses (${formatCOP(esperado)}). Puedes aprobar igual.`
      : null;

  const aprobar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting || yaResuelta) return;
    setErrorMsg(null);
    const errs = validarPagoForm(form, false);
    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    setIsSubmitting(true);
    try {
      const r = await planRequestService.approve(
        solicitud.id,
        {
          monto: Number(form.monto),
          fecha_pago: form.fecha_pago,
          metodo: form.metodo.trim(),
          nota: form.nota.trim() || undefined,
        },
        clave
      );
      success(
        `"${solicitud.gimnasio.nombre}" pasó al plan ${r.plan_nombre} con un pago de ${formatCOP(r.monto)}.` +
          (r.nueva_fecha_corte ? ` Nueva fecha de corte: ${formatFecha(r.nueva_fecha_corte)}.` : ''),
        'Solicitud aprobada'
      );
      if (r.aviso_monto) warning(r.aviso_monto, 'Aviso de monto');
      onResuelta();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'SOLICITUD_NO_PENDIENTE') {
        // Otra persona la resolvió: no se puede aprobar, se recarga la lista al cerrar.
        setYaResuelta(true);
      }
      if (parsed.fieldErrors) setFormErrors(parsed.fieldErrors);
      if (parsed.codigo === 'FECHA_PAGO_FUTURA') {
        setFormErrors((prev) => ({ ...prev, fecha_pago: parsed.message }));
      }
      // La clave se conserva: un nuevo intento no duplica el pago.
      setErrorMsg(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={cerrar}
      title="Aprobar solicitud de plan"
      description={`"${solicitud.gimnasio.nombre}" pide el plan ${solicitud.plan.nombre}. Al aprobar se registra el pago, se asigna el plan y se recalcula la fecha de corte.`}
      maxWidth="560px"
      footer={
        <>
          <Button variant="cancel" onClick={cerrar} disabled={isSubmitting}>
            {yaResuelta ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button
            variant="primary"
            onClick={() => aprobar()}
            isLoading={isSubmitting}
            disabled={yaResuelta}
            leftIcon={<CheckCircle2 size={16} />}
          >
            Aprobar y registrar pago
          </Button>
        </>
      }
    >
      <form onSubmit={aprobar}>
        {errorMsg && (
          <Alert type="error" title={yaResuelta ? 'La solicitud ya no está pendiente' : 'No se aprobó la solicitud'} message={errorMsg} />
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '12px',
            padding: '12px 14px',
            marginBottom: '16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-subtle)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <div>
            <div style={{ color: 'var(--color-text-tertiary)' }}>Plan</div>
            <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>{solicitud.plan.nombre}</div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-tertiary)' }}>Precio mensual</div>
            <div style={{ fontWeight: 'var(--font-weight-semibold)', fontFamily: 'var(--font-mono)' }}>
              {formatCOP(solicitud.plan.precio)}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-tertiary)' }}>Total esperado</div>
            <div style={{ fontWeight: 'var(--font-weight-semibold)', fontFamily: 'var(--font-mono)' }}>
              {esperado !== null ? formatCOP(esperado) : '—'}
            </div>
          </div>
        </div>
        {meses === null && (
          <Alert type="warning" message="El plan solicitado no tiene duración en meses: el servidor rechazará la aprobación." />
        )}
        <PaymentFields
          form={form}
          onChange={setForm}
          errors={formErrors}
          disabled={isSubmitting || yaResuelta}
          conMeses={false}
          mesesFijosTexto="Los fija el plan solicitado."
        />
        {avisoMonto && <Alert type="warning" message={avisoMonto} style={{ marginBottom: 0 }} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
