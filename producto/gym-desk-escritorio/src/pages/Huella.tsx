import React, { useEffect, useState } from 'react';
import { CheckCircle2, Fingerprint } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input, Select } from '@web/components/ui/Input';
import { Modal } from '@web/components/ui/Modal';
import { useToast } from '@web/contexts/ToastContext';
import { aErrorGymDesk } from '../api/tauri';
import { huellaService, NOMBRE_DEDO, type EstadoHuella } from '../api/huella.service';
import { MensajeError } from '../components/Piezas';

/** Estado del lector de la estación. `null` mientras carga. */
export function useHuella(): [EstadoHuella | null, () => void] {
  const [estado, setEstado] = useState<EstadoHuella | null>(null);
  const cargar = () => void huellaService.estado().then(setEstado).catch(() => setEstado(null));
  useEffect(cargar, []);
  return [estado, cargar];
}

/** Con el lector simulado, la "huella" es un código escrito. */
const CampoSimulado: React.FC<{ valor: string; onCambio: (v: string) => void }> = ({ valor, onCambio }) => (
  <Input
    label="Lector simulado (pruebas): código del dedo"
    placeholder="Ej. pedro-indice"
    value={valor}
    onChange={(e) => onCambio(e.target.value)}
  />
);

/**
 * Registrar la huella de un cliente: se elige el dedo y se lee varias veces. Queda en la estación
 * (para entrar sin red) y sube al servidor cifrada.
 */
export const RegistrarHuellaModal: React.FC<{
  abierto: boolean;
  cliente: { id: string; nombre: string } | null;
  huella: EstadoHuella;
  onCerrar: () => void;
}> = ({ abierto, cliente, huella, onCerrar }) => {
  const { showToast } = useToast();
  const [dedo, setDedo] = useState('indice_derecho');
  const [muestras, setMuestras] = useState<string[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulada, setSimulada] = useState('');
  const [registrados, setRegistrados] = useState<string[]>([]);
  const simulado = huella.lector === 'simulado';
  const total = simulado ? 1 : huella.muestras_registro;

  useEffect(() => {
    if (!abierto || !cliente) return;
    setMuestras([]);
    setError(null);
    setSimulada('');
    huellaService.dedos(cliente.id).then(setRegistrados).catch(() => setRegistrados([]));
  }, [abierto, cliente]);

  const leer = async () => {
    if (!cliente) return;
    setLeyendo(true);
    setError(null);
    try {
      const m = await huellaService.capturar(simulado ? simulada : undefined);
      const nuevas = [...muestras, m];
      if (nuevas.length < total) {
        setMuestras(nuevas);
      } else {
        await huellaService.registrar(cliente.id, dedo, nuevas);
        setMuestras([]);
        showToast('success', 'Huella registrada', `${cliente.nombre} · ${NOMBRE_DEDO[dedo] ?? dedo}. Ya puede entrar con su huella.`);
        onCerrar();
      }
    } catch (e) {
      const err = aErrorGymDesk(e);
      setError(err.mensaje);
      // Si las lecturas no coinciden entre sí, se empieza de nuevo.
      if (['HUELLAS_DISTINTAS', 'FALTAN_MUESTRAS'].includes(err.codigo)) setMuestras([]);
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <Modal
      isOpen={abierto}
      onClose={() => !leyendo && onCerrar()}
      title={`Registrar huella${cliente ? ` · ${cliente.nombre}` : ''}`}
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={leyendo}>Cerrar</Button>
          <Button leftIcon={<Fingerprint size={16} />} onClick={() => void leer()} isLoading={leyendo} disabled={simulado && !simulada.trim()}>
            {muestras.length === 0 ? 'Leer huella' : `Lectura ${muestras.length + 1} de ${total}`}
          </Button>
        </>
      }
    >
      {registrados.length > 0 && (
        <p className="gd-pista">Ya tiene registrado: {registrados.map((d) => NOMBRE_DEDO[d] ?? d).join(', ')}. Registrar el mismo dedo lo reemplaza.</p>
      )}
      <Select
        label="Dedo"
        value={dedo}
        onChange={(e) => { setDedo(e.target.value); setMuestras([]); }}
        options={huella.dedos.map((d) => ({ value: d, label: NOMBRE_DEDO[d] ?? d }))}
        disabled={leyendo || muestras.length > 0}
      />
      {simulado && <CampoSimulado valor={simulada} onCambio={setSimulada} />}
      <div className="gd-huella-pasos" aria-live="polite">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i < muestras.length ? 'hecho' : ''}>
            {i < muestras.length ? <CheckCircle2 size={18} /> : <Fingerprint size={18} />}
          </span>
        ))}
      </div>
      <p className="gd-subtitulo" style={{ margin: 0 }}>
        {leyendo ? 'Pon el dedo en el lector, plano y quieto…' : total > 1 ? `Se lee ${total} veces el mismo dedo. Levántalo entre lecturas.` : 'Escribe el código y lee.'}
      </p>
      {error && <MensajeError>{error}</MensajeError>}
    </Modal>
  );
};

