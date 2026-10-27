import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingCart, Trash2, Ticket, CalendarDays, Receipt, PackageSearch, Package, Search, X } from 'lucide-react';
import { inventarioService } from '../../api/inventario.service';
import { myGymService } from '../../api/myGym.service';
import { cajaService } from '../../api/caja.service';
import { toApiError, ApiError } from '../../api/client';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
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
  // Tablet/móvil: la venta es un panel que sube desde abajo.
  const [ventaAbierta, setVentaAbierta] = useState(false);

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
      setVentaAbierta(true);
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
  const unidades = lineas.reduce((acc, l) => acc + l.cantidad, 0);
  const cantidadEnVenta = (id: string) =>
    lineas.find((l) => l.tipo === 'producto' && l.producto?.id === id)?.cantidad ?? 0;
  /** Con pocos métodos configurados se muestran como botones; con muchos, como lista. */
  const metodosComoBotones = !!metodosConfigurados && metodosConfigurados.length <= 4;

  if (cargandoTurno) return <Cargando />;

  return (
    <div className="pos-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Punto de venta</h1>
          <p className="page-subtitle">
            {turno && turnoAbierto
              ? `Turno abierto desde ${formatFechaHora(turno.abierto_en)}`
              : 'Venta de productos y pases ligada al turno de caja abierto'}
          </p>
        </div>
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
          Para vender hay que abrir el turno primero.
        </MensajeFijo>
      )}

      {!puedeVender && (
        <MensajeFijo tono="info" style={{ marginBottom: 20 }}>
          Puedes consultar el catálogo, pero no tienes permiso para registrar ventas.
        </MensajeFijo>
      )}

      <div className="pos-layout">
        {/* ---------- Catálogo ---------- */}
        <section aria-label="Catálogo">
          <div className="pos-catalogo-head">
            <div className="pos-buscar">
              <Search size={16} />
              <input
                className="form-input"
                placeholder="Buscar producto"
                aria-label="Buscar producto"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
            <Button variant="secondary" size="sm" leftIcon={<CalendarDays size={14} />} onClick={() => agregarPase('pase_dia')} disabled={!turnoAbierto}>
              Pase de día
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Ticket size={14} />} onClick={() => agregarPase('pase_clase')} disabled={!turnoAbierto}>
              Pase de clase
            </Button>
          </div>

          {!puedeVerInventario ? (
            <MensajeFijo tono="info">No tienes permiso para ver el inventario. Puedes vender pases de día y de clase.</MensajeFijo>
          ) : cargandoProductos ? (
            <Cargando filas={4} alto={120} />
          ) : errorProductos ? (
            <ErrorCarga error={errorProductos} onReintentar={() => cargarProductos(busqueda)} />
          ) : productos.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state-icon">
                <PackageSearch size={22} />
              </div>
              <div className="empty-state-title">
                {busqueda.trim() ? 'No hay productos activos con ese nombre' : 'No hay productos activos'}
              </div>
              {busqueda.trim() ? (
                <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => setBusqueda('')}>
                  Limpiar búsqueda
                </button>
              ) : (
                <p className="empty-state-text">Los productos se crean en Inventario · Productos.</p>
              )}
            </div>
          ) : (
            <div className="producto-grid">
              {productos.map((p) => {
                const agotado = p.stock <= 0;
                const enVenta = cantidadEnVenta(p.id);
                const sinMasStock = enVenta >= p.stock;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`producto ${enVenta > 0 ? 'en-venta' : ''}`}
                    disabled={agotado || !turnoAbierto || sinMasStock}
                    onClick={() => agregarProducto(p)}
                    aria-label={`Agregar ${p.nombre}`}
                  >
                    {enVenta > 0 && <span className="producto-cantidad">{enVenta}</span>}
                    <span className="producto-icono">
                      <Package size={22} />
                    </span>
                    <span className="producto-nombre">{p.nombre}</span>
                    <span className="producto-fila">
                      <span className="producto-precio">{formatCOP(p.precio)}</span>
                      <span className={`producto-stock ${agotado ? 'agotado' : ''}`}>
                        {agotado ? 'Agotado' : `${p.stock} en stock`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- Venta actual ---------- */}
        <div className={`venta-overlay ${ventaAbierta ? 'abierta' : ''}`} onClick={() => setVentaAbierta(false)} aria-hidden="true" />
        <aside className={`venta ${ventaAbierta ? 'abierta' : ''}`} aria-label="Venta actual">
          <div className="venta-head">
            <ShoppingCart size={18} />
            <h3>Venta actual</h3>
            <Badge variant="neutral">
              {unidades} {unidades === 1 ? 'ítem' : 'ítems'}
            </Badge>
            {lineas.length > 0 && (
              <Button variant="ghost" size="sm" onClick={limpiarVenta} disabled={enviando}>
                Vaciar
              </Button>
            )}
            <button
              type="button"
              className="icon-btn ghost venta-cerrar-movil"
              onClick={() => setVentaAbierta(false)}
              aria-label="Cerrar venta"
            >
              <X size={18} />
            </button>
          </div>

          <div className="venta-scroll">
            {recibo && (
              <div style={{ padding: '14px 18px 0' }}>
                <MensajeFijo
                  tono="info"
                  titulo={`Venta registrada · ${formatCOP(recibo.total)}`}
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
              </div>
            )}

            <div className="venta-items">
              {lineas.length === 0 ? (
                <div className="venta-vacia">
                  <ShoppingCart size={26} />
                  <div>Toca un producto o agrega un pase.</div>
                </div>
              ) : (
                lineas.map((l) => {
                  const err = erroresLinea(l);
                  const max = l.tipo === 'producto' ? l.producto?.stock ?? 1 : 999;
                  return (
                    <div key={l.clave} className="linea">
                      <div className="linea-top">
                        <div className="linea-nombre">
                          {l.descripcion}
                          {l.tipo === 'producto' && <small>{formatCOP(l.precio)} c/u</small>}
                        </div>
                        <div className="cantidad">
                          {l.cantidad <= 1 ? (
                            <button type="button" aria-label="Quitar" onClick={() => quitarLinea(l.clave)}>
                              <Trash2 size={14} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label="Restar uno"
                              onClick={() => actualizarLinea(l.clave, { cantidad: Math.max(1, l.cantidad - 1) })}
                            >
                              <Minus size={14} />
                            </button>
                          )}
                          <span>{l.cantidad}</span>
                          <button
                            type="button"
                            aria-label="Sumar uno"
                            onClick={() => actualizarLinea(l.clave, { cantidad: Math.min(max, l.cantidad + 1) })}
                            disabled={l.cantidad >= max}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="linea-total">{formatCOP(precioFinal(l) * l.cantidad)}</div>
                      </div>

                      {l.tipo !== 'producto' && (
                        <div className="linea-extra uno">
                          <Input
                            label="Precio del pase (COP)"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={100}
                            value={l.precio ? String(l.precio) : ''}
                            onChange={(e) => actualizarLinea(l.clave, { precio: entero(e.target.value) ?? 0 })}
                          />
                        </div>
                      )}

                      {descuentosPermitidos && l.tipo === 'producto' && (
                        <div className="linea-extra">
                          <Input
                            label="Precio cobrado"
                            type="number"
                            inputMode="numeric"
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
                })
              )}
            </div>
          </div>

          <div className="venta-pago">
              <BuscadorDeportista
                label="Cliente (opcional)"
                seleccionado={cliente}
                onSeleccionar={setCliente}
                disabled={enviando}
              />

              {metodosConfigurados ? (
                metodosComoBotones ? (
                  <div className="form-group" role="radiogroup" aria-label="Método de pago">
                    <span className="form-label">Método de pago</span>
                    <div className="segmented">
                      {metodosConfigurados.map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={metodo === m}
                          className={metodo === m ? 'active' : ''}
                          onClick={() => setMetodo(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Select
                    label="Método de pago"
                    value={metodo}
                    onChange={(e) => setMetodo(e.target.value)}
                    options={metodosConfigurados.map((m) => ({ value: m, label: m }))}
                  />
                )
              ) : (
                <>
                  <Input
                    label="Método de pago"
                    value={metodo}
                    maxLength={50}
                    onChange={(e) => setMetodo(e.target.value)}
                    error={metodoVacio ? 'Escribe el método de pago.' : undefined}
                  />
                  <div className="form-group" role="radiogroup" aria-label="Tipo de medio">
                    <span className="form-label">Tipo de medio</span>
                    <div className="segmented">
                      {(
                        [
                          ['efectivo', 'Efectivo'],
                          ['otro', 'Otro medio'],
                        ] as const
                      ).map(([valor, texto]) => (
                        <button
                          key={valor}
                          type="button"
                          role="radio"
                          aria-checked={tipoMedioManual === valor}
                          className={tipoMedioManual === valor ? 'active' : ''}
                          onClick={() => setTipoMedioManual(valor)}
                        >
                          {texto}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tipoMedio === 'efectivo' && (
                <>
                  <Input
                    label="Valor recibido (opcional)"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={100}
                    value={valorRecibido}
                    onChange={(e) => setValorRecibido(e.target.value)}
                    error={errorRecibido ?? undefined}
                  />
                  {cambio !== null && cambio >= 0 && (
                    <div className="venta-linea">
                      <span>Cambio</span>
                      <span>{formatCOP(cambio)}</span>
                    </div>
                  )}
                </>
              )}

              <div className="venta-total">
                <span>Total</span>
                <strong>{formatCOP(total)}</strong>
              </div>

              {errorVenta && (
                <MensajeFijo tono="error" titulo="No se registró la venta">
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

              <Button
                variant="primary"
                size="lg"
                className="venta-cobrar"
                leftIcon={<Receipt size={17} />}
                onClick={cobrar}
                isLoading={enviando}
                disabled={!puedeCobrar}
              >
                Cobrar {lineas.length > 0 ? formatCOP(total) : ''}
              </Button>
          </div>
        </aside>
      </div>

      {/* Barra inferior (tablet y móvil) */}
      <button type="button" className="venta-barra" onClick={() => setVentaAbierta(true)}>
        <ShoppingCart size={18} />
        <span>{unidades > 0 ? `Ver venta · ${unidades} ${unidades === 1 ? 'ítem' : 'ítems'}` : recibo ? 'Ver última venta' : 'Venta vacía'}</span>
        <strong>{formatCOP(total)}</strong>
      </button>
    </div>
  );
};
