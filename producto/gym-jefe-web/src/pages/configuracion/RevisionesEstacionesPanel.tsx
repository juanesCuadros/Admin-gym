import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCheck, ClipboardCheck } from 'lucide-react';
import { revisionesService } from '../../api/revisiones.service';
import { toApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Input';
import { Cargando, ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFechaHora } from '../../utils/formato';
import type { EstadoRevision, ListadoRevisiones, Revision } from '../../types/revisiones.types';

const NOTA_MINIMA = 4;

const TIPO: Record<string, string> = {
  ingreso: 'Ingreso de cliente',
  cortesia: 'Ingreso de cortesía',
  auditoria_estacion: 'Sesión en la estación',
};

/**
 * Lo que una estación registró sin red y el sistema marcó para que el Jefe lo mire (contrato E.5).
 * Nada de esto se deshace aquí: el ingreso ya ocurrió. El Jefe lo da por visto con una nota.
 */
export const RevisionesEstacionesPanel: React.FC<{ onPendientes: (n: number) => void }> = ({ onPendientes }) => {
  const { showToast } = useToast();
  const [estado, setEstado] = useState<EstadoRevision>('pendiente_revision');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<ListadoRevisiones | null>(null);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);

  const [aRevisar, setARevisar] = useState<Revision | null>(null);
  const [nota, setNota] = useState('');
  const [errorNota, setErrorNota] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      const r = await revisionesService.listar(estado, FILAS_POR_PAGINA, pagina * FILAS_POR_PAGINA);
      setDatos(r);
      onPendientes(r.pendientes);
    } catch (e) {
      setErrorCarga(e);
    }
  }, [estado, pagina, onPendientes]);

  useEffect(() => {
    setDatos(null);
    void cargar();
  }, [cargar]);

  const abrir = (r: Revision) => {
    setNota('');
    setErrorNota(null);
    setErrorEnvio(null);
    setARevisar(r);
  };

  const confirmar = async () => {
    if (!aRevisar) return;
    const limpia = nota.trim();
    if (limpia.length < NOTA_MINIMA) {
      setErrorNota(`Escribe una nota de al menos ${NOTA_MINIMA} letras.`);
      return;
    }
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      await revisionesService.darPorVisto(aRevisar.id, limpia);
      showToast('success', 'Revisión cerrada', 'Quedó en el historial con tu nota.');
      setARevisar(null);
      await cargar();
    } catch (err) {
      const api = toApiError(err);
      // Otra sesión del Jefe ya la cerró: se recarga para mostrar lo real.
      if (api.codigo === 'REVISION_YA_REVISADA') {
        setARevisar(null);
        showToast('warning', 'Ya estaba revisada', api.message);
        await cargar();
      } else if (api.campos.nota) {
        setErrorNota(api.campos.nota);
      } else {
        setErrorEnvio(api.message);
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / FILAS_POR_PAGINA)) : 1;
  const pendientes = estado === 'pendiente_revision';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['pendiente_revision', 'revisado'] as const).map((e) => (
          <Button
            key={e}
            size="sm"
            variant={estado === e ? 'primary' : 'outline'}
            onClick={() => {
              setEstado(e);
              setPagina(0);
            }}
          >
            {e === 'pendiente_revision' ? 'Pendientes' : 'Ya revisadas'}
          </Button>
        ))}
      </div>

      {errorCarga ? (
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      ) : !datos ? (
        <Cargando />
      ) : datos.items.length === 0 ? (
        <VacioInicial
          icono={<ClipboardCheck size={40} />}
          titulo={pendientes ? 'No hay nada por revisar' : 'Aún no has revisado nada'}
          descripcion={
            pendientes
              ? 'Aquí aparece lo que una estación registró sin internet y no coincide con el sistema: por ejemplo, alguien que entró con la membresía cancelada.'
              : 'Lo que des por visto queda aquí con tu nota.'
          }
        />
      ) : (
        <Card>
          <div className="table-responsive">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Cuándo ocurrió</th>
                  <th>Qué</th>
                  <th>Motivo</th>
                  <th>Estación</th>
                  <th>{pendientes ? '' : 'Revisión'}</th>
                </tr>
              </thead>
              <tbody>
                {datos.items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatFechaHora(r.ocurrida_en)}</td>
                    <td>
                      {TIPO[r.tipo_operacion] ?? r.tipo_operacion}
                      {r.registrado_por_nombre && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Registró {r.registrado_por_nombre}</div>
                      )}
                    </td>
                    <td style={{ maxWidth: 420 }}>{r.motivo}</td>
                    <td>
                      {r.estacion_nombre}
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Llegó el {formatFechaHora(r.recibida_en)}</div>
                    </td>
                    <td style={{ textAlign: pendientes ? 'right' : 'left' }}>
                      {r.estado_revision === 'pendiente_revision' ? (
                        r.resoluciones_posibles.includes('visto') ? (
                          <Button variant="outline" size="sm" leftIcon={<CheckCheck size={14} />} onClick={() => abrir(r)}>
                            Dar por visto
                          </Button>
                        ) : (
                          <Badge variant="warning">Pendiente</Badge>
                        )
                      ) : (
                        <>
                          <div>{r.nota_revision}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {r.revisado_por_nombre ?? 'Jefe'} · {formatFechaHora(r.revisado_en)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {datos.total > FILAS_POR_PAGINA && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {datos.total} registros · página {pagina + 1} de {totalPaginas}
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
          )}
        </Card>
      )}

      <Modal
        isOpen={aRevisar !== null}
        onClose={enviando ? () => undefined : () => setARevisar(null)}
        title="Dar por visto"
        maxWidth="500px"
        footer={
          <>
            <Button variant="outline" disabled={enviando} onClick={() => setARevisar(null)}>
              Cancelar
            </Button>
            <Button isLoading={enviando} onClick={() => void confirmar()}>
              Dar por visto
            </Button>
          </>
        }
      >
        {aRevisar && (
          <>
            <p style={{ margin: '0 0 6px', fontSize: '0.925rem', lineHeight: 1.5 }}>{aRevisar.motivo}</p>
            <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Esto no cambia el registro: el ingreso ya ocurrió. Solo deja constancia de que lo revisaste. Se hace una sola vez.
            </p>
            {errorEnvio && (
              <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
                {errorEnvio}
              </MensajeFijo>
            )}
            <Textarea
              label="Nota"
              value={nota}
              maxLength={500}
              onChange={(e) => {
                setNota(e.target.value);
                setErrorNota(null);
              }}
              error={errorNota ?? undefined}
              disabled={enviando}
            />
          </>
        )}
      </Modal>
    </div>
  );
};
