import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { UserPlus, Eye, Scale, Edit2, Plus, Calculator, LineChart } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { membresiasService } from '../../api/membresias.service';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { parseApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input, SearchInput, Select } from '../../components/ui/Input';
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
import { CobroMembresiaModal, DestinoCobro } from '../membresias/CobroMembresiaModal';
import { FormularioDeportista, PlanAsignacionInicial, edadEnBogota } from './FormularioDeportista';
import { MedicionesDrawer } from '../../components/mediciones/MedicionesDrawer';

/** Días de `desde` a `hasta` (fechas de negocio `YYYY-MM-DD`), sin pasar por la zona del navegador. */
function diasEntre(desde: string, hasta: string): number {
  const utc = (f: string) => {
    const [a, m, d] = f.slice(0, 10).split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86400000);
}

type SexoMedicion = '' | 'M' | 'F' | 'otro';
type ClaveMedicionBase = 'peso' | 'cintura' | 'cadera' | 'pecho' | 'brazo' | 'pierna';

const MEDICION_BASE_VACIA: Record<ClaveMedicionBase, string> = {
  peso: '',
  cintura: '',
  cadera: '',
  pecho: '',
  brazo: '',
  pierna: '',
};

const ETIQUETAS_MEDICION_BASE: Record<ClaveMedicionBase, string> = {
  peso: 'Peso (kg)',
  cintura: 'Cintura (cm)',
  cadera: 'Cadera (cm)',
  pecho: 'Pecho (cm)',
  brazo: 'Brazo (cm)',
  pierna: 'Pierna (cm)',
};

interface MedidasDerivadas {
  grasaPct: number | null;
  clasificacionGrasa: string | null;
  masaMuscularKg: number | null;
  pctMuscular: number | null;
  masaGrasaKg: number | null;
  masaMagraKg: number | null;
  imc: number | null;
  clasificacionImc: string | null;
  icc: number | null;
  riesgoIcc: string | null;
}

/**
 * Calcula automáticamente las medidas corporales derivadas a partir de las medidas base,
 * diferenciando las ecuaciones antropométricas según el género (Hombre 'M' vs Mujer 'F').
 */
