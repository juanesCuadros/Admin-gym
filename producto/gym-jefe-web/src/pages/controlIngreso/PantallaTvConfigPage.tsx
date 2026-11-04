import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, KeyRound, Plus, Save, Send, Trash2, Tv } from 'lucide-react';
import { pantallaTvService } from '../../api/pantallaTv.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import type { AvisoPantalla, PantallaConfig } from '../../types/tenant.types';

const MAX_TITULO = 100;
const MAX_CONTENIDO = 500;

function erroresAviso(a: AvisoPantalla): string | null {
  if (a.titulo.trim().length < 2) return 'El título necesita al menos 2 caracteres.';
  if (a.contenido.trim().length < 2) return 'El texto necesita al menos 2 caracteres.';
  return null;
}

/**
 * Control de ingreso · Pantalla TV (GW-RF-07). Abre la pantalla pública y configura lo que muestra:
 * avisos, bloques visibles y duración del saludo (`PUT /pantalla-tv/config`, permiso configuracion:editar).
 * El enlace del televisor (token del dispositivo) lo genera solo el Jefe y se ve una sola vez.
 */
export const PantallaTvConfigPage: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { showToast } = useToast();
  const { tenant } = useTenantTheme();
  const puedeEditar = hasPermission('configuracion', 'editar');
  const esJefe = user?.rol === 'jefe';
  const subdominio = tenant.subdominio;
  const urlPantalla = `${window.location.origin}/tv/${subdominio}`;

  const [original, setOriginal] = useState<PantallaConfig | null>(null);
  const [form, setForm] = useState<PantallaConfig | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);
  const [intentoGuardar, setIntentoGuardar] = useState(false);

  const [confirmarToken, setConfirmarToken] = useState(false);
  const [generandoToken, setGenerandoToken] = useState(false);
  const [enlaceNuevo, setEnlaceNuevo] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const c = await pantallaTvService.getConfig();
      const conAvisos = { ...c, avisos: [...(c.avisos ?? [])].sort((a, b) => a.orden - b.orden) };
      setOriginal(conAvisos);
      setForm(conAvisos);
      setErrorCarga(null);
      setErrorGuardar(null);
      setIntentoGuardar(false);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const hayCambios = !!original && !!form && JSON.stringify(original) !== JSON.stringify(form);
  useCambiosSinGuardar(hayCambios);

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      showToast('success', 'Copiado', 'El enlace quedó en el portapapeles.');
    } catch {
      showToast('error', 'No se pudo copiar', 'Selecciona el enlace y cópialo a mano.');
    }
  };

  if (cargando && !form) return <Cargando />;
  if (errorCarga || !form) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Pantalla TV</h1>
          </div>
        </div>
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      </div>
    );
  }

  const tiempo = form.tiempo_saludo_segundos;
  const errorTiempo = !Number.isInteger(tiempo) || tiempo < 3 || tiempo > 30 ? 'Entre 3 y 30 segundos.' : null;
  const hayErrorAvisos = form.avisos.some((a) => erroresAviso(a) !== null);

  const actualizarAviso = (id: string, cambios: Partial<AvisoPantalla>) =>
    setForm({ ...form, avisos: form.avisos.map((a) => (a.id === id ? { ...a, ...cambios } : a)) });

  const agregarAviso = () =>
    setForm({
      ...form,
      avisos: [
        ...form.avisos,
        { id: crypto.randomUUID(), titulo: '', contenido: '', activo: true, orden: form.avisos.length + 1 },
      ],
    });

  const quitarAviso = (id: string) =>
    setForm({
      ...form,
      avisos: form.avisos.filter((a) => a.id !== id).map((a, i) => ({ ...a, orden: i + 1 })),
    });

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    if (errorTiempo || hayErrorAvisos || enviandoRef.current) return;
    enviandoRef.current = true;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const res = await pantallaTvService.updateConfig({
        logo_url: form.logo_url?.trim() ? form.logo_url.trim() : null,
        tiempo_saludo_segundos: form.tiempo_saludo_segundos,
        mostrar_clases: form.mostrar_clases,
        mostrar_avisos: form.mostrar_avisos,
        avisos: form.avisos.map((a, i) => ({ ...a, titulo: a.titulo.trim(), contenido: a.contenido.trim(), orden: i + 1 })),
      });
      const ordenada = { ...res, avisos: [...(res.avisos ?? [])].sort((a, b) => a.orden - b.orden) };
      setOriginal(ordenada);
      setForm(ordenada);
      setIntentoGuardar(false);
      showToast('success', 'Pantalla actualizada', 'Los televisores conectados ya muestran los cambios.');
    } catch (err) {
      setErrorGuardar(toApiError(err));
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  };

  const generarEnlace = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setGenerandoToken(true);
    try {
      const r = await pantallaTvService.regenerarDeviceToken();
      setEnlaceNuevo(`${urlPantalla}?device_token=${encodeURIComponent(r.device_token)}`);
      setConfirmarToken(false);
    } catch (err) {
      showToast('error', 'No se generó el enlace', toApiError(err).message);
    } finally {
      enviandoRef.current = false;
      setGenerandoToken(false);
    }
  };

  /** Otra ventana conectada en vivo: la pantalla no pide clave porque se abre desde la sesión. */
  const abrirPantalla = async () => {
    // La ventana se abre antes de esperar la red: después, los navegadores la bloquean.
    const ventana = window.open('about:blank', '_blank');
    if (!ventana) {
      showToast('warning', 'No se pudo abrir la pantalla', 'Permite las ventanas emergentes de este sitio e inténtalo de nuevo.');
      return;
    }
    try {
      const token = await pantallaTvService.crearSesion();
      localStorage.setItem(`gymos_tv_device_token_${subdominio}`, token);
      ventana.location.href = `/tv/${subdominio}`;
    } catch (err) {
      ventana.close();
      showToast('error', 'No se pudo abrir la pantalla', toApiError(err).message);
    }
  };

  const probarSaludo = async () => {
    if (probando) return;
    setProbando(true);
    try {
      await pantallaTvService.testSaludo(user?.nombre ?? 'Prueba');
      showToast('success', 'Saludo enviado', 'Mira el televisor: debe mostrar la bienvenida.');
    } catch (err) {
      showToast('error', 'No se envió el saludo', toApiError(err).message);
    } finally {
      setProbando(false);
    }
  };

  const bloqueado = !puedeEditar || guardando;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pantalla TV</h1>
          <p className="page-subtitle">El televisor de recepción: bienvenida al ingresar, hora, clases del día y avisos</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 20 }}>
        <Card title="Ver la pantalla" icon={<Tv size={18} />}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
            Se abre en otra ventana, conectada en vivo a lo que pasa en recepción. Si no tienes televisor, déjala abierta y
            cambia a la ventana del sistema solo cuando vayas a registrar un cliente o vender.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" rightIcon={<ExternalLink size={16} />} onClick={abrirPantalla}>
              Abrir pantalla
            </Button>
            {puedeEditar && (
              <Button variant="outline" leftIcon={<Send size={16} />} onClick={probarSaludo} isLoading={probando}>
                Probar saludo
              </Button>
            )}
          </div>
        </Card>

        {esJefe && (
          <Card title="Conectar un televisor aparte" icon={<KeyRound size={18} />}>
            {enlaceNuevo ? (
              <>
                <MensajeFijo tono="advertencia" style={{ marginBottom: 12 }}>
                  Cópialo ahora y ábrelo en el televisor. Por seguridad no se vuelve a mostrar.
                </MensajeFijo>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    wordBreak: 'break-all',
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    marginBottom: 10,
                  }}
                >
                  {enlaceNuevo}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="primary" leftIcon={<Copy size={16} />} onClick={() => copiar(enlaceNuevo)}>
                    Copiar enlace
                  </Button>
                  <Button variant="ghost" onClick={() => setEnlaceNuevo(null)}>
                    Ya lo copié
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Solo si el televisor tiene su propio navegador, sin sesión abierta. Genera un enlace con clave para abrirlo allí; uno nuevo desconecta el anterior.
                </p>
                <Button variant="outline" leftIcon={<KeyRound size={16} />} onClick={() => setConfirmarToken(true)}>
                  Generar enlace
                </Button>
              </>
            )}
          </Card>
        )}
      </div>

      {!puedeEditar && (
        <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
          Puedes ver la configuración de la pantalla, pero no tienes permiso para cambiarla.
        </MensajeFijo>
      )}

      <form onSubmit={guardar} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <Card title="Qué muestra">
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={form.mostrar_clases}
                disabled={bloqueado}
                onChange={(e) => setForm({ ...form, mostrar_clases: e.target.checked })}
              />
              <span>Clases del día</span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={form.mostrar_avisos}
                disabled={bloqueado}
                onChange={(e) => setForm({ ...form, mostrar_avisos: e.target.checked })}
              />
              <span>Avisos</span>
            </label>
            <Input
              label="Duración de la bienvenida (segundos)"
              type="number"
              inputMode="numeric"
              min={3}
              max={30}
              step={1}
              value={String(form.tiempo_saludo_segundos)}
              onChange={(e) => setForm({ ...form, tiempo_saludo_segundos: Number(e.target.value) })}
              error={intentoGuardar ? errorTiempo ?? undefined : undefined}
              disabled={bloqueado}
            />
            <Input
              label="Logo (enlace a la imagen)"
              value={form.logo_url ?? ''}
              placeholder="https://..."
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              disabled={bloqueado}
            />
          </Card>

          <Card
            title="Avisos"
            subtitle="Rotan en la pantalla, en este orden"
            action={
              puedeEditar ? (
                <Button variant="outline" size="sm" leftIcon={<Plus size={14} />} onClick={agregarAviso} disabled={guardando}>
                  Agregar
                </Button>
              ) : undefined
            }
          >
            {form.avisos.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                No hay avisos. Agrega uno para anunciar horarios, promociones o novedades.
              </p>
            ) : (
              form.avisos.map((a, i) => {
                const err = intentoGuardar ? erroresAviso(a) : null;
                return (
                  <div
                    key={a.id}
                    style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12, marginBottom: 12 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong style={{ fontSize: '0.85rem' }}>Aviso {i + 1}</strong>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                          <input
                            type="checkbox"
                            checked={a.activo}
                            disabled={bloqueado}
                            onChange={(e) => actualizarAviso(a.id, { activo: e.target.checked })}
                          />
                          Visible
                        </label>
                        {puedeEditar && (
                          <button
                            type="button"
                            className="icon-btn ghost"
                            aria-label={`Quitar aviso ${i + 1}`}
                            onClick={() => quitarAviso(a.id)}
                            disabled={guardando}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    <Input
                      label="Título"
                      value={a.titulo}
                      maxLength={MAX_TITULO}
                      onChange={(e) => actualizarAviso(a.id, { titulo: e.target.value })}
                      disabled={bloqueado}
                    />
                    <Input
                      label="Texto"
                      value={a.contenido}
                      maxLength={MAX_CONTENIDO}
                      onChange={(e) => actualizarAviso(a.id, { contenido: e.target.value })}
                      error={err ?? undefined}
                      disabled={bloqueado}
                    />
                  </div>
                );
              })
            )}
          </Card>
        </div>

        {puedeEditar && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              {errorGuardar && (
                <MensajeFijo tono="error" titulo="No se guardó la configuración">
                  {errorGuardar.message}
                </MensajeFijo>
              )}
            </div>
            {hayCambios && <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Hay cambios sin guardar</span>}
            <Button
              variant="outline"
              type="button"
              disabled={!hayCambios || guardando}
              onClick={() => {
                setForm(original);
                setIntentoGuardar(false);
                setErrorGuardar(null);
              }}
            >
              Descartar
            </Button>
            <Button variant="primary" type="submit" leftIcon={<Save size={16} />} isLoading={guardando} disabled={!hayCambios}>
              Guardar
            </Button>
          </div>
        )}
      </form>

      <ConfirmDialog
        isOpen={confirmarToken}
        onClose={() => setConfirmarToken(false)}
        onConfirm={generarEnlace}
        title="Generar un enlace nuevo"
        message="El televisor conectado con el enlace anterior se desconecta y habrá que abrir el nuevo. ¿Continuar?"
        confirmText="Generar enlace"
        isDestructive
        isLoading={generandoToken}
      />
    </div>
  );
};
