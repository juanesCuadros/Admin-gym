import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Fingerprint, LogIn, Search, ShoppingCart, UserPlus, UserRound } from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Button } from '@web/components/ui/Button';
import { Drawer } from '@web/components/ui/Drawer';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { useToast } from '@web/contexts/ToastContext';
import { formatCOP, formatDocumento, formatFecha, formatFechaHora } from '@web/utils/formato';
import { ingresoService } from '../api/ingreso.service';
import { NOMBRE_DEDO } from '../api/huella.service';
import { aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import type { EstadoEstacion } from '../types/estacion.types';
import type { ClienteEvaluado, EstadoCliente, FichaCliente } from '../types/ingreso.types';
import { RegistrarHuellaModal, useHuella } from './Huella';
import { NuevoClienteModal } from './NuevoClienteModal';

const fecha = (dia: string) => formatFecha(`${dia}T12:00:00-05:00`);

const FILTROS: { id: string; etiqueta: string; estados?: EstadoCliente[] }[] = [
  { id: '', etiqueta: 'Todos' },
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
}> = ({ estacion, onCobrar, onVender, atajoNuevo }) => {
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
    if (atajoNuevo > 0) setNuevo(true);
  }, [atajoNuevo]);

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

  const cuenta = (ids?: EstadoCliente[]) =>
    ids ? (pagina?.por_estado ?? []).filter(([e]) => ids.includes(e as EstadoCliente)).reduce((a, [, n]) => a + n, 0)
        : (pagina?.por_estado ?? []).reduce((a, [, n]) => a + n, 0);

  const c = ficha?.cliente;
  const cobrable = c && ['vencido', 'en_gracia', 'por_vencer', 'sin_membresia', 'cancelado', 'activo'].includes(c.estado);

  return (
    <div className="gd-modulo">
      <div className="gd-filtros">
        <div className="gd-buscador">
          <Search size={18} />
          <input autoFocus placeholder="Buscar por nombre o documento" value={texto} onChange={(e) => { setTexto(e.target.value); setLimite(50); }} />
        </div>
        <div className="gd-chips" role="tablist" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filtro === f.id} className={filtro === f.id ? 'activa' : ''} onClick={() => { setFiltro(f.id); setLimite(50); }}>
              {f.etiqueta} <span>{cuenta(f.estados)}</span>
            </button>
          ))}
        </div>
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
              </div>
            </div>

            <h4>Huellas</h4>
            <p className="gd-subtitulo" style={{ marginTop: 0 }}>
              {ficha.huellas.length ? ficha.huellas.map((d) => NOMBRE_DEDO[d] ?? d).join(', ') : 'Sin huella registrada en esta estación.'}
            </p>

            <h4>Últimos ingresos</h4>
            {ficha.ingresos.length === 0 ? (
              <p className="gd-vacio">Sin ingresos registrados en esta estación.</p>
            ) : (
              <table className="gd-tabla">
                <tbody>
                  {ficha.ingresos.map((i) => (
                    <tr key={i.ocurrido_en}>
                      <td>{formatFechaHora(i.ocurrido_en)}</td>
                      <td><Badge variant={i.resultado === 'negado' ? 'danger' : i.resultado === 'alerta_mora' ? 'warning' : 'success'}>
                        {i.resultado === 'negado' ? 'Negado' : i.resultado === 'alerta_mora' ? 'Con alerta' : 'Entró'}
                      </Badge></td>
                      <td>{i.metodo === 'huella' ? 'Huella' : 'Documento'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>Cobros en esta estación</h4>
            {ficha.cobros.length === 0 ? (
              <p className="gd-vacio">Sin cobros registrados en esta estación. Los de la web se ven en el sistema web.</p>
            ) : (
              <table className="gd-tabla">
                <tbody>
                  {ficha.cobros.map((x) => (
                    <tr key={x.ocurrido_en + x.concepto}>
                      <td>{formatFechaHora(x.ocurrido_en)}</td>
                      <td>{x.concepto}</td>
                      <td>{x.metodo}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCOP(x.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
