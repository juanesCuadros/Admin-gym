import React, { ReactNode } from 'react';
import { AlertCircle, Dumbbell } from 'lucide-react';
import { Input } from '@web/components/ui/Input';

/** Marco de las pantallas previas a la operación: marca, tarjeta centrada y pie con la versión. */
export const PantallaCentrada: React.FC<{ titulo: string; subtitulo?: ReactNode; pie?: ReactNode; children: ReactNode }> = ({
  titulo,
  subtitulo,
  pie,
  children,
}) => (
  <main className="gd-centro">
    <div className="gd-marca">
      <span className="gd-marca-icono">
        <Dumbbell size={22} />
      </span>
      GymDesk
    </div>
    <section className="gd-tarjeta">
      <h1 className="gd-titulo">{titulo}</h1>
      {subtitulo && <p className="gd-subtitulo">{subtitulo}</p>}
      {children}
    </section>
    {pie && <footer className="gd-pie">{pie}</footer>}
  </main>
);

/** Error como mensaje fijo: no desaparece solo (GW-RNF-06). */
export const MensajeError: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="gd-error" role="alert">
    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
    <span>{children}</span>
  </div>
);

interface CampoPinProps {
  label: string;
  value: string;
  onChange: (pin: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string;
}

/** Campo de PIN: solo números, máximo 4, oculto. */
export const CampoPin: React.FC<CampoPinProps> = ({ label, value, onChange, autoFocus, disabled, error }) => (
  <Input
    label={label}
    type="password"
    inputMode="numeric"
    autoComplete="off"
    maxLength={4}
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
    autoFocus={autoFocus}
    disabled={disabled}
    error={error}
    className="gd-pin"
  />
);
