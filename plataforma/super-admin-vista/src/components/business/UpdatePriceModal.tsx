import React, { useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { usePayments } from '@/hooks/usePayments';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { TrendingUp, Calendar } from 'lucide-react';

export interface UpdatePriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  gymId: string;
  gymNombre: string;
  currentPrice: number;
  onSuccess?: () => void;
}

export const UpdatePriceModal: React.FC<UpdatePriceModalProps> = ({
  isOpen,
  onClose,
  gymId,
  gymNombre,
  currentPrice,
  onSuccess,
}) => {
  const { updatePrice } = usePayments(gymId);
  const { success, error: toastError } = useToast();

  const [nuevoValor, setNuevoValor] = useState<number>(currentPrice);
  const [vigenteDesde, setVigenteDesde] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nuevoValor < 0) {
      setErrorMsg('El valor mensual no puede ser negativo.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await updatePrice(nuevoValor, vigenteDesde);
      success(`Tarifa mensual para "${gymNombre}" actualizada a $${nuevoValor.toLocaleString('es-CO')}. Se preservó el historial de precios.`);
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
      title="Ajustar Tarifa Mensual (RF-14)"
      description={`Actualizar el precio convenido de suscripción para "${gymNombre}". Los cobros pasados mantendrán su tarifa histórica.`}
      maxWidth="480px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            leftIcon={<TrendingUp size={16} />}
          >
            Guardar Nueva Tarifa
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField
          label="Nuevo Valor Mensual Acordado (COP)"
          required
          error={errorMsg || undefined}
          helperText={`Tarifa anterior: $${currentPrice.toLocaleString('es-CO')} COP/mes`}
        >
          <TextInput
            type="number"
            value={nuevoValor}
            onChange={(e) => setNuevoValor(Number(e.target.value))}
            min={0}
            step="1000"
            leftElement={<span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>$</span>}
          />
        </FormField>

        <FormField label="Vigente a partir de" required>
          <TextInput
            type="date"
            value={vigenteDesde}
            onChange={(e) => setVigenteDesde(e.target.value)}
            leftElement={<Calendar size={15} />}
          />
        </FormField>
      </form>
    </Modal>
  );
};
