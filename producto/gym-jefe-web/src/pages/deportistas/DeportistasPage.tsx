import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserPlus, Eye, Scale, Edit2, Plus } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input, SearchInput } from '../../components/ui/Input';
import { Drawer } from '../../components/ui/Drawer';
import { Avatar } from '../../components/ui/Avatar';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, MensajeFijo, VacioFiltro, VacioInicial } from '../../components/estados/Estados';
import { EstadoDeportistaBadge } from '../../components/ui/EstadoDeportistaBadge';
import { FILAS_POR_PAGINA, formatDocumento, formatFechaHora, formatVencimiento } from '../../utils/formato';
import { formatFechaNegocio, hoyBogota } from '../../utils/fechasBogota';
import {
  DeportistaResumenResponse,
  FichaDeportistaResponse,
  RegistrarMedicionRequest,
  DeportistaResponse,
} from '../../types/deportistas.types';
import { FormularioDeportista } from './FormularioDeportista';

/** Días de `desde` a `hasta` (fechas de negocio `YYYY-MM-DD`), sin pasar por la zona del navegador. */
function diasEntre(desde: string, hasta: string): number {
  const utc = (f: string) => {
    const [a, m, d] = f.slice(0, 10).split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86400000);
}

const MEDICION_VACIA: Record<keyof Omit<RegistrarMedicionRequest, 'fecha'>, string> = {
  peso: '',
  grasa_pct: '',
  masa_muscular: '',
  cintura: '',
  cadera: '',
  brazo: '',
  pierna: '',
  pecho: '',
};

const ETIQUETAS_MEDICION: Record<keyof typeof MEDICION_VACIA, string> = {
  peso: 'Peso (kg)',
  grasa_pct: '% grasa',
  masa_muscular: 'Músculo (kg)',
  cintura: 'Cintura (cm)',
  cadera: 'Cadera (cm)',
  brazo: 'Brazo (cm)',
  pierna: 'Pierna (cm)',
  pecho: 'Pecho (cm)',
};

/** Fila etiqueta / valor de la ficha. */
const Dato: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => (
  <div className="dato-fila">
    <span>{etiqueta}</span>
    <span>{children}</span>
  </div>
);

const numero = (n: number | null | undefined, unidad: string) => (n === null || n === undefined ? '—' : `${n} ${unidad}`);

