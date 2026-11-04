import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Globe, Plus, Save, Trash2, Upload } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { ApiError, parseApiError, toApiError, urlDeImagen } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import { copiarAlPortapapeles, descargarBlob } from '../../utils/navegador';
import { validarRedSocial, validarWhatsApp } from '../../utils/formato';
import type { InfoGymResponse, LandingInfoResponse } from '../../types/myGym.types';

const REDES_BASE = ['whatsapp', 'instagram', 'facebook', 'tiktok'];
const ETIQUETA_RED: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
const HORARIOS_BASE = [
  { clave: 'lunes_viernes', etiqueta: 'Lunes a viernes' },
  { clave: 'sabados', etiqueta: 'Sábados' },
  { clave: 'domingos_festivos', etiqueta: 'Domingos y festivos' },
];
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COLORES = [
  ['primary_color', 'Color principal'],
  ['secondary_color', 'Color secundario'],
  ['accent_color', 'Color de acento'],
] as const;

interface FormLanding {
  landing_titulo: string;
  landing_descripcion: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  redes: Record<string, string>;
  horarios: Array<{ clave: string; valor: string }>;
}

function aForm(i: InfoGymResponse): FormLanding {
  const b = (i.branding ?? {}) as Record<string, unknown>;
  const txt = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
  const redes: Record<string, string> = {};
  for (const r of REDES_BASE) redes[r] = '';
  for (const [k, v] of Object.entries(i.redes ?? {})) redes[k] = v ?? '';
  const horarios = HORARIOS_BASE.map((h) => ({ clave: h.clave, valor: i.horarios?.[h.clave] ?? '' }));
  for (const [k, v] of Object.entries(i.horarios ?? {})) {
    if (!HORARIOS_BASE.some((h) => h.clave === k)) horarios.push({ clave: k, valor: v });
  }
  return {
    landing_titulo: txt('landing_titulo'),
    landing_descripcion: txt('landing_descripcion'),
    primary_color: txt('primary_color'),
    secondary_color: txt('secondary_color'),
    accent_color: txt('accent_color'),
    redes,
    horarios,
  };
}

const etiquetaHorario = (clave: string) => HORARIOS_BASE.find((h) => h.clave === clave)?.etiqueta ?? clave.replace(/_/g, ' ');

