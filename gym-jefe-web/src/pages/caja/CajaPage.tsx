import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Plus,
  Lock,
  Unlock,
  DollarSign,
  ShoppingCart,
  MinusCircle,
  TrendingUp,
  Receipt,
  Trash2,
} from 'lucide-react';
import { cajaService } from '../../api/caja.service';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card, KpiCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import {
  TurnoResumenDto,
  MovimientoCajaItemDto,
  VentaItemRequest,
} from '../../types/caja.types';

export const CajaPage: React.FC = () => {
  const { isJefe } = useAuth();
  const { showToast } = useToast();

  const [turno, setTurno] = useState<TurnoResumenDto | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCajaItemDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [showAbrirModal, setShowAbrirModal] = useState(false);
  const [baseInicial, setBaseInicial] = useState('50000');

  const [showCerrarModal, setShowCerrarModal] = useState(false);
  const [efectivoContado, setEfectivoContado] = useState('');

  const [showVentaModal, setShowVentaModal] = useState(false);
  const [ventaItems, setVentaItems] = useState<VentaItemRequest[]>([
    { tipo: 'pase_dia', descripcion: 'Pase de Día Gimnasio', cantidad: 1, precio_unitario: 15000 },
  ]);
  const [ventaMetodo, setVentaMetodo] = useState('efectivo');
  const [ventaTipoMedio, setVentaTipoMedio] = useState<'efectivo' | 'otro'>('efectivo');
  const [valorRecibido, setValorRecibido] = useState('');

  const [showEgresoModal, setShowEgresoModal] = useState(false);
  const [egresoMonto, setEgresoMonto] = useState('');
  const [egresoMotivo, setEgresoMotivo] = useState('');

  const [isProcessing, setIsProcessing] = useState(false);

  const loadCaja = useCallback(async () => {
    setIsLoading(true);
    try {
      const turnoRes = await cajaService.getTurnoActual();
      setTurno(turnoRes);

      if (turnoRes && turnoRes.id) {
        const movs = await cajaService.getMovimientos(turnoRes.id);
        setMovimientos(movs.items);
      } else {
        setMovimientos([]);
      }
    } catch (e) {
      console.error('Error fetching cash shift', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCaja();
  }, [loadCaja]);

  // Handlers
  const handleAbrirTurno = async () => {
    setIsProcessing(true);
    try {
      const res = await cajaService.abrirTurno({ base_inicial: Number(baseInicial) || 0 });
      setTurno(res);
      setShowAbrirModal(false);
      showToast('success', 'Turno Abierto', 'Caja lista para procesar ventas y pagos');
      loadCaja();
    } catch (err) {
      showToast('error', 'Error al abrir turno', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCerrarTurno = async () => {
    if (!efectivoContado) return;
    setIsProcessing(true);
    try {
      await cajaService.cerrarTurno({ efectivo_contado: Number(efectivoContado) });
      setShowCerrarModal(false);
      showToast('success', 'Turno Cerrado', 'Arqueo completado exitosamente');
      loadCaja();
    } catch (err) {
      showToast('error', 'Error al cerrar turno', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegistrarVenta = async () => {
    if (ventaItems.length === 0) return;
    setIsProcessing(true);
    try {
      await cajaService.registrarVenta({
        metodo: ventaMetodo,
        tipo_medio: ventaTipoMedio,
        valor_recibido: valorRecibido ? Number(valorRecibido) : undefined,
        items: ventaItems,
      });

      setShowVentaModal(false);
      showToast('success', 'Venta Registrada', 'Cobro asentado en el turno actual');
      loadCaja();
    } catch (err) {
      showToast('error', 'Error al cobrar venta', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegistrarEgreso = async () => {
    if (!egresoMonto || !egresoMotivo) return;
    setIsProcessing(true);
    try {
      await cajaService.registrarEgreso({
        monto: Number(egresoMonto),
        motivo: egresoMotivo,
      });

      setShowEgresoModal(false);
      setEgresoMonto('');
      setEgresoMotivo('');
      showToast('success', 'Egreso Registrado', 'Monto deducido de caja');
      loadCaja();
    } catch (err) {
      showToast('error', 'Error al registrar egreso', parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const totalVenta = ventaItems.reduce(
    (acc, item) => acc + (item.precio_unitario || 0) * item.cantidad,
    0
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Caja y Punto de Venta (POS)</h1>
          <p className="page-subtitle">
            Apertura de turno, ventas multi-ítem, cobro de membresías, egresos y arqueo
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {turno?.estado === 'abierto' ? (
            <>
              <Button
                variant="primary"
                leftIcon={<ShoppingCart size={16} />}
                onClick={() => setShowVentaModal(true)}
              >
                Nueva Venta
              </Button>
              <Button
                variant="outline"
                leftIcon={<MinusCircle size={16} />}
                onClick={() => setShowEgresoModal(true)}
              >
                Registrar Egreso
              </Button>
              <Button
                variant="secondary"
                leftIcon={<Lock size={16} color="var(--warning)" />}
                onClick={() => setShowCerrarModal(true)}
              >
                Cerrar Turno
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              leftIcon={<Unlock size={16} />}
              onClick={() => setShowAbrirModal(true)}
            >
              Abrir Turno de Caja
            </Button>
          )}
        </div>
      </div>

      {/* Cash Status Overview */}
      {turno?.estado === 'abierto' ? (
        <div className="kpi-grid">
          <KpiCard
            label="Base Inicial"
            value={`$${Number(turno.base_inicial).toLocaleString()}`}
            icon={<DollarSign size={20} />}
            subtext="Efectivo de arranque"
          />
          <KpiCard
            label="Ventas en Efectivo"
            value={`$${Number(turno.ventas_efectivo).toLocaleString()}`}
            icon={<TrendingUp size={20} />}
            subtext={`+$${Number(turno.pagos_membresia_efectivo).toLocaleString()} membresías`}
            color="var(--success)"
          />
          <KpiCard
            label="Egresos y Vales"
            value={`$${Number(turno.egresos_efectivo).toLocaleString()}`}
            icon={<MinusCircle size={20} />}
            subtext="Gastos autorizados"
            color="var(--danger)"
          />
          <KpiCard
            label="Total Esperado en Efectivo"
            value={`$${Number(turno.total_esperado_efectivo).toLocaleString()}`}
            icon={<CreditCard size={20} />}
            subtext="Monto para arqueo"
            color="var(--primary)"
          />
        </div>
      ) : (
        <Card style={{ textAlign: 'center', padding: '40px 20px', marginBottom: 28 }}>
          <Lock size={48} color="var(--text-muted)" style={{ marginBottom: 12 }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            No hay turno de caja abierto en este momento
          </h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 450, margin: '8px auto 20px auto' }}>
            Para registrar ventas de productos, pases de día o recibir pagos de membresías en efectivo, abre un nuevo turno con la base inicial de monedas y billetes.
          </p>
          <Button variant="primary" onClick={() => setShowAbrirModal(true)} leftIcon={<Unlock size={16} />}>
            Abrir Turno Ahora
          </Button>
        </Card>
      )}

      {/* Movements Table */}
      {turno?.estado === 'abierto' && (
        <Card title="Movimientos del Turno Actual">
          <Table<MovimientoCajaItemDto>
            columns={[
              {
                header: 'Hora',
                accessor: (item) =>
                  new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                width: '100px',
              },
              {
                header: 'Tipo',
                render: (item) => (
                  <Badge
                    variant={
                      item.tipo_movimiento === 'venta' || item.tipo_movimiento === 'pago_membresia'
                        ? 'success'
                        : 'danger'
                    }
                  >
                    {item.tipo_movimiento === 'venta'
                      ? 'Venta'
                      : item.tipo_movimiento === 'pago_membresia'
                      ? 'Membresía'
                      : 'Egreso'}
                  </Badge>
                ),
                width: '130px',
              },
              {
                header: 'Concepto',
                accessor: 'concepto',
              },
              {
                header: 'Método',
                render: (item) => (
                  <span style={{ textTransform: 'capitalize', fontSize: '0.85rem' }}>
                    {item.metodo || 'Efectivo'} ({item.tipo_medio || 'efectivo'})
                  </span>
                ),
              },
              {
                header: 'Monto',
                align: 'right',
                render: (item) => (
                  <span
                    style={{
                      fontWeight: 700,
                      color:
                        item.tipo_movimiento === 'egreso' ? 'var(--danger)' : 'var(--text-primary)',
                    }}
                  >
                    {item.tipo_movimiento === 'egreso' ? '-' : '+'}$
                    {Number(item.monto).toLocaleString()}
                  </span>
                ),
              },
            ]}
            data={movimientos}
            isLoading={isLoading}
            keyExtractor={(item) => item.id}
            emptyMessage="No se han realizado cobros ni movimientos en este turno"
          />
        </Card>
      )}

      {/* Modal: Abrir Turno */}
      <Modal
        isOpen={showAbrirModal}
        onClose={() => setShowAbrirModal(false)}
        title="Abrir Turno de Caja"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowAbrirModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleAbrirTurno} isLoading={isProcessing}>
              Confirmar Apertura
            </Button>
          </>
        }
      >
        <Input
          label="Base Inicial en Efectivo ($ COP)"
          type="number"
          value={baseInicial}
          onChange={(e) => setBaseInicial(e.target.value)}
          placeholder="50000"
          leftIcon={<DollarSign size={16} />}
        />
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Indica el monto físico de dinero en efectivo con el que se inicia la jornada para cambio y vueltas.
        </p>
      </Modal>

      {/* Modal: Cerrar Turno */}
      <Modal
        isOpen={showCerrarModal}
        onClose={() => setShowCerrarModal(false)}
        title="Arqueo y Cierre de Turno"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCerrarModal(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleCerrarTurno} isLoading={isProcessing}>
              Confirmar Cierre de Caja
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Total esperado en efectivo:</span>
            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
              ${Number(turno?.total_esperado_efectivo || 0).toLocaleString()}
            </span>
          </div>
        </div>
        <Input
          label="Efectivo Físico Contado en Caja ($ COP)"
          type="number"
          value={efectivoContado}
          onChange={(e) => setEfectivoContado(e.target.value)}
          placeholder="Monto contado..."
          autoFocus
          leftIcon={<DollarSign size={16} />}
          required
        />
        {efectivoContado && turno && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--bg-surface-elevated)',
              fontSize: '0.875rem',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Diferencia:</span>
            <span
              style={{
                fontWeight: 800,
                color:
                  Number(efectivoContado) - Number(turno.total_esperado_efectivo) === 0
                    ? 'var(--success)'
                    : Number(efectivoContado) - Number(turno.total_esperado_efectivo) > 0
                    ? 'var(--warning)'
                    : 'var(--danger)',
              }}
            >
              ${(Number(efectivoContado) - Number(turno.total_esperado_efectivo)).toLocaleString()}
            </span>
          </div>
        )}
      </Modal>

      {/* Modal: Nueva Venta */}
      <Modal
        isOpen={showVentaModal}
        onClose={() => setShowVentaModal(false)}
        title="Registrar Venta en Mostrador"
        maxWidth="640px"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowVentaModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleRegistrarVenta} isLoading={isProcessing}>
              Cobrar ${totalVenta.toLocaleString()}
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Ítems a Cobrar</div>
          {ventaItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 70px 110px 30px',
                gap: 8,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Select
                options={[
                  { value: 'pase_dia', label: 'Pase Día' },
                  { value: 'pase_clase', label: 'Pase Clase' },
                  { value: 'producto', label: 'Producto' },
                ]}
                value={item.tipo}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setVentaItems((prev) =>
                    prev.map((it, i) =>
                      i === idx
                        ? {
                            ...it,
                            tipo: val,
                            descripcion:
                              val === 'pase_dia'
                                ? 'Pase de Día Gimnasio'
                                : val === 'pase_clase'
                                ? 'Pase Individual de Clase'
                                : 'Bebida Energizante',
                            precio_unitario: val === 'pase_dia' ? 15000 : val === 'pase_clase' ? 20000 : 6000,
                          }
                        : it
                    )
                  );
                }}
              />
              <Input
                value={item.descripcion}
                onChange={(e) => {
                  const desc = e.target.value;
                  setVentaItems((prev) =>
                    prev.map((it, i) => (i === idx ? { ...it, descripcion: desc } : it))
                  );
                }}
              />
              <Input
                type="number"
                value={item.cantidad}
                onChange={(e) => {
                  const qty = Number(e.target.value) || 1;
                  setVentaItems((prev) =>
                    prev.map((it, i) => (i === idx ? { ...it, cantidad: qty } : it))
                  );
                }}
              />
              <Input
                type="number"
                value={item.precio_unitario || 0}
                onChange={(e) => {
                  const pr = Number(e.target.value) || 0;
                  setVentaItems((prev) =>
                    prev.map((it, i) => (i === idx ? { ...it, precio_unitario: pr } : it))
                  );
                }}
              />
              <button
                type="button"
                onClick={() => setVentaItems((prev) => prev.filter((_, i) => i !== idx))}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() =>
              setVentaItems((prev) => [
                ...prev,
                { tipo: 'producto', descripcion: 'Bebida Hidratante', cantidad: 1, precio_unitario: 5000 },
              ])
            }
          >
            Agregar otro ítem
          </Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Select
            label="Método de Pago"
            options={[
              { value: 'efectivo', label: 'Efectivo' },
              { value: 'nequi', label: 'Nequi' },
              { value: 'daviplata', label: 'Daviplata' },
              { value: 'datafono', label: 'Datáfono / Tarjeta' },
            ]}
            value={ventaMetodo}
            onChange={(e) => {
              setVentaMetodo(e.target.value);
              setVentaTipoMedio(e.target.value === 'efectivo' ? 'efectivo' : 'otro');
            }}
          />

          {ventaTipoMedio === 'efectivo' && (
            <Input
              label="Valor Recibido ($ COP)"
              type="number"
              value={valorRecibido}
              onChange={(e) => setValorRecibido(e.target.value)}
              placeholder="Ej. 20000"
            />
          )}
        </div>

        {ventaTipoMedio === 'efectivo' && valorRecibido && Number(valorRecibido) >= totalVenta && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--success-light)',
              border: '1px solid var(--success-border)',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.9rem',
              fontWeight: 700,
              color: 'var(--success)',
            }}
          >
            <span>Cambio a devolver al cliente:</span>
            <span>${(Number(valorRecibido) - totalVenta).toLocaleString()}</span>
          </div>
        )}
      </Modal>

      {/* Modal: Registrar Egreso */}
      <Modal
        isOpen={showEgresoModal}
        onClose={() => setShowEgresoModal(false)}
        title="Registrar Egreso o Vale de Caja"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowEgresoModal(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleRegistrarEgreso} isLoading={isProcessing}>
              Confirmar Egreso
            </Button>
          </>
        }
      >
        <Input
          label="Monto Retirado ($ COP)"
          type="number"
          value={egresoMonto}
          onChange={(e) => setEgresoMonto(e.target.value)}
          placeholder="Ej. 15000"
          required
        />
        <Input
          label="Justificación o Motivo Obligatorio"
          placeholder="Ej. Compra de botellones de agua para dispensador..."
          value={egresoMotivo}
          onChange={(e) => setEgresoMotivo(e.target.value)}
          required
        />
      </Modal>
    </div>
  );
};