/** Elegir el lector de la estación (solo el Jefe) y probarlo. */
export const ConfigLector: React.FC<{ huella: EstadoHuella; onCambio: () => void }> = ({ huella, onCambio }) => {
  const { showToast } = useToast();
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulada, setSimulada] = useState('');

  const cambiar = async (lector: string) => {
    setError(null);
    try {
      await huellaService.configurar(lector);
      onCambio();
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  };
  const probar = async () => {
    setProbando(true);
    setError(null);
    try {
      await huellaService.capturar(huella.lector === 'simulado' ? simulada : undefined);
      showToast('success', 'Lector funcionando', 'Leyó la huella correctamente.');
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    } finally {
      setProbando(false);
    }
  };

  return (
    <section className="gd-tarjeta" style={{ maxWidth: 520 }}>
      <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>
        <Fingerprint size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
        Lector de huella
      </h2>
      <p className="gd-subtitulo">
        Las huellas se comparan en este equipo, también sin internet. Para DigitalPersona hay que tener instalado el U.are.U Runtime de HID.
      </p>
      <Select
        label="Lector"
        value={huella.lector}
        disabled={!huella.puede_configurar || probando}
        onChange={(e) => void cambiar(e.target.value)}
        options={huella.lectores.map(([v, l]) => ({ value: v, label: l }))}
      />
      {!huella.puede_configurar && <p className="gd-pista">Solo el Jefe cambia el lector.</p>}
      {huella.lector === 'simulado' && <CampoSimulado valor={simulada} onCambio={setSimulada} />}
      {huella.lector !== 'ninguno' && (
        <Button variant="outline" leftIcon={<Fingerprint size={16} />} isLoading={probando} onClick={() => void probar()} style={{ marginTop: 8 }}>
          Probar lector
        </Button>
      )}
      {error && <MensajeError>{error}</MensajeError>}
    </section>
  );
};

/** Pedir la huella en el control de ingreso. Con el simulado, se escribe el código. */
export const IngresoHuellaModal: React.FC<{
  abierto: boolean;
  huella: EstadoHuella;
  onCerrar: () => void;
  onLeer: (simulada?: string) => void;
}> = ({ abierto, huella, onCerrar, onLeer }) => {
  const [simulada, setSimulada] = useState('');
  useEffect(() => { if (abierto) setSimulada(''); }, [abierto]);
  return (
    <Modal
      isOpen={abierto}
      onClose={onCerrar}
      title="Ingreso con huella"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button leftIcon={<Fingerprint size={16} />} disabled={!simulada.trim()} onClick={() => onLeer(simulada)}>Leer</Button>
        </>
      }
    >
      {huella.lector === 'simulado' && <CampoSimulado valor={simulada} onCambio={setSimulada} />}
    </Modal>
  );
};
