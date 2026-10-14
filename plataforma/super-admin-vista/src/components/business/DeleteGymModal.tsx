import React, { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { GymDetail, GymDeleteResponse } from '@/types/gym.types';
import { gymService } from '@/services/gymService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

export interface DeleteGymModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail;
  onSuccess?: (res: GymDeleteResponse) => void;
}

/**
 * Eliminación definitiva (`DELETE /admin/gyms/{id}`, SA-RF-31).
 * Exige escribir el subdominio; el servidor rechaza con 409 AUN_NO_ELIMINABLE antes de 30 días.
 */
export const DeleteGymModal: React.FC<DeleteGymModalProps> = ({ isOpen, onClose, gym, onSuccess }) => {
  const { success } = useToast();
  const [confirmacion, setConfirmacion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmacion('');
      setErrorMsg(null);
    }
  }, [isOpen]);

  const coincide = confirmacion.trim().toLowerCase() === gym.subdominio;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (!coincide) {
      setErrorMsg('Escribe exactamente el subdominio del gimnasio para confirmar.');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await gymService.deleteGym(gym.id, { confirmar_subdominio: confirmacion.trim() });
      success(`"${gym.nombre}" se eliminó definitivamente. El subdominio "${res.subdominio_liberado}" quedó libre.`);
      onSuccess?.(res);
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'AUN_NO_ELIMINABLE') {
        const dias = parsed.detalles?.dias_desde_cancelacion;
        const requeridos = parsed.detalles?.dias_requeridos;
        setErrorMsg(
          typeof dias === 'number' && typeof requeridos === 'number'
            ? `Aún no se puede eliminar: van ${dias} de ${requeridos} días desde la cancelación.`
            : parsed.message
        );
      } else {
        setErrorMsg(parsed.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={isSubmitting ? () => undefined : onClose}
      onConfirm={handleConfirm}
      title="Eliminar definitivamente"
      message={`Se borran todos los datos de "${gym.nombre}", se invalida el enlace de exportación y se libera el subdominio. MVC conserva sus pagos y la auditoría. Esta acción no se puede deshacer.`}
      confirmLabel="Eliminar definitivamente"
      cancelLabel="Volver"
      isDestructive
      isLoading={isSubmitting}
    >
      {errorMsg && <Alert type="error" message={errorMsg} />}
      <FormField label={`Escribe "${gym.subdominio}" para confirmar`} required>
        <TextInput
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          disabled={isSubmitting}
          autoComplete="off"
          placeholder={gym.subdominio}
          hasError={!!errorMsg}
        />
      </FormField>
    </ConfirmationDialog>
  );
};
