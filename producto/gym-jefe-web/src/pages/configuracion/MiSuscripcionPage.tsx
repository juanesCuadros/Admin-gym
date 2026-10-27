import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Send, Users, UserCheck, XCircle } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { toApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { formatCOP, formatFechaHora } from '../../utils/formato';
import type { MiPlanResponse, PlanSaasDisponible } from '../../types/myGym.types';

const TEXTO_NO_DISPONIBLE =
  'La consulta de planes todavía no está disponible en el servidor. Se habilitará cuando se publique esa función.';

/** Barra de uso frente al límite del plan. `null` = sin límite. */
const BarraUso: React.FC<{ etiqueta: string; icono: React.ReactNode; uso: number; limite?: number | null }> = ({
  etiqueta,
  icono,
  uso,
  limite,
}) => {
  const conLimite = limite !== null && limite !== undefined && limite > 0;
  const pct = conLimite ? Math.min(100, Math.round((uso / limite) * 100)) : 0;
  const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {icono}
        <span style={{ flex: 1, fontWeight: 500 }}>{etiqueta}</span>
        <span>
          {uso}
          {conLimite ? ` de ${limite}` : ' · sin límite'}
        </span>
      </div>
      {conLimite && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ height: 8, background: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: color }} />
        </div>
      )}
    </div>
  );
};

/**
 * Configuración · Mi suscripción (contrato 2.6, solo Jefe): plan del SaaS, uso y solicitud de cambio.
 * `GET /my-gym/plan`, `GET /my-gym/planes`, `POST` y `DELETE /my-gym/plan/solicitud`.
 * MVC aprueba la solicitud y registra el pago desde el Super-Admin.
 */
