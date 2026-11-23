import React, { useCallback, useEffect, useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { useToast } from '@web/contexts/ToastContext';
import { aErrorGymDesk } from '../api/tauri';
import { puertaService, type ConfigPuerta, type EstadoPuerta } from '../api/puerta.service';
import { MensajeError } from '../components/Piezas';

/** Estado de la puerta de la estación (para el botón "Abrir puerta" de Ingreso). */
export function usePuerta(): EstadoPuerta | null {
  const [estado, setEstado] = useState<EstadoPuerta | null>(null);
  useEffect(() => { puertaService.estado().then(setEstado).catch(() => setEstado(null)); }, []);
  return estado;
}

/** Botón para abrir a mano (quien entra sin ingreso: proveedor, cortesía, salida). */
export const BotonAbrirPuerta: React.FC = () => {
  const puerta = usePuerta();
  const { showToast } = useToast();
  const [abriendo, setAbriendo] = useState(false);
  if (!puerta || puerta.config.tipo === 'ninguna') return null;
  return (
    <Button variant="outline" leftIcon={<DoorOpen size={16} />} isLoading={abriendo}
      onClick={() => {
        setAbriendo(true);
        puertaService.abrir('boton_ingreso')
          .then(() => showToast('success', 'Puerta abierta', `Se cierra sola en ${puerta.config.segundos} s.`))
          .catch((e) => showToast('error', 'No abrió', aErrorGymDesk(e).mensaje))
          .finally(() => setAbriendo(false));
      }}>
      Abrir puerta
    </Button>
  );
};

/** Configuración de la puerta: relé Wi-Fi Shelly u otra controladora con dirección web. Solo el Jefe la cambia. */
export const ConfigPuertaTarjeta: React.FC = () => {
  const { showToast } = useToast();
  const [estado, setEstado] = useState<EstadoPuerta | null>(null);
  const [cfg, setCfg] = useState<ConfigPuerta>({ tipo: 'ninguna', direccion: null, segundos: 3 });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const e = await puertaService.estado();
      setEstado(e);
      setCfg(e.config);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const cambiado = !!estado && JSON.stringify(estado.config) !== JSON.stringify(cfg);
  const editable = !!estado?.puede_configurar;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const guardada = await puertaService.configurar(cfg);
      setCfg(guardada);
      setEstado((e) => (e ? { ...e, config: guardada } : e));
      showToast('success', 'Puerta configurada', guardada.tipo === 'ninguna' ? 'Sin apertura automática.' : 'Se abre sola cuando el ingreso queda verde.');
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    setError(null);
    try {
      await puertaService.abrir('prueba');
      showToast('success', 'La puerta respondió', `Debe abrirse y cerrarse sola en ${cfg.segundos} s.`);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    } finally {
      setProbando(false);
    }
  };

  return (
    <section className="gd-tarjeta gd-config-tarjeta">
      <h2 className="gd-titulo"><DoorOpen size={18} /> Puerta o torniquete</h2>
      <p className="gd-subtitulo">
        Abre la cerradura (imán, portón o torniquete) cuando el ingreso queda verde, también sin internet. Se conecta con un
        relé en la misma red del gimnasio, instalado en la entrada del botón de salida.
      </p>
      {!estado ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : (
        <>
          <div className="gd-sexo gd-opciones-puerta" role="radiogroup" aria-label="Tipo de puerta">
            {estado.tipos.map(([id, texto]) => (
              <button key={id} type="button" role="radio" aria-checked={cfg.tipo === id} disabled={!editable}
                className={cfg.tipo === id ? 'activo' : ''} onClick={() => setCfg((c) => ({ ...c, tipo: id as ConfigPuerta['tipo'] }))}>
                {texto}
              </button>
            ))}
          </div>
          {cfg.tipo !== 'ninguna' && (
            <div className="gd-puerta-campos">
              <Input
                label={cfg.tipo === 'shelly' ? 'IP del relé Shelly' : 'Dirección que abre la puerta'}
                placeholder={cfg.tipo === 'shelly' ? '192.168.1.50' : 'http://192.168.1.60/abrir'}
                value={cfg.direccion ?? ''} disabled={!editable}
                onChange={(e) => setCfg((c) => ({ ...c, direccion: e.target.value }))}
              />
              <Input label="Segundos abierta" type="number" min={1} max={30} value={String(cfg.segundos)} disabled={!editable}
                onChange={(e) => setCfg((c) => ({ ...c, segundos: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))) }))} />
            </div>
          )}
          {cfg.tipo === 'shelly' && (
            <p className="gd-pista">
              La IP aparece en la app Shelly (Configuración → Información del dispositivo). Funciona con Shelly 1, Plus 1 y Pro 1. El relé se
              apaga solo, así la puerta nunca queda abierta.
            </p>
          )}
          {!editable && <p className="gd-pista">Solo el Jefe cambia la puerta de la estación.</p>}
          {error && <MensajeError>{error}</MensajeError>}
          <div className="gd-acciones">
            {editable && <Button onClick={() => void guardar()} isLoading={guardando} disabled={!cambiado}>Guardar</Button>}
            {estado.config.tipo !== 'ninguna' && (
              <Button variant="outline" leftIcon={<DoorOpen size={16} />} onClick={() => void probar()} isLoading={probando} disabled={cambiado}>
                Probar apertura
              </Button>
            )}
          </div>
          {cambiado && estado.config.tipo !== 'ninguna' && <p className="gd-pista">Guarda los cambios antes de probar.</p>}
        </>
      )}
    </section>
  );
};
