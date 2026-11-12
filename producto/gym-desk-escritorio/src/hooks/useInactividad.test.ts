import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoSesion } from '../types/sesion.types';
import { INTERVALO_AVISO_MS, INTERVALO_CONSULTA_MS, useInactividad } from './useInactividad';

const usuario = { id: 's1', nombre: 'Ana', correo: 'ana@gimnasio.co', rol: 'recepcionista' as const, tiene_pin: true };
const activa: EstadoSesion = { estado: 'activa', usuario, minutos_inactividad: 5 };
const bloqueada: EstadoSesion = { estado: 'bloqueada', usuario, minutos_inactividad: 5 };

function montar(activo: boolean) {
  const avisarActividad = vi.fn().mockResolvedValue(activa);
  const consultarEstado = vi.fn().mockResolvedValue(activa);
  const alCambiar = vi.fn();
  const hook = renderHook((props: { activo: boolean }) => useInactividad({ ...props, avisarActividad, consultarEstado, alCambiar }), {
    initialProps: { activo },
  });
  return { avisarActividad, consultarEstado, alCambiar, hook };
}

describe('useInactividad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T15:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('avisa la actividad una sola vez por intervalo aunque haya muchos eventos', () => {
    const { avisarActividad } = montar(true);
    for (let i = 0; i < 50; i++) window.dispatchEvent(new Event('pointermove'));
    window.dispatchEvent(new Event('keydown'));
    expect(avisarActividad).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(INTERVALO_AVISO_MS);
    window.dispatchEvent(new Event('keydown'));
    expect(avisarActividad).toHaveBeenCalledTimes(2);
  });

  it('sin sesión activa no vigila ni consulta', () => {
    const { avisarActividad, consultarEstado } = montar(false);
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(INTERVALO_CONSULTA_MS * 3);
    expect(avisarActividad).not.toHaveBeenCalled();
    expect(consultarEstado).not.toHaveBeenCalled();
  });

  it('pinta el bloqueo cuando la estación informa que se bloqueó por inactividad', async () => {
    const { consultarEstado, alCambiar } = montar(true);
    consultarEstado.mockResolvedValue(bloqueada);
    await vi.advanceTimersByTimeAsync(INTERVALO_CONSULTA_MS);
    expect(alCambiar).toHaveBeenCalledWith(bloqueada);
  });

  it('deja de vigilar cuando la sesión deja de estar activa', () => {
    const { avisarActividad, consultarEstado, hook } = montar(true);
    hook.rerender({ activo: false });
    window.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(INTERVALO_CONSULTA_MS * 2);
    expect(avisarActividad).not.toHaveBeenCalled();
    expect(consultarEstado).not.toHaveBeenCalled();
  });
});
