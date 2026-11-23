import React, { useEffect, useState } from 'react';
import { CalendarPlus, Dumbbell, LogIn, ShoppingCart, UserPlus, Users, Wallet } from 'lucide-react';
import { formatCOP } from '@web/utils/formato';
import { cajaService } from '../api/caja.service';
import { ingresoService } from '../api/ingreso.service';
import type { EstadoCaja } from '../types/caja.types';
import type { EstadoEstacion } from '../types/estacion.types';
import type { ResumenIngresos } from '../types/ingreso.types';

function saludo(h: number): string {
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Primera pantalla: el gimnasio, la hora, cómo va el día y los accesos rápidos de recepción. */
export const InicioModulo: React.FC<{
  estacion: EstadoEstacion;
  nombreUsuario: string;
  irA: (m: 'ingreso' | 'clientes' | 'membresias' | 'ventas' | 'caja') => void;
  nuevoCliente: () => void;
}> = ({ estacion, nombreUsuario, irA, nuevoCliente }) => {
  const [ahora, setAhora] = useState(new Date());
  const [ingresos, setIngresos] = useState<ResumenIngresos | null>(null);
  const [caja, setCaja] = useState<EstadoCaja | null>(null);
  const [porVencer, setPorVencer] = useState<number | null>(null);
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), 30_000);
    ingresoService.deHoy().then(setIngresos).catch(() => undefined);
    cajaService.estado().then(setCaja).catch(() => undefined);
    ingresoService.listar('', 'por_vencer', 1).then((p) => setPorVencer(p.total)).catch(() => undefined);
    return () => window.clearInterval(t);
  }, []);

  const sub = estacion.subdominio;
  const logo = sub ? `https://${sub}.gymdeskcolombia.com/api/v1/my-gym/public-imagen/${sub}/logo` : null;
  const hora = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  const fecha = ahora.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  const horaBogota = Number(ahora.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Bogota' }).slice(0, 2));
  const t = caja?.turno?.totales;

  const accesos: { texto: string; tecla: string; icono: React.ReactNode; accion: () => void }[] = [
    { texto: 'Registrar ingreso', tecla: 'F1', icono: <LogIn size={26} />, accion: () => irA('ingreso') },
    { texto: 'Nuevo cliente', tecla: 'F6', icono: <UserPlus size={26} />, accion: nuevoCliente },
    { texto: 'Renovar o vender plan', tecla: 'F3', icono: <CalendarPlus size={26} />, accion: () => irA('membresias') },
    { texto: 'Vender producto', tecla: 'F4', icono: <ShoppingCart size={26} />, accion: () => irA('ventas') },
  ];

  return (
    <div className="gd-inicio">
      <section className="gd-inicio-hero">
        <div className="gd-inicio-logo">
          {logo && logoOk ? <img src={logo} alt="" onError={() => setLogoOk(false)} /> : <Dumbbell size={46} />}
        </div>
        <div>
          <p className="gd-inicio-saludo">{saludo(horaBogota)}, {nombreUsuario.split(' ')[0]}</p>
          <h2>{estacion.gimnasio_nombre ?? 'GymDesk'}</h2>
          <p className="gd-inicio-fecha">{fecha} · {hora}</p>
        </div>
      </section>

      <section className="gd-inicio-kpis">
        <button type="button" onClick={() => irA('ingreso')}>
          <span><LogIn size={18} /> Entraron hoy</span>
          <strong>{ingresos ? ingresos.abrieron + ingresos.alertas : '—'}</strong>
          {ingresos && ingresos.negados > 0 && <small>{ingresos.negados} negados</small>}
        </button>
        <button type="button" onClick={() => irA('membresias')}>
          <span><CalendarPlus size={18} /> Por vencer esta semana</span>
          <strong>{porVencer ?? '—'}</strong>
          <small>Avísales y renuévalos</small>
        </button>
        <button type="button" onClick={() => irA('caja')}>
          <span><Wallet size={18} /> Caja</span>
          <strong>{caja ? (caja.turno ? formatCOP(t?.total_esperado_efectivo ?? 0) : 'Cerrada') : '—'}</strong>
          <small>{caja?.turno ? 'Efectivo esperado' : 'Ábrela para cobrar'}</small>
        </button>
        <button type="button" onClick={() => irA('clientes')}>
          <span><Users size={18} /> Clientes</span>
          <strong>{estacion.conteos.deportistas}</strong>
          <small>{estacion.conteos.membresias} membresías</small>
        </button>
      </section>

      <section className="gd-inicio-accesos">
        {accesos.map((a) => (
          <button key={a.texto} type="button" onClick={a.accion}>
            <span className="gd-inicio-acceso-icono">{a.icono}</span>
            <span>{a.texto}</span>
            <kbd>{a.tecla}</kbd>
          </button>
        ))}
      </section>
    </div>
  );
};
