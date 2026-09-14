import React, { useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { Select } from '@/components/forms/Select';
import { TextInput } from '@/components/forms/TextInput';
import { GymDetail, GymState } from '@/types/gym.types';
import { useGymDetail } from '@/hooks/useGymDetail';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

export interface ChangeStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail | null;
  onSuccess?: () => void;
}

export const ChangeStatusModal: React.FC<ChangeStatusModalProps> = ({
  isOpen,
  onClose,
  gym,
  onSuccess,
}) => {
  const { changeStatus } = useGymDetail(gym?.id);
  const { success, error: toastError } = useToast();

  const [nuevoEstado, setNuevoEstado] = useState<GymState>('activo');
  const [motivo, setMotivo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!gym) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (nuevoEstado === 'cancelado' && (!motivo.trim() || motivo.trim().length < 5)) {
      setErrorMsg('Para cancelar un gimnasio debes indicar el motivo formal (mínimo 5 caracteres).');
      return;
    }

    setIsSubmitting(true);
    try {
      await changeStatus({
        nuevo_estado: nuevoEstado,
        motivo: motivo.trim() || undefined,
      });

      success(`Estado de "${gym.nombre}" actualizado a "${nuevoEstado}".`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      setErrorMsg(parsed.message);
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cambiar Estado Operativo"
      description={`Modificar el estado del gimnasio "${gym.nombre}" (Estado actual: ${gym.estado})`}
      maxWidth="480px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={isSubmitting}>
            Actualizar Estado
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField label="Nuevo Estado" required error={errorMsg || undefined}>
          <Select
            value={nuevoEstado}
            onChange={(e) => setNuevoEstado(e.target.value as GymState)}
            options={[
              { value: 'activo', label: 'Activo (Acceso operativo completo)' },
              { value: 'suspendido', label: 'Suspendido (Acceso congelado por mora/soporte)' },
              { value: 'prueba', label: 'En Prueba (Periodo de cortesía de 5 días)' },
              { value: 'cancelado', label: 'Cancelado (Baja formal no destructiva)' },
            ]}
          />
        </FormField>

        {nuevoEstado === 'cancelado' && (
          <FormField label="Motivo de la Cancelación" required error={errorMsg || undefined}>
            <TextInput
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Indica la razón de baja formal acordada"
            />
          </FormField>
        )}

        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: '8px', lineHeight: 1.4 }}>
          * Las transiciones de estado quedan registradas de forma auditada con encadenamiento SHA-256.
        </div>
      </form>
    </Modal>
  );
};
