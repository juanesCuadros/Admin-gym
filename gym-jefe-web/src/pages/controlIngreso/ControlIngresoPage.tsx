import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Fingerprint,
  Search,
  Gift,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Users,
} from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { useToast } from '../../contexts/ToastContext';
import { parseApiError } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import {
  CheckinResponseDto,
  CheckinItemHistorialDto,
  ResumenIngresosHoyDto,
} from '../../types/controlIngreso.types';

export const ControlIngresoPage: React.FC = () => {
  const { showToast } = useToast();

  const [documento, setDocumento] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCheckin, setLastCheckin] = useState<CheckinResponseDto | null>(null);

  // History & Summary
  const [historial, setHistorial] = useState<CheckinItemHistorialDto[]>([]);
  const [resumen, setResumen] = useState<ResumenIngresosHoyDto | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Courtesy Modal
  const [showCortesiaModal, setShowCortesiaModal] = useState(false);
  const [motivoCortesia, setMotivoCortesia] = useState('');

  const loadHistorial = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const data = await controlIngresoService.getIngresosHoy();
      setHistorial(data.items);
      setResumen(data.resumen);
    } catch (e) {
      console.error('Error fetching today entries', e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistorial();
  }, [loadHistorial]);

  const handleManualCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documento.trim()) return;

    setIsProcessing(true);
    try {
      const res = await controlIngresoService.checkinManual({ documento: documento.trim() });
      setLastCheckin(res);

      if (res.resultado === 'abrio') {
        showToast('success', '¡Paso Autorizado!', res.mensaje);
      } else if (res.resultado === 'alerta_mora') {
        showToast('warning', 'Alerta de Pago', res.mensaje);
      } else {
        showToast('error', 'Acceso Negado', res.mensaje);
      }

      setDocumento('');
      loadHistorial();
    } catch (err) {
      const msg = parseApiError(err);
      showToast('error', 'Error en acceso', msg);
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
      loadHistorial();
    } catch (err) {
      const msg = parseApiError(err);
      showToast('warning', 'Simulador Biométrico', `Lector emuló lectura: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCortesiaSubmit = async () => {
    if (!motivoCortesia.trim() || motivoCortesia.length < 4) {
      showToast('warning', 'Validación', 'El motivo de cortesía debe tener al menos 4 caracteres');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await controlIngresoService.ingresoCortesia({ motivo: motivoCortesia.trim() });
      setLastCheckin(res);
      showToast('success', 'Cortesía Registrada', 'Torniquete comandado a abrir');
      setShowCortesiaModal(false);
      setMotivoCortesia('');
      loadHistorial();
    } catch (err) {
      const msg = parseApiError(err);
      showToast('error', 'Error en cortesía', msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Control de Ingreso y Torniquete</h1>
          <p className="page-subtitle">
            Validación de acceso en tiempo real, alertas de mora y comando físico de torniquete
          </p>
        </div>

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
            Ingreso de Cortesía
          </Button>
        </div>
      </div>

      {/* Grid: Validator on left, Real-time result on right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24, marginBottom: 28 }}>
        {/* Manual search card */}
        <Card title="Punto de Acceso">
          <form onSubmit={handleManualCheckin}>
            <Input
              label="Cédula o Documento de Identidad"
              placeholder="Ingresa número de documento..."
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
              leftIcon={<ShieldCheck size={18} />}
            >
              Validar Acceso
            </Button>
          </form>

          {/* Quick Summary Pills */}
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
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={16} color="var(--text-muted)" />
                <span style={{ color: 'var(--text-secondary)' }}>Aforo registrado hoy:</span>
              </div>
              <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                {resumen.total_ingresos} ingresos
              </span>
            </div>
          )}
        </Card>

        {/* Turnstile Visual Feedback */}
        <Card title="Estado del Torniquete">
          {lastCheckin ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                textAlign: 'center',
                borderRadius: 'var(--radius-md)',
                backgroundColor:
                  lastCheckin.resultado === 'abrio'
                    ? 'var(--success-light)'
                    : lastCheckin.resultado === 'alerta_mora'
                    ? 'var(--warning-light)'
                    : 'var(--danger-light)',
                border: `1px solid ${
                  lastCheckin.resultado === 'abrio'
                    ? 'var(--success-border)'
                    : lastCheckin.resultado === 'alerta_mora'
                    ? 'var(--warning-border)'
                    : 'var(--danger-border)'
                }`,
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
                {lastCheckin.resultado === 'abrio'
                  ? 'TORNIQUETE LIBERADO'
                  : lastCheckin.resultado === 'alerta_mora'
                  ? 'ALERTA DE MORA'
                  : 'ACCESO DENEGADO'}
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
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {lastCheckin.deportista.nombre}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.775rem' }}>
                    Doc: {lastCheckin.deportista.documento} · {lastCheckin.deportista.estado_calculado}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <ShieldCheck size={42} style={{ marginBottom: 8 }} />
              <p>Esperando lectura biométrica o ingreso de documento...</p>
            </div>
          )}
        </Card>
      </div>

      {/* Access History Table */}
      <Card title="Historial de Ingresos de Hoy">
        <Table<CheckinItemHistorialDto>
          columns={[
            {
              header: 'Hora',
              accessor: (item) =>
                new Date(item.ts_local).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              width: '110px',
            },
            {
              header: 'Deportista / Invitado',
              render: (item) => (
                <div>
                  <div style={{ fontWeight: 700 }}>{item.deportista_nombre || 'Cortesía / Visitante'}</div>
                  {item.deportista_documento && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Doc: {item.deportista_documento}
                    </div>
                  )}
                </div>
              ),
            },
            {
              header: 'Método',
              render: (item) => (
                <span style={{ textTransform: 'capitalize', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {item.metodo === 'huella' ? 'Lector Huella' : 'Manual / Staff'}
                </span>
              ),
            },
            {
              header: 'Resultado',
              render: (item) => (
                <Badge
                  variant={
                    item.resultado === 'abrio'
                      ? 'success'
                      : item.resultado === 'alerta_mora'
                      ? 'warning'
                      : 'danger'
                  }
                >
                  {item.resultado === 'abrio'
                    ? 'Permitido'
                    : item.resultado === 'alerta_mora'
                    ? 'Alerta Mora'
                    : 'Denegado'}
                </Badge>
              ),
            },
            {
              header: 'Motivo / Detalle',
              render: (item) => (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {item.motivo_cortesia || '-'}
                </span>
              ),
            },
          ]}
          data={historial}
          isLoading={isLoadingHistory}
          keyExtractor={(item) => item.id}
          emptyMessage="No se han registrado ingresos hoy"
        />
      </Card>

      {/* Courtesy Modal */}
      <Modal
        isOpen={showCortesiaModal}
        onClose={() => setShowCortesiaModal(false)}
        title="Autorizar Ingreso de Cortesía"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCortesiaModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCortesiaSubmit} isLoading={isProcessing}>
              Confirmar y Abrir
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          El ingreso de cortesía comanda la apertura del torniquete y queda registrado en la auditoría inmutable del gimnasio.
        </p>
        <Input
          label="Motivo Obligatorio"
          placeholder="Ej. Clase de prueba autorizada por gerencia..."
          value={motivoCortesia}
          onChange={(e) => setMotivoCortesia(e.target.value)}
          required
        />
      </Modal>
    </div>
  );
};
