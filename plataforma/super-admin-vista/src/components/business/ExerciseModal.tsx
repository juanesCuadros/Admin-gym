import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { Exercise, ExerciseCreate, ExerciseUpdate } from '@/types/exercise.types';
import { useExercises } from '@/hooks/useExercises';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { Dumbbell, Image as ImageIcon } from 'lucide-react';

export interface ExerciseModalProps {
  isOpen: boolean;
  onClose: () => void;
  exercise?: Exercise | null;
  onSuccess?: () => void;
}

export const ExerciseModal: React.FC<ExerciseModalProps> = ({
  isOpen,
  onClose,
  exercise,
  onSuccess,
}) => {
  const { createExercise, updateExercise } = useExercises();
  const { success, error: toastError } = useToast();

  const [nombreEs, setNombreEs] = useState<string>('');
  const [nombreEn, setNombreEn] = useState<string>('');
  const [instrucciones, setInstrucciones] = useState<string>('');
  const [grupoMuscular, setGrupoMuscular] = useState<string>('Pecho');
  const [equipo, setEquipo] = useState<string>('Mancuernas');
  const [categoria, setCategoria] = useState<string>('Fuerza');
  const [archivoUrl, setArchivoUrl] = useState<string>('');
  const [activo, setActivo] = useState<boolean>(true);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      if (exercise) {
        setNombreEs(exercise.nombre_es);
        setNombreEn(exercise.nombre_en || '');
        setInstrucciones(exercise.instrucciones || '');
        setGrupoMuscular(exercise.grupo_muscular || 'Pecho');
        setEquipo(exercise.equipo || 'Mancuernas');
        setCategoria(exercise.categoria || 'Fuerza');
        setArchivoUrl(exercise.archivo_url || '');
        setActivo(exercise.activo);
      } else {
        setNombreEs('');
        setNombreEn('');
        setInstrucciones('');
        setGrupoMuscular('Pecho');
        setEquipo('Mancuernas');
        setCategoria('Fuerza');
        setArchivoUrl('');
        setActivo(true);
      }
      setFormErrors({});
    }
  }, [isOpen, exercise]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    if (!nombreEs.trim()) {
      setFormErrors({ nombre_es: 'El nombre en español es obligatorio.' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (exercise) {
        const payload: ExerciseUpdate = {
          nombre_es: nombreEs.trim(),
          nombre_en: nombreEn.trim() || undefined,
          instrucciones: instrucciones.trim() || undefined,
          grupo_muscular: grupoMuscular,
          equipo,
          categoria,
          archivo_url: archivoUrl.trim() || undefined,
          activo,
        };
        await updateExercise(exercise.id, payload);
        success(`Ejercicio "${nombreEs}" actualizado correctamente.`);
      } else {
        const payload: ExerciseCreate = {
          nombre_es: nombreEs.trim(),
          nombre_en: nombreEn.trim() || undefined,
          instrucciones: instrucciones.trim() || undefined,
          grupo_muscular: grupoMuscular,
          equipo,
          categoria,
          archivo_url: archivoUrl.trim() || undefined,
          activo,
        };
        await createExercise(payload);
        success(`Ejercicio "${nombreEs}" creado en el catálogo global.`);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.fieldErrors) setFormErrors(parsed.fieldErrors);
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEdit = !!exercise;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Editar Ejercicio Global' : 'Nuevo Ejercicio Global (RF-22)'}
      description="Los ejercicios globales están disponibles para todos los gimnasios del SaaS GymOS."
      maxWidth="560px"
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            leftIcon={<Dumbbell size={16} />}
          >
            {isEdit ? 'Guardar Cambios' : 'Crear Ejercicio'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FormField label="Nombre (Español)" required error={formErrors.nombre_es}>
          <TextInput
            value={nombreEs}
            onChange={(e) => setNombreEs(e.target.value)}
            placeholder="ej. Press de Banca Plano con Barra"
            hasError={!!formErrors.nombre_es}
          />
        </FormField>

        <FormField label="Nombre (Inglés)" optional error={formErrors.nombre_en}>
          <TextInput
            value={nombreEn}
            onChange={(e) => setNombreEn(e.target.value)}
            placeholder="ej. Barbell Flat Bench Press"
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <FormField label="Grupo Muscular">
            <Select
              value={grupoMuscular}
              onChange={(e) => setGrupoMuscular(e.target.value)}
              options={[
                { value: 'Pecho', label: 'Pecho' },
                { value: 'Espalda', label: 'Espalda' },
                { value: 'Piernas', label: 'Piernas' },
                { value: 'Hombros', label: 'Hombros' },
                { value: 'Bíceps', label: 'Bíceps' },
                { value: 'Tríceps', label: 'Tríceps' },
                { value: 'Core', label: 'Core / Abdomen' },
                { value: 'Cuerpo Completo', label: 'Cuerpo Completo' },
              ]}
            />
          </FormField>

          <FormField label="Equipamiento">
            <Select
              value={equipo}
              onChange={(e) => setEquipo(e.target.value)}
              options={[
                { value: 'Barra', label: 'Barra' },
                { value: 'Mancuernas', label: 'Mancuernas' },
                { value: 'Polea', label: 'Polea / Cable' },
                { value: 'Máquina', label: 'Máquina' },
                { value: 'Peso Corporal', label: 'Peso Corporal' },
                { value: 'Kettlebell', label: 'Kettlebell' },
                { value: 'Banda Elástica', label: 'Banda' },
              ]}
            />
          </FormField>

          <FormField label="Categoría">
            <Select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              options={[
                { value: 'Fuerza', label: 'Fuerza' },
                { value: 'Hipertrofia', label: 'Hipertrofia' },
                { value: 'Cardio', label: 'Cardio' },
                { value: 'Movilidad', label: 'Movilidad' },
                { value: 'Funcional', label: 'Funcional' },
              ]}
            />
          </FormField>
        </div>

        <FormField label="URL del Recurso Visual / GIF Ilustrativo" optional error={formErrors.archivo_url}>
          <TextInput
            value={archivoUrl}
            onChange={(e) => setArchivoUrl(e.target.value)}
            placeholder="https://cdn.gymos.io/exercises/bench-press.gif"
            leftElement={<ImageIcon size={16} />}
          />
        </FormField>

        <FormField label="Instrucciones Técnicas de Ejecución" optional>
          <textarea
            value={instrucciones}
            onChange={(e) => setInstrucciones(e.target.value)}
            placeholder="Describe la posición inicial, trayectoria de movimiento, respiración y advertencias de seguridad…"
            rows={3}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-strong)',
              backgroundColor: 'var(--color-bg-card)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--font-size-md)',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </FormField>
      </form>
    </Modal>
  );
};
