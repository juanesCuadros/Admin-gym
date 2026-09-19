import React, { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Inbox, SearchX, ShieldOff, Construction, RefreshCw, Info } from 'lucide-react';
import { Button } from '../ui/Button';
import { ApiError, toApiError } from '../../api/client';

/* -------------------------------------------------------------------------- */
/* Mensaje fijo (§A3): error o aviso que no desaparece solo.                   */
/* -------------------------------------------------------------------------- */

export type TonoMensaje = 'error' | 'advertencia' | 'info';

interface MensajeFijoProps {
  tono?: TonoMensaje;
  titulo?: string;
  children: ReactNode;
  accion?: ReactNode;
  style?: React.CSSProperties;
}

const TONO = {
  error: { color: 'var(--danger)', fondo: 'var(--danger-light)', borde: 'var(--danger-border)', Icono: AlertCircle },
  advertencia: { color: 'var(--warning)', fondo: 'var(--warning-light)', borde: 'var(--warning-border)', Icono: AlertTriangle },
  info: { color: 'var(--info)', fondo: 'var(--info-light)', borde: 'var(--info-border)', Icono: Info },
} as const;

export const MensajeFijo: React.FC<MensajeFijoProps> = ({ tono = 'error', titulo, children, accion, style }) => {
  const t = TONO[tono];
  return (
    <div
      role={tono === 'error' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 14px',
        borderRadius: 'var(--radius-sm)',
        background: t.fondo,
        border: `1px solid ${t.borde}`,
        color: 'var(--text-primary)',
        fontSize: '0.9rem',
        lineHeight: 1.5,
        ...style,
      }}
    >
      <t.Icono size={18} color={t.color} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        {titulo && <div style={{ fontWeight: 700, marginBottom: 2 }}>{titulo}</div>}
        <div style={{ color: titulo ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{children}</div>
      </div>
      {accion && <div style={{ flexShrink: 0 }}>{accion}</div>}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Cargando: esqueleto en el área de contenido.                                */
/* -------------------------------------------------------------------------- */

interface CargandoProps {
  /** Filas del esqueleto. */
  filas?: number;
  /** Alto de cada fila en px. */
  alto?: number;
  etiqueta?: string;
}

export const Cargando: React.FC<CargandoProps> = ({ filas = 6, alto = 44, etiqueta = 'Cargando' }) => (
  <div role="status" aria-label={etiqueta} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {Array.from({ length: filas }).map((_, i) => (
      <div
        key={i}
        className="skeleton"
        style={{ height: alto, width: i === 0 ? '40%' : `${100 - (i % 3) * 8}%` }}
      />
    ))}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Vacíos                                                                      */
/* -------------------------------------------------------------------------- */

const cajaVacia: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '56px 20px',
  textAlign: 'center',
  background: 'var(--bg-surface)',
  border: '1px dashed var(--border-color)',
  borderRadius: 'var(--radius-md)',
};

const tituloVacio: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: 6,
};

const textoVacio: React.CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--text-secondary)',
  maxWidth: 440,
  marginBottom: 18,
};

/** Vacío por filtro: hay datos, pero la búsqueda o el filtro no encontró nada. */
export const VacioFiltro: React.FC<{ onLimpiar: () => void; mensaje?: string }> = ({
  onLimpiar,
  mensaje = 'Ningún registro coincide con los filtros aplicados.',
}) => (
  <div style={cajaVacia}>
    <SearchX size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
    <div style={tituloVacio}>No hay resultados</div>
    <p style={textoVacio}>{mensaje}</p>
    <Button variant="outline" onClick={onLimpiar}>
      Limpiar filtros
    </Button>
  </div>
);

interface VacioInicialProps {
  titulo: string;
  descripcion: string;
  textoAccion?: string;
  onAccion?: () => void;
  icono?: ReactNode;
}

