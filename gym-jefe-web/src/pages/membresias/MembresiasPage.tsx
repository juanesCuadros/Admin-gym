import React, { useState, useEffect, useCallback } from 'react';
import {
  Award,
  Plus,
  Snowflake,
  Sun,
  RefreshCw,
  XCircle,
  Clock,
  DollarSign,
  UserCheck,
} from 'lucide-react';
import { membresiasService } from '../../api/membresias.service';
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
  PlanResponse,
  MembresiaListItemResponse,
  CrearPlanRequest,
} from '../../types/membresias.types';

export const MembresiasPage: React.FC = () => {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'membresias' | 'planes'>('membresias');

  // Membresias state
  const [membresias, setMembresias] = useState<MembresiaListItemResponse[]>([]);
  const [totalMembresias, setTotalMembresias] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoadingMembresias, setIsLoadingMembresias] = useState(false);

  // Planes state
  const [planes, setPlanes] = useState<PlanResponse[]>([]);
  const [isLoadingPlanes, setIsLoadingPlanes] = useState(false);

  // Modals
  const [showCrearPlanModal, setShowCrearPlanModal] = useState(false);
  const [newPlan, setNewPlan] = useState<CrearPlanRequest>({
    nombre: '',
    precio: 90000,
    duracion_dias: 30,
    tipo: 'individual',
    cupo_personas: 1,
  });

  const [showAsignarModal, setShowAsignarModal] = useState(false);
  const [asignarData, setAsignarData] = useState({ deportista_id: '', plan_id: '' });
  const [deportistasList, setDeportistasList] = useState<any[]>([]);

  // Action Modals
  const [selectedMembresiaId, setSelectedMembresiaId] = useState<string | null>(null);
  const [showCongelarModal, setShowCongelarModal] = useState(false);
  const [motivoCongelar, setMotivoCongelar] = useState('');

  const [showCambiarPlanModal, setShowCambiarPlanModal] = useState(false);
  const [nuevoPlanId, setNuevoPlanId] = useState('');

  const [showCancelarModal, setShowCancelarModal] = useState(false);
  const [motivoCancelar, setMotivoCancelar] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);

  const loadPlanes = useCallback(async () => {
    setIsLoadingPlanes(true);
    try {
      const res = await membresiasService.getPlanes();
      setPlanes(res.items);
    } catch (e) {
      console.error('Error loading planes', e);
    } finally {
      setIsLoadingPlanes(false);
    }
  }, []);

  const loadMembresias = useCallback(async () => {
    setIsLoadingMembresias(true);
    try {
      const res = await membresiasService.getMembresias({ skip: (page - 1) * 10, limit: 10 });
      setMembresias(res.items);
      setTotalMembresias(res.total);
    } catch (e) {
      console.error('Error loading membresias', e);
    } finally {
      setIsLoadingMembresias(false);
    }
  }, [page]);

  useEffect(() => {
    loadPlanes();
    loadMembresias();
  }, [loadPlanes, loadMembresias]);

  const handleCrearPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      await membresiasService.crearPlan(newPlan);
      showToast('success', 'Plan Creado', 'Nuevo plan tarifario agregado al catálogo');
      setShowCrearPlanModal(false);
      setNewPlan({ nombre: '', precio: 90000, duracion_dias: 30, tipo: 'individual', cupo_personas: 1 });
      loadPlanes();
    } catch (err) {
      showToast('error', 'Error al crear plan', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenAsignar = async () => {
    try {
      const depRes = await deportistasService.getDeportistas({ limit: 50 });
      setDeportistasList(depRes.items);
      if (planes.length > 0) {
        setAsignarData({
          deportista_id: depRes.items[0]?.id || '',
          plan_id: planes[0]?.id || '',
        });
      }
      setShowAsignarModal(true);
    } catch (e) {
      showToast('error', 'Error', 'No se pudieron cargar los deportistas');
    }
  };

  const handleAsignarSubmit = async () => {
    if (!asignarData.deportista_id || !asignarData.plan_id) return;
    setIsProcessing(true);
    try {
      await membresiasService.asignarPlan({
        deportista_id: asignarData.deportista_id,
        plan_id: asignarData.plan_id,
      });
      showToast('success', 'Membresía Asignada', 'El deportista ya cuenta con plan activo');
      setShowAsignarModal(false);
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al asignar plan', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCongelar = async () => {
    if (!selectedMembresiaId) return;
    setIsProcessing(true);
    try {
      await membresiasService.congelarMembresia(selectedMembresiaId, { motivo: motivoCongelar });
      showToast('success', 'Membresía Congelada', 'El periodo de vigencia se encuentra pausado');
      setShowCongelarModal(false);
      setSelectedMembresiaId(null);
      setMotivoCongelar('');
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al congelar', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDescongelar = async (id: string) => {
    setIsProcessing(true);
    try {
      await membresiasService.descongelarMembresia(id);
      showToast('success', 'Membresía Descongelada', 'Vencimiento recalculado con los días correspondientes');
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al descongelar', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCambiarPlan = async () => {
    if (!selectedMembresiaId || !nuevoPlanId) return;
    setIsProcessing(true);
    try {
      await membresiasService.cambiarPlan(selectedMembresiaId, { nuevo_plan_id: nuevoPlanId });
      showToast('success', 'Plan Cambiado', 'Membresía actualizada con nuevo plan');
      setShowCambiarPlanModal(false);
      setSelectedMembresiaId(null);
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al cambiar plan', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelarMembresia = async () => {
    if (!selectedMembresiaId || !motivoCancelar) return;
    setIsProcessing(true);
    try {
      await membresiasService.cancelarMembresia(selectedMembresiaId, { motivo: motivoCancelar });
      showToast('info', 'Membresía Cancelada', 'Membresía dada de baja');
      setShowCancelarModal(false);
      setSelectedMembresiaId(null);
      setMotivoCancelar('');
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al cancelar membresía', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Membresías y Catálogo de Planes</h1>
          <p className="page-subtitle">
            Ciclo de vida, asignación de planes, congelamientos con recálculo automático y cancelaciones
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            variant="outline"
            leftIcon={<UserCheck size={16} />}
            onClick={handleOpenAsignar}
          >
            Asignar a Deportista
          </Button>
          <Button
            variant="primary"
            leftIcon={<Plus size={16} />}
            onClick={() => setShowCrearPlanModal(true)}
          >
            Nuevo Plan
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'membresias' ? 'active' : ''}`}
          onClick={() => setActiveTab('membresias')}
        >
          Membresías Activas
        </button>
        <button
          className={`tab-btn ${activeTab === 'planes' ? 'active' : ''}`}
          onClick={() => setActiveTab('planes')}
        >
          Catálogo de Planes ({planes.length})
        </button>
      </div>

      {activeTab === 'membresias' ? (
        <Card>
          <Table<MembresiaListItemResponse>
            columns={[
              {
                header: 'Deportista',
                render: (m) => (
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{m.deportista_nombre}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Doc: {m.deportista_documento}
                    </div>
                  </div>
                ),
              },
              {
                header: 'Plan',
                accessor: 'plan_nombre',
              },
              {
                header: 'Vigencia',
                render: (m) => (
                  <div style={{ fontSize: '0.85rem' }}>
                    <div>Inicio: {m.fecha_inicio}</div>
                    <div style={{ fontWeight: 600 }}>Vence: {m.fecha_vencimiento}</div>
                  </div>
                ),
              },
              {
                header: 'Días Restantes',
                render: (m) => (
                  <span
                    style={{
                      fontWeight: 800,
                      color:
                        m.dias_restantes_o_vencido > 5
                          ? 'var(--success)'
                          : m.dias_restantes_o_vencido > 0
                          ? 'var(--warning)'
                          : 'var(--danger)',
                    }}
                  >
                    {m.dias_restantes_o_vencido > 0 ? `${m.dias_restantes_o_vencido} días` : 'Vencida'}
                  </span>
                ),
              },
              {
                header: 'Estado',
                render: (m) => (
                  <Badge variant={m.congelamiento_activo ? 'info' : m.cancelada ? 'danger' : 'success'}>
                    {m.congelamiento_activo ? 'Congelada' : m.cancelada ? 'Cancelada' : m.estado_calculado}
                  </Badge>
                ),
              },
              {
                header: 'Acciones',
                align: 'right',
                render: (m) => (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {m.congelamiento_activo ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<Sun size={14} color="var(--warning)" />}
                        onClick={() => handleDescongelar(m.id)}
                      >
                        Descongelar
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Snowflake size={14} color="var(--info)" />}
                        onClick={() => {
                          setSelectedMembresiaId(m.id);
                          setShowCongelarModal(true);
                        }}
                      >
                        Congelar
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<RefreshCw size={14} />}
                      onClick={() => {
                        setSelectedMembresiaId(m.id);
                        setNuevoPlanId(planes[0]?.id || '');
                        setShowCambiarPlanModal(true);
                      }}
                    >
                      Cambiar Plan
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<XCircle size={14} color="var(--danger)" />}
                      onClick={() => {
                        setSelectedMembresiaId(m.id);
                        setShowCancelarModal(true);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                ),
              },
            ]}
            data={membresias}
            isLoading={isLoadingMembresias}
            keyExtractor={(m) => m.id}
            pagination={{
              currentPage: page,
              totalPages: Math.ceil(totalMembresias / 10) || 1,
              onPageChange: (p) => setPage(p),
            }}
            emptyMessage="No hay membresías registradas"
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {planes.map((plan) => (
            <div
              key={plan.id}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Badge variant={plan.activo ? 'success' : 'neutral'}>
                    {plan.activo ? 'Activo' : 'Inactivo'}
                  </Badge>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {plan.tipo}
                  </span>
                </div>

                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {plan.nombre}
                </h3>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '14px 0' }}>
                  <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--primary)' }}>
                    ${Number(plan.precio).toLocaleString()}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    / {plan.duracion_dias} días
                  </span>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} /> Cupo: {plan.cupo_personas} persona(s)
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear Plan */}
      <Modal
        isOpen={showCrearPlanModal}
        onClose={() => setShowCrearPlanModal(false)}
        title="Crear Nuevo Plan Tarifario"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCrearPlanModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearPlan} isLoading={isProcessing}>
              Guardar Plan
            </Button>
          </>
        }
      >
        <form onSubmit={handleCrearPlan}>
          <Input
            label="Nombre del Plan *"
            placeholder="Ej. Mensualidad Estándar"
            value={newPlan.nombre}
            onChange={(e) => setNewPlan({ ...newPlan, nombre: e.target.value })}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Precio ($ COP) *"
              type="number"
              value={newPlan.precio}
              onChange={(e) => setNewPlan({ ...newPlan, precio: Number(e.target.value) })}
              required
            />
            <Input
              label="Duración en Días *"
              type="number"
              value={newPlan.duracion_dias}
              onChange={(e) => setNewPlan({ ...newPlan, duracion_dias: Number(e.target.value) })}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Modalidad"
              options={[
                { value: 'individual', label: 'Individual (1 persona)' },
                { value: 'pareja', label: 'Pareja (2 personas)' },
                { value: 'familiar', label: 'Familiar' },
              ]}
              value={newPlan.tipo}
              onChange={(e) => setNewPlan({ ...newPlan, tipo: e.target.value as any })}
            />
            <Input
              label="Cupo Máximo de Personas"
              type="number"
              value={newPlan.cupo_personas || 1}
              onChange={(e) => setNewPlan({ ...newPlan, cupo_personas: Number(e.target.value) })}
            />
          </div>
        </form>
      </Modal>

      {/* Modal: Asignar Membresía */}
      <Modal
        isOpen={showAsignarModal}
        onClose={() => setShowAsignarModal(false)}
        title="Asignar Plan a Deportista"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAsignarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleAsignarSubmit} isLoading={isProcessing}>
              Confirmar Asignación
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
          value={asignarData.deportista_id}
          onChange={(e) => setAsignarData({ ...asignarData, deportista_id: e.target.value })}
        />

        <Select
          label="Seleccionar Plan *"
          options={planes.map((p) => ({
            value: p.id,
            label: `${p.nombre} - $${Number(p.precio).toLocaleString()} (${p.duracion_dias} días)`,
          }))}
          value={asignarData.plan_id}
          onChange={(e) => setAsignarData({ ...asignarData, plan_id: e.target.value })}
        />
      </Modal>

      {/* Modal: Congelar */}
      <Modal
        isOpen={showCongelarModal}
        onClose={() => setShowCongelarModal(false)}
        title="Congelar Membresía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCongelarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCongelar} isLoading={isProcessing}>
              Congelar Ahora
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Al congelar la membresía, el deportista no acumula días vencidos. Al descongelar, la fecha de vencimiento se recalcula automáticamente sumando los días que estuvo congelado.
        </p>
        <Input
          label="Motivo Opcional"
          placeholder="Ej. Incapacidad médica, viaje de trabajo..."
          value={motivoCongelar}
          onChange={(e) => setMotivoCongelar(e.target.value)}
        />
      </Modal>

      {/* Modal: Cambiar Plan */}
      <Modal
        isOpen={showCambiarPlanModal}
        onClose={() => setShowCambiarPlanModal(false)}
        title="Cambiar Plan de Membresía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCambiarPlanModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCambiarPlan} isLoading={isProcessing}>
              Aplicar Nuevo Plan
            </Button>
          </>
        }
      >
        <Select
          label="Nuevo Plan a Asignar *"
          options={planes.map((p) => ({
            value: p.id,
            label: `${p.nombre} - $${Number(p.precio).toLocaleString()} (${p.duracion_dias} días)`,
          }))}
          value={nuevoPlanId}
          onChange={(e) => setNuevoPlanId(e.target.value)}
        />
      </Modal>

      {/* Modal: Cancelar */}
      <Modal
        isOpen={showCancelarModal}
        onClose={() => setShowCancelarModal(false)}
        title="Cancelar Membresía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCancelarModal(false)}>
              Volver
            </Button>
            <Button variant="danger" onClick={handleCancelarMembresia} isLoading={isProcessing}>
              Confirmar Cancelación
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Esta acción da de baja la membresía y cierra cualquier congelamiento abierto. Quedará registrada en la auditoría inmutable del gimnasio.
        </p>
        <Input
          label="Motivo Obligatorio *"
          placeholder="Ej. Solicitud voluntaria del afiliado..."
          value={motivoCancelar}
          onChange={(e) => setMotivoCancelar(e.target.value)}
          required
        />
      </Modal>
    </div>
  );
};
