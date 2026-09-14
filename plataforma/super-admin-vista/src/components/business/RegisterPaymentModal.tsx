import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { usePayments } from '@/hooks/usePayments';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { DollarSign, Calendar, CreditCard, FileText } from 'lucide-react';

export interface RegisterPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  gymId: string;
  gymNombre: string;
  defaultMonto?: number;
  onSuccess?: () => void;
}

export const RegisterPaymentModal: React.FC<RegisterPaymentModalProps> = ({
  isOpen,
  onClose,
  gymId,
  gymNombre,
  defaultMonto = 150000,
  onSuccess,
}) => {
  const { registerPayment } = usePayments(gymId);
  const { success, error: toastError } = useToast();

  const [monto, setMonto] = useState<number>(defaultMonto);
  const [meses, setMeses] = useState<number>(1);
  const [fechaPago, setFechaPago] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [metodo, setMetodo] = useState<string>('Transferencia Bancaria');
  const [nota, setNota] = useState<string>('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setMonto(defaultMonto);
      setMeses(1);
      setFechaPago(new Date().toISOString().split('T')[0]);
      setMetodo('Transferencia Bancolombia');
      setNota('');
      setIdempotencyKey(`pay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
      setFormErrors({});
    }
  }, [isOpen, defaultMonto]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    if (!monto || monto <= 0) {
      setFormErrors((prev) => ({ ...prev, monto: 'El monto debe ser superior a 0.' }));
      return;
    }
    if (!meses || meses < 1) {
      setFormErrors((prev) => ({ ...prev, meses: 'Debes registrar al menos 1 mes.' }));
      return;
    }
    if (!metodo.trim()) {
      setFormErrors((prev) => ({ ...prev, metodo: 'El método de pago es requerido.' }));
      return;
    }

    setIsSubmitting(true);
    try {
      const payment = await registerPayment({
        monto,
        meses,
        fecha_pago: fechaPago,
        metodo,
        nota: nota.trim() || undefined,
        idempotency_key: idempotencyKey,
      });

      success(
        `Pago por $${payment.monto.toLocaleString('es-CO')} registrado exitosamente. Nueva fecha de corte derivada: ${payment.nueva_fecha_corte || 'Actualizada'}.`
      );
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.fieldErrors) {
        setFormErrors(parsed.fieldErrors);
      }
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar Recaudo de Suscripción"
      description={`Registrar pago para ${gymNombre} y derivar nueva fecha de corte (RNF-04).`}
      maxWidth="500px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            leftIcon={<DollarSign size={16} />}
          >
            Confirmar y Registrar Pago
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FormField label="Monto Recaudado (COP)" required error={formErrors.monto}>
          <TextInput
            type="number"
            value={monto}
            onChange={(e) => setMonto(Number(e.target.value))}
            min={1}
            step="1000"
            leftElement={<span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>$</span>}
            hasError={!!formErrors.monto}
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <FormField label="Meses Cubiertos" required error={formErrors.meses}>
            <Select
              value={meses}
              onChange={(e) => setMeses(Number(e.target.value))}
              options={[
                { value: 1, label: '1 Mes' },
                { value: 2, label: '2 Meses' },
                { value: 3, label: '3 Meses (Trimestral)' },
                { value: 6, label: '6 Meses (Semestral)' },
                { value: 12, label: '12 Meses (Anual)' },
              ]}
              hasError={!!formErrors.meses}
            />
          </FormField>

          <FormField label="Fecha Efectiva del Pago" required error={formErrors.fecha_pago}>
            <TextInput
              type="date"
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              leftElement={<Calendar size={15} />}
              hasError={!!formErrors.fecha_pago}
            />
          </FormField>
        </div>

        <FormField label="Método de Pago" required error={formErrors.metodo} helperText="Texto libre descriptivo">
          <TextInput
            value={metodo}
            onChange={(e) => setMetodo(e.target.value)}
            placeholder="ej. Transferencia Bancolombia, Nequi, Efectivo"
            leftElement={<CreditCard size={16} />}
            hasError={!!formErrors.metodo}
          />
        </FormField>

        <FormField label="Notas u Observaciones" optional error={formErrors.nota}>
          <TextInput
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="ej. Comprobante No. 894312 remitido por WhatsApp"
            leftElement={<FileText size={16} />}
          />
        </FormField>

        {/* Idempotency token indicator (transparent security) */}
        <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
          Clave de Idempotencia: <span style={{ fontFamily: 'var(--font-mono)' }}>{idempotencyKey}</span>
        </div>
      </form>
    </Modal>
  );
};
