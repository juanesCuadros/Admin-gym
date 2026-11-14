/**
 * Sonidos del control de ingreso. Se generan en el momento (sin archivos de audio), para que
 * recepción sepa el resultado sin mirar la pantalla: dos tonos que suben, un tono doble de
 * aviso, o un tono grave largo.
 */
export type TonoIngreso = 'abre' | 'alerta' | 'negado';

type Nota = { hz: number; desde: number; dura: number };

const PARTITURA: Record<TonoIngreso, Nota[]> = {
  abre: [
    { hz: 660, desde: 0, dura: 0.12 },
    { hz: 880, desde: 0.13, dura: 0.18 },
  ],
  alerta: [
    { hz: 587, desde: 0, dura: 0.14 },
    { hz: 587, desde: 0.2, dura: 0.14 },
    { hz: 587, desde: 0.4, dura: 0.14 },
  ],
  negado: [{ hz: 196, desde: 0, dura: 0.55 }],
};

let contexto: AudioContext | null = null;

export function sonar(tono: TonoIngreso): void {
  try {
    contexto ??= new AudioContext();
    const ctx = contexto;
    void ctx.resume();
    for (const nota of PARTITURA[tono]) {
      const oscilador = ctx.createOscillator();
      const volumen = ctx.createGain();
      const inicio = ctx.currentTime + nota.desde;
      oscilador.type = tono === 'negado' ? 'square' : 'sine';
      oscilador.frequency.value = nota.hz;
      // Entrada y salida suaves: sin ellas cada nota hace un clic.
      volumen.gain.setValueAtTime(0.0001, inicio);
      volumen.gain.exponentialRampToValueAtTime(tono === 'negado' ? 0.18 : 0.3, inicio + 0.02);
      volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + nota.dura);
      oscilador.connect(volumen).connect(ctx.destination);
      oscilador.start(inicio);
      oscilador.stop(inicio + nota.dura + 0.02);
    }
  } catch {
    // Sin dispositivo de audio la pantalla sigue mostrando el resultado.
  }
}
