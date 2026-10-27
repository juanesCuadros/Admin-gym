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
import { Drawer } from '../../components/ui/Drawer';
import { Table } from '../../components/ui/Table';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { formatDiaSemana, formatFechaHora, formatHora } from '../../utils/formato';

const ESTADO_CLASE: Record<string, string> = { programada: 'Programada', cancelada: 'Cancelada', realizada: 'Realizada' };
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
      showToast('success', 'Cupo reservado', 'Deportista registrado en la lista de la clase');
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
            Agenda, cupos, reservas y asistencia
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<Plus size={16} />}
          onClick={() => setShowProgramarModal(true)}
        >
          Programar clase
        </Button>
      </div>

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

      {/* Modal: Reservar Cupo */}
      <Modal
        isOpen={showReservarModal}
        onClose={() => setShowReservarModal(false)}
        title="Reservar cupo"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowReservarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearReserva} isLoading={isProcessing}>
              Confirmar reserva
            </Button>
          </>
        }
      >
        <Select
          label="Deportista *"
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
