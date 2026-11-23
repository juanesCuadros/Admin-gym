import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarPlus, Plus, UserRound, X } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { Input, Select } from '@web/components/ui/Input';
import { ConfirmDialog } from '@web/components/ui/Modal';
import { efectivoDeFilas, filasIniciales, mediosDeFilas, PagoDividido, repartoCompleto, type FilaMedio } from '@web/components/ui/PagoDividido';
import { formatCOP, formatDocumento, formatFecha } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { ingresoService } from '../api/ingreso.service';
import { aErrorGymDesk } from '../api/tauri';
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
      <h3 className="gd-titulo" style={{ fontSize: '1rem' }}>
        <CalendarPlus size={17} style={{ verticalAlign: -3, marginRight: 8 }} />
        Membresías: renovar o vender un plan
      </h3>

      {!c ? (
        <>
          <Input id="caja-memb-cliente" label="Cliente" placeholder="Nombre o documento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
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
          <p className="gd-pista">Para un cliente nuevo, regístralo primero en la web y sincroniza.</p>
        </>
      ) : (
        <>
          <div className="gd-cliente-elegido">
            <UserRound size={16} />
            <span>
              <strong>{c.nombre}</strong> · {formatDocumento(c.tipo_documento, c.documento)}
            </span>
            <EstadoDeportistaBadge estado={c.estado} />
            <button type="button" className="icon-btn ghost" aria-label="Cambiar cliente" onClick={() => { setOpciones(null); limpiarCobro(); }}>
              <X size={15} />
            </button>
          </div>

          {opciones.membresia && (
            <p className="gd-subtitulo" style={{ margin: '8px 0' }}>
              {opciones.membresia.plan_nombre} · vence el {fecha(opciones.membresia.fecha_vencimiento)}
            </p>
          )}

          {opciones.aviso ? (
            <div className="gd-aviso" role="status">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{opciones.aviso}</span>
            </div>
          ) : renovar ? (
            <div className="gd-total" style={{ marginTop: 4 }}>
              <span>
                Renovar {renovar.dias} días · queda hasta el <strong>{fecha(renovar.fecha_vencimiento_nueva)}</strong>
              </span>
              <strong>{formatCOP(renovar.precio_lista)}</strong>
            </div>
          ) : (
            <Select
              label="Plan a vender"
              value={planId ?? ''}
              onChange={(e) => setPlanId(e.target.value)}
              options={opciones.planes.map((p) => ({ value: p.id, label: `${p.nombre} · ${formatCOP(p.precio)} · ${p.duracion_dias} días` }))}
            />
          )}

          {puedeCobrar && (
            <>
              {!renovar && venceNueva && <p className="gd-pista">Vence el {fecha(venceNueva)}.</p>}
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
                <div className="gd-medio">
                  <Select label="Medio de pago" value={metodo} onChange={(e) => setMetodo(e.target.value)} options={mostrador.metodos_pago.map((m) => ({ value: m, label: m }))} />
                  <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={() => setFilasMedio(filasIniciales(mostrador.metodos_pago))}>
                    Pago mixto
                  </Button>
                </div>
              )}
              {enEfectivo > 0 && (
                <Input id="caja-memb-recibido" label={`Efectivo recibido (a cobrar en efectivo: ${formatCOP(enEfectivo)})`} moneda value={recibido} onChange={(e) => setRecibido(e.target.value)} />
              )}
              {cambio !== null && cambio >= 0 && <p className="gd-cambio">Cambio: <strong>{formatCOP(cambio)}</strong></p>}
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
