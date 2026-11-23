import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronUp,
  Home,
  CalendarPlus,
  Dumbbell,
  KeyRound,
  Lock,
  LogOut,
  ScanLine,
  Settings,
  Tv,
  ShoppingCart,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { Avatar } from '@web/components/ui/Avatar';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { useToast } from '@web/contexts/ToastContext';
import { aErrorGymDesk, invocar } from '../api/tauri';
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
import { InicioModulo } from './InicioModulo';
import { BotonAbrirPuerta, ConfigPuertaTarjeta } from './ConfigPuerta';

const NOMBRE_ROL: Record<UsuarioSesion['rol'], string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

type Modulo = 'inicio' | 'ingreso' | 'clientes' | 'membresias' | 'ventas' | 'caja';
type Vista = Modulo | 'pendientes' | 'pin' | 'equipo';

const MODULOS: { id: Modulo; etiqueta: string; tecla: string; icono: React.ReactNode; descripcion: string }[] = [
  { id: 'inicio', etiqueta: 'Inicio', tecla: 'Inicio', icono: <Home size={18} />, descripcion: 'Resumen del día y accesos rápidos' },
  { id: 'ingreso', etiqueta: 'Ingreso', tecla: 'F1', icono: <ScanLine size={18} />, descripcion: 'Documento, carné o huella' },
  { id: 'clientes', etiqueta: 'Clientes', tecla: 'F2', icono: <Users size={18} />, descripcion: 'Buscar, registrar y ver la ficha' },
  { id: 'membresias', etiqueta: 'Membresías', tecla: 'F3', icono: <CalendarPlus size={18} />, descripcion: 'Renovar o vender un plan' },
  { id: 'ventas', etiqueta: 'Ventas', tecla: 'F4', icono: <ShoppingCart size={18} />, descripcion: 'Productos y pases' },
  { id: 'caja', etiqueta: 'Caja', tecla: 'F5', icono: <Wallet size={18} />, descripcion: 'Turno, egresos y cierre' },
];
const TECLAS: Record<string, Modulo> = { Home: 'inicio', F1: 'ingreso', F2: 'clientes', F3: 'membresias', F4: 'ventas', F5: 'caja' };

/**
 * Sesión abierta. Menú lateral con los cinco módulos de recepción (atajos F1 a F5, F6 = nuevo cliente),
 * y abajo la conexión, la persona, el equipo, el PIN y el bloqueo.
 */
