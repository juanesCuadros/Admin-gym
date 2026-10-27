import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Texto corto bajo el título (opcional). */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Botones fijos abajo (Guardar / Cancelar). */
  footer?: ReactNode;
  /** `md` = 560 px (formularios) · `lg` = 680 px (fichas con más información). */
  size?: 'md' | 'lg';
}

const DURACION_MS = 280;

/**
 * Panel lateral (slide-over) que entra desde la derecha. En móvil ocupa toda la pantalla.
 * Se usa para formularios largos y fichas; las confirmaciones cortas siguen en `Modal`.
 * Se monta en `document.body`: si se abre uno encima de otro (ficha → editar), el último queda arriba.
 */
export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, subtitle, children, footer, size = 'md' }) => {
  // `montado` mantiene el panel en el DOM durante la animación de salida.
  const [montado, setMontado] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  // Nivel de apilamiento: un panel abierto sobre otro (ficha → editar) queda encima y oscurece al de abajo.
  const [nivel, setNivel] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      setNivel(document.querySelectorAll('.drawer').length);
      setMontado(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMontado(false), DURACION_MS);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Bloquea el scroll del fondo y cierra con Escape (solo el panel de más arriba, y no si hay un modal encima).
  useEffect(() => {
    if (!isOpen) return;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.modal-overlay')) return;
      const paneles = document.querySelectorAll('.drawer.open');
      if (paneles[paneles.length - 1] !== panelRef.current) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflowPrevio;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  if (!montado) return null;

  return createPortal(
    <>
      <div
        className={`drawer-overlay ${visible ? 'open' : ''}`}
        style={{ zIndex: 100 + nivel * 2 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        style={{ zIndex: 101 + nivel * 2 }}
        className={`drawer drawer-${size} ${visible ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-header">
          <div className="drawer-header-text">
            <h2 className="drawer-title">{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn ghost" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>,
    document.body
  );
};
