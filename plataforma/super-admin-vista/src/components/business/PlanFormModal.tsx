import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { Alert } from '@/components/feedback/Alert';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Select } from '@/components/forms/Select';
import { Plan, PlanBase, TipoPlan } from '@/types/plan.types';
import { planService } from '@/services/planService';
import { parseApiError } from '@/services/api/errorHandler';
import { useToast } from '@/hooks/useToast';
import { formatCOP } from '@/utils/format';
import { RefreshCw, Save } from 'lucide-react';

/** Estado del formulario en texto para no perder lo que escribe el usuario. */
interface PlanForm {
  codigo: string;
  tipo: TipoPlan;
  nombre: string;
  descripcion: string;
  precio: string;
  duracion_meses: string;
  dias_prueba: string;
  max_clientes_activos: string;
  max_staff: string;
  publico: boolean;
  orden: string;
  activo: boolean;
}

type Campo = keyof PlanForm;

const RE_CODIGO = /^[a-z0-9_]{2,40}$/;

function formDesdePlan(plan: Plan | null): PlanForm {
  if (!plan) {
    return {
      codigo: '',
      tipo: 'pago',
      nombre: '',
      descripcion: '',
      precio: '',
      duracion_meses: '1',
      dias_prueba: '',
      max_clientes_activos: '',
      max_staff: '',
      publico: true,
      orden: '0',
      activo: true,
    };
  }
  const texto = (v: number | null | undefined) => (v !== null && v !== undefined ? String(v) : '');
  return {
    codigo: plan.codigo,
    tipo: plan.tipo,
    nombre: plan.nombre,
    descripcion: plan.descripcion ?? '',
    precio: String(plan.precio),
    duracion_meses: texto(plan.duracion_meses),
    dias_prueba: texto(plan.dias_prueba),
    max_clientes_activos: texto(plan.max_clientes_activos),
    max_staff: texto(plan.max_staff),
    publico: plan.publico,
    orden: String(plan.orden),
    activo: plan.activo,
  };
}

function esEntero(v: string): boolean {
  return v.trim() !== '' && Number.isInteger(Number(v));
}

/** Mismas reglas que `plan_schemas.py` y el CHECK `plan_tipo_coherente`; el servidor vuelve a validar. */
function validar(form: PlanForm, esNuevo: boolean): Partial<Record<Campo, string>> {
  const e: Partial<Record<Campo, string>> = {};
  if (esNuevo && !RE_CODIGO.test(form.codigo)) {
    e.codigo = 'Entre 2 y 40 caracteres: minúsculas, números y guion bajo.';
  }
  const nombre = form.nombre.trim();
  if (nombre.length < 2 || nombre.length > 120) e.nombre = 'El nombre debe tener entre 2 y 120 caracteres.';
  if (form.descripcion.length > 500) e.descripcion = 'Máximo 500 caracteres.';

  if (form.tipo === 'prueba') {
    if (!esEntero(form.dias_prueba) || Number(form.dias_prueba) < 1 || Number(form.dias_prueba) > 90) {
      e.dias_prueba = 'Los días de prueba deben ser un entero entre 1 y 90.';
    }
  } else {
    if (!esEntero(form.precio) || Number(form.precio) < 0) {
      e.precio = 'El precio debe ser un valor en pesos sin decimales (0 o más).';
    }
    if (!esEntero(form.duracion_meses) || Number(form.duracion_meses) < 1 || Number(form.duracion_meses) > 36) {
      e.duracion_meses = 'La duración debe ser un entero entre 1 y 36 meses.';
    }
  }
  (['max_clientes_activos', 'max_staff'] as const).forEach((c) => {
    if (form[c].trim() !== '' && (!esEntero(form[c]) || Number(form[c]) < 1)) {
      e[c] = 'Debe ser un entero mayor a 0, o vacío para no limitar.';
    }
  });
  if (!esEntero(form.orden)) e.orden = 'El orden debe ser un número entero.';
  return e;
}

function cuerpoBase(form: PlanForm): PlanBase {
  const opcional = (v: string) => (v.trim() === '' ? null : Number(v));
  const esPrueba = form.tipo === 'prueba';
  return {
    nombre: form.nombre.trim(),
    descripcion: form.descripcion.trim() || null,
    precio: esPrueba ? 0 : Number(form.precio),
    duracion_meses: esPrueba ? null : Number(form.duracion_meses),
    dias_prueba: esPrueba ? Number(form.dias_prueba) : null,
    max_clientes_activos: opcional(form.max_clientes_activos),
    max_staff: opcional(form.max_staff),
    publico: form.publico,
    orden: Number(form.orden),
  };
}

export interface PlanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `null` para crear. */
  plan: Plan | null;
  onSaved: (plan: Plan) => void;
  /** Ante un 409 de versión: recarga el catálogo y devuelve la versión actual del plan. */
  onRecargar: (planId: string) => Promise<Plan | null>;
}

