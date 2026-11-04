import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { ContentSection } from '@/components/layout/ContentSection';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { gymService } from '@/services/gymService';
import { parseApiError } from '@/services/api/errorHandler';
import { useToast } from '@/hooks/useToast';
import { formatFechaHora } from '@/utils/format';
import { NotaGimnasio } from '@/types/gym.types';

const MAX_TEXTO = 2000;

/** SA-RF-28 Notas internas de MVC sobre el gimnasio: texto, autor y fecha. No se editan. */
export const NotasGimnasio: React.FC<{ gymId: string }> = ({ gymId }) => {
  const { success } = useToast();
  const [notas, setNotas] = useState<NotaGimnasio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [errorTexto, setErrorTexto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviandoRef = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setNotas(await gymService.getNotas(gymId));
      setError(null);
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setCargando(false);
    }
  }, [gymId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    if (!texto.trim()) {
      setErrorTexto('Escribe la nota.');
      return;
    }
    enviandoRef.current = true;
    setGuardando(true);
    setErrorTexto(null);
    try {
      const nota = await gymService.crearNota(gymId, texto.trim());
      setNotas((prev) => [nota, ...prev]);
      setTexto('');
      success('Nota guardada.');
    } catch (err) {
      setErrorTexto(parseApiError(err).message);
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <ContentSection title="Notas internas (SA-RF-28)" subtitle="Solo las ve MVC. Una nota guardada no se edita ni se borra.">
      <form onSubmit={guardar} noValidate style={{ marginBottom: '20px' }}>
        <FormField label="Nueva nota" error={errorTexto || undefined} helperText={`${texto.length}/${MAX_TEXTO}`}>
          <textarea
            value={texto}
            maxLength={MAX_TEXTO}
            rows={3}
            onChange={(e) => setTexto(e.target.value)}
            disabled={guardando}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-bg-input, var(--color-bg-card))',
              color: 'var(--color-text-primary)',
              font: 'inherit',
              resize: 'vertical',
            }}
          />
        </FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="submit" size="sm" isLoading={guardando} leftIcon={<StickyNote size={15} />}>
            Guardar nota
          </Button>
        </div>
      </form>

      {cargando && notas.length === 0 ? (
        <Skeleton height="80px" />
      ) : error ? (
        <ErrorState message={error} onRetry={cargar} />
      ) : notas.length === 0 ? (
        <EmptyState title="Sin notas" description="Anota acuerdos, llamadas o pendientes con este gimnasio." icon={<StickyNote size={28} />} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {notas.map((n) => (
            <div
              key={n.id}
              style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
            >
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-primary)' }}>
                {n.texto}
              </div>
              <div style={{ marginTop: '6px', fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)' }}>
                {n.autor_nombre ?? 'Autor eliminado'} · {formatFechaHora(n.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </ContentSection>
  );
};
