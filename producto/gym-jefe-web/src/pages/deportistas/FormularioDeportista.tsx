import React, { useEffect, useMemo, useState } from 'react';
import { deportistasService } from '../../api/deportistas.service';
import { ApiError, toApiError } from '../../api/client';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { MensajeFijo, Conflicto } from '../../components/estados/Estados';
import { hoyBogota } from '../../utils/fechasBogota';
import {
  AcudienteDto,
  CrearDeportistaRequest,
  DeportistaResponse,
  DetallesLimitePlanClientes,
  EditarDeportistaRequest,
  NOMBRE_TIPO_DOCUMENTO,
  TIPOS_DOCUMENTO,
  TipoDocumento,
} from '../../types/deportistas.types';

/** Versión del texto de consentimiento que muestra este formulario (Ley 1581). */
const VERSION_CONSENTIMIENTO = '1.0';

interface Valores {
  tipo_documento: TipoDocumento | '';
  documento: string;
  nombre: string;
  correo: string;
  telefono: string;
  sexo: '' | 'M' | 'F' | 'otro';
  fecha_nacimiento: string;
  altura_cm: string;
  consentimiento_1581: boolean;
  acudiente: {
    nombre: string;
    tipo_documento: TipoDocumento | '';
    documento: string;
    telefono: string;
    parentesco: string;
    autoriza: boolean;
  };
}

const VACIO: Valores = {
  tipo_documento: '',
  documento: '',
  nombre: '',
  correo: '',
  telefono: '',
  sexo: '',
  fecha_nacimiento: '',
  altura_cm: '',
  consentimiento_1581: false,
  acudiente: { nombre: '', tipo_documento: '', documento: '', telefono: '', parentesco: '', autoriza: false },
};

function desdeDeportista(d: DeportistaResponse): Valores {
  const tipo = (TIPOS_DOCUMENTO as readonly string[]).includes(d.tipo_documento) ? (d.tipo_documento as TipoDocumento) : '';
  return {
    tipo_documento: tipo,
    documento: d.documento,
    nombre: d.nombre,
    correo: d.correo ?? '',
    telefono: d.telefono ?? '',
    sexo: (d.sexo as Valores['sexo']) ?? '',
    fecha_nacimiento: d.fecha_nacimiento ?? '',
    altura_cm: d.altura_cm !== null && d.altura_cm !== undefined ? String(d.altura_cm) : '',
    consentimiento_1581: d.consentimiento_1581,
    acudiente: {
      nombre: d.acudiente?.nombre ?? d.acudiente_nombre ?? '',
      tipo_documento: d.acudiente?.tipo_documento ?? '',
      documento: d.acudiente?.documento ?? '',
      telefono: d.acudiente?.telefono ?? '',
      parentesco: d.acudiente?.parentesco ?? '',
      autoriza: d.acudiente?.autoriza ?? false,
    },
  };
}

/** Edad cumplida a hoy en Bogotá. `null` si no hay fecha válida. */
export function edadEnBogota(fechaNacimiento: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) return null;
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  const [ha, hm, hd] = hoyBogota().split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** Lleva los errores 422 del backend al campo que los causó (incluidos los del acudiente). */
function camposDelServidor(err: ApiError): Record<string, string> {
  const campos: Record<string, string> = {};
  if (!Array.isArray(err.detalles)) return campos;
  for (const item of err.detalles as Array<{ campo?: string; mensaje?: string }>) {
    if (!item?.campo || !item.mensaje) continue;
    const partes = item.campo
      .split('->')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'body');
    const clave = partes[0] === 'acudiente' && partes.length > 1 ? `acudiente.${partes[partes.length - 1]}` : partes[partes.length - 1];
    if (clave && !campos[clave]) campos[clave] = item.mensaje;
  }
  return campos;
}

interface FormularioDeportistaProps {
  isOpen: boolean;
  /** Sin `inicial` se crea; con `inicial` se edita (con su `version`). */
  inicial?: DeportistaResponse | null;
  onCerrar: () => void;
  onGuardado: (d: DeportistaResponse) => void;
  /** 409 de concurrencia: el padre recarga el registro. */
  onRecargar?: () => void;
}

/**
 * Registro y edición del deportista (GW-RF-17, GW-RF-19, contrato 2.3).
 * Tipo de documento obligatorio; si es menor de 18 años (hora Bogotá) exige los datos del acudiente y su autorización.
 */
