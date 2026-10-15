import React, { useEffect, useState } from 'react';
import { Crown, Trash2 } from 'lucide-react';
import type { ApiError } from '../../api/client';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { BuscadorDeportista } from '../../components/ui/BuscadorDeportista';
import { MensajeFijo } from '../../components/estados/Estados';
import { formatCOP } from '../../utils/formato';
import { hoyBogota } from '../../utils/fechasBogota';
import type { DeportistaBusquedaItem } from '../../types/comun.types';
import type { DetallesBeneficiariosIncompletos, PlanResponse } from '../../types/membresias.types';

/** Lo elegido para el plan grupal; la venta se registra junto con su cobro en el siguiente paso. */
export interface DatosPlanGrupal {
  plan: PlanResponse;
  titular: DeportistaBusquedaItem;
  beneficiarios: DeportistaBusquedaItem[];
  fechaInicio?: string;
}

interface CrearPaqueteModalProps {
  isOpen: boolean;
  /** Planes del gimnasio; aquí solo se ofrecen los grupales activos. */
  planes: PlanResponse[];
  onCerrar: () => void;
  onContinuar: (datos: DatosPlanGrupal) => void;
}

/** Errores del contrato 1.3 en palabras de la recepción; `null` si no es un error del plan grupal. */
export function traducirErrorPaquete(err: ApiError): string | null {
  switch (err.codigo) {
    case 'BENEFICIARIOS_INCOMPLETOS': {
      const d = err.detalles as DetallesBeneficiariosIncompletos | null;
      return d
        ? `El plan exige exactamente ${d.requeridos} beneficiarios y hay ${d.recibidos}.`
        : 'El número de beneficiarios no coincide con el cupo del plan.';
    }
    case 'TITULAR_MENOR_DE_EDAD':
      return 'El titular debe ser mayor de 18 años y tener fecha de nacimiento registrada.';
    case 'TITULAR_NO_ES_BENEFICIARIO':
      return 'El titular también debe estar en la lista de beneficiarios.';
    case 'BENEFICIARIO_DUPLICADO':
      return 'Hay un beneficiario repetido en la lista.';
    default:
      return null;
  }
}

/**
 * Primer paso para vender un plan grupal (pareja o familiar, contrato 1.3, GW-RF-52): plan, titular y
 * beneficiarios (el titular cuenta como beneficiario). El cobro y `POST /membresias/paquetes` van juntos después.
 */
export const CrearPaqueteModal: React.FC<CrearPaqueteModalProps> = ({ isOpen, planes, onCerrar, onContinuar }) => {
  const grupales = planes.filter((p) => p.activo && p.cupo_personas > 1);

  const [planId, setPlanId] = useState('');
  const [titular, setTitular] = useState<DeportistaBusquedaItem | null>(null);
  const [otros, setOtros] = useState<DeportistaBusquedaItem[]>([]);
  const [fechaInicio, setFechaInicio] = useState('');
  const [avisoBuscador, setAvisoBuscador] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPlanId('');
    setTitular(null);
    setOtros([]);
    setFechaInicio(hoyBogota());
    setAvisoBuscador(null);
  }, [isOpen]);

  const plan = grupales.find((p) => p.id === planId) ?? null;
  const beneficiarios = titular ? [titular, ...otros] : otros;
  const faltan = plan ? plan.cupo_personas - beneficiarios.length : 0;

  const agregar = (d: DeportistaBusquedaItem | null) => {
    if (!d) return;
    setAvisoBuscador(null);
    if (beneficiarios.some((b) => b.id === d.id)) {
      setAvisoBuscador(`${d.nombre} ya está en la lista.`);
      return;
    }
    setOtros((prev) => [...prev, d]);
  };

  const elegirTitular = (d: DeportistaBusquedaItem | null) => {
    setTitular(d);
    // Si ya estaba entre los demás beneficiarios, se quita de allí: no puede ir dos veces.
    if (d) setOtros((prev) => prev.filter((o) => o.id !== d.id));
  };

  const listo = !!plan && !!titular && faltan === 0;

  const continuar = () => {
    if (!plan || !titular) return;
    onContinuar({ plan, titular, beneficiarios, fechaInicio: fechaInicio || undefined });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCerrar}
      title="Nuevo plan grupal"
      maxWidth="620px"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={continuar} disabled={!listo}>
            Continuar al cobro
          </Button>
        </>
      }
    >
      {grupales.length === 0 ? (
        <MensajeFijo tono="info">
          No hay planes grupales activos. Crea en Planes un plan de pareja o familiar con cupo de 2 o más personas.
        </MensajeFijo>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Select
              id="paquete-plan"
              label="Plan *"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              options={[
                { value: '', label: 'Selecciona un plan grupal' },
                ...grupales.map((p) => ({
                  value: p.id,
                  label: `${p.nombre} · ${p.cupo_personas} personas · ${formatCOP(p.precio)}`,
                })),
              ]}
            />
            <Input
              id="paquete-fecha-inicio"
              label="Fecha de inicio"
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>

          <BuscadorDeportista
            label="Titular * (mayor de edad, responde por el pago)"
            seleccionado={titular}
            onSeleccionar={elegirTitular}
          />

          <div style={{ marginBottom: 8, fontWeight: 600, fontSize: '0.9rem' }}>
            Beneficiarios {plan ? `(${beneficiarios.length} de ${plan.cupo_personas})` : ''}
          </div>
          {beneficiarios.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0 }}>
              Elige el titular: cuenta como el primer beneficiario.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {beneficiarios.map((b) => {
                const esTitular = titular?.id === b.id;
                return (
                  <li
                    key={b.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 10px',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{b.nombre}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{b.documento}</div>
                    </div>
                    {esTitular ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--primary)' }}>
                        <Crown size={14} /> Titular
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar a ${b.nombre}`}
                        onClick={() => setOtros((prev) => prev.filter((o) => o.id !== b.id))}
                      >
                        <Trash2 size={14} color="var(--danger)" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {plan && faltan > 0 && (
            <BuscadorDeportista
              label={`Agregar beneficiario (faltan ${faltan})`}
              seleccionado={null}
              onSeleccionar={agregar}
            />
          )}
          {plan && faltan < 0 && (
            <span className="form-error-msg">Sobran {Math.abs(faltan)}: el plan es para {plan.cupo_personas} personas.</span>
          )}
          {avisoBuscador && <span className="form-error-msg">{avisoBuscador}</span>}
        </>
      )}
    </Modal>
  );
};