export const MiSuscripcionPage: React.FC = () => {
  const { showToast } = useToast();
  const [miPlan, setMiPlan] = useState<MiPlanResponse | null>(null);
  const [planes, setPlanes] = useState<PlanSaasDisponible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const [aSolicitar, setASolicitar] = useState<PlanSaasDisponible | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, lista] = await Promise.all([myGymService.getMiPlan(), myGymService.getPlanesDisponibles()]);
      setMiPlan(p);
      setPlanes(lista);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const solicitar = async () => {
    if (!aSolicitar || enviando) return;
    setEnviando(true);
    setErrorAccion(null);
    try {
      await myGymService.solicitarPlan({ plan_id: aSolicitar.id, nota: nota.trim() || undefined });
      showToast('success', 'Solicitud enviada', `MVC revisará el cambio al plan ${aSolicitar.nombre}.`);
      setASolicitar(null);
      setNota('');
      cargar();
    } catch (e) {
      setErrorAccion(toApiError(e).message);
    } finally {
      setEnviando(false);
    }
  };

  const cancelarSolicitud = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      await myGymService.cancelarSolicitudPlan();
      showToast('success', 'Solicitud cancelada');
      setConfirmarCancelar(false);
      cargar();
    } catch (e) {
      const err = toApiError(e);
      setConfirmarCancelar(false);
      setErrorAccion(err.status === 404 ? 'Ya no hay una solicitud pendiente.' : err.message);
      if (err.status === 404) cargar();
    } finally {
      setEnviando(false);
    }
  };

  const pendiente = miPlan?.solicitud_pendiente ?? null;
  const actual = miPlan?.plan_actual ?? null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi suscripción</h1>
          <p className="page-subtitle">Tu plan de GymOS, el uso actual y cambio de plan</p>
        </div>
      </div>

      {cargando && !miPlan ? (
        <Cargando />
      ) : errorCarga || !miPlan ? (
        <ErrorCarga error={errorCarga} onReintentar={cargar} textoNoEncontrado={TEXTO_NO_DISPONIBLE} />
      ) : (
        <>
          {errorAccion && (
            <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
              {errorAccion}
            </MensajeFijo>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 24 }}>
            <Card title="Plan actual">
              {actual ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: '1.3rem', fontWeight: 500 }}>{actual.nombre}</span>
                    <Badge variant="primary">{actual.tipo}</Badge>
                  </div>
                  <BarraUso
                    etiqueta="Clientes activos"
                    icono={<Users size={16} color="var(--text-muted)" />}
                    uso={miPlan.uso.clientes_activos}
                    limite={actual.max_clientes_activos}
                  />
                  <BarraUso
                    etiqueta="Personal"
                    icono={<UserCheck size={16} color="var(--text-muted)" />}
                    uso={miPlan.uso.staff}
                    limite={actual.max_staff}
                  />
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  El gimnasio no tiene un plan asignado. Escribe a MVC para revisarlo.
                </p>
              )}
            </Card>

            <Card title="Solicitud de cambio">
              {pendiente ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Clock size={16} color="var(--warning)" />
                    <span style={{ fontWeight: 500 }}>Pendiente: {pendiente.plan_nombre}</span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 0 }}>
                    Solicitada por {pendiente.solicitado_por} el {formatFechaHora(pendiente.created_at)}. MVC la aprueba
                    al registrar el pago.
                  </p>
                  <Button
                    variant="outline"
                    leftIcon={<XCircle size={16} />}
                    onClick={() => setConfirmarCancelar(true)}
                  >
                    Cancelar solicitud
                  </Button>
                </>
              ) : (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                  No hay solicitudes pendientes. Elige un plan de la lista para pedir el cambio.
                </p>
              )}
            </Card>
          </div>

          <h2 style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: 12 }}>Planes disponibles</h2>
          {planes.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>MVC no tiene planes publicados en este momento.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              {planes.map((p) => {
                const esActual = actual?.codigo === p.codigo;
                return (
                  <Card key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 500, flex: 1 }}>{p.nombre}</span>
                      {esActual && <Badge variant="success">Actual</Badge>}
                    </div>
                    {p.descripcion && (
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 0 }}>{p.descripcion}</p>
                    )}
                    <div style={{ fontSize: '1.4rem', fontWeight: 500 }}>{formatCOP(p.precio)}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                      por {p.duracion_meses} {p.duracion_meses === 1 ? 'mes' : 'meses'}
                    </div>
                    <ul style={{ fontSize: '0.875rem', paddingLeft: 18, margin: '0 0 16px', flex: 1 }}>
                      <li>
                        {p.max_clientes_activos ? `Hasta ${p.max_clientes_activos} clientes activos` : 'Clientes activos sin límite'}
                      </li>
                      <li>{p.max_staff ? `Hasta ${p.max_staff} personas en el equipo` : 'Equipo sin límite'}</li>
                    </ul>
                    <Button
                      variant={esActual ? 'outline' : 'primary'}
                      leftIcon={<Send size={16} />}
                      disabled={esActual || !!pendiente}
                      title={pendiente ? 'Ya hay una solicitud pendiente' : undefined}
                      onClick={() => {
                        setErrorAccion(null);
                        setNota('');
                        setASolicitar(p);
                      }}
                    >
                      {esActual ? 'Plan actual' : 'Solicitar este plan'}
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={aSolicitar !== null}
        onClose={() => !enviando && setASolicitar(null)}
        title={`Solicitar el plan ${aSolicitar?.nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setASolicitar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={solicitar} isLoading={enviando}>
              Enviar solicitud
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
          {aSolicitar && (
            <>
              {formatCOP(aSolicitar.precio)} por {aSolicitar.duracion_meses}{' '}
              {aSolicitar.duracion_meses === 1 ? 'mes' : 'meses'}. MVC te contactará para el pago; el cambio se aplica
              cuando lo apruebe.
            </>
          )}
        </p>
        {errorAccion && (
          <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
            {errorAccion}
          </MensajeFijo>
        )}
        <Textarea
          label="Nota para MVC (opcional)"
          value={nota}
          maxLength={500}
          onChange={(e) => setNota(e.target.value)}
          disabled={enviando}
        />
      </Modal>

      <ConfirmDialog
        isOpen={confirmarCancelar}
        onClose={() => setConfirmarCancelar(false)}
        onConfirm={cancelarSolicitud}
        title="Cancelar solicitud"
        message={`Se retirará la solicitud de cambio al plan ${pendiente?.plan_nombre ?? ''}. Puedes enviar otra después.`}
        confirmText="Cancelar solicitud"
        cancelText="Volver"
        isDestructive
        isLoading={enviando}
      />
    </div>
  );
};
