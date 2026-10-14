import React, { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { GymDetail } from '@/types/gym.types';
import { gymService } from '@/services/gymService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

export interface CancelGymModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail | null;
  /** Recibe la ficha actualizada con `export_url` y `export_expira_en` (se muestran una sola vez). */
  onSuccess?: (actualizado: GymDetail) => void;
}

/** Cancelar gimnasio (`POST /admin/gyms/{id}/cancel`, SA-RF-10, SA-RF-30). */
export const CancelGymModal: React.FC<CancelGymModalProps> = ({ isOpen, onClose, gym, onSuccess }) => {
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

  if (!gym) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (motivo.trim().length < 5) {
      setErrorMsg('El motivo de la cancelación es obligatorio (mínimo 5 caracteres).');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const actualizado = await gymService.cancelGym(gym.id, { motivo: motivo.trim() });
      success(`"${gym.nombre}" quedó cancelado.`);
      onSuccess?.(actualizado);
      onClose();
    } catch (err) {
      setErrorMsg(parseApiError(err).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      onConfirm={handleConfirm}
      title="Cancelar gimnasio"
      message={`¿Cancelar "${gym.nombre}"? El Sistema Web queda bloqueado de inmediato, no acepta pagos ni cambios de plan y se genera un ZIP con sus datos descargable durante 30 días. Pasados 30 días se podrá eliminar definitivamente.`}
      confirmLabel="Cancelar gimnasio"
      cancelLabel="Volver"
      isDestructive
      isLoading={isSubmitting}
    >
      {errorMsg && <Alert type="error" message={errorMsg} />}
      <FormField label="Motivo de la cancelación" required helperText="Queda guardado en la ficha y en la auditoría.">
        <TextInput
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={isSubmitting}
          placeholder="ej. Cierre definitivo de la sede"
          hasError={!!errorMsg}
        />
      </FormField>
    </ConfirmationDialog>
  );
};
