import React from 'react';
import { Tv, ExternalLink } from 'lucide-react';
import { EnConstruccion } from '../../components/estados/Estados';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

/** Fabrica una página "en construcción" para rutas del menú que aún no tienen pantalla (§B2). */
export function enConstruccion(titulo: string, descripcion?: string): React.FC {
  const Pagina: React.FC = () => <EnConstruccion titulo={titulo} descripcion={descripcion} />;
  Pagina.displayName = `EnConstruccion(${titulo})`;
  return Pagina;
}

/**
 * Submódulo "Pantalla TV" dentro de Control de ingreso. La pantalla como tal es pública y a
 * pantalla completa (`/pantalla-tv`); aquí solo se abre. La configuración (avisos, logo, token)
 * no tiene pantalla todavía.
 */
export const PantallaTvAccesoPage: React.FC = () => (
  <div>
    <div className="page-header">
      <div>
        <h1 className="page-title">Pantalla TV</h1>
        <p className="page-subtitle">Modo de visualización del control de ingreso para el monitor de recepción</p>
      </div>
    </div>
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--primary-light)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Tv size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700 }}>Abrir la pantalla en una pestaña nueva</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            La pantalla pide el token del dispositivo la primera vez. La configuración de avisos y logo estará
            disponible en una próxima entrega.
          </div>
        </div>
        <Button
          variant="primary"
          rightIcon={<ExternalLink size={16} />}
          onClick={() => window.open('/pantalla-tv', '_blank', 'noopener')}
        >
          Abrir pantalla TV
        </Button>
      </div>
    </Card>
  </div>
);
