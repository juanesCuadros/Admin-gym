import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  Dumbbell,
  KeyRound,
  Lock,
  LogOut,
  ScanLine,
  Settings,
  ShoppingCart,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { useToast } from '@web/contexts/ToastContext';
import { IndicadorSync } from '../components/IndicadorSync';
import { CampoPin, MensajeError } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { UsuarioSesion } from '../types/sesion.types';
import { CajaPanel } from './CajaPanel';
import { ClientesPage } from './ClientesPage';
import { ControlIngresoPanel } from './ControlIngresoPanel';
import { ConfigLector, useHuella } from './Huella';
import { MembresiasPage, VentasPage } from './ModulosCobro';
import { PendientesPanel } from './PendientesPanel';

const NOMBRE_ROL: Record<UsuarioSesion['rol'], string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

type Modulo = 'ingreso' | 'clientes' | 'membresias' | 'ventas' | 'caja';
type Vista = Modulo | 'pendientes' | 'pin' | 'equipo';

const MODULOS: { id: Modulo; etiqueta: string; tecla: string; icono: React.ReactNode; descripcion: string }[] = [
  { id: 'ingreso', etiqueta: 'Ingreso', tecla: 'F1', icono: <ScanLine size={24} />, descripcion: 'Documento, carné o huella' },
  { id: 'clientes', etiqueta: 'Clientes', tecla: 'F2', icono: <Users size={24} />, descripcion: 'Buscar, registrar y ver la ficha' },
  { id: 'membresias', etiqueta: 'Membresías', tecla: 'F3', icono: <CalendarPlus size={24} />, descripcion: 'Renovar o vender un plan' },
  { id: 'ventas', etiqueta: 'Ventas', tecla: 'F4', icono: <ShoppingCart size={24} />, descripcion: 'Productos y pases' },
  { id: 'caja', etiqueta: 'Caja', tecla: 'F5', icono: <Wallet size={24} />, descripcion: 'Turno, egresos y cierre' },
];
const TECLAS: Record<string, Modulo> = { F1: 'ingreso', F2: 'clientes', F3: 'membresias', F4: 'ventas', F5: 'caja' };

/**
 * Sesión abierta. Menú lateral con los cinco módulos de recepción (atajos F1 a F5, F6 = nuevo cliente),
 * y abajo la conexión, la persona, el equipo, el PIN y el bloqueo.
 */
