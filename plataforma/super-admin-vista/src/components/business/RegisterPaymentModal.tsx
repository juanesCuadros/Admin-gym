import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { Alert } from '@/components/feedback/Alert';
import { PaymentFields, PagoForm, pagoFormInicial, validarPagoForm } from './PaymentFields';
import { paymentService } from '@/services/paymentService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { formatCOP, formatFecha, nuevaClaveIdempotencia } from '@/utils/format';
import { DollarSign } from 'lucide-react';

export interface RegisterPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  gymId: string;
  gymNombre: string;
  /** Valor mensual vigente: precarga el monto y alimenta el aviso de SA-RF-16 CA5. */
  valorMensual?: number | null;
  onSuccess?: () => void;
}

/**
 * Registrar pago (`POST /admin/gyms/{id}/payments`, SA-RF-16).
 * La clave de idempotencia se genera al abrir y se conserva en los reintentos (CA2).
 */
export const RegisterPaymentModal: React.FC<RegisterPaymentModalProps> = ({
  isOpen,
  onClose,
  gymId,
  gymNombre,
  valorMensual,
  onSuccess,
}) => {
  const { success } = useToast();

  const [form, setForm] = useState<PagoForm>(pagoFormInicial(valorMensual));
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(pagoFormInicial(valorMensual));
      setIdempotencyKey(nuevaClaveIdempotencia('pago'));
      setFormErrors({});
      setErrorMsg(null);
    }
  }, [isOpen, valorMensual]);

  // SA-RF-16 CA5: aviso que NO bloquea si el monto no coincide con valor vigente × meses.
  const esperado =
    valorMensual !== null && valorMensual !== undefined && Number(form.meses) > 0
      ? Math.round(valorMensual) * Number(form.meses)
      : null;
  const avisoMonto =
    esperado !== null && form.monto.trim() !== '' && Number(form.monto) !== esperado
      ? `El monto no coincide con el valor mensual × meses (${formatCOP(esperado)}). Puedes registrarlo igual.`
      : null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);

    const errs = validarPagoForm(form);
    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    setIsSubmitting(true);
    try {
      const payment = await paymentService.registerPayment(gymId, {
        monto: Number(form.monto),
        meses: Number(form.meses),
        fecha_pago: form.fecha_pago,
        metodo: form.metodo.trim(),
        nota: form.nota.trim() || undefined,
        idempotency_key: idempotencyKey,
      });

      success(
        `Pago de ${formatCOP(payment.monto)} registrado.` +
          (payment.nueva_fecha_corte ? ` Nueva fecha de corte: ${formatFecha(payment.nueva_fecha_corte)}.` : '')
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'IDEMPOTENCY_KEY_DUPLICADA') {
        // El reintento llegó después de un envío que sí se registró: no hay pago duplicado.
        success('El pago ya había quedado registrado.');
        onSuccess?.();
        onClose();
        return;
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
      onClose={isSubmitting ? () => undefined : onClose}
      title="Registrar pago"
      description={`Pago de la suscripción de "${gymNombre}". La fecha de corte se recalcula con el historial de pagos.`}
      maxWidth="540px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => handleSubmit()} isLoading={isSubmitting} leftIcon={<DollarSign size={16} />}>
            Registrar pago
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {errorMsg && <Alert type="error" title="No se registró el pago" message={errorMsg} />}
        <PaymentFields form={form} onChange={setForm} errors={formErrors} disabled={isSubmitting} />
        {avisoMonto && <Alert type="warning" message={avisoMonto} style={{ marginBottom: 0 }} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
