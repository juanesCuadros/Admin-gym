import React, { useMemo, useState, useEffect } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input, Select } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../contexts/ToastContext';
import { toApiError } from '../../../api/client';
import { portalService } from '../../../api/portal.service';
import { formatDecimal } from '../../../utils/formato';
import type { PerfilDeportistaResponse } from '../../../types/portal.types';

function calcularDerivadasPreview(params: {
  sexo: 'M' | 'F';
  alturaCm: number;
  peso: number | null;
  cintura: number | null;
  cadera: number | null;
  brazo: number | null;
  pierna: number | null;
}): { imc: number | null; grasaPct: number | null; masaMuscular: number | null } {
  const esMujer = params.sexo === 'F';
  const alt = params.alturaCm > 0 ? params.alturaCm : esMujer ? 162 : 172;
  const { peso, cintura, cadera, brazo, pierna } = params;

  let imc: number | null = null;
  if (peso && peso > 0 && alt > 0) {
    const m = alt / 100;
    imc = Math.round((peso / (m * m)) * 10) / 10;
  }

  let rfm: number | null = null;
  if (cintura && cintura > 0 && alt > 0) {
    if (esMujer) {
      const aj = cadera && cadera > 0 ? Math.max(-3, Math.min(4, 0.15 * (cadera - cintura - 15))) : 0;
      rfm = 76 - 20 * (alt / cintura) + aj;
    } else {
      rfm = 64 - 20 * (alt / cintura);
    }
  }

  let bmiGrasa: number | null = null;
  if (imc !== null) {
    bmiGrasa = 1.2 * imc + 0.23 * 28 - (esMujer ? 5.4 : 16.2);
  }

  let grasaRaw: number | null = null;
  if (rfm !== null && bmiGrasa !== null) grasaRaw = 0.6 * rfm + 0.4 * bmiGrasa;
  else if (rfm !== null) grasaRaw = rfm;
  else if (bmiGrasa !== null) grasaRaw = bmiGrasa;

  let grasaPct: number | null = null;
  if (grasaRaw !== null) {
    const [minG, maxG] = esMujer ? [10, 60] : [4, 55];
    grasaPct = Math.round(Math.max(minG, Math.min(maxG, grasaRaw)) * 10) / 10;
  }

  let masaMuscular: number | null = null;
  if (peso && peso > 0 && grasaPct !== null) {
    const magra = peso * (1 - grasaPct / 100);
    let calc = 0;
    if (esMujer) {
      let aj = 0;
      if (brazo && brazo > 0) aj += (brazo - 27) * 0.06;
      if (pierna && pierna > 0) aj += (pierna - 52) * 0.05;
      calc = magra * 0.475 + aj;
    } else {
      let aj = 0;
      if (brazo && brazo > 0) aj += (brazo - 32) * 0.08;
      if (pierna && pierna > 0) aj += (pierna - 54) * 0.06;
      calc = magra * 0.54 + aj;
    }
    masaMuscular = Math.round(Math.max(peso * 0.25, Math.min(magra * 0.9, calc)) * 10) / 10;
  }

  return { imc, grasaPct, masaMuscular };
}

interface ModalNuevaMedidaProps {
  isOpen: boolean;
  onClose: () => void;
  perfil: PerfilDeportistaResponse | null;
  onMedicionGuardada: () => void;
}

