import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarPlus, Plus, UserRound, X } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { Input } from '@web/components/ui/Input';
import { Modal } from '@web/components/ui/Modal';
import { formatCOP, formatDocumento, formatFecha } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { ingresoService } from '../api/ingreso.service';
import { aErrorGymDesk } from '../api/tauri';
import { PanelPago, usePago } from '../components/PanelPago';
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
  const [confirmando, setConfirmando] = useState(false);
  const envio = useEnvio();

  const limpiarCobro = () => {
    setPrecioCobrado('');
    setMotivo('');
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
  const pago = usePago(mostrador.metodos_pago, total, confirmando);
  const puedeCobrar = !!opciones && !opciones.aviso && (!!renovar || !!plan);

  const problema = (() => {
    if (!puedeCobrar) return 'Elige un cliente.';
    if (total <= 0) return 'El valor a cobrar debe ser mayor que cero.';
    if (cobradoEscrito !== null && cobradoEscrito < lista && motivo.trim().length < MOTIVO_MINIMO) return 'Escribe el motivo del descuento.';
    return null;
  })();
  const cobrar = () => {
    const r = pago.resultado;
    if (!opciones || !r) return;
    const conDescuento = cobradoEscrito !== null && cobradoEscrito !== lista;
    void envio.enviar(async () => {
      const c = await cajaService.cobrarMembresia({
        deportista_id: opciones.cliente.id,
        accion: renovar ? 'renovar' : 'vender',
        plan_id: renovar ? undefined : planId ?? undefined,
        precio_cobrado: conDescuento ? cobradoEscrito ?? undefined : undefined,
        motivo_descuento: conDescuento ? motivo.trim() : undefined,
        metodo: r.metodo,
        pagos: r.pagos,
        valor_recibido: r.valor_recibido,
        nota: r.nota,
      });
      setOpciones(null);
      limpiarCobro();
      setConfirmando(false);
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
              {problema && <p className="gd-pista">{problema}</p>}
              <Button className="gd-boton-pagar" disabled={problema !== null} onClick={() => setConfirmando(true)}>
                Pagar {formatCOP(total)}
              </Button>
            </>
          )}
        </>
      )}

      <Modal isOpen={confirmando} onClose={() => !envio.enviando && setConfirmando(false)} title={renovar ? 'Pago de la renovación' : 'Pago del plan'} maxWidth="560px"
        footer={<>
          <Button variant="outline" onClick={() => setConfirmando(false)} disabled={envio.enviando}>Volver</Button>
          <Button isLoading={envio.enviando} disabled={!pago.resultado} onClick={cobrar}>{renovar ? 'Confirmar renovación' : 'Confirmar venta'}</Button>
        </>}>
        <PanelPago metodos={mostrador.metodos_pago} total={total} pago={pago} disabled={envio.enviando}
          detalle={`${c?.nombre ?? ''} · ${renovar ? `Renovar ${opciones?.membresia?.plan_nombre ?? 'plan'}` : plan?.nombre ?? ''}${venceNueva ? ` · hasta el ${fecha(venceNueva)}` : ''}`} />
        {envio.error && <MensajeError>{envio.error}</MensajeError>}
      </Modal>
    </section>
  );
};