export const InicioPage: React.FC<{ usuario: UsuarioSesion }> = ({ usuario }) => {
  const { estacion, sesion, bloquear, cerrar, definirPin } = useSesion();
  const { showToast } = useToast();
  const accion = useEnvio();
  const formPin = useEnvio();

  const [vista, setVista] = useState<Vista>('ingreso');
  const [modulo, setModulo] = useState<Modulo>('ingreso');
  const [huella, recargarHuella] = useHuella();
  // Cliente que pasa de un módulo a otro (ficha → renovar, ingreso negado → renovar, ficha → vender).
  const [clienteMembresia, setClienteMembresia] = useState<string | null>(null);
  const [clienteVenta, setClienteVenta] = useState<string | null>(null);
  const [atajoNuevo, setAtajoNuevo] = useState(0);
  const limpiarMembresia = useCallback(() => setClienteMembresia(null), []);
  const limpiarVenta = useCallback(() => setClienteVenta(null), []);

  const irA = useCallback((m: Modulo) => {
    setModulo(m);
    setVista(m);
  }, []);
  const cobrar = useCallback((id: string) => { setClienteMembresia(id); irA('membresias'); }, [irA]);
  const vender = useCallback((id: string) => { setClienteVenta(id); irA('ventas'); }, [irA]);

  // Atajos de teclado, como en un punto de venta de mostrador. No actúan con una ventana emergente abierta.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-overlay, .drawer.open')) return;
      const m = TECLAS[e.key];
      if (m) {
        e.preventDefault();
        irA(m);
      } else if (e.key === 'F6') {
        e.preventDefault();
        irA('clientes');
        setAtajoNuevo((n) => n + 1);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [irA]);

  // PIN
  const [passwordActual, setPasswordActual] = useState('');
  const [pin, setPin] = useState('');
  const [pinRepetido, setPinRepetido] = useState('');
  const noCoincide = pinRepetido.length === 4 && pin !== pinRepetido;
  const puedeGuardar = passwordActual !== '' && pin.length === 4 && pin === pinRepetido;
  const alGuardarPin = (e: React.FormEvent) => {
    e.preventDefault();
    const teniaPin = usuario.tiene_pin;
    void formPin
      .enviar(() => definirPin(passwordActual, pin))
      .then((ok) => {
        setPasswordActual('');
        if (!ok) return;
        setPin('');
        setPinRepetido('');
        showToast('success', teniaPin ? 'PIN cambiado' : 'PIN creado', 'Ya puedes entrar y desbloquear esta estación con tu PIN.');
      });
  };

  const actual = MODULOS.find((m) => m.id === vista);
  const titulo = actual?.etiqueta ?? (vista === 'pin' ? 'Mi PIN' : vista === 'equipo' ? 'Equipo' : 'Pendientes de sincronizar');

  return (
    <div className="gd-shell">
      <aside className="gd-lateral" aria-label="Módulos">
        <div className="gd-lateral-marca">
          <span className="gd-marca-icono"><Dumbbell size={18} /></span>
          <div>
            <strong>{estacion?.gimnasio_nombre ?? 'GymDesk'}</strong>
            <span>{estacion?.estacion_nombre ?? 'Recepción'}</span>
          </div>
        </div>
        <nav className="gd-lateral-modulos">
          {MODULOS.map((m) => (
            <button key={m.id} className={modulo === m.id && vista === m.id ? 'activo' : ''} aria-current={vista === m.id ? 'page' : undefined} onClick={() => irA(m.id)}>
              <span className="gd-lateral-icono">{m.icono}</span>
              <span className="gd-lateral-texto">
                <span>{m.etiqueta}</span>
                <small>{m.descripcion}</small>
              </span>
              <kbd>{m.tecla}</kbd>
            </button>
          ))}
        </nav>
        <div className="gd-lateral-pie">
          {estacion && <IndicadorSync estacion={estacion} onAbrirPendientes={() => setVista(vista === 'pendientes' ? modulo : 'pendientes')} />}
          <div className="gd-lateral-usuario">
            <strong>{usuario.nombre}</strong>
            <span>{NOMBRE_ROL[usuario.rol]}</span>
          </div>
          <div className="gd-lateral-botones">
            <button title="Equipo y lector de huella" onClick={() => { recargarHuella(); setVista(vista === 'equipo' ? modulo : 'equipo'); }}><Settings size={17} /></button>
            <button title="Mi PIN" onClick={() => setVista(vista === 'pin' ? modulo : 'pin')}><KeyRound size={17} /></button>
            <button title="Bloquear la estación" disabled={accion.enviando} onClick={() => void accion.enviar(bloquear)}><Lock size={17} /></button>
            <button title="Cerrar sesión" disabled={accion.enviando} onClick={() => void accion.enviar(cerrar)}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <div className="gd-principal">
        <header className="gd-cabecera">
          <div>
            <h1>{titulo}</h1>
            {actual && <p>{actual.descripcion}</p>}
          </div>
          <div className="gd-cabecera-acciones">
            {vista === 'clientes' && (
              <Button variant="outline" leftIcon={<UserPlus size={16} />} onClick={() => { irA('clientes'); setAtajoNuevo((n) => n + 1); }}>
                Nuevo cliente <kbd>F6</kbd>
              </Button>
            )}
            {vista !== modulo && (
              <Button variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => setVista(modulo)}>Volver</Button>
            )}
          </div>
        </header>

        <main className="gd-cuerpo">
          {accion.error && <MensajeError>{accion.error}</MensajeError>}
          {vista === 'pendientes' && estacion && <PendientesPanel estacion={estacion} onCerrar={() => setVista(modulo)} />}
          {vista === 'ingreso' && estacion && <ControlIngresoPanel estacion={estacion} onCobrar={cobrar} />}
          {vista === 'clientes' && estacion && <ClientesPage estacion={estacion} onCobrar={cobrar} onVender={vender} atajoNuevo={atajoNuevo} />}
          {vista === 'membresias' && estacion && <MembresiasPage estacion={estacion} clienteInicial={clienteMembresia} onClienteUsado={limpiarMembresia} />}
          {vista === 'ventas' && estacion && <VentasPage estacion={estacion} clienteInicial={clienteVenta} onClienteUsado={limpiarVenta} />}
          {vista === 'caja' && estacion && <CajaPanel enLinea={estacion.en_linea} />}
          {vista === 'equipo' && (huella ? <ConfigLector huella={huella} onCambio={recargarHuella} /> : <div className="skeleton" style={{ height: 160, maxWidth: 520 }} />)}

          <section className="gd-tarjeta" style={{ maxWidth: 440, display: vista === 'pin' ? undefined : 'none' }}>
            <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>
              <KeyRound size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
              {usuario.tiene_pin ? 'Cambiar mi PIN' : 'Crear mi PIN'}
            </h2>
            <p className="gd-subtitulo">
              El PIN es de 4 números y solo sirve en esta estación. Con él entras y desbloqueas sin escribir la contraseña. La
              estación se bloquea sola a los {sesion?.minutos_inactividad ?? 5} minutos sin uso.
            </p>
            <form onSubmit={alGuardarPin} noValidate>
              <Input label="Tu contraseña actual" type="password" autoComplete="current-password" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} disabled={formPin.enviando} />
              <CampoPin label="PIN nuevo" value={pin} onChange={setPin} disabled={formPin.enviando} />
              <CampoPin label="Repite el PIN" value={pinRepetido} onChange={setPinRepetido} disabled={formPin.enviando} error={noCoincide ? 'Los dos PIN no coinciden.' : undefined} />
              {formPin.error && <MensajeError>{formPin.error}</MensajeError>}
              <Button type="submit" isLoading={formPin.enviando} disabled={!puedeGuardar} style={{ marginTop: 16 }}>
                {usuario.tiene_pin ? 'Cambiar PIN' : 'Crear PIN'}
              </Button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
};
