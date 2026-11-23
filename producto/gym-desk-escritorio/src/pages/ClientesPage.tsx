import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Filter, Fingerprint, LogIn, Search, ShoppingCart, UserPlus, UserRound } from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Button } from '@web/components/ui/Button';
import { Drawer } from '@web/components/ui/Drawer';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { useToast } from '@web/contexts/ToastContext';
import { formatCOP, formatDocumento, formatFecha, formatHora } from '@web/utils/formato';
import { ingresoService } from '../api/ingreso.service';
import { NOMBRE_DEDO } from '../api/huella.service';
import { aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import type { EstadoEstacion } from '../types/estacion.types';
import type { ClienteEvaluado, EstadoCliente, FichaCliente } from '../types/ingreso.types';
import { RegistrarHuellaModal, useHuella } from './Huella';
import { MedicionesCliente } from './Mediciones';
import { NuevoClienteModal } from './NuevoClienteModal';

const fecha = (dia: string) => formatFecha(`${dia}T12:00:00-05:00`);
const diaBogota = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const esHoy = (instante: string) => diaBogota(new Date(instante)) === diaBogota(new Date());

const FILTROS: { id: string; etiqueta: string; estados?: EstadoCliente[] }[] = [
  { id: '', etiqueta: 'Todos los estados' },
  { id: 'activo', etiqueta: 'Activos', estados: ['activo'] },
  { id: 'por_cobrar', etiqueta: 'Por cobrar', estados: ['vencido', 'en_gracia', 'por_vencer', 'sin_membresia'] },
  { id: 'vencido', etiqueta: 'Vencidos', estados: ['vencido'] },
  { id: 'congelado', etiqueta: 'Congelados', estados: ['congelado'] },
];

const Miniatura: React.FC<{ c: ClienteEvaluado; tam?: number }> = ({ c, tam = 36 }) =>
  c.foto ? (
    <img src={c.foto} alt="" className="gd-mini-foto" style={{ width: tam, height: tam }} />
  ) : (
    <span className="gd-mini-foto gd-mini-iniciales" style={{ width: tam, height: tam }}>
      {c.nombre.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()}
    </span>
  );

function vigencia(c: ClienteEvaluado): string {
  if (!c.fecha_vencimiento) return 'Sin membresía';
  const f = fecha(c.fecha_vencimiento);
  if (c.estado === 'vencido' || c.estado === 'en_gracia') return `Venció el ${f} (hace ${c.dias_restantes_o_vencido} d)`;
  if (c.estado === 'activo' || c.estado === 'por_vencer') return `Vence el ${f} (${c.dias_restantes_o_vencido} d)`;
  return `Vence el ${f}`;
}

/**
 * Clientes: la lista completa con búsqueda y filtros, y la ficha de cada uno a la derecha, con las acciones
 * de recepción (ingreso, renovar o vender plan, venta, huella). Funciona sin red; registrar uno nuevo la exige.
 */
export const ClientesPage: React.FC<{
  estacion: EstadoEstacion;
  onCobrar: (deportistaId: string) => void;
  onVender: (deportistaId: string) => void;
  atajoNuevo: number;
  /** El pedido de "nuevo cliente" se consume una vez: volver a Clientes no lo reabre. */
  onAtajoUsado: () => void;
}> = ({ estacion, onCobrar, onVender, atajoNuevo, onAtajoUsado }) => {
  const { showToast } = useToast();
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('');
  const [pagina, setPagina] = useState<{ items: ClienteEvaluado[]; total: number; por_estado: [string, number][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limite, setLimite] = useState(50);
  const [elegido, setElegido] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaCliente | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [huella] = useHuella();
  const [clienteHuella, setClienteHuella] = useState<{ id: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setPagina(await ingresoService.listar(texto, filtro, limite));
      setError(null);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  }, [texto, filtro, limite]);

  useEffect(() => {
    const t = window.setTimeout(() => void cargar(), 150);
    return () => window.clearTimeout(t);
  }, [cargar, estacion.cola.por_enviar]);

  useEffect(() => {
    if (atajoNuevo > 0) {
      setNuevo(true);
      onAtajoUsado();
    }
  }, [atajoNuevo, onAtajoUsado]);

  const abrirFicha = useCallback(async (id: string) => {
    setElegido(id);
    try {
      setFicha(await ingresoService.ficha(id));
    } catch (e) {
      setFicha(null);
      showToast('error', 'No se pudo abrir la ficha', aErrorGymDesk(e).mensaje);
    }
  }, [showToast]);

  const registrarIngreso = async (id: string) => {
    try {
      const r = await ingresoService.porCliente(id);
      showToast(r.resultado === 'negado' ? 'error' : r.resultado === 'alerta_mora' ? 'warning' : 'success', r.resultado === 'negado' ? 'No puede entrar' : 'Ingreso registrado', r.mensaje);
      void abrirFicha(id);
      void cargar();
    } catch (e) {
      showToast('error', 'No se registró', aErrorGymDesk(e).mensaje);
    }
  };

  const c = ficha?.cliente;
  const cobrable = c && ['vencido', 'en_gracia', 'por_vencer', 'sin_membresia', 'cancelado', 'activo'].includes(c.estado);

  return (
    <div className="gd-modulo">
      <div className="gd-filtros">
        <div className="gd-buscador">
          <Search size={18} />
          <input autoFocus placeholder="Buscar por nombre o documento" value={texto} onChange={(e) => { setTexto(e.target.value); setLimite(50); }} />
        </div>
        <label className="gd-filtro-select">
          <Filter size={16} />
          <select aria-label="Filtrar por estado" value={filtro} onChange={(e) => { setFiltro(e.target.value); setLimite(50); }}>
            {FILTROS.map((f) => <option key={f.id} value={f.id}>{f.etiqueta}</option>)}
          </select>
        </label>
        {pagina && <span className="gd-filtro-total">{pagina.total} {pagina.total === 1 ? 'cliente' : 'clientes'}</span>}
      </div>

      {error && <MensajeError>{error}</MensajeError>}
      <section className="gd-panel gd-panel-tabla">
        {!pagina ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : pagina.items.length === 0 ? (
          <div className="gd-vacio-grande">
            <UserRound size={36} />
            <p>{texto ? `Nadie coincide con “${texto}”.` : 'No hay clientes en este filtro.'}</p>
            <Button leftIcon={<UserPlus size={16} />} onClick={() => setNuevo(true)}>Nuevo cliente</Button>
          </div>
        ) : (
          <table className="gd-tabla gd-tabla-clientes">
            <thead>
              <tr><th style={{ width: 52 }} /><th>Cliente</th><th>Documento</th><th>Plan</th><th>Vigencia</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {pagina.items.map((x) => (
                <tr key={x.id} className={elegido === x.id ? 'elegida' : ''} onClick={() => void abrirFicha(x.id)} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && void abrirFicha(x.id)}>
                  <td><Miniatura c={x} /></td>
                  <td><strong>{x.nombre}</strong></td>
                  <td>{formatDocumento(x.tipo_documento, x.documento)}</td>
                  <td>{x.plan_nombre ?? '—'}</td>
                  <td>{vigencia(x)}</td>
                  <td><EstadoDeportistaBadge estado={x.estado} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pagina && pagina.total > pagina.items.length && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <Button variant="outline" size="sm" onClick={() => setLimite((l) => l + 50)}>
              Ver más ({pagina.items.length} de {pagina.total})
            </Button>
          </div>
        )}
      </section>

      <Drawer
        isOpen={elegido !== null}
        onClose={() => { setElegido(null); setFicha(null); }}
        title={c?.nombre ?? 'Cliente'}
        subtitle={c ? formatDocumento(c.tipo_documento, c.documento) : undefined}
        size="lg"
        footer={c && (
          <div className="gd-ficha-acciones">
            <Button leftIcon={<LogIn size={16} />} onClick={() => void registrarIngreso(c.id)}>Registrar ingreso</Button>
            {cobrable && (
              <Button variant="outline" leftIcon={<CalendarPlus size={16} />} onClick={() => onCobrar(c.id)}>
                {c.estado === 'sin_membresia' || c.estado === 'cancelado' ? 'Vender plan' : 'Renovar'}
              </Button>
            )}
            <Button variant="outline" leftIcon={<ShoppingCart size={16} />} onClick={() => onVender(c.id)}>Vender producto o pase</Button>
            {huella && huella.lector !== 'ninguno' && huella.puede_registrar && (
              <Button variant="outline" leftIcon={<Fingerprint size={16} />} onClick={() => setClienteHuella({ id: c.id, nombre: c.nombre })}>Huella</Button>
            )}
          </div>
        )}
      >
        {!ficha || !c ? (
          <div className="skeleton" style={{ height: 300 }} />
        ) : (
          <div className="gd-ficha">
            <div className="gd-ficha-cabecera">
              <Miniatura c={c} tam={96} />
              <div>
                <EstadoDeportistaBadge estado={c.estado} />
                <div className="gd-ficha-plan">{c.plan_nombre ?? 'Sin membresía'}</div>
                <div className="gd-subtitulo" style={{ margin: 0 }}>
                  {vigencia(c)}{ficha.membresia_desde ? ` · desde el ${fecha(ficha.membresia_desde)}` : ''}
                </div>
                <div className={`gd-ficha-acceso ${c.abre ? 'si' : 'no'}`}>{c.abre ? 'Puede entrar hoy' : 'No puede entrar hoy'} · {c.mensaje}</div>
                {ficha.huellas.length > 0 && (
                  <div className="gd-ficha-huella"><Fingerprint size={14} /> Huella registrada ({ficha.huellas.map((d) => NOMBRE_DEDO[d] ?? d).join(', ').toLowerCase()})</div>
                )}
              </div>
            </div>

            <MedicionesCliente deportistaId={c.id} nombre={c.nombre} enLinea={estacion.en_linea} />

            <h4>Salud y emergencia</h4>
            {ficha.salud && Object.values(ficha.salud).some(Boolean) ? (
              <dl className="gd-ficha-salud">
                {ficha.salud.contacto_emergencia_nombre && (
                  <div><dt>Contacto de emergencia</dt><dd>{ficha.salud.contacto_emergencia_nombre}{ficha.salud.contacto_emergencia_telefono ? ` · ${ficha.salud.contacto_emergencia_telefono}` : ''}</dd></div>
                )}
                {ficha.salud.grupo_sanguineo && <div><dt>Grupo sanguíneo</dt><dd>{ficha.salud.grupo_sanguineo}</dd></div>}
                {ficha.salud.condiciones && <div className="gd-ficha-condicion"><dt>Condiciones médicas</dt><dd>{ficha.salud.condiciones}</dd></div>}
              </dl>
            ) : (
              <p className="gd-subtitulo" style={{ marginTop: 0 }}>Sin datos registrados. Se agregan desde la web.</p>
            )}

            {/* Solo lo de hoy: el historial completo de ingresos y pagos se consulta en la web. */}
            <h4>Hoy</h4>
            {(() => {
              const ingresosHoy = ficha.ingresos.filter((i) => esHoy(i.ocurrido_en));
              const cobrosHoy = ficha.cobros.filter((x) => esHoy(x.ocurrido_en));
              if (ingresosHoy.length === 0 && cobrosHoy.length === 0) return <p className="gd-subtitulo" style={{ marginTop: 0 }}>Aún no ha entrado hoy.</p>;
              return (
                <div className="gd-hoy">
                  {ingresosHoy.map((i) => (
                    <span key={i.ocurrido_en} className={`gd-hoy-item ${i.resultado === 'negado' ? 'no' : i.resultado === 'alerta_mora' ? 'alerta' : 'si'}`}>
                      <strong>{formatHora(i.ocurrido_en)}</strong>
                      {i.resultado === 'negado' ? 'Negado' : i.resultado === 'alerta_mora' ? 'Entró con alerta' : 'Entró'} · {i.metodo === 'huella' ? 'huella' : 'documento'}
                    </span>
                  ))}
                  {cobrosHoy.map((x) => (
                    <span key={x.ocurrido_en + x.concepto} className="gd-hoy-item cobro">
                      <strong>{formatHora(x.ocurrido_en)}</strong>
                      {x.concepto} · {formatCOP(x.monto)}
                    </span>
                  ))}
                </div>
              );
            })()}
            <p className="gd-pista">El historial completo de ingresos y pagos está en la web, en la ficha del deportista.</p>
          </div>
        )}
      </Drawer>

      {huella && (
        <RegistrarHuellaModal abierto={clienteHuella !== null} cliente={clienteHuella} huella={huella}
          onCerrar={() => { setClienteHuella(null); if (elegido) void abrirFicha(elegido); }} />
      )}
      <NuevoClienteModal
        abierto={nuevo}
        enLinea={estacion.en_linea}
        documentoInicial={/^\d{3,}$/.test(texto.trim()) ? texto.trim() : ''}
        onCerrar={() => setNuevo(false)}
        onRegistrado={(x) => {
          setNuevo(false);
          setTexto('');
          showToast('success', 'Cliente registrado', `${x.nombre} ya está en la estación. Véndele un plan para que pueda entrar.`);
          void cargar();
          void abrirFicha(x.id);
        }}
      />
    </div>
  );
};
