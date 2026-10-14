import React, { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { Payment } from '@/types/payment.types';
import { paymentService } from '@/services/paymentService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { formatCOP, formatFecha } from '@/utils/format';

export interface VoidPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: Payment | null;
  /** Recibe el pago anulado; si trae `advertencia` (SA-RF-09 CA5), la ficha la muestra. */
  onSuccess?: (anulado: Payment | null) => void;
}

/** Anular pago (`POST /admin/payments/{id}/void`, SA-RF-18). */
export const VoidPaymentModal: React.FC<VoidPaymentModalProps> = ({ isOpen, onClose, payment, onSuccess }) => {
  const { success } = useToast();

  const [motivo, setMotivo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMotivo('');
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!payment) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (motivo.trim().length < 5) {
      setErrorMsg('El motivo de anulación es obligatorio (mínimo 5 caracteres).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const updated = await paymentService.voidPayment(payment.id, { motivo_anulacion: motivo.trim() });
      success(
        'Pago anulado.' +
          (updated.nueva_fecha_corte ? ` La fecha de corte quedó en ${formatFecha(updated.nueva_fecha_corte)}.` : '')
      );
      onSuccess?.(updated);
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'PAGO_YA_ANULADO') {
        setErrorMsg('Este pago ya estaba anulado. Recarga la ficha para ver el estado actual.');
        onSuccess?.(null);
        return;
      }
      setErrorMsg(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      onConfirm={handleConfirm}
      title="Anular pago"
      message={`¿Anular el pago de ${formatCOP(payment.monto)} (${payment.meses} ${payment.meses === 1 ? 'mes' : 'meses'}) del ${formatFecha(payment.fecha_pago)}? Queda marcado como anulado, no se borra, y la fecha de corte se recalcula: el gimnasio puede quedar bloqueado.`}
      confirmLabel="Anular pago"
      isDestructive
      isLoading={isSubmitting}
    >
      {errorMsg && <Alert type="error" message={errorMsg} />}
      <FormField label="Motivo de la anulación" required helperText="Queda en el historial y en la auditoría.">
        <TextInput
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={isSubmitting}
          placeholder="ej. El banco rechazó la transferencia"
          hasError={!!errorMsg}
        />
      </FormField>
    </ConfirmationDialog>
  );
};
