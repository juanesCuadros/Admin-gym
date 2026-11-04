import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Mail, MapPin, MessageCircle, Navigation, Phone } from 'lucide-react';
import { myGymService } from '../../api/myGym.service';
import { toApiError, urlDeImagen } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { formatCOP, formatDiaSemana, formatHora } from '../../utils/formato';
import type { PublicLandingResponse } from '../../types/myGym.types';
import './landing.css';

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

const ordenHorario = (clave: string) => {
  const i = Object.keys(ETIQUETA_HORARIO).indexOf(clave);
  return i === -1 ? 99 : i;
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

/** Lo que se muestra de la red: el usuario, o el nombre de la red si escribieron una dirección completa. */
function textoRed(red: string, valor: string): string {
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return RED[red]?.etiqueta ?? red;
  return v.startsWith('@') ? v : `@${v}`;
}

/** Negro o blanco, el que se lea mejor sobre el color del gimnasio. */
function textoSobre(color: string): string {
  let h = color.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return '#ffffff';
  const canal = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luz = 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
  return luz > 0.4 ? '#111111' : '#ffffff';
}

const IconoRed: React.FC<{ red: string; size?: number }> = ({ red, size = 20 }) => {
  const comun = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (red === 'instagram') {
    return (
      <svg {...comun} fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (red === 'facebook') {
    return (
      <svg {...comun} fill="currentColor">
        <path d="M14 8.5V6.8c0-.8.5-1 1-1h2V2.5h-2.8C11.3 2.5 10 4.5 10 6.6v1.9H7.5V12H10v9.5h4V12h2.7l.5-3.5H14z" />
      </svg>
    );
  }
  if (red === 'tiktok') {
    return (
      <svg {...comun} fill="currentColor">
        <path d="M16.5 3c.3 2.3 1.700 3.900 4 4.200v3.200c-1.500 0-2.800-.4-4-1.200v6.300a6 6 0 1 1-6-6c.3 0 .7 0 1 .1v3.300a2.800 2.800 0 1 0 1.800 2.600V3h3.200z" />
      </svg>
    );
  }
  return <MessageCircle size={size} aria-hidden="true" />;
};

interface EnlaceRed {
  red: string;
  enlace: string;
  texto: string;
}

/** Franja en movimiento. El segundo grupo solo sirve para que el giro no tenga cortes. */
const FranjaRedes: React.FC<{ redes: EnlaceRed[] }> = ({ redes }) => {
  // Se repite el contenido para que llene pantallas anchas aunque haya una sola red.
  const veces = redes.length === 1 ? 6 : redes.length === 2 ? 4 : 3;
  const grupo = (oculto: boolean) => (
    <div className="lp-franja-grupo" aria-hidden={oculto || undefined}>
      {Array.from({ length: veces }).map((_, i) => (
        <React.Fragment key={i}>
          <span className="lp-franja-invita" aria-hidden={i > 0 || undefined}>
            Síguenos
          </span>
          {redes.map((r) => (
            <a
              key={r.red}
              className="lp-red"
              href={r.enlace}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={oculto || i > 0 ? -1 : undefined}
              aria-hidden={i > 0 || undefined}
            >
              <IconoRed red={r.red} />
              {r.texto}
            </a>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
  return (
    <section className="lp-franja" aria-label="Redes sociales">
      <div className="lp-franja-pista">
        {grupo(false)}
        {grupo(true)}
      </div>
    </section>
  );
};

/**
 * Página pública del gimnasio en la raíz de su subdominio (`demo.gymdeskcolombia.com/`).
 * Una sola plantilla, llenada con lo que el gimnasio configura en Configuración · Landing.
 * Si un dato falta, su sección y su enlace del menú no aparecen.
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

  // El vidrio se oscurece al bajar: sobre fondos blancos el texto blanco dejaría de leerse.
  const [conScroll, setConScroll] = useState(false);
  useEffect(() => {
    const alBajar = () => setConScroll(window.scrollY > 40);
    alBajar();
    window.addEventListener('scroll', alBajar, { passive: true });
    return () => window.removeEventListener('scroll', alBajar);
  }, []);

  const agendaPorDia = useMemo(() => {
    const dias: { dia: string; clases: PublicLandingResponse['agenda'] }[] = [];
    for (const c of datos?.agenda ?? []) {
      const dia = formatDiaSemana(c.fecha_hora);
      const actual = dias[dias.length - 1];
      if (actual?.dia === dia) actual.clases.push(c);
      else dias.push({ dia, clases: [c] });
    }
    return dias;
  }, [datos]);

  if (error || !datos) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, textAlign: 'center', background: '#f6f7f9', color: '#15171c' }}>
        {error ? (
          <div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: 12, color: 'inherit' }}>{error}</h1>
            <Link to="/login">Ir a administración</Link>
          </div>
        ) : (
          <p aria-live="polite">Cargando…</p>
        )}
      </div>
    );
  }

  const whatsapp = datos.redes.whatsapp ? enlaceWhatsApp(datos.redes.whatsapp) : null;
  const banner = urlDeImagen(datos.banner_url);
  const logo = urlDeImagen(datos.logo_url);
  const redes: EnlaceRed[] = Object.entries(datos.redes)
    .filter(([red]) => red !== 'whatsapp')
    .map(([red, valor]) => ({ red, enlace: enlaceRed(red, valor), texto: textoRed(red, valor) }))
    .filter((r): r is EnlaceRed => !!r.enlace);
  // La base de datos no conserva el orden: primero los rangos de siempre, luego los que agregó el gimnasio.
  const horarios = Object.entries(datos.horarios)
    .filter(([, v]) => v)
    .sort(([a], [b]) => ordenHorario(a) - ordenHorario(b));
  const direccion = [datos.direccion, datos.ciudad].filter(Boolean).join(', ');
  const hayHorario = horarios.length > 0 || agendaPorDia.length > 0;
  const hayContacto = !!(direccion || datos.telefono || datos.correo || whatsapp);
  const frase = datos.titulo || (whatsapp ? 'Escríbenos por WhatsApp' : null);

  const secciones = [
    datos.planes.length > 0 && { id: 'planes', etiqueta: 'Planes' },
    datos.clases.length > 0 && { id: 'clases', etiqueta: 'Clases' },
    hayHorario && { id: 'horario', etiqueta: 'Horario' },
    hayContacto && { id: 'contactanos', etiqueta: 'Contáctanos' },
  ].filter((s): s is { id: string; etiqueta: string } => !!s);

  const marca = logo ? <img src={logo} alt={datos.nombre} /> : datos.nombre;
  const estilo = {
    '--lp-primario': datos.primary_color,
    '--lp-sobre-primario': textoSobre(datos.primary_color),
    // Si el color del gimnasio es muy claro, el precio se escribe oscuro para que se lea sobre blanco.
    '--lp-primario-texto': textoSobre(datos.primary_color) === '#111111' ? '#15171c' : datos.primary_color,
    '--lp-duracion': `${Math.max(22, redes.length * 12)}s`,
  } as React.CSSProperties;

  return (
    <div className="lp" style={estilo}>
      <header className={`lp-header ${conScroll ? 'lp-header-scroll' : ''}`}>
        <div className="lp-header-fila">
          <a className="lp-marca lp-marca-header" href="#inicio">
            {logo && <img src={logo} alt="" />}
            <strong className="lp-marca-texto">{datos.nombre}</strong>
          </a>
          {secciones.length > 0 && (
            <nav className="lp-nav" aria-label="Secciones">
              {secciones.map((s) => (
                <a key={s.id} href={`#${s.id}`}>
                  {s.etiqueta}
                </a>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main>
        <section
          id="inicio"
          className={`lp-banner ${banner ? 'lp-banner-imagen' : ''}`}
          style={banner ? { backgroundImage: `url("${banner}")` } : undefined}
        >
          <div className="lp-contenedor lp-banner-contenido">
            <h1 className="lp-banner-texto">{datos.descripcion || datos.nombre}</h1>
            {frase &&
              (whatsapp ? (
                <a className="lp-frase" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={20} aria-hidden="true" />
                  {frase}
                </a>
              ) : (
                <span className="lp-frase">{frase}</span>
              ))}
          </div>
        </section>

        {redes.length > 0 && <FranjaRedes redes={redes} />}

        {datos.planes.length > 0 && (
          <section id="planes" className="lp-seccion">
            <div className="lp-contenedor">
              <h2 className="lp-titulo">Planes</h2>
              <p className="lp-subtitulo">Elige el que mejor se ajuste a ti.</p>
              <div className="lp-rejilla">
                {datos.planes.map((p) => (
                  <article key={p.nombre} className="lp-tarjeta">
                    <h3>{p.nombre}</h3>
                    <div className="lp-precio">{formatCOP(p.precio)}</div>
                    <p className="lp-dato">
                      {p.duracion_dias} días{p.cupo_personas > 1 ? ` · ${p.cupo_personas} personas` : ''}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {datos.clases.length > 0 && (
          <section id="clases" className="lp-seccion lp-seccion-alterna">
            <div className="lp-contenedor">
              <h2 className="lp-titulo">Clases</h2>
              <p className="lp-subtitulo">Lo que puedes entrenar con nosotros.</p>
              <div className="lp-rejilla">
                {datos.clases.map((c) => (
                  <article key={c.nombre} className="lp-tarjeta">
                    <h3>{c.nombre}</h3>
                    {c.descripcion && <p className="lp-dato">{c.descripcion}</p>}
                    <p className="lp-dato">{c.duracion_minutos} minutos</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {(hayHorario || hayContacto) && (
          <div className="lp-contenedor lp-dos-columnas">
            {hayHorario && (
              <section id="horario" className="lp-seccion">
                <h2 className="lp-titulo" style={{ marginBottom: 20 }}>
                  Horario
                </h2>
                {horarios.map(([clave, valor]) => (
                  <div key={clave} className="lp-horario-fila">
                    <span>{ETIQUETA_HORARIO[clave] ?? clave.replace(/_/g, ' ')}</span>
                    <span>{valor}</span>
                  </div>
                ))}
                {agendaPorDia.length > 0 && (
                  <>
                    <h3 style={{ margin: '28px 0 0', fontSize: '1.15rem', fontWeight: 700 }}>Clases de esta semana</h3>
                    {agendaPorDia.map((d) => (
                      <div key={d.dia}>
                        <div className="lp-agenda-dia">{d.dia}</div>
                        {d.clases.map((c) => (
                          <div key={`${c.nombre}-${c.fecha_hora}`} className="lp-horario-fila">
                            <span>{c.nombre}</span>
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <Clock size={14} aria-hidden="true" />
                              {formatHora(c.fecha_hora)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}

            {hayContacto && (
              <section id="contactanos" className="lp-seccion">
                <h2 className="lp-titulo" style={{ marginBottom: 20 }}>
                  Contáctanos
                </h2>
                {direccion && (
                  <p className="lp-contacto-linea">
                    <MapPin size={18} aria-hidden="true" />
                    {direccion}
                  </p>
                )}
                {datos.telefono && (
                  <p className="lp-contacto-linea">
                    <Phone size={18} aria-hidden="true" />
                    <a href={`tel:${datos.telefono.replace(/[^\d+]/g, '')}`}>{datos.telefono}</a>
                  </p>
                )}
                {datos.correo && (
                  <p className="lp-contacto-linea">
                    <Mail size={18} aria-hidden="true" />
                    <a href={`mailto:${datos.correo}`}>{datos.correo}</a>
                  </p>
                )}
                <div className="lp-botones">
                  {whatsapp && (
                    <a className="lp-boton" href={whatsapp} target="_blank" rel="noopener noreferrer">
                      <MessageCircle size={17} aria-hidden="true" />
                      WhatsApp
                    </a>
                  )}
                  {direccion && (
                    <a
                      className="lp-boton lp-boton-borde"
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${direccion}, Colombia`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Navigation size={17} aria-hidden="true" />
                      Cómo llegar
                    </a>
                  )}
                </div>
                {direccion && (
                  <iframe
                    className="lp-mapa"
                    title={`Mapa: ${datos.nombre}, ${direccion}`}
                    src={`https://www.google.com/maps?q=${encodeURIComponent(`${direccion}, Colombia`)}&output=embed`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                )}
              </section>
            )}
          </div>
        )}
      </main>

      <footer className="lp-footer">
        <div className="lp-contenedor">
          <div className="lp-footer-arriba">
            <a className="lp-marca" href="#inicio">
              {marca}
            </a>
            {secciones.length > 0 && (
              <nav className="lp-footer-enlaces" aria-label="Enlaces">
                {secciones.map((s) => (
                  <a key={s.id} href={`#${s.id}`}>
                    {s.etiqueta}
                  </a>
                ))}
              </nav>
            )}
            {redes.length > 0 && (
              <div className="lp-footer-redes">
                {redes.map((r) => (
                  <a key={r.red} href={r.enlace} target="_blank" rel="noopener noreferrer" aria-label={RED[r.red]?.etiqueta ?? r.red}>
                    <IconoRed red={r.red} size={22} />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="lp-footer-abajo">
            <span>
              © {new Date().getFullYear()} {datos.nombre}. Todos los derechos reservados.
            </span>
            <Link to={isAuthenticated ? '/inicio' : '/login'}>Administración</Link>
          </div>
        </div>
      </footer>

      {whatsapp && (
        <a className="lp-flotante" href={whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp">
          <MessageCircle size={26} aria-hidden="true" />
        </a>
      )}
    </div>
  );
};
