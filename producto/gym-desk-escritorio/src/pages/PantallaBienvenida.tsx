import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CheckCircle2, Fingerprint, ScanLine, XCircle, AlertTriangle } from 'lucide-react';
import { invocar } from '../api/tauri';
import type { EstadoEstacion } from '../types/estacion.types';
import { LogoGimnasio } from '../components/LogoGimnasio';
import type { ResultadoIngreso } from '../types/ingreso.types';

/** Lo que se muestra de cada ingreso antes de volver a la pantalla de espera. */
const SEGUNDOS = 8;

function primerNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/)[0] ?? nombre;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase();
}

/**
 * Pantalla de bienvenida para el TV de recepción (segundo monitor por HDMI). Cada ingreso que registra la
 * estación llega como evento local, al instante y sin internet: foto, nombre, plan y días que le quedan.
 * Doble clic: salir de pantalla completa.
 */
export const PantallaBienvenida: React.FC = () => {
  const [gimnasio, setGimnasio] = useState('GymDesk');
  const [subdominio, setSubdominio] = useState<string | null>(null);
  const [actual, setActual] = useState<ResultadoIngreso | null>(null);
  const [ahora, setAhora] = useState(new Date());
  const [hoy, setHoy] = useState(0);
  const espera = useRef<number | undefined>(undefined);

  useEffect(() => {
    invocar<EstadoEstacion>('estado_estacion').then((e) => { setGimnasio(e.gimnasio_nombre ?? 'GymDesk'); setSubdominio(e.subdominio); }).catch(() => undefined);
    const reloj = window.setInterval(() => setAhora(new Date()), 1000);
    const quitar = listen<ResultadoIngreso>('ingreso-registrado', (e) => {
      setActual(e.payload);
      if (e.payload.abre) setHoy((n) => n + 1);
      window.clearTimeout(espera.current);
      espera.current = window.setTimeout(() => setActual(null), SEGUNDOS * 1000);
    });
    return () => {
      window.clearInterval(reloj);
      window.clearTimeout(espera.current);
      void quitar.then((f) => f());
    };
  }, []);

  const alternarPantallaCompleta = async () => {
    const v = getCurrentWindow();
    await v.setFullscreen(!(await v.isFullscreen()));
  };

  const hora = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  const fecha = ahora.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });

  if (!actual || !actual.cliente) {
    return (
      <main className="tv tv-espera" onDoubleClick={() => void alternarPantallaCompleta()}>
        <div className="tv-marca"><LogoGimnasio subdominio={subdominio} tam={140} className="tv-logo" /> {gimnasio}</div>
        <div className="tv-hora">{hora}</div>
        <div className="tv-fecha">{fecha}</div>
        <div className="tv-indicacion">
          <ScanLine size={36} /> Pasa tu carné o <Fingerprint size={36} /> pon tu huella en recepción
        </div>
        {hoy > 0 && <div className="tv-contador">{hoy} {hoy === 1 ? 'persona ha entrenado' : 'personas han entrenado'} hoy</div>}
      </main>
    );
  }

  const c = actual.cliente;
  const tono = actual.resultado === 'abrio' ? 'abre' : actual.resultado === 'alerta_mora' ? 'alerta' : 'negado';
  const titular =
    tono === 'abre' ? `¡Bienvenido, ${primerNombre(c.nombre)}!` : tono === 'alerta' ? `¡Hola, ${primerNombre(c.nombre)}!` : `${primerNombre(c.nombre)}, acércate a recepción`;
  const detalle =
    actual.resultado === 'abrio' && c.con_pase_dia
      ? 'Pase de día'
      : c.estado === 'activo' || c.estado === 'por_vencer'
        ? `Te ${c.dias_restantes_o_vencido === 1 ? 'queda 1 día' : `quedan ${c.dias_restantes_o_vencido} días`} de ${c.plan_nombre ?? 'tu plan'}`
        : c.estado === 'en_gracia'
          ? `Tu plan venció hace ${c.dias_restantes_o_vencido} ${c.dias_restantes_o_vencido === 1 ? 'día' : 'días'}. Renuévalo en recepción`
          : actual.mensaje;

  return (
    <main className={`tv tv-${tono}`} onDoubleClick={() => void alternarPantallaCompleta()}>
      <div className="tv-tarjeta">
        {c.foto ? <img className="tv-foto" src={c.foto} alt="" /> : <div className="tv-foto tv-iniciales">{iniciales(c.nombre)}</div>}
        <div className="tv-texto">
          <div className="tv-icono">
            {tono === 'abre' ? <CheckCircle2 size={64} /> : tono === 'alerta' ? <AlertTriangle size={64} /> : <XCircle size={64} />}
          </div>
          <h1>{titular}</h1>
          <p>{detalle}</p>
          {c.estado === 'por_vencer' && <p className="tv-aviso">Tu plan está por vencer: renuévalo en recepción</p>}
        </div>
      </div>
      <div className="tv-pie"><LogoGimnasio subdominio={subdominio} tam={40} className="tv-logo-pie" /> {gimnasio} · {hora}</div>
    </main>
  );
};
