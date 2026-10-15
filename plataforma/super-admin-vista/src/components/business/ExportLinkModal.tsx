import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { Alert } from '@/components/feedback/Alert';
import { TextInput } from '@/components/forms/TextInput';
import { useToast } from '@/hooks/useToast';
import { formatFechaHora } from '@/utils/format';
import { Check, Copy } from 'lucide-react';

export interface ExportLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  gymNombre: string;
  exportUrl: string | null | undefined;
  exportExpiraEn: string | null | undefined;
}

/**
 * Enlace de exportación generado al cancelar (SA-RF-30, contrato 3.4).
 * La API lo entrega una sola vez: no hay endpoint para volver a pedirlo.
 */
export const ExportLinkModal: React.FC<ExportLinkModalProps> = ({
  isOpen,
  onClose,
  gymNombre,
  exportUrl,
  exportExpiraEn,
}) => {
  const { success, error } = useToast();
  const [copiado, setCopiado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCopiado(false);
      setConfirmado(false);
    }
  }, [isOpen]);

  const copiar = async () => {
    if (!exportUrl) return;
    try {
      await navigator.clipboard.writeText(exportUrl);
      setCopiado(true);
      success('Enlace copiado.');
    } catch {
      error('No se pudo copiar automáticamente. Selecciona el enlace y cópialo a mano.');
    }
  };

  // Sin enlace no hay nada que perder: se puede cerrar directo.
  const puedeCerrar = !exportUrl || confirmado;

  return (
    <Modal
      isOpen={isOpen}
      onClose={puedeCerrar ? onClose : () => undefined}
      title="Exportación de datos"
      description={`Gimnasio "${gymNombre}" cancelado.`}
      maxWidth="560px"
      footer={
        <Button variant="primary" onClick={onClose} disabled={!puedeCerrar}>
          {exportUrl ? 'Ya guardé el enlace' : 'Cerrar'}
        </Button>
      }
    >
      {exportUrl ? (
        <>
          <Alert
            type="warning"
            title="Este enlace se muestra una sola vez"
            message="Cópialo y envíalo al dueño del gimnasio. No se puede volver a generar ni consultar después de cerrar esta ventana."
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <TextInput value={exportUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="secondary"
              onClick={copiar}
              leftIcon={copiado ? <Check size={16} color="var(--color-success)" /> : <Copy size={16} />}
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
            Vence el <strong>{formatFechaHora(exportExpiraEn)}</strong> (hora de Bogotá). Después responde «enlace vencido».
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            Guardé el enlace en un lugar seguro.
          </label>
        </>
      ) : (
        <Alert
          type="warning"
          message="La API no devolvió enlace de exportación para esta cancelación. Revisa la auditoría del gimnasio o consulta al equipo de backend."
        />
      )}
    </Modal>
  );
};
