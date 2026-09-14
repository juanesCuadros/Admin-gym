import React, { useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { GymDetail } from '@/types/gym.types';
import { useGymDetail } from '@/hooks/useGymDetail';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

export interface CancelGymModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail | null;
  onSuccess?: () => void;
}

export const CancelGymModal: React.FC<CancelGymModalProps> = ({
  isOpen,
  onClose,
  gym,
  onSuccess,
}) => {
  const { cancelGym } = useGymDetail(gym?.id);
  const { success, error: toastError } = useToast();

  const [motivo, setMotivo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!gym) return null;

  const handleConfirm = async () => {
    if (!motivo.trim() || motivo.trim().length < 5) {
      setErrorMsg('El motivo de cancelación es obligatorio (mínimo 5 caracteres).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await cancelGym({ motivo: motivo.trim() });
      success(`El gimnasio "${gym.nombre}" ha sido cancelado formalmente. Su acceso queda suspendido y sus datos preservados.`);
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
      title="Baja Formal de Gimnasio (RF-10)"
      message={`¿Confirmas la cancelación de "${gym.nombre}"? Esta acción congela de inmediato el acceso de su personal al tenant y preserva íntegramente sus registros históricos sin eliminar datos.`}
      confirmLabel="Confirmar Cancelación"
      isDestructive
      isLoading={isSubmitting}
    >
      <div style={{ marginTop: '16px' }}>
        <FormField
          label="Motivo Oficial de la Cancelación"
          required
          error={errorMsg || undefined}
          helperText="Indica la justificación comercial, cierre de sede o retiro voluntario."
        >
          <TextInput
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            placeholder="ej. Cierre definitivo de la sede por cambio de actividad comercial"
            hasError={!!errorMsg}
          />
        </FormField>
      </div>
    </ConfirmationDialog>
  );
};
