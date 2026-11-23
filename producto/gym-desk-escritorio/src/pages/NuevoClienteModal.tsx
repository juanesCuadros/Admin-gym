import React, { useEffect, useRef, useState } from 'react';
import { Camera, CloudOff, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input, Select } from '@web/components/ui/Input';
import { Modal } from '@web/components/ui/Modal';
import { ingresoService } from '../api/ingreso.service';
import { MensajeError } from '../components/Piezas';
import { useEnvio } from '../hooks/useEnvio';
import type { ClienteEvaluado, NuevoCliente } from '../types/ingreso.types';

type TipoDoc = NuevoCliente['tipo_documento'];
const TIPOS: { value: TipoDoc; label: string }[] = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'TI', label: 'Tarjeta de identidad' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PAS', label: 'Pasaporte' },
  { value: 'PPT', label: 'Permiso de protección temporal' },
  { value: 'RC', label: 'Registro civil' },
];

/** Edad cumplida hoy en Bogotá, o null si la fecha no es válida. */
function edad(fecha: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const [a, m, d] = fecha.split('-').map(Number);
  const [ha, hm, hd] = hoy.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** Toma una foto con la cámara web. Opcional: si la cámara falla, se registra sin foto. */
const CamaraFoto: React.FC<{ foto: string | null; onFoto: (f: string | null) => void; disabled?: boolean }> = ({ foto, onFoto, disabled }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [flujo, setFlujo] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apagar = () => {
    flujo?.getTracks().forEach((t) => t.stop());
    setFlujo(null);
  };
  useEffect(() => () => flujo?.getTracks().forEach((t) => t.stop()), [flujo]);
  useEffect(() => {
    if (video.current && flujo) video.current.srcObject = flujo;
  }, [flujo]);

  const encender = async () => {
    setError(null);
    try {
      setFlujo(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }));
    } catch {
      setError('No se pudo usar la cámara. Revisa que esté conectada y que no la use otro programa. Puedes registrar sin foto.');
    }
  };

  const tomar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // Recorte cuadrado del centro, 480 × 480, JPG: liviano para subir y para guardar en la estación.
    const lado = Math.min(v.videoWidth, v.videoHeight);
    const lienzo = document.createElement('canvas');
    lienzo.width = 480;
    lienzo.height = 480;
    lienzo.getContext('2d')?.drawImage(v, (v.videoWidth - lado) / 2, (v.videoHeight - lado) / 2, lado, lado, 0, 0, 480, 480);
    onFoto(lienzo.toDataURL('image/jpeg', 0.82));
    apagar();
  };

  return (
    <div className="gd-camara">
      <span className="gd-camara-etiqueta">Foto (opcional)</span>
      {foto ? (
        <div className="gd-camara-vista">
          <img src={foto} alt="Foto del cliente" />
          <div className="gd-camara-acciones">
            <Button variant="outline" size="sm" leftIcon={<RotateCcw size={14} />} disabled={disabled} onClick={() => { onFoto(null); void encender(); }}>
              Repetir
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} disabled={disabled} onClick={() => onFoto(null)}>
              Quitar
            </Button>
          </div>
        </div>
      ) : flujo ? (
        <div className="gd-camara-vista">
          <video ref={video} autoPlay playsInline muted />
          <div className="gd-camara-acciones">
            <Button size="sm" leftIcon={<Camera size={14} />} onClick={tomar}>Tomar foto</Button>
            <Button variant="ghost" size="sm" onClick={apagar}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" leftIcon={<Camera size={14} />} disabled={disabled} onClick={() => void encender()}>
          Encender cámara
        </Button>
      )}
      {error && <p className="gd-pista">{error}</p>}
    </div>
  );
};

/**
 * Registrar un cliente desde la estación (E-41). Exige conexión: el servidor aplica las reglas de la web
 * (consentimiento de la Ley 1581, menor de edad con acudiente, documento único). Queda en la estación de
 * inmediato para dejarlo entrar o cobrarle.
 */
