import { useCallback, useRef } from 'react';

/**
 * Clave `X-Idempotency-Key` para una operación de caja (contrato 1.5, C-03).
 *
 * `clave(datos)` devuelve la misma clave mientras se reintente con los mismos datos: si la primera petición sí
 * llegó al servidor, el reintento devuelve ese resultado y no repite la operación. Si los datos cambian, la clave
 * se renueva. `reiniciar()` se llama al terminar bien o al cerrar el formulario.
 */
export function useClaveIdempotencia() {
  const actual = useRef<{ firma: string; clave: string } | null>(null);

  const clave = useCallback((datos: unknown): string => {
    const firma = JSON.stringify(datos);
    if (!actual.current || actual.current.firma !== firma) {
      actual.current = { firma, clave: crypto.randomUUID() };
    }
    return actual.current.clave;
  }, []);

  const reiniciar = useCallback(() => {
    actual.current = null;
  }, []);

  return { clave, reiniciar };
}
