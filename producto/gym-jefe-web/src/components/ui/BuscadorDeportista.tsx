import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { deportistasService } from '../../api/deportistas.service';
import { parseApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import type { DeportistaBusquedaItem } from '../../types/comun.types';

interface BuscadorDeportistaProps {
  label?: string;
  seleccionado: DeportistaBusquedaItem | null;
  onSeleccionar: (d: DeportistaBusquedaItem | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Autocompletado de deportistas por nombre o documento (`GET /deportistas/buscar`).
 * Requiere el permiso `deportistas:leer`: sin él no consulta (un 403 sacaría al usuario de la vista)
 * y lo dice en el campo.
 */
export const BuscadorDeportista: React.FC<BuscadorDeportistaProps> = ({
  label = 'Deportista',
  seleccionado,
  onSeleccionar,
  placeholder = 'Nombre o documento',
  disabled = false,
}) => {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<DeportistaBusquedaItem[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const consulta = useRef(0);
  const { hasPermission } = useAuth();
  const puedeBuscar = hasPermission('deportistas', 'leer');

  useEffect(() => {
    const q = texto.trim();
    if (!puedeBuscar || q.length < 2) {
      setResultados([]);
      setError(null);
      return;
    }
    const id = ++consulta.current;
    const t = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const res = (await deportistasService.buscar(q)) as DeportistaBusquedaItem[];
        if (id === consulta.current) {
          setResultados(res);
          setError(null);
          setAbierto(true);
        }
      } catch (e) {
        if (id === consulta.current) setError(parseApiError(e));
      } finally {
        if (id === consulta.current) setBuscando(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [texto, puedeBuscar]);

  if (seleccionado) {
    return (
      <div className="form-group">
        {label && <span className="form-label">{label}</span>}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{seleccionado.nombre}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{seleccionado.documento}</div>
          </div>
          {!disabled && (
            <button
              type="button"
              aria-label="Quitar deportista"
              onClick={() => onSeleccionar(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!puedeBuscar) {
    return (
      <div className="form-group">
        {label && <span className="form-label">{label}</span>}
        <input className="form-input" disabled placeholder="Sin permiso para buscar deportistas" aria-label={label} />
      </div>
    );
  }

  return (
    <div className="form-group" style={{ position: 'relative' }}>
      {label && <span className="form-label">{label}</span>}
      <div style={{ position: 'relative' }}>
        <Search
          size={16}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
        />
        <input
          type="search"
          className="form-input"
          style={{ paddingLeft: 36 }}
          placeholder={placeholder}
          value={texto}
          disabled={disabled}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={() => resultados.length > 0 && setAbierto(true)}
          onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
          aria-label={label}
        />
        {buscando && (
          <Loader2
            size={16}
            className="animate-spin"
            style={{ position: 'absolute', right: 12, top: '50%', marginTop: -8, color: 'var(--text-muted)' }}
          />
        )}
      </div>
      {error && <span className="form-error-msg">{error}</span>}
      {abierto && texto.trim().length >= 2 && !buscando && !error && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.12))',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {resultados.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              No hay deportistas con ese nombre o documento.
            </div>
          ) : (
            resultados.map((d) => (
              <button
                key={d.id}
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSeleccionar(d);
                  setTexto('');
                  setResultados([]);
                  setAbierto(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ fontWeight: 600 }}>{d.nombre}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {d.documento}
                  {!d.activo && ' · Desactivado'}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
