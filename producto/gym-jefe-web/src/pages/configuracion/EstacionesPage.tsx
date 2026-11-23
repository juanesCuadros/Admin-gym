import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, KeyRound, MonitorSmartphone, Plus, ShieldOff } from 'lucide-react';
import { estacionesService } from '../../api/estaciones.service';
import { revisionesService } from '../../api/revisiones.service';
import { toApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmarConMotivo } from '../../components/ui/ConfirmarConMotivo';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { formatFechaHora } from '../../utils/formato';
import type { Estacion, EstacionConCodigo, EstadoEstacion } from '../../types/estaciones.types';
import { RevisionesEstacionesPanel } from './RevisionesEstacionesPanel';

const ESTADO: Record<EstadoEstacion, { texto: string; variante: 'success' | 'info' | 'warning' | 'neutral' }> = {
  activa: { texto: 'Activa', variante: 'success' },
  por_activar: { texto: 'Por activar', variante: 'info' },
  codigo_vencido: { texto: 'Código vencido', variante: 'warning' },
  revocada: { texto: 'Revocada', variante: 'neutral' },
};

/**
 * Estaciones de GymDesk Escritorio (contrato E.1). Solo el Jefe.
 * El código de activación se muestra una única vez; el servidor guarda solo su hash.
 */
