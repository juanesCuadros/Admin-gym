import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Textarea } from './Input';
import { MensajeFijo } from '../estados/Estados';

interface ConfirmarConMotivoProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  /** `true`: el motivo es obligatorio (§A3). `false`: se ofrece pero es opcional. */
  motivoObligatorio?: boolean;
  /** Largo mínimo cuando es obligatorio (el backend suele exigir 4 o 10). */
  minimo?: number;
  maximo?: number;
  etiquetaMotivo?: string;
  isLoading?: boolean;
  /** Error del servidor: se muestra fijo y no se pierde lo escrito (§A6). */
  error?: string | null;
}

/**
 * Confirmación de una acción destructiva con motivo escrito (§A3).
 * Variante de `ConfirmDialog` para las acciones que piden justificación.
 */
export const ConfirmarConMotivo: React.FC<ConfirmarConMotivoProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  motivoObligatorio = true,
  minimo = 4,
  maximo = 255,
  etiquetaMotivo = 'Motivo',
  isLoading = false,
  error,
}) => {
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMotivo('');
      setTocado(false);
    }
  }, [isOpen]);

  const largo = motivo.trim().length;
  const errorMotivo =
    motivoObligatorio && largo < minimo
      ? `Escribe el motivo (mínimo ${minimo} caracteres).`
      : !motivoObligatorio && largo > 0 && largo < minimo
        ? `Si escribes un motivo, que tenga al menos ${minimo} caracteres.`
        : null;

  const confirmar = () => {
    setTocado(true);
    if (errorMotivo) return;
    onConfirm(motivo.trim());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isLoading ? () => undefined : onClose}
      title={title}
      maxWidth="480px"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmar} isLoading={isLoading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--danger-light)',
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={20} />
        </div>
        <div style={{ fontSize: '0.925rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{message}</div>
      </div>
      <Textarea
        label={motivoObligatorio ? etiquetaMotivo : `${etiquetaMotivo} (opcional)`}
        value={motivo}
        maxLength={maximo}
        onChange={(e) => setMotivo(e.target.value)}
        onBlur={() => setTocado(true)}
        error={tocado && errorMotivo ? errorMotivo : undefined}
        disabled={isLoading}
      />
      {error && (
        <MensajeFijo tono="error" style={{ marginTop: 8 }}>
          {error}
        </MensajeFijo>
      )}
    </Modal>
  );
};