export const NuevoClienteModal: React.FC<{
  abierto: boolean;
  enLinea: boolean;
  documentoInicial?: string;
  onCerrar: () => void;
  onRegistrado: (c: ClienteEvaluado) => void;
}> = ({ abierto, enLinea, documentoInicial, onCerrar, onRegistrado }) => {
  const [tipo, setTipo] = useState<TipoDoc>('CC');
  const [documento, setDocumento] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [correo, setCorreo] = useState('');
  const [sexo, setSexo] = useState<'' | 'M' | 'F' | 'otro'>('');
  const [nacimiento, setNacimiento] = useState('');
  const [acudiente, setAcudiente] = useState({ nombre: '', tipo_documento: 'CC' as TipoDoc, documento: '', telefono: '', parentesco: '', autoriza: false });
  const [consentimiento, setConsentimiento] = useState(false);
  const [foto, setFoto] = useState<string | null>(null);
  const envio = useEnvio();

  useEffect(() => {
    if (!abierto) return;
    setTipo('CC');
    setDocumento(documentoInicial?.trim() ?? '');
    setNombre('');
    setTelefono('');
    setCorreo('');
    setSexo('');
    setNacimiento('');
    setAcudiente({ nombre: '', tipo_documento: 'CC', documento: '', telefono: '', parentesco: '', autoriza: false });
    setConsentimiento(false);
    setFoto(null);
  }, [abierto, documentoInicial]);

  const anos = nacimiento ? edad(nacimiento) : null;
  const menor = anos !== null && anos < 18;

  const problema = (() => {
    if (!enLinea) return 'Sin conexión no se pueden registrar clientes.';
    if (documento.trim().length < 3) return 'Escribe el número de documento.';
    if (nombre.trim().length < 2) return 'Escribe el nombre completo.';
    if (correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())) return 'Revisa el correo.';
    if (nacimiento && (anos === null || anos < 0 || anos > 110)) return 'Revisa la fecha de nacimiento.';
    if (menor) {
      if (acudiente.nombre.trim().length < 2 || acudiente.documento.trim().length < 3 || acudiente.telefono.trim().length < 5 || acudiente.parentesco.trim().length < 2)
        return 'Es menor de edad: completa los datos del acudiente.';
      if (!acudiente.autoriza) return 'Es menor de edad: el acudiente debe autorizar.';
    }
    if (!consentimiento) return 'El cliente debe aceptar el tratamiento de sus datos (Ley 1581).';
    return null;
  })();

  const registrar = () => {
    if (problema) return;
    const datos: NuevoCliente = {
      tipo_documento: tipo,
      documento: documento.trim(),
      nombre: nombre.trim(),
      consentimiento_1581: true,
      ...(telefono.trim() ? { telefono: telefono.trim() } : {}),
      ...(correo.trim() ? { correo: correo.trim() } : {}),
      ...(sexo ? { sexo } : {}),
      ...(nacimiento ? { fecha_nacimiento: nacimiento } : {}),
      ...(menor ? { acudiente: { ...acudiente, nombre: acudiente.nombre.trim(), documento: acudiente.documento.trim(), telefono: acudiente.telefono.trim(), parentesco: acudiente.parentesco.trim() } } : {}),
    };
    void envio.enviar(async () => {
      const c = await ingresoService.registrarCliente(datos, foto);
      onRegistrado(c);
    });
  };

  return (
    <Modal
      isOpen={abierto}
      onClose={() => !envio.enviando && onCerrar()}
      title="Nuevo cliente"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={envio.enviando}>Cancelar</Button>
          <Button onClick={registrar} isLoading={envio.enviando} disabled={problema !== null}>Registrar cliente</Button>
        </>
      }
    >
      {!enLinea && (
        <div className="gd-aviso" role="status">
          <CloudOff size={16} style={{ flexShrink: 0 }} />
          <span>Para registrar un cliente se necesita internet. Mientras tanto puedes registrar una cortesía.</span>
        </div>
      )}
      <div className="gd-form-dos">
        <Select label="Tipo de documento" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDoc)} options={TIPOS} />
        <Input id="nc-documento" label="Número de documento" value={documento} maxLength={30} onChange={(e) => setDocumento(e.target.value)} />
      </div>
      <Input id="nc-nombre" label="Nombre completo" value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} />
      <div className="gd-form-dos">
        <Input id="nc-telefono" label="Celular (opcional)" value={telefono} maxLength={25} onChange={(e) => setTelefono(e.target.value)} />
        <Input id="nc-correo" label="Correo (opcional)" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </div>
      <div className="gd-form-dos">
        <Select
          label="Sexo (opcional)"
          value={sexo}
          onChange={(e) => setSexo(e.target.value as typeof sexo)}
          options={[{ value: '', label: 'Sin indicar' }, { value: 'F', label: 'Femenino' }, { value: 'M', label: 'Masculino' }, { value: 'otro', label: 'Otro' }]}
        />
        <Input id="nc-nacimiento" label="Fecha de nacimiento (opcional)" type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} />
      </div>

      {menor && (
        <fieldset className="gd-acudiente">
          <legend>Acudiente (es menor de edad: {anos} años)</legend>
          <Input label="Nombre del acudiente" value={acudiente.nombre} onChange={(e) => setAcudiente({ ...acudiente, nombre: e.target.value })} />
          <div className="gd-form-dos">
            <Select label="Tipo de documento" value={acudiente.tipo_documento} onChange={(e) => setAcudiente({ ...acudiente, tipo_documento: e.target.value as TipoDoc })} options={TIPOS} />
            <Input label="Documento" value={acudiente.documento} onChange={(e) => setAcudiente({ ...acudiente, documento: e.target.value })} />
          </div>
          <div className="gd-form-dos">
            <Input label="Celular" value={acudiente.telefono} onChange={(e) => setAcudiente({ ...acudiente, telefono: e.target.value })} />
            <Input label="Parentesco" placeholder="Madre, padre, tutor…" value={acudiente.parentesco} onChange={(e) => setAcudiente({ ...acudiente, parentesco: e.target.value })} />
          </div>
          <label className="gd-check">
            <input type="checkbox" checked={acudiente.autoriza} onChange={(e) => setAcudiente({ ...acudiente, autoriza: e.target.checked })} />
            El acudiente autoriza el tratamiento de los datos del menor y su participación en las actividades.
          </label>
        </fieldset>
      )}

      <CamaraFoto foto={foto} onFoto={setFoto} disabled={envio.enviando} />

      <label className="gd-check">
        <input type="checkbox" checked={consentimiento} onChange={(e) => setConsentimiento(e.target.checked)} />
        El cliente acepta el tratamiento de sus datos personales según la Ley 1581 de 2012.
      </label>
      {envio.error && <MensajeError>{envio.error}</MensajeError>}
      {problema && enLinea && <p className="gd-pista">{problema}</p>}
    </Modal>
  );
};
