import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardList, Archive, RotateCcw, Plus } from 'lucide-react';
import { entrenamientoService } from '../../api/entrenamiento.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { BuscadorDeportista } from '../../components/ui/BuscadorDeportista';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { formatFechaHora } from '../../utils/formato';
import type { DeportistaBusquedaItem } from '../../types/comun.types';
import type { RutinaAsignadaResponse, RutinaPlantillaListItemResponse } from '../../types/entrenamiento.types';

/** Detalle de los ejercicios de una rutina asignada (copia congelada, GW-RF-30). */
const DetalleRutina: React.FC<{ rutina: RutinaAsignadaResponse }> = ({ rutina }) => (
  <div className="table-responsive" style={{ marginTop: 12 }}>
    <table className="table-base">
      <thead>
        <tr>
          <th>#</th>
          <th>Ejercicio</th>
          <th style={{ textAlign: 'right' }}>Series</th>
          <th>Repeticiones</th>
          <th>Carga</th>
          <th style={{ textAlign: 'right' }}>Descanso</th>
        </tr>
      </thead>
      <tbody>
        {[...rutina.items]
          .sort((a, b) => a.orden - b.orden)
          .map((it, i) => (
            <tr key={it.id}>
              <td>{i + 1}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{it.ejercicio_nombre}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {[it.ejercicio_grupo_muscular, it.ejercicio_equipo].filter(Boolean).join(' · ')}
                  {!it.ejercicio_activo_en_gym && ' · Desactivado en el gimnasio (sin imagen)'}
                </div>
              </td>
              <td style={{ textAlign: 'right' }}>{it.series ?? '—'}</td>
              <td>{it.reps || '—'}</td>
              <td>{it.peso_sugerido || '—'}</td>
              <td style={{ textAlign: 'right' }}>{it.descanso_seg !== null && it.descanso_seg !== undefined ? `${it.descanso_seg} s` : '—'}</td>
            </tr>
          ))}
      </tbody>
    </table>
  </div>
);

/**
 * Entrenamiento · Rutinas asignadas (GW-RF-30, GW-RF-31).
 * El backend solo lista rutinas por deportista (`GET /entrenamiento/deportistas/{id}/rutinas`):
 * no hay listado general del gimnasio, así que se elige primero el deportista.
 */
