import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarPlus, Plus, UserRound, X } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { Input } from '@web/components/ui/Input';
import { ConfirmDialog } from '@web/components/ui/Modal';
import { efectivoDeFilas, filasIniciales, mediosDeFilas, PagoDividido, repartoCompleto, type FilaMedio } from '@web/components/ui/PagoDividido';
import { formatCOP, formatDocumento, formatFecha } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { ingresoService } from '../api/ingreso.service';
import { aErrorGymDesk } from '../api/tauri';
import { EfectivoRapido } from '../components/EfectivoRapido';
import { MediosPago } from '../components/MediosPago';
import { MensajeError } from '../components/Piezas';
import { useEnvio } from '../hooks/useEnvio';
import type { CobroMembresiaRegistrado, DatosMostrador, OpcionesMembresia } from '../types/caja.types';
import type { ClienteEvaluado } from '../types/ingreso.types';

const MOTIVO_MINIMO = 4;

/** Una fecha sin hora se ancla al mediodía de Bogotá para no pintarse el día anterior. */
const fecha = (dia: string) => formatFecha(`${dia}T12:00:00-05:00`);

function entero(valor: string): number | null {
  if (valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Renovar la membresía de un cliente o venderle un plan, con red o sin ella (fase 3B). El pago entra al
 * turno abierto y el cliente puede entrar de inmediato. Cliente nuevo, paquetes y cambio de plan: en la web.
 */
export const MembresiasCaja: React.FC<{
  mostrador: DatosMostrador;
  /** Cliente que llega desde Control de ingreso con "Renovar". */
  clienteInicial?: string | null;
  onClienteInicialUsado?: () => void;
  onCobrado: (c: CobroMembresiaRegistrado) => void;
}> = ({ mostrador, clienteInicial, onClienteInicialUsado, onCobrado }) => {
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<ClienteEvaluado[]>([]);
  const [opciones, setOpciones] = useState<OpcionesMembresia | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [precioCobrado, setPrecioCobrado] = useState('');
  const [motivo, setMotivo] = useState('');
  const [metodo, setMetodo] = useState(() => mostrador.metodos_pago.find((m) => m.toLowerCase() === 'efectivo') ?? mostrador.metodos_pago[0]);
  const [filasMedio, setFilasMedio] = useState<FilaMedio[] | null>(null);
  const [recibido, setRecibido] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const envio = useEnvio();

  const limpiarCobro = () => {
    setPrecioCobrado('');
    setMotivo('');
    setRecibido('');
    setFilasMedio(null);
  };

  const elegir = useCallback(async (deportistaId: string) => {
    setSugerencias([]);
    setBusqueda('');
    setErrorCarga(null);
    try {
      const o = await cajaService.opcionesMembresia(deportistaId);
      setOpciones(o);
      setPlanId(o.planes[0]?.id ?? null);
    } catch (err) {
      setOpciones(null);
      setErrorCarga(aErrorGymDesk(err).mensaje);
    }
  }, []);

  useEffect(() => {
    if (!clienteInicial) return;
    void elegir(clienteInicial);
    onClienteInicialUsado?.();
  }, [clienteInicial, elegir, onClienteInicialUsado]);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    const t = window.setTimeout(() => {
      ingresoService.buscar(busqueda).then(setSugerencias).catch(() => setSugerencias([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  const plan = opciones?.planes.find((p) => p.id === planId) ?? null;
  const renovar = opciones?.renovacion ?? null;
  const lista = renovar ? renovar.precio_lista : plan?.precio ?? 0;
  const venceNueva = renovar ? renovar.fecha_vencimiento_nueva : plan?.fecha_vencimiento ?? null;
  const cobradoEscrito = entero(precioCobrado);
  const total = cobradoEscrito ?? lista;
  const enEfectivo = filasMedio ? efectivoDeFilas(filasMedio) : metodo.toLowerCase() === 'efectivo' ? total : 0;
  const recibidoNum = entero(recibido);
  const cambio = recibidoNum !== null && enEfectivo > 0 ? recibidoNum - enEfectivo : null;
  const puedeCobrar = !!opciones && !opciones.aviso && (!!renovar || !!plan);

  const problema = (() => {
    if (!puedeCobrar) return 'Elige un cliente.';
    if (total <= 0) return 'El valor a cobrar debe ser mayor que cero.';
    if (cobradoEscrito !== null && cobradoEscrito < lista && motivo.trim().length < MOTIVO_MINIMO) return 'Escribe el motivo del descuento.';
    if (filasMedio && !repartoCompleto(filasMedio, total)) return 'El reparto del pago no suma el total.';
    if (cambio !== null && cambio < 0) return 'El efectivo recibido no alcanza.';
    return null;
  })();

  const cobrar = () => {
    setConfirmando(false);
    if (!opciones) return;
    const conDescuento = cobradoEscrito !== null && cobradoEscrito !== lista;
    void envio.enviar(async () => {
      const c = await cajaService.cobrarMembresia({
        deportista_id: opciones.cliente.id,
        accion: renovar ? 'renovar' : 'vender',
        plan_id: renovar ? undefined : planId ?? undefined,
        precio_cobrado: conDescuento ? cobradoEscrito ?? undefined : undefined,
        motivo_descuento: conDescuento ? motivo.trim() : undefined,
        metodo: filasMedio ? undefined : metodo,
        pagos: filasMedio ? mediosDeFilas(filasMedio).map((m) => ({ metodo: m.metodo, monto: m.monto })) : undefined,
        valor_recibido: enEfectivo > 0 && recibidoNum !== null ? recibidoNum : undefined,
      });
      setOpciones(null);
      limpiarCobro();
      onCobrado(c);
    });
  };

  const c = opciones?.cliente;
  return (
    <section className="gd-panel" style={{ marginTop: 16 }}>

      {!c ? (
        <>
          <div className="gd-buscador">
            <UserRound size={18} />
            <input id="caja-memb-cliente" placeholder="Busca al cliente por nombre o documento, o elígelo de la lista" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          {sugerencias.length > 0 && (
            <ul className="gd-ingreso-sugerencias">
              {sugerencias.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => void elegir(s.id)}>
                    <span className="gd-ingreso-sugerencia-nombre">{s.nombre}</span>
                    <span className="gd-ingreso-sugerencia-doc">{formatDocumento(s.tipo_documento, s.documento)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errorCarga && <MensajeError>{errorCarga}</MensajeError>}
          <p className="gd-pista">¿Cliente nuevo? Regístralo con Nuevo cliente (F6) y luego véndele el plan aquí.</p>
        </>
      ) : (
        <>
          <div className="gd-memb-cliente">
            {c.foto ? <img src={c.foto} alt="" /> : <span className="gd-memb-iniciales">{c.nombre.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{c.nombre}</strong>
              <span>{formatDocumento(c.tipo_documento, c.documento)}</span>
              {opciones.membresia && <span>{opciones.membresia.plan_nombre} · vence el {fecha(opciones.membresia.fecha_vencimiento)}</span>}
            </div>
            <EstadoDeportistaBadge estado={c.estado} />
            <button type="button" className="icon-btn ghost" aria-label="Cambiar cliente" onClick={() => { setOpciones(null); limpiarCobro(); }}>
              <X size={16} />
            </button>
          </div>

          {opciones.aviso ? (
            <div className="gd-aviso" role="status">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{opciones.aviso}</span>
            </div>
          ) : renovar ? (
            <div className="gd-planes">
              <button type="button" className="activo">
                <span className="gd-plan-nombre">Renovar {opciones.membresia?.plan_nombre ?? 'plan'}</span>
                <span className="gd-plan-precio">{formatCOP(renovar.precio_lista)}</span>
                <span className="gd-plan-detalle">{renovar.dias} días · queda hasta el {fecha(renovar.fecha_vencimiento_nueva)}</span>
              </button>
            </div>
          ) : (
            <div className="gd-planes" role="radiogroup" aria-label="Plan a vender">
              {opciones.planes.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className={planId === p.id ? 'activo' : ''} onClick={() => setPlanId(p.id)}>
                  <span className="gd-plan-nombre">{p.nombre}</span>
                  <span className="gd-plan-precio">{formatCOP(p.precio)}</span>
                  <span className="gd-plan-detalle">{p.duracion_dias} días · hasta el {fecha(p.fecha_vencimiento)}</span>
                </button>
              ))}
            </div>
          )}

          {puedeCobrar && (
            <>
              {mostrador.puede_descontar && (
                <details className="gd-descuento">
                  <summary>Descuento (hasta {mostrador.tope_descuento_pct} %)</summary>
                  <Input label="Valor cobrado (COP)" moneda value={precioCobrado} onChange={(e) => setPrecioCobrado(e.target.value)} />
                  <Input label="Motivo del descuento" value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} />
                </details>
              )}
              <div className="gd-total"><span>Total</span><strong>{formatCOP(total)}</strong></div>
              {filasMedio ? (
                <>
                  <PagoDividido metodos={mostrador.metodos_pago} total={total} filas={filasMedio} onChange={setFilasMedio} disabled={envio.enviando} />
                  <Button variant="ghost" size="sm" onClick={() => setFilasMedio(null)}>Pagar con un solo medio</Button>
                </>
              ) : (
                <MediosPago metodos={mostrador.metodos_pago} valor={metodo} onCambio={setMetodo} disabled={envio.enviando}
                            onMixto={() => setFilasMedio(filasIniciales(mostrador.metodos_pago))} />
              )}
              {enEfectivo > 0 && <EfectivoRapido aCobrar={enEfectivo} recibido={recibido} onRecibido={setRecibido} />}
              {envio.error && <MensajeError>{envio.error}</MensajeError>}
              {problema && <p className="gd-pista">{problema}</p>}
              <Button style={{ width: '100%', marginTop: 8 }} isLoading={envio.enviando} disabled={problema !== null} onClick={() => setConfirmando(true)}>
                {renovar ? 'Renovar' : 'Vender plan'} · {formatCOP(total)}
              </Button>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={cobrar}
        title={renovar ? 'Confirmar renovación' : 'Confirmar venta del plan'}
        message={`Vas a cobrar ${formatCOP(total)}${filasMedio ? ' repartido entre varios medios' : ` con ${metodo}`} a ${c?.nombre ?? ''}${
          venceNueva ? `. La membresía queda hasta el ${fecha(venceNueva)}` : ''
        }. Queda registrado en este turno.`}
        confirmText="Cobrar"
      />
    </section>
  );
};
