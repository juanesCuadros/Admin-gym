import React, { useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Payment } from '@/types/payment.types';
import { usePayments } from '@/hooks/usePayments';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

export interface VoidPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: Payment | null;
  onSuccess?: () => void;
}

export const VoidPaymentModal: React.FC<VoidPaymentModalProps> = ({
  isOpen,
  onClose,
  payment,
  onSuccess,
}) => {
  const { voidPayment } = usePayments(payment?.gimnasio_id);
  const { success, error: toastError } = useToast();

  const [motivo, setMotivo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!payment) return null;

  const handleConfirm = async () => {
    if (!motivo.trim() || motivo.trim().length < 5) {
      setErrorMsg('El motivo de anulación es obligatorio (mínimo 5 caracteres).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const updated = await voidPayment(payment.id, motivo.trim());
      success(
        `Pago anulado correctamente. La fecha de corte se recalculó automáticamente a: ${
          updated.nueva_fecha_corte || 'Derivada'
        }.`
      );
      if (onSuccess) onSuccess();
      onClose();
      setMotivo('');
    } catch (err) {
      const parsed = parseApiError(err);
      setErrorMsg(parsed.message);
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Anular Recaudo de Pago (RF-18)"
      message={`¿Estás seguro de anular el pago por $${payment.monto.toLocaleString('es-CO')} (${payment.meses} meses)? Esta acción conservará el registro histórico como anulado y recalculará inmediatamente la fecha de corte del gimnasio.`}
      confirmLabel="Anular Pago"
      isDestructive
      isLoading={isSubmitting}
    >
      <div style={{ marginTop: '16px' }}>
        <FormField
          label="Motivo Formal de la Anulación"
          required
          error={errorMsg || undefined}
          helperText="Se registrará de forma inmutable en el historial y en la auditoría criptográfica."
        >
          <TextInput
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            placeholder="ej. Comprobante rechazado por banco emisor o reversión acordada"
            hasError={!!errorMsg}
          />
        </FormField>
      </div>
    </ConfirmationDialog>
  );
};