export const FormularioDeportista: React.FC<FormularioDeportistaProps> = ({
  isOpen,
  inicial,
  onCerrar,
  onGuardado,
  onRecargar,
}) => {
  const editando = !!inicial;
  const base = useMemo(() => (inicial ? desdeDeportista(inicial) : VACIO), [inicial]);
  const [v, setV] = useState<Valores>(base);
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [intentoEnviar, setIntentoEnviar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [limite, setLimite] = useState<DetallesLimitePlanClientes | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setV(base);
    setTocados({});
    setIntentoEnviar(false);
    setErroresServidor({});
    setErrorGeneral(null);
    setLimite(null);
    setConflicto(false);
  }, [isOpen, base]);

  const edad = edadEnBogota(v.fecha_nacimiento);
  const esMenor = edad !== null && edad < 18;
  const hayCambios = JSON.stringify(v) !== JSON.stringify(base);

  // ---- Validación local (el servidor vuelve a validar todo) ----
  const errores: Record<string, string> = {};
  if (!v.tipo_documento) errores.tipo_documento = 'Elige el tipo de documento.';
  if (v.documento.trim().length < 3) errores.documento = 'Escribe el documento (mínimo 3 caracteres).';
  if (v.nombre.trim().length < 2) errores.nombre = 'Escribe el nombre completo.';
  if (v.correo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.correo.trim())) errores.correo = 'El correo no es válido.';
  if (v.fecha_nacimiento && (edad === null || edad < 0)) errores.fecha_nacimiento = 'La fecha de nacimiento no es válida.';
  if (v.altura_cm.trim() && !(Number(v.altura_cm) > 0)) errores.altura_cm = 'La estatura debe ser mayor a 0.';
  if (!editando && !v.consentimiento_1581) errores.consentimiento_1581 = 'Sin la autorización de tratamiento de datos no se puede registrar.';
  if (esMenor) {
    const a = v.acudiente;
    if (a.nombre.trim().length < 2) errores['acudiente.nombre'] = 'Escribe el nombre del acudiente.';
    if (!a.tipo_documento) errores['acudiente.tipo_documento'] = 'Elige el tipo de documento del acudiente.';
    if (a.documento.trim().length < 3) errores['acudiente.documento'] = 'Escribe el documento del acudiente.';
    if (a.telefono.trim().length < 5) errores['acudiente.telefono'] = 'Escribe el teléfono del acudiente.';
    if (a.parentesco.trim().length < 2) errores['acudiente.parentesco'] = 'Escribe el parentesco.';
    if (!a.autoriza) errores['acudiente.autoriza'] = 'El acudiente debe autorizar el registro del menor.';
  }

  const errorDe = (campo: string): string | undefined =>
    erroresServidor[campo] ?? ((tocados[campo] || intentoEnviar) ? errores[campo] : undefined);

  const tocar = (campo: string) => setTocados((t) => ({ ...t, [campo]: true }));

  const cambiar = <K extends keyof Valores>(campo: K, valor: Valores[K]) => {
    setV((prev) => ({ ...prev, [campo]: valor }));
    setErroresServidor((e) => {
      if (!e[campo as string]) return e;
      const { [campo as string]: _quitado, ...resto } = e;
      return resto;
    });
  };

  const cambiarAcudiente = <K extends keyof Valores['acudiente']>(campo: K, valor: Valores['acudiente'][K]) => {
    setV((prev) => ({ ...prev, acudiente: { ...prev.acudiente, [campo]: valor } }));
    setErroresServidor((e) => {
      const clave = `acudiente.${campo as string}`;
      if (!e[clave] && !e.acudiente) return e;
      const copia = { ...e };
      delete copia[clave];
      delete copia.acudiente;
      return copia;
    });
  };

  const acudienteDto = (): AcudienteDto | undefined =>
    esMenor
      ? {
          nombre: v.acudiente.nombre.trim(),
          tipo_documento: v.acudiente.tipo_documento as TipoDocumento,
          documento: v.acudiente.documento.trim(),
          telefono: v.acudiente.telefono.trim(),
          parentesco: v.acudiente.parentesco.trim(),
          autoriza: v.acudiente.autoriza,
        }
      : undefined;

  const guardar = async () => {
    setIntentoEnviar(true);
    if (enviando || Object.keys(errores).length > 0) return;
    setEnviando(true);
    setErrorGeneral(null);
    setErroresServidor({});
    setLimite(null);
    setConflicto(false);
    try {
      let res: DeportistaResponse;
      if (inicial) {
        const data: EditarDeportistaRequest = {
          version: inicial.version,
          tipo_documento: v.tipo_documento as TipoDocumento,
          documento: v.documento.trim(),
          nombre: v.nombre.trim(),
          correo: v.correo.trim() || undefined,
          telefono: v.telefono.trim() || undefined,
          sexo: v.sexo || undefined,
          fecha_nacimiento: v.fecha_nacimiento || undefined,
          altura_cm: v.altura_cm.trim() ? Number(v.altura_cm) : undefined,
          acudiente: acudienteDto(),
        };
        res = await deportistasService.actualizar(inicial.id, data);
      } else {
        const data: CrearDeportistaRequest = {
          tipo_documento: v.tipo_documento as TipoDocumento,
          documento: v.documento.trim(),
          nombre: v.nombre.trim(),
          correo: v.correo.trim() || undefined,
          telefono: v.telefono.trim() || undefined,
          sexo: v.sexo || undefined,
          fecha_nacimiento: v.fecha_nacimiento || undefined,
          altura_cm: v.altura_cm.trim() ? Number(v.altura_cm) : undefined,
          consentimiento_1581: v.consentimiento_1581,
          consentimiento_version: VERSION_CONSENTIMIENTO,
          acudiente: acudienteDto(),
        };
        res = await deportistasService.crear(data);
      }
      onGuardado(res);
    } catch (e) {
      // Lo escrito se conserva (§A6): solo se pintan los errores.
      const err = toApiError(e);
      switch (err.codigo) {
        case 'DOCUMENTO_YA_REGISTRADO':
          setErroresServidor({ documento: err.message });
          break;
        case 'ACUDIENTE_REQUERIDO':
          setErroresServidor({ acudiente: err.message });
          break;
        case 'AUTORIZACION_ACUDIENTE_REQUERIDA':
          setErroresServidor({ 'acudiente.autoriza': err.message });
          break;
        case 'LIMITE_PLAN_CLIENTES':
          setLimite((err.detalles as DetallesLimitePlanClientes) ?? null);
          setErrorGeneral(err.message);
          break;
        case 'CONFLICTO_CONCURRENCIA':
          setConflicto(true);
          break;
        default: {
          const campos = camposDelServidor(err);
          setErroresServidor(campos);
          setErrorGeneral(Object.keys(campos).length ? 'Revisa los campos marcados.' : err.message);
        }
      }
    } finally {
      setEnviando(false);
    }
  };

  const pedirCerrar = () => {
    if (enviando) return;
    if (hayCambios) setConfirmarSalida(true);
    else onCerrar();
  };

  const opcionesTipo = [
    { value: '', label: 'Selecciona' },
    ...TIPOS_DOCUMENTO.map((t) => ({ value: t, label: `${t} · ${NOMBRE_TIPO_DOCUMENTO[t]}` })),
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={pedirCerrar}
        title={editando ? 'Editar deportista' : 'Registrar deportista'}
        maxWidth="640px"
        footer={
          <>
            <Button variant="outline" onClick={pedirCerrar} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardar} isLoading={enviando}>
              {editando ? 'Guardar cambios' : 'Registrar'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
          noValidate
        >
          {conflicto && (
            <div style={{ marginBottom: 12 }}>
              <Conflicto onRecargar={onRecargar} />
            </div>
          )}
          {limite && (
            <MensajeFijo tono="error" titulo="Llegaste al límite de clientes de tu plan" style={{ marginBottom: 12 }}>
              El plan {limite.plan_nombre} permite {limite.limite} clientes activos y hoy tienes {limite.actuales}. Desactiva
              clientes que ya no vienen o pide al Jefe cambiar de plan en Mi suscripción.
            </MensajeFijo>
          )}
          {errorGeneral && !limite && (
            <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
              {errorGeneral}
            </MensajeFijo>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              id="dep-tipo-documento"
              label="Tipo de documento *"
              options={opcionesTipo}
              value={v.tipo_documento}
              onChange={(e) => cambiar('tipo_documento', e.target.value as TipoDocumento | '')}
              onBlur={() => tocar('tipo_documento')}
              error={errorDe('tipo_documento')}
            />
            <Input
              id="dep-documento"
              label="Documento *"
              value={v.documento}
              maxLength={30}
              onChange={(e) => cambiar('documento', e.target.value)}
              onBlur={() => tocar('documento')}
              error={errorDe('documento')}
            />
          </div>

          <Input
            id="dep-nombre"
            label="Nombre completo *"
            value={v.nombre}
            maxLength={150}
            onChange={(e) => cambiar('nombre', e.target.value)}
            onBlur={() => tocar('nombre')}
            error={errorDe('nombre')}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              id="dep-correo"
              label="Correo"
              type="email"
              value={v.correo}
              onChange={(e) => cambiar('correo', e.target.value)}
              onBlur={() => tocar('correo')}
              error={errorDe('correo')}
            />
            <Input
              id="dep-telefono"
              label="Teléfono"
              value={v.telefono}
              maxLength={25}
              onChange={(e) => cambiar('telefono', e.target.value)}
              error={errorDe('telefono')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Select
              id="dep-sexo"
              label="Sexo"
              options={[
                { value: '', label: 'Sin dato' },
                { value: 'M', label: 'Masculino' },
                { value: 'F', label: 'Femenino' },
                { value: 'otro', label: 'Otro' },
              ]}
              value={v.sexo}
              onChange={(e) => cambiar('sexo', e.target.value as Valores['sexo'])}
            />
            <Input
              id="dep-fecha-nacimiento"
              label="Fecha de nacimiento"
              type="date"
              max={hoyBogota()}
              value={v.fecha_nacimiento}
              onChange={(e) => cambiar('fecha_nacimiento', e.target.value)}
              onBlur={() => tocar('fecha_nacimiento')}
              error={errorDe('fecha_nacimiento')}
            />
            <Input
              id="dep-altura"
              label="Estatura (cm)"
              type="number"
              min={1}
              value={v.altura_cm}
              onChange={(e) => cambiar('altura_cm', e.target.value)}
              onBlur={() => tocar('altura_cm')}
              error={errorDe('altura_cm')}
            />
          </div>

          {esMenor && (
            <fieldset
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                margin: '4px 0 12px',
              }}
            >
              <legend style={{ fontWeight: 700, fontSize: '0.9rem', padding: '0 6px' }}>
                Acudiente (menor de edad: {edad} años)
              </legend>
              {erroresServidor.acudiente && (
                <MensajeFijo tono="error" style={{ marginBottom: 10 }}>
                  {erroresServidor.acudiente}
                </MensajeFijo>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input
                  id="acu-nombre"
                  label="Nombre del acudiente *"
                  value={v.acudiente.nombre}
                  maxLength={150}
                  onChange={(e) => cambiarAcudiente('nombre', e.target.value)}
                  onBlur={() => tocar('acudiente.nombre')}
                  error={errorDe('acudiente.nombre')}
                />
                <Input
                  id="acu-parentesco"
                  label="Parentesco *"
                  placeholder="Madre, padre, tutor…"
                  value={v.acudiente.parentesco}
                  maxLength={50}
                  onChange={(e) => cambiarAcudiente('parentesco', e.target.value)}
                  onBlur={() => tocar('acudiente.parentesco')}
                  error={errorDe('acudiente.parentesco')}
                />
                <Select
                  id="acu-tipo-documento"
                  label="Tipo de documento *"
                  options={opcionesTipo}
                  value={v.acudiente.tipo_documento}
                  onChange={(e) => cambiarAcudiente('tipo_documento', e.target.value as TipoDocumento | '')}
                  onBlur={() => tocar('acudiente.tipo_documento')}
                  error={errorDe('acudiente.tipo_documento')}
                />
                <Input
                  id="acu-documento"
                  label="Documento del acudiente *"
                  value={v.acudiente.documento}
                  maxLength={30}
                  onChange={(e) => cambiarAcudiente('documento', e.target.value)}
                  onBlur={() => tocar('acudiente.documento')}
                  error={errorDe('acudiente.documento')}
                />
                <Input
                  id="acu-telefono"
                  label="Teléfono del acudiente *"
                  value={v.acudiente.telefono}
                  maxLength={25}
                  onChange={(e) => cambiarAcudiente('telefono', e.target.value)}
                  onBlur={() => tocar('acudiente.telefono')}
                  error={errorDe('acudiente.telefono')}
                />
              </div>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={v.acudiente.autoriza}
                  onChange={(e) => cambiarAcudiente('autoriza', e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>El acudiente autoriza el registro del menor, el tratamiento de sus datos y su participación en las actividades del gimnasio.</span>
              </label>
              {errorDe('acudiente.autoriza') && <span className="form-error-msg">{errorDe('acudiente.autoriza')}</span>}
            </fieldset>
          )}

          {!editando && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-color)',
                marginTop: 4,
              }}
            >
              <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={v.consentimiento_1581}
                  onChange={(e) => cambiar('consentimiento_1581', e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>Tratamiento de datos personales (Ley 1581 de 2012), versión {VERSION_CONSENTIMIENTO}:</strong> autorizo de
                  manera previa, expresa e informada el tratamiento de mis datos personales para el control de acceso y la
                  gestión del gimnasio.
                </span>
              </label>
              {errorDe('consentimiento_1581') && <span className="form-error-msg">{errorDe('consentimiento_1581')}</span>}
            </div>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmarSalida}
        onClose={() => setConfirmarSalida(false)}
        onConfirm={() => {
          setConfirmarSalida(false);
          onCerrar();
        }}
        title="Descartar cambios"
        message="Tienes cambios sin guardar. Si sales, se pierden."
        confirmText="Descartar"
        cancelText="Seguir editando"
        isDestructive
      />
    </>
  );
};