export const InicioPage: React.FC<{ usuario: UsuarioSesion }> = ({ usuario }) => {
  const { estacion, sesion, bloquear, cerrar, definirPin } = useSesion();
  const { showToast } = useToast();
  const accion = useEnvio();
  const formPin = useEnvio();

  const [vista, setVista] = useState<Vista>('inicio');
  const [modulo, setModulo] = useState<Modulo>('inicio');
  const [menuPerfil, setMenuPerfil] = useState(false);
  useEffect(() => {
    if (!menuPerfil) return;
    const cerrarMenu = (e: MouseEvent) => { if (!(e.target as Element).closest('.gd-cuenta')) setMenuPerfil(false); };
    const conEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPerfil(false); };
    document.addEventListener('mousedown', cerrarMenu);
    document.addEventListener('keydown', conEsc);
    return () => { document.removeEventListener('mousedown', cerrarMenu); document.removeEventListener('keydown', conEsc); };
  }, [menuPerfil]);
  const [huella, recargarHuella] = useHuella();
  // Cliente que pasa de un módulo a otro (ficha → renovar, ingreso negado → renovar, ficha → vender).
  const [clienteMembresia, setClienteMembresia] = useState<string | null>(null);
  const [clienteVenta, setClienteVenta] = useState<string | null>(null);
  const [atajoNuevo, setAtajoNuevo] = useState(0);
  const atajoUsado = useCallback(() => setAtajoNuevo(0), []);
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
  const titulo = actual?.etiqueta ?? (vista === 'pin' ? 'Mi PIN' : vista === 'equipo' ? 'Configuración del equipo' : 'Pendientes de sincronizar');

  return (
    <div className="app-layout gd-app-escritorio">
      <aside className="app-sidebar" aria-label="Navegación principal">
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo"><Dumbbell size={19} /></div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name" title={estacion?.gimnasio_nombre ?? ''}>{estacion?.gimnasio_nombre ?? 'GymDesk'}</span>
            <span className="sidebar-brand-sub">{estacion?.estacion_nombre ?? 'Recepción'}</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-seccion">
            <div className="nav-grupo">Recepción</div>
            <div className="nav-lista">
              {MODULOS.map((m) => (
                <button key={m.id} type="button" className={`nav-modulo ${vista === m.id ? 'activo' : ''}`}
                        aria-current={vista === m.id ? 'page' : undefined} onClick={() => irA(m.id)} title={m.descripcion}>
                  {m.icono}
                  <span>{m.etiqueta}</span>
                  {m.tecla !== 'Inicio' && <kbd className="gd-kbd">{m.tecla}</kbd>}
                </button>
              ))}
            </div>
          </div>
        </nav>
        <div className="sidebar-footer">
          {estacion && <IndicadorSync estacion={estacion} onAbrirPendientes={() => setVista(vista === 'pendientes' ? modulo : 'pendientes')} />}
        </div>
        <div className="sidebar-cuenta gd-cuenta" onClick={() => setMenuPerfil((v) => !v)} role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={menuPerfil}>
          <Avatar name={usuario.nombre} />
          <div className="sidebar-cuenta-texto">
            <span className="sidebar-cuenta-nombre" title={usuario.nombre}>{usuario.nombre}</span>
            <span className="sidebar-cuenta-rol">{NOMBRE_ROL[usuario.rol]}</span>
          </div>
          <ChevronUp size={16} className="gd-cuenta-flecha" />
          {menuPerfil && (
            <div className="gd-menu-perfil" role="menu" onClick={(e) => e.stopPropagation()}>
              <button role="menuitem" onClick={() => { setMenuPerfil(false); recargarHuella(); setVista('equipo'); }}><Settings size={16} /> Configuración del equipo</button>
              <button role="menuitem" onClick={() => { setMenuPerfil(false); setVista('pin'); }}><KeyRound size={16} /> Mi PIN</button>
              <button role="menuitem" disabled={accion.enviando} onClick={() => { setMenuPerfil(false); void accion.enviar(bloquear); }}><Lock size={16} /> Bloquear la estación</button>
              <button role="menuitem" className="peligro" disabled={accion.enviando} onClick={() => { setMenuPerfil(false); void accion.enviar(cerrar); }}><LogOut size={16} /> Cerrar sesión</button>
            </div>
          )}
        </div>
      </aside>

      <div className="app-content-wrapper">
        <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">{titulo}</h1>
            {actual && <p className="page-subtitle">{actual.descripcion}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {vista === 'ingreso' && <BotonAbrirPuerta />}
            {vista === 'clientes' && (
              <Button leftIcon={<UserPlus size={16} />} onClick={() => { irA('clientes'); setAtajoNuevo((n) => n + 1); }}>
                Nuevo cliente <kbd>F6</kbd>
              </Button>
            )}
            {vista !== modulo && (
              <Button variant="ghost" leftIcon={<ArrowLeft size={16} />} onClick={() => setVista(modulo)}>Volver</Button>
            )}
          </div>
        </div>

        <main>
          {accion.error && <MensajeError>{accion.error}</MensajeError>}
          {vista === 'pendientes' && estacion && <PendientesPanel estacion={estacion} onCerrar={() => setVista(modulo)} />}
          {vista === 'inicio' && estacion && (
            <InicioModulo estacion={estacion} nombreUsuario={usuario.nombre} irA={irA} nuevoCliente={() => { irA('clientes'); setAtajoNuevo((n) => n + 1); }} />
          )}
          {vista === 'ingreso' && estacion && <ControlIngresoPanel estacion={estacion} onCobrar={cobrar} />}
          {vista === 'clientes' && estacion && <ClientesPage estacion={estacion} onCobrar={cobrar} onVender={vender} atajoNuevo={atajoNuevo} onAtajoUsado={atajoUsado} />}
          {vista === 'membresias' && estacion && <MembresiasPage estacion={estacion} clienteInicial={clienteMembresia} onClienteUsado={limpiarMembresia} />}
          {vista === 'ventas' && estacion && <VentasPage estacion={estacion} clienteInicial={clienteVenta} onClienteUsado={limpiarVenta} />}
          {vista === 'caja' && estacion && <CajaPanel enLinea={estacion.en_linea} />}
          {vista === 'equipo' && (
            <div className="gd-config-grid">
              {huella ? <ConfigLector huella={huella} onCambio={recargarHuella} /> : <div className="skeleton" style={{ height: 160 }} />}
              <ConfigPuertaTarjeta />
              <section className="gd-tarjeta">
                <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}><Tv size={18} style={{ marginRight: 8 }} /> Pantalla de bienvenida (TV)</h2>
                <p className="gd-subtitulo">
                  Conecta el TV a este computador por HDMI y en Windows elige “Extender” (tecla Windows + P). La bienvenida se abre en el TV en
                  pantalla completa y muestra a cada persona que entra, al instante y también sin internet. Doble clic en el TV para salir de
                  pantalla completa.
                </p>
                <Button leftIcon={<Tv size={16} />} onClick={() => {
                  void invocar<string>('abrir_pantalla_bienvenida').then((r) => {
                    if (r === 'sin_segundo_monitor') showToast('warning', 'No se encontró el TV', 'Se abrió como ventana normal. Conecta el TV por HDMI, elige “Extender” y vuelve a abrirla.');
                    else showToast('success', 'Pantalla de bienvenida abierta', r === 'ya_abierta' ? 'Ya estaba abierta.' : 'Se abrió en el TV.');
                  }).catch((e) => showToast('error', 'No se abrió', aErrorGymDesk(e).mensaje));
                }}>
                  Abrir pantalla de bienvenida
                </Button>
              </section>
            </div>
          )}

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
    </div>
  );
};
