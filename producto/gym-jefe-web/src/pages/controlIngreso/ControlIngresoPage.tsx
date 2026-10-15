import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Fingerprint, Search, Gift, CheckCircle2, AlertTriangle, XCircle, Users, LogIn } from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { MensajeFijo } from '../../components/estados/Estados';
import { EstadoDeportistaBadge } from '../../components/ui/EstadoDeportistaBadge';
import { CheckinResponseDto, ResumenIngresosHoyDto } from '../../types/controlIngreso.types';
import { PanelAdentro } from './PanelAdentro';

const TITULO_RESULTADO: Record<string, string> = {
  abrio: 'Acceso permitido',
  alerta_mora: 'Pasa con alerta de pago',
  negado: 'Acceso negado',
};

export const ControlIngresoPage: React.FC = () => {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const puedeRegistrar = hasPermission('control_ingreso', 'crear');

  const [documento, setDocumento] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<CheckinResponseDto | null>(null);
  const [errorCheckin, setErrorCheckin] = useState<string | null>(null);

  const [resumen, setResumen] = useState<ResumenIngresosHoyDto | null>(null);
  const [recargarAdentro, setRecargarAdentro] = useState(0);

  // Cortesía
  const [showCortesiaModal, setShowCortesiaModal] = useState(false);
  const [motivoCortesia, setMotivoCortesia] = useState('');
  const [errorCortesia, setErrorCortesia] = useState<string | null>(null);

  const cargarResumen = useCallback(async () => {
    try {
      const data = await controlIngresoService.getIngresosHoy({ limit: 1 });
      setResumen(data.resumen);
    } catch {
      // El resumen es complementario: si falla, no se muestra (nunca un número inventado).
      setResumen(null);
    }
  }, []);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  const trasRegistro = () => {
    cargarResumen();
    setRecargarAdentro((n) => n + 1);
  };

  const handleManualCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documento.trim() || isProcessing) return;

    setIsProcessing(true);
    setErrorCheckin(null);
    try {
      const res = await controlIngresoService.checkinManual({ documento: documento.trim() });
      setLastCheckin(res);
      setDocumento('');
      trasRegistro();
    } catch (err) {
      setErrorCheckin(parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBiometricSimulation = async () => {
    setIsProcessing(true);
    try {
      // Find deportista or send default mock UUID
      const res = await controlIngresoService.checkinHuella({
        deportista_id: '00000000-0000-0000-0000-000000000001',
      });
      setLastCheckin(res);
      trasRegistro();
    } catch (err) {
      const msg = parseApiError(err);
      showToast('warning', 'Simulador Biométrico', `Lector emuló lectura: ${msg}`);
    } finally {
      setIsProcessing(false);
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

  const colorResultado = (r: string) => (r === 'abrio' ? 'success' : r === 'alerta_mora' ? 'warning' : 'danger');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Control de ingreso</h1>
          <p className="page-subtitle">Valida el acceso de cada persona y registra su salida</p>
        </div>

        {puedeRegistrar && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              variant="secondary"
              leftIcon={<Fingerprint size={18} color="var(--primary)" />}
              onClick={handleBiometricSimulation}
              disabled={isProcessing}
            >
              Simular Huella
            </Button>
            <Button
              variant="outline"
              leftIcon={<Gift size={18} color="var(--accent)" />}
              onClick={() => setShowCortesiaModal(true)}
            >
              Ingreso de cortesía
            </Button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, marginBottom: 24 }}>
        <Card title="Punto de acceso">
          {puedeRegistrar ? (
            <form onSubmit={handleManualCheckin}>
              <Input
                label="Documento"
                placeholder="Número de documento"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                autoFocus
                leftIcon={<Search size={18} />}
              />
              <Button
                type="submit"
                variant="primary"
                style={{ width: '100%', marginTop: 6 }}
                isLoading={isProcessing}
                disabled={!documento.trim()}
                leftIcon={<ShieldCheck size={18} />}
              >
                Validar acceso
              </Button>
            </form>
          ) : (
            <MensajeFijo tono="info">No tienes permiso para registrar ingresos.</MensajeFijo>
          )}

          {errorCheckin && (
            <MensajeFijo tono="error" style={{ marginTop: 12 }}>
              {errorCheckin}
            </MensajeFijo>
          )}

          {resumen && (
            <div
              style={{
                marginTop: 20,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-elevated)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <LogIn size={16} color="var(--text-muted)" />
                Hoy: <strong style={{ color: 'var(--text-primary)' }}>{resumen.total_ingresos}</strong> registros
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                <Users size={16} color="var(--text-muted)" />
                Adentro: <strong style={{ color: 'var(--text-primary)' }}>{resumen.adentro_ahora}</strong>
              </span>
              <Link to="/control-ingreso/ingresos-hoy">Ver ingresos de hoy</Link>
            </div>
          )}
        </Card>

        <Card title="Resultado">
          {lastCheckin ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 16,
                textAlign: 'center',
                borderRadius: 'var(--radius-md)',
                backgroundColor: `var(--${colorResultado(lastCheckin.resultado)}-light)`,
                border: `1px solid var(--${colorResultado(lastCheckin.resultado)}-border)`,
              }}
            >
              {lastCheckin.resultado === 'abrio' ? (
                <CheckCircle2 size={48} color="var(--success)" style={{ marginBottom: 8 }} />
              ) : lastCheckin.resultado === 'alerta_mora' ? (
                <AlertTriangle size={48} color="var(--warning)" style={{ marginBottom: 8 }} />
              ) : (
                <XCircle size={48} color="var(--danger)" style={{ marginBottom: 8 }} />
              )}

              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {lastCheckin.tipo === 'cortesia'
                  ? 'Cortesía registrada'
                  : TITULO_RESULTADO[lastCheckin.resultado] ?? lastCheckin.resultado}
              </h3>

              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4, maxWidth: 320 }}>
                {lastCheckin.mensaje}
              </p>

              {lastCheckin.deportista && (
                <div
                  style={{
                    marginTop: 14,
                    padding: '8px 16px',
                    backgroundColor: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.85rem',
                    textAlign: 'left',
                    width: '100%',
                    maxWidth: 280,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{lastCheckin.deportista.nombre}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.775rem', marginBottom: 6 }}>
                    Doc: {lastCheckin.deportista.documento}
                  </div>
                  <EstadoDeportistaBadge
                    estado={lastCheckin.deportista.estado}
                    detalle={{ dias: lastCheckin.deportista.dias_restantes_o_vencido }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '40px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <ShieldCheck size={42} style={{ marginBottom: 8 }} />
              <p>Escribe un documento para validar el acceso.</p>
            </div>
          )}
        </Card>
      </div>

      <PanelAdentro recargar={recargarAdentro} onSalida={cargarResumen} />

      <Modal
        isOpen={showCortesiaModal}
        onClose={cerrarCortesia}
        title="Registrar ingreso de cortesía"
        footer={
          <>
            <Button variant="outline" onClick={cerrarCortesia} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCortesiaSubmit} isLoading={isProcessing}>
              Registrar cortesía
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
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
