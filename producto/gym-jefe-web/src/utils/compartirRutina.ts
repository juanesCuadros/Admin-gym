import type { RutinaAsignadaResponse, RutinaItemResponse } from '../types/entrenamiento.types';
import { formatFecha } from './formato';

/**
 * Compartir una rutina asignada sin enlace público: impresa o como texto por WhatsApp.
 * Solo usa los datos de la copia congelada de la rutina (GW-RF-30).
 */

const ordenados = (r: RutinaAsignadaResponse): RutinaItemResponse[] => [...r.items].sort((a, b) => a.orden - b.orden);

function detalle(it: RutinaItemResponse): string {
  const partes = [
    it.series != null ? `${it.series} series` : null,
    it.reps ? `${it.reps} reps` : null,
    it.peso_sugerido ? `carga ${it.peso_sugerido}` : null,
    it.descanso_seg != null ? `descanso ${it.descanso_seg} s` : null,
  ].filter(Boolean);
  return partes.join(' · ');
}

/** Texto plano de la rutina, listo para WhatsApp. */
export function rutinaComoTexto(r: RutinaAsignadaResponse, gimnasio: string, deportista: string): string {
  const lineas = [`*${r.nombre}*`, `${deportista} · ${gimnasio}`, ''];
  ordenados(r).forEach((it, i) => {
    const d = detalle(it);
    lineas.push(`${i + 1}. ${it.ejercicio_nombre}${d ? ` — ${d}` : ''}`);
  });
  return lineas.join('\n');
}

/**
 * Enlace de WhatsApp con el texto armado. Con un celular colombiano de 10 dígitos se abre el chat
 * del deportista; si no, WhatsApp pide elegir el contacto.
 */
export function enlaceWhatsApp(texto: string, telefono?: string | null): string {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  const numero = digitos.length === 10 && digitos.startsWith('3') ? `57${digitos}` : digitos.length === 12 && digitos.startsWith('57') ? digitos : '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Abre una ventana con la rutina en formato de hoja y lanza la impresión. */
export function imprimirRutina(r: RutinaAsignadaResponse, gimnasio: string, deportista: string): boolean {
  const ventana = window.open('', '_blank', 'width=820,height=900');
  if (!ventana) return false;
  const filas = ordenados(r)
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td>${escapar(it.ejercicio_nombre)}</td>
        <td class="n">${it.series ?? '—'}</td>
        <td>${escapar(it.reps || '—')}</td>
        <td>${escapar(it.peso_sugerido || '—')}</td>
        <td class="n">${it.descanso_seg != null ? `${it.descanso_seg} s` : '—'}</td>
      </tr>`
    )
    .join('');
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>${escapar(r.nombre)} · ${escapar(deportista)}</title>
    <style>
      body { font-family: system-ui, sans-serif; color: #111; margin: 32px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      p { margin: 0 0 18px; color: #444; font-size: 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid #ccc; padding: 8px 6px; text-align: left; }
      th { font-size: 12px; text-transform: uppercase; color: #555; }
      .n { text-align: right; }
    </style></head><body>
    <h1>${escapar(r.nombre)}</h1>
    <p>${escapar(deportista)} · ${escapar(gimnasio)} · Asignada el ${escapar(formatFecha(r.asignada_en))}${
      r.entrenador_nombre ? ` por ${escapar(r.entrenador_nombre)}` : ''
    }</p>
    <table><thead><tr><th>#</th><th>Ejercicio</th><th class="n">Series</th><th>Repeticiones</th><th>Carga</th><th class="n">Descanso</th></tr></thead>
    <tbody>${filas}</tbody></table>
    </body></html>`);
  ventana.document.close();
  ventana.focus();
  ventana.print();
  return true;
}
