import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Eye, Scale, Edit2 } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input, SearchInput } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
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

const filaDato: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: '0.875rem' };

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
  const [showMedicionModal, setShowMedicionModal] = useState(false);
  const [medicion, setMedicion] = useState(MEDICION_VACIA);
  const [errorMedicion, setErrorMedicion] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const q = searchQuery.trim();

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
      setShowMedicionModal(false);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Deportistas</h1>
          <p className="page-subtitle">Registro, ficha 360°, consentimiento de datos y mediciones</p>
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
              header: 'Documento',
              accessor: (d) => formatDocumento(d.tipo_documento, d.documento),
              width: '150px',
            },
            {
              header: 'Nombre',
              render: (d) => (
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{d.nombre}</div>
                  {d.correo && <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>{d.correo}</div>}
                </div>
              ),
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

      {/* Ficha 360° */}
      <Modal
        isOpen={!!selectedDeportistaId}
        onClose={() => setSelectedDeportistaId(null)}
        title="Ficha del deportista"
        maxWidth="760px"
      >
        {errorFicha ? (
          <ErrorCarga
            error={errorFicha}
            onReintentar={() => selectedDeportistaId && cargarFicha(selectedDeportistaId)}
            textoNoEncontrado="Este deportista no existe o ya no está disponible."
          />
        ) : !ficha || !dep ? (
          <Cargando filas={5} />
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                paddingBottom: 16,
                borderBottom: '1px solid var(--border-color)',
                marginBottom: 16,
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {dep.nombre}
                  <EstadoDeportistaBadge
                    estado={dep.estado}
                    detalle={ficha.membresia_actual ? { dias: ficha.membresia_actual.dias_restantes } : {}}
                  />
                </h3>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{formatDocumento(dep.tipo_documento, dep.documento)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {puedeEditar && (
                  <Button variant="secondary" size="sm" leftIcon={<Edit2 size={14} />} onClick={() => abrirEditar(dep.id)}>
                    Editar datos
                  </Button>
                )}
                {puedeCrear && (
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Scale size={14} />}
                    onClick={() => {
                      setMedicion(MEDICION_VACIA);
                      setErrorMedicion(null);
                      setShowMedicionModal(true);
                    }}
                  >
                    Medición
                  </Button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 6 }}>Datos</h4>
                <div style={filaDato}>
                  <span style={{ color: 'var(--text-secondary)' }}>Tipo de documento</span>
                  <span>{dep.tipo_documento}</span>
                </div>
                <div style={filaDato}>
                  <span style={{ color: 'var(--text-secondary)' }}>Correo</span>
                  <span>{dep.correo || '—'}</span>
                </div>
                <div style={filaDato}>
                  <span style={{ color: 'var(--text-secondary)' }}>Teléfono</span>
                  <span>{dep.telefono || '—'}</span>
                </div>
                <div style={filaDato}>
                  <span style={{ color: 'var(--text-secondary)' }}>Fecha de nacimiento</span>
                  <span>{formatFechaNegocio(dep.fecha_nacimiento)}</span>
                </div>
                <div style={filaDato}>
                  <span style={{ color: 'var(--text-secondary)' }}>Consentimiento de datos</span>
                  <span>
                    {dep.consentimiento_1581 ? `Versión ${dep.consentimiento_version ?? '—'}` : 'No registrado'}
                  </span>
                </div>
                {dep.consentimiento_fecha && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                    Aceptado el {formatFechaHora(dep.consentimiento_fecha)}
                    {dep.consentimiento_registrado_por_nombre ? ` · registró ${dep.consentimiento_registrado_por_nombre}` : ''}
                  </div>
                )}
              </div>

              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 6 }}>Acudiente</h4>
                {dep.acudiente ? (
                  <>
                    <div style={filaDato}>
                      <span style={{ color: 'var(--text-secondary)' }}>Nombre</span>
                      <span>{dep.acudiente.nombre}</span>
                    </div>
                    <div style={filaDato}>
                      <span style={{ color: 'var(--text-secondary)' }}>Documento</span>
                      <span>{formatDocumento(dep.acudiente.tipo_documento, dep.acudiente.documento)}</span>
                    </div>
                    <div style={filaDato}>
                      <span style={{ color: 'var(--text-secondary)' }}>Teléfono</span>
                      <span>{dep.acudiente.telefono}</span>
                    </div>
                    <div style={filaDato}>
                      <span style={{ color: 'var(--text-secondary)' }}>Parentesco</span>
                      <span>{dep.acudiente.parentesco}</span>
                    </div>
                    <div style={filaDato}>
                      <span style={{ color: 'var(--text-secondary)' }}>Autorización</span>
                      <span>{dep.acudiente.autoriza ? 'Autorizó' : 'Sin autorización'}</span>
                    </div>
                  </>
                ) : dep.acudiente_nombre ? (
                  <div style={filaDato}>
                    <span style={{ color: 'var(--text-secondary)' }}>Nombre</span>
                    <span>{dep.acudiente_nombre}</span>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Sin acudiente registrado.</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8 }}>Membresía</h4>
              {ficha.membresia_actual ? (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{ficha.membresia_actual.plan_nombre}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
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
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No tiene una membresía vigente.</div>
              )}
            </div>

            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8 }}>Mediciones recientes</h4>
              {ficha.mediciones_recientes.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Aún no hay mediciones.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ficha.mediciones_recientes.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-elevated)',
                        fontSize: '0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{formatFechaNegocio(m.fecha)}</span>
                      <span>Peso: {m.peso ? `${m.peso} kg` : '—'}</span>
                      <span>Grasa: {m.grasa_pct ? `${m.grasa_pct} %` : '—'}</span>
                      <span>Músculo: {m.masa_muscular ? `${m.masa_muscular} kg` : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Registrar medición */}
      <Modal
        isOpen={showMedicionModal}
        onClose={() => !isProcessing && setShowMedicionModal(false)}
        title="Registrar medición"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowMedicionModal(false)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleRegistrarMedicion} isLoading={isProcessing}>
              Guardar medición
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {(Object.keys(MEDICION_VACIA) as Array<keyof typeof MEDICION_VACIA>).map((k) => (
            <Input
              key={k}
              id={`medicion-${k}`}
              label={ETIQUETAS_MEDICION[k]}
              type="number"
              min={0}
              step="0.1"
              value={medicion[k]}
              onChange={(e) => setMedicion((m) => ({ ...m, [k]: e.target.value }))}
            />
          ))}
        </div>
        {errorMedicion && <MensajeFijo tono="error">{errorMedicion}</MensajeFijo>}
      </Modal>
    </div>
  );
};
