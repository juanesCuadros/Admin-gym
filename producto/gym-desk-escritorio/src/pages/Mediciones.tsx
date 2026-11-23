import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Plus, Ruler } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Modal } from '@web/components/ui/Modal';
import { calcularMedidasDerivadas, type MedidasDerivadas } from '@web/components/mediciones/calculo';
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

/** Lo que ya se sabe del cliente: precarga la toma y permite calcular igual que el servidor. */
interface PerfilMedidas {
  sexo: 'M' | 'F' | 'otro' | null;
  altura_cm: number | null;
  edad: number | null;
}

const CAMPOS: { clave: keyof Medicion; etiqueta: string; unidad: string; calculado?: boolean }[] = [
  { clave: 'peso', etiqueta: 'Peso', unidad: 'kg' },
  { clave: 'grasa_pct', etiqueta: 'Grasa', unidad: '%', calculado: true },
  { clave: 'masa_muscular', etiqueta: 'Músculo', unidad: 'kg', calculado: true },
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
  const [perfil, setPerfil] = useState<PerfilMedidas>({ sexo: null, altura_cm: null, edad: null });
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    if (!enLinea) {
      setError('Las medidas se consultan con internet.');
      return;
    }
    try {
      const r = await invocar<{ perfil: PerfilMedidas; mediciones: Medicion[] }>('mediciones_cliente', { deportistaId });
      setPerfil(r.perfil);
      setLista([...r.mediciones].sort((a, b) => b.fecha.localeCompare(a.fecha)));
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
                  <span>{c.etiqueta}{c.calculado && <i> · calculado</i>}</span>
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
      <RegistrarMedidasModal abierto={abierto} deportistaId={deportistaId} nombre={nombre} perfil={perfil} onCerrar={() => setAbierto(false)}
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

/** Media figura (lado izquierdo); la derecha es su reflejo. Abierta en el centro para que no quede una raya. */
const MEDIO_CUERPO =
  'M100 64 C92 64 88 66 88 74 L88 80 C76 84 60 86 52 94 C44 102 42 120 42 140 L38 196 C36 216 32 236 30 252 ' +
  'C28 262 24 272 28 278 C32 282 38 278 40 270 C42 256 46 236 50 214 L56 160 C58 150 62 140 64 132 ' +
  'C66 160 68 186 70 204 C70 220 64 236 64 252 C64 290 68 330 72 380 L74 420 C74 428 70 432 74 436 L94 436 ' +
  'C96 430 94 424 94 416 L96 330 C97 300 98 276 100 262';

/** Bandas de medida sobre la figura, con el mismo número de su casilla. */
const BANDAS: { n: number; x1: number; x2: number; y: number; marcaX: number }[] = [
  { n: 1, x1: 64, x2: 136, y: 118, marcaX: 150 }, // pecho
  { n: 2, x1: 141, x2: 159, y: 150, marcaX: 173 }, // brazo
  { n: 3, x1: 70, x2: 130, y: 200, marcaX: 144 }, // cintura
  { n: 4, x1: 64, x2: 136, y: 246, marcaX: 150 }, // cadera
  { n: 5, x1: 66, x2: 97, y: 300, marcaX: 52 }, // pierna
];

const Silueta: React.FC = () => (
  <svg viewBox="0 0 200 440" className="gd-silueta" aria-hidden="true">
    <ellipse cx="100" cy="36" rx="22" ry="27" className="gd-silueta-relleno" />
    <ellipse cx="100" cy="36" rx="22" ry="27" className="gd-silueta-borde" />
    <path d={`${MEDIO_CUERPO} Z`} className="gd-silueta-relleno" />
    <path d={`${MEDIO_CUERPO} Z`} className="gd-silueta-relleno" transform="translate(200 0) scale(-1 1)" />
    <path d={MEDIO_CUERPO} className="gd-silueta-borde" />
    <path d={MEDIO_CUERPO} className="gd-silueta-borde" transform="translate(200 0) scale(-1 1)" />
    {BANDAS.map((b) => (
      <g key={b.n}>
        <line x1={b.x1} x2={b.x2} y1={b.y} y2={b.y} className="gd-silueta-banda" />
        <circle cx={b.marcaX} cy={b.y} r="9" className="gd-silueta-marca" />
        <text x={b.marcaX} y={b.y + 4} textAnchor="middle" className="gd-silueta-numero">{b.n}</text>
      </g>
    ))}
  </svg>
);

type Tono = 'bien' | 'ojo' | 'alto' | 'neutro';
const TONO_IMC: Record<string, Tono> = { 'Bajo peso': 'ojo', Normal: 'bien', Sobrepeso: 'ojo', Obesidad: 'alto' };
const TONO_GRASA: Record<string, Tono> = { Esencial: 'ojo', 'Atlético': 'bien', Fitness: 'bien', Saludable: 'bien', Elevado: 'alto' };
const TONO_ICC: Record<string, Tono> = { 'Riesgo bajo': 'bien', 'Riesgo moderado': 'ojo', 'Riesgo alto': 'alto' };

/** Resultado calculado, con su referencia (OMS para el IMC, rangos por sexo para grasa e ICC). */
const Resultado: React.FC<{ titulo: string; valor: string | null; unidad?: string; nota: string | null; tono: Tono; referencia: string }> = ({ titulo, valor, unidad, nota, tono, referencia }) => (
  <div className={`gd-resultado gd-tono-${valor === null ? 'neutro' : tono}`} title={referencia}>
    <span>{titulo}</span>
    <strong>{valor ?? '—'}{valor !== null && unidad && <small> {unidad}</small>}</strong>
    <em>{valor === null ? referencia : nota ?? ''}</em>
  </div>
);

const Resultados: React.FC<{ d: MedidasDerivadas }> = ({ d }) => {
  const f = (n: number | null, dec = 1) => (n === null ? null : n.toLocaleString('es-CO', { maximumFractionDigits: dec }));
  return (
    <div className="gd-resultados">
      <div className="gd-resultados-titulo"><Activity size={15} /> Calculado automáticamente</div>
      <div className="gd-resultados-grid">
        <Resultado titulo="IMC" valor={f(d.imc)} nota={d.clasificacionImc} tono={TONO_IMC[d.clasificacionImc ?? ''] ?? 'neutro'} referencia="Necesita peso y estatura" />
        <Resultado titulo="Grasa corporal" valor={f(d.grasaPct)} unidad="%" nota={d.clasificacionGrasa} tono={TONO_GRASA[d.clasificacionGrasa ?? ''] ?? 'neutro'} referencia="Necesita la cintura" />
        <Resultado titulo="Masa muscular" valor={f(d.masaMuscularKg)} unidad="kg" nota={d.pctMuscular !== null ? `${f(d.pctMuscular)} % del peso` : null} tono="neutro" referencia="Necesita peso y cintura" />
        <Resultado titulo="Cintura / cadera" valor={f(d.icc, 2)} nota={d.riesgoIcc} tono={TONO_ICC[d.riesgoIcc ?? ''] ?? 'neutro'} referencia="Necesita cintura y cadera" />
      </div>
    </div>
  );
};

/** Registrar medidas con la figura del cuerpo. Grasa y músculo no se escriben: se calculan como en el servidor. */
export const RegistrarMedidasModal: React.FC<{
  abierto: boolean; deportistaId: string; nombre: string; perfil: PerfilMedidas; onCerrar: () => void; onGuardado: () => void;
}> = ({ abierto, deportistaId, nombre, perfil, onCerrar, onGuardado }) => {
  const { showToast } = useToast();
  const vacio = { sexo: '', altura_cm: '', peso: '', pecho: '', brazo: '', cintura: '', cadera: '', pierna: '' };
  const [v, setV] = useState(vacio);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!abierto) return;
    setV({ ...vacio, sexo: perfil.sexo ?? '', altura_cm: perfil.altura_cm ? String(perfil.altura_cm) : '' });
    setError(null);
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiar = (k: keyof typeof v) => (valor: string) => setV((p) => ({ ...p, [k]: valor }));
  const medidas = ['peso', 'pecho', 'brazo', 'cintura', 'cadera', 'pierna'] as const;
  const problema = !v.sexo ? 'Elige el sexo.' : !v.altura_cm ? 'Escribe la estatura.' : medidas.every((k) => !v[k]) ? 'Registra al menos una medida.' : null;

  const derivadas = useMemo(
    () => calcularMedidasDerivadas(
      { peso: v.peso, cintura: v.cintura, cadera: v.cadera, pecho: v.pecho, brazo: v.brazo, pierna: v.pierna },
      v.sexo as '' | 'M' | 'F' | 'otro', v.altura_cm, perfil.edad,
    ),
    [v, perfil.edad],
  );

  const guardar = async () => {
    if (problema) return;
    setEnviando(true);
    setError(null);
    const medicion: Record<string, string | number> = { sexo: v.sexo, altura_cm: Number(v.altura_cm) };
    medidas.forEach((k) => { if (v[k]) medicion[k] = Number(v[k]); });
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
    <Modal isOpen={abierto} onClose={() => !enviando && onCerrar()} title={`Registrar medidas · ${nombre}`} maxWidth="880px"
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
        </div>
      </div>
      {v.sexo === 'otro' ? (
        <p className="gd-pista">Con “Otro” no se calculan grasa ni músculo: las fórmulas son distintas para hombre y mujer.</p>
      ) : (
        <Resultados d={derivadas} />
      )}
      {problema && <p className="gd-pista">{problema}</p>}
      {error && <MensajeError>{error}</MensajeError>}
    </Modal>
  );
};
