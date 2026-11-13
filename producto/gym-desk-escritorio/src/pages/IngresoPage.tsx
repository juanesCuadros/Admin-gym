import React, { useEffect, useState } from 'react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { sesionService } from '../api/sesion.service';
import { IndicadorSync } from '../components/IndicadorSync';
import { CampoPin, MensajeError, PantallaCentrada } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { PersonaConPin } from '../types/sesion.types';

type Modo = 'pin' | 'password';

export const IngresoPage: React.FC = () => {
  const { estacion, iniciarConPassword, iniciarConPin } = useSesion();
  const { enviando, error, setError, enviar } = useEnvio();

  const [personas, setPersonas] = useState<PersonaConPin[] | null>(null);
  const [modo, setModo] = useState<Modo>('password');
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    let vigente = true;
    sesionService
      .personalConPin()
      .then((lista) => {
        if (!vigente) return;
        setPersonas(lista);
        // Si alguien ya tiene PIN en esta estación, es el camino más rápido.
        if (lista.length > 0) setModo('pin');
      })
      .catch(() => vigente && setPersonas([]));
    return () => {
      vigente = false;
    };
  }, []);

  const cambiarModo = (nuevo: Modo) => {
    setModo(nuevo);
    setError(null);
    setPin('');
    setPassword('');
  };

  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (modo === 'password') {
      void enviar(() => iniciarConPassword(correo, password)).then((ok) => !ok && setPassword(''));
    } else if (personaId) {
      void enviar(() => iniciarConPin(personaId, pin)).then((ok) => !ok && setPin(''));
    }
  };

  const hayPin = (personas?.length ?? 0) > 0;
  const puedeEnviar = modo === 'password' ? correo.trim() !== '' && password !== '' : personaId !== null && pin.length === 4;

  return (
    <PantallaCentrada
      titulo="Ingresa a la estación"
      subtitulo={estacion?.gimnasio_nombre ?? undefined}
      pie={
        estacion && (
          <>
            <IndicadorSync estacion={estacion} />
            <span>Versión {estacion.version_app}</span>
          </>
        )
      }
    >
      {hayPin && (
        <div className="gd-pestanas" role="tablist">
          <button type="button" role="tab" aria-selected={modo === 'pin'} className={modo === 'pin' ? 'activa' : ''} onClick={() => cambiarModo('pin')}>
            Con PIN
          </button>
          <button type="button" role="tab" aria-selected={modo === 'password'} className={modo === 'password' ? 'activa' : ''} onClick={() => cambiarModo('password')}>
            Con contraseña
          </button>
        </div>
      )}

      <form onSubmit={alEnviar} noValidate>
        {modo === 'password' ? (
          <>
            <Input label="Correo" type="email" autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={enviando} autoFocus />
            <Input label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={enviando} />
          </>
        ) : (
          <>
            <div className="form-group">
              <span className="form-label">¿Quién eres?</span>
              <div className="gd-personas">
                {personas?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`gd-persona ${personaId === p.id ? 'elegida' : ''}`}
                    aria-pressed={personaId === p.id}
                    disabled={enviando}
                    onClick={() => {
                      setPersonaId(p.id);
                      setPin('');
                      setError(null);
                    }}
                  >
                    {p.nombre}
                  </button>
                ))}
              </div>
            </div>
            {personaId && <CampoPin key={personaId} label="PIN" value={pin} onChange={setPin} disabled={enviando} autoFocus />}
          </>
        )}

        {error && <MensajeError>{error}</MensajeError>}

        <Button type="submit" size="lg" isLoading={enviando} disabled={!puedeEnviar} style={{ width: '100%', marginTop: 16 }}>
          Ingresar
        </Button>
      </form>
    </PantallaCentrada>
  );
};