/** Logo o banner: se sube el archivo, no una dirección de internet. */
const SelectorImagen: React.FC<{
  tipo: 'logo' | 'banner';
  etiqueta: string;
  ayuda: string;
  url?: string;
  puedeEditar: boolean;
  onCambio: (i: InfoGymResponse) => void;
}> = ({ tipo, etiqueta, ayuda, url, puedeEditar, onCambio }) => {
  const { showToast } = useToast();
  const [trabajando, setTrabajando] = useState(false);

  const subir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setTrabajando(true);
    try {
      onCambio(await myGymService.subirImagen(tipo, archivo));
      showToast('success', `${etiqueta} actualizado`);
    } catch (err) {
      showToast('error', `No se pudo subir el ${etiqueta.toLowerCase()}`, parseApiError(err));
    } finally {
      setTrabajando(false);
    }
  };

  const quitar = async () => {
    setTrabajando(true);
    try {
      onCambio(await myGymService.quitarImagen(tipo));
    } catch (err) {
      showToast('error', `No se pudo quitar el ${etiqueta.toLowerCase()}`, parseApiError(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="form-label">{etiqueta}</div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>{ayuda}</p>
      {url && (
        <img
          src={urlDeImagen(url)}
          alt={`${etiqueta} actual`}
          style={{ display: 'block', maxHeight: tipo === 'logo' ? 72 : 120, maxWidth: '100%', objectFit: 'contain', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}
        />
      )}
      {puedeEditar && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-outline btn-sm" style={{ cursor: trabajando ? 'wait' : 'pointer' }}>
            <Upload size={14} /> {url ? 'Cambiar' : 'Subir'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={`Subir ${etiqueta.toLowerCase()}`}
              onChange={subir}
              disabled={trabajando}
              style={{ display: 'none' }}
            />
          </label>
          {url && (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={quitar} disabled={trabajando}>
              Quitar
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Configuración · Landing (GW-RF-46): enlace y QR, textos, imágenes, colores, redes y horarios.
 * Lo que se guarda aquí es lo que ve el público en la raíz del subdominio.
 */
export const ConfigLandingPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const { recargarBranding } = useTenantTheme();
  const puedeEditar = hasPermission('configuracion', 'editar');

  const [landing, setLanding] = useState<LandingInfoResponse | null>(null);
  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [form, setForm] = useState<FormLanding | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [descargando, setDescargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);
  const [nuevoHorario, setNuevoHorario] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [l, i] = await Promise.all([myGymService.getLanding(), myGymService.getInfo()]);
      setLanding(l);
      setInfo(i);
      setForm(aForm(i));
      setError(null);
      setErrorGuardar(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambiado = !!info && !!form && JSON.stringify(aForm(info)) !== JSON.stringify(form);
  useCambiosSinGuardar(cambiado);

  const copiar = async () => {
    if (!landing) return;
    const ok = await copiarAlPortapapeles(landing.landing_url);
    showToast(ok ? 'success' : 'error', ok ? 'Enlace copiado' : 'No se pudo copiar el enlace');
  };

  const descargarQr = async () => {
    if (descargando) return;
    setDescargando(true);
    try {
      const blob = await myGymService.descargarQrPng();
      descargarBlob(blob, `qr-${landing?.subdominio ?? 'gimnasio'}.png`);
    } catch (e) {
      showToast('error', 'No se pudo descargar el QR', parseApiError(e));
    } finally {
      setDescargando(false);
    }
  };

  const validar = (f: FormLanding): string | null => {
    for (const [campo, etiqueta] of COLORES) {
      if (f[campo].trim() && !COLOR_RE.test(f[campo].trim())) return `${etiqueta}: usa un color hexadecimal, p. ej. #4f46e5.`;
    }
    for (const [red, valor] of Object.entries(f.redes)) {
      if (valor.trim()) {
        const e = red === 'whatsapp' ? validarWhatsApp(valor) : validarRedSocial(valor, ETIQUETA_RED[red] ?? red);
        if (e) return e;
      }
    }
    return null;
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info || !form || guardando) return;
    const problema = validar(form);
    if (problema) {
      showToast('error', 'Revisa los campos', problema);
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const redes: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(form.redes)) if (v.trim()) redes[k] = v.trim();
      const horarios: Record<string, string> = {};
      for (const h of form.horarios) if (h.valor.trim()) horarios[h.clave] = h.valor.trim();
      // Los datos de la sede se editan en General: se reenvían sin cambios.
      const conInfo = await myGymService.actualizarInfo({
        version: info.version,
        nombre: info.nombre,
        direccion: info.direccion ?? null,
        ciudad: info.ciudad ?? null,
        telefono: info.telefono ?? null,
        correo: info.correo ?? null,
        encargado_nombre: info.encargado_nombre ?? null,
        redes,
        horarios,
      });
      const actualizado = await myGymService.actualizarBranding({
        version: conInfo.version,
        primary_color: form.primary_color.trim() || null,
        secondary_color: form.secondary_color.trim() || null,
        accent_color: form.accent_color.trim() || null,
        landing_titulo: form.landing_titulo,
        landing_descripcion: form.landing_descripcion,
      });
      setInfo(actualizado);
      setForm(aForm(actualizado));
      recargarBranding();
      showToast('success', 'Landing guardada', 'Los cambios ya se ven en la página pública.');
    } catch (err) {
      setErrorGuardar(toApiError(err));
    } finally {
      setGuardando(false);
    }
  };

  const agregarHorario = () => {
    if (!form) return;
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

  /** Al subir o quitar una imagen cambia la versión; lo escrito en el formulario se conserva. */
  const trasImagen = (i: InfoGymResponse) => {
    setInfo(i);
    recargarBranding();
  };

  const encabezado = (
    <div className="page-header">
      <div>
        <h1 className="page-title">Landing</h1>
        <p className="page-subtitle">La página pública de tu gimnasio: imagen, textos, redes y horario</p>
      </div>
    </div>
  );

  if (cargando && !landing) {
    return (
      <div>
        {encabezado}
        <Cargando filas={4} />
      </div>
    );
  }
  if (error || !landing || !info || !form) {
    return (
      <div>
        {encabezado}
        <ErrorCarga error={error} onReintentar={cargar} />
      </div>
    );
  }

  const b = (info.branding ?? {}) as Record<string, unknown>;
  const urlImagen = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);
  const deshabilitado = !puedeEditar || guardando;

  return (
    <div>
      {encabezado}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <Card title="Enlace público">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Globe size={18} color="var(--text-muted)" />
            <a href={landing.landing_url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all', fontWeight: 500 }}>
              {landing.landing_url}
            </a>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="outline" leftIcon={<Copy size={16} />} onClick={copiar}>
              Copiar enlace
            </Button>
            <Button variant="outline" rightIcon={<ExternalLink size={16} />} onClick={() => window.open(landing.landing_url, '_blank', 'noopener')}>
              Ver la página
            </Button>
          </div>
        </Card>

        <Card title="Código QR">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(landing.qr_svg)}`}
              alt={`Código QR de ${landing.landing_url}`}
              style={{ width: 140, height: 140, background: '#ffffff', padding: 8, borderRadius: 'var(--radius-sm)' }}
            />
            <Button variant="primary" leftIcon={<Download size={16} />} onClick={descargarQr} isLoading={descargando}>
              Descargar PNG
            </Button>
          </div>
        </Card>

        <Card title="Imágenes">
          <SelectorImagen
            tipo="logo"
            etiqueta="Logo"
            ayuda="PNG, JPG o WEBP de hasta 3 MB. Se ve en el encabezado y al iniciar sesión."
            url={urlImagen('logo_url')}
            puedeEditar={puedeEditar}
            onCambio={trasImagen}
          />
          <SelectorImagen
            tipo="banner"
            etiqueta="Banner"
            ayuda="Imagen ancha de fondo, de hasta 3 MB."
            url={urlImagen('banner_url')}
            puedeEditar={puedeEditar}
            onCambio={trasImagen}
          />
        </Card>
      </div>

      <form onSubmit={guardar} noValidate style={{ marginTop: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <Card title="Textos">
            <Input
              label="Frase corta (es el botón que abre WhatsApp)"
              placeholder="Ej. Empieza hoy, escríbenos"
              value={form.landing_titulo}
              maxLength={60}
              onChange={(e) => setForm({ ...form, landing_titulo: e.target.value })}
              disabled={deshabilitado}
            />
            <div className="form-group">
              <label className="form-label" htmlFor="landing-descripcion">
                Presentación corta (el texto grande del banner)
              </label>
              <textarea
                id="landing-descripcion"
                className="form-input"
                rows={3}
                maxLength={240}
                value={form.landing_descripcion}
                onChange={(e) => setForm({ ...form, landing_descripcion: e.target.value })}
                disabled={deshabilitado}
              />
            </div>
          </Card>

          <Card title="Identidad visual">
            {COLORES.map(([campo, etiqueta]) => (
              <div key={campo} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Input
                    label={etiqueta}
                    value={form[campo]}
                    placeholder="#4f46e5"
                    onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                    disabled={deshabilitado}
                  />
                </div>
                <input
                  type="color"
                  aria-label={`Elegir ${etiqueta.toLowerCase()}`}
                  value={COLOR_RE.test(form[campo]) && form[campo].length === 7 ? form[campo] : '#000000'}
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                  disabled={deshabilitado}
                  style={{ width: 40, height: 40, marginBottom: 16, border: 'none', background: 'none', padding: 0 }}
                />
              </div>
            ))}
          </Card>

          <Card title="Redes sociales">
            {Object.keys(form.redes).map((red) => (
              <Input
                key={red}
                label={ETIQUETA_RED[red] ?? red}
                value={form.redes[red]}
                placeholder={red === 'whatsapp' ? 'ej. +573001234567' : 'ej. @gimnasio'}
                onChange={(e) => setForm({ ...form, redes: { ...form.redes, [red]: e.target.value } })}
                disabled={deshabilitado}
              />
            ))}
          </Card>

          <Card title="Horario">
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
                    disabled={deshabilitado}
                  />
                </div>
                {!HORARIOS_BASE.some((x) => x.clave === h.clave) && puedeEditar && (
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
                    disabled={deshabilitado}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  style={{ marginBottom: 16 }}
                  onClick={agregarHorario}
                  disabled={deshabilitado || !nuevoHorario.trim()}
                >
                  Agregar
                </Button>
              </div>
            )}
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
            <Button variant="primary" type="submit" leftIcon={<Save size={16} />} isLoading={guardando} disabled={!cambiado}>
              Guardar landing
            </Button>
          </div>
        )}
      </form>
    </div>
  );
};
