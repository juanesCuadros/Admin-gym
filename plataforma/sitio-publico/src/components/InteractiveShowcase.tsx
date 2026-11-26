import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  CheckCircle2,
  Clock,
  DoorOpen,
  Monitor,
  Ruler,
  Sparkles,
  TrendingUp,
  UserCheck,
  Wallet,
} from 'lucide-react'
import { DOMINIO_BASE } from '@/config'

type TabId = 'recepcion' | 'caja' | 'tv' | 'medidas'

const TABS: { id: TabId; label: string; icon: typeof DoorOpen }[] = [
  { id: 'recepcion', label: 'Recepción', icon: DoorOpen },
  { id: 'caja', label: 'Membresías y caja', icon: Wallet },
  { id: 'tv', label: 'Pantalla TV', icon: Monitor },
  { id: 'medidas', label: 'Clientes y medidas', icon: Ruler },
]

const INGRESOS_INICIALES = [
  { nombre: 'Laura Gómez', plan: 'Mensualidad Full', estado: 'Al día', hora: '06:42 p.m.', ok: true },
  { nombre: 'Andrés Morales', plan: 'Trimestre Pro', estado: 'Al día', hora: '06:39 p.m.', ok: true },
  { nombre: 'Camila Restrepo', plan: 'Mensualidad', estado: 'Saldo pendiente', hora: '06:34 p.m.', ok: false },
  { nombre: 'Mateo Herrera', plan: 'Plan Semestral', estado: 'Al día', hora: '06:28 p.m.', ok: true },
]

const BARRAS_CAJA = [
  { dia: 'Lun', valor: 58, monto: '$1.4M' },
  { dia: 'Mar', valor: 72, monto: '$1.8M' },
  { dia: 'Mié', valor: 65, monto: '$1.6M' },
  { dia: 'Jue', valor: 86, monto: '$2.2M' },
  { dia: 'Vie', valor: 94, monto: '$2.4M' },
  { dia: 'Sáb', valor: 78, monto: '$1.9M' },
]

/**
 * Mockup interactivo realista de la plataforma GymDesk.
 * Permite al visitante explorar los módulos reales del sistema (recepción, caja, pantalla TV y medidas)
 * con transiciones fluidas y microinteracciones.
 */
