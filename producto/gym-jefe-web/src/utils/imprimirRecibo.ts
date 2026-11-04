import type { VentaResponseDto } from '../types/caja.types';
import { escapar } from './compartirRutina';
import { formatCOP, formatFechaHora } from './formato';

/** Abre el recibo de una venta en una ventana angosta y lanza la impresión del navegador. */
export function imprimirRecibo(venta: VentaResponseDto, gimnasio: string, cliente: string | null): boolean {
  const ventana = window.open('', '_blank', 'width=420,height=640');
  if (!ventana) return false;
  const filas = venta.items
    .map(
      (it) => `<tr>
        <td>${it.cantidad} × ${escapar(it.descripcion)}</td>
        <td class="n">${escapar(formatCOP(it.subtotal))}</td>
      </tr>`
    )
    .join('');
  const cambio = Number(venta.cambio_devuelto ?? 0);
  const recibido = venta.valor_recibido;
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Recibo · ${escapar(gimnasio)}</title>
    <style>
      body { font-family: system-ui, sans-serif; color: #111; margin: 16px; font-size: 13px; }
      h1 { font-size: 17px; margin: 0 0 2px; }
      p { margin: 0 0 3px; color: #444; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      td { padding: 4px 0; vertical-align: top; }
      .n { text-align: right; white-space: nowrap; padding-left: 10px; }
      .total td { border-top: 1px solid #111; font-weight: 700; font-size: 15px; padding-top: 8px; }
    </style></head><body>
    <h1>${escapar(gimnasio)}</h1>
    <p>${escapar(formatFechaHora(venta.created_at))}</p>
    ${cliente ? `<p>Cliente: ${escapar(cliente)}</p>` : ''}
    <table><tbody>${filas}
      <tr class="total"><td>Total</td><td class="n">${escapar(formatCOP(venta.total))}</td></tr>
    </tbody></table>
    <p>Pago: ${escapar(venta.metodo)}</p>
    ${recibido !== null && recibido !== undefined ? `<p>Recibido: ${escapar(formatCOP(recibido))}</p>` : ''}
    ${cambio > 0 ? `<p>Cambio: ${escapar(formatCOP(cambio))}</p>` : ''}
    </body></html>`);
  ventana.document.close();
  ventana.focus();
  ventana.print();
  return true;
}
