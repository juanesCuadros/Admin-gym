import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Scale } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { parseApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Drawer } from '../ui/Drawer';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { Cargando, ErrorCarga, MensajeFijo } from '../estados/Estados';
import { formatFechaNegocio, hoyBogota } from '../../utils/fechasBogota';
import type { MedicionCorporalResponse } from '../../types/deportistas.types';
import {
  CAMPOS_FORMULARIO,
  CAMPOS_MEDICION,
  type CampoMedicion,
  ETIQUETAS_MEDICION,
  MEDICION_VACIA,
  UNIDAD_MEDICION,
  formularioAMedicion,
} from './medidas';

interface MedicionesDrawerProps {
  deportista: { id: string; nombre: string } | null;
  onClose: () => void;
  /** Tras registrar una medición (para refrescar la ficha si está abierta). */
  onRegistrada?: () => void;
}

/** El backend serializa los decimales como texto: se convierten aquí. */
const valor = (m: MedicionCorporalResponse, campo: CampoMedicion): number | null => {
  const v = m[campo];
  if (v === null || v === undefined || (v as unknown) === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });

/** Línea de evolución de una medida; el eje X respeta la distancia real entre fechas. */
const GraficaMedida: React.FC<{ puntos: Array<{ fecha: string; v: number }>; unidad: string; etiqueta: string }> = ({
  puntos,
  unidad,
  etiqueta,
}) => {
  const W = 600;
  const H = 220;
  const pad = { izq: 48, der: 16, arr: 16, aba: 30 };
  const dia = (f: string) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 86400000;
  const xs = puntos.map((p) => dia(p.fecha));
  const vs = puntos.map((p) => p.v);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...vs), Math.max(...vs)];
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  }
  const margen = (y1 - y0) * 0.1;
  y0 -= margen;
  y1 += margen;
  const px = (x: number) => (x1 === x0 ? (pad.izq + W - pad.der) / 2 : pad.izq + ((x - x0) / (x1 - x0)) * (W - pad.izq - pad.der));
  const py = (y: number) => pad.arr + (1 - (y - y0) / (y1 - y0)) * (H - pad.arr - pad.aba);
  const ruta = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(xs[i]).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${etiqueta}: de ${fmt(vs[0])} a ${fmt(vs[vs.length - 1])} ${unidad}`}
      style={{ display: 'block' }}
    >
      {[y1 - margen, (y0 + y1) / 2, y0 + margen].map((t) => (
        <g key={t}>
          <line x1={pad.izq} x2={W - pad.der} y1={py(t)} y2={py(t)} stroke="var(--border-color)" strokeDasharray="3 4" />
          <text x={pad.izq - 8} y={py(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
            {fmt(t)}
          </text>
        </g>
      ))}
      <path d={ruta} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" />
      {puntos.map((p, i) => (
        <circle key={`${p.fecha}-${i}`} cx={px(xs[i])} cy={py(p.v)} r={4} fill="var(--primary)">
          <title>{`${formatFechaNegocio(p.fecha)}: ${fmt(p.v)} ${unidad}`}</title>
        </circle>
      ))}
      <text x={pad.izq} y={H - 8} fontSize="11" fill="var(--text-muted)">
        {formatFechaNegocio(puntos[0].fecha)}
      </text>
      <text x={W - pad.der} y={H - 8} fontSize="11" fill="var(--text-muted)" textAnchor="end">
        {formatFechaNegocio(puntos[puntos.length - 1].fecha)}
      </text>
    </svg>
  );
};

/**
 * Mediciones del deportista (GW-RF-21): registrar, ver el progreso en gráfica y el historial completo.
 * Se abre desde Deportistas (lista y ficha) y desde Entrenamiento.
 */
export const MedicionesDrawer: React.FC<MedicionesDrawerProps> = ({ deportista, onClose, onRegistrada }) => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeRegistrar = hasPermission('deportistas', 'crear');

  const [mediciones, setMediciones] = useState<MedicionCorporalResponse[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pestana, setPestana] = useState<'progreso' | 'historial'>('progreso');
  const [campo, setCampo] = useState<CampoMedicion>('peso');

  const [formAbierto, setFormAbierto] = useState(false);
  const [form, setForm] = useState(MEDICION_VACIA);
  const [sexo, setSexo] = useState('');
  const [estatura, setEstatura] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviandoRef = useRef(false);

  // Se depende del id, no del objeto: quien abre el panel puede pasar un objeto nuevo en cada render.
  const deportistaId = deportista?.id ?? null;

  const cargar = useCallback(async () => {
    if (!deportistaId) return;
    setCargando(true);
    try {
      const data = await deportistasService.getMediciones(deportistaId);
      setMediciones([...data].sort((a, b) => (a.fecha === b.fecha ? a.created_at.localeCompare(b.created_at) : a.fecha.localeCompare(b.fecha))));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [deportistaId]);

  useEffect(() => {
    if (!deportistaId) return;
    setMediciones([]);
    setFormAbierto(false);
    setPestana('progreso');
    setSexo('');
    setEstatura('');
    cargar();
    // Si la ficha ya los tiene, no se vuelven a pedir.
    deportistasService
      .getFicha(deportistaId)
      .then((ficha) => {
        setSexo(ficha.deportista.sexo ?? '');
        setEstatura(ficha.deportista.altura_cm ? String(ficha.deportista.altura_cm) : '');
      })
      .catch(() => undefined);
  }, [deportistaId, cargar]);

  // Medidas con al menos un dato: solo esas se ofrecen en la gráfica.
  const conDatos = useMemo(
    () => CAMPOS_MEDICION.filter((c) => mediciones.some((m) => valor(m, c) !== null)),
    [mediciones]
  );
  useEffect(() => {
    if (conDatos.length > 0 && !conDatos.includes(campo)) setCampo(conDatos[0]);
  }, [conDatos, campo]);

  const puntos = mediciones
    .map((m) => ({ fecha: m.fecha, v: valor(m, campo) }))
    .filter((p): p is { fecha: string; v: number } => p.v !== null);

  const guardar = async () => {
    if (!deportista || enviandoRef.current) return;
    const data = formularioAMedicion(form);
    if (!data) {
      setErrorForm('Escribe al menos una medida.');
      return;
    }
    if (!sexo || !(Number(estatura) > 0)) {
      setErrorForm('Indica el sexo y la estatura: con ellos se calculan la grasa y el músculo.');
      return;
    }
    data.sexo = sexo as 'M' | 'F' | 'otro';
    data.altura_cm = Number(estatura);
    enviandoRef.current = true;
    setGuardando(true);
    setErrorForm(null);
    try {
      await deportistasService.registrarMedicion(deportista.id, data);
      showToast('success', 'Medición guardada', deportista.nombre);
      setFormAbierto(false);
      setForm(MEDICION_VACIA);
      cargar();
      onRegistrada?.();
    } catch (err) {
      setErrorForm(parseApiError(err));
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  };

  const cerrar = () => {
    if (guardando) return;
    onClose();
  };

  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const cambio = primero && ultimo && puntos.length > 1 ? ultimo.v - primero.v : null;

  return (
    <Drawer isOpen={!!deportista} onClose={cerrar} title="Mediciones" subtitle={deportista?.nombre} size="lg">
      {puedeRegistrar && !formAbierto && (
        <div style={{ marginBottom: 16 }}>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => {
              setForm(MEDICION_VACIA);
              setErrorForm(null);
              setFormAbierto(true);
            }}
          >
            Registrar medición
          </Button>
        </div>
      )}

      {formAbierto && (
        <div className="form-callout" style={{ marginTop: 0, marginBottom: 16 }}>
          <div className="form-callout-head">
            <Scale size={16} />
            <span>Nueva medición · {formatFechaNegocio(hoyBogota())}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Sexo *"
              value={sexo}
              disabled={guardando}
              onChange={(e) => setSexo(e.target.value)}
              options={[
                { value: '', label: 'Selecciona' },
                { value: 'F', label: 'Femenino' },
                { value: 'M', label: 'Masculino' },
                { value: 'otro', label: 'Otro (no se calcula grasa ni músculo)' },
              ]}
            />
            <Input
              label="Estatura (cm) *"
              type="number"
              min={1}
              value={estatura}
              disabled={guardando}
              onChange={(e) => setEstatura(e.target.value)}
            />
          </div>
          <div className="form-grid form-grid-movil-2">
            {CAMPOS_FORMULARIO.map((k, i) => (
              <div className="col-2" key={k}>
                <Input
                  label={ETIQUETAS_MEDICION[k]}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={form[k]}
                  autoFocus={i === 0}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  disabled={guardando}
                />
              </div>
            ))}
          </div>
          {errorForm && (
            <MensajeFijo tono="error" style={{ marginTop: 12 }}>
              {errorForm}
            </MensajeFijo>
          )}
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 12px' }}>
            El porcentaje de grasa y la masa muscular se calculan solos al guardar. Para que salgan, escribe el peso o la
            cintura.
          </p>
          <div className="form-callout-actions">
            <Button variant="secondary" size="sm" onClick={() => setFormAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={guardar} isLoading={guardando}>
              Guardar medición
            </Button>
          </div>
        </div>
      )}

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['progreso', 'historial'] as const).map((p) => (
          <Button
            key={p}
            role="tab"
            aria-selected={pestana === p}
            variant={pestana === p ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setPestana(p)}
          >
            {p === 'progreso' ? 'Progreso' : 'Historial'}
          </Button>
        ))}
      </div>

      {cargando && mediciones.length === 0 ? (
        <Cargando />
      ) : error ? (
        <ErrorCarga error={error} onReintentar={cargar} />
      ) : mediciones.length === 0 ? (
        <p className="texto-vacio">
          Aún no hay mediciones.{puedeRegistrar ? ' Registra la primera para empezar a ver el progreso.' : ''}
        </p>
      ) : pestana === 'progreso' ? (
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {conDatos.map((c) => (
              <Button key={c} size="sm" variant={c === campo ? 'primary' : 'outline'} onClick={() => setCampo(c)}>
                {ETIQUETAS_MEDICION[c]}
              </Button>
            ))}
          </div>
          {puntos.length < 2 ? (
            <p className="texto-vacio">
              Con una sola medición de {ETIQUETAS_MEDICION[campo].toLowerCase()} todavía no hay progreso que mostrar
              {ultimo ? ` (${fmt(ultimo.v)} ${UNIDAD_MEDICION[campo]} el ${formatFechaNegocio(ultimo.fecha)})` : ''}.
            </p>
          ) : (
            <>
              <GraficaMedida puntos={puntos} unidad={UNIDAD_MEDICION[campo]} etiqueta={ETIQUETAS_MEDICION[campo]} />
              {cambio !== null && (
                <p style={{ fontSize: '0.9rem', marginTop: 8 }}>
                  {cambio === 0 ? 'Sin cambio' : `${cambio > 0 ? '+' : '−'}${fmt(Math.abs(cambio))} ${UNIDAD_MEDICION[campo]}`} desde el{' '}
                  {formatFechaNegocio(primero.fecha)} ({puntos.length} mediciones)
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="mini-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                {CAMPOS_MEDICION.map((c) => (
                  <th key={c}>{ETIQUETAS_MEDICION[c]}</th>
                ))}
                <th>Registró</th>
              </tr>
            </thead>
            <tbody>
              {[...mediciones].reverse().map((m) => (
                <tr key={m.id}>
                  <td>{formatFechaNegocio(m.fecha)}</td>
                  {CAMPOS_MEDICION.map((c) => {
                    const v = valor(m, c);
                    return <td key={c}>{v === null ? '—' : fmt(v)}</td>;
                  })}
                  <td>{m.registrado_por_nombre ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
};
