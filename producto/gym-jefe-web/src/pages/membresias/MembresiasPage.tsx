import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Users,
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
import { Drawer } from '../../components/ui/Drawer';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { formatCOP } from '../../utils/formato';
import { Table } from '../../components/ui/Table';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import { EstadoDeportistaBadge } from '../../components/ui/EstadoDeportistaBadge';
import { useAuth } from '../../contexts/AuthContext';
import { CobroMembresiaModal, DestinoCobro } from './CobroMembresiaModal';
import { CrearPaqueteModal, traducirErrorPaquete } from './CrearPaqueteModal';
import {
  PlanResponse,
  MembresiaListItemResponse,
  MembresiaResponse,
  CrearPlanRequest,
} from '../../types/membresias.types';

type TabMembresias = 'membresias' | 'planes';

export const MembresiasPage: React.FC<{ tabInicial?: TabMembresias }> = ({ tabInicial = 'membresias' }) => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const puedeCobrar = hasPermission('caja', 'crear');

  // La pestaña activa la decide la ruta (§B2): /membresias · /membresias/planes
  const activeTab = tabInicial;
  const setActiveTab = (tab: TabMembresias) => navigate(tab === 'planes' ? '/membresias/planes' : '/membresias');

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

  // Cobro (contrato 1.2)
  const [cobro, setCobro] = useState<DestinoCobro | null>(null);
  // Plan grupal (contrato 1.3)
  const [showPaqueteModal, setShowPaqueteModal] = useState(false);
  const puedeCrearMembresia = hasPermission('membresias', 'crear');

  /** Precio de lista de una membresía: la copia del plan vendido (contrato 1.4) o, si no la hay, el precio del plan. */
  const precioListaDe = (m: Pick<MembresiaResponse, 'plan_id' | 'plan_precio_vendido'>): number | null => {
    if (m.plan_precio_vendido !== null && m.plan_precio_vendido !== undefined) return Math.round(Number(m.plan_precio_vendido));
    const plan = planes.find((p) => p.id === m.plan_id);
    return plan ? Math.round(Number(plan.precio)) : null;
  };

  const abrirCobro = (m: MembresiaListItemResponse | MembresiaResponse, nombre: string) => {
    const precio = precioListaDe(m);
    if (precio === null) {
      showToast('error', 'No se puede cobrar', 'No se encontró el precio de lista del plan.');
      return;
    }
    setCobro({
      tipo: 'membresia',
      membresiaId: m.id,
      titulo: nombre,
      detalle: `${m.plan_nombre} · vence el ${formatFechaNegocio(m.fecha_vencimiento)}`,
      precioLista: precio,
    });
  };

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
      showToast('success', 'Plan creado', 'Nuevo plan tarifario agregado al catálogo');
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

  /**
   * Vender un plan es una sola operación: la membresía se crea junto con su cobro (decisión del 15-oct).
   * Aquí se elige deportista y plan; el envío lo hace el modal de cobro.
   */
  const handleAsignarSubmit = () => {
    const { deportista_id, plan_id } = asignarData;
    const plan = planes.find((p) => p.id === plan_id);
    if (!deportista_id || !plan) return;
    const dep = deportistasList.find((d) => d.id === deportista_id);
    setShowAsignarModal(false);
    setCobro({
      tipo: 'venta',
      titulo: dep?.nombre ?? 'Venta de plan',
      detalle: `${plan.nombre} · ${plan.duracion_dias} días desde hoy`,
      precioLista: Math.round(Number(plan.precio)),
      registrar: async (pago, clave) => {
        const nueva = await membresiasService.asignarPlan({ deportista_id, plan_id, pago }, clave);
        return nueva.pago!;
      },
    });
  };

  const handleCongelar = async () => {
    if (!selectedMembresiaId) return;
    setIsProcessing(true);
    try {
      await membresiasService.congelarMembresia(selectedMembresiaId, { motivo: motivoCongelar });
      showToast('success', 'Membresía congelada', 'El periodo de vigencia se encuentra pausado');
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
      showToast('success', 'Membresía descongelada', 'Vencimiento recalculado con los días correspondientes');
      loadMembresias();
    } catch (err) {
      showToast('error', 'Error al descongelar', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  /** GW-RF-25 CA3: el plan nuevo empieza cuando termina el actual y se cobra en el mismo paso. */
  const handleCambiarPlan = () => {
    const membresiaId = selectedMembresiaId;
    const plan = planes.find((p) => p.id === nuevoPlanId);
    if (!membresiaId || !plan) return;
    const actual = membresias.find((m) => m.id === membresiaId);
    setShowCambiarPlanModal(false);
    setSelectedMembresiaId(null);
    setCobro({
      tipo: 'venta',
      titulo: actual?.deportista_nombre ?? 'Cambio de plan',
      detalle: actual
        ? `${actual.plan_nombre} → ${plan.nombre} · empieza cuando termine el actual (${formatFechaNegocio(actual.fecha_vencimiento)})`
        : plan.nombre,
      precioLista: Math.round(Number(plan.precio)),
      registrar: async (pago, clave) => {
        const nueva = await membresiasService.cambiarPlan(membresiaId, { nuevo_plan_id: plan.id, pago }, clave);
        return nueva.pago!;
      },
      traducirError: (err) =>
        err.codigo === 'MEMBRESIA_CONGELADA' ? 'La membresía está congelada: descongélala antes de cambiar de plan.' : null,
    });
  };

  const handleCancelarMembresia = async () => {
    if (!selectedMembresiaId || !motivoCancelar) return;
    setIsProcessing(true);
    try {
      await membresiasService.cancelarMembresia(selectedMembresiaId, { motivo: motivoCancelar });
      showToast('info', 'Membresía cancelada', 'Membresía dada de baja');
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
          <h1 className="page-title">Membresías</h1>
          <p className="page-subtitle">
            Asigna planes, congela, cambia o cancela membresías
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {puedeCrearMembresia && (
            <Button variant="outline" leftIcon={<Users size={16} />} onClick={() => setShowPaqueteModal(true)}>
              Plan grupal
            </Button>
          )}
          <Button
            variant="outline"
            leftIcon={<UserCheck size={16} />}
            onClick={handleOpenAsignar}
          >
            Asignar plan
          </Button>
          <Button
            variant="primary"
            leftIcon={<Plus size={16} />}
            onClick={() => setShowCrearPlanModal(true)}
          >
            Nuevo plan
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'membresias' ? 'active' : ''}`}
          onClick={() => setActiveTab('membresias')}
        >
          Membresías activas
        </button>
        <button
          className={`tab-btn ${activeTab === 'planes' ? 'active' : ''}`}
          onClick={() => setActiveTab('planes')}
        >
          Planes ({planes.length})
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
                    <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.deportista_nombre}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                      Doc. {m.deportista_documento}
                    </div>
                  </div>
                ),
              },
              {
                header: 'Plan',
                accessor: 'plan_nombre',
              },
              {
                header: 'Vence',
                render: (m) => (
                  <div>
                    <div>{formatFechaNegocio(m.fecha_vencimiento)}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                      desde {formatFechaNegocio(m.fecha_inicio)}
                    </div>
                  </div>
                ),
              },
              {
                header: 'Estado',
                render: (m) => (
                  <EstadoDeportistaBadge estado={m.estado_calculado} detalle={{ dias: m.dias_restantes_o_vencido }} />
                ),
              },
              {
                header: '',
                align: 'right',
                width: '150px',
                render: (m) => (
                  <div className="acciones-fila">
                    {puedeCobrar && !m.cancelada && (
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<DollarSign size={14} />}
                        onClick={() => abrirCobro(m, m.deportista_nombre)}
                      >
                        Renovar
                      </Button>
                    )}
                    <MenuAcciones
                      etiqueta={`Acciones de ${m.deportista_nombre}`}
                      acciones={[
                        {
                          etiqueta: 'Descongelar',
                          icono: <Sun size={15} />,
                          oculto: !m.congelamiento_activo,
                          onClick: () => handleDescongelar(m.id),
                        },
                        {
                          etiqueta: 'Congelar',
                          icono: <Snowflake size={15} />,
                          oculto: m.congelamiento_activo,
                          onClick: () => {
                            setSelectedMembresiaId(m.id);
                            setShowCongelarModal(true);
                          },
                        },
                        {
                          etiqueta: 'Cambiar plan',
                          icono: <RefreshCw size={15} />,
                          onClick: () => {
                            setSelectedMembresiaId(m.id);
                            setNuevoPlanId(planes[0]?.id || '');
                            setShowCambiarPlanModal(true);
                          },
                        },
                        {
                          etiqueta: 'Cancelar membresía',
                          icono: <XCircle size={15} />,
                          peligro: true,
                          onClick: () => {
                            setSelectedMembresiaId(m.id);
                            setShowCancelarModal(true);
                          },
                        },
                      ]}
                    />
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

                <h3 style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
                  {plan.nombre}
                </h3>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '14px 0' }}>
                  <span style={{ fontSize: '1.75rem', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                    {formatCOP(plan.precio)}
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
      <Drawer
        isOpen={showCrearPlanModal}
        onClose={() => setShowCrearPlanModal(false)}
        title="Nuevo plan"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCrearPlanModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearPlan} isLoading={isProcessing}>
              Guardar plan
            </Button>
          </>
        }
      >
        <form onSubmit={handleCrearPlan}>
          <Input
            label="Nombre del plan *"
            placeholder="Ej. Mensualidad"
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
              label="Duración en días *"
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
              label="Cupo máximo de personas"
              type="number"
              value={newPlan.cupo_personas || 1}
              onChange={(e) => setNewPlan({ ...newPlan, cupo_personas: Number(e.target.value) })}
            />
          </div>
        </form>
      </Drawer>

      {/* Modal: Asignar Membresía */}
      <Drawer
        isOpen={showAsignarModal}
        onClose={() => setShowAsignarModal(false)}
        title="Asignar plan"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAsignarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleAsignarSubmit}>
              Continuar al cobro
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
          value={asignarData.deportista_id}
          onChange={(e) => setAsignarData({ ...asignarData, deportista_id: e.target.value })}
        />

        <Select
          label="Plan *"
          options={planes.map((p) => ({
            value: p.id,
            label: `${p.nombre} · ${formatCOP(p.precio)} · ${p.duracion_dias} días`,
          }))}
          value={asignarData.plan_id}
          onChange={(e) => setAsignarData({ ...asignarData, plan_id: e.target.value })}
        />
      </Drawer>

      {/* Modal: Congelar */}
      <Modal
        isOpen={showCongelarModal}
        onClose={() => setShowCongelarModal(false)}
        title="Congelar membresía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCongelarModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCongelar} isLoading={isProcessing}>
              Congelar
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Al congelar la membresía, el deportista no acumula días vencidos. Al descongelar, la fecha de vencimiento se recalcula automáticamente sumando los días que estuvo congelado.
        </p>
        <Input
          label="Motivo (opcional)"
          placeholder="Ej. Incapacidad médica, viaje de trabajo..."
          value={motivoCongelar}
          onChange={(e) => setMotivoCongelar(e.target.value)}
        />
      </Modal>

      {/* Modal: Cambiar Plan */}
      <Modal
        isOpen={showCambiarPlanModal}
        onClose={() => setShowCambiarPlanModal(false)}
        title="Cambiar plan"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCambiarPlanModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCambiarPlan} disabled={!nuevoPlanId}>
              Continuar al cobro
            </Button>
          </>
        }
      >
        <Select
          label="Nuevo plan *"
          options={planes.map((p) => ({
            value: p.id,
            label: `${p.nombre} · ${formatCOP(p.precio)} · ${p.duracion_dias} días`,
          }))}
          value={nuevoPlanId}
          onChange={(e) => setNuevoPlanId(e.target.value)}
        />
      </Modal>

      <CrearPaqueteModal
        isOpen={showPaqueteModal}
        planes={planes}
        onCerrar={() => setShowPaqueteModal(false)}
        onContinuar={({ plan, titular, beneficiarios, fechaInicio }) => {
          setShowPaqueteModal(false);
          // Un solo cobro por todo el paquete, registrado junto con las membresías.
          setCobro({
            tipo: 'venta',
            titulo: `${plan.nombre} · titular ${titular.nombre}`,
            detalle: beneficiarios.map((b) => b.nombre).join(', '),
            precioLista: Math.round(Number(plan.precio)),
            registrar: async (pago, clave) => {
              const res = await membresiasService.crearPaquete(
                {
                  plan_id: plan.id,
                  titular_id: titular.id,
                  beneficiarios: beneficiarios.map((b) => b.id),
                  fecha_inicio: fechaInicio,
                  pago,
                },
                clave,
              );
              return res.pago;
            },
            traducirError: traducirErrorPaquete,
          });
        }}
      />

      <CobroMembresiaModal
        destino={cobro}
        onCerrar={() => setCobro(null)}
        onCobrado={() => {
          showToast('success', cobro?.tipo === 'venta' ? 'Venta registrada' : 'Pago registrado', cobro?.titulo ?? '');
          loadMembresias();
        }}
      />

      {/* Modal: Cancelar */}
      <Modal
        isOpen={showCancelarModal}
        onClose={() => setShowCancelarModal(false)}
        title="Cancelar membresía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCancelarModal(false)}>
              Volver
            </Button>
            <Button variant="danger" onClick={handleCancelarMembresia} isLoading={isProcessing}>
              Cancelar membresía
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
          Esta acción da de baja la membresía y cierra cualquier congelamiento abierto. Quedará registrada en la auditoría inmutable del gimnasio.
        </p>
        <Input
          label="Motivo *"
          placeholder="Ej. Solicitud voluntaria del afiliado..."
          value={motivoCancelar}
          onChange={(e) => setMotivoCancelar(e.target.value)}
          required
        />
      </Modal>
    </div>
  );
};
