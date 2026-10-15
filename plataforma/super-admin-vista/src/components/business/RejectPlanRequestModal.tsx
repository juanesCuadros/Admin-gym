import React, { useEffect, useState } from 'react';
import { ConfirmationDialog } from '@/components/actions/ConfirmationDialog';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { planRequestService } from '@/services/planRequestService';
import { parseApiError } from '@/services/api/errorHandler';
import { useToast } from '@/hooks/useToast';
import { SolicitudPlan } from '@/types/planRequest.types';

export interface RejectPlanRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  solicitud: SolicitudPlan | null;
  onResuelta: () => void;
}

/** Rechazar una solicitud de plan con motivo obligatorio (`POST /admin/plan-requests/{id}/reject`). */
export const RejectPlanRequestModal: React.FC<RejectPlanRequestModalProps> = ({
  isOpen,
  onClose,
  solicitud,
  onResuelta,
}) => {
  const { success } = useToast();
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [yaResuelta, setYaResuelta] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMotivo('');
      setTocado(false);
      setErrorMsg(null);
      setYaResuelta(false);
    }
  }, [isOpen]);

  if (!solicitud) return null;

  const largo = motivo.trim().length;
  const errorMotivo =
    largo < 5 ? 'El motivo es obligatorio (mínimo 5 caracteres).' : largo > 500 ? 'Máximo 500 caracteres.' : undefined;

  const cerrar = () => {
    if (isSubmitting) return;
    if (yaResuelta) onResuelta();
    onClose();
  };

  const rechazar = async () => {
    if (isSubmitting || yaResuelta) return;
    setTocado(true);
    if (errorMotivo) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await planRequestService.reject(solicitud.id, motivo.trim());
      success(`Se rechazó la solicitud de "${solicitud.gimnasio.nombre}".`);
      onResuelta();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'SOLICITUD_NO_PENDIENTE') setYaResuelta(true);
      setErrorMsg(parsed.fieldErrors?.motivo || parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={cerrar}
      onConfirm={rechazar}
      title="Rechazar solicitud de plan"
      message={`¿Rechazar la solicitud de "${solicitud.gimnasio.nombre}" para el plan ${solicitud.plan.nombre}? El gimnasio conserva su plan actual y no se registra ningún pago.`}
      confirmLabel="Rechazar solicitud"
      cancelLabel="Volver"
      isDestructive
      isLoading={isSubmitting}
    >
      {errorMsg && <Alert type="error" message={errorMsg} />}
      <FormField
        label="Motivo del rechazo"
        required
        error={tocado ? errorMotivo : undefined}
        helperText="Queda guardado en la solicitud y en la auditoría."
      >
        <TextInput
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onBlur={() => setTocado(true)}
          maxLength={500}
          disabled={isSubmitting || yaResuelta}
          placeholder="ej. No se recibió el comprobante de pago"
          hasError={tocado && !!errorMotivo}
        />
      </FormField>
    </ConfirmationDialog>
  );
};
