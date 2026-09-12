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
  ClaseResponse,
  ProgramarClaseRequest,
  ReservaResponse,
} from '../../types/clases.types';

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
    profesor_externo: 'Instructor Staff',
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
  const [deportistasList, setDeportistasList] = useState<any[]>([]);
  const [selectedDeportistaId, setSelectedDeportistaId] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);

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
      showToast('success', 'Clase Programada', 'Sesión agendada en el calendario');
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

  const handleOpenReservarModal = async () => {
    try {
      const depRes = await deportistasService.getDeportistas({ limit: 50 });
      setDeportistasList(depRes.items);
      setSelectedDeportistaId(depRes.items[0]?.id || '');
      setShowReservarModal(true);
    } catch {
      showToast('error', 'Error', 'No se pudieron cargar los deportistas');
    }
  };

  const handleCrearReserva = async () => {
    if (!selectedClase || !selectedDeportistaId) return;
    setIsProcessing(true);
    try {
      await clasesService.crearReserva(selectedClase.id, {
        deportista_id: selectedDeportistaId,
      });
      showToast('success', 'Cupo Reservado', 'Deportista registrado en la lista de la clase');
      setShowReservarModal(false);
      handleOpenReservas(selectedClase);
      loadClases();
    } catch (err) {
      showToast('error', 'Error al reservar', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegistrarAsistencia = async (deportistaId: string) => {
    if (!selectedClase) return;
    setIsProcessing(true);
    try {
      await clasesService.registrarAsistencia(selectedClase.id, { deportista_id: deportistaId });
      showToast('success', 'Asistencia Marcada', 'Check-in de clase validado');
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
      showToast('info', 'Clase Cancelada', 'Cupos y pases pagados liberados');
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
          <h1 className="page-title">Programación de Clases y Reservas</h1>
          <p className="page-subtitle">
            Horarios grupales, gestión de aforo, omisión de festivos, reservas con pases y check-in de asistencia
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<Plus size={16} />}
          onClick={() => setShowProgramarModal(true)}
        >
          Programar Clase
        </Button>
      </div>

      {/* Classes Table */}
      <Card>
        <Table<ClaseResponse>
          columns={[
            {
              header: 'Fecha y Hora',
              render: (c) => (
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {new Date(c.fecha_hora).toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(c.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ),
              width: '140px',
            },
            {
              header: 'Clase / Disciplina',
              render: (c) => (
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.nombre}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                    {c.tipo || 'General'}
                  </div>
                </div>
              ),
            },
            {
              header: 'Profesor / Instructor',
              accessor: (c) => c.entrenador_nombre || c.profesor_externo || 'Staff',
            },
            {
              header: 'Aforo y Cupos',
              render: (c) => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                    <Users size={14} color="var(--text-muted)" />
                    <span>
                      {c.reservas_totales} / {c.cupo} reservados
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: c.cupos_disponibles > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {c.cupos_disponibles} disponibles
                  </div>
                </div>
              ),
              width: '160px',
            },
            {
              header: 'Estado',
              render: (c) => (
                <Badge variant={c.estado === 'programada' ? 'success' : 'danger'}>
                  {c.estado}
                </Badge>
              ),
              width: '120px',
            },
            {
              header: 'Acciones',
              align: 'right',
              render: (c) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Users size={14} />}
                    onClick={() => handleOpenReservas(c)}
                  >
                    Ver Reservas ({c.reservas_totales})
                  </Button>
                  {c.estado === 'programada' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<XCircle size={14} color="var(--danger)" />}
                      onClick={() => handleCancelarClase(c.id)}
                    >
                      Cancelar
                    </Button>
                  )}
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

      {/* Modal: Programar Clase */}
      <Modal
        isOpen={showProgramarModal}
        onClose={() => setShowProgramarModal(false)}
        title="Programar Nueva Clase"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowProgramarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleProgramar} isLoading={isProcessing}>
              Guardar Clase
            </Button>
          </>
        }
      >
        <form onSubmit={handleProgramar}>
          <Input
            label="Nombre de la Clase *"
            placeholder="Ej. Spinning Matutino 7:00 AM"
            value={formData.nombre}
            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Disciplina"
              options={[
                { value: 'Spinning', label: 'Spinning' },
                { value: 'Yoga', label: 'Yoga' },
                { value: 'Crossfit', label: 'Crossfit' },
                { value: 'Pilates', label: 'Pilates' },
                { value: 'Funcional', label: 'Funcional' },
                { value: 'Zumba', label: 'Zumba' },
              ]}
              value={formData.tipo}
              onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
            />
            <Input
              label="Profesor / Instructor *"
              placeholder="Nombre del instructor..."
              value={formData.profesor_externo || ''}
              onChange={(e) => setFormData({ ...formData, profesor_externo: e.target.value })}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Fecha y Hora de Inicio *"
              type="datetime-local"
              value={formData.fecha_hora}
              onChange={(e) => setFormData({ ...formData, fecha_hora: e.target.value })}
              required
            />
            <Input
              label="Cupo Máximo *"
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
              <strong>Omisión Automática de Días Festivos:</strong> Si una sesión recurrente coincide con un festivo oficial de Colombia, se omite automáticamente (RF-32).
            </label>
          </div>
        </form>
      </Modal>

      {/* Modal: Reservas de la Clase */}
      <Modal
        isOpen={!!selectedClase}
        onClose={() => setSelectedClase(null)}
        title={selectedClase ? `Reservas: ${selectedClase.nombre}` : ''}
        maxWidth="720px"
        footer={
          <Button
            variant="primary"
            leftIcon={<UserCheck size={16} />}
            onClick={handleOpenReservarModal}
            disabled={selectedClase?.cupos_disponibles === 0}
          >
            Reservar Cupo a Deportista
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
                Fecha: <strong>{new Date(selectedClase.fecha_hora).toLocaleString()}</strong>
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
                      <div style={{ fontWeight: 700 }}>{r.deportista_nombre}</div>
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
                      {r.pase_pagado ? 'Pase de Clase' : 'Membresía Activa'}
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
                          leftIcon={<CheckCircle2 size={14} color="var(--success)" />}
                          onClick={() => handleRegistrarAsistencia(r.deportista_id)}
                          isLoading={isProcessing}
                        >
                          Marcar Asistencia
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
      </Modal>

      {/* Modal: Reservar Cupo */}
      <Modal
        isOpen={showReservarModal}
        onClose={() => setShowReservarModal(false)}
        title="Inscribir Deportista en la Clase"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowReservarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearReserva} isLoading={isProcessing}>
              Confirmar Reserva
            </Button>
          </>
        }
      >
        <Select
          label="Seleccionar Deportista *"
          options={deportistasList.map((d) => ({
            value: d.id,
            label: `${d.nombre} (${d.documento})`,
          }))}
          value={selectedDeportistaId}
          onChange={(e) => setSelectedDeportistaId(e.target.value)}
        />
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
          Si el deportista no cuenta con membresía activa, el sistema valida que posea un pase de clase emitido en Caja.
        </p>
      </Modal>
    </div>
  );
};
