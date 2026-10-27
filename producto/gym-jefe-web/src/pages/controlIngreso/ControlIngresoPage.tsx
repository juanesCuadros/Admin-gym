import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gift, CheckCircle2, AlertTriangle, XCircle, Search } from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { MensajeFijo } from '../../components/estados/Estados';
import { EstadoDeportistaBadge } from '../../components/ui/EstadoDeportistaBadge';
import { formatHora } from '../../utils/formato';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import { CheckinItemHistorialDto, CheckinResponseDto, ResumenIngresosHoyDto } from '../../types/controlIngreso.types';
import { MembresiaFichaResponse } from '../../types/deportistas.types';
import { PanelAdentro } from './PanelAdentro';
import { presentarResultado } from './formatoIngreso';

const TITULO_RESULTADO: Record<string, string> = {
  abrio: 'Acceso permitido',
  alerta_mora: 'Pasa con alerta de pago',
  negado: 'Acceso negado',
};

const CLASE_RESULTADO: Record<string, 'ok' | 'warn' | 'bad'> = {
  abrio: 'ok',
  alerta_mora: 'warn',
  negado: 'bad',
};

/** Cuántos ingresos recientes se muestran en la columna derecha. */
const INGRESOS_RECIENTES = 8;

export const ControlIngresoPage: React.FC = () => {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const puedeRegistrar = hasPermission('control_ingreso', 'crear');
  // Plan y vencimiento salen de la ficha (endpoint existente); solo se consulta con permiso de lectura.
  const puedeVerFicha = hasPermission('deportistas', 'leer');

  const inputRef = useRef<HTMLInputElement>(null);
  const [documento, setDocumento] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<CheckinResponseDto | null>(null);
  const [membresia, setMembresia] = useState<MembresiaFichaResponse | null>(null);
  const [errorCheckin, setErrorCheckin] = useState<string | null>(null);

  const [resumen, setResumen] = useState<ResumenIngresosHoyDto | null>(null);
  const [recientes, setRecientes] = useState<CheckinItemHistorialDto[]>([]);
  const [recargarAdentro, setRecargarAdentro] = useState(0);

  // Cortesía
  const [showCortesiaModal, setShowCortesiaModal] = useState(false);
  const [motivoCortesia, setMotivoCortesia] = useState('');
  const [errorCortesia, setErrorCortesia] = useState<string | null>(null);

  /** Resumen del día + últimos ingresos en una sola consulta. */
  const cargarHoy = useCallback(async () => {
    try {
      const data = await controlIngresoService.getIngresosHoy({ limit: INGRESOS_RECIENTES });
      setResumen(data.resumen);
      setRecientes(data.items);
    } catch {
      // Es complementario: si falla, no se muestra (nunca un número inventado).
      setResumen(null);
      setRecientes([]);
    }
  }, []);

  useEffect(() => {
    cargarHoy();
  }, [cargarHoy]);

  const trasRegistro = () => {
    cargarHoy();
    setRecargarAdentro((n) => n + 1);
  };

  /** Plan y vencimiento del deportista validado. Si falla, el resultado se muestra igual sin esos datos. */
  const cargarMembresia = async (deportistaId: string) => {
    if (!puedeVerFicha) return;
    try {
      const ficha = await deportistasService.getFicha(deportistaId);
      setMembresia(ficha.membresia_actual ?? null);
    } catch {
      setMembresia(null);
    }
  };

  const handleManualCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documento.trim() || isProcessing) return;

    setIsProcessing(true);
    setErrorCheckin(null);
    setMembresia(null);
    try {
      const res = await controlIngresoService.checkinManual({ documento: documento.trim() });
      setLastCheckin(res);
      setDocumento('');
      trasRegistro();
      if (res.deportista?.id) cargarMembresia(res.deportista.id);
    } catch (err) {
      setErrorCheckin(parseApiError(err));
    } finally {
      setIsProcessing(false);
      // El campo queda listo para el siguiente documento.
      inputRef.current?.focus();
    }
  };

  const cerrarCortesia = () => {
    if (isProcessing) return;
    setShowCortesiaModal(false);
    setErrorCortesia(null);
  };

  const handleCortesiaSubmit = async () => {
    if (motivoCortesia.trim().length < 4) {
      setErrorCortesia('Escribe el motivo de la cortesía (mínimo 4 caracteres).');
      return;
    }
    setIsProcessing(true);
    setErrorCortesia(null);
    try {
      const res = await controlIngresoService.ingresoCortesia({ motivo: motivoCortesia.trim() });
      setLastCheckin(res);
      setMembresia(null);
      showToast('success', 'Cortesía registrada', 'El ingreso quedó registrado con su motivo.');
      setShowCortesiaModal(false);
      setMotivoCortesia('');
      trasRegistro();
    } catch (err) {
      setErrorCortesia(parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const esCortesia = lastCheckin?.tipo === 'cortesia';
  const claseResultado = lastCheckin ? (esCortesia ? 'info' : CLASE_RESULTADO[lastCheckin.resultado] ?? 'info') : 'info';
  const IconoResultado =
    lastCheckin?.resultado === 'abrio' || esCortesia
      ? CheckCircle2
      : lastCheckin?.resultado === 'alerta_mora'
        ? AlertTriangle
        : XCircle;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Control de ingreso</h1>
          <p className="page-subtitle">Valida el acceso de cada persona y registra su salida</p>
        </div>

        {puedeRegistrar && (
          <Button variant="secondary" leftIcon={<Gift size={16} />} onClick={() => setShowCortesiaModal(true)}>
            Ingreso de cortesía
          </Button>
        )}
      </div>

      <div className="checkin-layout">
        <div className="checkin-main">
          {/* Punto de acceso */}
          <div className="checkin-hero">
            <h2 className="checkin-hero-title">Registrar ingreso</h2>
            <p className="checkin-hero-text">Escribe el documento del deportista</p>

            {puedeRegistrar ? (
              <form className="checkin-form" onSubmit={handleManualCheckin}>
                <div className="checkin-input">
                  <Search size={20} />
                  <input
                    ref={inputRef}
                    className="form-input"
                    placeholder="Número de documento"
                    aria-label="Documento"
                    inputMode="numeric"
                    autoComplete="off"
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isProcessing}
                  disabled={!documento.trim()}
                  rightIcon={<ArrowRight size={16} />}
                >
                  Validar acceso
                </Button>
              </form>
            ) : (
              <div className="mensaje-fijo-wrap">
                <MensajeFijo tono="info">No tienes permiso para registrar ingresos.</MensajeFijo>
              </div>
            )}

            {errorCheckin && (
              <div className="mensaje-fijo-wrap">
                <MensajeFijo tono="error">{errorCheckin}</MensajeFijo>
              </div>
            )}
          </div>

          {/* Resultado del último registro */}
          {lastCheckin && (
            <div className="resultado" key={lastCheckin.checkin_id ?? lastCheckin.ts_local}>
              <div className={`resultado-franja ${claseResultado}`}>
                <IconoResultado size={20} />
                <span>{esCortesia ? 'Cortesía registrada' : TITULO_RESULTADO[lastCheckin.resultado] ?? lastCheckin.resultado}</span>

              </div>

              {lastCheckin.deportista ? (
                <div className="resultado-cuerpo">
                  <Avatar name={lastCheckin.deportista.nombre} />
                  <div className="resultado-quien">
                    <div className="resultado-nombre">{lastCheckin.deportista.nombre}</div>
                    <div className="resultado-doc">Doc. {lastCheckin.deportista.documento}</div>
                  </div>
                  <EstadoDeportistaBadge
                    estado={lastCheckin.deportista.estado}
                    detalle={{ dias: lastCheckin.deportista.dias_restantes_o_vencido }}
                  />
                </div>
              ) : (
                <div style={{ height: 16 }} />
              )}

              {lastCheckin.mensaje && <p className="resultado-mensaje">{lastCheckin.mensaje}</p>}

              <div className="resultado-datos">
                <div>
                  <small>Plan</small>
                  <span>{membresia?.plan_nombre ?? '—'}</span>
                </div>
                <div>
                  <small>Vencimiento</small>
                  <span>{membresia ? formatFechaNegocio(membresia.fecha_vencimiento) : '—'}</span>
                </div>
                <div>
                  <small>Hora</small>
                  <span>{formatHora(lastCheckin.ts_local)}</span>
                </div>
              </div>
            </div>
          )}

          <PanelAdentro recargar={recargarAdentro} onSalida={cargarHoy} />
        </div>

        {/* Hoy */}
        <Card title="Hoy">
          {resumen ? (
            <>
              <div className="checkin-stats">
                <div className="checkin-stat">
                  <small>Registros</small>
                  <strong>{resumen.total_ingresos}</strong>
                </div>
                <div className="checkin-stat">
                  <small>Adentro ahora</small>
                  <strong>{resumen.adentro_ahora}</strong>
                </div>
              </div>

              {recientes.length === 0 ? (
                <p className="texto-vacio" style={{ textAlign: 'center', padding: '12px 0' }}>
                  Aún no hay ingresos hoy.
                </p>
              ) : (
                <div>
                  {recientes.map((i) => {
                    const r = presentarResultado(i.resultado);
                    const nombre = i.deportista_nombre ?? (i.tipo === 'cortesia' ? 'Cortesía' : 'Sin identificar');
                    return (
                      <div className="feed-item" key={i.id}>
                        <span className="feed-hora">{formatHora(i.ts_local)}</span>
                        <Avatar name={nombre} size="sm" />
                        <span className="feed-nombre" title={nombre}>
                          {nombre}
                        </span>
                        <Badge variant={i.tipo === 'cortesia' ? 'info' : r.variante}>
                          {i.tipo === 'cortesia' ? 'Cortesía' : r.variante === 'warning' ? 'Alerta' : r.texto}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Link to="/control-ingreso/ingresos-hoy" className="feed-ver-todos">
                Ver todos los ingresos de hoy
              </Link>
            </>
          ) : (
            <p className="texto-vacio">No se pudo cargar el resumen del día.</p>
          )}
        </Card>
      </div>

      <Modal
        isOpen={showCortesiaModal}
        onClose={cerrarCortesia}
        title="Registrar ingreso de cortesía"
        footer={
          <>
            <Button variant="secondary" onClick={cerrarCortesia} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCortesiaSubmit} isLoading={isProcessing}>
              Registrar cortesía
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
          La cortesía queda registrada con tu nombre y el motivo en la auditoría del gimnasio.
        </p>
        <Input
          label="Motivo"
          placeholder="Ej. Clase de prueba autorizada por el Jefe"
          value={motivoCortesia}
          maxLength={255}
          onChange={(e) => setMotivoCortesia(e.target.value)}
          required
        />
        {errorCortesia && <MensajeFijo tono="error">{errorCortesia}</MensajeFijo>}
      </Modal>
    </div>
  );
};
