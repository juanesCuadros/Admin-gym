import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Ruler } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Modal } from '@web/components/ui/Modal';
import { useToast } from '@web/contexts/ToastContext';
import { formatFecha } from '@web/utils/formato';
import { invocar, aErrorGymDesk } from '../api/tauri';
import { MensajeError } from '../components/Piezas';

interface Medicion {
  id: string;
  fecha: string;
  peso: string | number | null;
  grasa_pct: string | number | null;
  masa_muscular: string | number | null;
  cintura: string | number | null;
  cadera: string | number | null;
  brazo: string | number | null;
  pierna: string | number | null;
  pecho: string | number | null;
  registrado_por_nombre: string | null;
}

const CAMPOS: { clave: keyof Medicion; etiqueta: string; unidad: string }[] = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'grasa_pct', etiqueta: 'Grasa', unidad: '%' },
  { clave: 'masa_muscular', etiqueta: 'Músculo', unidad: 'kg' },
  { clave: 'pecho', etiqueta: 'Pecho', unidad: 'cm' },
  { clave: 'brazo', etiqueta: 'Brazo', unidad: 'cm' },
  { clave: 'cintura', etiqueta: 'Cintura', unidad: 'cm' },
  { clave: 'cadera', etiqueta: 'Cadera', unidad: 'cm' },
  { clave: 'pierna', etiqueta: 'Pierna', unidad: 'cm' },
];

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const dia = (d: string) => formatFecha(`${d}T12:00:00-05:00`);

function diferencia(actual: number | null, previa: number | null): string | null {
  if (actual === null || previa === null) return null;
  const d = Math.round((actual - previa) * 10) / 10;
  if (d === 0) return '=';
  return `${d > 0 ? '+' : ''}${d.toLocaleString('es-CO')}`;
}

