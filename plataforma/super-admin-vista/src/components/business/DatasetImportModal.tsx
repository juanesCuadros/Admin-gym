import React, { useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { useExercises } from '@/hooks/useExercises';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';
import { Upload, CheckCircle2, FileCode } from 'lucide-react';
import { ExerciseImportResponse } from '@/types/exercise.types';

export interface DatasetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const sampleDataset = [
  {
    nombre_es: 'Sentadilla Trasera con Barra',
    nombre_en: 'Barbell Back Squat',
    grupo_muscular: 'Piernas',
    equipo: 'Barra',
    categoria: 'Fuerza',
    instrucciones: 'Colocar barra sobre los trapecios, descender hasta que los muslos queden paralelos al suelo manteniendo columna neutra.',
    archivo_url: 'https://cdn.gymos.io/exercises/squat.gif',
  },
  {
    nombre_es: 'Peso Muerto Convencional',
    nombre_en: 'Conventional Deadlift',
    grupo_muscular: 'Espalda',
    equipo: 'Barra',
    categoria: 'Fuerza',
    instrucciones: 'Pies al ancho de hombros, agarre firme de la barra, empuje con las piernas bloqueando cadera y glúteos arriba.',
    archivo_url: 'https://cdn.gymos.io/exercises/deadlift.gif',
  },
  {
    nombre_es: 'Dominadas Pronas',
    nombre_en: 'Pull-up',
    grupo_muscular: 'Espalda',
    equipo: 'Peso Corporal',
    categoria: 'Fuerza',
    instrucciones: 'Colgarse de la barra con agarre en pronación, traccionar hasta pasar la barbilla por encima de la barra.',
    archivo_url: 'https://cdn.gymos.io/exercises/pullup.gif',
  },
];

export const DatasetImportModal: React.FC<DatasetImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { importDataset } = useExercises();
  const { success, error: toastError } = useToast();

  const [datasetNombre, setDatasetNombre] = useState<string>('GymOS Standard v1');
  const [modoActualizacion, setModoActualizacion] = useState<string>('true');
  const [jsonText, setJsonText] = useState<string>(JSON.stringify(sampleDataset, null, 2));
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<ExerciseImportResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleImport = async () => {
    setParseError(null);
    setResult(null);

    let items;
    try {
      items = JSON.parse(jsonText);
      if (!Array.isArray(items) || items.length === 0) {
        setParseError('El JSON debe ser un array con al menos 1 ejercicio.');
        return;
      }
    } catch {
      setParseError('Formato JSON inválido. Revisa la sintaxis de corchetes y comillas.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await importDataset({
        dataset_nombre: datasetNombre,
        ejercicios: items,
        modo_actualizacion: modoActualizacion === 'true',
      });
      setResult(res);
      success(`Dataset procesado: ${res.insertados} insertados, ${res.actualizados} actualizados.`);
      if (onSuccess) onSuccess();
    } catch (err) {
      const parsed = parseApiError(err);
      toastError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importar Dataset de Ejercicios (RF-24)"
      description="Carga masiva de bibliotecas de ejercicios sin duplicados."
      maxWidth="620px"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Finalizar
          </Button>
        ) : (
          <>
            <Button variant="cancel" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleImport}
              isLoading={isSubmitting}
              leftIcon={<Upload size={16} />}
            >
              Iniciar Importación
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--color-success-light)',
              color: 'var(--color-success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <CheckCircle2 size={28} />
          </div>
          <h4 style={{ fontSize: 'var(--font-size-lg)', marginBottom: '8px' }}>
            Importación Completada Exitosamente
          </h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
            {result.mensaje}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px',
              backgroundColor: 'var(--color-bg-subtle)',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Total</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)' }}>
                {result.total}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-success)' }}>Insertados</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-success)' }}>
                {result.insertados}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-action)' }}>Actualizados</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-action)' }}>
                {result.actualizados}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>Ignorados</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-text-tertiary)' }}>
                {result.ignorados}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <FormField label="Nombre del Dataset" required>
              <TextInput
                value={datasetNombre}
                onChange={(e) => setDatasetNombre(e.target.value)}
                placeholder="ej. Wger / GymOS Oficial"
              />
            </FormField>

            <FormField label="Modo de Manejo">
              <Select
                value={modoActualizacion}
                onChange={(e) => setModoActualizacion(e.target.value)}
                options={[
                  { value: 'true', label: 'Actualizar existentes' },
                  { value: 'false', label: 'Ignorar existentes' },
                ]}
              />
            </FormField>
          </div>

          <FormField
            label="Contenido JSON del Dataset"
            required
            error={parseError || undefined}
            helperText="Formato: array de objetos con nombre_es, grupo_muscular, equipo, etc."
          >
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                if (parseError) setParseError(null);
              }}
              rows={9}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-xs)',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${parseError ? 'var(--color-error)' : 'var(--color-border-strong)'}`,
                backgroundColor: 'var(--color-bg-card)',
                color: 'var(--color-text-primary)',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </FormField>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setJsonText(JSON.stringify(sampleDataset, null, 2))}
              leftIcon={<FileCode size={14} />}
            >
              Cargar Plantilla Ejemplo
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
