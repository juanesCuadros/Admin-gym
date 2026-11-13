import React, { useState } from 'react';
import { Button } from '@web/components/ui/Button';
import { Input } from '@web/components/ui/Input';
import { MensajeError, PantallaCentrada } from '../components/Piezas';
import { useSesion } from '../contexts/SesionContext';
import { useEnvio } from '../hooks/useEnvio';
import type { EstadoEstacion } from '../types/estacion.types';

/** `abcd efgh` → `ABCD-EFGH`: se acepta como lo escriba la persona. */
function formatearCodigo(valor: string): string {
  const limpio = valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
}

/** Estación recién instalada: se conecta al gimnasio con su subdominio y el código que generó el Jefe. */
export const ActivacionPage: React.FC<{ estacion: EstadoEstacion }> = ({ estacion }) => {
  const { activar } = useSesion();
  const { enviando, error, enviar } = useEnvio();
  const [subdominio, setSubdominio] = useState('');
  const [codigo, setCodigo] = useState('');

  const puedeEnviar = subdominio.trim().length >= 2 && codigo.replace('-', '').length === 8;

  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    void enviar(() => activar(subdominio, codigo));
  };

  return (
    <PantallaCentrada
      titulo="Activa esta estación"
      subtitulo="Conéctala con tu gimnasio. Necesitas internet solo para este paso y para la primera descarga."
      pie={`Versión ${estacion.version_app} · Estación ${estacion.estacion_id.slice(0, 8)}`}
    >
      <form onSubmit={alEnviar} noValidate>
        <Input
          label="Subdominio del gimnasio"
          placeholder="migimnasio"
          hint="Lo que va antes de .gymdeskcolombia.com"
          autoCapitalize="none"
          spellCheck={false}
          value={subdominio}
          onChange={(e) => setSubdominio(e.target.value)}
          disabled={enviando}
          autoFocus
        />
        <Input
          label="Código de estación"
          placeholder="XXXX-XXXX"
          hint="El Jefe lo genera en el sistema web: Configuración → Estaciones. Vence en 24 horas."
          autoComplete="off"
          spellCheck={false}
          value={codigo}
          onChange={(e) => setCodigo(formatearCodigo(e.target.value))}
          disabled={enviando}
          className="gd-codigo"
        />

        {error && <MensajeError>{error}</MensajeError>}

        <Button type="submit" size="lg" isLoading={enviando} disabled={!puedeEnviar} style={{ width: '100%', marginTop: 16 }}>
          Activar estación
        </Button>
      </form>
    </PantallaCentrada>
  );
};
