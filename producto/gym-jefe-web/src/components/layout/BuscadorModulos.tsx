import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavegacionVisible } from '../../hooks/useNavegacionVisible';

interface Resultado {
  clave: string;
  grupo: string;
  titulo: string;
  detalle?: string;
  ruta: string;
  icono: LucideIcon;
}

/** Quita tildes y pasa a minúsculas para buscar "membresias" = "Membresías". */
const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Buscador de módulos (⌘K / Ctrl+K). Solo navega entre las secciones que el usuario
 * puede ver: usa la misma navegación filtrada que el Sidebar. No consulta la API.
 */
export const BuscadorModulos: React.FC<{ deshabilitado?: boolean }> = ({ deshabilitado = false }) => {
  const navigate = useNavigate();
  const grupos = useNavegacionVisible();
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // Índice plano: cada módulo sin submódulos + cada submódulo visible.
  const todos = useMemo<Resultado[]>(() => {
    const items: Resultado[] = [];
    grupos.forEach(({ grupo, modulos }) => {
      modulos.forEach(({ modulo, submodulos }) => {
        if (submodulos.length === 0) {
          items.push({ clave: modulo.ruta, grupo: grupo.etiqueta, titulo: modulo.etiqueta, ruta: modulo.ruta, icono: modulo.icono });
        } else {
          submodulos.forEach((s) =>
            items.push({
              clave: s.ruta,
              grupo: grupo.etiqueta,
              titulo: s.etiqueta,
              detalle: modulo.etiqueta,
              ruta: s.ruta,
              icono: modulo.icono,
            })
          );
        }
      });
    });
    return items;
  }, [grupos]);

  const resultados = useMemo(() => {
    const q = normalizar(consulta.trim());
    if (!q) return todos;
    return todos.filter((r) => normalizar(`${r.titulo} ${r.detalle ?? ''} ${r.grupo}`).includes(q));
  }, [consulta, todos]);

  // Atajo global ⌘K / Ctrl+K
  useEffect(() => {
    if (deshabilitado) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deshabilitado]);

  // Al abrir: limpiar, enfocar y bloquear el scroll del fondo.
  useEffect(() => {
    if (!abierto) return;
    setConsulta('');
    setIndice(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto]);

  useEffect(() => setIndice(0), [consulta]);

  // Mantener visible el elemento resaltado al navegar con flechas.
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${indice}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [indice]);

  const ir = (r: Resultado | undefined) => {
    if (!r) return;
    setAbierto(false);
    navigate(r.ruta);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      ir(resultados[indice]);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  };

  if (deshabilitado) return null;

  let grupoPrevio = '';

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setAbierto(true)} aria-label="Buscar en GymOS">
        <Search size={16} />
        <span>Buscar en GymOS</span>
        <kbd className="kbd">{esMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      {abierto &&
        createPortal(
          <div className="cmdk-overlay" onMouseDown={() => setAbierto(false)}>
            <div
              className="cmdk"
              role="dialog"
              aria-modal="true"
              aria-label="Buscar módulos"
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={onKeyDown}
            >
              <div className="cmdk-input-row">
                <Search size={18} />
                <input
                  ref={inputRef}
                  className="cmdk-input"
                  placeholder="Ir a… (caja, deportistas, reportes)"
                  value={consulta}
                  onChange={(e) => setConsulta(e.target.value)}
                  aria-controls="cmdk-lista"
                  aria-activedescendant={resultados[indice] ? `cmdk-${indice}` : undefined}
                />
                <kbd className="kbd">Esc</kbd>
              </div>

              <div className="cmdk-list" id="cmdk-lista" role="listbox" ref={listaRef}>
                {resultados.length === 0 && <div className="cmdk-empty">Ninguna sección coincide con “{consulta}”.</div>}
                {resultados.map((r, i) => {
                  const Icono = r.icono;
                  const mostrarGrupo = r.grupo !== grupoPrevio;
                  grupoPrevio = r.grupo;
                  return (
                    <React.Fragment key={r.clave}>
                      {mostrarGrupo && <div className="cmdk-group">{r.grupo}</div>}
                      <button
                        type="button"
                        id={`cmdk-${i}`}
                        role="option"
                        aria-selected={i === indice}
                        data-indice={i}
                        className={`cmdk-item ${i === indice ? 'activo' : ''}`}
                        onMouseMove={() => setIndice(i)}
                        onClick={() => ir(r)}
                      >
                        <span className="cmdk-item-icon">
                          <Icono size={16} />
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 500 }}>{r.titulo}</span>
                          {r.detalle && <span className="cmdk-item-sub">{r.detalle}</span>}
                        </span>
                        {i === indice && <ArrowRight size={15} color="var(--primary)" />}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="cmdk-footer">
                <span>
                  <kbd className="kbd">↑</kbd>
                  <kbd className="kbd">↓</kbd> navegar
                </span>
                <span>
                  <kbd className="kbd">
                    <CornerDownLeft size={11} />
                  </kbd>{' '}
                  abrir
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
