import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw, Users } from 'lucide-react';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table } from '../../components/ui/Table';
import { ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { formatHora } from '../../utils/formato';
import { formatPermanencia, MENSAJE_SIN_INGRESO_ABIERTO } from './formatoIngreso';
import type { DeportistaAdentroItemDto } from '../../types/controlIngreso.types';

interface PanelAdentroProps {
  /** Cambia cada vez que el padre registra un ingreso: el panel se recarga. */
  recargar?: number;
  /** Avisa al padre que se registró una salida (para refrescar métricas o historial). */
  onSalida?: () => void;
}

/**
 * Panel "Adentro ahora" (contrato 2.2, GW-RF-54): personas con ingreso abierto hoy y botón para
 * marcar su salida. `409 SIN_INGRESO_ABIERTO` se muestra con el mensaje fijo del contrato.
 */
export const PanelAdentro: React.FC<PanelAdentroProps> = ({ recargar = 0, onSalida }) => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeMarcar = hasPermission('control_ingreso', 'crear');

  const [items, setItems] = useState<DeportistaAdentroItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [errorSalida, setErrorSalida] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await controlIngresoService.getAdentro();
      setItems(res.items);
      setTotal(res.total);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, recargar]);

  const marcarSalida = async (item: DeportistaAdentroItemDto) => {
    if (marcando) return;
    setMarcando(item.deportista_id);
    setErrorSalida(null);
    try {
      const res = await controlIngresoService.registrarSalida({ deportista_id: item.deportista_id });
      showToast(
        'success',
        'Salida registrada',
        `${res.deportista_nombre} · permanencia ${formatPermanencia(res.permanencia_minutos)}`
      );
      onSalida?.();
    } catch (e) {
      const err = toApiError(e);
      setErrorSalida(err.codigo === 'SIN_INGRESO_ABIERTO' ? MENSAJE_SIN_INGRESO_ABIERTO : err.message);
    } finally {
      setMarcando(null);
      cargar();
    }
  };

  return (
    <Card
      title={`Adentro ahora${cargando ? '' : ` · ${total}`}`}
      action={
        <Button variant="ghost" size="sm" leftIcon={<RefreshCw size={14} />} onClick={cargar} disabled={cargando}>
          Actualizar
        </Button>
      }
    >
      {errorSalida && (
        <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
          {errorSalida}
        </MensajeFijo>
      )}
      {errorCarga ? (
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      ) : !cargando && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-secondary)' }}>
          <Users size={28} color="var(--text-muted)" style={{ marginBottom: 6 }} />
          <div>No hay personas adentro en este momento.</div>
        </div>
      ) : (
        <Table<DeportistaAdentroItemDto>
          columns={[
            {
              header: 'Persona',
              render: (i) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{i.nombre}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{i.documento}</div>
                </div>
              ),
            },
            { header: 'Ingreso', accessor: (i) => formatHora(i.ingreso_ts), width: '90px' },
            { header: 'Lleva', accessor: (i) => formatPermanencia(i.minutos_adentro), width: '110px' },
            {
              header: '',
              align: 'right',
              width: '150px',
              render: (i) =>
                puedeMarcar ? (
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<LogOut size={14} />}
                    isLoading={marcando === i.deportista_id}
                    disabled={!!marcando}
                    onClick={() => marcarSalida(i)}
                  >
                    Marcar salida
                  </Button>
                ) : null,
            },
          ]}
          data={items}
          isLoading={cargando}
          keyExtractor={(i) => i.checkin_id}
          emptyMessage="No hay personas adentro en este momento."
        />
      )}
    </Card>
  );
};
