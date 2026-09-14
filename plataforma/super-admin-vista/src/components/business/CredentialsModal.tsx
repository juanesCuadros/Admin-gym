import React, { useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { CredentialsIssuanceResponse } from '@/types/gym.types';
import { useToast } from '@/hooks/useToast';
import { Copy, Check, Eye, EyeOff, ShieldAlert, Share2 } from 'lucide-react';

export interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  credentials: CredentialsIssuanceResponse | null;
}

export const CredentialsModal: React.FC<CredentialsModalProps> = ({
  isOpen,
  onClose,
  credentials,
}) => {
  const { success } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  if (!credentials) return null;

  const handleCopyWhatsapp = async () => {
    try {
      await navigator.clipboard.writeText(credentials.whatsapp_copiable);
      setCopiedWhatsapp(true);
      success('Mensaje listo para WhatsApp copiado al portapapeles');
      setTimeout(() => setCopiedWhatsapp(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleCopyPassword = async () => {
    try {
      await navigator.clipboard.writeText(credentials.password_temporal);
      setCopiedPassword(true);
      success('Contraseña copiada al portapapeles');
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Credenciales de Acceso Emitidas"
      description={`Accesos generados para el Dueño/Jefe de "${credentials.gimnasio_nombre}"`}
      maxWidth="540px"
      footer={
        <Button variant="primary" onClick={onClose}>
          Entendido, he guardado las credenciales
        </Button>
      }
    >
      <div>
        {/* Security Alert */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'rgba(255, 149, 0, 0.12)',
            border: '1px solid rgba(255, 149, 0, 0.3)',
            marginBottom: '20px',
          }}
        >
          <ShieldAlert size={20} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-primary)', lineHeight: 1.45 }}>
            <strong>Aviso de Seguridad (RF-11):</strong> Por protocolo de confidencialidad, la contraseña temporal se muestra en texto plano <strong>una única vez</strong>. Expira en 72 horas si el Jefe no ingresa a cambiarla.
          </div>
        </div>

        {/* Credentials Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            padding: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            marginBottom: '20px',
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>
              Portal de Acceso (URL)
            </div>
            <a
              href={credentials.url_acceso}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-action)',
                wordBreak: 'break-all',
              }}
            >
              {credentials.url_acceso}
            </a>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>
              Usuario (Correo del Jefe)
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
              {credentials.correo_jefe}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>
              Contraseña Temporal (Argon2id)
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: 'var(--color-bg-card)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-strong)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-md)',
                  fontWeight: 'var(--font-weight-semibold)',
                  letterSpacing: '0.05em',
                  color: 'var(--color-text-primary)',
                }}
              >
                {showPassword ? credentials.password_temporal : '••••••••••••'}
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-tertiary)',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>

                <button
                  type="button"
                  onClick={handleCopyPassword}
                  aria-label="Copiar contraseña"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: copiedPassword ? 'var(--color-success)' : 'var(--color-action)',
                    padding: '4px',
                    display: 'flex',
                  }}
                >
                  {copiedPassword ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 1-Click WhatsApp Copy (RNF-05) */}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={handleCopyWhatsapp}
          leftIcon={copiedWhatsapp ? <Check size={18} color="var(--color-success)" /> : <Share2 size={18} />}
          style={{
            borderColor: copiedWhatsapp ? 'var(--color-success)' : 'var(--color-border-strong)',
          }}
        >
          {copiedWhatsapp ? '¡Copiado al Portapapeles!' : 'Copiar Plantilla para WhatsApp'}
        </Button>
      </div>
    </Modal>
  );
};