/** Crear o editar un plan de suscripción (SA-RF-33, contrato 3.1). */
export const PlanFormModal: React.FC<PlanFormModalProps> = ({ isOpen, onClose, plan, onSaved, onRecargar }) => {
  const { success } = useToast();
  const esNuevo = plan === null;

  const [base, setBase] = useState<Plan | null>(plan);
  const [form, setForm] = useState<PlanForm>(formDesdePlan(plan));
  const [tocados, setTocados] = useState<Partial<Record<Campo, boolean>>>({});
  const [intentoEnvio, setIntentoEnvio] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<Partial<Record<Campo, string>>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setBase(plan);
      setForm(formDesdePlan(plan));
      setTocados({});
      setIntentoEnvio(false);
      setErroresServidor({});
      setErrorMsg(null);
      setConflicto(false);
    }
  }, [isOpen, plan]);

  const errores = validar(form, esNuevo);
  const errorDe = (c: Campo) => erroresServidor[c] || ((tocados[c] || intentoEnvio) ? errores[c] : undefined);
  const hayCambios = JSON.stringify(form) !== JSON.stringify(formDesdePlan(base));

  const set = <K extends Campo>(campo: K, valor: PlanForm[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErroresServidor((prev) => ({ ...prev, [campo]: undefined }));
  };
  const tocar = (campo: Campo) => () => setTocados((t) => ({ ...t, [campo]: true }));

  const cerrar = () => {
    if (isSubmitting) return;
    if (hayCambios && !window.confirm('Hay cambios sin guardar. ¿Salir sin guardarlos?')) return;
    onClose();
  };

  const recargar = async () => {
    if (!base) return;
    setRecargando(true);
    try {
      const actual = await onRecargar(base.id);
      if (actual) {
        setBase(actual);
        setForm(formDesdePlan(actual));
        setTocados({});
        setIntentoEnvio(false);
        setConflicto(false);
        setErrorMsg(null);
      } else {
        setErrorMsg('No se pudo recargar el plan. Intenta de nuevo.');
      }
    } finally {
      setRecargando(false);
    }
  };

  const guardar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting || conflicto) return;
    setIntentoEnvio(true);
    setErrorMsg(null);
    if (Object.keys(errores).length) return;

    setIsSubmitting(true);
    try {
      const guardado = esNuevo
        ? await planService.createPlan({
            ...cuerpoBase(form),
            codigo: form.codigo,
            tipo: form.tipo,
            activo: form.activo,
          })
        : await planService.updatePlan(base!.id, { ...cuerpoBase(form), version: base!.version });
      success(esNuevo ? `Plan "${guardado.nombre}" creado.` : `Plan "${guardado.nombre}" actualizado.`);
      onSaved(guardado);
      onClose();
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'VERSION_DESACTUALIZADA') {
        // Lo escrito se conserva hasta que el usuario decida recargar.
        setConflicto(true);
        setErrorMsg('Otra persona modificó este plan mientras lo editabas. Recarga para ver la versión actual.');
        return;
      }
      if (parsed.codigo === 'CODIGO_DUPLICADO') {
        setErroresServidor({ codigo: parsed.message });
      } else if (parsed.fieldErrors) {
        setErroresServidor(parsed.fieldErrors as Partial<Record<Campo, string>>);
      }
      setErrorMsg(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const esPrueba = form.tipo === 'prueba';
  const bloqueado = isSubmitting || recargando;

  return (
    <Modal
      isOpen={isOpen}
      onClose={cerrar}
      title={esNuevo ? 'Crear plan' : `Editar plan "${base?.nombre ?? ''}"`}
      description={
        esNuevo
          ? 'El código y el tipo no se pueden cambiar después de crear el plan.'
          : 'Los cambios no son retroactivos: los gimnasios conservan el valor de su suscripción vigente.'
      }
      maxWidth="620px"
      footer={
        <>
          <Button variant="cancel" onClick={cerrar} disabled={bloqueado}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => guardar()}
            isLoading={isSubmitting}
            disabled={conflicto || recargando}
            leftIcon={<Save size={16} />}
          >
            {esNuevo ? 'Crear plan' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <form onSubmit={guardar} noValidate>
        {errorMsg && (
          <Alert
            type={conflicto ? 'warning' : 'error'}
            title={conflicto ? 'El plan cambió' : 'No se guardó el plan'}
            message={
              conflicto ? (
                <div>
                  <div style={{ marginBottom: '8px' }}>{errorMsg}</div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={recargar}
                    isLoading={recargando}
                    leftIcon={<RefreshCw size={14} />}
                  >
                    Recargar plan
                  </Button>
                </div>
              ) : (
                errorMsg
              )
            }
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          <FormField
            label="Código"
            required={esNuevo}
            error={errorDe('codigo')}
            helperText={esNuevo ? 'ej. basico_mensual. Minúsculas, números y guion bajo.' : 'No se puede editar.'}
          >
            <TextInput
              value={form.codigo}
              onChange={(e) => set('codigo', e.target.value.trim().toLowerCase())}
              onBlur={tocar('codigo')}
              maxLength={40}
              disabled={!esNuevo || bloqueado}
              hasError={!!errorDe('codigo')}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </FormField>

          <FormField label="Tipo" required={esNuevo} helperText={esNuevo ? undefined : 'No se puede editar.'}>
            <Select
              value={form.tipo}
              onChange={(e) => set('tipo', e.target.value as TipoPlan)}
              disabled={!esNuevo || bloqueado}
              options={[
                { value: 'pago', label: 'De pago' },
                { value: 'prueba', label: 'Prueba gratuita' },
              ]}
            />
          </FormField>
        </div>

        <FormField label="Nombre" required error={errorDe('nombre')}>
          <TextInput
            value={form.nombre}
            onChange={(e) => set('nombre', e.target.value)}
            onBlur={tocar('nombre')}
            maxLength={120}
            disabled={bloqueado}
            hasError={!!errorDe('nombre')}
            placeholder="ej. Plan Básico"
          />
        </FormField>

        <FormField label="Descripción" optional error={errorDe('descripcion')}>
          <textarea
            value={form.descripcion}
            onChange={(e) => set('descripcion', e.target.value)}
            onBlur={tocar('descripcion')}
            maxLength={500}
            rows={2}
            disabled={bloqueado}
            className="input-apple"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${errorDe('descripcion') ? 'var(--color-error)' : 'var(--color-border-strong)'}`,
              backgroundColor: bloqueado ? 'var(--color-bg-subtle)' : 'var(--color-bg-card)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--font-size-md)',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0 16px' }}>
          <FormField
            label="Precio mensual (COP)"
            required={!esPrueba}
            error={errorDe('precio')}
            helperText={
              esPrueba ? 'La prueba no tiene costo.' : form.precio && esEntero(form.precio) ? formatCOP(Number(form.precio)) : undefined
            }
          >
            <TextInput
              type="number"
              inputMode="numeric"
              value={esPrueba ? '0' : form.precio}
              onChange={(e) => set('precio', e.target.value)}
              onBlur={tocar('precio')}
              min={0}
              step={1000}
              disabled={esPrueba || bloqueado}
              hasError={!!errorDe('precio')}
              leftElement={<span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)' }}>$</span>}
            />
          </FormField>

          {esPrueba ? (
            <FormField label="Días de prueba" required error={errorDe('dias_prueba')} helperText="Entre 1 y 90.">
              <TextInput
                type="number"
                inputMode="numeric"
                value={form.dias_prueba}
                onChange={(e) => set('dias_prueba', e.target.value)}
                onBlur={tocar('dias_prueba')}
                min={1}
                max={90}
                disabled={bloqueado}
                hasError={!!errorDe('dias_prueba')}
              />
            </FormField>
          ) : (
            <FormField
              label="Meses por pago"
              required
              error={errorDe('duracion_meses')}
              helperText="Meses que cubre cada pago (1 a 36)."
            >
              <TextInput
                type="number"
                inputMode="numeric"
                value={form.duracion_meses}
                onChange={(e) => set('duracion_meses', e.target.value)}
                onBlur={tocar('duracion_meses')}
                min={1}
                max={36}
                disabled={bloqueado}
                hasError={!!errorDe('duracion_meses')}
              />
            </FormField>
          )}

          <FormField label="Orden" error={errorDe('orden')} helperText="Posición en las listas (menor primero).">
            <TextInput
              type="number"
              inputMode="numeric"
              value={form.orden}
              onChange={(e) => set('orden', e.target.value)}
              onBlur={tocar('orden')}
              step={1}
              disabled={bloqueado}
              hasError={!!errorDe('orden')}
            />
          </FormField>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
          <FormField
            label="Máximo de clientes activos"
            optional
            error={errorDe('max_clientes_activos')}
            helperText="Vacío = sin límite."
          >
            <TextInput
              type="number"
              inputMode="numeric"
              value={form.max_clientes_activos}
              onChange={(e) => set('max_clientes_activos', e.target.value)}
              onBlur={tocar('max_clientes_activos')}
              min={1}
              disabled={bloqueado}
              hasError={!!errorDe('max_clientes_activos')}
            />
          </FormField>
          <FormField label="Máximo de staff" optional error={errorDe('max_staff')} helperText="Vacío = sin límite.">
            <TextInput
              type="number"
              inputMode="numeric"
              value={form.max_staff}
              onChange={(e) => set('max_staff', e.target.value)}
              onBlur={tocar('max_staff')}
              min={1}
              disabled={bloqueado}
              hasError={!!errorDe('max_staff')}
            />
          </FormField>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: 'var(--font-size-sm)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.publico}
              onChange={(e) => set('publico', e.target.checked)}
              disabled={bloqueado}
            />
            Visible en el sitio público (si además está activo)
          </label>
          {esNuevo && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => set('activo', e.target.checked)}
                disabled={bloqueado}
              />
              Activo desde ya (se puede asignar a gimnasios)
            </label>
          )}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
