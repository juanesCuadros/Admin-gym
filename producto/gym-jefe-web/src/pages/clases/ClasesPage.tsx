import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Plus,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import { clasesService } from '../../api/clases.service';
import { ReservarCupoModal } from './ReservarCupoModal';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { Table } from '../../components/ui/Table';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { formatCOP, formatDiaSemana, formatFechaHora, formatHora } from '../../utils/formato';

const ESTADO_CLASE: Record<string, string> = { programada: 'Programada', cancelada: 'Cancelada', realizada: 'Realizada' };
import {
  ClaseResponse,
  ProgramarClaseRequest,
  ReservaResponse,
} from '../../types/clases.types';
import type { CatalogoClase } from '../../types/clases.types';

export const ClasesPage: React.FC = () => {
  const { showToast } = useToast();

  const [clases, setClases] = useState<ClaseResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Modals
  const [showProgramarModal, setShowProgramarModal] = useState(false);
  const [formData, setFormData] = useState<ProgramarClaseRequest>({
    nombre: '',
    tipo: 'Spinning',
    profesor_externo: '',
    cupo: 20,
    fecha_hora: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    duracion_minutos: 60,
    omitir_festivos: true,
  });

  // Reservations Modal
  const [selectedClase, setSelectedClase] = useState<ClaseResponse | null>(null);
  const [reservas, setReservas] = useState<ReservaResponse[]>([]);
  const [isLoadingReservas, setIsLoadingReservas] = useState(false);

  // Booking Modal
  const [showReservarModal, setShowReservarModal] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);

  // Catálogo: las clases que ofrece el gimnasio
  const { hasPermission: puede } = useAuth();
  const [pestana, setPestana] = useState<'agenda' | 'catalogo'>('agenda');
  const [catalogo, setCatalogo] = useState<CatalogoClase[]>([]);
  const [formCatalogo, setFormCatalogo] = useState<Partial<CatalogoClase> | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const catalogoActivo = catalogo.filter((c) => c.activo);

  const loadCatalogo = useCallback(async () => {
    try {
      setCatalogo(await clasesService.getCatalogo());
    } catch {
      setCatalogo([]);
    }
  }, []);

  useEffect(() => {
    loadCatalogo();
  }, [loadCatalogo]);

  const guardarCatalogo = async () => {
    if (!formCatalogo) return;
    const nombre = (formCatalogo.nombre ?? '').trim();
    const cupo = Number(formCatalogo.cupo_sugerido);
    const duracion = Number(formCatalogo.duracion_minutos);
    if (nombre.length < 2) return setErrorCatalogo('Escribe el nombre de la clase.');
    if (!(cupo > 0) || !(duracion > 0)) return setErrorCatalogo('El cupo y la duración deben ser mayores a 0.');
    setIsProcessing(true);
    setErrorCatalogo(null);
    const datos = { nombre, descripcion: formCatalogo.descripcion?.trim() || null, cupo_sugerido: cupo, duracion_minutos: duracion };
    try {
      if (formCatalogo.id) {
        await clasesService.actualizarEnCatalogo(formCatalogo.id, { ...datos, activo: formCatalogo.activo ?? true });
      } else {
        await clasesService.crearEnCatalogo(datos);
      }
      showToast('success', 'Catálogo actualizado', nombre);
      setFormCatalogo(null);
      loadCatalogo();
    } catch (err) {
      setErrorCatalogo(parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const cambiarEstadoCatalogo = async (c: CatalogoClase) => {
    try {
      await clasesService.actualizarEnCatalogo(c.id, { ...c, activo: !c.activo });
      loadCatalogo();
    } catch (err) {
      showToast('error', 'No se pudo actualizar la clase', parseApiError(err));
    }
  };

  const elegirDelCatalogo = (id: string) => {
    const c = catalogoActivo.find((x) => x.id === id);
    if (!c) return;
    setFormData((f) => ({ ...f, nombre: c.nombre, tipo: c.nombre, cupo: c.cupo_sugerido, duracion_minutos: c.duracion_minutos }));
  };

  const loadClases = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await clasesService.getClases({ skip: (page - 1) * 10, limit: 10 });
      setClases(res.items);
      setTotal(res.total);
    } catch (e) {
      console.error('Error loading classes', e);
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadClases();
  }, [loadClases]);

  const handleProgramar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      await clasesService.programarClase(formData);
      showToast('success', 'Clase programada', 'Sesión agendada en el calendario');
      setShowProgramarModal(false);
      loadClases();
    } catch (err) {
      showToast('error', 'Error al programar clase', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenReservas = async (clase: ClaseResponse) => {
    setSelectedClase(clase);
    setIsLoadingReservas(true);
    try {
      const data = await clasesService.getReservas(clase.id);
      setReservas(data);
    } catch (err) {
      showToast('error', 'Error', parseApiError(err));
    } finally {
      setIsLoadingReservas(false);
    }
  };

  const handleOpenReservarModal = () => setShowReservarModal(true);

  const handleReservada = (reserva: ReservaResponse) => {
    const cobrado = reserva.total_cobrado != null ? Number(reserva.total_cobrado) : null;
    const cambio = reserva.cambio_devuelto != null ? Number(reserva.cambio_devuelto) : null;
    showToast(
      'success',
      'Cupo reservado',
      cobrado !== null
        ? `Pase cobrado: ${formatCOP(cobrado)}${cambio ? ` · Cambio: ${formatCOP(cambio)}` : ''}`
        : 'Deportista registrado en la lista de la clase'
    );
    setShowReservarModal(false);
    if (selectedClase) handleOpenReservas(selectedClase);
    loadClases();
  };

  const handleRegistrarAsistencia = async (deportistaId: string) => {
    if (!selectedClase) return;
    setIsProcessing(true);
    try {
      await clasesService.registrarAsistencia(selectedClase.id, { deportista_id: deportistaId });
      showToast('success', 'Asistencia marcada', 'Check-in de clase validado');
      handleOpenReservas(selectedClase);
      loadClases();
    } catch (err) {
      showToast('error', 'Error en asistencia', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelarClase = async (id: string) => {
    setIsProcessing(true);
    try {
      await clasesService.cancelarClase(id);
      showToast('info', 'Clase cancelada', 'Cupos y pases pagados liberados');
      loadClases();
      if (selectedClase?.id === id) setSelectedClase(null);
    } catch (err) {
      showToast('error', 'Error al cancelar clase', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clases</h1>
          <p className="page-subtitle">
            {pestana === 'agenda' ? 'Agenda, cupos, reservas y asistencia' : 'Las clases que ofrece el gimnasio'}
          </p>
        </div>

        {pestana === 'agenda' ? (
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setShowProgramarModal(true)}>
            Programar clase
          </Button>
        ) : (
          puede('clases', 'crear') && (
            <Button
              variant="primary"
              leftIcon={<Plus size={16} />}
              onClick={() => {
                setErrorCatalogo(null);
                setFormCatalogo({ nombre: '', descripcion: '', cupo_sugerido: 20, duracion_minutos: 60 });
              }}
            >
              Nueva clase
            </Button>
          )
        )}
      </div>

      <div className="tabs-nav">
        <button className={`tab-btn ${pestana === 'agenda' ? 'active' : ''}`} onClick={() => setPestana('agenda')}>
          Programar
        </button>
        <button className={`tab-btn ${pestana === 'catalogo' ? 'active' : ''}`} onClick={() => setPestana('catalogo')}>
          Catálogo ({catalogoActivo.length})
        </button>
      </div>

      {pestana === 'catalogo' ? (
        catalogo.length === 0 ? (
          <VacioInicial
            titulo="Aún no hay clases en el catálogo"
            descripcion="Crea las clases que ofrece el gimnasio, como Zumba o Spinning, y al programarlas sus datos se llenan solos."
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {catalogo.map((c) => (
              <div key={c.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Badge variant={c.activo ? 'success' : 'neutral'}>{c.activo ? 'Activa' : 'Inactiva'}</Badge>
                  {puede('clases', 'editar') && (
                    <MenuAcciones
                      etiqueta={`Acciones de ${c.nombre}`}
                      acciones={[
                        {
                          etiqueta: 'Editar',
                          onClick: () => {
                            setErrorCatalogo(null);
                            setFormCatalogo(c);
                          },
                        },
                        { etiqueta: c.activo ? 'Desactivar' : 'Activar', onClick: () => cambiarEstadoCatalogo(c) },
                      ]}
                    />
                  )}
                </div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: 6 }}>{c.nombre}</h3>
                {c.descripcion && (
                  <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 12 }}>{c.descripcion}</p>
                )}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {c.cupo_sugerido} cupos · {c.duracion_minutos} minutos
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <>

      {/* Classes Table */}
      <Card>
        <Table<ClaseResponse>
          columns={[
            {
              header: 'Fecha y hora',
              render: (c) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{formatDiaSemana(c.fecha_hora)}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{formatHora(c.fecha_hora)}</div>
                </div>
              ),
              width: '140px',
            },
            {
              header: 'Clase',
              render: (c) => (
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{c.nombre}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {c.tipo || 'General'}
                  </div>
                </div>
              ),
            },
            {
              header: 'Instructor',
              accessor: (c) => c.entrenador_nombre || c.profesor_externo || 'Sin asignar',
            },
            {
              header: 'Cupos',
              render: (c) =>
                c.cupos_disponibles > 0 ? (
                  <div>
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {c.reservas_totales} / {c.cupo}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                      {c.cupos_disponibles} {c.cupos_disponibles === 1 ? 'libre' : 'libres'}
                    </div>
                  </div>
                ) : (
                  <Badge variant="danger">Lleno · {c.cupo}</Badge>
                ),
              width: '120px',
            },
            {
              header: 'Estado',
              render: (c) => (
                <Badge variant={c.estado === 'programada' ? 'success' : c.estado === 'cancelada' ? 'danger' : 'neutral'}>
                  {ESTADO_CLASE[c.estado] ?? c.estado}
                </Badge>
              ),
              width: '120px',
            },
            {
              header: '',
              align: 'right',
              width: '170px',
              render: (c) => (
                <div className="acciones-fila">
                  <Button variant="secondary" size="sm" leftIcon={<Users size={14} />} onClick={() => handleOpenReservas(c)}>
                    Reservas ({c.reservas_totales})
                  </Button>
                  <MenuAcciones
                    etiqueta={`Acciones de ${c.nombre}`}
                    acciones={[
                      {
                        etiqueta: 'Cancelar clase',
                        icono: <XCircle size={15} />,
                        peligro: true,
                        oculto: c.estado !== 'programada',
                        onClick: () => handleCancelarClase(c.id),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
          data={clases}
          isLoading={isLoading}
          keyExtractor={(c) => c.id}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil(total / 10) || 1,
            onPageChange: (p) => setPage(p),
          }}
          emptyMessage="No hay clases programadas"
        />
      </Card>

        </>
      )}

      <Modal
        isOpen={!!formCatalogo}
        onClose={() => setFormCatalogo(null)}
        title={formCatalogo?.id ? 'Editar clase' : 'Nueva clase'}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormCatalogo(null)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardarCatalogo} isLoading={isProcessing}>
              Guardar
            </Button>
          </>
        }
      >
        {formCatalogo && (
          <>
            <Input
              label="Nombre *"
              placeholder="Ej. Zumba"
              value={formCatalogo.nombre ?? ''}
              maxLength={100}
              onChange={(e) => setFormCatalogo({ ...formCatalogo, nombre: e.target.value })}
            />
            <Input
              label="Descripción"
              value={formCatalogo.descripcion ?? ''}
              maxLength={300}
              onChange={(e) => setFormCatalogo({ ...formCatalogo, descripcion: e.target.value })}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input
                label="Cupo sugerido *"
                type="number"
                min={1}
                value={String(formCatalogo.cupo_sugerido ?? '')}
                onChange={(e) => setFormCatalogo({ ...formCatalogo, cupo_sugerido: Number(e.target.value) })}
              />
              <Input
                label="Duración (minutos) *"
                type="number"
                min={1}
                value={String(formCatalogo.duracion_minutos ?? '')}
                onChange={(e) => setFormCatalogo({ ...formCatalogo, duracion_minutos: Number(e.target.value) })}
              />
            </div>
            {errorCatalogo && <MensajeFijo tono="error">{errorCatalogo}</MensajeFijo>}
          </>
        )}
      </Modal>

      {/* Modal: Programar Clase */}
      <Drawer
        isOpen={showProgramarModal}
        onClose={() => setShowProgramarModal(false)}
        title="Programar clase"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowProgramarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleProgramar} isLoading={isProcessing}>
              Guardar clase
            </Button>
          </>
        }
      >
        <form onSubmit={handleProgramar}>
          {catalogoActivo.length > 0 && (
            <Select
              label="Clase del catálogo"
              value=""
              onChange={(e) => elegirDelCatalogo(e.target.value)}
              options={[
                { value: '', label: 'Elige para llenar los datos' },
                ...catalogoActivo.map((c) => ({ value: c.id, label: c.nombre })),
              ]}
            />
          )}
          <Input
            label="Nombre de la clase *"
            placeholder="Ej. Spinning de la mañana"
            value={formData.nombre}
            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Disciplina"
              options={
                catalogoActivo.length > 0
                  ? catalogoActivo.map((c) => ({ value: c.nombre, label: c.nombre }))
                  : [
                      { value: 'Spinning', label: 'Spinning' },
                      { value: 'Yoga', label: 'Yoga' },
                      { value: 'Crossfit', label: 'Crossfit' },
                      { value: 'Pilates', label: 'Pilates' },
                      { value: 'Funcional', label: 'Funcional' },
                      { value: 'Zumba', label: 'Zumba' },
                    ]
              }
              value={formData.tipo}
              onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
            />
            <Input
              label="Instructor *"
              placeholder="Nombre del instructor..."
              value={formData.profesor_externo || ''}
              onChange={(e) => setFormData({ ...formData, profesor_externo: e.target.value })}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Fecha y hora de inicio *"
              type="datetime-local"
              value={formData.fecha_hora}
              onChange={(e) => setFormData({ ...formData, fecha_hora: e.target.value })}
              required
            />
            <Input
              label="Cupo máximo *"
              type="number"
              value={formData.cupo}
              onChange={(e) => setFormData({ ...formData, cupo: Number(e.target.value) })}
              required
            />
          </div>

          {/* Omitir Festivos */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 10,
            }}
          >
            <input
              type="checkbox"
              id="omitir_festivos"
              checked={formData.omitir_festivos}
              onChange={(e) => setFormData({ ...formData, omitir_festivos: e.target.checked })}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="omitir_festivos" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
              <strong>Omitir festivos:</strong> si una sesión recurrente cae en un festivo de Colombia, no se programa.
            </label>
          </div>
        </form>
      </Drawer>

      {/* Modal: Reservas de la Clase */}
      <Drawer
        isOpen={!!selectedClase}
        onClose={() => setSelectedClase(null)}
        title={selectedClase ? `Reservas: ${selectedClase.nombre}` : ''}
        size="lg"
        footer={
          <Button
            variant="primary"
            leftIcon={<UserCheck size={16} />}
            onClick={handleOpenReservarModal}
            disabled={selectedClase?.cupos_disponibles === 0}
          >
            Reservar cupo
          </Button>
        }
      >
        {selectedClase && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-elevated)',
                marginBottom: 16,
                fontSize: '0.85rem',
              }}
            >
              <span>
                Fecha: <strong>{formatFechaHora(selectedClase.fecha_hora)}</strong>
              </span>
              <span>
                Cupos:{' '}
                <strong>
                  {selectedClase.reservas_totales} / {selectedClase.cupo}
                </strong>
              </span>
            </div>

            <Table<ReservaResponse>
              columns={[
                {
                  header: 'Deportista',
                  render: (r) => (
                    <div>
                      <div style={{ fontWeight: 500 }}>{r.deportista_nombre}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Doc: {r.deportista_documento}
                      </div>
                    </div>
                  ),
                },
                {
                  header: 'Modalidad',
                  render: (r) => (
                    <Badge variant={r.pase_pagado ? 'info' : 'success'}>
                      {r.pase_pagado ? 'Pase de clase' : 'Membresía activa'}
                    </Badge>
                  ),
                },
                {
                  header: 'Estado',
                  render: (r) => (
                    <Badge
                      variant={
                        r.estado === 'asistio'
                          ? 'success'
                          : r.estado === 'reservada'
                          ? 'neutral'
                          : 'danger'
                      }
                    >
                      {r.estado}
                    </Badge>
                  ),
                },
                {
                  header: 'Asistencia',
                  align: 'right',
                  render: (r) => (
                    <div>
                      {r.estado === 'reservada' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<CheckCircle2 size={14} />}
                          onClick={() => handleRegistrarAsistencia(r.deportista_id)}
                          isLoading={isProcessing}
                        >
                          Marcar asistencia
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              data={reservas}
              isLoading={isLoadingReservas}
              keyExtractor={(r) => r.id}
              emptyMessage="No hay reservas realizadas para esta sesión"
            />
          </div>
        )}
      </Drawer>

      {/* Modal: Reservar Cupo (cobra el pase de clase en el mismo paso si hace falta) */}
      <ReservarCupoModal
        clase={selectedClase}
        isOpen={showReservarModal}
        onClose={() => setShowReservarModal(false)}
        onReservada={handleReservada}
      />
    </div>
  );
};
