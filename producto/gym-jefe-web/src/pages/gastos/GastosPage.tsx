import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Receipt, Settings2, Wallet } from 'lucide-react';
import { gastosService } from '../../api/gastos.service';
import { parseApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card, KpiCard } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Table } from '../../components/ui/Table';
import { ErrorCarga, MensajeFijo, VacioInicial } from '../../components/estados/Estados';
import { formatCOP } from '../../utils/formato';
import { formatFechaNegocio, hoyBogota, inicioMesBogota } from '../../utils/fechasBogota';
import type {
  BeneficiarioStaff,
  EsquemaPago,
  Gasto,
  LiquidacionEntrenador,
  ReporteResultado,
} from '../../types/gastos.types';

type Pestana = 'gastos' | 'resultado' | 'entrenadores';

const CATEGORIAS = ['Arriendo', 'Servicios públicos', 'Mantenimiento', 'Aseo', 'Publicidad', 'Nómina', 'Compras', 'Otros'];
const POR_PAGINA = 20;

const ESQUEMA_TEXTO: Record<EsquemaPago, string> = {
  fijo: 'Sueldo fijo',
  por_clase: 'Por clase dictada',
  comision: 'Comisión',
};
const BASE_TEXTO: Record<string, string> = {
  membresias_vendidas: 'membresías que vendió',
  clientes_asignados: 'clientes asignados',
};

const entero = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

function describirEsquema(l: LiquidacionEntrenador): string {
  if (!l.esquema) return 'Sin configurar';
  if (l.esquema === 'fijo') return `Sueldo fijo de ${formatCOP(l.valor ?? 0)}`;
  if (l.esquema === 'por_clase') return `${formatCOP(l.valor ?? 0)} por clase · ${l.clases_dictadas} dictadas`;
  return `${Number(l.valor)} % sobre ${BASE_TEXTO[l.base_comision ?? ''] ?? ''} (${formatCOP(l.base_calculo)})`;
}

