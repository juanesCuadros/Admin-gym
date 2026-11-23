import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Printer } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Modal } from '@web/components/ui/Modal';
import { formatCOP, formatFecha, formatFechaHora } from '@web/utils/formato';
import type { CobroMembresiaRegistrado, VentaRegistrada } from '../types/caja.types';

export interface DatosRecibo {
  titulo: string;
  numero: string;
  fecha: string;
  cliente: string | null;
  lineas: { descripcion: string; cantidad: number; valor: number }[];
  total: number;
  medios: { metodo: string; monto: number }[];
  recibido: number | null;
  cambio: number | null;
  nota: string | null;
}

const corto = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
const dia = (d: string) => formatFecha(`${d}T12:00:00-05:00`);

export function reciboDeVenta(v: VentaRegistrada): DatosRecibo {
  return {
    titulo: 'Recibo de venta',
    numero: corto(v.id),
    fecha: v.ocurrida_en,
    cliente: v.deportista_nombre,
    lineas: v.items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad, valor: i.subtotal })),
    total: v.total,
    medios: v.tipo_medio === 'mixto' ? v.pagos.map((p) => ({ metodo: p.metodo, monto: p.monto })) : [{ metodo: v.metodo, monto: v.total }],
    recibido: v.valor_recibido,
    cambio: v.cambio,
    nota: null,
  };
}

export function reciboDeMembresia(c: CobroMembresiaRegistrado): DatosRecibo {
  return {
    titulo: c.tipo === 'renovacion' ? 'Recibo de renovación' : 'Recibo de membresía',
    numero: corto(c.id),
    fecha: c.ocurrida_en,
    cliente: c.deportista_nombre,
    lineas: [{ descripcion: `${c.tipo === 'renovacion' ? 'Renovación' : 'Plan'} ${c.plan_nombre}`, cantidad: 1, valor: c.precio_cobrado }],
    total: c.precio_cobrado,
    medios: c.tipo_medio === 'mixto' ? c.pagos.map((p) => ({ metodo: p.metodo, monto: p.monto })) : [{ metodo: c.metodo, monto: c.precio_cobrado }],
    recibido: c.valor_recibido,
    cambio: c.cambio,
    nota: `Vigente hasta el ${dia(c.fecha_vencimiento_nueva)}`,
  };
}

/** El recibo en sí: se ve en pantalla y es lo único que sale al imprimir (80 mm o carta). */
const Papel: React.FC<{ r: DatosRecibo; gimnasio: string; atendio: string }> = ({ r, gimnasio, atendio }) => (
  <div className="gd-recibo">
    <div className="gd-recibo-centro">
      <strong className="gd-recibo-gym">{gimnasio}</strong>
      <span>{r.titulo}</span>
      <span>N.º {r.numero}</span>
      <span>{formatFechaHora(r.fecha)}</span>
    </div>
    {r.cliente && <div className="gd-recibo-fila"><span>Cliente</span><span>{r.cliente}</span></div>}
    <div className="gd-recibo-sep" />
    {r.lineas.map((l, i) => (
      <div key={i} className="gd-recibo-fila">
        <span>{l.cantidad > 1 ? `${l.cantidad} × ` : ''}{l.descripcion}</span>
        <span>{formatCOP(l.valor)}</span>
      </div>
    ))}
    <div className="gd-recibo-sep" />
    <div className="gd-recibo-fila gd-recibo-total"><span>TOTAL</span><span>{formatCOP(r.total)}</span></div>
    {r.medios.map((m) => (
      <div key={m.metodo} className="gd-recibo-fila"><span>{m.metodo}</span><span>{formatCOP(m.monto)}</span></div>
    ))}
    {r.recibido !== null && <div className="gd-recibo-fila"><span>Recibido</span><span>{formatCOP(r.recibido)}</span></div>}
    {r.cambio !== null && r.cambio > 0 && <div className="gd-recibo-fila"><span>Cambio</span><span>{formatCOP(r.cambio)}</span></div>}
    {r.nota && <><div className="gd-recibo-sep" /><div className="gd-recibo-centro"><strong>{r.nota}</strong></div></>}
    <div className="gd-recibo-sep" />
    <div className="gd-recibo-centro gd-recibo-pie">
      <span>Atendió: {atendio}</span>
      <span>¡Gracias por entrenar con nosotros!</span>
    </div>
  </div>
);

/** Después de cobrar: confirmación con la vista previa del recibo y el botón para imprimirlo. */
export const ReciboModal: React.FC<{ recibo: DatosRecibo | null; gimnasio: string; atendio: string; onCerrar: () => void }> = ({
  recibo,
  gimnasio,
  atendio,
  onCerrar,
}) => (
  <>
    <Modal
      isOpen={recibo !== null}
      onClose={onCerrar}
      title="Cobro registrado"
      maxWidth="460px"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar}>Listo</Button>
          <Button leftIcon={<Printer size={16} />} onClick={() => window.print()}>Imprimir recibo</Button>
        </>
      }
    >
      <div className="gd-recibo-ok"><CheckCircle2 size={20} /> Quedó registrado en la caja del turno.</div>
      {recibo && <Papel r={recibo} gimnasio={gimnasio} atendio={atendio} />}
    </Modal>
    {recibo && createPortal(<div id="gd-recibo-imprimir"><Papel r={recibo} gimnasio={gimnasio} atendio={atendio} /></div>, document.body)}
  </>
);
