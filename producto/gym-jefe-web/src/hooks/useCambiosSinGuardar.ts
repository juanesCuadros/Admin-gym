import { useEffect } from 'react';

/**
 * Pide confirmación al cerrar o recargar la pestaña si hay cambios sin guardar (§A6).
 *
 * Limitación: la app usa `<BrowserRouter>`, que no permite bloquear la navegación interna
 * (`useBlocker` exige un router de datos). Por eso aquí solo se cubre el cierre o la recarga
 * de la pestaña; las pantallas con formularios largos muestran además un aviso visible.
 */
export function useCambiosSinGuardar(hayCambios: boolean): void {
  useEffect(() => {
    if (!hayCambios) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Requerido por algunos navegadores para mostrar el diálogo.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [hayCambios]);
}
