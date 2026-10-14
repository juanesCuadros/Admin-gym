import React, { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { useCambiosSinGuardar } from '../../hooks/useCambiosSinGuardar';
import type { ActualizarParametrosRequest, InfoGymResponse } from '../../types/myGym.types';

/** Parámetros numéricos. `contrato: true` = campo del contrato 2.5, aún no expuesto por el backend actual. */
type CampoNumerico =
  | 'dias_gracia_mora'
  | 'dias_umbral_por_vencer'
  | 'minimo_dias_congelamiento'
  | 'tope_dias_congelamiento'
  | 'tope_descuento_pct'
  | 'duracion_sesion_minutos'
  | 'ventana_reserva_dias'
  | 'limite_cancelar_reserva_horas';

interface DefCampo {
  campo: CampoNumerico;
  etiqueta: string;
  ayuda: string;
  min: number;
  max?: number;
  sufijo: string;
  contrato?: boolean;
}

/** Rangos: los del backend (`ActualizarParametrosRequest`) y, para los nuevos, los de GW-RF-48. */
const GRUPOS: Array<{ titulo: string; campos: DefCampo[] }> = [
  {
    titulo: 'Membresías y acceso',
    campos: [
      {
        campo: 'dias_gracia_mora',
        etiqueta: 'Días de gracia',
        ayuda: 'Días después del vencimiento en que el deportista aún ingresa, con alerta. 0 = sin gracia.',
        min: 0,
        max: 30,
        sufijo: 'días',
      },
      {
        campo: 'dias_umbral_por_vencer',
        etiqueta: 'Días "por vencer"',
        ayuda: 'Desde cuántos días antes del vencimiento se marca la membresía como por vencer.',
        min: 1,
        max: 60,
        sufijo: 'días',
      },
    ],
  },
  {
    titulo: 'Congelamientos',
    campos: [
      {
        campo: 'minimo_dias_congelamiento',
        etiqueta: 'Mínimo de días por congelamiento',
        ayuda: 'Un congelamiento no puede durar menos que esto.',
        min: 1,
        max: 365,
        sufijo: 'días',
        contrato: true,
      },
      {
        campo: 'tope_dias_congelamiento',
        etiqueta: 'Tope de días de congelamiento',
        ayuda: 'Máximo de días congelados acumulados. Debe ser mayor o igual al mínimo.',
        min: 0,
        max: 365,
        sufijo: 'días',
      },
    ],
  },
  {
    titulo: 'Descuentos',
    campos: [
      {
        campo: 'tope_descuento_pct',
        etiqueta: 'Tope de descuento',
        ayuda: 'Descuento máximo que se puede dar en caja sobre el precio de lista.',
        min: 0,
        max: 100,
        sufijo: '%',
        contrato: true,
      },
    ],
  },
  {
    titulo: 'Reservas de clases',
    campos: [
      {
        campo: 'ventana_reserva_dias',
        etiqueta: 'Ventana de reserva',
        ayuda: 'Con cuántos días de anticipación se puede reservar una clase.',
        min: 0,
        sufijo: 'días',
        contrato: true,
      },
      {
        campo: 'limite_cancelar_reserva_horas',
        etiqueta: 'Límite para cancelar una reserva',
        ayuda: 'Horas antes de la clase hasta las que se puede cancelar.',
        min: 0,
        sufijo: 'horas',
        contrato: true,
      },
    ],
  },
  {
    titulo: 'Sesión',
    campos: [
      {
        campo: 'duracion_sesion_minutos',
        etiqueta: 'Cierre de sesión por inactividad',
        ayuda: 'Entre 15 minutos y 8 horas (480 minutos). Por defecto, 60.',
        min: 15,
        max: 480,
        sufijo: 'minutos',
      },
    ],
  },
];

type FormParametros = Record<CampoNumerico, string> & { permitir_descuentos: boolean | null };

function infoAForm(i: InfoGymResponse): FormParametros {
  const txt = (v: number | undefined) => (v === undefined || v === null ? '' : String(v));
  return {
    dias_gracia_mora: txt(i.dias_gracia_mora),
    dias_umbral_por_vencer: txt(i.dias_umbral_por_vencer),
    minimo_dias_congelamiento: txt(i.minimo_dias_congelamiento),
    tope_dias_congelamiento: txt(i.tope_dias_congelamiento),
    tope_descuento_pct: txt(i.tope_descuento_pct),
    duracion_sesion_minutos: txt(i.duracion_sesion_minutos),
    ventana_reserva_dias: txt(i.ventana_reserva_dias),
    limite_cancelar_reserva_horas: txt(i.limite_cancelar_reserva_horas),
    permitir_descuentos: i.permitir_descuentos ?? null,
  };
}

/** ¿El backend ya expone el campo? Los del contrato 2.5 llegan `undefined` mientras no esté unido. */
function disponible(info: InfoGymResponse, campo: CampoNumerico | 'permitir_descuentos'): boolean {
  return (info as unknown as Record<string, unknown>)[campo] !== undefined;
}

/**
 * Configuración · Parámetros (GW-RF-48). `PATCH /my-gym/parametros` con `version`.
 * Los campos del contrato 2.5 se muestran deshabilitados hasta que el backend los devuelva.
 */
export const ConfigParametrosPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeEditar = hasPermission('configuracion', 'editar');

  const [info, setInfo] = useState<InfoGymResponse | null>(null);
  const [form, setForm] = useState<FormParametros | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const [tocados, setTocados] = useState<Partial<Record<CampoNumerico, boolean>>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const i = await myGymService.getInfo();
      setInfo(i);
      setForm(infoAForm(i));
      setTocados({});
      setErrorCarga(null);
      setErrorGuardar(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const hayCambios = !!info && !!form && JSON.stringify(infoAForm(info)) !== JSON.stringify(form);
  useCambiosSinGuardar(hayCambios);

  if (cargando && !info) return <Cargando />;
  if (errorCarga || !info || !form) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Parámetros</h1>
          </div>
        </div>
        <ErrorCarga error={errorCarga} onReintentar={cargar} />
      </div>
    );
  }

  const definiciones = GRUPOS.flatMap((g) => g.campos);
  const pendientes = definiciones.filter((d) => d.contrato && !disponible(info, d.campo));

  // ---- Validación ----
  const errores: Partial<Record<CampoNumerico, string>> = {};
  for (const d of definiciones) {
    if (!disponible(info, d.campo)) continue;
    const v = form[d.campo].trim();
    if (v === '') {
      errores[d.campo] = 'Este valor es obligatorio.';
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n)) errores[d.campo] = 'Debe ser un número entero.';
    else if (n < d.min || (d.max !== undefined && n > d.max))
      errores[d.campo] = d.max !== undefined ? `Debe estar entre ${d.min} y ${d.max}.` : `Debe ser ${d.min} o más.`;
  }
  if (
    disponible(info, 'minimo_dias_congelamiento') &&
    !errores.tope_dias_congelamiento &&
    !errores.minimo_dias_congelamiento &&
    Number(form.tope_dias_congelamiento) < Number(form.minimo_dias_congelamiento)
  ) {
    errores.tope_dias_congelamiento = 'El tope no puede ser menor que el mínimo por congelamiento.';
  }

  const errorDe = (c: CampoNumerico) => (tocados[c] ? errores[c] : undefined) ?? errorGuardar?.campos[c];

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const todos: Partial<Record<CampoNumerico, boolean>> = {};
    definiciones.forEach((d) => (todos[d.campo] = true));
    setTocados(todos);
    if (Object.keys(errores).length > 0 || guardando) return;
    setGuardando(true);
    setErrorGuardar(null);

    const datos: ActualizarParametrosRequest = {
      version: info.version,
      dias_gracia_mora: Number(form.dias_gracia_mora),
      tope_dias_congelamiento: Number(form.tope_dias_congelamiento),
      dias_umbral_por_vencer: Number(form.dias_umbral_por_vencer),
      duracion_sesion_minutos: Number(form.duracion_sesion_minutos),
    };
    // Contrato 2.5: solo se envían si el backend ya los expone.
    if (disponible(info, 'minimo_dias_congelamiento')) datos.minimo_dias_congelamiento = Number(form.minimo_dias_congelamiento);
    if (disponible(info, 'permitir_descuentos') && form.permitir_descuentos !== null)
      datos.permitir_descuentos = form.permitir_descuentos;
    if (disponible(info, 'tope_descuento_pct')) datos.tope_descuento_pct = Number(form.tope_descuento_pct);
    if (disponible(info, 'ventana_reserva_dias')) datos.ventana_reserva_dias = Number(form.ventana_reserva_dias);
    if (disponible(info, 'limite_cancelar_reserva_horas'))
      datos.limite_cancelar_reserva_horas = Number(form.limite_cancelar_reserva_horas);

    try {
      const res = await myGymService.actualizarParametros(datos);
      const nuevaInfo: InfoGymResponse = { ...info, ...res };
      setInfo(nuevaInfo);
      setForm(infoAForm(nuevaInfo));
      setTocados({});
      showToast('success', 'Parámetros guardados', 'Aplican desde la siguiente evaluación.');
    } catch (err) {
      setErrorGuardar(toApiError(err));
    } finally {
      setGuardando(false);
    }
  };

  const descuentosDisponibles = disponible(info, 'permitir_descuentos');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Parámetros</h1>
          <p className="page-subtitle">Reglas del gimnasio. Cada cambio aplica desde la siguiente evaluación y queda en auditoría.</p>
        </div>
      </div>

      {!puedeEditar && (
        <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
          Puedes ver los parámetros, pero no tienes permiso para cambiarlos.
        </MensajeFijo>
      )}
      {pendientes.length > 0 && (
        <MensajeFijo tono="info" titulo="Parámetros pendientes del servidor" style={{ marginBottom: 16 }}>
          {pendientes.map((p) => p.etiqueta.toLowerCase()).join(', ')}
          {descuentosDisponibles ? '' : ' y permitir descuentos'} todavía no los expone el servidor. Se habilitan solos
          cuando estén disponibles.
        </MensajeFijo>
      )}

      <form onSubmit={guardar} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {GRUPOS.map((g) => (
            <Card key={g.titulo} title={g.titulo}>
              {g.titulo === 'Descuentos' && (
                <div className="form-group">
                  <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: descuentosDisponibles && puedeEditar ? 'pointer' : 'default' }}>
                    <input
                      type="checkbox"
                      checked={form.permitir_descuentos === true}
                      disabled={!descuentosDisponibles || !puedeEditar || guardando}
                      onChange={(e) => setForm({ ...form, permitir_descuentos: e.target.checked })}
                    />
                    <span style={{ fontWeight: 600 }}>Permitir descuentos en caja</span>
                  </label>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {descuentosDisponibles
                      ? 'Si está apagado, caja siempre cobra el precio de lista.'
                      : 'Pendiente: el servidor aún no expone este parámetro.'}
                  </span>
                </div>
              )}
              {g.campos.map((d) => {
                const ok = disponible(info, d.campo);
                return (
                  <div key={d.campo}>
                    <Input
                      label={`${d.etiqueta} (${d.sufijo})`}
                      type="number"
                      inputMode="numeric"
                      min={d.min}
                      max={d.max}
                      step={1}
                      value={form[d.campo]}
                      placeholder={ok ? undefined : 'Pendiente del servidor'}
                      onChange={(e) => setForm({ ...form, [d.campo]: e.target.value })}
                      onBlur={() => setTocados((t) => ({ ...t, [d.campo]: true }))}
                      error={errorDe(d.campo)}
                      disabled={!ok || !puedeEditar || guardando}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
                      {d.ayuda}
                    </p>
                  </div>
                );
              })}
            </Card>
          ))}
        </div>

        {puedeEditar && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              {errorGuardar &&
                (errorGuardar.tipo === 'conflicto' ? (
                  <Conflicto onRecargar={cargar} />
                ) : (
                  <MensajeFijo tono="error" titulo="No se guardaron los parámetros">
                    {errorGuardar.message}
                  </MensajeFijo>
                ))}
            </div>
            {hayCambios && <span style={{ fontSize: '0.85rem', color: 'var(--warning)' }}>Hay cambios sin guardar</span>}
            <Button
              variant="outline"
              type="button"
              disabled={!hayCambios || guardando}
              onClick={() => {
                setForm(infoAForm(info));
                setTocados({});
                setErrorGuardar(null);
              }}
            >
              Descartar
            </Button>
            <Button variant="primary" type="submit" leftIcon={<Save size={16} />} isLoading={guardando} disabled={!hayCambios}>
              Guardar parámetros
            </Button>
          </div>
        )}
      </form>
    </div>
  );
};
