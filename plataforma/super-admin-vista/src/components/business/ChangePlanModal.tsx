import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { Select } from '@/components/forms/Select';
import { TextInput } from '@/components/forms/TextInput';
import { Alert } from '@/components/feedback/Alert';
import { Skeleton } from '@/components/feedback/Skeleton';
import { GymDetail } from '@/types/gym.types';
import { Plan } from '@/types/plan.types';
import { gymService } from '@/services/gymService';
import { planService } from '@/services/planService';
import { parseApiError } from '@/services/api/errorHandler';
import { useToast } from '@/hooks/useToast';
import { formatCOP, formatFecha, hoyBogota } from '@/utils/format';

export interface ChangePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  gym: GymDetail;
  onSuccess?: () => void;
}

/**
 * Cambio de plan manual por MVC (`PATCH /admin/gyms/{id}/plan`, contrato 3.1).
 * Crea un registro nuevo de suscripción con el precio del plan; no es retroactivo.
 */
export const ChangePlanModal: React.FC<ChangePlanModalProps> = ({ isOpen, onClose, gym, onSuccess }) => {
  const { success } = useToast();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');
  const [vigenteDesde, setVigenteDesde] = useState(hoyBogota());
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planActualId = gym.suscripcion_actual?.plan_id || null;
  const vigenciaActual = gym.suscripcion_actual?.vigente_desde || null;

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const data = await planService.listPlans();
      setPlanes(data.filter((p) => p.activo).sort((a, b) => a.orden - b.orden));
    } catch (err) {
      setErrorCarga(parseApiError(err).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setPlanId('');
      setVigenteDesde(hoyBogota());
      setError(null);
      cargar();
    }
  }, [isOpen, cargar]);

  const planElegido = planes.find((p) => p.id === planId) || null;
  const opciones = planes.filter((p) => p.id !== planActualId);

  const handleSubmit = async () => {
    setError(null);
    if (!planId) {
      setError('Selecciona el plan nuevo.');
      return;
    }
    if (!vigenteDesde) {
      setError('Indica desde qué fecha rige el plan nuevo.');
      return;
    }
    if (vigenciaActual && vigenteDesde < vigenciaActual) {
      setError(`La vigencia no puede ser anterior a la del plan actual (${formatFecha(vigenciaActual)}).`);
      return;
    }
    setEnviando(true);
    try {
      const res = await gymService.changePlan(gym.id, { plan_id: planId, vigente_desde: vigenteDesde });
      success(`Plan cambiado a "${res.plan_nombre}" desde el ${formatFecha(res.vigente_desde)}.`);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setEnviando(false);
    }
  };

  const etiqueta = (p: Plan) =>
    p.tipo === 'prueba'
      ? `${p.nombre} · prueba de ${p.dias_prueba ?? '—'} días`
      : `${p.nombre} · ${formatCOP(p.precio)}/mes`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={enviando ? () => undefined : onClose}
      title="Cambiar plan"
      description={`Plan actual de "${gym.nombre}": ${gym.plan_nombre || 'sin plan asignado'}.`}
      maxWidth="500px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} isLoading={enviando} disabled={cargando || !!errorCarga}>
            Cambiar plan
          </Button>
        </>
      }
    >
      {error && <Alert type="error" message={error} />}

      {cargando ? (
        <Skeleton height="42px" />
      ) : errorCarga ? (
        <Alert
          type="error"
          message={
            <span>
              No se pudieron cargar los planes: {errorCarga}{' '}
              <Button variant="ghost" size="sm" onClick={cargar}>
                Reintentar
              </Button>
            </span>
          }
        />
      ) : opciones.length === 0 ? (
        <Alert type="warning" message="No hay otros planes activos para asignar." />
      ) : (
        <>
          <FormField label="Plan nuevo" required>
            <Select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="Selecciona un plan"
              options={opciones.map((p) => ({ value: p.id, label: etiqueta(p) }))}
            />
          </FormField>

          <FormField
            label="Vigente desde"
            required
            helperText={vigenciaActual ? `No puede ser anterior al ${formatFecha(vigenciaActual)}.` : undefined}
          >
            <TextInput
              type="date"
              value={vigenteDesde}
              min={vigenciaActual || undefined}
              onChange={(e) => setVigenteDesde(e.target.value)}
            />
          </FormField>

          {planElegido && (
            <Alert
              type="info"
              message={`El valor mensual pasa a ${formatCOP(planElegido.precio)} desde el ${formatFecha(vigenteDesde)}. Los meses ya pagados no cambian.`}
            />
          )}
        </>
      )}
    </Modal>
  );
};