export const RutinasAsignadasPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeAsignar = hasPermission('entrenamiento', 'crear');
  const puedeEditar = hasPermission('entrenamiento', 'editar');

  const [deportista, setDeportista] = useState<DeportistaBusquedaItem | null>(null);
  const [soloActivas, setSoloActivas] = useState(false);
  const [rutinas, setRutinas] = useState<RutinaAsignadaResponse[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

  const cargar = useCallback(async () => {
    if (!deportista) return;
    setCargando(true);
    try {
      const r = await entrenamientoService.getRutinasDeportista(deportista.id, soloActivas);
      setRutinas([...r].sort((a, b) => (a.asignada_en < b.asignada_en ? 1 : -1)));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [deportista, soloActivas]);

  useEffect(() => {
    setRutinas([]);
    setAbiertas({});
    cargar();
  }, [cargar]);

  // Archivar / reactivar
  const [aArchivar, setAArchivar] = useState<RutinaAsignadaResponse | null>(null);
  const [procesando, setProcesando] = useState(false);

  const cambiarEstado = async (r: RutinaAsignadaResponse, activa: boolean) => {
    setProcesando(true);
    try {
      await entrenamientoService.cambiarEstadoRutina(r.id, activa);
      showToast('success', activa ? 'Rutina reactivada' : 'Rutina archivada', r.nombre);
      setAArchivar(null);
      cargar();
    } catch (e) {
      showToast('error', 'No se pudo cambiar la rutina', toApiError(e).message);
    } finally {
      setProcesando(false);
    }
  };

  // Asignar desde plantilla
  const [asignarAbierto, setAsignarAbierto] = useState(false);
  const [plantillas, setPlantillas] = useState<RutinaPlantillaListItemResponse[]>([]);
  const [cargandoPlantillas, setCargandoPlantillas] = useState(false);
  const [plantillaId, setPlantillaId] = useState('');
  const [nombre, setNombre] = useState('');
  const [errorAsignar, setErrorAsignar] = useState<ApiError | null>(null);

  const abrirAsignar = async () => {
    setAsignarAbierto(true);
    setErrorAsignar(null);
    setPlantillaId('');
    setNombre('');
    setCargandoPlantillas(true);
    try {
      const res = await entrenamientoService.getPlantillas({ skip: 0, limit: 100 });
      setPlantillas(res.items);
    } catch (e) {
      setErrorAsignar(toApiError(e));
    } finally {
      setCargandoPlantillas(false);
    }
  };

  const errorNombre = nombre.trim() && (nombre.trim().length < 2 || nombre.trim().length > 150) ? 'Entre 2 y 150 caracteres.' : null;

  const asignar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deportista || !plantillaId || errorNombre || procesando) return;
    setProcesando(true);
    setErrorAsignar(null);
    try {
      const r = await entrenamientoService.asignarRutina({
        deportista_id: deportista.id,
        plantilla_id: plantillaId,
        nombre: nombre.trim() || undefined,
      });
      showToast('success', 'Rutina asignada', `${r.nombre} para ${deportista.nombre}`);
      setAsignarAbierto(false);
      cargar();
    } catch (err) {
      setErrorAsignar(toApiError(err));
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rutinas asignadas</h1>
          <p className="page-subtitle">
            Rutinas de cada deportista. Son una copia de la plantilla: editar la plantilla no las cambia.
          </p>
        </div>
        {puedeAsignar && deportista && (
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={abrirAsignar}>
            Asignar rutina
          </Button>
        )}
      </div>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280, maxWidth: 480 }}>
            <BuscadorDeportista label="Deportista" seleccionado={deportista} onSeleccionar={setDeportista} />
          </div>
          {deportista && (
            <label className="form-group" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)} />
              Solo activas
            </label>
          )}
        </div>
      </Card>

      {!deportista ? (
        <VacioInicial
          icono={<ClipboardList size={40} />}
          titulo="Elige un deportista"
          descripcion="Busca por nombre o documento para ver sus rutinas, archivarlas o asignarle una nueva desde una plantilla."
        />
      ) : cargando && rutinas.length === 0 ? (
        <Cargando filas={4} />
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} textoNoEncontrado="El deportista no existe o ya no está disponible." />
      ) : rutinas.length === 0 ? (
        <VacioInicial
          titulo={soloActivas ? 'No tiene rutinas activas' : 'Aún no tiene rutinas'}
          descripcion={
            soloActivas
              ? 'Quita el filtro "Solo activas" para ver las archivadas.'
              : `${deportista.nombre} no tiene rutinas asignadas.`
          }
          textoAccion={puedeAsignar && !soloActivas ? 'Asignar rutina' : undefined}
          onAccion={puedeAsignar && !soloActivas ? abrirAsignar : undefined}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rutinas.map((r) => {
            const abierta = !!abiertas[r.id];
            return (
              <Card key={r.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{r.nombre}</span>
                      <Badge variant={r.activa ? 'success' : 'neutral'}>{r.activa ? 'Activa' : 'Archivada'}</Badge>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      Asignada el {formatFechaHora(r.asignada_en)}
                      {r.entrenador_nombre ? ` por ${r.entrenador_nombre}` : ''} · {r.items.length}{' '}
                      {r.items.length === 1 ? 'ejercicio' : 'ejercicios'}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={abierta ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    onClick={() => setAbiertas((a) => ({ ...a, [r.id]: !abierta }))}
                    aria-expanded={abierta}
                  >
                    {abierta ? 'Ocultar' : 'Ver ejercicios'}
                  </Button>
                  {puedeEditar &&
                    (r.activa ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Archive size={14} color="var(--danger)" />}
                        onClick={() => setAArchivar(r)}
                      >
                        Archivar
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<RotateCcw size={14} />}
                        disabled={procesando}
                        onClick={() => cambiarEstado(r, true)}
                      >
                        Reactivar
                      </Button>
                    ))}
                </div>
                {abierta && <DetalleRutina rutina={r} />}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={aArchivar !== null}
        onClose={() => setAArchivar(null)}
        onConfirm={() => aArchivar && cambiarEstado(aArchivar, false)}
        title="Archivar rutina"
        message={`"${aArchivar?.nombre ?? ''}" dejará de estar activa para ${deportista?.nombre ?? 'el deportista'}. Se conserva en su historial y puedes reactivarla.`}
        confirmText="Archivar"
        isDestructive
        isLoading={procesando}
      />

      <Modal
        isOpen={asignarAbierto}
        onClose={() => !procesando && setAsignarAbierto(false)}
        title={`Asignar rutina a ${deportista?.nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAsignarAbierto(false)} disabled={procesando}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="form-asignar-rutina" isLoading={procesando} disabled={!plantillaId}>
              Asignar
            </Button>
          </>
        }
      >
        <form id="form-asignar-rutina" onSubmit={asignar} noValidate>
          {errorAsignar && (
            <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
              {errorAsignar.message}
            </MensajeFijo>
          )}
          {cargandoPlantillas ? (
            <Cargando filas={2} alto={36} />
          ) : plantillas.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              No hay plantillas. Créalas primero en Entrenamiento · Plantillas.
            </p>
          ) : (
            <>
              <Select
                label="Plantilla"
                value={plantillaId}
                onChange={(e) => setPlantillaId(e.target.value)}
                options={[
                  { value: '', label: 'Selecciona una plantilla' },
                  ...plantillas.map((p) => ({
                    value: p.id,
                    label: `${p.nombre} · ${p.total_ejercicios} ${p.total_ejercicios === 1 ? 'ejercicio' : 'ejercicios'}`,
                  })),
                ]}
                disabled={procesando}
              />
              <Input
                label="Nombre de la rutina (opcional)"
                placeholder="Por defecto, el de la plantilla"
                value={nombre}
                maxLength={150}
                onChange={(e) => setNombre(e.target.value)}
                error={errorNombre ?? errorAsignar?.campos.nombre}
                disabled={procesando}
              />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                Se copia la plantilla tal como está hoy. Cambios posteriores en la plantilla no afectan esta rutina.
              </p>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
};
