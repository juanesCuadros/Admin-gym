import React, { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { gymService } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';
import { CredentialsIssuanceResponse } from '@/types/gym.types';

export interface ChangeJefeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  gymId: string;
  correoActual: string;
  /** Recibe las credenciales nuevas: se muestran una sola vez (SA-RF-11). */
  onChanged: (creds: CredentialsIssuanceResponse) => void;
}

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SA-RF-29 Editar correo del Jefe. La contraseña anterior deja de servir (CA2): el servidor
 * regenera las credenciales en la misma operación y aquí se avisa antes de confirmar.
 */
export const ChangeJefeEmailModal: React.FC<ChangeJefeEmailModalProps> = ({
  isOpen,
  onClose,
  gymId,
  correoActual,
  onChanged,
}) => {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const enviandoRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setCorreo('');
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (enviandoRef.current) return;
    const limpio = correo.trim().toLowerCase();
    if (!CORREO_VALIDO.test(limpio)) {
      setError('Escribe un correo válido.');
      return;
    }
    if (limpio === correoActual.trim().toLowerCase()) {
      setError('El correo nuevo es igual al actual.');
      return;
    }
    enviandoRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const creds = await gymService.changeJefeEmail(gymId, limpio);
      onChanged(creds);
      onClose();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      enviandoRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cambiar correo del Jefe (SA-RF-29)"
      description="La contraseña actual del Jefe deja de servir: se genera una contraseña temporal nueva que verás una sola vez."
      maxWidth="480px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => handleSubmit()} isLoading={isSubmitting} leftIcon={<Mail size={16} />}>
            Cambiar correo y regenerar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <FormField label="Correo nuevo" required error={error || undefined} helperText={`Actual: ${correoActual}`}>
          <TextInput
            type="email"
            autoComplete="off"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            leftElement={<Mail size={15} />}
            autoFocus
          />
        </FormField>
      </form>
    </Modal>
  );
};
