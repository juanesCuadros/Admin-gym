import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Ban, RefreshCw, Copy, Check } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Button } from '../../components/ui/Button';
import { MensajeFijo } from '../../components/estados/Estados';
import { STORAGE } from '../../api/client';

/**
 * Motivos que la UI puede distinguir hoy. El backend solo responde `GIMNASIO_SUSPENDIDO`
 * (tenant inactivo) o `GIMNASIO_NO_ENCONTRADO`/`TENANT_NO_ENCONTRADO`; no separa
 * falta de pago, suspensión por MVC, cancelación ni prueba vencida.
 */
export type MotivoBloqueo = 'suspendido' | 'no_encontrado' | 'no_disponible';

const TEXTO_MOTIVO: Record<MotivoBloqueo, { titulo: string; detalle: string }> = {
  suspendido: {
    titulo: 'Servicio no disponible',
    detalle:
      'El servicio de este gimnasio está suspendido. Puede deberse a falta de pago, a una suspensión por parte de MVC, a la cancelación del servicio o a que venció el período de prueba.',
  },
  no_encontrado: {
    titulo: 'Gimnasio no encontrado',
    detalle: 'No existe ningún gimnasio registrado en esta dirección. Revisa el subdominio con el que ingresaste.',
  },
  no_disponible: {
    titulo: 'Servicio no disponible',
    detalle: 'El gimnasio no está disponible en este momento.',
  },
};

/** Contacto de MVC. Se configura en el build (`VITE_MVC_CONTACTO`); no se inventa. */
const CONTACTO_MVC: string = (import.meta.env.VITE_MVC_CONTACTO as string | undefined)?.trim() ?? '';

export const BloqueadoPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant, recargarBranding } = useTenantTheme();

  const motivoState = (location.state as { motivo?: MotivoBloqueo } | null)?.motivo;
  const motivoGuardado = sessionStorage.getItem(STORAGE.bloqueoMotivo) as MotivoBloqueo | null;
  const motivo: MotivoBloqueo = motivoState ?? motivoGuardado ?? 'no_disponible';
  const texto = TEXTO_MOTIVO[motivo];

  const [reintentando, setReintentando] = useState(false);
  const [sigueBloqueado, setSigueBloqueado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const reintentar = async () => {
    setReintentando(true);
    setSigueBloqueado(false);
    const estado = await recargarBranding();
    setReintentando(false);
    if (estado === 'ok') {
      // MVC ya registró el pago (o el subdominio ya existe): se deja entrar sin esperar nada más.
      sessionStorage.removeItem(STORAGE.bloqueoMotivo);
      navigate('/login', { replace: true });
      return;
    }
    setSigueBloqueado(true);
  };

  const copiarContacto = async () => {
    if (!CONTACTO_MVC) return;
    try {
      await navigator.clipboard.writeText(CONTACTO_MVC);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el portapapeles no está disponible, el contacto sigue visible en pantalla.
    }
  };

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica" style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-light)',
            color: 'var(--danger)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}
        >
          <Ban size={28} />
        </div>

        {tenant.nombre && motivo !== 'no_encontrado' && (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>{tenant.nombre}</div>
        )}
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {texto.titulo}
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 10 }}>
          {texto.detalle}
        </p>

        <div
          style={{
            marginTop: 20,
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            fontSize: '0.875rem',
            textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Contacto de MVC</div>
          {CONTACTO_MVC ? (
            <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{CONTACTO_MVC}</div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>Contacto no configurado en esta instalación.</div>
          )}
        </div>

        {sigueBloqueado && (
          <MensajeFijo tono="advertencia" style={{ marginTop: 16, textAlign: 'left' }}>
            El servicio sigue sin estar disponible.
          </MensajeFijo>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Button
            variant="primary"
            style={{ flex: 1 }}
            isLoading={reintentando}
            leftIcon={<RefreshCw size={16} />}
            onClick={reintentar}
          >
            Reintentar
          </Button>
          <Button
            variant="outline"
            style={{ flex: 1 }}
            disabled={!CONTACTO_MVC}
            leftIcon={copiado ? <Check size={16} /> : <Copy size={16} />}
            onClick={copiarContacto}
          >
            {copiado ? 'Copiado' : 'Copiar contacto'}
          </Button>
        </div>
      </div>
    </div>
  );
};
