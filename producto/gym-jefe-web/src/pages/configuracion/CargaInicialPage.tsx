import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileSpreadsheet, FileText, SearchCheck, Upload } from 'lucide-react';
import { cargaInicialService } from '../../api/cargaInicial.service';
import { toApiError } from '../../api/client';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table, type Column } from '../../components/ui/Table';
import { ConfirmDialog } from '../../components/ui/Modal';
import { MensajeFijo } from '../../components/estados/Estados';
import { descargarBlob } from '../../utils/navegador';
import type {
  AplicacionCargaResponse,
  ErrorFilaCarga,
  FormatoPlantilla,
  SimulacionCargaResponse,
} from '../../types/cargaInicial.types';

const NOMBRE_COLUMNA: Record<string, string> = {
  tipo_documento: 'Tipo de documento',
  documento: 'Documento',
  nombre: 'Nombre',
  telefono: 'Teléfono',
  correo: 'Correo',
  fecha_nacimiento: 'Fecha de nacimiento',
  plan_nombre: 'Plan',
  fecha_vencimiento: 'Vencimiento',
};

const COLUMNAS_ERRORES: Column<ErrorFilaCarga>[] = [
  { header: 'Fila', accessor: 'fila', width: '80px', align: 'right' },
  { header: 'Columna', render: (e) => NOMBRE_COLUMNA[e.columna] ?? e.columna, width: '180px' },
  { header: 'Qué corregir', accessor: 'mensaje' },
];

