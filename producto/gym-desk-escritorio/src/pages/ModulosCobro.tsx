import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@web/contexts/ToastContext';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { formatCOP, formatDocumento, formatFecha } from '@web/utils/formato';
import { ingresoService } from '../api/ingreso.service';
import { MensajeError } from '../components/Piezas';
import { ReciboModal, reciboDeMembresia, reciboDeVenta, type DatosRecibo } from '../components/Recibo';
import { useSesion } from '../contexts/SesionContext';
import type { EstadoEstacion } from '../types/estacion.types';
import type { ClienteEvaluado } from '../types/ingreso.types';
import { CajaCerradaAviso, Mostrador, useCaja } from './CajaPanel';
import { MembresiasCaja } from './MembresiasCaja';

const fecha = (dia: string) => formatFecha(`${dia}T12:00:00-05:00`);

/** Referencia estable: una función nueva en cada render volvería a cargar al cliente sin fin. */
const nada = () => undefined;

/**
 * Membresías: a la izquierda los clientes por cobrar (vencidos, en gracia, por vencer y sin plan); a la derecha
 * el cobro: renovar o vender un plan. Con o sin red. Exige la caja abierta.
 */
export const MembresiasPage: React.FC<{
  estacion: EstadoEstacion;
  clienteInicial: string | null;
  onClienteUsado: () => void;
}> = ({ estacion, clienteInicial, onClienteUsado }) => {
  const { showToast } = useToast();
  const { estado, errorCarga, cargar } = useCaja();
  const [porCobrar, setPorCobrar] = useState<ClienteEvaluado[]>([]);
  const [elegido, setElegido] = useState<string | null>(clienteInicial);
  const [recibo, setRecibo] = useState<DatosRecibo | null>(null);
  const { estacion: est, sesion } = useSesion();

  const cargarLista = useCallback(async () => {
    try {
      setPorCobrar((await ingresoService.listar('', 'por_cobrar', 100)).items);
    } catch {
      setPorCobrar([]);
    }
  }, []);
  useEffect(() => { void cargarLista(); }, [cargarLista]);
  useEffect(() => {
    if (clienteInicial) {
      setElegido(clienteInicial);
      onClienteUsado();
    }
  }, [clienteInicial, onClienteUsado]);

  if (errorCarga) return <MensajeError>{errorCarga}</MensajeError>;
  if (!estado) return <div className="skeleton" style={{ height: 220 }} />;
  if (!estado.turno) return <CajaCerradaAviso estado={estado} enLinea={estacion.en_linea} onAbierta={() => void cargar()} para="cobrar membresías" />;

  return (
    <div className="gd-modulo">
      <div className="gd-dos-columnas">
        <section className="gd-panel gd-lista-cobrar">
          <h3 className="gd-titulo" style={{ fontSize: '1rem' }}>Por cobrar ({porCobrar.length})</h3>
          {porCobrar.length === 0 ? (
            <p className="gd-vacio">Nadie vencido ni por vencer.</p>
          ) : (
            <ul>
              {porCobrar.map((c) => (
                <li key={c.id}>
                  <button type="button" className={elegido === c.id ? 'activa' : ''} onClick={() => setElegido(c.id)}>
                    <span className="gd-lista-nombre">{c.nombre}</span>
                    <span className="gd-lista-detalle">
                      {formatDocumento(c.tipo_documento, c.documento)}
                      {c.fecha_vencimiento ? ` · ${c.plan_nombre ?? ''} ${fecha(c.fecha_vencimiento)}` : ' · sin plan'}
                    </span>
                    <EstadoDeportistaBadge estado={c.estado} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div>
          <MembresiasCaja
            mostrador={estado.mostrador}
            clienteInicial={elegido}
            onClienteInicialUsado={nada}
            onCobrado={(c) => {
              showToast('success', c.tipo === 'renovacion' ? 'Membresía renovada' : 'Plan vendido',
                `${c.deportista_nombre} · ${c.plan_nombre} hasta el ${fecha(c.fecha_vencimiento_nueva)}${c.cambio ? ` · cambio ${formatCOP(c.cambio)}` : ''}`);
              setElegido(null);
              setRecibo(reciboDeMembresia(c));
              void cargar();
              void cargarLista();
            }}
          />
          <ReciboModal recibo={recibo} gimnasio={est?.gimnasio_nombre ?? 'GymDesk'} atendio={sesion?.usuario?.nombre ?? ''} onCerrar={() => setRecibo(null)} />
        </div>
      </div>
    </div>
  );
};

/** Ventas: punto de venta de productos y pases. Exige la caja abierta. */
export const VentasPage: React.FC<{ estacion: EstadoEstacion; clienteInicial: string | null; onClienteUsado: () => void }> = ({
  estacion,
  clienteInicial,
  onClienteUsado,
}) => {
  const { showToast } = useToast();
  const { estado, errorCarga, cargar } = useCaja();
  const [cliente, setCliente] = useState<ClienteEvaluado | null>(null);
  const [recibo, setRecibo] = useState<DatosRecibo | null>(null);
  const { estacion: est, sesion } = useSesion();
  useEffect(() => {
    if (!clienteInicial) return;
    ingresoService.ficha(clienteInicial).then((f) => setCliente(f.cliente)).catch(() => setCliente(null));
    onClienteUsado();
  }, [clienteInicial, onClienteUsado]);

  if (errorCarga) return <MensajeError>{errorCarga}</MensajeError>;
  if (!estado) return <div className="skeleton" style={{ height: 220 }} />;
  if (!estado.turno) return <CajaCerradaAviso estado={estado} enLinea={estacion.en_linea} onAbierta={() => void cargar()} para="vender" />;
  return (
    <div className="gd-modulo">
      <Mostrador
        mostrador={estado.mostrador}
        clienteInicial={cliente}
        onVendida={(v) => {
          showToast('success', 'Venta registrada', v.cambio ? `Total ${formatCOP(v.total)} · cambio ${formatCOP(v.cambio)}` : `Total ${formatCOP(v.total)}`);
          setCliente(null);
          setRecibo(reciboDeVenta(v));
          void cargar();
        }}
      />
      <ReciboModal recibo={recibo} gimnasio={est?.gimnasio_nombre ?? 'GymDesk'} atendio={sesion?.usuario?.nombre ?? ''} onCerrar={() => setRecibo(null)} />
    </div>
  );
};