/** Vacío inicial: explica la pantalla y ofrece crear el primero. */
export const VacioInicial: React.FC<VacioInicialProps> = ({ titulo, descripcion, textoAccion, onAccion, icono }) => (
  <div style={cajaVacia}>
    <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{icono ?? <Inbox size={40} />}</div>
    <div style={tituloVacio}>{titulo}</div>
    <p style={textoVacio}>{descripcion}</p>
    {textoAccion && onAccion && (
      <Button variant="primary" onClick={onAccion}>
        {textoAccion}
      </Button>
    )}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Error de carga: mensaje fijo con Reintentar. Nunca aviso flotante.          */
/* -------------------------------------------------------------------------- */

interface ErrorCargaProps {
  error: unknown;
  onReintentar?: () => void;
  /** Texto para el 404 (p. ej. "Deportista no encontrado"). */
  textoNoEncontrado?: string;
}

/**
 * Pinta cualquier error de carga según §A2:
 * 404 → "No encontrado" · 409 → recargar · 403 → perdió el permiso · resto → Reintentar.
 */
export const ErrorCarga: React.FC<ErrorCargaProps> = ({ error, onReintentar, textoNoEncontrado }) => {
  const e: ApiError = toApiError(error);

  if (e.tipo === 'no_encontrado') return <NoEncontrado texto={textoNoEncontrado} />;
  if (e.tipo === 'conflicto') return <Conflicto onRecargar={onReintentar} />;
  if (e.tipo === 'prohibido') return <SinPermiso />;

  return (
    <MensajeFijo
      tono="error"
      titulo="No se pudo cargar la información"
      accion={
        onReintentar && (
          <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={onReintentar}>
            Reintentar
          </Button>
        )
      }
    >
      {e.message}
    </MensajeFijo>
  );
};

/** 404 y recursos de otro gimnasio: siempre "No encontrado", nunca 403. */
export const NoEncontrado: React.FC<{ texto?: string; volverA?: string }> = ({
  texto = 'El registro que buscas no existe o ya no está disponible.',
  volverA,
}) => (
  <div style={cajaVacia}>
    <SearchX size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
    <div style={tituloVacio}>No encontrado</div>
    <p style={textoVacio}>{texto}</p>
    {volverA && (
      <Link to={volverA} className="btn btn-outline">
        Volver
      </Link>
    )}
  </div>
);

/** 409: otra persona modificó el registro. */
export const Conflicto: React.FC<{ onRecargar?: () => void }> = ({ onRecargar }) => (
  <MensajeFijo
    tono="advertencia"
    titulo="Otra persona modificó este registro"
    accion={
      onRecargar && (
        <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={onRecargar}>
          Recargar
        </Button>
      )
    }
  >
    Recarga para ver la versión actual antes de volver a guardar.
  </MensajeFijo>
);

/** 403: el usuario perdió el permiso. Mensaje fijo con salida a Inicio. */
export const SinPermiso: React.FC<{ detalle?: string }> = ({ detalle }) => (
  <div style={cajaVacia}>
    <ShieldOff size={40} color="var(--danger)" style={{ marginBottom: 12 }} />
    <div style={tituloVacio}>Ya no tienes permiso para esta sección</div>
    <p style={textoVacio}>
      {detalle ?? 'Tu acceso cambió. Si crees que es un error, pide al Jefe que revise tus permisos.'}
    </p>
    <Link to="/" className="btn btn-primary">
      Ir a inicio
    </Link>
  </div>
);

/** Vista sin pantalla todavía: estado vacío honesto, sin datos falsos. */
export const EnConstruccion: React.FC<{ titulo: string; descripcion?: string }> = ({
  titulo,
  descripcion = 'Esta pantalla aún no está construida. Se habilitará en una próxima entrega.',
}) => (
  <div>
    <div className="page-header">
      <div>
        <h1 className="page-title">{titulo}</h1>
      </div>
    </div>
    <div style={cajaVacia}>
      <Construction size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
      <div style={tituloVacio}>En construcción</div>
      <p style={{ ...textoVacio, marginBottom: 0 }}>{descripcion}</p>
    </div>
  </div>
);
