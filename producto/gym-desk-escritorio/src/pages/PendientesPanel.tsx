import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Button } from '@web/components/ui/Button';
import { useToast } from '@web/contexts/ToastContext';
import { FILAS_POR_PAGINA, formatFechaHora } from '@web/utils/formato';
import { estacionService } from '../api/estacion.service';
import { aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import type { EstadoEstacion, EstadoOperacion, ItemCola, PaginaCola } from '../types/estacion.types';

const ESTADO: Record<EstadoOperacion, { texto: string; variante: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pendiente: { texto: 'Por subir', variante: 'neutral' },
  enviando: { texto: 'Subiendo', variante: 'info' },
  retenida: { texto: 'En espera', variante: 'neutral' },
  aplicada: { texto: 'Subida', variante: 'success' },
  pendiente_revision: { texto: 'Por revisar', variante: 'warning' },
  error: { texto: 'Con error', variante: 'danger' },
};

const ACCION: Record<string, string> = {
  CREAR_BASE_LOCAL: 'Instalación de la estación',
  ACTIVAR_ESTACION: 'Activación de la estación',
  INICIAR_SESION: 'Inicio de sesión',
  INGRESO_FALLIDO: 'Intento de ingreso fallido',
  BLOQUEAR_SESION: 'Bloqueo de pantalla',
  DESBLOQUEAR_SESION: 'Desbloqueo de pantalla',
  CERRAR_SESION: 'Cierre de sesión',
  CREAR_PIN: 'Creación de PIN',
  CAMBIAR_PIN: 'Cambio de PIN',
  INVALIDAR_CREDENCIAL: 'Credencial invalidada',
};

const TIPO: Record<string, string> = {
  ingreso: 'Ingreso de cliente',
  cortesia: 'Ingreso de cortesía',
};

function nota(item: ItemCola): string {
  if (item.estado === 'pendiente') return item.intentos > 0 ? 'Se volverá a intentar cuando haya conexión.' : 'Sube sola cuando haya conexión.';
  if (item.estado === 'retenida') return item.mensaje ?? 'Espera a que se resuelva otra operación.';
  if (item.estado === 'pendiente_revision') return item.mensaje ?? 'El Jefe debe revisarla en el sistema web.';
  if (item.estado === 'error') return item.mensaje ?? 'El servidor no la aceptó.';
  return '';
}

/**
 * Lo que esta estación hizo y aún no está resuelto en el servidor: por subir, con error y por
 * revisar. Nada de esta lista se borra; lo ya subido se consulta en el historial.
 */
export const PendientesPanel: React.FC<{ estacion: EstadoEstacion; onCerrar: () => void }> = ({ estacion, onCerrar }) => {
  const { sincronizarAhora } = useSesion();
  const { showToast } = useToast();
  const [historial, setHistorial] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<PaginaCola | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await estacionService.colaPendientes(historial, FILAS_POR_PAGINA, pagina * FILAS_POR_PAGINA));
      setError(null);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  }, [historial, pagina]);

  // Se recarga al cambiar el filtro o la página, y cada vez que la cola se mueve.
  const { por_enviar, con_error, por_revisar, aplicadas } = estacion.cola;
  useEffect(() => {
    void cargar();
  }, [cargar, por_enviar, con_error, por_revisar, aplicadas]);

  const accion = async (clave: string, tarea: () => Promise<void>, exito: string) => {
    if (ocupado) return;
    setOcupado(clave);
    try {
      await tarea();
      showToast('success', exito);
      await cargar();
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    } finally {
      setOcupado(null);
    }
  };

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / FILAS_POR_PAGINA)) : 1;

  return (
    <section className="gd-panel">
      <div className="gd-panel-encabezado">
        <div>
          <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>
            {historial ? 'Historial de sincronización' : 'Pendientes de sincronizar'}
          </h2>
          <p className="gd-subtitulo" style={{ margin: 0 }}>
            Lo que haces aquí se guarda en este equipo y sube solo al servidor. Nada se borra.
          </p>
        </div>
        <div className="gd-panel-acciones">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw size={15} />}
            isLoading={ocupado === 'sync' || estacion.sincronizando}
            onClick={() => void accion('sync', sincronizarAhora, 'Sincronización iniciada')}
          >
            Sincronizar ahora
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setHistorial(!historial);
              setPagina(0);
            }}
          >
            {historial ? 'Ver solo pendientes' : 'Ver historial'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<X size={15} />} onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>

      {con_error > 0 && (
        <MensajeError>
          {con_error === 1 ? 'Hay 1 operación que el servidor no aceptó.' : `Hay ${con_error} operaciones que el servidor no aceptó.`}{' '}
          Siguen guardadas en este equipo. Avisa a soporte; después de actualizar GymDesk puedes reintentarlas.
        </MensajeError>
      )}
      {error && <MensajeError>{error}</MensajeError>}

      {!datos && !error && <div className="skeleton" style={{ height: 180, borderRadius: 10, marginTop: 12 }} aria-busy="true" />}

      {datos && datos.items.length === 0 && (
        <div className="gd-vacio">
          <CheckCircle2 size={28} color="var(--success)" />
          <p style={{ margin: '8px 0 0' }}>{historial ? 'Esta estación aún no ha registrado nada.' : 'Todo está al día: no hay nada pendiente.'}</p>
        </div>
      )}

      {datos && datos.items.length > 0 && (
        <>
          <table className="gd-tabla" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Qué</th>
                <th>Quién</th>
                <th>Estado</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.items.map((item) => (
                <tr key={item.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatFechaHora(item.ocurrida_en)}</td>
                  <td>{(item.accion && ACCION[item.accion]) ?? item.accion ?? TIPO[item.tipo] ?? item.tipo}</td>
                  <td>{item.staff_nombre ?? '—'}</td>
                  <td>
                    <Badge variant={ESTADO[item.estado].variante}>{ESTADO[item.estado].texto}</Badge>
                  </td>
                  <td className="gd-nota">{nota(item)}</td>
                  <td>
                    {item.estado === 'error' && (
                      <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<RotateCcw size={14} />}
                        isLoading={ocupado === item.id}
                        disabled={ocupado !== null}
                        onClick={() => void accion(item.id, () => estacionService.reintentarOperacion(item.id), 'Se volverá a enviar')}
                      >
                        Reintentar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gd-paginacion">
            <span>
              {datos.total} {datos.total === 1 ? 'registro' : 'registros'} · página {pagina + 1} de {totalPaginas}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina(pagina + 1)}>
                Siguiente
              </Button>
            </span>
          </div>
        </>
      )}
    </section>
  );
};
