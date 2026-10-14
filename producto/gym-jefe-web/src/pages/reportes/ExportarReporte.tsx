import React, { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { reportesService } from '../../api/reportes.service';
import { toApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../../components/ui/Button';
import { descargarBlob } from '../../utils/navegador';
import { hoyBogota } from '../../utils/fechasBogota';
import type { FormatoExportar, ParametrosExportar } from '../../types/reportes.types';

/**
 * Botones "Exportar CSV" y "Exportar Excel" (GW-RF-44). Exportan exactamente los filtros aplicados en la vista
 * con `GET /reportes/exportar` (CSV en UTF-8 con BOM para que Excel muestre bien las tildes).
 */
export const ExportarReporte: React.FC<{
  parametros: Omit<ParametrosExportar, 'formato'>;
  disabled?: boolean;
}> = ({ parametros, disabled = false }) => {
  const { showToast } = useToast();
  const [exportando, setExportando] = useState<FormatoExportar | null>(null);

  const exportar = async (formato: FormatoExportar) => {
    if (exportando) return;
    setExportando(formato);
    try {
      const { blob, nombre } = await reportesService.exportar({ ...parametros, formato });
      const extension = formato === 'csv' ? 'csv' : 'xlsx';
      descargarBlob(blob, nombre ?? `reporte_${parametros.tipo_reporte}_${hoyBogota()}.${extension}`);
    } catch (e) {
      showToast('error', 'No se pudo exportar', toApiError(e).message);
    } finally {
      setExportando(null);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button
        variant="outline"
        size="sm"
        leftIcon={<FileText size={14} />}
        onClick={() => exportar('csv')}
        isLoading={exportando === 'csv'}
        disabled={disabled || exportando !== null}
      >
        Exportar CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        leftIcon={<FileSpreadsheet size={14} />}
        onClick={() => exportar('excel')}
        isLoading={exportando === 'excel'}
        disabled={disabled || exportando !== null}
      >
        Exportar Excel
      </Button>
    </div>
  );
};
