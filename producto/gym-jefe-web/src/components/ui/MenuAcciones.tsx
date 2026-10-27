import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface AccionMenu {
  etiqueta: string;
  icono?: ReactNode;
  onClick: () => void;
  /** Acción destructiva (cancelar, eliminar, desactivar): se muestra en rojo y separada. */
  peligro?: boolean;
  oculto?: boolean;
  disabled?: boolean;
}

interface MenuAccionesProps {
  acciones: AccionMenu[];
  /** Texto para lectores de pantalla. */
  etiqueta?: string;
}

/**
 * Botón "⋯" con las acciones secundarias de una fila. Deja visible solo la acción principal
 * y evita filas con 4 o 5 botones que no caben. El menú se monta en `body` con posición fija,
 * así no lo recorta el scroll horizontal de la tabla.
 */
export const MenuAcciones: React.FC<MenuAccionesProps> = ({ acciones, etiqueta = 'Más acciones' }) => {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibles = acciones.filter((a) => !a.oculto);
  const normales = visibles.filter((a) => !a.peligro);
  const peligrosas = visibles.filter((a) => a.peligro);

  useLayoutEffect(() => {
    if (!abierto || !botonRef.current) return;
    const r = botonRef.current.getBoundingClientRect();
    const altoMenu = menuRef.current?.offsetHeight ?? 160;
    const abajo = r.bottom + 6 + altoMenu <= window.innerHeight;
    setPos({ top: abajo ? r.bottom + 6 : Math.max(8, r.top - 6 - altoMenu), right: window.innerWidth - r.right });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || botonRef.current?.contains(t)) return;
      setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', cerrar);
    window.addEventListener('keydown', tecla);
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    return () => {
      document.removeEventListener('mousedown', cerrar);
      window.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
    };
  }, [abierto]);

  if (visibles.length === 0) return null;

  const elegir = (a: AccionMenu) => {
    setAbierto(false);
    a.onClick();
  };

  const item = (a: AccionMenu) => (
    <button
      key={a.etiqueta}
      type="button"
      role="menuitem"
      className={`menu-item ${a.peligro ? 'peligro' : ''}`}
      disabled={a.disabled}
      onClick={() => elegir(a)}
    >
      {a.icono}
      <span>{a.etiqueta}</span>
    </button>
  );

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        className="icon-btn ghost menu-trigger"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <MoreHorizontal size={17} />
      </button>
      {abierto &&
        createPortal(
          <div
            ref={menuRef}
            className="menu-flotante"
            role="menu"
            style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          >
            {normales.map(item)}
            {normales.length > 0 && peligrosas.length > 0 && <hr />}
            {peligrosas.map(item)}
          </div>,
          document.body
        )}
    </>
  );
};
