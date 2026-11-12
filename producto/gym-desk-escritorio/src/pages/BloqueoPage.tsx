import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { CampoPin, MensajeError, PantallaCentrada } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { UsuarioSesion } from '../types/sesion.types';

/** Pantalla bloqueada: la sesión sigue abierta, pero nada se ve ni se toca hasta desbloquear. */
export const BloqueoPage: React.FC<{ usuario: UsuarioSesion }> = ({ usuario }) => {
  const { desbloquearConPin, desbloquearConPassword, cerrar } = useSesion();
  const { enviando, error, setError, enviar } = useEnvio();
  const [conPin, setConPin] = useState(usuario.tiene_pin);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');

  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (conPin) {
      void enviar(() => desbloquearConPin(pin)).then((ok) => !ok && setPin(''));
    } else {
      void enviar(() => desbloquearConPassword(password)).then((ok) => !ok && setPassword(''));
    }
  };

  const puedeEnviar = conPin ? pin.length === 4 : password !== '';

  return (
    <PantallaCentrada
      titulo="Estación bloqueada"
      subtitulo={
        <>
          <Lock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Sesión de <strong>{usuario.nombre}</strong>
        </>
      }
    >
      <form onSubmit={alEnviar} noValidate>
        {conPin ? (
          <CampoPin label="PIN" value={pin} onChange={setPin} disabled={enviando} autoFocus />
        ) : (
          <Input label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={enviando} autoFocus />
        )}

        {error && <MensajeError>{error}</MensajeError>}

        <Button type="submit" size="lg" isLoading={enviando} disabled={!puedeEnviar} style={{ width: '100%', marginTop: 16 }}>
          Desbloquear
        </Button>
      </form>

      <div className="gd-acciones-secundarias">
        {usuario.tiene_pin && (
          <Button
            variant="ghost"
            size="sm"
            disabled={enviando}
            onClick={() => {
              setConPin(!conPin);
              setError(null);
              setPin('');
              setPassword('');
            }}
          >
            {conPin ? 'Usar contraseña' : 'Usar PIN'}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={enviando} onClick={() => void enviar(cerrar)}>
          Cerrar sesión para que entre otra persona
        </Button>
      </div>
    </PantallaCentrada>
  );
};
