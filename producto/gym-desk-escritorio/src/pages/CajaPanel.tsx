import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CloudOff,
  Lock,
  MinusCircle,
  Plus,
  Search,
  ShoppingCart,
  Ticket,
  Trash2,
  Unlock,
  UserRound,
  X,
} from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Button } from '@web/components/ui/Button';
import { Input, Select, Textarea } from '@web/components/ui/Input';
import { ConfirmDialog, Modal } from '@web/components/ui/Modal';
import { filasIniciales, mediosDeFilas, PagoDividido, repartoCompleto, efectivoDeFilas, type FilaMedio } from '@web/components/ui/PagoDividido';
import { useToast } from '@web/contexts/ToastContext';
import { formatCOP, formatDocumento, formatHora } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { ingresoService } from '../api/ingreso.service';
import { aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import { useEnvio } from '../hooks/useEnvio';
import type { EstadoCaja, MovimientoCaja, NuevoItem, ProductoVenta, ResumenTurno, TipoLinea, VentaRegistrada } from '../types/caja.types';
import type { ClienteEvaluado } from '../types/ingreso.types';
import { CierreDiarioPanel } from './CierreDiarioPanel';

const MOTIVO_MINIMO = 4;

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

interface Linea {
  clave: string;
  tipo: TipoLinea;
  producto?: ProductoVenta;
  descripcion: string;
  cantidad: number;
  /** Precio de lista; null = pase sin precio configurado, se escribe al cobrar. */
  precioLista: number | null;
  precioEscrito: string;
  precioCobrado: string;
  motivo: string;
}

const ENVIO: Record<string, { texto: string; tono: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  aplicada: { texto: 'En el servidor', tono: 'success' },
  pendiente: { texto: 'Por subir', tono: 'neutral' },
  enviando: { texto: 'Subiendo', tono: 'neutral' },
  retenida: { texto: 'En espera', tono: 'warning' },
  pendiente_revision: { texto: 'Por revisar', tono: 'warning' },
  error: { texto: 'Con error', tono: 'danger' },
};

const precioDe = (l: Linea) => l.precioLista ?? entero(l.precioEscrito) ?? 0;
const cobradoDe = (l: Linea) => entero(l.precioCobrado) ?? precioDe(l);

/** Caja de la estación: turno con arqueo, venta de mostrador y egresos. Funciona con red o sin ella. */
export const CajaPanel: React.FC<{ enLinea: boolean }> = ({ enLinea }) => {
  const { showToast } = useToast();
  const [estado, setEstado] = useState<EstadoCaja | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([]);
  const [vista, setVista] = useState<'turno' | 'cierre'>('turno');

  const cargar = useCallback(async () => {
    try {
      const e = await cajaService.estado();
      setEstado(e);
      setMovimientos(e.turno ? await cajaService.movimientos() : []);
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(aErrorGymDesk(err).mensaje);
    }
  }, []);

  useEffect(() => {
    void cargar();
    // El estado del envío de cada movimiento cambia al sincronizar.
    const t = window.setInterval(() => void cargar(), 15_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  if (errorCarga) return <MensajeError>{errorCarga}</MensajeError>;
  if (!estado) return <div className="skeleton" style={{ height: 220, borderRadius: 16, maxWidth: 980 }} />;

  return (
    <div className="gd-caja">
      <div className="gd-pestanas gd-pestanas-caja" role="tablist" aria-label="Caja">
        <button role="tab" aria-selected={vista === 'turno'} className={vista === 'turno' ? 'activa' : ''} onClick={() => setVista('turno')}>
          Turno y mostrador
        </button>
        <button role="tab" aria-selected={vista === 'cierre'} className={vista === 'cierre' ? 'activa' : ''} onClick={() => setVista('cierre')}>
          Cierre diario
        </button>
      </div>
      {vista === 'cierre' ? (
        <CierreDiarioPanel />
      ) : estado.turno ? (
        <TurnoAbierto estado={estado} turno={estado.turno} movimientos={movimientos} onCambio={cargar} />
      ) : (
        <AbrirCaja puedeOperar={estado.mostrador.puede_operar} enLinea={enLinea} onAbierta={(sinConfirmar) => {
          showToast(
            sinConfirmar ? 'warning' : 'success',
            'Caja abierta',
            sinConfirmar
              ? 'Sin red no se pudo confirmar que no haya otra caja abierta. Si la había, quedará por revisar.'
              : 'Quedó lista para vender.'
          );
          void cargar();
        }} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Abrir
// ---------------------------------------------------------------------------
const AbrirCaja: React.FC<{ puedeOperar: boolean; enLinea: boolean; onAbierta: (sinConfirmar: boolean) => void }> = ({
  puedeOperar,
  enLinea,
  onAbierta,
}) => {
  const [base, setBase] = useState('');
  const envio = useEnvio();
  const valor = entero(base);

  if (!puedeOperar) {
    return (
      <section className="gd-panel">
        <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>Caja cerrada</h2>
        <p className="gd-subtitulo">No tienes permiso de caja en este gimnasio. Pídeselo al Jefe.</p>
      </section>
    );
  }
  return (
    <section className="gd-panel" style={{ maxWidth: 460 }}>
      <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>
        <Unlock size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
        Abrir caja
      </h2>
      <p className="gd-subtitulo">El efectivo con el que empieza el turno para dar cambio. Si no hay base, escribe 0.</p>
      {!enLinea && (
        <div className="gd-aviso" role="status">
          <CloudOff size={16} style={{ flexShrink: 0 }} />
          <span>
            Sin conexión: la caja se abre igual, pero no se puede confirmar que no haya otra abierta en la web u otra estación.
          </span>
        </div>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (valor === null || valor < 0) return;
          void envio.enviar(async () => {
            const r = await cajaService.abrirTurno(valor);
            onAbierta(r.turno.sin_confirmar);
          });
        }}
      >
        <Input id="caja-base" label="Base inicial en efectivo (COP)" moneda value={base} onChange={(e) => setBase(e.target.value)} disabled={envio.enviando} />
        {envio.error && <MensajeError>{envio.error}</MensajeError>}
        <Button type="submit" isLoading={envio.enviando} disabled={valor === null || valor < 0} style={{ marginTop: 12 }}>
          Abrir caja
        </Button>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Turno abierto
// ---------------------------------------------------------------------------
const TurnoAbierto: React.FC<{ estado: EstadoCaja; turno: ResumenTurno; movimientos: MovimientoCaja[]; onCambio: () => Promise<void> }> = ({
  estado,
  turno,
  movimientos,
  onCambio,
}) => {
  const { showToast } = useToast();
  const t = turno.totales;
  const [egresoAbierto, setEgresoAbierto] = useState(false);
  const [cerrarAbierto, setCerrarAbierto] = useState(false);

  return (
    <>
      {turno.turno.sin_confirmar && (
        <div className="gd-aviso" role="status" style={{ maxWidth: 980 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>
            Esta caja se abrió sin red: no se pudo confirmar que no hubiera otra abierta. Si la había, el turno quedará por revisar al sincronizar.
          </span>
        </div>
      )}
      <section className="gd-panel gd-caja-resumen">
        <div className="gd-panel-encabezado">
          <div>
            <h2 className="gd-titulo" style={{ fontSize: '1.15rem', marginBottom: 2 }}>Caja abierta</h2>
            <p className="gd-subtitulo" style={{ margin: 0 }}>
              Desde las {formatHora(turno.turno.abierto_en)} por {turno.turno.abierto_por_nombre ?? 'el personal'}
            </p>
          </div>
          <div className="gd-panel-acciones">
            <Button variant="outline" size="sm" leftIcon={<MinusCircle size={15} />} onClick={() => setEgresoAbierto(true)}>
              Registrar egreso
            </Button>
            <Button variant="outline" size="sm" leftIcon={<Lock size={15} />} onClick={() => setCerrarAbierto(true)}>
              Cerrar caja
            </Button>
          </div>
        </div>
        <dl className="gd-caja-cifras">
          <div><dt>Base</dt><dd>{formatCOP(t.base_inicial)}</dd></div>
          <div><dt>Efectivo cobrado</dt><dd>{formatCOP(t.ventas_efectivo)}</dd></div>
          <div><dt>Otros medios</dt><dd>{formatCOP(t.ventas_otro)}</dd></div>
          <div><dt>Egresos</dt><dd>−{formatCOP(t.egresos_efectivo)}</dd></div>
          <div className="gd-caja-esperado"><dt>Efectivo esperado</dt><dd>{formatCOP(t.total_esperado_efectivo)}</dd></div>
        </dl>
      </section>

      <Mostrador mostrador={estado.mostrador} onVendida={(v) => {
        showToast('success', 'Venta registrada', v.cambio ? `Total ${formatCOP(v.total)} · cambio ${formatCOP(v.cambio)}` : `Total ${formatCOP(v.total)}`);
        void onCambio();
      }} />

      <section className="gd-panel" style={{ marginTop: 16 }}>
        <h3 className="gd-titulo" style={{ fontSize: '1rem' }}>Movimientos del turno</h3>
        {movimientos.length === 0 ? (
          <p className="gd-vacio">Todavía no hay ventas ni egresos en este turno.</p>
        ) : (
          <table className="gd-tabla">
            <thead>
              <tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>Medio</th><th style={{ textAlign: 'right' }}>Monto</th><th>Envío</th></tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{formatHora(m.ocurrido_en)}</td>
                  <td>{m.tipo === 'venta' ? 'Venta' : 'Egreso'}</td>
                  <td>{m.concepto}</td>
                  <td>{m.metodo}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.monto < 0 ? 'var(--danger)' : undefined }}>
                    {m.monto < 0 ? `−${formatCOP(-m.monto)}` : formatCOP(m.monto)}
                  </td>
                  <td><Badge variant={ENVIO[m.envio]?.tono ?? 'neutral'}>{ENVIO[m.envio]?.texto ?? m.envio}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <EgresoModal abierto={egresoAbierto} onCerrar={() => setEgresoAbierto(false)} onListo={(monto) => {
        setEgresoAbierto(false);
        showToast('success', 'Egreso registrado', formatCOP(monto));
        void onCambio();
      }} />
      <CerrarModal abierto={cerrarAbierto} turno={turno} onCerrar={() => setCerrarAbierto(false)} onListo={(r) => {
        setCerrarAbierto(false);
        const dif = r.turno.diferencia ?? 0;
        showToast(dif === 0 ? 'success' : 'warning', 'Turno cerrado', dif === 0 ? 'La caja cuadró.' : `Diferencia: ${dif < 0 ? '−' : ''}${formatCOP(Math.abs(dif))}`);
        void onCambio();
      }} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Mostrador
// ---------------------------------------------------------------------------
const Mostrador: React.FC<{ mostrador: EstadoCaja['mostrador']; onVendida: (v: VentaRegistrada) => void }> = ({ mostrador, onVendida }) => {
  const [busqueda, setBusqueda] = useState('');
  const [productos, setProductos] = useState<ProductoVenta[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cliente, setCliente] = useState<ClienteEvaluado | null>(null);
  const [buscaCliente, setBuscaCliente] = useState('');
  const [sugerencias, setSugerencias] = useState<ClienteEvaluado[]>([]);
  const [metodo, setMetodo] = useState(() => mostrador.metodos_pago.find((m) => m.toLowerCase() === 'efectivo') ?? mostrador.metodos_pago[0]);
  const [filasMedio, setFilasMedio] = useState<FilaMedio[] | null>(null);
  const [recibido, setRecibido] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const envio = useEnvio();

  const cargarProductos = useCallback(async (texto: string) => {
    try {
      setProductos(await cajaService.productos(texto));
    } catch {
      setProductos([]);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void cargarProductos(busqueda), 180);
    return () => window.clearTimeout(t);
  }, [busqueda, cargarProductos]);

  useEffect(() => {
    if (buscaCliente.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    const t = window.setTimeout(() => {
      ingresoService.buscar(buscaCliente).then(setSugerencias).catch(() => setSugerencias([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [buscaCliente]);

  const agregarProducto = (p: ProductoVenta) =>
    setLineas((ls) => {
      const ya = ls.find((l) => l.producto?.id === p.id);
      if (ya) return ls.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { clave: crypto.randomUUID(), tipo: 'producto', producto: p, descripcion: p.nombre, cantidad: 1, precioLista: p.precio, precioEscrito: '', precioCobrado: '', motivo: '' }];
    });

  const agregarPase = (tipo: 'pase_dia' | 'pase_clase') =>
    setLineas((ls) => [
      ...ls,
      {
        clave: crypto.randomUUID(),
        tipo,
        descripcion: tipo === 'pase_dia' ? 'Pase de día' : 'Pase de clase',
        cantidad: 1,
        precioLista: tipo === 'pase_dia' ? mostrador.precio_pase_dia : mostrador.precio_pase_clase,
        precioEscrito: '',
        precioCobrado: '',
        motivo: '',
      },
    ]);

  const cambiar = (clave: string, cambios: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));

  const total = useMemo(() => lineas.reduce((acc, l) => acc + cobradoDe(l) * l.cantidad, 0), [lineas]);
  const enEfectivo = filasMedio ? efectivoDeFilas(filasMedio) : metodo.toLowerCase() === 'efectivo' ? total : 0;
  const recibidoNum = entero(recibido);
  const cambio = recibidoNum !== null && enEfectivo > 0 ? recibidoNum - enEfectivo : null;
  const necesitaCliente = lineas.some((l) => l.tipo === 'pase_dia');

  const problema = (() => {
    if (lineas.length === 0) return 'Agrega un producto o un pase.';
    for (const l of lineas) {
      if (l.precioLista === null && (entero(l.precioEscrito) ?? 0) <= 0) return `Escribe el precio de ${l.descripcion.toLowerCase()}.`;
      if (l.producto && l.cantidad > l.producto.disponible) return `No hay suficiente ${l.producto.nombre}: quedan ${l.producto.disponible}.`;
      const cobrado = entero(l.precioCobrado);
      if (cobrado !== null && cobrado < precioDe(l) && l.motivo.trim().length < MOTIVO_MINIMO) return `Escribe el motivo del descuento en ${l.descripcion}.`;
    }
    if (necesitaCliente && !cliente) return 'El pase de día necesita un cliente registrado.';
    if (filasMedio && !repartoCompleto(filasMedio, total)) return 'El reparto del pago no suma el total.';
    if (cambio !== null && cambio < 0) return 'El efectivo recibido no alcanza.';
    return null;
  })();

  const cobrar = () => {
    setConfirmando(false);
    const items: NuevoItem[] = lineas.map((l) => {
      const item: NuevoItem = { tipo: l.tipo, cantidad: l.cantidad };
      if (l.producto) item.producto_id = l.producto.id;
      if (l.precioLista === null) item.precio = entero(l.precioEscrito) ?? 0;
      const cobrado = entero(l.precioCobrado);
      if (cobrado !== null && cobrado !== precioDe(l)) {
        item.precio_cobrado = cobrado;
        item.motivo_descuento = l.motivo.trim();
      }
      return item;
    });
    void envio.enviar(async () => {
      const v = await cajaService.vender({
        deportista_id: cliente?.id,
        items,
        metodo: filasMedio ? undefined : metodo,
        pagos: filasMedio ? mediosDeFilas(filasMedio).map((m) => ({ metodo: m.metodo, monto: m.monto })) : undefined,
        valor_recibido: enEfectivo > 0 && recibidoNum !== null ? recibidoNum : undefined,
      });
      setLineas([]);
      setCliente(null);
      setBuscaCliente('');
      setRecibido('');
      setFilasMedio(null);
      void cargarProductos(busqueda);
      onVendida(v);
    });
  };

  return (
    <section className="gd-panel gd-mostrador" style={{ marginTop: 16 }}>
      <div className="gd-mostrador-catalogo">
        <h3 className="gd-titulo" style={{ fontSize: '1rem' }}>
          <ShoppingCart size={17} style={{ verticalAlign: -3, marginRight: 8 }} />
          Venta de mostrador
        </h3>
        <div className="gd-mostrador-pases">
          <Button variant="outline" size="sm" leftIcon={<Ticket size={15} />} onClick={() => agregarPase('pase_dia')}>
            Pase de día{mostrador.precio_pase_dia !== null ? ` · ${formatCOP(mostrador.precio_pase_dia)}` : ''}
          </Button>
          <Button variant="outline" size="sm" leftIcon={<Ticket size={15} />} onClick={() => agregarPase('pase_clase')}>
            Pase de clase{mostrador.precio_pase_clase !== null ? ` · ${formatCOP(mostrador.precio_pase_clase)}` : ''}
          </Button>
        </div>
        <Input id="caja-buscar-producto" placeholder="Buscar producto" leftIcon={<Search size={16} />} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <ul className="gd-productos">
          {productos.length === 0 && <li className="gd-vacio">No hay productos con ese nombre.</li>}
          {productos.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => agregarProducto(p)} disabled={p.disponible <= 0} title={p.disponible <= 0 ? 'Sin existencias' : 'Agregar'}>
                <span>{p.nombre}</span>
                <span className="gd-productos-precio">{formatCOP(p.precio)}</span>
                <span className="gd-productos-stock">{p.disponible} disp.</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="gd-mostrador-cuenta">
        {lineas.length === 0 ? (
          <p className="gd-vacio">Elige productos o pases para empezar la venta.</p>
        ) : (
          <ul className="gd-lineas">
            {lineas.map((l) => (
              <li key={l.clave}>
                <div className="gd-linea-fila">
                  <strong>{l.descripcion}</strong>
                  {l.tipo === 'producto' ? (
                    <input
                      aria-label={`Cantidad de ${l.descripcion}`}
                      className="gd-cantidad"
                      type="number"
                      min={1}
                      value={l.cantidad}
                      onChange={(e) => cambiar(l.clave, { cantidad: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                    />
                  ) : (
                    <span />
                  )}
                  <span className="gd-linea-total">{formatCOP(cobradoDe(l) * l.cantidad)}</span>
                  <button type="button" className="icon-btn ghost" aria-label={`Quitar ${l.descripcion}`} onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}>
                    <Trash2 size={15} />
                  </button>
                </div>
                {l.precioLista === null && (
                  <Input label="Precio del pase (COP)" moneda value={l.precioEscrito} onChange={(e) => cambiar(l.clave, { precioEscrito: e.target.value })} />
                )}
                {mostrador.puede_descontar && (
                  <details className="gd-descuento">
                    <summary>Descuento (hasta {mostrador.tope_descuento_pct} %)</summary>
                    <Input label="Precio cobrado (COP)" moneda value={l.precioCobrado} onChange={(e) => cambiar(l.clave, { precioCobrado: e.target.value })} />
                    <Input label="Motivo del descuento" value={l.motivo} maxLength={255} onChange={(e) => cambiar(l.clave, { motivo: e.target.value })} />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}

        {necesitaCliente && (
          <div className="gd-cliente-venta">
            {cliente ? (
              <div className="gd-cliente-elegido">
                <UserRound size={16} />
                <span>
                  <strong>{cliente.nombre}</strong> · {formatDocumento(cliente.tipo_documento, cliente.documento)}
                </span>
                <button type="button" className="icon-btn ghost" aria-label="Cambiar cliente" onClick={() => setCliente(null)}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <>
                <Input id="caja-buscar-cliente" label="Cliente del pase de día" placeholder="Nombre o documento" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                {sugerencias.length > 0 && (
                  <ul className="gd-ingreso-sugerencias">
                    {sugerencias.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => { setCliente(c); setSugerencias([]); }}>
                          <span className="gd-ingreso-sugerencia-nombre">{c.nombre}</span>
                          <span className="gd-ingreso-sugerencia-doc">{formatDocumento(c.tipo_documento, c.documento)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="gd-total"><span>Total</span><strong>{formatCOP(total)}</strong></div>

        {filasMedio ? (
          <>
            <PagoDividido metodos={mostrador.metodos_pago} total={total} filas={filasMedio} onChange={setFilasMedio} disabled={envio.enviando} />
            <Button variant="ghost" size="sm" onClick={() => setFilasMedio(null)}>Pagar con un solo medio</Button>
          </>
        ) : (
          <div className="gd-medio">
            <Select label="Medio de pago" value={metodo} onChange={(e) => setMetodo(e.target.value)} options={mostrador.metodos_pago.map((m) => ({ value: m, label: m }))} />
            <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={() => setFilasMedio(filasIniciales(mostrador.metodos_pago))}>
              Pago mixto
            </Button>
          </div>
        )}
        {enEfectivo > 0 && (
          <Input id="caja-recibido" label={`Efectivo recibido (a cobrar en efectivo: ${formatCOP(enEfectivo)})`} moneda value={recibido} onChange={(e) => setRecibido(e.target.value)} />
        )}
        {cambio !== null && cambio >= 0 && <p className="gd-cambio">Cambio: <strong>{formatCOP(cambio)}</strong></p>}
        {envio.error && <MensajeError>{envio.error}</MensajeError>}
        {problema && lineas.length > 0 && <p className="gd-pista">{problema}</p>}
        <Button style={{ width: '100%', marginTop: 8 }} isLoading={envio.enviando} disabled={problema !== null} onClick={() => setConfirmando(true)}>
          Cobrar {formatCOP(total)}
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={cobrar}
        title="Confirmar cobro"
        message={`Vas a cobrar ${formatCOP(total)}${filasMedio ? ' repartido entre varios medios' : ` con ${metodo}`}${cliente ? ` a ${cliente.nombre}` : ''}. Queda registrado en este turno.`}
        confirmText="Cobrar"
      />
    </section>
  );
};

// ---------------------------------------------------------------------------
// Egreso y cierre
// ---------------------------------------------------------------------------
const EgresoModal: React.FC<{ abierto: boolean; onCerrar: () => void; onListo: (monto: number) => void }> = ({ abierto, onCerrar, onListo }) => {
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const envio = useEnvio();
  const valor = entero(monto);
  const valido = valor !== null && valor > 0 && motivo.trim().length >= MOTIVO_MINIMO;
  const registrar = () => {
    if (!valido || valor === null) return;
    void envio.enviar(async () => {
      await cajaService.egreso(valor, motivo.trim());
      setMonto('');
      setMotivo('');
      onListo(valor);
    });
  };
  return (
    <Modal
      isOpen={abierto}
      onClose={() => !envio.enviando && onCerrar()}
      title="Registrar egreso"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={envio.enviando}>Cancelar</Button>
          <Button variant="danger" onClick={registrar} isLoading={envio.enviando} disabled={!valido}>Registrar egreso</Button>
        </>
      }
    >
      <Input id="caja-egreso-monto" label="Monto (COP)" moneda value={monto} onChange={(e) => setMonto(e.target.value)} />
      <Input id="caja-egreso-motivo" label="Motivo" placeholder="Ej. Compra de botellones de agua" maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      {envio.error && <MensajeError>{envio.error}</MensajeError>}
    </Modal>
  );
};

const CerrarModal: React.FC<{ abierto: boolean; turno: ResumenTurno; onCerrar: () => void; onListo: (r: ResumenTurno) => void }> = ({
  abierto,
  turno,
  onCerrar,
  onListo,
}) => {
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const envio = useEnvio();
  const valor = entero(contado);
  const esperado = turno.totales.total_esperado_efectivo;
  const diferencia = valor !== null ? valor - esperado : null;
  const cerrar = () => {
    setConfirmar(false);
    if (valor === null) return;
    void envio.enviar(async () => {
      const r = await cajaService.cerrarTurno(valor, nota.trim() || undefined);
      setContado('');
      setNota('');
      onListo(r);
    });
  };
  return (
    <>
      <Modal
        isOpen={abierto && !confirmar}
        onClose={() => !envio.enviando && onCerrar()}
        title="Cerrar caja"
        footer={
          <>
            <Button variant="outline" onClick={onCerrar} disabled={envio.enviando}>Cancelar</Button>
            <Button onClick={() => setConfirmar(true)} isLoading={envio.enviando} disabled={valor === null || valor < 0}>Cerrar caja</Button>
          </>
        }
      >
        <dl className="gd-conteos">
          <div><dt>Efectivo esperado</dt><dd>{formatCOP(esperado)}</dd></div>
          {diferencia !== null && (
            <div>
              <dt>Diferencia</dt>
              <dd style={{ color: diferencia === 0 ? 'var(--success)' : 'var(--danger)' }}>
                {diferencia === 0 ? 'Cuadra' : `${diferencia < 0 ? '−' : '+'}${formatCOP(Math.abs(diferencia))}`}
              </dd>
            </div>
          )}
        </dl>
        <Input id="caja-contado" label="Efectivo contado (COP)" moneda value={contado} onChange={(e) => setContado(e.target.value)} />
        <Textarea label="Nota (opcional)" maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />
        {envio.error && <MensajeError>{envio.error}</MensajeError>}
      </Modal>
      <ConfirmDialog
        isOpen={confirmar}
        onClose={() => setConfirmar(false)}
        onConfirm={cerrar}
        title="Cerrar la caja"
        message={`Vas a cerrar el turno con ${formatCOP(valor ?? 0)} contados${diferencia ? ` (diferencia de ${formatCOP(Math.abs(diferencia))})` : ''}. Un turno cerrado no se puede modificar.`}
        confirmText="Cerrar caja"
        isLoading={envio.enviando}
      />
    </>
  );
};
