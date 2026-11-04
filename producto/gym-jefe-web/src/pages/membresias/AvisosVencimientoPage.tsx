import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MessageCircle } from 'lucide-react';
import { membresiasService } from '../../api/membresias.service';
import { parseApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/Input';
import { Table } from '../../components/ui/Table';
import { ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { formatFechaHora } from '../../utils/formato';
import { enlaceWhatsApp } from '../../utils/compartirRutina';
import { formatFechaNegocio } from '../../utils/fechasBogota';
import type { AvisoVencimiento } from '../../types/membresias.types';

const POR_PAGINA = 20;

function mensaje(a: AvisoVencimiento, gimnasio: string): string {
  const primerNombre = a.deportista_nombre.trim().split(/\s+/)[0];
  const fecha = formatFechaNegocio(a.fecha_vencimiento);
  return a.situacion === 'en_gracia'
    ? `Hola ${primerNombre}, tu plan ${a.plan_nombre} en ${gimnasio} venció el ${fecha}. Te esperamos para renovarlo y seguir entrenando.`
    : `Hola ${primerNombre}, tu plan ${a.plan_nombre} en ${gimnasio} vence el ${fecha}. Te esperamos para renovarlo y seguir entrenando.`;
}

/**
 * Avisos de vencimiento (decisión de Juan del 27-oct-2026): sin automatizar. Recepción ve la lista,
 * el botón abre WhatsApp desde su propio número con el mensaje armado y queda marcado a quién se le avisó.
 */
export const AvisosVencimientoPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { tenant } = useTenantTheme();
  const { showToast } = useToast();
  const puedeAvisar = hasPermission('membresias', 'crear');

  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<AvisoVencimiento[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await membresiasService.getAvisosVencimiento({
        q: buscar.trim() || undefined,
        limit: POR_PAGINA,
        offset: (pagina - 1) * POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [buscar, pagina]);

  useEffect(() => {
    const t = window.setTimeout(cargar, 250);
    return () => window.clearTimeout(t);
  }, [cargar]);

  const avisar = async (a: AvisoVencimiento) => {
    // WhatsApp se abre primero: abrir una ventana después de esperar la red lo bloquean los navegadores.
    window.open(enlaceWhatsApp(mensaje(a, tenant.nombre), a.deportista_telefono), '_blank', 'noopener');
    try {
      await membresiasService.registrarAviso(a.membresia_id);
      cargar();
    } catch (e) {
      showToast('error', 'No se marcó el aviso', parseApiError(e));
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Avisos de vencimiento</h1>
          <p className="page-subtitle">Quiénes están por vencer o en gracia, para avisarles por WhatsApp</p>
        </div>
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <SearchInput
          placeholder="Buscar por nombre o documento"
          aria-label="Buscar deportista"
          value={buscar}
          onChange={(e) => {
            setBuscar(e.target.value);
            setPagina(1);
          }}
        />
      </div>

      {error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : (
        <Card>
          <Table<AvisoVencimiento>
            columns={[
              {
                header: 'Deportista',
                render: (a) => (
                  <div>
                    <div style={{ fontWeight: 500 }}>{a.deportista_nombre}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{a.deportista_telefono || 'Sin teléfono'}</div>
                  </div>
                ),
              },
              { header: 'Plan', accessor: (a) => a.plan_nombre },
              {
                header: 'Vence',
                render: (a) => (
                  <div>
                    <div>{formatFechaNegocio(a.fecha_vencimiento)}</div>
                    <Badge variant={a.situacion === 'en_gracia' ? 'danger' : 'warning'}>
                      {a.situacion === 'en_gracia'
                        ? `En gracia · venció hace ${Math.abs(a.dias)} día(s)`
                        : a.dias === 0
                          ? 'Vence hoy'
                          : `Faltan ${a.dias} día(s)`}
                    </Badge>
                  </div>
                ),
              },
              {
                header: 'Aviso',
                render: (a) =>
                  a.ultimo_aviso_en ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
                      <CheckCircle2 size={15} color="var(--success)" />
                      {formatFechaHora(a.ultimo_aviso_en)}
                      {a.ultimo_aviso_por ? ` · ${a.ultimo_aviso_por}` : ''}
                    </span>
                  ) : (
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Sin avisar</span>
                  ),
              },
              {
                header: '',
                align: 'right',
                render: (a) =>
                  puedeAvisar && (
                    <Button
                      variant={a.ultimo_aviso_en ? 'ghost' : 'secondary'}
                      size="sm"
                      leftIcon={<MessageCircle size={14} />}
                      disabled={!a.deportista_telefono}
                      onClick={() => avisar(a)}
                    >
                      {a.ultimo_aviso_en ? 'Avisar de nuevo' : 'Avisar'}
                    </Button>
                  ),
              },
            ]}
            data={items}
            isLoading={cargando}
            keyExtractor={(a) => a.membresia_id}
            emptyMessage={buscar.trim() ? 'Nadie coincide con la búsqueda.' : 'Nadie está por vencer ni en gracia.'}
            pagination={{ currentPage: pagina, totalPages: Math.max(1, Math.ceil(total / POR_PAGINA)), onPageChange: setPagina }}
          />
        </Card>
      )}

      {!cargando && !error && items.some((a) => !a.deportista_telefono) && (
        <MensajeFijo tono="info" style={{ marginTop: 16 }}>
          Quien no tiene teléfono no se puede avisar por WhatsApp. Agrégalo en su ficha de Deportistas.
        </MensajeFijo>
      )}
    </div>
  );
};
