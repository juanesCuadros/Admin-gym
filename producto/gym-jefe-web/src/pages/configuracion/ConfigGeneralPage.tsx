import React, { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import {
  formatFechaHora,
  validarCiudad,
  validarCorreo,
  validarDireccionSede,
  validarNombreGym,
  validarTelefono,
} from '../../utils/formato';
import type { InfoGymResponse } from '../../types/myGym.types';
import { ConfigMetodosPagoPage } from './ConfigMetodosPagoPage';
import { ConfigParametrosPage } from './ConfigParametrosPage';

interface FormInfo {
  nombre: string;
  direccion: string;
  ciudad: string;
  encargado_nombre: string;
  telefono: string;
  correo: string;
}

const infoAForm = (i: InfoGymResponse): FormInfo => ({
  nombre: i.nombre ?? '',
  direccion: i.direccion ?? '',
  ciudad: i.ciudad ?? '',
  encargado_nombre: i.encargado_nombre ?? '',
  telefono: i.telefono ?? '',
  correo: i.correo ?? '',
});

const vacioANull = (s: string) => (s.trim() === '' ? null : s.trim());

const tituloSeccion: React.CSSProperties = { fontSize: '1.15rem', fontWeight: 600, margin: '32px 0 12px' };

/**
 * Configuración general (GW-RF-45, GW-RF-47, GW-RF-48): una sola pantalla con la sede y el encargado,
 * los métodos de pago y los parámetros. Lo público (imagen, redes, horario) está en Configuración · Landing.
 * Todas las secciones comparten `version`: al guardar una, las demás se recargan para no chocar.
 */
export const ConfigGeneralPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeEditar = hasPermission('configuracion', 'editar');

  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [form, setForm] = useState<FormInfo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);
  const [revMetodos, setRevMetodos] = useState(0);
  const [revParametros, setRevParametros] = useState(0);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const i = await myGymService.getInfo();
      setInfo(i);
      setForm(infoAForm(i));
      setErrorCarga(null);
      setErrorGuardar(null);
      setTocados({});
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Otra sección guardó: se toma la versión nueva sin perder lo que esté escrito aquí. */
  const refrescarVersion = useCallback(async () => {
    try {
      setInfo(await myGymService.getInfo());
    } catch {
      // Si falla, al guardar saldrá el aviso de conflicto con la opción de recargar.
    }
  }, []);

  const cambiado = !!info && !!form && JSON.stringify(infoAForm(info)) !== JSON.stringify(form);
  useCambiosSinGuardar(cambiado);

  if (cargando && !info) return <Cargando />;
  if (errorCarga || !info || !form) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Configuración general</h1>
          </div>
        </div>
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      </div>
    );
  }

  const errores: Record<string, string> = {};
  const validaciones: [keyof FormInfo, string | null | undefined][] = [
    ['nombre', validarNombreGym(form.nombre)],
    ['ciudad', validarCiudad(form.ciudad)],
    ['direccion', validarDireccionSede(form.direccion)],
    ['telefono', validarTelefono(form.telefono)],
    ['correo', validarCorreo(form.correo)],
  ];
  for (const [campo, mensaje] of validaciones) if (mensaje) errores[campo] = mensaje;

  const errorDe = (campo: string) => (tocados[campo] ? errores[campo] : undefined) ?? errorGuardar?.campos[campo];
  const tocar = (campo: string) => setTocados((t) => ({ ...t, [campo]: true }));
  const deshabilitado = !puedeEditar || guardando;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTocados({ nombre: true, ciudad: true, direccion: true, telefono: true, correo: true });
    if (Object.keys(errores).length > 0 || guardando) {
      showToast('error', 'Revisa los campos', Object.values(errores)[0]);
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    try {
      // Redes y horarios se editan en Landing: se reenvían sin cambios para no borrarlos.
      const redes: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(info.redes ?? {})) if (v) redes[k] = v;
      const actualizado = await myGymService.actualizarInfo({
        version: info.version,
        nombre: form.nombre.trim(),
        direccion: vacioANull(form.direccion),
        ciudad: vacioANull(form.ciudad),
        encargado_nombre: vacioANull(form.encargado_nombre),
        telefono: vacioANull(form.telefono),
        correo: vacioANull(form.correo),
        redes,
        horarios: info.horarios ?? {},
      });
      setInfo(actualizado);
      setForm(infoAForm(actualizado));
      setTocados({});
      setRevMetodos((n) => n + 1);
      setRevParametros((n) => n + 1);
      showToast('success', 'Información guardada');
    } catch (err) {
      setErrorGuardar(toApiError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración general</h1>
          <p className="page-subtitle">Datos de la sede, métodos de pago y parámetros · última modificación {formatFechaHora(info.updated_at)}</p>
        </div>
      </div>

      {!puedeEditar && (
        <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
          Puedes ver la configuración, pero no tienes permiso para editarla.
        </MensajeFijo>
      )}

      <form onSubmit={guardar} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <Card title="Sede">
            <Input
              label="Nombre del gimnasio"
              value={form.nombre}
              maxLength={150}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              onBlur={() => tocar('nombre')}
              error={errorDe('nombre')}
              disabled={deshabilitado}
            />
            <Input label="Subdominio" value={info.subdominio} disabled readOnly />
            <Input
              label="Dirección"
              value={form.direccion}
              maxLength={250}
              placeholder="ej. Carrera 15 # 85-30"
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              onBlur={() => tocar('direccion')}
              error={errorDe('direccion')}
              disabled={deshabilitado}
            />
            <Input
              label="Ciudad"
              value={form.ciudad}
              maxLength={100}
              placeholder="ej. Bogotá"
              onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
              onBlur={() => tocar('ciudad')}
              error={errorDe('ciudad')}
              disabled={deshabilitado}
            />
          </Card>

          <Card title="Encargado y contacto">
            <Input
              label="Encargado de la sede"
              value={form.encargado_nombre}
              maxLength={150}
              onChange={(e) => setForm({ ...form, encargado_nombre: e.target.value })}
              error={errorDe('encargado_nombre')}
              disabled={deshabilitado}
            />
            <Input
              label="Teléfono"
              value={form.telefono}
              maxLength={50}
              placeholder="ej. +573001234567"
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              onBlur={() => tocar('telefono')}
              error={errorDe('telefono')}
              disabled={deshabilitado}
            />
            <Input
              label="Correo de contacto"
              type="email"
              value={form.correo}
              placeholder="contacto@gimnasio.com"
              onChange={(e) => setForm({ ...form, correo: e.target.value })}
              onBlur={() => tocar('correo')}
              error={errorDe('correo')}
              disabled={deshabilitado}
            />
          </Card>
        </div>

        {puedeEditar && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              {errorGuardar &&
                (errorGuardar.tipo === 'conflicto' ? (
                  <Conflicto onRecargar={cargar} />
                ) : (
                  <MensajeFijo tono="error" titulo="No se guardaron los cambios">
                    {errorGuardar.message}
                  </MensajeFijo>
                ))}
            </div>
            {cambiado && <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Hay cambios sin guardar</span>}
            <Button
              variant="outline"
              type="button"
              disabled={!cambiado || guardando}
              onClick={() => {
                setForm(infoAForm(info));
                setErrorGuardar(null);
                setTocados({});
              }}
            >
              Descartar
            </Button>
            <Button variant="primary" type="submit" leftIcon={<Save size={16} />} isLoading={guardando} disabled={!cambiado}>
              Guardar datos
            </Button>
          </div>
        )}
      </form>

      <h2 style={tituloSeccion}>Métodos de pago</h2>
      <ConfigMetodosPagoPage
        key={`metodos-${revMetodos}`}
        embebido
        onGuardado={() => {
          setRevParametros((n) => n + 1);
          refrescarVersion();
        }}
      />

      <h2 style={tituloSeccion}>Parámetros</h2>
      <ConfigParametrosPage
        key={`parametros-${revParametros}`}
        embebido
        onGuardado={() => {
          setRevMetodos((n) => n + 1);
          refrescarVersion();
        }}
      />
    </div>
  );
};
