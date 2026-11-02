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
  Edit2,
  Power,
  Trash2,
} from 'lucide-react';
import { membresiasService } from '../../api/membresias.service';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { formatCOP } from '../../utils/formato';
import { Table } from '../../components/ui/Table';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import { EstadoDeportistaBadge } from '../../components/ui/EstadoDeportistaBadge';
import { useAuth } from '../../contexts/AuthContext';
import { CobroMembresiaModal, DestinoCobro } from './CobroMembresiaModal';
import { CrearPaqueteModal, traducirErrorPaquete } from './CrearPaqueteModal';
import type { DeportistaBusquedaItem } from '../../types/comun.types';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingMembresias, setIsLoadingMembresias] = useState(false);

  // Planes state
  const [planes, setPlanes] = useState<PlanResponse[]>([]);
  const [isLoadingPlanes, setIsLoadingPlanes] = useState(false);

  // Modals
  const [showCrearPlanModal, setShowCrearPlanModal] = useState(false);
  const [editandoPlan, setEditandoPlan] = useState<PlanResponse | null>(null);
  const [planAEliminar, setPlanAEliminar] = useState<PlanResponse | null>(null);
  const [precioPlan, setPrecioPlan] = useState('90000');
  const [duracionPlan, setDuracionPlan] = useState('30');
  const [cupoPlan, setCupoPlan] = useState('1');
  const [newPlan, setNewPlan] = useState<CrearPlanRequest>({
    nombre: '',
    precio: 90000,
    duracion_dias: 30,
    tipo: 'individual',
    cupo_personas: 1,
  });

  const [showAsignarModal, setShowAsignarModal] = useState(false);
  const [asignarData, setAsignarData] = useState({ deportista_id: '', plan_id: '' });
  const [busquedaAsignar, setBusquedaAsignar] = useState('');
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
  const [paquetePlanInicialId, setPaquetePlanInicialId] = useState<string>('');
  const [paqueteTitularInicial, setPaqueteTitularInicial] = useState<DeportistaBusquedaItem | null>(null);
  const puedeCrearMembresia = hasPermission('membresias', 'crear');
  const puedeEditarPlan = hasPermission('membresias', 'editar');
  const planesActivos = planes.filter((p) => p.activo);

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
      const q = searchQuery.trim();
      const res = await membresiasService.getMembresias({
        skip: (page - 1) * 10,
        limit: 10,
        q: q.length > 0 ? q : undefined,
      });
      setMembresias(res.items);
      setTotalMembresias(res.total);
    } catch (e) {
      console.error('Error loading membresias', e);
    } finally {
      setIsLoadingMembresias(false);
    }
  }, [page, searchQuery]);

  useEffect(() => {
    loadPlanes();
  }, [loadPlanes]);

  useEffect(() => {
    loadMembresias();
  }, [loadMembresias]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  const abrirNuevoPlan = () => {
    setEditandoPlan(null);
    setPrecioPlan('90000');
    setDuracionPlan('30');
    setCupoPlan('1');
    setNewPlan({ nombre: '', precio: 90000, duracion_dias: 30, tipo: 'individual', cupo_personas: 1 });
    setShowCrearPlanModal(true);
  };

  const abrirEditarPlan = (plan: PlanResponse) => {
    const precioRedondeado = Math.round(Number(plan.precio));
    setEditandoPlan(plan);
    setPrecioPlan(String(precioRedondeado));
    setDuracionPlan(String(plan.duracion_dias));
    setCupoPlan(String(plan.cupo_personas));
    setNewPlan({
      nombre: plan.nombre,
      precio: precioRedondeado,
      duracion_dias: plan.duracion_dias,
      tipo: plan.tipo,
      cupo_personas: plan.cupo_personas,
    });
    setShowCrearPlanModal(true);
  };

  const handleCrearPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlan.nombre.trim() || newPlan.nombre.trim().length < 2) {
      showToast('error', 'Nombre inválido', 'Ingresa un nombre para el plan (mínimo 2 caracteres).');
      return;
    }
    if (precioPlan === '' || newPlan.precio < 0) {
      showToast('error', 'Precio inválido', 'Ingresa un precio válido para el plan.');
      return;
    }
    if (!duracionPlan || newPlan.duracion_dias < 1) {
      showToast('error', 'Duración inválida', 'La duración en días debe ser mayor a 0.');
      return;
    }
    if (!cupoPlan || !newPlan.cupo_personas || newPlan.cupo_personas < 1) {
      showToast('error', 'Cupo inválido', 'El cupo máximo debe ser de al menos 1 persona.');
      return;
    }
    setIsProcessing(true);
    try {
      if (editandoPlan) {
        await membresiasService.editarPlan(editandoPlan.id, {
          version: editandoPlan.version,
          nombre: newPlan.nombre.trim(),
          precio: newPlan.precio,
          duracion_dias: newPlan.duracion_dias,
          tipo: newPlan.tipo,
          cupo_personas: newPlan.cupo_personas,
        });
        showToast('success', 'Plan actualizado', `Se guardaron los cambios de ${newPlan.nombre.trim()}`);
      } else {
        await membresiasService.crearPlan({
          ...newPlan,
          nombre: newPlan.nombre.trim(),
        });
        showToast('success', 'Plan creado', 'Nuevo plan tarifario agregado al catálogo');
      }
      setShowCrearPlanModal(false);
      setEditandoPlan(null);
      setPrecioPlan('90000');
      setDuracionPlan('30');
      setCupoPlan('1');
      setNewPlan({ nombre: '', precio: 90000, duracion_dias: 30, tipo: 'individual', cupo_personas: 1 });
      loadPlanes();
    } catch (err) {
      showToast('error', editandoPlan ? 'Error al actualizar plan' : 'Error al crear plan', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCambiarEstadoPlan = async (plan: PlanResponse) => {
    setIsProcessing(true);
    try {
      const nuevoEstado = !plan.activo;
      await membresiasService.cambiarEstadoPlan(plan.id, nuevoEstado);
      showToast(
        'success',
        nuevoEstado ? 'Plan activado' : 'Plan desactivado',
        `${plan.nombre} ahora está ${nuevoEstado ? 'disponible para la venta' : 'inactivo'}`
      );
      loadPlanes();
    } catch (err) {
      showToast('error', 'Error al cambiar estado del plan', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEliminarPlan = async () => {
    if (!planAEliminar) return;
    setIsProcessing(true);
    try {
      await membresiasService.eliminarPlan(planAEliminar.id);
      showToast('success', 'Plan eliminado', `${planAEliminar.nombre} fue eliminado del catálogo`);
      setPlanAEliminar(null);
      loadPlanes();
    } catch (err) {
      showToast('error', 'No se pudo eliminar el plan', parseApiError(err));
      setPlanAEliminar(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenAsignar = async () => {
    try {
      setBusquedaAsignar('');
      const depRes = await deportistasService.getDeportistas({ limit: 50 });
      setDeportistasList(depRes.items);
      if (planesActivos.length > 0) {
        setAsignarData({
          deportista_id: depRes.items[0]?.id || '',
          plan_id: planesActivos[0]?.id || '',
        });
      }
      setShowAsignarModal(true);
    } catch (e) {
      showToast('error', 'Error', 'No se pudieron cargar los deportistas');
    }
  };

  useEffect(() => {
    if (!showAsignarModal) return;
    const t = window.setTimeout(async () => {
      try {
        const q = busquedaAsignar.trim();
        const depRes = await deportistasService.getDeportistas({
          limit: 50,
          q: q.length > 0 ? q : undefined,
        });
        setDeportistasList(depRes.items);
        if (depRes.items.length > 0 && !depRes.items.some((d) => d.id === asignarData.deportista_id)) {
          setAsignarData((prev) => ({ ...prev, deportista_id: depRes.items[0].id }));
        }
      } catch (e) {
        console.error('Error filtrando deportistas', e);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [busquedaAsignar, showAsignarModal]);

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
    if (plan.cupo_personas > 1) {
      setPaquetePlanInicialId(plan.id);
      setPaqueteTitularInicial(dep ?? null);
      setShowPaqueteModal(true);
      return;
    }
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
    if (plan.cupo_personas > 1) {
      setPaquetePlanInicialId(plan.id);
      setPaqueteTitularInicial(
        actual
          ? {
              id: actual.deportista_id,
              tipo_documento: 'CC',
              documento: actual.deportista_documento,
              nombre: actual.deportista_nombre,
              correo: actual.deportista_correo ?? null,
              telefono: actual.deportista_telefono ?? null,
              activo: actual.deportista_activo,
              plan_nombre: actual.plan_nombre,
              fecha_vencimiento: actual.fecha_vencimiento,
              esta_congelada: actual.congelamiento_activo,
              cancelada: actual.cancelada,
              estado: actual.estado_calculado,
            }
          : null,
      );
      setShowPaqueteModal(true);
      return;
    }
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
            <Button
              variant="outline"
              leftIcon={<Users size={16} />}
              onClick={() => {
                setPaquetePlanInicialId('');
                setPaqueteTitularInicial(null);
                setShowPaqueteModal(true);
              }}
            >
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
            onClick={abrirNuevoPlan}
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
        <>
          <div style={{ marginBottom: 16, maxWidth: 420 }}>
            <SearchInput
              placeholder="Buscar por nombre o número de documento"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Buscar membresía por nombre o documento"
            />
          </div>
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
                            setNuevoPlanId(planesActivos.find((p) => p.id !== m.plan_id)?.id || planesActivos[0]?.id || '');
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
            emptyMessage={
              searchQuery.trim()
                ? 'Ninguna membresía coincide con el nombre o número de documento buscado.'
                : 'No hay membresías activas registradas.'
            }
          />
        </Card>
        </>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {plan.tipo}
                    </span>
                    {puedeEditarPlan && (
                      <MenuAcciones
                        etiqueta={`Acciones de ${plan.nombre}`}
                        acciones={[
                          {
                            etiqueta: 'Editar plan',
                            icono: <Edit2 size={15} />,
                            onClick: () => abrirEditarPlan(plan),
                          },
                          {
                            etiqueta: plan.activo ? 'Desactivar plan' : 'Activar plan',
                            icono: <Power size={15} />,
                            onClick: () => handleCambiarEstadoPlan(plan),
                          },
                          {
                            etiqueta: 'Eliminar plan',
                            icono: <Trash2 size={15} />,
                            peligro: true,
                            onClick: () => setPlanAEliminar(plan),
                          },
                        ]}
                      />
                    )}
                  </div>
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

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} /> Cupo: {plan.cupo_personas} persona(s)
                  </div>
                  {puedeEditarPlan && (
                    <Button
                      variant="outline"
                      size="sm"
                      leftIcon={<Edit2 size={14} />}
                      onClick={() => abrirEditarPlan(plan)}
                    >
                      Editar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear / Editar Plan */}
      <Drawer
        isOpen={showCrearPlanModal}
        onClose={() => {
          setShowCrearPlanModal(false);
          setEditandoPlan(null);
        }}
        title={editandoPlan ? 'Editar plan' : 'Nuevo plan'}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setShowCrearPlanModal(false);
                setEditandoPlan(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrearPlan} isLoading={isProcessing}>
              {editandoPlan ? 'Guardar cambios' : 'Guardar plan'}
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
              moneda
              value={precioPlan}
              onChange={(e) => {
                setPrecioPlan(e.target.value);
                setNewPlan({ ...newPlan, precio: Number(e.target.value) });
              }}
              required
            />
            <Input
              label="Duración en días *"
              type="text"
              inputMode="numeric"
              value={duracionPlan}
              onChange={(e) => {
                const limpio = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                setDuracionPlan(limpio);
                setNewPlan({ ...newPlan, duracion_dias: limpio === '' ? 0 : Number(limpio) });
              }}
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
              onChange={(e) => {
                const tipo = e.target.value as CrearPlanRequest['tipo'];
                const cupoSugerido =
                  tipo === 'individual'
                    ? 1
                    : tipo === 'pareja'
                      ? 2
                      : Math.max(3, newPlan.cupo_personas || 3);
                setCupoPlan(String(cupoSugerido));
                setNewPlan({ ...newPlan, tipo, cupo_personas: cupoSugerido });
              }}
            />
            <Input
              label="Cupo máximo de personas"
              type="text"
              inputMode="numeric"
              value={cupoPlan}
              onChange={(e) => {
                const limpio = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                setCupoPlan(limpio);
                setNewPlan({ ...newPlan, cupo_personas: limpio === '' ? 0 : Number(limpio) });
              }}
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
        <div style={{ marginBottom: 12 }}>
          <SearchInput
            placeholder="Buscar deportista por nombre o documento..."
            value={busquedaAsignar}
            onChange={(e) => setBusquedaAsignar(e.target.value)}
            aria-label="Buscar deportista para asignar plan"
          />
        </div>

        <Select
          label="Deportista *"
          options={
            deportistasList.length > 0
              ? deportistasList.map((d) => ({
                  value: d.id,
                  label: `${d.nombre} (${d.documento})`,
                }))
              : [{ value: '', label: 'Sin coincidencias para la búsqueda' }]
          }
          value={asignarData.deportista_id}
          onChange={(e) => setAsignarData({ ...asignarData, deportista_id: e.target.value })}
        />

        <Select
          label="Plan *"
          options={planesActivos.map((p) => ({
            value: p.id,
            label: `${p.nombre} · ${formatCOP(p.precio)} · ${p.duracion_dias} días${p.cupo_personas > 1 ? ` · ${p.cupo_personas} personas` : ''}`,
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
          options={planesActivos.map((p) => ({
            value: p.id,
            label: `${p.nombre} · ${formatCOP(p.precio)} · ${p.duracion_dias} días${p.cupo_personas > 1 ? ` · ${p.cupo_personas} personas` : ''}`,
          }))}
          value={nuevoPlanId}
          onChange={(e) => setNuevoPlanId(e.target.value)}
        />
      </Modal>

      <CrearPaqueteModal
        isOpen={showPaqueteModal}
        planes={planes}
        planInicialId={paquetePlanInicialId}
        titularInicial={paqueteTitularInicial}
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

      <ConfirmDialog
        isOpen={!!planAEliminar}
        onClose={() => setPlanAEliminar(null)}
        onConfirm={handleEliminarPlan}
        title="Eliminar plan"
        message={
          planAEliminar
            ? `¿Seguro que deseas eliminar el plan "${planAEliminar.nombre}"? Solo se puede eliminar si aún no tiene membresías asociadas.`
            : ''
        }
        confirmText="Eliminar plan"
        cancelText="Cancelar"
        isDestructive
      />
    </div>
  );
};
