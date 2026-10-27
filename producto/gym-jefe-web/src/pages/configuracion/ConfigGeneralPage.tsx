import React, { useCallback, useEffect, useState } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import { formatFechaHora } from '../../utils/formato';
import type { InfoGymResponse } from '../../types/myGym.types';

const REDES_BASE = ['instagram', 'facebook', 'whatsapp', 'tiktok'];
const HORARIOS_BASE: Array<{ clave: string; etiqueta: string }> = [
  { clave: 'lunes_viernes', etiqueta: 'Lunes a viernes' },
  { clave: 'sabados', etiqueta: 'Sábados' },
  { clave: 'domingos_festivos', etiqueta: 'Domingos y festivos' },
];
const ETIQUETA_RED: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
};

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface FormInfo {
  nombre: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  redes: Record<string, string>;
  horarios: Array<{ clave: string; valor: string }>;
}

interface FormBranding {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  logo_url: string;
  banner_url: string;
}

function infoAForm(i: InfoGymResponse): FormInfo {
  const redes: Record<string, string> = {};
  for (const r of REDES_BASE) redes[r] = '';
  for (const [k, v] of Object.entries(i.redes ?? {})) redes[k] = v ?? '';
  const horarios = HORARIOS_BASE.map((h) => ({ clave: h.clave, valor: i.horarios?.[h.clave] ?? '' }));
  for (const [k, v] of Object.entries(i.horarios ?? {})) {
    if (!HORARIOS_BASE.some((h) => h.clave === k)) horarios.push({ clave: k, valor: v });
  }
  return {
    nombre: i.nombre ?? '',
    direccion: i.direccion ?? '',
    ciudad: i.ciudad ?? '',
    telefono: i.telefono ?? '',
    correo: i.correo ?? '',
    redes,
    horarios,
  };
}

function brandingAForm(i: InfoGymResponse): FormBranding {
  const b = i.branding ?? {};
  const txt = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  return {
    primary_color: txt('primary_color'),
    secondary_color: txt('secondary_color'),
    accent_color: txt('accent_color'),
    logo_url: txt('logo_url'),
    banner_url: txt('banner_url'),
  };
}

const vacioANull = (s: string) => (s.trim() === '' ? null : s.trim());

function etiquetaHorario(clave: string): string {
  return HORARIOS_BASE.find((h) => h.clave === clave)?.etiqueta ?? clave.replace(/_/g, ' ');
}

/**
 * Configuración · General (GW-RF-45): datos de la sede, contacto, redes, horarios e identidad visual.
 * `PUT /my-gym/info` y `PATCH /my-gym/branding`, ambos con `version` (409 si otra persona guardó antes).
 */