/** Gastos, resultado del periodo y pago a entrenadores (decisiones de Juan del 27-oct-2026). */
export const GastosPage: React.FC = () => {
  const { hasPermission, isJefe } = useAuth();
  const { showToast } = useToast();
  const puedeCrear = hasPermission('gastos', 'crear');

  const [pestana, setPestana] = useState<Pestana>('gastos');
  const [desde, setDesde] = useState(inicioMesBogota());
  const [hasta, setHasta] = useState(hoyBogota());
  const rangoValido = !!desde && !!hasta && hasta >= desde;

  // Gastos
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [total, setTotal] = useState(0);
  const [suma, setSuma] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Resultado y entrenadores
  const [resultado, setResultado] = useState<ReporteResultado | null>(null);
  const [entrenadores, setEntrenadores] = useState<LiquidacionEntrenador[]>([]);

  // Formulario de gasto
  const [abierto, setAbierto] = useState(false);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioStaff[]>([]);
  const [categoria, setCategoria] = useState(CATEGORIAS[0]);
  const [descripcion, setDescripcion] = useState('');
  const [tipoBeneficiario, setTipoBeneficiario] = useState<'staff' | 'externo'>('externo');
  const [staffBeneficiario, setStaffBeneficiario] = useState('');
  const [nombreExterno, setNombreExterno] = useState('');
  const [metodo, setMetodo] = useState<'efectivo' | 'transferencia'>('transferencia');
  const [monto, setMonto] = useState('');
  const [clave, setClave] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  // Configurar y pagar entrenador
  const [aConfigurar, setAConfigurar] = useState<LiquidacionEntrenador | null>(null);
  const [esquema, setEsquema] = useState<EsquemaPago>('fijo');
  const [valor, setValor] = useState('');
  const [baseComision, setBaseComision] = useState('membresias_vendidas');
  const [aPagar, setAPagar] = useState<LiquidacionEntrenador | null>(null);
  const [montoPago, setMontoPago] = useState('');
  const [metodoPago, setMetodoPago] = useState<'efectivo' | 'transferencia'>('transferencia');

  const cargar = useCallback(async () => {
    if (!desde || !hasta || hasta < desde) return;
    setCargando(true);
    try {
      if (pestana === 'gastos') {
        const res = await gastosService.listar({ desde, hasta, limit: POR_PAGINA, offset: (pagina - 1) * POR_PAGINA });
        setGastos(res.items);
        setTotal(res.total);
        setSuma(Number(res.suma));
      } else if (pestana === 'resultado') {
        setResultado(await gastosService.resultado({ desde, hasta }));
      } else {
        setEntrenadores(await gastosService.liquidaciones({ desde, hasta }));
      }
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [pestana, desde, hasta, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    setPagina(1);
  }, [desde, hasta]);

  const abrirFormulario = () => {
    setCategoria(CATEGORIAS[0]);
    setDescripcion('');
    setTipoBeneficiario('externo');
    setStaffBeneficiario('');
    setNombreExterno('');
    setMetodo('transferencia');
    setMonto('');
    setClave(null);
    setErrorForm(null);
    setAbierto(true);
    gastosService.beneficiarios().then(setBeneficiarios).catch(() => setBeneficiarios([]));
  };

  const guardarGasto = async () => {
    const valorMonto = entero(monto);
    if (!categoria.trim()) return setErrorForm('Elige la categoría.');
    if (!valorMonto || valorMonto <= 0) return setErrorForm('Escribe el valor del gasto.');
    if (tipoBeneficiario === 'staff' && !staffBeneficiario) return setErrorForm('Elige a la persona del equipo.');
    if (tipoBeneficiario === 'externo' && nombreExterno.trim().length < 2) return setErrorForm('Escribe a quién se le paga.');
    const claveUsada = clave ?? crypto.randomUUID();
    setClave(claveUsada);
    setEnviando(true);
    setErrorForm(null);
    try {
      await gastosService.registrar(
        {
          categoria: categoria.trim(),
          descripcion: descripcion.trim() || undefined,
          beneficiario_tipo: tipoBeneficiario,
          beneficiario_staff_id: tipoBeneficiario === 'staff' ? staffBeneficiario : undefined,
          beneficiario_nombre: tipoBeneficiario === 'externo' ? nombreExterno.trim() : undefined,
          metodo,
          monto: valorMonto,
        },
        claveUsada
      );
      showToast('success', 'Gasto registrado', formatCOP(valorMonto));
      setAbierto(false);
      cargar();
    } catch (e) {
      setErrorForm(parseApiError(e));
    } finally {
      setEnviando(false);
    }
  };

  const abrirConfig = (l: LiquidacionEntrenador) => {
    setAConfigurar(l);
    setEsquema(l.esquema ?? 'fijo');
    setValor(l.valor !== null && l.valor !== undefined ? String(Math.round(Number(l.valor))) : '');
    setBaseComision(l.base_comision ?? 'membresias_vendidas');
    setErrorForm(null);
  };

  const guardarConfig = async () => {
    if (!aConfigurar) return;
    const v = entero(valor);
    if (v === null || v < 0) return setErrorForm('Escribe el valor.');
    if (esquema === 'comision' && v > 100) return setErrorForm('La comisión no puede superar el 100 %.');
    setEnviando(true);
    setErrorForm(null);
    try {
      await gastosService.configurarPago(aConfigurar.staff_id, {
        esquema,
        valor: v,
        base_comision: esquema === 'comision' ? (baseComision as 'membresias_vendidas' | 'clientes_asignados') : null,
      });
      showToast('success', 'Pago configurado', aConfigurar.nombre);
      setAConfigurar(null);
      cargar();
    } catch (e) {
      setErrorForm(parseApiError(e));
    } finally {
      setEnviando(false);
    }
  };

  const abrirPago = (l: LiquidacionEntrenador) => {
    setAPagar(l);
    setMontoPago(String(Math.round(Number(l.saldo))));
    setMetodoPago('transferencia');
    setClave(null);
    setErrorForm(null);
  };

  const guardarPago = async () => {
    if (!aPagar) return;
    const v = entero(montoPago);
    if (!v || v <= 0) return setErrorForm('Escribe el valor a pagar.');
    const claveUsada = clave ?? crypto.randomUUID();
    setClave(claveUsada);
    setEnviando(true);
    setErrorForm(null);
    try {
      await gastosService.pagarEntrenador(aPagar.staff_id, { desde, hasta, monto: v, metodo: metodoPago }, claveUsada);
      showToast('success', 'Pago registrado', `${aPagar.nombre} · ${formatCOP(v)}`);
      setAPagar(null);
      cargar();
    } catch (e) {
      setErrorForm(parseApiError(e));
    } finally {
      setEnviando(false);
    }
  };

  const selectorMetodo = (actual: string, cambiar: (m: 'efectivo' | 'transferencia') => void) => (
    <div className="form-group" role="radiogroup" aria-label="Método">
      <span className="form-label">¿Cómo se paga?</span>
      <div className="segmented">
        {(
          [
            ['transferencia', 'Transferencia'],
            ['efectivo', 'Efectivo de la caja'],
          ] as const
        ).map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={actual === v} className={actual === v ? 'active' : ''} onClick={() => cambiar(v)}>
            {t}
          </button>
        ))}
      </div>
      {actual === 'efectivo' && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Sale del turno de caja que tengas abierto y se descuenta del arqueo.
        </p>
      )}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gastos</h1>
          <p className="page-subtitle">Lo que sale del gimnasio y cuánto queda después de ingresos y gastos</p>
        </div>
        {pestana === 'gastos' && puedeCrear && (
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={abrirFormulario}>
            Registrar gasto
          </Button>
        )}
      </div>

      <div className="tabs-nav">
        <button className={`tab-btn ${pestana === 'gastos' ? 'active' : ''}`} onClick={() => setPestana('gastos')}>
          Gastos
        </button>
        <button className={`tab-btn ${pestana === 'resultado' ? 'active' : ''}`} onClick={() => setPestana('resultado')}>
          Ingresos menos gastos
        </button>
        {isJefe && (
          <button className={`tab-btn ${pestana === 'entrenadores' ? 'active' : ''}`} onClick={() => setPestana('entrenadores')}>
            Pago a entrenadores
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
      </div>

      {!rangoValido ? (
        <MensajeFijo tono="advertencia">Elige un rango válido: la fecha inicial no puede ser posterior a la final.</MensajeFijo>
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : pestana === 'gastos' ? (
        <>
          <div className="kpi-grid">
            <KpiCard label="Total de gastos" value={formatCOP(suma)} icon={<Wallet size={20} />} />
            <KpiCard label="Registros" value={total} icon={<Receipt size={20} />} />
          </div>
          <Card>
            <Table<Gasto>
              columns={[
                { header: 'Fecha', accessor: (g) => formatFechaNegocio(g.fecha), width: '120px' },
                {
                  header: 'Categoría',
                  render: (g) => (
                    <div>
                      <div style={{ fontWeight: 500 }}>{g.categoria}</div>
                      {g.descripcion && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{g.descripcion}</div>}
                    </div>
                  ),
                },
                { header: 'Beneficiario', accessor: (g) => g.beneficiario_nombre },
                {
                  header: 'Método',
                  render: (g) => <Badge variant={g.metodo === 'efectivo' ? 'warning' : 'info'}>{g.metodo === 'efectivo' ? 'Efectivo de caja' : 'Transferencia'}</Badge>,
                },
                { header: 'Registró', accessor: (g) => g.registrado_por_nombre ?? '—' },
                { header: 'Valor', align: 'right', accessor: (g) => formatCOP(g.monto) },
              ]}
              data={gastos}
              isLoading={cargando}
              keyExtractor={(g) => g.id}
              emptyMessage="No hay gastos en estas fechas."
              pagination={{ currentPage: pagina, totalPages: Math.max(1, Math.ceil(total / POR_PAGINA)), onPageChange: setPagina }}
            />
          </Card>
        </>
      ) : pestana === 'resultado' ? (
        resultado && (
          <>
            <div className="kpi-grid">
              <KpiCard label="Ingresos" value={formatCOP(resultado.ingresos)} icon={<Wallet size={20} />} />
              <KpiCard label="Gastos" value={formatCOP(resultado.gastos)} icon={<Receipt size={20} />} />
              <KpiCard label="Resultado" value={formatCOP(resultado.resultado)} icon={<Wallet size={20} />} />
            </div>
            <Card title="Gastos por categoría">
              {Object.keys(resultado.gastos_por_categoria).length === 0 ? (
                <p className="texto-vacio">No hay gastos en estas fechas.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {Object.entries(resultado.gastos_por_categoria).map(([c, v]) => (
                      <tr key={c}>
                        <td style={{ padding: '8px 0' }}>{c}</td>
                        <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 500 }}>{formatCOP(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )
      ) : entrenadores.length === 0 && !cargando ? (
        <Card>
          <VacioInicial titulo="No hay entrenadores activos" descripcion="Crea entrenadores en Personal · Equipo para configurar cómo se les paga." />
        </Card>
      ) : (
        <Card>
          <Table<LiquidacionEntrenador>
            columns={[
              { header: 'Entrenador', accessor: (l) => l.nombre },
              { header: 'Cómo se le paga', accessor: describirEsquema },
              { header: 'Calculado', align: 'right', accessor: (l) => formatCOP(l.monto_calculado) },
              { header: 'Pagado', align: 'right', accessor: (l) => formatCOP(l.pagado) },
              { header: 'Se le debe', align: 'right', render: (l) => <strong>{formatCOP(l.saldo)}</strong> },
              {
                header: '',
                align: 'right',
                render: (l) => (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" leftIcon={<Settings2 size={14} />} onClick={() => abrirConfig(l)}>
                      Configurar
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => abrirPago(l)} disabled={!l.esquema}>
                      Pagar
                    </Button>
                  </div>
                ),
              },
            ]}
            data={entrenadores}
            isLoading={cargando}
            keyExtractor={(l) => l.staff_id}
          />
        </Card>
      )}

      <Modal
        isOpen={abierto}
        onClose={() => !enviando && setAbierto(false)}
        title="Registrar gasto"
        footer={
          <>
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardarGasto} isLoading={enviando}>
              Registrar gasto
            </Button>
          </>
        }
      >
        <Select label="Categoría *" value={categoria} onChange={(e) => setCategoria(e.target.value)} options={CATEGORIAS.map((c) => ({ value: c, label: c }))} />
        <Input label="Detalle" value={descripcion} maxLength={255} onChange={(e) => setDescripcion(e.target.value)} />
        <Select
          label="¿A quién se le paga? *"
          value={tipoBeneficiario}
          onChange={(e) => setTipoBeneficiario(e.target.value as 'staff' | 'externo')}
          options={[
            { value: 'externo', label: 'Externo' },
            { value: 'staff', label: 'Alguien del equipo' },
          ]}
        />
        {tipoBeneficiario === 'staff' ? (
          <Select
            label="Persona *"
            value={staffBeneficiario}
            onChange={(e) => setStaffBeneficiario(e.target.value)}
            options={[{ value: '', label: 'Selecciona' }, ...beneficiarios.map((b) => ({ value: b.id, label: b.nombre }))]}
          />
        ) : (
          <Input label="Nombre *" value={nombreExterno} maxLength={150} onChange={(e) => setNombreExterno(e.target.value)} />
        )}
        {selectorMetodo(metodo, setMetodo)}
        <Input label="Valor (COP) *" moneda value={monto} onChange={(e) => setMonto(e.target.value)} />
        {errorForm && <MensajeFijo tono="error">{errorForm}</MensajeFijo>}
      </Modal>

      <Modal
        isOpen={!!aConfigurar}
        onClose={() => !enviando && setAConfigurar(null)}
        title={`Cómo se le paga a ${aConfigurar?.nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAConfigurar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardarConfig} isLoading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        <Select
          label="Esquema de pago"
          value={esquema}
          onChange={(e) => {
            setEsquema(e.target.value as EsquemaPago);
            setValor('');
          }}
          options={(Object.keys(ESQUEMA_TEXTO) as EsquemaPago[]).map((k) => ({ value: k, label: ESQUEMA_TEXTO[k] }))}
        />
        {esquema === 'comision' ? (
          <>
            <Input label="Porcentaje de comisión *" type="number" min={0} max={100} value={valor} onChange={(e) => setValor(e.target.value)} />
            <Select
              label="¿Sobre qué se calcula?"
              value={baseComision}
              onChange={(e) => setBaseComision(e.target.value)}
              options={[
                { value: 'membresias_vendidas', label: 'Membresías que él vendió' },
                { value: 'clientes_asignados', label: 'Pagos de sus clientes asignados (con rutina activa de él)' },
              ]}
            />
          </>
        ) : (
          <Input label={esquema === 'fijo' ? 'Sueldo del periodo (COP) *' : 'Valor por clase dictada (COP) *'} moneda value={valor} onChange={(e) => setValor(e.target.value)} />
        )}
        {errorForm && <MensajeFijo tono="error">{errorForm}</MensajeFijo>}
      </Modal>

      <Modal
        isOpen={!!aPagar}
        onClose={() => !enviando && setAPagar(null)}
        title={`Pagar a ${aPagar?.nombre ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setAPagar(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardarPago} isLoading={enviando}>
              Registrar pago
            </Button>
          </>
        }
      >
        {aPagar && (
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 0 }}>
            Periodo del {formatFechaNegocio(desde)} al {formatFechaNegocio(hasta)}. Calculado {formatCOP(aPagar.monto_calculado)}, ya pagado {formatCOP(aPagar.pagado)}.
          </p>
        )}
        {selectorMetodo(metodoPago, setMetodoPago)}
        <Input label="Valor a pagar (COP) *" moneda value={montoPago} onChange={(e) => setMontoPago(e.target.value)} />
        {errorForm && <MensajeFijo tono="error">{errorForm}</MensajeFijo>}
      </Modal>
    </div>
  );
};