/** Medidas en la ficha del cliente: la última toma, su cambio frente a la anterior y el historial. Con internet. */
export const MedicionesCliente: React.FC<{ deportistaId: string; nombre: string; enLinea: boolean }> = ({ deportistaId, nombre, enLinea }) => {
  const [lista, setLista] = useState<Medicion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    if (!enLinea) {
      setError('Las medidas se consultan con internet.');
      return;
    }
    try {
      const r = await invocar<Medicion[]>('mediciones_cliente', { deportistaId });
      setLista([...r].sort((a, b) => b.fecha.localeCompare(a.fecha)));
      setError(null);
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    }
  }, [deportistaId, enLinea]);
  useEffect(() => { void cargar(); }, [cargar]);

  const ultima = lista?.[0];
  const previa = lista?.[1];
  return (
    <div className="gd-medidas">
      <div className="gd-medidas-cabecera">
        <h4 style={{ margin: 0 }}>Medidas</h4>
        <Button size="sm" variant="outline" leftIcon={<Plus size={14} />} disabled={!enLinea} onClick={() => setAbierto(true)}>Registrar medidas</Button>
      </div>
      {error && <p className="gd-subtitulo" style={{ margin: 0 }}>{error}</p>}
      {lista && lista.length === 0 && <p className="gd-subtitulo" style={{ margin: 0 }}>Aún no tiene medidas registradas.</p>}
      {ultima && (
        <>
          <p className="gd-pista" style={{ marginTop: 0 }}>
            Última toma: {dia(ultima.fecha)}{ultima.registrado_por_nombre ? ` · por ${ultima.registrado_por_nombre}` : ''}{previa ? ` · cambio frente al ${dia(previa.fecha)}` : ''}
          </p>
          <div className="gd-medidas-grid">
            {CAMPOS.filter((c) => num(ultima[c.clave] as never) !== null).map((c) => {
              const d = diferencia(num(ultima[c.clave] as never), previa ? num(previa[c.clave] as never) : null);
              return (
                <div key={c.clave} className="gd-medida">
                  <span>{c.etiqueta}</span>
                  <strong>{num(ultima[c.clave] as never)?.toLocaleString('es-CO')} <small>{c.unidad}</small></strong>
                  {d && <em>{d}</em>}
                </div>
              );
            })}
          </div>
          {lista && lista.length > 1 && (
            <details className="gd-descuento">
              <summary>Historial ({lista.length} tomas)</summary>
              <table className="gd-tabla">
                <thead><tr><th>Fecha</th>{CAMPOS.map((c) => <th key={c.clave}>{c.etiqueta}</th>)}</tr></thead>
                <tbody>
                  {lista.map((m) => (
                    <tr key={m.id}><td>{dia(m.fecha)}</td>{CAMPOS.map((c) => <td key={c.clave}>{num(m[c.clave] as never)?.toLocaleString('es-CO') ?? '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
      <RegistrarMedidasModal abierto={abierto} deportistaId={deportistaId} nombre={nombre} onCerrar={() => setAbierto(false)}
                             onGuardado={() => { setAbierto(false); void cargar(); }} />
    </div>
  );
};

/** Una casilla de medida; `marca` es el número que la ubica sobre la figura. */
const Casilla: React.FC<{ etiqueta: string; unidad: string; valor: string; onCambio: (v: string) => void; marca?: number }> = ({ etiqueta, unidad, valor, onCambio, marca }) => (
  <label className="gd-casilla">
    <span>{marca !== undefined && <b className="gd-marca">{marca}</b>}{etiqueta}</span>
    <div>
      <input inputMode="decimal" value={valor} onChange={(e) => onCambio(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} placeholder="—" />
      <small>{unidad}</small>
    </div>
  </label>
);

/** Media figura (lado izquierdo); la derecha es su reflejo. */
const MEDIO_CUERPO =
  'M100 64 C92 64 88 66 88 74 L88 80 C76 84 60 86 52 94 C44 102 42 120 42 140 L38 196 C36 216 32 236 30 252 ' +
  'C28 262 24 272 28 278 C32 282 38 278 40 270 C42 256 46 236 50 214 L56 160 C58 150 62 140 64 132 ' +
  'C66 160 68 186 70 204 C70 220 64 236 64 252 C64 290 68 330 72 380 L74 420 C74 428 70 432 74 436 L94 436 ' +
  'C96 430 94 424 94 416 L96 330 C97 300 98 276 100 262 Z';

/** Bandas de medida sobre la figura, con el mismo número de su casilla. */
const BANDAS: { n: number; x1: number; x2: number; y: number }[] = [
  { n: 1, x1: 64, x2: 136, y: 118 }, // pecho
  { n: 2, x1: 141, x2: 159, y: 150 }, // brazo (derecho)
  { n: 3, x1: 70, x2: 130, y: 200 }, // cintura
  { n: 4, x1: 64, x2: 136, y: 246 }, // cadera
  { n: 5, x1: 66, x2: 97, y: 300 }, // pierna (muslo izquierdo)
];

/** Figura del cuerpo de frente con las zonas que se miden. */
const Silueta: React.FC = () => (
  <svg viewBox="0 0 200 440" className="gd-silueta" aria-hidden="true">
    <ellipse cx="100" cy="36" rx="22" ry="27" className="gd-silueta-cuerpo" />
    <path d={MEDIO_CUERPO} className="gd-silueta-cuerpo" />
    <path d={MEDIO_CUERPO} className="gd-silueta-cuerpo" transform="translate(200 0) scale(-1 1)" />
    {BANDAS.map((b) => (
      <g key={b.n}>
        <line x1={b.x1} x2={b.x2} y1={b.y} y2={b.y} className="gd-silueta-banda" />
        <circle cx={b.n === 2 ? b.x2 + 14 : b.n === 5 ? b.x1 - 14 : b.x2 + 14} cy={b.y} r="9" className="gd-silueta-marca" />
        <text x={b.n === 2 ? b.x2 + 14 : b.n === 5 ? b.x1 - 14 : b.x2 + 14} y={b.y + 4} textAnchor="middle" className="gd-silueta-numero">{b.n}</text>
      </g>
    ))}
  </svg>
);

/** Registrar medidas con la figura del cuerpo, como en las fichas de valoración física. Con internet. */
export const RegistrarMedidasModal: React.FC<{ abierto: boolean; deportistaId: string; nombre: string; onCerrar: () => void; onGuardado: () => void }> = ({
  abierto, deportistaId, nombre, onCerrar, onGuardado,
}) => {
  const { showToast } = useToast();
  const vacio = { sexo: '', altura_cm: '', peso: '', grasa_pct: '', masa_muscular: '', pecho: '', brazo: '', cintura: '', cadera: '', pierna: '' };
  const [v, setV] = useState(vacio);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (abierto) { setV(vacio); setError(null); } }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiar = (k: keyof typeof v) => (valor: string) => setV((p) => ({ ...p, [k]: valor }));
  const metricas = ['peso', 'grasa_pct', 'masa_muscular', 'pecho', 'brazo', 'cintura', 'cadera', 'pierna'] as const;
  const problema = !v.sexo ? 'Elige el sexo (se usa para los cálculos).' : !v.altura_cm ? 'Escribe la estatura.' : metricas.every((k) => !v[k]) ? 'Registra al menos una medida.' : null;

  const guardar = async () => {
    if (problema) return;
    setEnviando(true);
    setError(null);
    const medicion: Record<string, string | number> = { sexo: v.sexo, altura_cm: Number(v.altura_cm) };
    metricas.forEach((k) => { if (v[k]) medicion[k] = Number(v[k]); });
    try {
      await invocar('registrar_medicion', { deportistaId, medicion });
      showToast('success', 'Medidas registradas', nombre);
      onGuardado();
    } catch (e) {
      setError(aErrorGymDesk(e).mensaje);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen={abierto} onClose={() => !enviando && onCerrar()} title={`Registrar medidas · ${nombre}`} maxWidth="860px"
      footer={<><Button variant="outline" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
        <Button leftIcon={<Ruler size={16} />} onClick={() => void guardar()} isLoading={enviando} disabled={problema !== null}>Guardar medidas</Button></>}>
      <div className="gd-medir-arriba">
        <div className="gd-sexo" role="radiogroup" aria-label="Sexo">
          {[['F', 'Mujer'], ['M', 'Hombre'], ['otro', 'Otro']].map(([valor, texto]) => (
            <button key={valor} type="button" role="radio" aria-checked={v.sexo === valor} className={v.sexo === valor ? 'activo' : ''} onClick={() => cambiar('sexo')(valor)}>{texto}</button>
          ))}
        </div>
        <Casilla etiqueta="Estatura" unidad="cm" valor={v.altura_cm} onCambio={cambiar('altura_cm')} />
        <Casilla etiqueta="Peso" unidad="kg" valor={v.peso} onCambio={cambiar('peso')} />
        <Casilla etiqueta="Masa muscular" unidad="kg" valor={v.masa_muscular} onCambio={cambiar('masa_muscular')} />
      </div>
      <div className="gd-cuerpo-medidas">
        <div className="gd-cuerpo-columna">
          <Casilla marca={1} etiqueta="Pecho" unidad="cm" valor={v.pecho} onCambio={cambiar('pecho')} />
          <Casilla marca={3} etiqueta="Cintura" unidad="cm" valor={v.cintura} onCambio={cambiar('cintura')} />
          <Casilla marca={5} etiqueta="Pierna (muslo)" unidad="cm" valor={v.pierna} onCambio={cambiar('pierna')} />
        </div>
        <Silueta />
        <div className="gd-cuerpo-columna">
          <Casilla marca={2} etiqueta="Brazo" unidad="cm" valor={v.brazo} onCambio={cambiar('brazo')} />
          <Casilla marca={4} etiqueta="Cadera" unidad="cm" valor={v.cadera} onCambio={cambiar('cadera')} />
          <Casilla etiqueta="Grasa corporal" unidad="%" valor={v.grasa_pct} onCambio={cambiar('grasa_pct')} />
        </div>
      </div>
      {problema && <p className="gd-pista">{problema}</p>}
      {error && <MensajeError>{error}</MensajeError>}
    </Modal>
  );
};