export const ModalNuevaMedida: React.FC<ModalNuevaMedidaProps> = ({
  isOpen,
  onClose,
  perfil,
  onMedicionGuardada,
}) => {
  const { showToast } = useToast();

  const [medSexo, setMedSexo] = useState<'M' | 'F'>('M');
  const [medAltura, setMedAltura] = useState('');
  const [medPeso, setMedPeso] = useState('');
  const [medCintura, setMedCintura] = useState('');
  const [medCadera, setMedCadera] = useState('');
  const [medPecho, setMedPecho] = useState('');
  const [medBrazo, setMedBrazo] = useState('');
  const [medPierna, setMedPierna] = useState('');

  const [errorMedPeso, setErrorMedPeso] = useState<string | undefined>(undefined);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const sexoInicial = perfil?.sexo === 'F' ? 'F' : 'M';
      setMedSexo(sexoInicial);
      setMedAltura(perfil?.altura_cm ? String(perfil.altura_cm) : sexoInicial === 'F' ? '162' : '172');
      setMedPeso(perfil?.ultimo_peso_kg ? String(perfil.ultimo_peso_kg) : '');
      setMedCintura('');
      setMedCadera('');
      setMedPecho('');
      setMedBrazo('');
      setMedPierna('');
      setErrorMedPeso(undefined);
    }
  }, [isOpen, perfil]);

  const previewDerivadas = useMemo(() => {
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return calcularDerivadasPreview({
      sexo: medSexo,
      alturaCm: num(medAltura) ?? (medSexo === 'F' ? 162 : 172),
      peso: num(medPeso),
      cintura: num(medCintura),
      cadera: num(medCadera),
      brazo: num(medBrazo),
      pierna: num(medPierna),
    });
  }, [medSexo, medAltura, medPeso, medCintura, medCadera, medBrazo, medPierna]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pesoNum = Number(medPeso);
    if (!medPeso || !Number.isFinite(pesoNum) || pesoNum < 20 || pesoNum > 350) {
      setErrorMedPeso('Ingresa un peso válido entre 20 y 350 kg.');
      return;
    }

    const opc = (v: string) => {
      const n = Number(v);
      return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
    };

    setGuardando(true);
    try {
      await portalService.registrarMedicion({
        sexo: medSexo,
        altura_cm: opc(medAltura),
        peso: pesoNum,
        cintura: opc(medCintura),
        cadera: opc(medCadera),
        pecho: opc(medPecho),
        brazo: opc(medBrazo),
        pierna: opc(medPierna),
      });

      onMedicionGuardada();
      onClose();
      showToast('success', 'Medición registrada exitosamente en tu historial');
    } catch (err) {
      showToast('error', toApiError(err).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Agregar registro de medidas corporales"
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <div>
          <Select
            label="Género para el cálculo"
            value={medSexo}
            onChange={(e) => setMedSexo(e.target.value as 'M' | 'F')}
            options={[
              { value: 'M', label: 'Masculino' },
              { value: 'F', label: 'Femenino' },
            ]}
            hint="Ajusta el cálculo de % de grasa y masa muscular"
          />
        </div>

        <div>
          <Input
            label="Estatura base (cm)"
            type="number"
            min={80}
            max={250}
            step="0.5"
            value={medAltura}
            onChange={(e) => setMedAltura(e.target.value)}
            hint="Para cálculo automático de IMC y % grasa"
          />
        </div>

        <div>
          <Input
            label="Peso Corporal (kg) *"
            type="number"
            min={20}
            max={350}
            step="0.1"
            placeholder="Ej. 74.5"
            value={medPeso}
            onChange={(e) => {
              setMedPeso(e.target.value);
              if (errorMedPeso) setErrorMedPeso(undefined);
            }}
            error={errorMedPeso}
            autoFocus
          />
        </div>

        <div>
          <Input
            label="Cintura (cm)"
            type="number"
            min={35}
            max={220}
            step="0.1"
            placeholder="Ej. 82"
            value={medCintura}
            onChange={(e) => setMedCintura(e.target.value)}
          />
        </div>

        <div>
          <Input
            label="Cadera (cm)"
            type="number"
            min={40}
            max={230}
            step="0.1"
            placeholder="Ej. 96"
            value={medCadera}
            onChange={(e) => setMedCadera(e.target.value)}
          />
        </div>

        <div>
          <Input
            label="Pecho (cm)"
            type="number"
            min={45}
            max={220}
            step="0.1"
            placeholder="Ej. 98"
            value={medPecho}
            onChange={(e) => setMedPecho(e.target.value)}
          />
        </div>

        <div>
          <Input
            label="Brazo (cm)"
            type="number"
            min={15}
            max={80}
            step="0.1"
            placeholder="Ej. 34"
            value={medBrazo}
            onChange={(e) => setMedBrazo(e.target.value)}
          />
        </div>

        <div>
          <Input
            label="Pierna (cm)"
            type="number"
            min={25}
            max={120}
            step="0.1"
            placeholder="Ej. 56"
            value={medPierna}
            onChange={(e) => setMedPierna(e.target.value)}
          />
        </div>

        {/* Vista previa de medidas derivadas */}
        <div
          style={{
            gridColumn: '1 / -1',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            borderRadius: 10,
            padding: 14,
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Cálculo estimado en tiempo real ({medSexo === 'F' ? 'Fórmula Mujer' : 'Fórmula Hombre'}):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>IMC</div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                {previewDerivadas.imc !== null ? formatDecimal(previewDerivadas.imc) : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>% Grasa Corporal</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--primary)' }}>
                {previewDerivadas.grasaPct !== null ? `${formatDecimal(previewDerivadas.grasaPct)}%` : '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Masa Muscular</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--success, #16a34a)' }}>
                {previewDerivadas.masaMuscular !== null ? `${formatDecimal(previewDerivadas.masaMuscular)} kg` : '—'}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
          }}
        >
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" isLoading={guardando}>
            Guardar Medición
          </Button>
        </div>
      </form>
    </Modal>
  );
};

