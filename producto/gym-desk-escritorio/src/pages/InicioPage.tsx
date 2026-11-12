import React, { useState } from 'react';
import { Dumbbell, KeyRound, Lock, LogOut } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { useToast } from '@web/contexts/ToastContext';
import { CampoPin, MensajeError } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { UsuarioSesion } from '../types/sesion.types';

const NOMBRE_ROL: Record<UsuarioSesion['rol'], string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

/**
 * Sesión abierta. En esta fase solo existe lo propio de la sesión: bloquear,
 * cerrar y definir el PIN. Ingreso y caja llegan en las fases 2 y 3.
 */
export const InicioPage: React.FC<{ usuario: UsuarioSesion }> = ({ usuario }) => {
  const { estacion, sesion, bloquear, cerrar, definirPin } = useSesion();
  const { showToast } = useToast();
  const accion = useEnvio();
  const formPin = useEnvio();

  const [passwordActual, setPasswordActual] = useState('');
  const [pin, setPin] = useState('');
  const [pinRepetido, setPinRepetido] = useState('');

  const noCoincide = pinRepetido.length === 4 && pin !== pinRepetido;
  const puedeGuardar = passwordActual !== '' && pin.length === 4 && pin === pinRepetido;

  const alGuardarPin = (e: React.FormEvent) => {
    e.preventDefault();
    const teniaPin = usuario.tiene_pin;
    void formPin
      .enviar(() => definirPin(passwordActual, pin))
      .then((ok) => {
        setPasswordActual('');
        if (!ok) return;
        setPin('');
        setPinRepetido('');
        showToast('success', teniaPin ? 'PIN cambiado' : 'PIN creado', 'Ya puedes entrar y desbloquear esta estación con tu PIN.');
      });
  };

  return (
    <div className="gd-app">
      <header className="gd-barra">
        <div className="gd-marca" style={{ margin: 0 }}>
          <span className="gd-marca-icono">
            <Dumbbell size={18} />
          </span>
          {estacion?.gimnasio_nombre ?? 'GymDesk'}
        </div>
        <div className="gd-barra-usuario">
          <span>
            <strong>{usuario.nombre}</strong> · {NOMBRE_ROL[usuario.rol]}
          </span>
          <Button variant="outline" size="sm" leftIcon={<Lock size={15} />} disabled={accion.enviando} onClick={() => void accion.enviar(bloquear)}>
            Bloquear
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<LogOut size={15} />} disabled={accion.enviando} onClick={() => void accion.enviar(cerrar)}>
            Cerrar sesión
          </Button>
        </div>
      </header>

      <main className="gd-contenido">
        {accion.error && <MensajeError>{accion.error}</MensajeError>}

        <section className="gd-tarjeta" style={{ maxWidth: 440 }}>
          <h2 className="gd-titulo" style={{ fontSize: '1.15rem' }}>
            <KeyRound size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
            {usuario.tiene_pin ? 'Cambiar mi PIN' : 'Crear mi PIN'}
          </h2>
          <p className="gd-subtitulo">
            El PIN es de 4 números y solo sirve en esta estación. Con él entras y desbloqueas sin escribir la contraseña. La
            estación se bloquea sola a los {sesion?.minutos_inactividad ?? 5} minutos sin uso.
          </p>
          <form onSubmit={alGuardarPin} noValidate>
            <Input label="Tu contraseña actual" type="password" autoComplete="current-password" value={passwordActual} onChange={(e) => setPasswordActual(e.target.value)} disabled={formPin.enviando} />
            <CampoPin label="PIN nuevo" value={pin} onChange={setPin} disabled={formPin.enviando} />
            <CampoPin label="Repite el PIN" value={pinRepetido} onChange={setPinRepetido} disabled={formPin.enviando} error={noCoincide ? 'Los dos PIN no coinciden.' : undefined} />
            {formPin.error && <MensajeError>{formPin.error}</MensajeError>}
            <Button type="submit" isLoading={formPin.enviando} disabled={!puedeGuardar} style={{ marginTop: 16 }}>
              {usuario.tiene_pin ? 'Cambiar PIN' : 'Crear PIN'}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
};
