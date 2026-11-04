import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { toApiError, urlDeImagen } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { formatCOP } from '../../utils/formato';
import type { PublicLandingResponse } from '../../types/myGym.types';

const ETIQUETA_HORARIO: Record<string, string> = {
  lunes_viernes: 'Lunes a viernes',
  sabados: 'Sábados',
  domingos_festivos: 'Domingos y festivos',
};

const RED: Record<string, { etiqueta: string; base: string }> = {
  instagram: { etiqueta: 'Instagram', base: 'https://instagram.com/' },
  facebook: { etiqueta: 'Facebook', base: 'https://facebook.com/' },
  tiktok: { etiqueta: 'TikTok', base: 'https://tiktok.com/@' },
};

/** Convierte lo que escribió el gimnasio en un enlace seguro; solo admite http y https. */
function enlaceRed(red: string, valor: string): string | null {
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  const base = RED[red]?.base;
  return base ? `${base}${v.replace(/^@/, '')}` : null;
}

function enlaceWhatsApp(valor: string): string | null {
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.length === 10 ? `57${digitos}` : digitos}`;
}

const seccion: React.CSSProperties = { maxWidth: 1080, margin: '0 auto', padding: '48px 20px' };
const tituloSeccion: React.CSSProperties = { fontSize: '1.6rem', fontWeight: 600, margin: '0 0 20px' };
const rejilla: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 };

/**
 * Página pública del gimnasio en la raíz de su subdominio (`demo.gymdeskcolombia.com/`).
 * Una sola plantilla, llenada con lo que el gimnasio configura en Configuración · Landing.
 */
export const LandingGimnasioPage: React.FC = () => {
  const { tenant } = useTenantTheme();
  const { isAuthenticated } = useAuth();
  const subdominio = tenant.subdominio;
  const [datos, setDatos] = useState<PublicLandingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subdominio) {
      setError('Abre esta página desde la dirección de tu gimnasio.');
      return;
    }
    let vigente = true;
    myGymService
      .getPublicLanding(subdominio)
      .then((d) => {
        if (vigente) {
          setDatos(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!vigente) return;
        const err = toApiError(e);
        setError(err.status === 404 ? 'No encontramos este gimnasio.' : 'Esta página no está disponible en este momento.');
      });
    return () => {
      vigente = false;
    };
  }, [subdominio]);

  if (error || !datos) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center', background: 'var(--bg-app, #f5f6fa)' }}>
        {error ? (
          <div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>{error}</h1>
            <Link to="/login">Ir al inicio de sesión</Link>
          </div>
        ) : (
          <p aria-live="polite">Cargando…</p>
        )}
      </div>
    );
  }

  const principal = datos.primary_color;
  const whatsapp = datos.redes.whatsapp ? enlaceWhatsApp(datos.redes.whatsapp) : null;
  const banner = urlDeImagen(datos.banner_url);
  const logo = urlDeImagen(datos.logo_url);
  const redes = Object.entries(datos.redes)
    .filter(([red]) => red !== 'whatsapp')
    .map(([red, valor]) => ({ red, enlace: enlaceRed(red, valor) }))
    .filter((r): r is { red: string; enlace: string } => !!r.enlace);
  const horarios = Object.entries(datos.horarios).filter(([, v]) => v);
  const hayContacto = datos.direccion || datos.telefono || datos.correo || redes.length > 0;

  return (
    <div style={{ background: '#fff', color: '#111827', minHeight: '100vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {logo && <img src={logo} alt="" style={{ height: 40, maxWidth: 120, objectFit: 'contain' }} />}
          <strong style={{ fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{datos.nombre}</strong>
        </div>
        <Link
          to={isAuthenticated ? '/inicio' : '/login'}
          style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${principal}`, color: principal, textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          {isAuthenticated ? 'Ir al panel' : 'Ingresar'}
        </Link>
      </header>

      <section
        style={{
          background: banner ? `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55)), url("${banner}") center/cover` : principal,
          color: '#fff',
        }}
      >
        <div style={{ ...seccion, padding: '72px 20px' }}>
          <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.25rem)', fontWeight: 700, margin: '0 0 14px', maxWidth: 760 }}>
            {datos.titulo || datos.nombre}
          </h1>
          {datos.descripcion && <p style={{ fontSize: '1.1rem', maxWidth: 680, margin: '0 0 24px', whiteSpace: 'pre-line' }}>{datos.descripcion}</p>}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 8, background: '#fff', color: '#111827', textDecoration: 'none', fontWeight: 600 }}
            >
              <MessageCircle size={18} /> Escríbenos por WhatsApp
            </a>
          )}
        </div>
      </section>

      {datos.planes.length > 0 && (
        <section style={seccion}>
          <h2 style={tituloSeccion}>Planes</h2>
          <div style={rejilla}>
            {datos.planes.map((p) => (
              <div key={p.nombre} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.nombre}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: principal }}>{formatCOP(p.precio)}</div>
                <div style={{ color: '#4b5563', fontSize: '0.9rem', marginTop: 4 }}>
                  {p.duracion_dias} días{p.cupo_personas > 1 ? ` · ${p.cupo_personas} personas` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {datos.clases.length > 0 && (
        <section style={{ background: '#f9fafb' }}>
          <div style={seccion}>
            <h2 style={tituloSeccion}>Clases</h2>
            <div style={rejilla}>
              {datos.clases.map((c) => (
                <div key={c.nombre} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{c.nombre}</div>
                  {c.descripcion && <p style={{ color: '#4b5563', fontSize: '0.92rem', margin: '0 0 8px' }}>{c.descripcion}</p>}
                  <div style={{ color: '#4b5563', fontSize: '0.85rem' }}>{c.duracion_minutos} minutos</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {(horarios.length > 0 || hayContacto) && (
        <section style={{ ...seccion, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 32 }}>
          {horarios.length > 0 && (
            <div>
              <h2 style={tituloSeccion}>Horarios</h2>
              {horarios.map(([clave, valor]) => (
                <div key={clave} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'baseline' }}>
                  <Clock size={15} style={{ flexShrink: 0, alignSelf: 'center' }} />
                  <span style={{ fontWeight: 500 }}>{ETIQUETA_HORARIO[clave] ?? clave.replace(/_/g, ' ')}:</span>
                  <span style={{ color: '#4b5563' }}>{valor}</span>
                </div>
              ))}
            </div>
          )}
          {hayContacto && (
            <div>
              <h2 style={tituloSeccion}>Contacto</h2>
              {datos.direccion && (
                <p style={{ display: 'flex', gap: 10, margin: '0 0 10px' }}>
                  <MapPin size={16} style={{ flexShrink: 0, marginTop: 3 }} />
                  {datos.direccion}
                  {datos.ciudad ? `, ${datos.ciudad}` : ''}
                </p>
              )}
              {datos.telefono && (
                <p style={{ display: 'flex', gap: 10, margin: '0 0 10px' }}>
                  <Phone size={16} style={{ flexShrink: 0, marginTop: 3 }} />
                  <a href={`tel:${datos.telefono.replace(/[^\d+]/g, '')}`} style={{ color: 'inherit' }}>{datos.telefono}</a>
                </p>
              )}
              {datos.correo && (
                <p style={{ display: 'flex', gap: 10, margin: '0 0 10px' }}>
                  <Mail size={16} style={{ flexShrink: 0, marginTop: 3 }} />
                  <a href={`mailto:${datos.correo}`} style={{ color: 'inherit', wordBreak: 'break-all' }}>{datos.correo}</a>
                </p>
              )}
              {redes.length > 0 && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
                  {redes.map((r) => (
                    <a key={r.red} href={r.enlace} target="_blank" rel="noopener noreferrer" style={{ color: principal, fontWeight: 500 }}>
                      {RED[r.red]?.etiqueta ?? r.red}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <footer style={{ borderTop: '1px solid #e5e7eb', padding: 20, textAlign: 'center', color: '#6b7280', fontSize: '0.85rem' }}>
        {datos.nombre}
      </footer>
    </div>
  );
};
