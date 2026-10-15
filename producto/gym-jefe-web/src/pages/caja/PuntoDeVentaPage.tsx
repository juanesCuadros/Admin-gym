import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingCart, Trash2, Ticket, CalendarDays, Receipt, PackageSearch } from 'lucide-react';
import { inventarioService } from '../../api/inventario.service';
import { myGymService } from '../../api/myGym.service';
import { cajaService } from '../../api/caja.service';
import { toApiError, ApiError } from '../../api/client';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { BuscadorDeportista } from '../../components/ui/BuscadorDeportista';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { formatCOP, formatFechaHora } from '../../utils/formato';
import type { ProductoResponse } from '../../types/inventario.types';
import type { InfoGymResponse } from '../../types/myGym.types';
import type { VentaItemRequest, VentaResponseDto } from '../../types/caja.types';
import type { DeportistaBusquedaItem } from '../../types/comun.types';

/** Línea del carrito. Los productos toman el precio de lista; los pases, el precio que se digita. */
interface LineaCarrito {
  clave: string;
  tipo: 'producto' | 'pase_dia' | 'pase_clase';
  producto?: ProductoResponse;
  descripcion: string;
  cantidad: number;
  /** Precio de lista (producto) o precio digitado (pase), en COP enteros. */
  precio: number;
  /** Contrato 1.2: precio cobrado si hay descuento. Vacío = precio de lista. */
  precioCobrado: string;
  motivoDescuento: string;
}

const PRODUCTOS_POR_PAGINA = 20;

const ETIQUETA_PASE = { pase_dia: 'Pase de día', pase_clase: 'Pase de clase' } as const;

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** `efectivo` → efectivo; cualquier otro método → otro (datáfono, Nequi, transferencia...). */
function tipoMedioDe(metodo: string): 'efectivo' | 'otro' {
  return metodo.trim().toLowerCase() === 'efectivo' ? 'efectivo' : 'otro';
}

/**
 * Punto de venta (GW-RF-11, GW-RF-38, GW-RF-53).
 * `POST /caja/ventas` con `X-Idempotency-Key`: el reintento conserva la clave; cambiar el carrito la renueva.
 */