export const DeportistasPage: React.FC = () => {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const puedeCrear = hasPermission('deportistas', 'crear');
  const puedeEditar = hasPermission('deportistas', 'editar');

  // Listado
  const [deportistas, setDeportistas] = useState<DeportistaResumenResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorLista, setErrorLista] = useState<unknown>(null);

  // Formulario (crear o editar)
  const [formAbierto, setFormAbierto] = useState(false);
  const [editando, setEditando] = useState<DeportistaResponse | null>(null);

  // Ficha 360°
  const [selectedDeportistaId, setSelectedDeportistaId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaDeportistaResponse | null>(null);
  const [errorFicha, setErrorFicha] = useState<unknown>(null);

  // Medición
  const [medicionAbierta, setMedicionAbierta] = useState(false);
  const medicionRef = useRef<HTMLDivElement>(null);
  const [medicion, setMedicion] = useState(MEDICION_VACIA);
  const [errorMedicion, setErrorMedicion] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const q = searchQuery.trim();

  // Al abrir el formulario de medición dentro de la ficha, se lleva a la vista y se enfoca el primer campo.
  useEffect(() => {
    if (!medicionAbierta) return;
    const t = window.setTimeout(() => {
      medicionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      medicionRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [medicionAbierta]);

  const loadDeportistas = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await deportistasService.getDeportistas({
        skip: (page - 1) * FILAS_POR_PAGINA,
        limit: FILAS_POR_PAGINA,
        q: q.length >= 2 ? q : undefined,
      });
      setDeportistas(res.items);
      setTotal(res.total);
      setErrorLista(null);
    } catch (e) {
      setErrorLista(e);
    } finally {
      setIsLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    loadDeportistas();
  }, [loadDeportistas]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const cargarFicha = useCallback(async (id: string): Promise<FichaDeportistaResponse | null> => {
    setErrorFicha(null);
    try {
      const data = await deportistasService.getFicha(id);
      setFicha(data);
      return data;
    } catch (err) {
      setErrorFicha(err);
      return null;
    }
  }, []);

  const handleOpenFicha = (id: string) => {
    setFicha(null);
    setMedicionAbierta(false);
    setSelectedDeportistaId(id);
    cargarFicha(id);
  };

  const abrirCrear = () => {
    setEditando(null);
    setFormAbierto(true);
  };

  /** La edición siempre parte del registro completo y su versión actual (no del resumen del listado). */
  const abrirEditar = async (id: string) => {
    const data = ficha?.deportista.id === id ? ficha : await cargarFicha(id);
    if (!data) {
      showToast('error', 'No se pudo abrir la edición', 'Reintenta en unos segundos.');
      return;
    }
    setEditando(data.deportista);
    setFormAbierto(true);
  };

  const trasGuardar = (d: DeportistaResponse) => {
    const eraEdicion = !!editando;
    setFormAbierto(false);
    setEditando(null);
    showToast('success', eraEdicion ? 'Deportista actualizado' : 'Deportista registrado', d.nombre);
    loadDeportistas();
    if (selectedDeportistaId === d.id) cargarFicha(d.id);
  };

  const recargarEdicion = async () => {
    if (!editando) return;
    const data = await cargarFicha(editando.id);
    if (data) setEditando(data.deportista);
  };

  const handleRegistrarMedicion = async () => {
    if (!selectedDeportistaId || isProcessing) return;
    const data: RegistrarMedicionRequest = {};
    for (const [k, val] of Object.entries(medicion)) {
      if (val.trim() !== '') (data as Record<string, number>)[k] = Number(val);
    }
    if (Object.keys(data).length === 0) {
      setErrorMedicion('Escribe al menos una medida.');
      return;
    }
    setIsProcessing(true);
    setErrorMedicion(null);
    try {
      await deportistasService.registrarMedicion(selectedDeportistaId, data);
      showToast('success', 'Medición guardada', 'Quedó en la ficha del deportista.');
      setMedicionAbierta(false);
      setMedicion(MEDICION_VACIA);
      cargarFicha(selectedDeportistaId);
    } catch (err) {
      setErrorMedicion(parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const detalleEstado = (d: DeportistaResumenResponse) =>
    d.fecha_vencimiento ? { dias: diasEntre(hoyBogota(), d.fecha_vencimiento) } : {};

  const dep = ficha?.deportista;

  const abrirMedicion = () => {
    setMedicion(MEDICION_VACIA);
    setErrorMedicion(null);
    setMedicionAbierta(true);
  };

  const cerrarFicha = () => {
    if (isProcessing) return;
    setSelectedDeportistaId(null);
    setMedicionAbierta(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Deportistas</h1>
          <p className="page-subtitle">Registro, ficha y mediciones</p>
        </div>
        {puedeCrear && (
          <Button variant="primary" leftIcon={<UserPlus size={16} />} onClick={abrirCrear}>
            Registrar deportista
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 420 }}>
        <SearchInput
          placeholder="Buscar por nombre o documento"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Buscar deportista"
        />
      </div>

      {errorLista ? (
        <ErrorCarga error={errorLista} onReintentar={loadDeportistas} />
      ) : !isLoading && total === 0 && q.length >= 2 ? (
        <VacioFiltro onLimpiar={() => setSearchQuery('')} mensaje="Ningún deportista coincide con la búsqueda." />
      ) : !isLoading && total === 0 ? (
        <VacioInicial
          titulo="Aún no hay deportistas"
          descripcion="Registra a tus clientes con su documento y la autorización de tratamiento de datos."
          textoAccion={puedeCrear ? 'Registrar deportista' : undefined}
          onAccion={puedeCrear ? abrirCrear : undefined}
        />
      ) : (
        <Table<DeportistaResumenResponse>
          columns={[
            {
              header: 'Nombre',
              render: (d) => (
                <div>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{d.nombre}</div>
                  {d.correo && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{d.correo}</div>}
                </div>
              ),
            },
            {
              header: 'Documento',
              accessor: (d) => formatDocumento(d.tipo_documento, d.documento),
              width: '150px',
            },
            { header: 'Teléfono', accessor: (d) => d.telefono || '—', width: '130px' },
            { header: 'Plan', accessor: (d) => d.plan_nombre || 'Sin plan' },
            {
              header: 'Estado',
              render: (d) => <EstadoDeportistaBadge estado={d.estado} detalle={detalleEstado(d)} />,
              width: '170px',
            },
            { header: 'Vencimiento', accessor: (d) => formatFechaNegocio(d.fecha_vencimiento), width: '120px' },
            {
              header: '',
              align: 'right',
              width: '190px',
              render: (d) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {puedeEditar && (
                    <Button variant="ghost" size="sm" leftIcon={<Edit2 size={13} />} onClick={() => abrirEditar(d.id)}>
                      Editar
                    </Button>
                  )}
                  <Button variant="outline" size="sm" leftIcon={<Eye size={13} />} onClick={() => handleOpenFicha(d.id)}>
                    Ficha
                  </Button>
                </div>
              ),
            },
          ]}
          data={deportistas}
          isLoading={isLoading}
          keyExtractor={(d) => d.id}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil(total / FILAS_POR_PAGINA) || 1,
            onPageChange: (p) => setPage(p),
          }}
          emptyMessage="No hay deportistas en esta página."
        />
      )}

      <FormularioDeportista
        isOpen={formAbierto}
        inicial={editando}
        onCerrar={() => {
          setFormAbierto(false);
          setEditando(null);
        }}
        onGuardado={trasGuardar}
        onRecargar={recargarEdicion}
      />

      {/* Ficha 360° en panel lateral */}
      <Drawer
        isOpen={!!selectedDeportistaId}
        onClose={cerrarFicha}
        title="Ficha del deportista"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={cerrarFicha}>
              Cerrar
            </Button>
            {puedeEditar && dep && (
              <Button variant="primary" leftIcon={<Edit2 size={15} />} onClick={() => abrirEditar(dep.id)}>
                Editar datos
              </Button>
            )}
          </>
        }
      >
        {errorFicha ? (
          <div>
            <ErrorCarga
              error={errorFicha}
              onReintentar={() => selectedDeportistaId && cargarFicha(selectedDeportistaId)}
              textoNoEncontrado="Este deportista no existe o ya no está disponible."
            />
          </div>
        ) : !ficha || !dep ? (
          <div>
            <Cargando filas={6} />
          </div>
        ) : (
          <>
            {/* Encabezado */}
            <div className="ficha-perfil">
              <Avatar name={dep.nombre} size="lg" />
              <div className="ficha-perfil-text">
                <div className="ficha-nombre">{dep.nombre}</div>
                <div className="ficha-doc">{formatDocumento(dep.tipo_documento, dep.documento)}</div>
                <EstadoDeportistaBadge
                  estado={dep.estado}
                  detalle={ficha.membresia_actual ? { dias: ficha.membresia_actual.dias_restantes } : {}}
                />
              </div>
            </div>

            {/* Membresía */}
            <section className="form-section">
              <div className="form-section-head">
                <div className="form-section-title">Membresía</div>
              </div>
              {ficha.membresia_actual ? (
                <div className="membresia-card">
                  <div style={{ minWidth: 0 }}>
                    <div className="membresia-plan">{ficha.membresia_actual.plan_nombre}</div>
                    {ficha.membresia_actual.paquete_id && (
                      <div className="membresia-meta">
                        Plan grupal{ficha.membresia_actual.titular_nombre ? ` · titular ${ficha.membresia_actual.titular_nombre}` : ''}
                      </div>
                    )}
                    <div className="membresia-meta">
                      {formatVencimiento(
                        `${ficha.membresia_actual.fecha_vencimiento}T12:00:00-05:00`,
                        ficha.membresia_actual.dias_restantes
                      )}
                    </div>
                  </div>
                  <EstadoDeportistaBadge
                    estado={ficha.membresia_actual.estado}
                    detalle={{ dias: ficha.membresia_actual.dias_restantes }}
                  />
                </div>
              ) : (
                <p className="texto-vacio">No tiene una membresía vigente.</p>
              )}
            </section>

            {/* Datos */}
            <section className="form-section">
              <div className="form-section-head">
                <div className="form-section-title">Datos</div>
              </div>
              <div className="dato-lista">
                <Dato etiqueta="Tipo de documento">{dep.tipo_documento}</Dato>
                <Dato etiqueta="Correo">{dep.correo || '—'}</Dato>
                <Dato etiqueta="Teléfono">{dep.telefono || '—'}</Dato>
                <Dato etiqueta="Fecha de nacimiento">{formatFechaNegocio(dep.fecha_nacimiento)}</Dato>
                <Dato etiqueta="Consentimiento de datos">
                  {dep.consentimiento_1581 ? `Versión ${dep.consentimiento_version ?? '—'}` : 'No registrado'}
                </Dato>
                {dep.consentimiento_fecha && (
                  <div className="dato-nota">
                    Aceptado el {formatFechaHora(dep.consentimiento_fecha)}
                    {dep.consentimiento_registrado_por_nombre ? ` · registró ${dep.consentimiento_registrado_por_nombre}` : ''}
                  </div>
                )}
              </div>
            </section>

            {/* Acudiente */}
            <section className="form-section">
              <div className="form-section-head">
                <div className="form-section-title">Acudiente</div>
              </div>
              {dep.acudiente ? (
                <div className="dato-lista">
                  <Dato etiqueta="Nombre">{dep.acudiente.nombre}</Dato>
                  <Dato etiqueta="Documento">{formatDocumento(dep.acudiente.tipo_documento, dep.acudiente.documento)}</Dato>
                  <Dato etiqueta="Teléfono">{dep.acudiente.telefono}</Dato>
                  <Dato etiqueta="Parentesco">{dep.acudiente.parentesco}</Dato>
                  <Dato etiqueta="Autorización">{dep.acudiente.autoriza ? 'Autorizó' : 'Sin autorización'}</Dato>
                </div>
              ) : dep.acudiente_nombre ? (
                <div className="dato-lista">
                  <Dato etiqueta="Nombre">{dep.acudiente_nombre}</Dato>
                </div>
              ) : (
                <p className="texto-vacio">Sin acudiente registrado.</p>
              )}
            </section>

            {/* Mediciones */}
            <section className="form-section">
              <div className="form-section-head">
                <div className="form-section-title">Mediciones recientes</div>
                {puedeCrear && !medicionAbierta && (
                  <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={abrirMedicion}>
                    Registrar medición
                  </Button>
                )}
              </div>

              {medicionAbierta && (
                <div className="form-callout" ref={medicionRef} style={{ marginTop: 0, marginBottom: 16 }}>
                  <div className="form-callout-head">
                    <Scale size={16} />
                    <span>Nueva medición · {formatFechaNegocio(hoyBogota())}</span>
                  </div>
                  <div className="form-grid form-grid-movil-2">
                    {(Object.keys(MEDICION_VACIA) as Array<keyof typeof MEDICION_VACIA>).map((k) => (
                      <div className="col-2" key={k}>
                        <Input
                          id={`medicion-${k}`}
                          label={ETIQUETAS_MEDICION[k]}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.1"
                          value={medicion[k]}
                          onChange={(e) => setMedicion((m) => ({ ...m, [k]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  {errorMedicion && (
                    <MensajeFijo tono="error" style={{ marginTop: 12 }}>
                      {errorMedicion}
                    </MensajeFijo>
                  )}
                  <div className="form-callout-actions">
                    <Button variant="secondary" size="sm" onClick={() => setMedicionAbierta(false)} disabled={isProcessing}>
                      Cancelar
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleRegistrarMedicion} isLoading={isProcessing}>
                      Guardar medición
                    </Button>
                  </div>
                </div>
              )}

              {ficha.mediciones_recientes.length === 0 ? (
                !medicionAbierta && <p className="texto-vacio">Aún no hay mediciones.</p>
              ) : (
                <div className="table-responsive">
                  <table className="mini-tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Peso</th>
                        <th>Grasa</th>
                        <th>Músculo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.mediciones_recientes.map((m) => (
                        <tr key={m.id}>
                          <td>{formatFechaNegocio(m.fecha)}</td>
                          <td>{numero(m.peso, 'kg')}</td>
                          <td>{numero(m.grasa_pct, '%')}</td>
                          <td>{numero(m.masa_muscular, 'kg')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </Drawer>
    </div>
  );
};
