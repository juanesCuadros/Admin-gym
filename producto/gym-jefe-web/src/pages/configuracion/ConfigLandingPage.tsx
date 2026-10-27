import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Globe } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { parseApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { copiarAlPortapapeles, descargarBlob } from '../../utils/navegador';
import type { LandingInfoResponse } from '../../types/myGym.types';

/**
 * Configuración · Landing (GW-RF-46 CA2): enlace público y código QR, de solo lectura.
 * `GET /my-gym/landing` y `GET /my-gym/landing/qr.png`.
 *
 * GW-RF-46 CA1 (editar textos, imágenes y horarios de la landing) no tiene endpoint todavía.
 */
export const ConfigLandingPage: React.FC = () => {
  const { showToast } = useToast();
  const [landing, setLanding] = useState<LandingInfoResponse | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [descargando, setDescargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setLanding(await myGymService.getLanding());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Landing</h1>
          <p className="page-subtitle">Enlace público del gimnasio y código QR para imprimir</p>
        </div>
      </div>

      {cargando && !landing ? (
        <Cargando filas={4} />
      ) : error || !landing ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : (
        <>
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
                <Button
                  variant="outline"
                  rightIcon={<ExternalLink size={16} />}
                  onClick={() => window.open(landing.landing_url, '_blank', 'noopener')}
                >
                  Abrir
                </Button>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 16, marginBottom: 0 }}>
                {landing.mensaje}
              </p>
            </Card>

            <Card title="Código QR">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(landing.qr_svg)}`}
                  alt={`Código QR de ${landing.landing_url}`}
                  style={{ width: 220, height: 220, background: '#ffffff', padding: 8, borderRadius: 'var(--radius-sm)' }}
                />
                <Button variant="primary" leftIcon={<Download size={16} />} onClick={descargarQr} isLoading={descargando}>
                  Descargar PNG
                </Button>
              </div>
            </Card>
          </div>

          <MensajeFijo tono="info" titulo="Edición del contenido" style={{ marginTop: 20 }}>
            La edición de textos, imágenes y horarios de la landing todavía no está disponible en el servidor. El enlace y
            el QR son fijos para que no se dañen los impresos.
          </MensajeFijo>
        </>
      )}
    </div>
  );
};
