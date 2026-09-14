import React, { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/forms/FilterBar';
import { SearchInput } from '@/components/forms/SearchInput';
import { Select } from '@/components/forms/Select';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { StatusBadge } from '@/components/data/StatusBadge';
import { Button } from '@/components/actions/Button';
import { ExerciseModal } from '@/components/business/ExerciseModal';
import { DatasetImportModal } from '@/components/business/DatasetImportModal';
import { useExercises } from '@/hooks/useExercises';
import { useToast } from '@/hooks/useToast';
import { Exercise } from '@/types/exercise.types';
import { Dumbbell, PlusCircle, Upload, Edit, Eye, EyeOff, Film } from 'lucide-react';

export const ExercisesPage: React.FC = () => {
  const {
    exercises,
    isLoading,
    error,
    search,
    setSearch,
    grupoMuscular,
    setGrupoMuscular,
    categoria,
    setCategoria,
    activo,
    setActivo,
    refetch,
    toggleStatus,
  } = useExercises();

  const { success, error: toastError } = useToast();

  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [isExerciseModalOpen, setIsExerciseModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const handleToggle = async (exercise: Exercise) => {
    try {
      const next = !exercise.activo;
      await toggleStatus(exercise.id, next);
      success(`Ejercicio "${exercise.nombre_es}" ${next ? 'activado' : 'desactivado'}.`);
    } catch {
      toastError('No se pudo modificar el estado del ejercicio.');
    }
  };

  const columns: ColumnDef<Exercise>[] = [
    {
      id: 'media',
      header: '',
      width: '56px',
      render: (row) => (
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {row.archivo_url ? (
            <img
              src={row.archivo_url}
              alt={row.nombre_es}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Dumbbell size={18} color="var(--color-text-tertiary)" />
          )}
        </div>
      ),
    },
    {
      id: 'nombre',
      header: 'Ejercicio (ES / EN)',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
            {row.nombre_es}
          </div>
          {row.nombre_en && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
              {row.nombre_en}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'grupo_muscular',
      header: 'Grupo Muscular',
      render: (row) => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 'var(--radius-xs)',
            backgroundColor: 'var(--color-bg-subtle)',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-medium)',
          }}
        >
          {row.grupo_muscular || 'General'}
        </span>
      ),
    },
    {
      id: 'equipo',
      header: 'Equipamiento',
      render: (row) => (
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          {row.equipo || 'Libre'}
        </span>
      ),
    },
    {
      id: 'categoria',
      header: 'Categoría',
      render: (row) => (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          {row.categoria || 'Fuerza'}
        </span>
      ),
    },
    {
      id: 'activo',
      header: 'Estado',
      render: (row) => (
        <StatusBadge
          status={row.activo ? 'activo' : 'cancelado'}
          label={row.activo ? 'Activo' : 'Inactivo'}
          size="sm"
        />
      ),
    },
    {
      id: 'version',
      header: 'Versión',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          v{row.version}
        </span>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggle(row)}
            title={row.activo ? 'Desactivar ejercicio' : 'Activar ejercicio'}
          >
            {row.activo ? <EyeOff size={15} /> : <Eye size={15} />}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSelectedExercise(row);
              setIsExerciseModalOpen(true);
            }}
            leftIcon={<Edit size={14} />}
          >
            Editar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo Global de Ejercicios"
        subtitle="Biblioteca multimedia estandarizada compartida por todos los tenants de la red SaaS (RF-21/RF-24)."
        actions={
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              variant="secondary"
              onClick={() => setIsImportModalOpen(true)}
              leftIcon={<Upload size={16} />}
            >
              Importar Dataset (RF-24)
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setSelectedExercise(null);
                setIsExerciseModalOpen(true);
              }}
              leftIcon={<PlusCircle size={16} />}
            >
              Nuevo Ejercicio
            </Button>
          </div>
        }
      />

      {/* Filter Bar */}
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre o equipamiento…"
          style={{ maxWidth: '320px' }}
        />

        <div style={{ width: '180px' }}>
          <Select
            value={grupoMuscular}
            onChange={(e) => setGrupoMuscular(e.target.value)}
            options={[
              { value: '', label: 'Todos los músculos' },
              { value: 'Pecho', label: 'Pecho' },
              { value: 'Espalda', label: 'Espalda' },
              { value: 'Piernas', label: 'Piernas' },
              { value: 'Hombros', label: 'Hombros' },
              { value: 'Bíceps', label: 'Bíceps' },
              { value: 'Tríceps', label: 'Tríceps' },
              { value: 'Core', label: 'Core / Abdomen' },
            ]}
          />
        </div>

        <div style={{ width: '160px' }}>
          <Select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            options={[
              { value: '', label: 'Todas las categorías' },
              { value: 'Fuerza', label: 'Fuerza' },
              { value: 'Hipertrofia', label: 'Hipertrofia' },
              { value: 'Cardio', label: 'Cardio' },
              { value: 'Movilidad', label: 'Movilidad' },
              { value: 'Funcional', label: 'Funcional' },
            ]}
          />
        </div>

        <div style={{ width: '150px' }}>
          <Select
            value={activo === undefined ? '' : String(activo)}
            onChange={(e) => {
              const val = e.target.value;
              setActivo(val === '' ? undefined : val === 'true');
            }}
            options={[
              { value: '', label: 'Todos los estados' },
              { value: 'true', label: 'Solo Activos' },
              { value: 'false', label: 'Solo Inactivos' },
            ]}
          />
        </div>
      </FilterBar>

      {/* Exercises Table */}
      <DataTable
        columns={columns}
        data={exercises}
        keyExtractor={(e) => e.id}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        emptyTitle="Catálogo vacío o sin coincidencias"
        emptyDescription="Puedes cargar un dataset inicial (ej. Wger) o registrar ejercicios individualmente."
        emptyAction={
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsImportModalOpen(true)}
              leftIcon={<Upload size={14} />}
            >
              Cargar Dataset Inicial
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setSelectedExercise(null);
                setIsExerciseModalOpen(true);
              }}
              leftIcon={<PlusCircle size={14} />}
            >
              Crear Ejercicio
            </Button>
          </div>
        }
      />

      {/* Modals */}
      <ExerciseModal
        isOpen={isExerciseModalOpen}
        onClose={() => {
          setIsExerciseModalOpen(false);
          setSelectedExercise(null);
        }}
        exercise={selectedExercise}
        onSuccess={refetch}
      />

      <DatasetImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={refetch}
      />
    </PageContainer>
  );
};
