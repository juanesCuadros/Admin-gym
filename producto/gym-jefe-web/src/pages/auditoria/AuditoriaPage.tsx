import React, { useCallback, useEffect, useState } from 'react';
import { Eye, ShieldCheck } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { personalService } from '../../api/personal.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import { Cargando, ErrorCarga, VacioFiltro, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatFechaHora } from '../../utils/formato';
import type {
  AuditoriaFiltrosDisponiblesResponse,
  AuditoriaGymItemResponse,
  FiltrosAuditoria,
} from '../../types/myGym.types';
import type { StaffResponse } from '../../types/personal.types';

const FILTROS_VACIOS = { fecha_inicio: '', fecha_fin: '', actor_id: '', accion: '', entidad: '', q: '' };
type Filtros = typeof FILTROS_VACIOS;

/** `crear_venta` → `Crear venta`. Los nombres técnicos se muestran legibles sin inventar traducciones. */
const legible = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Auditoría (GW-RF-49, GW-RF-50), solo Jefe. `GET /my-gym/auditoria` y `GET /my-gym/auditoria/filtros`.
 * Registro inmutable con cadena de hash; incluye las sesiones "Entrar como" del Super-Admin con el actor real.
 */
export const AuditoriaPage: React.FC = () => {
  const [borrador, setBorrador] = useState<Filtros>(FILTROS_VACIOS);
  const [aplicados, setAplicados] = useState<Filtros>(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<AuditoriaGymItemResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [opciones, setOpciones] = useState<AuditoriaFiltrosDisponiblesResponse>({ acciones: [], entidades: [] });
  const [personal, setPersonal] = useState<StaffResponse[]>([]);
  const [detalle, setDetalle] = useState<AuditoriaGymItemResponse | null>(null);

  const hayFiltros = Object.values(aplicados).some((v) => v !== '');
  const errorFechas =
    borrador.fecha_inicio && borrador.fecha_fin && borrador.fecha_inicio > borrador.fecha_fin
      ? 'La fecha inicial no puede ser posterior a la final.'
      : null;

  // Opciones de filtro: si fallan, los filtros quedan como texto libre (no bloquea la consulta).
  useEffect(() => {
    myGymService.getFiltrosAuditoria().then(setOpciones).catch(() => undefined);
    personalService
      .listar({ pagina: 1, limite: 100 })
      .then((r) => setPersonal(r.items))
      .catch(() => undefined);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params: FiltrosAuditoria = { page: pagina, page_size: FILAS_POR_PAGINA };
    for (const [k, v] of Object.entries(aplicados)) if (v) (params as Record<string, unknown>)[k] = v;
    try {
      const r = await myGymService.getAuditoria(params);
      setItems(r.items);
      setTotal(r.total);
      setTotalPaginas(Math.max(1, r.total_pages));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [aplicados, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const aplicar = (e: React.FormEvent) => {
    e.preventDefault();
    if (errorFechas) return;
    setAplicados({ ...borrador, q: borrador.q.trim() });
    setPagina(1);
  };

  const limpiar = () => {
    setBorrador(FILTROS_VACIOS);
    setAplicados(FILTROS_VACIOS);
    setPagina(1);
  };

  const selectFiltro = (
    id: keyof Filtros,
    etiqueta: string,
    opcionesSelect: Array<{ value: string; label: string }>,
    todos: string
  ) => (
    <div className="form-group" style={{ width: 200 }}>
      <label className="form-label" htmlFor={`aud-${id}`}>
        {etiqueta}
      </label>
      <select
        id={`aud-${id}`}
        className="form-select"
        value={borrador[id]}
        onChange={(e) => setBorrador({ ...borrador, [id]: e.target.value })}
      >
        <option value="">{todos}</option>
        {opcionesSelect.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  let contenido: React.ReactNode;
  if (cargando && items.length === 0 && !error) contenido = <Cargando />;
  else if (error) contenido = <ErrorCarga error={error} onReintentar={cargar} />;
  else if (total === 0 && !hayFiltros)
    contenido = (
      <VacioInicial
        icono={<ShieldCheck size={40} />}
        titulo="Aún no hay eventos"
        descripcion="Aquí quedan registradas, sin posibilidad de cambio, las operaciones sobre dinero, membresías, permisos, inventario y configuración."
      />
    );
  else if (total === 0) contenido = <VacioFiltro onLimpiar={limpiar} />;
  else
    contenido = (
      <Card>
        <Table<AuditoriaGymItemResponse>
          data={items}
          isLoading={cargando}
          keyExtractor={(a) => a.id}
          pagination={{ currentPage: pagina, totalPages: totalPaginas, onPageChange: setPagina }}
          columns={[
            { header: 'Fecha', render: (a) => formatFechaHora(a.created_at) },
            {
              header: 'Quién',
              render: (a) => (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{a.actor_nombre}</span>
                  {a.impersonando && (
                    <Badge variant="warning" title="Sesión de soporte iniciada desde el Super-Admin">
                      Entrar como (MVC)
                    </Badge>
                  )}
                </div>
              ),
            },
            { header: 'Acción', render: (a) => legible(a.accion) },
            {
              header: 'Sobre',
              render: (a) => (
                <div>
                  <div>{legible(a.entidad)}</div>
                  {a.entidad_id && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} title={a.entidad_id}>
                      {a.entidad_id.length > 13 ? `${a.entidad_id.slice(0, 8)}…` : a.entidad_id}
                    </div>
                  )}
                </div>
              ),
            },
            {
              header: '',
              align: 'right',
              render: (a) => (
                <Button variant="ghost" size="sm" leftIcon={<Eye size={14} />} onClick={() => setDetalle(a)}>
                  Detalle
                </Button>
              ),
            },
          ]}
        />
      </Card>
    );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Auditoría</h1>
          <p className="page-subtitle">Registro inmutable de lo que pasa en el gimnasio. Solo lo ve el Jefe.</p>
        </div>
      </div>

      <form onSubmit={aplicar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div style={{ width: 160 }}>
          <Input
            label="Desde"
            type="date"
            value={borrador.fecha_inicio}
            onChange={(e) => setBorrador({ ...borrador, fecha_inicio: e.target.value })}
            error={errorFechas ?? undefined}
          />
        </div>
        <div style={{ width: 160 }}>
          <Input
            label="Hasta"
            type="date"
            value={borrador.fecha_fin}
            onChange={(e) => setBorrador({ ...borrador, fecha_fin: e.target.value })}
          />
        </div>
        {selectFiltro(
          'actor_id',
          'Persona',
          personal.map((p) => ({ value: p.id, label: p.nombre })),
          'Todas'
        )}
        {selectFiltro(
          'accion',
          'Acción',
          opciones.acciones.map((a) => ({ value: a, label: legible(a) })),
          'Todas'
        )}
        {selectFiltro(
          'entidad',
          'Sobre',
          opciones.entidades.map((e) => ({ value: e, label: legible(e) })),
          'Todo'
        )}
        <div className="form-group" style={{ minWidth: 220 }}>
          <label className="form-label" htmlFor="aud-q">
            Buscar
          </label>
          <SearchInput
            id="aud-q"
            placeholder="Nombre, acción o id"
            value={borrador.q}
            onChange={(e) => setBorrador({ ...borrador, q: e.target.value })}
          />
        </div>
        <div className="form-group" style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" variant="primary" disabled={!!errorFechas || cargando}>
            Filtrar
          </Button>
          {hayFiltros && (
            <Button type="button" variant="ghost" onClick={limpiar}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </form>

      {contenido}

      <Modal isOpen={detalle !== null} onClose={() => setDetalle(null)} title="Detalle del evento" maxWidth="720px">
        {detalle && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.9rem' }}>
            <div>
              <strong>{legible(detalle.accion)}</strong> · {legible(detalle.entidad)} · {formatFechaHora(detalle.created_at)}
            </div>
            <div>
              Por <strong>{detalle.actor_nombre}</strong>
              {detalle.impersonando && ' (sesión "Entrar como" desde el Super-Admin)'}
            </div>
            {detalle.entidad_id && (
              <div>
                Registro: <code style={{ fontFamily: 'var(--font-mono)' }}>{detalle.entidad_id}</code>
              </div>
            )}
            <div>
              <div className="form-label">Datos</div>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  maxHeight: 320,
                  overflow: 'auto',
                  background: 'var(--bg-surface-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {detalle.detalle ? JSON.stringify(detalle.detalle, null, 2) : 'Sin datos adicionales.'}
              </pre>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              Hash: {detalle.hash_actual}
              {detalle.hash_previo && (
                <>
                  <br />
                  Hash anterior: {detalle.hash_previo}
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