export const ConfigGeneralPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeEditar = hasPermission('configuracion', 'editar');

  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const [form, setForm] = useState<FormInfo | null>(null);
  const [branding, setBranding] = useState<FormBranding | null>(null);
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [guardandoInfo, setGuardandoInfo] = useState(false);
  const [guardandoBranding, setGuardandoBranding] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ApiError | null>(null);
  const [errorBranding, setErrorBranding] = useState<ApiError | null>(null);
  const [nuevoHorario, setNuevoHorario] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const i = await myGymService.getInfo();
      setInfo(i);
      setForm(infoAForm(i));
      setBranding(brandingAForm(i));
      setErrorCarga(null);
      setErrorInfo(null);
      setErrorBranding(null);
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

  const infoCambiada = !!info && !!form && JSON.stringify(infoAForm(info)) !== JSON.stringify(form);
  const brandingCambiado = !!info && !!branding && JSON.stringify(brandingAForm(info)) !== JSON.stringify(branding);
  useCambiosSinGuardar(infoCambiada || brandingCambiado);

  if (cargando && !info) return <Cargando />;
  if (errorCarga || !info || !form || !branding) {
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

  // ---- Validación ----
  const erroresInfo: Record<string, string> = {};
  if (form.nombre.trim().length < 2) erroresInfo.nombre = 'El nombre debe tener al menos 2 caracteres.';
  if (form.nombre.trim().length > 150) erroresInfo.nombre = 'Máximo 150 caracteres.';
  if (form.correo.trim() && !CORREO_RE.test(form.correo.trim())) erroresInfo.correo = 'Escribe un correo válido.';
  if (form.direccion.length > 250) erroresInfo.direccion = 'Máximo 250 caracteres.';

  const erroresBranding: Record<string, string> = {};
  for (const k of ['primary_color', 'secondary_color', 'accent_color'] as const) {
    if (branding[k].trim() && !COLOR_RE.test(branding[k].trim())) erroresBranding[k] = 'Usa un color hexadecimal, p. ej. #4f46e5.';
  }

  const errorDe = (campo: string) => (tocados[campo] ? erroresInfo[campo] : undefined) ?? errorInfo?.campos[campo];
  const tocar = (campo: string) => setTocados((t) => ({ ...t, [campo]: true }));

  const guardarInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setTocados({ nombre: true, correo: true, direccion: true });
    if (Object.keys(erroresInfo).length > 0 || guardandoInfo) return;
    setGuardandoInfo(true);
    setErrorInfo(null);
    const redes: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(form.redes)) if (v.trim()) redes[k] = v.trim();
    const horarios: Record<string, string> = {};
    for (const h of form.horarios) if (h.valor.trim()) horarios[h.clave] = h.valor.trim();
    try {
      const actualizado = await myGymService.actualizarInfo({
        version: info.version,
        nombre: form.nombre.trim(),
        direccion: vacioANull(form.direccion),
        ciudad: vacioANull(form.ciudad),
        telefono: vacioANull(form.telefono),
        correo: vacioANull(form.correo),
        redes,
        horarios,
      });
      setInfo(actualizado);
      setForm(infoAForm(actualizado));
      setTocados({});
      showToast('success', 'Información guardada');
    } catch (err) {
      setErrorInfo(toApiError(err));
    } finally {
      setGuardandoInfo(false);
    }
  };

  const guardarBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(erroresBranding).length > 0 || guardandoBranding) return;
    setGuardandoBranding(true);
    setErrorBranding(null);
    try {
      const actualizado = await myGymService.actualizarBranding({
        version: info.version,
        primary_color: vacioANull(branding.primary_color),
        secondary_color: vacioANull(branding.secondary_color),
        accent_color: vacioANull(branding.accent_color),
        logo_url: vacioANull(branding.logo_url),
        banner_url: vacioANull(branding.banner_url),
      });
      setInfo(actualizado);
      setBranding(brandingAForm(actualizado));
      // El formulario de información también depende de `version`: se conserva lo escrito.
      showToast('success', 'Identidad visual guardada', 'Los colores se aplican al recargar la página.');
    } catch (err) {
      setErrorBranding(toApiError(err));
    } finally {
      setGuardandoBranding(false);
    }
  };

  const errorFijo = (err: ApiError | null) => {
    if (!err) return null;
    if (err.tipo === 'conflicto') return <Conflicto onRecargar={cargar} />;
    return (
      <MensajeFijo tono="error" titulo="No se guardaron los cambios">
        {err.message}
      </MensajeFijo>
    );
  };

  const agregarHorario = () => {
    const clave = nuevoHorario
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    if (!clave || form.horarios.some((h) => h.clave === clave)) return;
    setForm({ ...form, horarios: [...form.horarios, { clave, valor: '' }] });
    setNuevoHorario('');
  };

  const disabled = !puedeEditar || guardandoInfo;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración general</h1>
          <p className="page-subtitle">
            Datos de la sede · última modificación {formatFechaHora(info.updated_at)}
          </p>
        </div>
      </div>

      {!puedeEditar && (
        <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
          Puedes ver la configuración, pero no tienes permiso para editarla.
        </MensajeFijo>
      )}

      <form onSubmit={guardarInfo} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <Card title="Datos de la sede">
            <Input
              label="Nombre del gimnasio"
              value={form.nombre}
              maxLength={150}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              onBlur={() => tocar('nombre')}
              error={errorDe('nombre')}
              disabled={disabled}
            />
            <Input label="Subdominio" value={info.subdominio} disabled readOnly />
            <Input
              label="Dirección"
              value={form.direccion}
              maxLength={250}
              onChange={(e) => setForm({ ...form, direccion: e.target.value })}
              onBlur={() => tocar('direccion')}
              error={errorDe('direccion')}
              disabled={disabled}
            />
            <Input
              label="Ciudad"
              value={form.ciudad}
              maxLength={100}
              onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
              error={errorDe('ciudad')}
              disabled={disabled}
            />
            <Input
              label="Teléfono"
              value={form.telefono}
              maxLength={50}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              error={errorDe('telefono')}
              disabled={disabled}
            />
            <Input
              label="Correo de contacto"
              type="email"
              value={form.correo}
              onChange={(e) => setForm({ ...form, correo: e.target.value })}
              onBlur={() => tocar('correo')}
              error={errorDe('correo')}
              disabled={disabled}
            />
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Card title="Redes sociales">
              {Object.keys(form.redes).map((red) => (
                <Input
                  key={red}
                  label={ETIQUETA_RED[red] ?? red}
                  value={form.redes[red]}
                  placeholder={red === 'whatsapp' ? 'Número o enlace' : 'Usuario o enlace'}
                  onChange={(e) => setForm({ ...form, redes: { ...form.redes, [red]: e.target.value } })}
                  disabled={disabled}
                />
              ))}
            </Card>

            <Card title="Horarios de atención">
              {form.horarios.map((h, idx) => (
                <div key={h.clave} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Input
                      label={etiquetaHorario(h.clave)}
                      value={h.valor}
                      placeholder="p. ej. 5:00 a 22:00"
                      onChange={(e) => {
                        const horarios = [...form.horarios];
                        horarios[idx] = { ...h, valor: e.target.value };
                        setForm({ ...form, horarios });
                      }}
                      disabled={disabled}
                    />
                  </div>
                  {!HORARIOS_BASE.some((b) => b.clave === h.clave) && puedeEditar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar ${etiquetaHorario(h.clave)}`}
                      style={{ marginBottom: 16 }}
                      onClick={() => setForm({ ...form, horarios: form.horarios.filter((x) => x.clave !== h.clave) })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
              {puedeEditar && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Input
                      label="Otro rango"
                      placeholder="p. ej. Temporada de vacaciones"
                      value={nuevoHorario}
                      onChange={(e) => setNuevoHorario(e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Plus size={14} />}
                    style={{ marginBottom: 16 }}
                    onClick={agregarHorario}
                    disabled={disabled || !nuevoHorario.trim()}
                  >
                    Agregar
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>

        {puedeEditar && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', margin: '16px 0 28px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>{errorFijo(errorInfo)}</div>
            {infoCambiada && <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Hay cambios sin guardar</span>}
            <Button
              variant="outline"
              type="button"
              disabled={!infoCambiada || guardandoInfo}
              onClick={() => {
                setForm(infoAForm(info));
                setErrorInfo(null);
                setTocados({});
              }}
            >
              Descartar
            </Button>
            <Button variant="primary" type="submit" leftIcon={<Save size={16} />} isLoading={guardandoInfo} disabled={!infoCambiada}>
              Guardar información
            </Button>
          </div>
        )}
      </form>

      <form onSubmit={guardarBranding} noValidate>
        <Card title="Identidad visual">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {(
              [
                ['primary_color', 'Color principal'],
                ['secondary_color', 'Color secundario'],
                ['accent_color', 'Color de acento'],
              ] as const
            ).map(([campo, etiqueta]) => (
              <div key={campo} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Input
                    label={etiqueta}
                    value={branding[campo]}
                    placeholder="#4f46e5"
                    onChange={(e) => setBranding({ ...branding, [campo]: e.target.value })}
                    error={erroresBranding[campo] ?? errorBranding?.campos[campo]}
                    disabled={!puedeEditar || guardandoBranding}
                  />
                </div>
                <input
                  type="color"
                  aria-label={`Elegir ${etiqueta.toLowerCase()}`}
                  value={COLOR_RE.test(branding[campo]) && branding[campo].length === 7 ? branding[campo] : '#000000'}
                  onChange={(e) => setBranding({ ...branding, [campo]: e.target.value })}
                  disabled={!puedeEditar || guardandoBranding}
                  style={{ width: 40, height: 40, marginBottom: 16, border: 'none', background: 'none', padding: 0 }}
                />
              </div>
            ))}
          </div>
          <Input
            label="URL del logo"
            value={branding.logo_url}
            placeholder="https://..."
            onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })}
            error={errorBranding?.campos.logo_url}
            disabled={!puedeEditar || guardandoBranding}
          />
          <Input
            label="URL del banner"
            value={branding.banner_url}
            placeholder="https://..."
            onChange={(e) => setBranding({ ...branding, banner_url: e.target.value })}
            error={errorBranding?.campos.banner_url}
            disabled={!puedeEditar || guardandoBranding}
          />
          {branding.logo_url.trim() && (
            <div style={{ marginBottom: 12 }}>
              <img
                src={branding.logo_url.trim()}
                alt="Vista previa del logo"
                style={{ maxHeight: 64, maxWidth: 200, objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
              />
            </div>
          )}
          {puedeEditar && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>{errorFijo(errorBranding)}</div>
              <Button
                variant="outline"
                type="button"
                disabled={!brandingCambiado || guardandoBranding}
                onClick={() => {
                  setBranding(brandingAForm(info));
                  setErrorBranding(null);
                }}
              >
                Descartar
              </Button>
              <Button
                variant="primary"
                type="submit"
                leftIcon={<Save size={16} />}
                isLoading={guardandoBranding}
                disabled={!brandingCambiado}
              >
                Guardar identidad visual
              </Button>
            </div>
          )}
        </Card>
      </form>
    </div>
  );
};