export const EstacionesPage: React.FC = () => {
  const { showToast } = useToast();
  const { tenant } = useTenantTheme();

  const [pestana, setPestana] = useState<'equipos' | 'revisar'>('equipos');
  // Cuántas revisiones hay pendientes, para avisarlo en la pestaña sin tener que abrirla.
  const [pendientes, setPendientes] = useState<number | null>(null);
  const [estaciones, setEstaciones] = useState<Estacion[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const [conCodigo, setConCodigo] = useState<EstacionConCodigo | null>(null);
  const [regenerando, setRegenerando] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const [aRevocar, setARevocar] = useState<Estacion | null>(null);
  const [revocando, setRevocando] = useState(false);
  const [errorRevocar, setErrorRevocar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      setEstaciones(await estacionesService.listar());
    } catch (e) {
      setErrorCarga(e);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    revisionesService
      .listar('pendiente_revision', 1, 0)
      .then((r) => setPendientes(r.pendientes))
      .catch(() => setPendientes(null)); // el error se muestra al abrir la pestaña
  }, []);

  const abrirCrear = () => {
    setNombre('');
    setErrorNombre(null);
    setErrorCrear(null);
    setCreando(true);
  };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (limpio.length < 2) {
      setErrorNombre('Escribe un nombre de al menos 2 letras.');
      return;
    }
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorCrear(null);
    try {
      const creada = await estacionesService.crear(limpio);
      setCreando(false);
      setConCodigo(creada);
      await cargar();
    } catch (err) {
      const api = toApiError(err);
      if (api.codigo === 'ESTACION_NOMBRE_DUPLICADO' || api.campos.nombre) setErrorNombre(api.campos.nombre ?? api.message);
      else setErrorCrear(api.message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const regenerar = async (estacion: Estacion) => {
    if (regenerando) return;
    setRegenerando(estacion.id);
    setErrorAccion(null);
    try {
      setConCodigo(await estacionesService.regenerarCodigo(estacion.id));
      await cargar();
    } catch (err) {
      setErrorAccion(toApiError(err).message);
      await cargar();
    } finally {
      setRegenerando(null);
    }
  };

  const revocar = async (motivo: string) => {
    if (!aRevocar || revocando) return;
    setRevocando(true);
    setErrorRevocar(null);
    try {
      await estacionesService.revocar(aRevocar.id, motivo);
      showToast('success', 'Estación revocada', `${aRevocar.nombre} ya no puede sincronizar.`);
      setARevocar(null);
      await cargar();
    } catch (err) {
      setErrorRevocar(toApiError(err).message);
    } finally {
      setRevocando(false);
    }
  };

  const copiarCodigo = async () => {
    if (!conCodigo) return;
    try {
      await navigator.clipboard.writeText(conCodigo.codigo);
      showToast('success', 'Código copiado');
    } catch {
      showToast('warning', 'No se pudo copiar', 'Anótalo a mano.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Estaciones</h1>
          <p className="page-subtitle">Computadores de recepción con GymDesk Escritorio, que siguen funcionando sin internet</p>
        </div>
        {pestana === 'equipos' && estaciones && estaciones.length > 0 && (
          <Button leftIcon={<Plus size={16} />} onClick={abrirCrear}>
            Nueva estación
          </Button>
        )}
      </div>

      <div className="tabs-nav">
        <button className={`tab-btn ${pestana === 'equipos' ? 'active' : ''}`} onClick={() => setPestana('equipos')}>
          Equipos
        </button>
        <button className={`tab-btn ${pestana === 'revisar' ? 'active' : ''}`} onClick={() => setPestana('revisar')}>
          Por revisar{pendientes ? ` (${pendientes})` : ''}
        </button>
      </div>

      {pestana === 'revisar' && <RevisionesEstacionesPanel onPendientes={setPendientes} />}

      <div style={{ display: pestana === 'equipos' ? undefined : 'none' }}>
      <Card style={{ marginBottom: 16 }}>
        <div className="descarga-escritorio">
          <div className="descarga-escritorio-icono"><Download size={22} /></div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <strong>GymDesk Escritorio para Windows</strong>
            <ol>
              <li>Descarga el instalador en el computador de recepción e instálalo. Windows o el navegador pueden avisar que es un
                archivo poco común: elige <em>Conservar</em> y después <em>Más información → Ejecutar de todas formas</em>.</li>
              <li>Crea aquí una estación para ese computador y copia su código (vence en 24 horas).</li>
              <li>Abre GymDesk, escribe el subdominio <strong>{tenant.subdominio || 'de tu gimnasio'}</strong> y el código.</li>
            </ol>
          </div>
          <a className="btn btn-primary" href="/descargas/GymDesk-setup.exe" download="GymDesk-setup.exe">
            <Download size={16} /> Descargar para Windows
          </a>
        </div>
      </Card>
      {errorAccion && (
        <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
          {errorAccion}
        </MensajeFijo>
      )}

      {errorCarga ? (
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      ) : !estaciones ? (
        <Cargando />
      ) : estaciones.length === 0 ? (
        <VacioInicial
          icono={<MonitorSmartphone size={40} />}
          titulo="Aún no hay estaciones"
          descripcion="Crea una estación para cada computador de recepción donde vayas a instalar GymDesk Escritorio. Al crearla recibes un código para activarla."
          textoAccion="Nueva estación"
          onAccion={abrirCrear}
        />
      ) : (
        <Card>
          <div className="table-responsive">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Estación</th>
                  <th>Estado</th>
                  <th>Equipo</th>
                  <th>Última sincronización</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {estaciones.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{e.nombre}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Creada el {formatFechaHora(e.created_at)}
                        {e.creada_por_nombre ? ` por ${e.creada_por_nombre}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge variant={ESTADO[e.estado].variante}>{ESTADO[e.estado].texto}</Badge>
                      {e.estado === 'por_activar' && e.codigo_expira_en && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          El código vence el {formatFechaHora(e.codigo_expira_en)}
                        </div>
                      )}
                      {e.estado === 'revocada' && e.motivo_revocacion && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{e.motivo_revocacion}</div>
                      )}
                    </td>
                    <td>
                      {e.nombre_equipo ?? '—'}
                      {e.version_app && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Versión {e.version_app}</div>}
                    </td>
                    <td>{e.ultima_sync_en ? formatFechaHora(e.ultima_sync_en) : e.estado === 'activa' ? 'Aún no ha sincronizado' : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {(e.estado === 'por_activar' || e.estado === 'codigo_vencido') && (
                        <Button
                          variant="outline"
                          size="sm"
                          leftIcon={<KeyRound size={14} />}
                          isLoading={regenerando === e.id}
                          disabled={regenerando !== null}
                          onClick={() => void regenerar(e)}
                          style={{ marginRight: 8 }}
                        >
                          Código nuevo
                        </Button>
                      )}
                      {e.estado !== 'revocada' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<ShieldOff size={14} />}
                          onClick={() => {
                            setErrorRevocar(null);
                            setARevocar(e);
                          }}
                        >
                          Revocar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      </div>

      <Modal isOpen={creando} onClose={() => !enviando && setCreando(false)} title="Nueva estación" maxWidth="440px">
        <form onSubmit={crear} noValidate>
          <Input
            label="Nombre de la estación"
            placeholder="Recepción principal"
            hint="Sirve para reconocer el computador en esta lista."
            value={nombre}
            maxLength={60}
            onChange={(e) => {
              setNombre(e.target.value);
              setErrorNombre(null);
            }}
            error={errorNombre ?? undefined}
            disabled={enviando}
            autoFocus
          />
          {errorCrear && (
            <MensajeFijo tono="error" style={{ marginTop: 12 }}>
              {errorCrear}
            </MensajeFijo>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <Button type="button" variant="outline" onClick={() => setCreando(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={enviando}>
              Crear y ver el código
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={conCodigo !== null} onClose={() => setConCodigo(null)} title={`Código de ${conCodigo?.nombre ?? ''}`} maxWidth="460px">
        {conCodigo && (
          <div>
            <MensajeFijo tono="advertencia" titulo="Anótalo ahora: no se vuelve a mostrar">
              Si lo pierdes, genera un código nuevo desde la lista.
            </MensajeFijo>
            <div
              style={{
                margin: '18px 0',
                padding: '18px 12px',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                background: 'var(--bg-surface-elevated)',
                borderRadius: 12,
                userSelect: 'all',
              }}
            >
              {conCodigo.codigo}
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              <li>Abre GymDesk Escritorio en el computador de recepción.</li>
              <li>
                Escribe el subdominio <strong>{tenant?.subdominio ?? 'de tu gimnasio'}</strong> y este código.
              </li>
              <li>
                El código sirve una sola vez
                {conCodigo.codigo_expira_en ? ` y vence el ${formatFechaHora(conCodigo.codigo_expira_en)}` : ' y vence en 24 horas'}.
              </li>
            </ol>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="outline" leftIcon={<Copy size={15} />} onClick={() => void copiarCodigo()}>
                Copiar
              </Button>
              <Button onClick={() => setConCodigo(null)}>Ya lo anoté</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmarConMotivo
        isOpen={aRevocar !== null}
        onClose={() => !revocando && setARevocar(null)}
        onConfirm={(motivo) => void revocar(motivo)}
        title={`Revocar ${aRevocar?.nombre ?? 'la estación'}`}
        message={
          <>
            Ese computador dejará de sincronizar y de poder usarse de inmediato. No se puede deshacer: para volver a usarlo
            hay que crear una estación nueva. Lo que ya subió al sistema se conserva.
          </>
        }
        confirmText="Revocar estación"
        isLoading={revocando}
        error={errorRevocar}
      />
    </div>
  );
};