export const PuntoDeVentaPage: React.FC = () => {
  // Turno único (contrato 1.1): solo se vende sobre el turno propio; el de otra persona hay que cerrarlo en Caja.
  const {
    turno,
    turnoAbierto: hayTurnoEnGimnasio,
    turnoPropio: turnoAbierto,
    cargando: cargandoTurno,
    error: errorTurno,
    refrescar: refrescarTurno,
  } = useCajaTurno();
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeVender = hasPermission('caja', 'crear');
  // Consultas auxiliares solo con permiso: un 403 de permiso saca al usuario de la vista (interceptor).
  const puedeVerInventario = hasPermission('inventario', 'leer');
  const puedeVerConfig = hasPermission('configuracion', 'leer');

  // Catálogo
  const [busqueda, setBusqueda] = useState('');
  const [productos, setProductos] = useState<ProductoResponse[]>([]);
  const [cargandoProductos, setCargandoProductos] = useState(true);
  const [errorProductos, setErrorProductos] = useState<unknown>(null);

  // Configuración del gimnasio (métodos de pago y descuentos). Puede fallar por permiso: no bloquea la venta.
  const [info, setInfo] = useState<InfoGymResponse | null>(null);

  // Venta
  const [lineas, setLineas] = useState<LineaCarrito[]>([]);
  const [cliente, setCliente] = useState<DeportistaBusquedaItem | null>(null);
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoMedioManual, setTipoMedioManual] = useState<'efectivo' | 'otro'>('efectivo');
  const [valorRecibido, setValorRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorVenta, setErrorVenta] = useState<ApiError | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<VentaResponseDto | null>(null);

  const metodosConfigurados = info?.metodos_pago?.length ? info.metodos_pago : null;
  const descuentosPermitidos = info?.permitir_descuentos === true;
  const topeDescuento = info?.tope_descuento_pct;
  const tipoMedio = metodosConfigurados ? tipoMedioDe(metodo) : tipoMedioManual;

  const cargarProductos = useCallback(async (texto: string) => {
    if (!puedeVerInventario) {
      setProductos([]);
      setCargandoProductos(false);
      return;
    }
    setCargandoProductos(true);
    try {
      const res = await inventarioService.listarProductos({
        activo: true,
        buscar: texto.trim() || undefined,
        limit: PRODUCTOS_POR_PAGINA,
        offset: 0,
      });
      setProductos(res.items);
      setErrorProductos(null);
    } catch (e) {
      setErrorProductos(e);
    } finally {
      setCargandoProductos(false);
    }
  }, [puedeVerInventario]);

  useEffect(() => {
    const t = window.setTimeout(() => cargarProductos(busqueda), 300);
    return () => window.clearTimeout(t);
  }, [busqueda, cargarProductos]);

  useEffect(() => {
    if (!puedeVerConfig) return;
    myGymService
      .getInfo()
      .then((i) => {
        setInfo(i);
        if (i.metodos_pago?.length) {
          setMetodo(i.metodos_pago.find((m) => m.toLowerCase() === 'efectivo') ?? i.metodos_pago[0]);
        }
      })
      .catch(() => setInfo(null));
  }, [puedeVerConfig]);

  // Cualquier cambio en lo que se cobra invalida la clave anterior (es otra operación).
  useEffect(() => {
    setIdempotencyKey(null);
  }, [lineas, cliente, metodo, tipoMedioManual, valorRecibido]);

  const precioFinal = (l: LineaCarrito): number => {
    const cobrado = descuentosPermitidos && l.tipo === 'producto' ? entero(l.precioCobrado) : null;
    return cobrado ?? l.precio;
  };

  const total = lineas.reduce((acc, l) => acc + precioFinal(l) * l.cantidad, 0);

  const recibido = entero(valorRecibido);
  const cambio = tipoMedio === 'efectivo' && recibido !== null ? recibido - total : null;

  // ---- Validaciones de la UI (el backend vuelve a validar todo) ----
  const erroresLinea = (l: LineaCarrito): string | null => {
    if (l.cantidad < 1) return 'La cantidad debe ser al menos 1.';
    if (l.tipo === 'producto' && l.producto && l.cantidad > l.producto.stock)
      return `Solo hay ${l.producto.stock} en stock.`;
    if (l.tipo !== 'producto' && (!Number.isFinite(l.precio) || l.precio <= 0)) return 'Escribe el precio del pase.';
    if (descuentosPermitidos && l.tipo === 'producto' && l.precioCobrado.trim() !== '') {
      const c = entero(l.precioCobrado);
      if (c === null || c < 0) return 'El precio cobrado no es válido.';
      if (c > l.precio) return 'El precio cobrado no puede superar el precio de lista.';
      if (c < l.precio) {
        if (topeDescuento !== undefined && ((l.precio - c) / l.precio) * 100 > topeDescuento)
          return `El descuento supera el tope del gimnasio (${topeDescuento} %).`;
        if (!l.motivoDescuento.trim()) return 'El descuento exige un motivo.';
      }
    }
    return null;
  };

  const hayErroresLineas = lineas.some((l) => erroresLinea(l) !== null);
  const errorRecibido =
    tipoMedio === 'efectivo' && recibido !== null && recibido < total
      ? 'El valor recibido es menor al total. No se aceptan abonos.'
      : null;
  const metodoVacio = !metodo.trim();
  const puedeCobrar =
    puedeVender && turnoAbierto && lineas.length > 0 && !hayErroresLineas && !errorRecibido && !metodoVacio && !enviando;

  // ---- Carrito ----
  const agregarProducto = (p: ProductoResponse) => {
    setRecibo(null);
    setLineas((prev) => {
      const existente = prev.find((l) => l.tipo === 'producto' && l.producto?.id === p.id);
      if (existente) {
        return prev.map((l) => (l === existente ? { ...l, cantidad: Math.min(l.cantidad + 1, p.stock) } : l));
      }
      return [
        ...prev,
        {
          clave: `p-${p.id}`,
          tipo: 'producto',
          producto: p,
          descripcion: p.nombre,
          cantidad: 1,
          precio: Math.round(Number(p.precio)),
          precioCobrado: '',
          motivoDescuento: '',
        },
      ];
    });
  };

  const agregarPase = (tipo: 'pase_dia' | 'pase_clase') => {
    setRecibo(null);
    setLineas((prev) => [
      ...prev,
      {
        clave: `${tipo}-${crypto.randomUUID()}`,
        tipo,
        descripcion: ETIQUETA_PASE[tipo],
        cantidad: 1,
        precio: 0,
        precioCobrado: '',
        motivoDescuento: '',
      },
    ]);
  };

  const actualizarLinea = (clave: string, cambios: Partial<LineaCarrito>) =>
    setLineas((prev) => prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));

  const quitarLinea = (clave: string) => setLineas((prev) => prev.filter((l) => l.clave !== clave));

  const limpiarVenta = () => {
    setLineas([]);
    setCliente(null);
    setValorRecibido('');
    setErrorVenta(null);
    setIdempotencyKey(null);
  };

  // ---- Cobro ----
  const cobrar = async () => {
    if (!puedeCobrar) return;
    const clave = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(clave);
    setEnviando(true);
    setErrorVenta(null);

    const items: VentaItemRequest[] = lineas.map((l) => {
      const item: VentaItemRequest = {
        tipo: l.tipo,
        descripcion: l.descripcion.trim(),
        cantidad: l.cantidad,
      };
      if (l.tipo === 'producto') {
        item.producto_id = l.producto?.id;
        const cobrado = descuentosPermitidos ? entero(l.precioCobrado) : null;
        if (cobrado !== null && cobrado < l.precio) {
          item.precio_cobrado = cobrado;
          item.motivo_descuento = l.motivoDescuento.trim();
        }
      } else {
        item.precio_unitario = l.precio;
      }
      return item;
    });

    try {
      const venta = await cajaService.registrarVenta(
        {
          deportista_id: cliente?.id,
          metodo: metodo.trim(),
          tipo_medio: tipoMedio,
          valor_recibido: tipoMedio === 'efectivo' && recibido !== null ? recibido : undefined,
          items,
        },
        clave
      );
      setRecibo(venta);
      setLineas([]);
      setCliente(null);
      setValorRecibido('');
      setIdempotencyKey(null);
      showToast('success', 'Venta registrada', `Total ${formatCOP(venta.total)}`);
      refrescarTurno();
      cargarProductos(busqueda);
    } catch (e) {
      // La clave se conserva: si el usuario reintenta sin cambiar nada, no se cobra dos veces.
      const err = toApiError(e);
      setErrorVenta(err);
      if (err.status === 409) refrescarTurno();
    } finally {
      setEnviando(false);
    }
  };

  // ---- Render ----
  if (cargandoTurno) return <Cargando />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Punto de venta</h1>
          <p className="page-subtitle">Venta de productos y pases ligada al turno de caja abierto</p>
        </div>
        {turno && turnoAbierto && (
          <Badge variant="success" dot>
            Turno abierto desde {formatFechaHora(turno.abierto_en)}
          </Badge>
        )}
      </div>

      {errorTurno && <ErrorCarga error={errorTurno} onReintentar={refrescarTurno} />}

      {!errorTurno && hayTurnoEnGimnasio && !turnoAbierto && turno && (
        <MensajeFijo
          tono="advertencia"
          titulo={`La caja está abierta por ${turno.abierto_por_nombre ?? turno.staff_nombre ?? 'otra persona'}`}
          accion={
            <Link to="/caja" className="btn btn-primary btn-sm">
              Ir a caja
            </Link>
          }
          style={{ marginBottom: 20 }}
        >
          Solo puede haber un turno abierto en el gimnasio. Para vender con tu usuario, cierra ese turno desde Caja y abre el
          tuyo.
        </MensajeFijo>
      )}

      {!errorTurno && !hayTurnoEnGimnasio && (
        <MensajeFijo
          tono="advertencia"
          titulo="No hay un turno de caja abierto"
          accion={
            <Link to="/caja" className="btn btn-primary btn-sm">
              Ir a caja
            </Link>
          }
          style={{ marginBottom: 20 }}
        >
          Para vender hay que abrir el turno primero. La API rechaza cualquier venta sin turno abierto.
        </MensajeFijo>
      )}

      {!puedeVender && (
        <MensajeFijo tono="info" style={{ marginBottom: 20 }}>
          Puedes consultar el catálogo, pero no tienes permiso para registrar ventas.
        </MensajeFijo>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        {/* Catálogo */}
        <Card title="Catálogo">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <SearchInput
              placeholder="Buscar producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              aria-label="Buscar producto"
            />
            <Button variant="outline" size="sm" leftIcon={<CalendarDays size={14} />} onClick={() => agregarPase('pase_dia')} disabled={!turnoAbierto}>
              Pase de día
            </Button>
            <Button variant="outline" size="sm" leftIcon={<Ticket size={14} />} onClick={() => agregarPase('pase_clase')} disabled={!turnoAbierto}>
              Pase de clase
            </Button>
          </div>

          {!puedeVerInventario ? (
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              No tienes permiso para ver el inventario. Puedes vender pases de día y de clase.
            </p>
          ) : cargandoProductos ? (
            <Cargando filas={5} alto={40} />
          ) : errorProductos ? (
            <ErrorCarga error={errorProductos} onReintentar={() => cargarProductos(busqueda)} />
          ) : productos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--text-secondary)' }}>
              <PackageSearch size={32} color="var(--text-muted)" style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 600 }}>
                {busqueda.trim() ? 'No hay productos activos con ese nombre' : 'No hay productos activos'}
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                {busqueda.trim() ? (
                  <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setBusqueda('')}>
                    Limpiar búsqueda
                  </button>
                ) : (
                  'Los productos se crean en Inventario · Productos.'
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {productos.map((p) => {
                const agotado = p.stock <= 0;
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                      <div style={{ fontSize: '0.8rem', color: agotado ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {agotado ? 'Agotado' : `Stock: ${p.stock}`}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700 }}>{formatCOP(p.precio)}</div>
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Plus size={14} />}
                      disabled={agotado || !turnoAbierto}
                      onClick={() => agregarProducto(p)}
                    >
                      Agregar
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Venta */}
        <Card title="Venta actual">
          {recibo && (
            <MensajeFijo
              tono="info"
              titulo={`Venta registrada · ${formatCOP(recibo.total)}`}
              style={{ marginBottom: 16 }}
              accion={
                <Button variant="ghost" size="sm" onClick={() => setRecibo(null)}>
                  Cerrar
                </Button>
              }
            >
              <div>
                {formatFechaHora(recibo.created_at)} · {recibo.metodo}
                {recibo.cambio_devuelto !== null && recibo.cambio_devuelto !== undefined && Number(recibo.cambio_devuelto) > 0 && (
                  <> · Cambio: <strong>{formatCOP(recibo.cambio_devuelto)}</strong></>
                )}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {recibo.items.map((it) => (
                  <li key={it.id}>
                    {it.cantidad} × {it.descripcion} · {formatCOP(it.subtotal)}
                  </li>
                ))}
              </ul>
            </MensajeFijo>
          )}

          {lineas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--text-secondary)' }}>
              <ShoppingCart size={32} color="var(--text-muted)" style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 600 }}>La venta está vacía</div>
              <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Agrega productos del catálogo o un pase.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {lineas.map((l) => {
                const err = erroresLinea(l);
                const max = l.tipo === 'producto' ? l.producto?.stock ?? 1 : 999;
                return (
                  <div key={l.clave} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, fontWeight: 600 }}>{l.descripcion}</div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Restar uno"
                        onClick={() => actualizarLinea(l.clave, { cantidad: Math.max(1, l.cantidad - 1) })}
                        disabled={l.cantidad <= 1}
                      >
                        <Minus size={14} />
                      </Button>
                      <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{l.cantidad}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Sumar uno"
                        onClick={() => actualizarLinea(l.clave, { cantidad: Math.min(max, l.cantidad + 1) })}
                        disabled={l.cantidad >= max}
                      >
                        <Plus size={14} />
                      </Button>
                      <div style={{ minWidth: 90, textAlign: 'right', fontWeight: 700 }}>
                        {formatCOP(precioFinal(l) * l.cantidad)}
                      </div>
                      <Button variant="ghost" size="sm" aria-label="Quitar" onClick={() => quitarLinea(l.clave)}>
                        <Trash2 size={14} color="var(--danger)" />
                      </Button>
                    </div>

                    {l.tipo === 'producto' ? (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        Precio de lista: {formatCOP(l.precio)}
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, maxWidth: 220 }}>
                        <Input
                          label="Precio del pase (COP)"
                          type="number"
                          min={0}
                          step={100}
                          value={l.precio ? String(l.precio) : ''}
                          onChange={(e) => actualizarLinea(l.clave, { precio: entero(e.target.value) ?? 0 })}
                        />
                      </div>
                    )}

                    {descuentosPermitidos && l.tipo === 'producto' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginTop: 8 }}>
                        <Input
                          label="Precio cobrado"
                          type="number"
                          min={0}
                          step={100}
                          placeholder={String(l.precio)}
                          value={l.precioCobrado}
                          onChange={(e) => actualizarLinea(l.clave, { precioCobrado: e.target.value })}
                        />
                        <Input
                          label="Motivo del descuento"
                          value={l.motivoDescuento}
                          maxLength={255}
                          disabled={!(entero(l.precioCobrado) !== null && (entero(l.precioCobrado) ?? 0) < l.precio)}
                          onChange={(e) => actualizarLinea(l.clave, { motivoDescuento: e.target.value })}
                        />
                      </div>
                    )}

                    {err && <span className="form-error-msg">{err}</span>}
                  </div>
                );
              })}
            </div>
          )}

          <BuscadorDeportista
            label="Cliente (opcional)"
            seleccionado={cliente}
            onSeleccionar={setCliente}
            disabled={enviando}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {metodosConfigurados ? (
              <Select
                label="Método de pago"
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                options={metodosConfigurados.map((m) => ({ value: m, label: m }))}
              />
            ) : (
              <>
                <Input
                  label="Método de pago"
                  value={metodo}
                  maxLength={50}
                  onChange={(e) => setMetodo(e.target.value)}
                  error={metodoVacio ? 'Escribe el método de pago.' : undefined}
                />
                <Select
                  label="Tipo de medio"
                  value={tipoMedioManual}
                  onChange={(e) => setTipoMedioManual(e.target.value as 'efectivo' | 'otro')}
                  options={[
                    { value: 'efectivo', label: 'Efectivo' },
                    { value: 'otro', label: 'Otro medio' },
                  ]}
                />
              </>
            )}
            {tipoMedio === 'efectivo' && (
              <Input
                label="Valor recibido (opcional)"
                type="number"
                min={0}
                step={100}
                value={valorRecibido}
                onChange={(e) => setValorRecibido(e.target.value)}
                error={errorRecibido ?? undefined}
              />
            )}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              borderTop: '1px solid var(--border-color)',
              paddingTop: 12,
              marginTop: 4,
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>Total</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>{formatCOP(total)}</span>
          </div>
          {cambio !== null && cambio >= 0 && (
            <div style={{ textAlign: 'right', color: 'var(--text-secondary)', marginTop: 2 }}>
              Cambio: <strong>{formatCOP(cambio)}</strong>
            </div>
          )}

          {errorVenta && (
            <MensajeFijo tono="error" titulo="No se registró la venta" style={{ marginTop: 12 }}>
              {errorVenta.message}
              {Object.keys(errorVenta.campos).length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {Object.entries(errorVenta.campos).map(([campo, msg]) => (
                    <li key={campo}>
                      {campo}: {msg}
                    </li>
                  ))}
                </ul>
              )}
              {idempotencyKey && errorVenta.tipo === 'red' && (
                <div style={{ marginTop: 4 }}>Puedes reintentar: si la venta sí quedó registrada, no se cobrará dos veces.</div>
              )}
            </MensajeFijo>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="outline" onClick={limpiarVenta} disabled={enviando || lineas.length === 0}>
              Vaciar
            </Button>
            <Button
              variant="primary"
              leftIcon={<Receipt size={16} />}
              onClick={cobrar}
              isLoading={enviando}
              disabled={!puedeCobrar}
            >
              Cobrar {lineas.length > 0 ? formatCOP(total) : ''}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};
