import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, CloudUpload, Gift, ScanLine, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '@web/components/ui/Badge';
import { Button } from '@web/components/ui/Button';
import { EstadoDeportistaBadge } from '@web/components/ui/EstadoDeportistaBadge';
import { Textarea } from '@web/components/ui/Input';
import { Modal } from '@web/components/ui/Modal';
import { formatDocumento, formatFecha, formatFechaHora, formatHora, formatVencimiento } from '@web/utils/formato';
import { ingresoService } from '../api/ingreso.service';
import { aErrorGymDesk, ErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';
import type { EstadoEstacion } from '../types/estacion.types';
import type { ClienteEvaluado, IngresoListado, ResultadoIngreso, ResumenIngresos } from '../types/ingreso.types';
import { sonar } from '../utils/sonido';

/** El resultado grande se retira solo, para que nadie lo confunda con el de la siguiente persona. */
const SEGUNDOS_RESULTADO = 10;
const ESPERA_BUSQUEDA_MS = 180;
/** Con la última descarga más vieja que esto y sin conexión, se avisa con qué datos se decide. */
const MINUTOS_DATOS_VIEJOS = 10;
const MOTIVO_MINIMO = 4;

type Tono = 'abre' | 'alerta' | 'negado' | 'neutro';

function tonoDe(r: ResultadoIngreso): Tono {
  if (r.relectura_ignorada) return 'neutro';
  if (r.resultado === 'abrio') return 'abre';
  return r.resultado === 'alerta_mora' ? 'alerta' : 'negado';
}

function titular(r: ResultadoIngreso): string {
  if (r.relectura_ignorada) return 'Ya se registró hace un momento';
  if (r.tipo === 'cortesia') return 'Cortesía registrada';
  if (r.resultado === 'abrio') return 'Puede entrar';
  if (r.resultado === 'alerta_mora') {
    const dias = r.cliente?.dias_restantes_o_vencido ?? 0;
    return `Entra con alerta: ${dias} ${dias === 1 ? 'día vencido' : 'días vencidos'}`;
  }
  return 'No puede entrar';
}

/** Vencimiento en palabras: "Vence en 3 días (15/11/2026)". */
function vigencia(c: ClienteEvaluado): string | null {
  if (!c.fecha_vencimiento) return null;
  // Una fecha sin hora se ancla al mediodía de Bogotá: sola se leería como medianoche UTC y se
  // pintaría el día anterior (misma convención que la web).
  const fecha = `${c.fecha_vencimiento}T12:00:00-05:00`;
  const vencido = c.estado === 'en_gracia' || c.estado === 'vencido';
  if (c.estado === 'congelado' || c.estado === 'desactivado') return `Vence el ${formatFecha(fecha)}`;
  return formatVencimiento(fecha, vencido ? -c.dias_restantes_o_vencido : c.dias_restantes_o_vencido);
}

function haceCuanto(instante: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(instante).getTime()) / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} días`;
}

const ICONO: Record<Tono, React.ReactNode> = {
  abre: <CheckCircle2 size={56} />,
  alerta: <AlertTriangle size={56} />,
  negado: <XCircle size={56} />,
  neutro: <ScanLine size={56} />,
};

const ResultadoGrande: React.FC<{ resultado: ResultadoIngreso }> = ({ resultado }) => {
  const tono = tonoDe(resultado);
  const c = resultado.cliente;
  return (
    <div className={`gd-ingreso-resultado gd-ingreso-${tono}`} role="status" aria-live="assertive">
      <div className="gd-ingreso-icono">{ICONO[tono]}</div>
      <div style={{ minWidth: 0 }}>
        <div className="gd-ingreso-titular">{titular(resultado)}</div>
        {c && <div className="gd-ingreso-nombre">{c.nombre}</div>}
        {c && (
          <div className="gd-ingreso-datos">
            <span>{formatDocumento(c.tipo_documento, c.documento)}</span>
            <EstadoDeportistaBadge estado={c.estado} />
            {c.plan_nombre && <span>{c.plan_nombre}</span>}
            {vigencia(c) && <span>{vigencia(c)}</span>}
          </div>
        )}
        <div className="gd-ingreso-mensaje">{resultado.mensaje}</div>
      </div>
    </div>
  );
};

const ETIQUETA_RESULTADO: Record<IngresoListado['resultado'], { texto: string; variante: 'success' | 'warning' | 'danger' }> = {
  abrio: { texto: 'Entró', variante: 'success' },
  alerta_mora: { texto: 'Entró con alerta', variante: 'warning' },
  negado: { texto: 'Negado', variante: 'danger' },
};

/**
 * Control de ingreso. Decide con los datos guardados en este equipo, con red o sin ella, y cada
 * intento sube solo al servidor. El campo recibe lo que se escriba o lo que lea el lector de códigos.
 */
export const ControlIngresoPanel: React.FC<{
  estacion: EstadoEstacion;
  /** Lleva al cliente a Caja para renovarle o venderle un plan. */
  onCobrar?: (deportistaId: string) => void;
}> = ({ estacion, onCobrar }) => {
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState<ClienteEvaluado[]>([]);
  const [resultado, setResultado] = useState<ResultadoIngreso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenIngresos | null>(null);
  const [errorResumen, setErrorResumen] = useState<string | null>(null);
  const [cortesiaAbierta, setCortesiaAbierta] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorCortesia, setErrorCortesia] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const enCurso = useRef(false);

  const cargarResumen = useCallback(async () => {
    try {
      setResumen(await ingresoService.deHoy());
      setErrorResumen(null);
    } catch (e) {
      setErrorResumen(aErrorGymDesk(e).mensaje);
    }
  }, []);

  // Se recarga al abrir y cada vez que la cola se mueve (un ingreso que subió cambia su marca).
  const { por_enviar, por_revisar, con_error } = estacion.cola;
  useEffect(() => {
    void cargarResumen();
  }, [cargarResumen, por_enviar, por_revisar, con_error]);

  // Sugerencias mientras se escribe. El lector de códigos termina en Enter antes de que esto corra.
  useEffect(() => {
    const buscado = texto.trim();
    if (buscado.length < 2) {
      setSugerencias([]);
      return;
    }
    let vigente = true;
    const espera = window.setTimeout(() => {
      ingresoService
        .buscar(buscado)
        .then((r) => vigente && setSugerencias(r))
        .catch((e) => vigente && setError(aErrorGymDesk(e).mensaje));
    }, ESPERA_BUSQUEDA_MS);
    return () => {
      vigente = false;
      window.clearTimeout(espera);
    };
  }, [texto]);

  useEffect(() => {
    if (!resultado) return;
    const espera = window.setTimeout(() => setResultado(null), SEGUNDOS_RESULTADO * 1000);
    return () => window.clearTimeout(espera);
  }, [resultado]);

  const enfocar = () => window.setTimeout(() => campo.current?.focus(), 0);

  const mostrar = (r: ResultadoIngreso) => {
    setResultado(r);
    setError(null);
    setTexto('');
    setSugerencias([]);
    const tono = tonoDe(r);
    if (tono !== 'neutro') sonar(tono);
    void cargarResumen();
  };

  /** Una acción a la vez: un doble Enter no registra dos veces. */
  const ejecutar = async (accion: () => Promise<ResultadoIngreso>, alFallar: (mensaje: string, codigo: string) => void) => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    try {
      mostrar(await accion());
    } catch (e) {
      const err = aErrorGymDesk(e);
      alFallar(err.mensaje, err.codigo);
    } finally {
      enCurso.current = false;
      setOcupado(false);
      enfocar();
    }
  };

  const fallo = (mensaje: string) => {
    setResultado(null);
    setError(mensaje);
    sonar('negado');
  };

  const registrarCliente = (id: string) => void ejecutar(() => ingresoService.porCliente(id), fallo);

  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    const escrito = texto.trim();
    if (!escrito) return;
    void ejecutar(
      async () => {
        try {
          return await ingresoService.porDocumento(escrito);
        } catch (e) {
          if (aErrorGymDesk(e).codigo !== 'CLIENTE_NO_ENCONTRADO') throw e;
          // No es un documento: se busca por nombre. Si queda una sola persona, es ella.
          const candidatos = await ingresoService.buscar(escrito);
          if (candidatos.length === 1) return await ingresoService.porCliente(candidatos[0].id);
          if (candidatos.length > 1) {
            setSugerencias(candidatos);
            throw new ErrorGymDesk('VARIOS_CLIENTES', 'Hay varias personas con ese nombre. Elige una de la lista.');
          }
          throw e;
        }
      },
      (mensaje, codigo) => {
        if (codigo === 'VARIOS_CLIENTES') setError(mensaje);
        else fallo(mensaje);
      },
    );
  };

  const motivoValido = motivo.trim().length >= MOTIVO_MINIMO;
  const confirmarCortesia = () => {
    if (!motivoValido) {
      setErrorCortesia(`Escribe el motivo (mínimo ${MOTIVO_MINIMO} letras).`);
      return;
    }
    void ejecutar(
      async () => {
        const r = await ingresoService.cortesia(motivo.trim());
        setCortesiaAbierta(false);
        return r;
      },
      (mensaje) => setErrorCortesia(mensaje),
    );
  };

  const datosViejos =
    !estacion.en_linea &&
    estacion.ultima_descarga_ok !== null &&
    Date.now() - new Date(estacion.ultima_descarga_ok).getTime() > MINUTOS_DATOS_VIEJOS * 60_000;

  return (
    <div className="gd-ingreso">
      <section className="gd-ingreso-principal">
        {resumen?.reloj_retrocedio && (
          <MensajeError>
            La hora de este equipo es anterior a la del último registro. Revisa la fecha y la hora de Windows: los ingresos
            se guardan con esa hora.
          </MensajeError>
        )}
        {datosViejos && estacion.ultima_descarga_ok && (
          <div className="gd-aviso" role="status">
            <ShieldAlert size={18} style={{ flexShrink: 0 }} />
            <span>
              Sin conexión. Se decide con los datos de hace {haceCuanto(estacion.ultima_descarga_ok)} (
              {formatFechaHora(estacion.ultima_descarga_ok)}). Un pago hecho después en la web aún no se ve aquí.
            </span>
          </div>
        )}

        <form onSubmit={alEnviar} className="gd-ingreso-form" noValidate>
          <label htmlFor="gd-ingreso-campo" className="gd-ingreso-etiqueta">
            Documento o nombre del cliente
          </label>
          <div className="gd-ingreso-fila">
            <input
              id="gd-ingreso-campo"
              ref={campo}
              className="gd-ingreso-campo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribe o pasa el carné por el lector"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={ocupado}
            />
            <Button type="submit" size="lg" isLoading={ocupado} disabled={texto.trim() === ''}>
              Registrar ingreso
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              leftIcon={<Gift size={18} />}
              disabled={ocupado}
              onClick={() => {
                setMotivo('');
                setErrorCortesia(null);
                setCortesiaAbierta(true);
              }}
            >
              Cortesía
            </Button>
          </div>
        </form>

        {sugerencias.length > 0 && (
          <ul className="gd-ingreso-sugerencias" aria-label="Clientes encontrados">
            {sugerencias.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={ocupado} onClick={() => registrarCliente(c.id)}>
                  <span className="gd-ingreso-sugerencia-nombre">{c.nombre}</span>
                  <span className="gd-ingreso-sugerencia-doc">{formatDocumento(c.tipo_documento, c.documento)}</span>
                  <EstadoDeportistaBadge estado={c.estado} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {texto.trim().length >= 2 && sugerencias.length === 0 && !ocupado && (
          <p className="gd-ingreso-pista">Nadie coincide con “{texto.trim()}” en esta estación.</p>
        )}

        {error && <MensajeError>{error}</MensajeError>}
        {resultado && <ResultadoGrande resultado={resultado} />}
        {resultado?.cliente && onCobrar && ['vencido', 'en_gracia', 'por_vencer', 'sin_membresia', 'cancelado'].includes(resultado.cliente.estado) && (
          <Button
            leftIcon={<CalendarPlus size={16} />}
            style={{ marginTop: 12 }}
            onClick={() => onCobrar(resultado.cliente!.id)}
          >
            {resultado.cliente.estado === 'sin_membresia' || resultado.cliente.estado === 'cancelado' ? 'Venderle un plan' : 'Renovar membresía'}
          </Button>
        )}
        {!resultado && !error && sugerencias.length === 0 && (
          <div className="gd-ingreso-espera">
            <ScanLine size={40} />
            <p>Listo para el siguiente ingreso</p>
          </div>
        )}
      </section>

      <aside className="gd-ingreso-lateral" aria-label="Ingresos de hoy">
        <h2 className="gd-titulo" style={{ fontSize: '1.05rem' }}>
          Hoy en esta estación
        </h2>
        {errorResumen && <MensajeError>{errorResumen}</MensajeError>}
        {!resumen && !errorResumen && <div className="skeleton" style={{ height: 160, borderRadius: 10 }} aria-busy="true" />}
        {resumen && (
          <>
            <dl className="gd-ingreso-conteos">
              <div>
                <dt>Entraron</dt>
                <dd>{resumen.abrieron + resumen.alertas}</dd>
              </div>
              <div>
                <dt>Con alerta</dt>
                <dd>{resumen.alertas}</dd>
              </div>
              <div>
                <dt>Negados</dt>
                <dd>{resumen.negados}</dd>
              </div>
              <div>
                <dt>Cortesías</dt>
                <dd>{resumen.cortesias}</dd>
              </div>
            </dl>
            {resumen.items.length === 0 ? (
              <p className="gd-ingreso-pista">Aún no hay ingresos registrados hoy.</p>
            ) : (
              <ul className="gd-ingreso-lista">
                {resumen.items.map((i) => (
                  <li key={i.id}>
                    <span className="gd-ingreso-hora">{formatHora(i.ocurrido_en)}</span>
                    <span className="gd-ingreso-quien" title={i.motivo_cortesia ?? i.mensaje}>
                      {i.tipo === 'cortesia' ? `Cortesía: ${i.motivo_cortesia}` : i.deportista_nombre}
                    </span>
                    {i.tipo === 'ingreso' && <Badge variant={ETIQUETA_RESULTADO[i.resultado].variante}>{ETIQUETA_RESULTADO[i.resultado].texto}</Badge>}
                    {i.envio !== 'aplicada' && (
                      <span
                        className={i.envio === 'error' ? 'gd-ingreso-envio gd-ingreso-envio-error' : 'gd-ingreso-envio'}
                        title={
                          i.envio === 'pendiente_revision'
                            ? 'Subió y el Jefe debe revisarlo'
                            : i.envio === 'error'
                              ? 'El servidor no lo aceptó. Míralo en Pendientes'
                              : 'Guardado en este equipo. Sube cuando haya conexión'
                        }
                      >
                        <CloudUpload size={15} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {resumen.total > resumen.items.length && (
              <p className="gd-ingreso-pista">Se muestran los últimos {resumen.items.length} de {resumen.total}.</p>
            )}
          </>
        )}
      </aside>

      <Modal
        isOpen={cortesiaAbierta}
        onClose={ocupado ? () => undefined : () => (setCortesiaAbierta(false), enfocar())}
        title="Ingreso de cortesía"
        maxWidth="460px"
        footer={
          <>
            <Button variant="outline" disabled={ocupado} onClick={() => (setCortesiaAbierta(false), enfocar())}>
              Cancelar
            </Button>
            <Button isLoading={ocupado} onClick={confirmarCortesia}>
              Registrar cortesía
            </Button>
          </>
        }
      >
        <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: '0.925rem', lineHeight: 1.5 }}>
          Deja entrar a alguien que no es cliente. Queda registrado a tu nombre con el motivo y el Jefe lo ve en la auditoría.
        </p>
        <Textarea
          label="Motivo"
          value={motivo}
          maxLength={255}
          autoFocus
          onChange={(e) => {
            setMotivo(e.target.value);
            setErrorCortesia(null);
          }}
          error={errorCortesia ?? undefined}
          disabled={ocupado}
        />
      </Modal>
    </div>
  );
};