function calcularMedidasDerivadas(
  medidas: Record<ClaveMedicionBase, string>,
  sexo: SexoMedicion,
  alturaCmStr: string,
  edadAnios: number
): MedidasDerivadas {
  const esMujer = sexo === 'F';
  const altNum = Number(alturaCmStr);
  // Sin sexo (M o F) y estatura reales no se calcula nada: un valor supuesto daría una medida inventada.
  if ((sexo !== 'M' && sexo !== 'F') || !(altNum > 0)) {
    return {
      grasaPct: null,
      clasificacionGrasa: null,
      masaMuscularKg: null,
      pctMuscular: null,
      masaGrasaKg: null,
      masaMagraKg: null,
      imc: null,
      clasificacionImc: null,
      icc: null,
      riesgoIcc: null,
    };
  }
  const alt = altNum;

  const num = (v: string): number | null => {
    if (!v || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const peso = num(medidas.peso);
  const cintura = num(medidas.cintura);
  const cadera = num(medidas.cadera);
  const brazo = num(medidas.brazo);
  const pierna = num(medidas.pierna);

  // 1. IMC y clasificación
  let imc: number | null = null;
  let clasificacionImc: string | null = null;
  if (peso && alt > 0) {
    const altM = alt / 100;
    imc = Math.round((peso / (altM * altM)) * 10) / 10;
    if (imc < 18.5) clasificacionImc = 'Bajo peso';
    else if (imc < 25) clasificacionImc = 'Normal';
    else if (imc < 30) clasificacionImc = 'Sobrepeso';
    else clasificacionImc = 'Obesidad';
  }

  // 2. % de Grasa Corporal diferenciado por género (Hombre vs Mujer)
  let rfmVal: number | null = null;
  let bmiVal: number | null = null;

  if (cintura && alt > 0) {
    if (esMujer) {
      let ajusteCadera = 0;
      if (cadera) {
        ajusteCadera = Math.max(-3, Math.min(4, 0.15 * (cadera - cintura - 15)));
      }
      rfmVal = 76 - 20 * (alt / cintura) + ajusteCadera;
    } else {
      rfmVal = 64 - 20 * (alt / cintura);
    }
  }

  if (imc !== null) {
    bmiVal = 1.2 * imc + 0.23 * edadAnios - (esMujer ? 5.4 : 16.2);
  }

  let grasaCalc: number | null = null;
  if (rfmVal !== null && bmiVal !== null) {
    grasaCalc = 0.6 * rfmVal + 0.4 * bmiVal;
  } else if (rfmVal !== null) {
    grasaCalc = rfmVal;
  } else if (bmiVal !== null) {
    grasaCalc = bmiVal;
  }

  let grasaPct: number | null = null;
  let clasificacionGrasa: string | null = null;
  if (grasaCalc !== null) {
    const [minG, maxG] = esMujer ? [10, 60] : [4, 55];
    grasaPct = Math.round(Math.max(minG, Math.min(maxG, grasaCalc)) * 10) / 10;
    if (esMujer) {
      if (grasaPct < 14) clasificacionGrasa = 'Esencial';
      else if (grasaPct < 21) clasificacionGrasa = 'Atlético';
      else if (grasaPct < 25) clasificacionGrasa = 'Fitness';
      else if (grasaPct < 32) clasificacionGrasa = 'Saludable';
      else clasificacionGrasa = 'Elevado';
    } else {
      if (grasaPct < 6) clasificacionGrasa = 'Esencial';
      else if (grasaPct < 14) clasificacionGrasa = 'Atlético';
      else if (grasaPct < 18) clasificacionGrasa = 'Fitness';
      else if (grasaPct < 25) clasificacionGrasa = 'Saludable';
      else clasificacionGrasa = 'Elevado';
    }
  }

  // 3. Masa Grasa, Masa Magra y Masa Muscular Esquelética diferenciada por género
  let masaGrasaKg: number | null = null;
  let masaMagraKg: number | null = null;
  let masaMuscularKg: number | null = null;
  let pctMuscular: number | null = null;

  if (peso !== null && grasaPct !== null) {
    masaGrasaKg = Math.round(peso * (grasaPct / 100) * 10) / 10;
    const magraRaw = peso * (1 - grasaPct / 100);
    masaMagraKg = Math.round(magraRaw * 10) / 10;

    let musculoCalc: number;
    if (esMujer) {
      let ajustePerim = 0;
      if (brazo) ajustePerim += (brazo - 27) * 0.06;
      if (pierna) ajustePerim += (pierna - 52) * 0.05;
      musculoCalc = magraRaw * 0.475 + ajustePerim;
    } else {
      let ajustePerim = 0;
      if (brazo) ajustePerim += (brazo - 32) * 0.08;
      if (pierna) ajustePerim += (pierna - 54) * 0.06;
      musculoCalc = magraRaw * 0.54 + ajustePerim;
    }

    const musculoClamped = Math.max(peso * 0.25, Math.min(magraRaw * 0.9, musculoCalc));
    masaMuscularKg = Math.round(musculoClamped * 10) / 10;
    pctMuscular = Math.round((masaMuscularKg / peso) * 1000) / 10;
  }

  // 4. Índice Cintura-Cadera (ICC) diferenciado por género
  let icc: number | null = null;
  let riesgoIcc: string | null = null;
  if (cintura && cadera) {
    icc = Math.round((cintura / cadera) * 100) / 100;
    if (esMujer) {
      if (icc < 0.8) riesgoIcc = 'Riesgo bajo';
      else if (icc <= 0.85) riesgoIcc = 'Riesgo moderado';
      else riesgoIcc = 'Riesgo alto';
    } else {
      if (icc < 0.9) riesgoIcc = 'Riesgo bajo';
      else if (icc <= 0.99) riesgoIcc = 'Riesgo moderado';
      else riesgoIcc = 'Riesgo alto';
    }
  }

  return {
    grasaPct,
    clasificacionGrasa,
    masaMuscularKg,
    pctMuscular,
    masaGrasaKg,
    masaMagraKg,
    imc,
    clasificacionImc,
    icc,
    riesgoIcc,
  };
}

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
  const [cobro, setCobro] = useState<DestinoCobro | null>(null);

  // Ficha 360°
  const [selectedDeportistaId, setSelectedDeportistaId] = useState<string | null>(null);
  const [ficha, setFicha] = useState<FichaDeportistaResponse | null>(null);
  const [errorFicha, setErrorFicha] = useState<unknown>(null);

  // Medición
  const [medicionAbierta, setMedicionAbierta] = useState(false);
  const medicionRef = useRef<HTMLDivElement>(null);
  const [medicionBase, setMedicionBase] = useState<Record<ClaveMedicionBase, string>>(MEDICION_BASE_VACIA);
  const [sexoMedicion, setSexoMedicion] = useState<SexoMedicion>('');
  const [alturaMedicion, setAlturaMedicion] = useState('');
  const [errorMedicion, setErrorMedicion] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Progreso de mediciones (panel propio, abre desde la lista o la ficha)
  const [medicionesDe, setMedicionesDe] = useState<{ id: string; nombre: string } | null>(null);

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

  const trasGuardar = (d: DeportistaResponse, seleccionPlan?: PlanAsignacionInicial) => {
    const eraEdicion = !!editando;
    setFormAbierto(false);
    setEditando(null);
    loadDeportistas();
    if (selectedDeportistaId === d.id) cargarFicha(d.id);

    if (!eraEdicion && seleccionPlan) {
      showToast('success', 'Deportista registrado', 'Completa el cobro para activar su membresía');
      setCobro({
        tipo: 'venta',
        titulo: d.nombre,
        detalle: `${seleccionPlan.plan.nombre} · ${seleccionPlan.plan.duracion_dias} días desde ${formatFechaNegocio(seleccionPlan.fechaInicio ?? hoyBogota())}`,
        precioLista: Math.round(Number(seleccionPlan.plan.precio)),
        registrar: async (pago, clave) => {
          const nueva = await membresiasService.asignarPlan(
            {
              deportista_id: d.id,
              plan_id: seleccionPlan.plan.id,
              fecha_inicio: seleccionPlan.fechaInicio,
              pago,
            },
            clave
          );
          return nueva.pago!;
        },
      });
    } else {
      showToast('success', eraEdicion ? 'Deportista actualizado' : 'Deportista registrado', d.nombre);
    }
  };

  const recargarEdicion = async () => {
    if (!editando) return;
    const data = await cargarFicha(editando.id);
    if (data) setEditando(data.deportista);
  };

  const dep = ficha?.deportista;

  const edadDeportista = useMemo(() => {
    if (!dep?.fecha_nacimiento) return 28;
    const e = edadEnBogota(dep.fecha_nacimiento);
    return e !== null && e > 0 ? e : 28;
  }, [dep?.fecha_nacimiento]);

  const derivadas = useMemo(
    () => calcularMedidasDerivadas(medicionBase, sexoMedicion, alturaMedicion, edadDeportista),
    [medicionBase, sexoMedicion, alturaMedicion, edadDeportista]
  );

  const handleRegistrarMedicion = async () => {
    if (!selectedDeportistaId || isProcessing) return;
    const altNum = Number(alturaMedicion);
    if (!sexoMedicion || !Number.isFinite(altNum) || altNum <= 0) {
      setErrorMedicion('Indica el sexo y la estatura del deportista para registrar la medición.');
      return;
    }
    const data: RegistrarMedicionRequest = { sexo: sexoMedicion, altura_cm: altNum };

    let tieneMedidaBase = false;
    for (const [k, val] of Object.entries(medicionBase) as Array<[ClaveMedicionBase, string]>) {
      if (val.trim() !== '') {
        const n = Number(val);
        if (!Number.isFinite(n) || n <= 0) {
          setErrorMedicion(`El valor de "${ETIQUETAS_MEDICION_BASE[k]}" debe ser mayor a 0.`);
          return;
        }
        data[k] = n;
        tieneMedidaBase = true;
      }
    }

    if (!tieneMedidaBase) {
      setErrorMedicion('Ingresa al menos una medida corporal base (ej. Peso o Cintura) para calcular las medidas derivadas.');
      return;
    }

    if (derivadas.grasaPct !== null) {
      data.grasa_pct = derivadas.grasaPct;
    }
    if (derivadas.masaMuscularKg !== null) {
      data.masa_muscular = derivadas.masaMuscularKg;
    }

    setIsProcessing(true);
    setErrorMedicion(null);
    try {
      await deportistasService.registrarMedicion(selectedDeportistaId, data);
      showToast('success', 'Medición guardada', 'Las medidas base y derivadas quedaron registradas en la ficha.');
      setMedicionAbierta(false);
      setMedicionBase(MEDICION_BASE_VACIA);
      cargarFicha(selectedDeportistaId);
    } catch (err) {
      setErrorMedicion(parseApiError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const detalleEstado = (d: DeportistaResumenResponse) =>
    d.fecha_vencimiento ? { dias: diasEntre(hoyBogota(), d.fecha_vencimiento) } : {};

  const abrirMedicion = () => {
    setMedicionBase(MEDICION_BASE_VACIA);
    setSexoMedicion((dep?.sexo as SexoMedicion) ?? '');
    setAlturaMedicion(dep?.altura_cm ? String(dep.altura_cm) : '');
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
              width: '300px',
              render: (d) => (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<LineChart size={13} />}
                    onClick={() => setMedicionesDe({ id: d.id, nombre: d.nombre })}
                  >
                    Mediciones
                  </Button>
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

      <CobroMembresiaModal
        destino={cobro}
        onCerrar={() => setCobro(null)}
        onCobrado={() => {
          showToast('success', 'Membresía asignada', cobro?.titulo ?? '');
          loadDeportistas();
          if (selectedDeportistaId) cargarFicha(selectedDeportistaId);
        }}
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
                <Dato etiqueta="Género">
                  {dep.sexo === 'M'
                    ? 'Hombre (Masculino)'
                    : dep.sexo === 'F'
                    ? 'Mujer (Femenino)'
                    : dep.sexo === 'otro'
                    ? 'Otro'
                    : '—'}
                </Dato>
                <Dato etiqueta="Estatura">{dep.altura_cm ? `${dep.altura_cm} cm` : '—'}</Dato>
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
                <div style={{ display: 'flex', gap: 6 }}>
                  {ficha.mediciones_recientes.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<LineChart size={14} />}
                      onClick={() => {
                        setSelectedDeportistaId(null);
                        setMedicionesDe({ id: ficha.deportista.id, nombre: ficha.deportista.nombre });
                      }}
                    >
                      Ver progreso
                    </Button>
                  )}
                  {puedeCrear && !medicionAbierta && (
                    <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={abrirMedicion}>
                      Registrar medición
                    </Button>
                  )}
                </div>
              </div>

              {medicionAbierta && (
                <div className="form-callout" ref={medicionRef} style={{ marginTop: 0, marginBottom: 16 }}>
                  <div className="form-callout-head">
                    <Scale size={16} />
                    <span>Nueva medición · {formatFechaNegocio(hoyBogota())}</span>
                  </div>

                  {/* 1. Parámetros antropométricos base (Género y Estatura) */}
                  <div
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: 8,
                    }}
                  >
                    1. Parámetros para el cálculo según género
                  </div>
                  <div className="form-grid form-grid-movil-2" style={{ marginBottom: 14 }}>
                    <div className="col-2">
                      <Select
                        id="medicion-sexo"
                        label="Género para el cálculo"
                        value={sexoMedicion}
                        onChange={(e) => setSexoMedicion(e.target.value as SexoMedicion)}
                        options={[
                          { value: 'M', label: 'Hombre (Masculino)' },
                          { value: 'F', label: 'Mujer (Femenino)' },
                        ]}
                        hint={
                          sexoMedicion === 'F'
                            ? 'Fórmula antropométrica femenina (ajuste cintura-cadera y masa magra mujer)'
                            : 'Fórmula antropométrica masculina (ajuste abdominal y masa magra hombre)'
                        }
                      />
                    </div>
                    <div className="col-2">
                      <Input
                        id="medicion-altura"
                        label="Estatura base (cm)"
                        type="number"
                        inputMode="decimal"
                        min={80}
                        max={250}
                        step="0.5"
                        value={alturaMedicion}
                        onChange={(e) => setAlturaMedicion(e.target.value)}
                        hint="Usada para calcular IMC y % de grasa"
                      />
                    </div>
                  </div>

                  {/* 2. Medidas corporales base (ingreso manual) */}
                  <div
                    style={{
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: 8,
                    }}
                  >
                    2. Medidas corporales base (ingreso manual)
                  </div>
                  <div className="form-grid form-grid-movil-2">
                    {(Object.keys(MEDICION_BASE_VACIA) as ClaveMedicionBase[]).map((k) => (
                      <div className="col-2" key={k}>
                        <Input
                          id={`medicion-${k}`}
                          label={ETIQUETAS_MEDICION_BASE[k]}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.1"
                          value={medicionBase[k]}
                          onChange={(e) => setMedicionBase((m) => ({ ...m, [k]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>

                  {/* 3. Medidas derivadas calculadas automáticamente según género */}
                  <div
                    style={{
                      marginTop: 16,
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 'var(--fs-xs)',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Calculator size={14} />
                        <span>
                          Medidas derivadas (cálculo automático · {sexoMedicion === 'F' ? 'Mujer' : 'Hombre'})
                        </span>
                      </div>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        Calculadas automáticamente
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>% Grasa corporal</div>
                        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                          {derivadas.grasaPct !== null ? `${derivadas.grasaPct} %` : '—'}
                        </div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                          {derivadas.clasificacionGrasa
                            ? `${derivadas.clasificacionGrasa}${derivadas.masaGrasaKg !== null ? ` · ${derivadas.masaGrasaKg} kg` : ''}`
                            : 'Ingresa peso o cintura'}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Masa muscular</div>
                        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                          {derivadas.masaMuscularKg !== null ? `${derivadas.masaMuscularKg} kg` : '—'}
                        </div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                          {derivadas.pctMuscular !== null
                            ? `${derivadas.pctMuscular}% del peso total`
                            : 'Requiere peso corporal'}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>IMC (kg/m²)</div>
                        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                          {derivadas.imc !== null ? derivadas.imc : '—'}
                        </div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                          {derivadas.clasificacionImc ?? 'Peso / estatura²'}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Masa magra / ICC</div>
                        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                          {derivadas.masaMagraKg !== null
                            ? `${derivadas.masaMagraKg} kg`
                            : derivadas.icc !== null
                            ? `ICC ${derivadas.icc}`
                            : '—'}
                        </div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                          {derivadas.icc !== null
                            ? `ICC ${derivadas.icc} · ${derivadas.riesgoIcc}`
                            : 'Libre de grasa / Cintura-Cadera'}
                        </div>
                      </div>
                    </div>
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
                        <th>% Grasa (calc.)</th>
                        <th>Músculo (calc.)</th>
                        <th>Cintura / Cadera</th>
                        <th>Brazo / Pierna / Pecho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.mediciones_recientes.map((m) => (
                        <tr key={m.id}>
                          <td>{formatFechaNegocio(m.fecha)}</td>
                          <td>{numero(m.peso, 'kg')}</td>
                          <td>{numero(m.grasa_pct, '%')}</td>
                          <td>{numero(m.masa_muscular, 'kg')}</td>
                          <td>
                            {m.cintura || m.cadera
                              ? `${m.cintura ?? '—'} / ${m.cadera ?? '—'} cm`
                              : '—'}
                          </td>
                          <td>
                            {m.brazo || m.pierna || m.pecho
                              ? `${m.brazo ?? '—'} / ${m.pierna ?? '—'} / ${m.pecho ?? '—'} cm`
                              : '—'}
                          </td>
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

      <MedicionesDrawer deportista={medicionesDe} onClose={() => setMedicionesDe(null)} />
    </div>
  );
};