function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString('es-CO')} ${n === 1 ? uno : varios}`;
}

/** Lee el resultado de `simular` que viene en `422 CARGA_CON_ERRORES`. */
function simulacionDeError(detalles: unknown): SimulacionCargaResponse | null {
  const d = detalles as Partial<SimulacionCargaResponse> | null;
  return d && Array.isArray(d.errores) && typeof d.filas_validas === 'number' ? (d as SimulacionCargaResponse) : null;
}

/**
 * Configuración · Carga inicial de clientes (GW-RF-55, contrato 2.4, solo Jefe).
 * Plantilla → revisión sin guardar → carga de todo o nada. Las membresías migradas no pasan por caja.
 */
export const CargaInicialPage: React.FC = () => {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [descargando, setDescargando] = useState<FormatoPlantilla | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [simulacion, setSimulacion] = useState<SimulacionCargaResponse | null>(null);
  const [resultado, setResultado] = useState<AplicacionCargaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declara, setDeclara] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const descargar = async (formato: FormatoPlantilla) => {
    if (descargando) return;
    setDescargando(formato);
    try {
      const blob = await cargaInicialService.descargarPlantilla(formato);
      descargarBlob(blob, `plantilla_carga_inicial.${formato}`);
    } catch (e) {
      showToast('error', 'No se pudo descargar la plantilla', toApiError(e).message);
    } finally {
      setDescargando(null);
    }
  };

  const elegirArchivo = (f: File | null) => {
    setArchivo(f);
    setSimulacion(null);
    setResultado(null);
    setError(null);
    setDeclara(false);
  };

  const revisar = async () => {
    if (!archivo || revisando) return;
    setRevisando(true);
    setError(null);
    setSimulacion(null);
    try {
      setSimulacion(await cargaInicialService.simular(archivo));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setRevisando(false);
    }
  };

  const aplicar = async () => {
    if (!archivo || cargando) return;
    setCargando(true);
    setError(null);
    try {
      const r = await cargaInicialService.aplicar(archivo, declara);
      setConfirmar(false);
      setResultado(r);
      setSimulacion(null);
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
      showToast('success', 'Carga completada', plural(r.deportistas_creados, 'cliente creado', 'clientes creados'));
    } catch (e) {
      const err = toApiError(e);
      setConfirmar(false);
      const sim = err.codigo === 'CARGA_CON_ERRORES' ? simulacionDeError(err.detalles) : null;
      if (sim) setSimulacion(sim);
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  const listo = simulacion !== null && simulacion.filas_con_error === 0 && simulacion.filas_validas > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Carga inicial de clientes</h1>
          <p className="page-subtitle">
            Sube de una vez los clientes que el gimnasio ya tiene, con su plan y la fecha en que vence
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 24 }}>
        <Card title="1. Descarga la plantilla">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 0 }}>
            Llena una fila por cliente. El plan debe llamarse igual que un plan activo del gimnasio y las fechas van como
            dd/mm/aaaa. Si un cliente no tiene membresía vigente, deja vacíos el plan y el vencimiento. Los menores de 18
            años se registran a mano, con su acudiente.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button
              variant="outline"
              leftIcon={<FileSpreadsheet size={16} />}
              onClick={() => descargar('xlsx')}
              isLoading={descargando === 'xlsx'}
              disabled={descargando !== null}
            >
              Plantilla Excel
            </Button>
            <Button
              variant="outline"
              leftIcon={<FileText size={16} />}
              onClick={() => descargar('csv')}
              isLoading={descargando === 'csv'}
              disabled={descargando !== null}
            >
              Plantilla CSV
            </Button>
          </div>
        </Card>

        <Card title="2. Revisa el archivo">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 0 }}>
            La revisión no guarda nada: te muestra qué filas hay que corregir. Máximo 5.000 clientes y 5 MB por archivo.
          </p>
          <div className="form-group">
            <label htmlFor="archivo-carga" style={{ fontWeight: 600 }}>
              Archivo diligenciado (.xlsx o .csv)
            </label>
            <input
              id="archivo-carga"
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              disabled={revisando || cargando}
              onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            variant="primary"
            leftIcon={<SearchCheck size={16} />}
            onClick={revisar}
            isLoading={revisando}
            disabled={!archivo || cargando}
          >
            Revisar archivo
          </Button>
        </Card>
      </div>

      {error && (
        <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
          {error}
        </MensajeFijo>
      )}

      {resultado && (
        <MensajeFijo
          tono="info"
          titulo="Carga completada"
          style={{ marginBottom: 16 }}
          accion={
            <Link to="/deportistas" className="btn btn-outline btn-sm">
              Ver clientes
            </Link>
          }
        >
          Se crearon {plural(resultado.deportistas_creados, 'cliente', 'clientes')} y{' '}
          {plural(resultado.membresias_creadas, 'membresía', 'membresías')}. Las membresías cargadas no suman a los
          ingresos ni a la caja.
        </MensajeFijo>
      )}

      {simulacion && simulacion.filas_con_error > 0 && (
        <Card title="Filas por corregir">
          <MensajeFijo tono="advertencia" style={{ marginBottom: 16 }}>
            {plural(simulacion.filas_con_error, 'fila tiene', 'filas tienen')} errores y{' '}
            {plural(simulacion.filas_validas, 'está bien', 'están bien')}. No se carga ningún cliente mientras haya
            errores: corrige el archivo y vuelve a revisarlo.
          </MensajeFijo>
          <Table
            columns={COLUMNAS_ERRORES}
            data={simulacion.errores}
            keyExtractor={(e) => `${e.fila}-${e.columna}-${e.codigo}`}
          />
        </Card>
      )}

      {listo && (
        <Card title="3. Carga los clientes">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <CheckCircle2 size={18} color="var(--success)" />
            <span style={{ fontWeight: 700 }}>
              {plural(simulacion.filas_validas, 'cliente listo', 'clientes listos')} para cargar
            </span>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={declara}
                disabled={cargando}
                onChange={(e) => setDeclara(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                Declaro que el gimnasio conserva la autorización de tratamiento de datos (Ley 1581) de todos los clientes
                de este archivo.
              </span>
            </label>
          </div>
          <Button
            variant="primary"
            leftIcon={<Upload size={16} />}
            disabled={!declara || cargando}
            onClick={() => setConfirmar(true)}
          >
            Cargar {plural(simulacion.filas_validas, 'cliente', 'clientes')}
          </Button>
        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmar}
        onClose={() => !cargando && setConfirmar(false)}
        onConfirm={aplicar}
        title="Cargar clientes"
        message={`Se crearán ${plural(simulacion?.filas_validas ?? 0, 'cliente', 'clientes')} con sus membresías. Si después hay que corregir alguno, se edita desde su ficha. ¿Continuar?`}
        confirmText="Cargar"
        isLoading={cargando}
      />
    </div>
  );
};
