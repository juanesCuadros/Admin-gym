import React, { useState, useEffect, useCallback } from 'react';
import {
  Dumbbell,
  Plus,
  Layers,
  UserCheck,
  CheckCircle,
  Filter,
  Play,
  FileText,
} from 'lucide-react';
import { entrenamientoService } from '../../api/entrenamiento.service';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import {
  EjercicioResponse,
  RutinaPlantillaListItemResponse,
  RutinaPlantillaResponse,
  CrearEjercicioPropioRequest,
  CrearPlantillaRequest,
} from '../../types/entrenamiento.types';

export const EntrenamientoPage: React.FC = () => {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'ejercicios' | 'plantillas'>('ejercicios');

  // Ejercicios state
  const [ejercicios, setEjercicios] = useState<EjercicioResponse[]>([]);
  const [totalEjercicios, setTotalEjercicios] = useState(0);
  const [grupoFiltro, setGrupoFiltro] = useState('');
  const [pageEjercicios, setPageEjercicios] = useState(1);
  const [isLoadingEjercicios, setIsLoadingEjercicios] = useState(false);

  // Plantillas state
  const [plantillas, setPlantillas] = useState<RutinaPlantillaListItemResponse[]>([]);
  const [isLoadingPlantillas, setIsLoadingPlantillas] = useState(false);
  const [selectedPlantilla, setSelectedPlantilla] = useState<RutinaPlantillaResponse | null>(null);

  // Modals
  const [showCrearEjercicioModal, setShowCrearEjercicioModal] = useState(false);
  const [nuevoEjercicio, setNuevoEjercicio] = useState<CrearEjercicioPropioRequest>({
    nombre_es: '',
    grupo_muscular: 'Pecho',
    equipo: 'Mancuernas',
    categoria: 'Fuerza',
    instrucciones: '',
  });

  const [showCrearPlantillaModal, setShowCrearPlantillaModal] = useState(false);
  const [nuevaPlantilla, setNuevaPlantilla] = useState<CrearPlantillaRequest>({
    nombre: '',
    descripcion: '',
    items: [],
  });

  const [showAsignarModal, setShowAsignarModal] = useState(false);
  const [deportistasList, setDeportistasList] = useState<any[]>([]);
  const [asignarForm, setAsignarForm] = useState({ deportista_id: '', plantilla_id: '' });

  const [isProcessing, setIsProcessing] = useState(false);

  const loadEjercicios = useCallback(async () => {
    setIsLoadingEjercicios(true);
    try {
      const res = await entrenamientoService.getEjercicios({
        skip: (pageEjercicios - 1) * 12,
        limit: 12,
        grupo_muscular: grupoFiltro || undefined,
      });
      setEjercicios(res.items);
      setTotalEjercicios(res.total);
    } catch (e) {
      console.error('Error loading exercises', e);
    } finally {
      setIsLoadingEjercicios(false);
    }
  }, [pageEjercicios, grupoFiltro]);

  const loadPlantillas = useCallback(async () => {
    setIsLoadingPlantillas(true);
    try {
      const res = await entrenamientoService.getPlantillas();
      setPlantillas(res.items);
    } catch (e) {
      console.error('Error loading routine templates', e);
    } finally {
      setIsLoadingPlantillas(false);
    }
  }, []);

  useEffect(() => {
    loadEjercicios();
    loadPlantillas();
  }, [loadEjercicios, loadPlantillas]);

  const handleCrearEjercicio = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      await entrenamientoService.crearEjercicio(nuevoEjercicio);
      showToast('success', 'Ejercicio Creado', 'Añadido al catálogo personalizado de tu sede');
      setShowCrearEjercicioModal(false);
      setNuevoEjercicio({
        nombre_es: '',
        grupo_muscular: 'Pecho',
        equipo: 'Mancuernas',
        categoria: 'Fuerza',
        instrucciones: '',
      });
      loadEjercicios();
    } catch (err) {
      showToast('error', 'Error al crear ejercicio', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerPlantilla = async (id: string) => {
    try {
      const data = await entrenamientoService.getPlantilla(id);
      setSelectedPlantilla(data);
    } catch (err) {
      showToast('error', 'Error al cargar plantilla', parseApiError(err));
    }
  };

  const handleOpenAsignar = async (plantillaId: string) => {
    try {
      const depRes = await deportistasService.getDeportistas({ limit: 50 });
      setDeportistasList(depRes.items);
      setAsignarForm({
        deportista_id: depRes.items[0]?.id || '',
        plantilla_id: plantillaId,
      });
      setShowAsignarModal(true);
    } catch {
      showToast('error', 'Error', 'No se pudieron cargar deportistas');
    }
  };

  const handleAsignarSubmit = async () => {
    if (!asignarForm.deportista_id || !asignarForm.plantilla_id) return;
    setIsProcessing(true);
    try {
      await entrenamientoService.asignarRutina({
        deportista_id: asignarForm.deportista_id,
        plantilla_id: asignarForm.plantilla_id,
      });
      showToast('success', 'Rutina Asignada', 'Snapshot inmutable generado para el deportista');
      setShowAsignarModal(false);
    } catch (err) {
      showToast('error', 'Error al asignar rutina', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Entrenamiento y Catálogo de Ejercicios</h1>
          <p className="page-subtitle">
            Catálogo híbrido global y de sede, plantillas de rutinas y snapshots inmutables
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            variant="outline"
            leftIcon={<Plus size={16} />}
            onClick={() => setShowCrearEjercicioModal(true)}
          >
            Nuevo Ejercicio
          </Button>
          <Button
            variant="primary"
            leftIcon={<Layers size={16} />}
            onClick={() => {
              if (ejercicios.length > 0) {
                setNuevaPlantilla({
                  nombre: '',
                  descripcion: '',
                  items: [
                    { ejercicio_id: ejercicios[0].id, orden: 1, series: 4, reps: '10-12', descanso_seg: 90 },
                  ],
                });
              }
              setShowCrearPlantillaModal(true);
            }}
          >
            Nueva Plantilla
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'ejercicios' ? 'active' : ''}`}
          onClick={() => setActiveTab('ejercicios')}
        >
          Catálogo de Ejercicios ({totalEjercicios || ejercicios.length})
        </button>
        <button
          className={`tab-btn ${activeTab === 'plantillas' ? 'active' : ''}`}
          onClick={() => setActiveTab('plantillas')}
        >
          Plantillas de Rutina ({plantillas.length})
        </button>
      </div>

      {activeTab === 'ejercicios' ? (
        <div>
          {/* Muscle group filter toolbar */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Grupo Muscular:
              </span>
              {['', 'Pecho', 'Espalda', 'Piernas', 'Hombros', 'Brazos', 'Core'].map((grp) => (
                <button
                  key={grp}
                  onClick={() => setGrupoFiltro(grp)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border-color)',
                    backgroundColor:
                      grupoFiltro === grp ? 'var(--primary-light)' : 'var(--bg-surface-elevated)',
                    color: grupoFiltro === grp ? 'var(--primary)' : 'var(--text-secondary)',
                    fontWeight: grupoFiltro === grp ? 700 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {grp || 'Todos'}
                </button>
              ))}
            </div>
          </Card>

          {/* Exercises Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
            {ejercicios.map((ej) => (
              <div
                key={ej.id}
                className="card"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Badge variant={ej.propio ? 'primary' : 'neutral'}>
                      {ej.propio ? 'Personalizado' : 'Plataforma Global'}
                    </Badge>
                    <span style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                      {ej.equipo || 'Libre'}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {ej.nombre_es}
                  </h3>

                  <div style={{ fontSize: '0.825rem', color: 'var(--primary)', fontWeight: 600, marginBottom: 8 }}>
                    {ej.grupo_muscular || 'Cuerpo Completo'}
                  </div>

                  {ej.instrucciones && (
                    <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {ej.instrucciones.length > 110 ? `${ej.instrucciones.substring(0, 110)}...` : ej.instrucciones}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {plantillas.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Badge variant="primary">Plantilla v{p.version}</Badge>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {p.total_ejercicios} ejercicios
                  </span>
                </div>

                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {p.nombre}
                </h3>

                {p.descripcion && (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
                    {p.descripcion}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                <Button
                  variant="outline"
                  size="sm"
                  style={{ flex: 1 }}
                  leftIcon={<FileText size={14} />}
                  onClick={() => handleVerPlantilla(p.id)}
                >
                  Ver Ejercicios
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  style={{ flex: 1 }}
                  leftIcon={<UserCheck size={14} />}
                  onClick={() => handleOpenAsignar(p.id)}
                >
                  Asignar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear Ejercicio Propio */}
      <Modal
        isOpen={showCrearEjercicioModal}
        onClose={() => setShowCrearEjercicioModal(false)}
        title="Nuevo Ejercicio de la Sede"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCrearEjercicioModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearEjercicio} isLoading={isProcessing}>
              Guardar Ejercicio
            </Button>
          </>
        }
      >
        <form onSubmit={handleCrearEjercicio}>
          <Input
            label="Nombre del Ejercicio (Español) *"
            placeholder="Ej. Press Militar con Barra"
            value={nuevoEjercicio.nombre_es}
            onChange={(e) => setNuevoEjercicio({ ...nuevoEjercicio, nombre_es: e.target.value })}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Grupo Muscular"
              options={[
                { value: 'Pecho', label: 'Pecho' },
                { value: 'Espalda', label: 'Espalda' },
                { value: 'Piernas', label: 'Piernas' },
                { value: 'Hombros', label: 'Hombros' },
                { value: 'Brazos', label: 'Brazos' },
                { value: 'Core', label: 'Core' },
              ]}
              value={nuevoEjercicio.grupo_muscular}
              onChange={(e) => setNuevoEjercicio({ ...nuevoEjercicio, grupo_muscular: e.target.value })}
            />
            <Input
              label="Equipo Requerido"
              placeholder="Ej. Mancuernas, Polea, Barra..."
              value={nuevoEjercicio.equipo || ''}
              onChange={(e) => setNuevoEjercicio({ ...nuevoEjercicio, equipo: e.target.value })}
            />
          </div>

          <Input
            label="Instrucciones Técnicas"
            placeholder="Paso a paso de la postura y ejecución correcta..."
            value={nuevoEjercicio.instrucciones || ''}
            onChange={(e) => setNuevoEjercicio({ ...nuevoEjercicio, instrucciones: e.target.value })}
          />
        </form>
      </Modal>

      {/* Modal: Ver Ejercicios de la Plantilla */}
      <Modal
        isOpen={!!selectedPlantilla}
        onClose={() => setSelectedPlantilla(null)}
        title={selectedPlantilla ? `Plantilla: ${selectedPlantilla.nombre}` : ''}
        maxWidth="680px"
      >
        {selectedPlantilla && (
          <div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              {selectedPlantilla.descripcion || 'Sin descripción'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {selectedPlantilla.items.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.925rem' }}>
                      {idx + 1}. {item.ejercicio_nombre}
                    </div>
                    <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                      {item.ejercicio_grupo_muscular} · {item.ejercicio_equipo || 'Libre'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, fontSize: '0.85rem' }}>
                    <span>
                      <strong>{item.series || 3}</strong> series
                    </span>
                    <span>
                      <strong>{item.reps || '10-12'}</strong> reps
                    </span>
                    <span>
                      Descanso: <strong>{item.descanso_seg || 60}s</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Asignar Rutina a Deportista */}
      <Modal
        isOpen={showAsignarModal}
        onClose={() => setShowAsignarModal(false)}
        title="Asignar Rutina a Deportista"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAsignarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleAsignarSubmit} isLoading={isProcessing}>
              Generar Rutina Asignada
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Esta acción crea una copia inmutable (snapshot) de los ejercicios en la ficha del deportista.
        </p>

        <Select
          label="Seleccionar Deportista *"
          options={deportistasList.map((d) => ({
            value: d.id,
            label: `${d.nombre} (${d.documento})`,
          }))}
          value={asignarForm.deportista_id}
          onChange={(e) => setAsignarForm({ ...asignarForm, deportista_id: e.target.value })}
        />
      </Modal>
    </div>
  );
};