export default function InteractiveShowcase() {
  const [activeTab, setActiveTab] = useState<TabId>('recepcion')
  const [simulado, setSimulado] = useState(false)

  return (
    <div className="showcase-wrapper">
      {/* Selector de módulos estilo pill-bar de Stripe/Linear */}
      <div className="showcase-tabs" role="tablist" aria-label="Vistas interactivas de GymDesk">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`showcase-tab ${isActive ? 'is-active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {isActive && (
                <motion.span
                  layoutId="showcase-tab-pill"
                  className="showcase-tab-bg"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>

      {/* Ventana glassmorphism 3D del software */}
      <motion.div
        className="mockup-window"
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mockup-chrome">
          <div className="mockup-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="mockup-url">
            <span className="mockup-lock" aria-hidden="true" />
            <span>
              tugimnasio.<strong>{DOMINIO_BASE}</strong>/{activeTab}
            </span>
          </div>
          <div className="mockup-badge-live">
            <span className="live-dot" />
            En vivo · Hora Colombia
          </div>
        </div>

        <div className="mockup-body">
          {/* Sidebar minimalista */}
          <aside className="mockup-sidebar" aria-hidden="true">
            <div className="mockup-brand-mini">
              <span className="logo-marca-mini">G</span>
              <span>GymDesk</span>
            </div>
            <div className="mockup-nav-items">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setActiveTab(id)}
                  className={`mockup-nav-item ${activeTab === id ? 'is-active' : ''}`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="mockup-sidebar-foot">
              <span className="mockup-status-pill">Turno de caja abierto</span>
            </div>
          </aside>

          {/* Contenido dinámico de la vista activa */}
          <div className="mockup-stage">
            <AnimatePresence mode="wait">
              {activeTab === 'recepcion' && (
                <motion.div
                  key="recepcion"
                  className="mockup-panel"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.28 }}
                >
                  <div className="mockup-panel-head">
                    <div>
                      <p className="mockup-kicker">Control de ingreso</p>
                      <h4>Recepción en tiempo real</h4>
                    </div>
                    <button
                      type="button"
                      className="mockup-action-btn"
                      onClick={() => setSimulado((v) => !v)}
                    >
                      <UserCheck size={15} aria-hidden="true" />
                      {simulado ? 'Ingreso registrado ✓' : 'Simular ingreso'}
                    </button>
                  </div>

                  <div className="mockup-kpi-row">
                    <div className="mockup-kpi">
                      <span>Ingresos hoy</span>
                      <strong>{simulado ? '149' : '148'}</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Membresías al día</span>
                      <strong className="text-emerald">96%</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Saldo pendiente</span>
                      <strong className="text-gold">3 avisos</strong>
                    </div>
                  </div>

                  <div className="mockup-list">
                    {simulado && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mockup-row is-highlighted"
                      >
                        <div className="mockup-row-user">
                          <span className="mockup-avatar is-ok">JS</span>
                          <div>
                            <strong>Juan Sebastián Ríos</strong>
                            <small>Plan Trimestral · Ingreso recién validado</small>
                          </div>
                        </div>
                        <span className="mockup-pill is-ok">Al día</span>
                        <span className="mockup-time">Ahora</span>
                      </motion.div>
                    )}
                    {INGRESOS_INICIALES.map((item) => (
                      <div key={item.nombre} className="mockup-row">
                        <div className="mockup-row-user">
                          <span className={`mockup-avatar ${item.ok ? 'is-ok' : 'is-warn'}`}>
                            {item.nombre.slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <strong>{item.nombre}</strong>
                            <small>{item.plan}</small>
                          </div>
                        </div>
                        <span className={`mockup-pill ${item.ok ? 'is-ok' : 'is-warn'}`}>
                          {item.estado}
                        </span>
                        <span className="mockup-time">{item.hora}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {activeTab === 'caja' && (
                <motion.div
                  key="caja"
                  className="mockup-panel"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.28 }}
                >
                  <div className="mockup-panel-head">
                    <div>
                      <p className="mockup-kicker">Caja diaria y pagos en COP</p>
                      <h4>Recaudo de la semana</h4>
                    </div>
                    <span className="mockup-pill is-ok">
                      <TrendingUp size={13} aria-hidden="true" /> +18% vs semana anterior
                    </span>
                  </div>

                  <div className="mockup-kpi-row">
                    <div className="mockup-kpi">
                      <span>Caja de hoy</span>
                      <strong className="text-emerald">$2.450.000</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Transferencias</span>
                      <strong>$1.620.000</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Efectivo en turno</span>
                      <strong className="text-gold">$830.000</strong>
                    </div>
                  </div>

                  <div className="mockup-chart">
                    {BARRAS_CAJA.map((barra, idx) => (
                      <div key={barra.dia} className="mockup-bar-col">
                        <span className="mockup-bar-val">{barra.monto}</span>
                        <div className="mockup-bar-track">
                          <motion.div
                            className="mockup-bar-fill"
                            initial={{ height: 0 }}
                            animate={{ height: `${barra.valor}%` }}
                            transition={{ duration: 0.55, delay: idx * 0.06, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="mockup-bar-day">{barra.dia}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {activeTab === 'tv' && (
                <motion.div
                  key="tv"
                  className="mockup-panel mockup-tv-panel"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.28 }}
                >
                  <div className="tv-screen">
                    <div className="tv-top-bar">
                      <span className="tv-gym-name">PANTALLA DE RECEPCIÓN · GYMDESK</span>
                      <span className="tv-clock">
                        <Clock size={14} aria-hidden="true" /> 18:45 · BOGOTÁ
                      </span>
                    </div>
                    <div className="tv-greeting">
                      <div className="tv-check-ring">
                        <CheckCircle2 size={36} aria-hidden="true" />
                      </div>
                      <p className="tv-welcome-label">¡BIENVENIDO A ENTRENAR!</p>
                      <h3>Carlos Eduardo Mendoza</h3>
                      <p className="tv-sub">Membresía Mensual Activa · 22 días vigentes</p>
                    </div>
                    <div className="tv-ticker">
                      <Sparkles size={14} aria-hidden="true" />
                      <span>Aviso del gimnasio: Clase de Funcional hoy 7:00 p.m. · Cupos abiertos</span>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'medidas' && (
                <motion.div
                  key="medidas"
                  className="mockup-panel"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.28 }}
                >
                  <div className="mockup-panel-head">
                    <div>
                      <p className="mockup-kicker">Ficha del cliente</p>
                      <h4>Seguimiento de peso y medidas</h4>
                    </div>
                    <span className="mockup-pill is-ok">
                      <Activity size={13} aria-hidden="true" /> Evolución registrada
                    </span>
                  </div>

                  <div className="mockup-kpi-row">
                    <div className="mockup-kpi">
                      <span>Peso actual</span>
                      <strong>74.2 kg</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Cambio (90 días)</span>
                      <strong className="text-emerald">-4.6 kg</strong>
                    </div>
                    <div className="mockup-kpi">
                      <span>Rutina asignada</span>
                      <strong className="text-gold">Fuerza A/B</strong>
                    </div>
                  </div>

                  <div className="mockup-sparkline-box">
                    <svg viewBox="0 0 420 110" className="mockup-sparkline" aria-hidden="true">
                      <defs>
                        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0066EE" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="#0066EE" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 10 24 Q 80 32, 130 46 T 255 68 T 410 86 L 410 110 L 10 110 Z"
                        fill="url(#sparkFill)"
                      />
                      <motion.path
                        d="M 10 24 Q 80 32, 130 46 T 255 68 T 410 86"
                        fill="none"
                        stroke="#0066EE"
                        strokeWidth="3"
                        strokeLinecap="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                      />
                      <circle cx="130" cy="46" r="4.5" fill="#3388FF" />
                      <circle cx="255" cy="68" r="4.5" fill="#3388FF" />
                      <circle cx="410" cy="86" r="5.5" fill="#0066EE" />
                    </svg>
                    <div className="sparkline-labels">
                      <span>Mes 1 · 78.8 kg</span>
                      <span>Mes 2 · 76.4 kg</span>
                      <span>Mes 3 · 74.2 kg</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
