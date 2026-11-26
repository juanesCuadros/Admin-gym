import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  DoorOpen,
  Monitor,
  Ruler,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DOMINIO_BASE } from '@/config'
import { useTituloPagina } from '@/utils/titulo'
import TiltCard3D from '@/components/TiltCard3D'
import InteractiveShowcase from '@/components/InteractiveShowcase'

const HeroScene3D = lazy(() => import('@/components/HeroScene3D'))

interface Modulo {
  icono: LucideIcon
  titulo: string
  texto: string
  etiqueta: string
  destacado?: boolean
  acento?: 'emerald' | 'gold'
}

const MODULOS: Modulo[] = [
  {
    icono: DoorOpen,
    etiqueta: 'Control en vivo',
    titulo: 'Recepción y control de ingreso',
    texto:
      'Registra el ingreso de cada cliente. Recepción ve al momento si su membresía está al día o tiene saldo pendiente.',
    destacado: true,
    acento: 'emerald',
  },
  {
    icono: Wallet,
    etiqueta: 'Finanzas en COP',
    titulo: 'Membresías y caja',
    texto:
      'Vende y renueva membresías, registra los pagos en pesos y lleva la caja del día hasta su cierre.',
    destacado: true,
    acento: 'gold',
  },
  {
    icono: Ruler,
    etiqueta: 'Progreso físico',
    titulo: 'Clientes y medidas',
    texto:
      'La ficha de cada cliente con sus datos, su historial de membresías y el seguimiento de su peso y medidas.',
    acento: 'emerald',
  },
  {
    icono: CalendarDays,
    etiqueta: 'Entrenamiento',
    titulo: 'Clases y entrenamiento',
    texto:
      'Organiza las clases del gimnasio y las rutinas que los entrenadores asignan a sus clientes.',
    acento: 'gold',
  },
  {
    icono: BarChart3,
    etiqueta: 'Hora Colombia',
    titulo: 'Reportes',
    texto:
      'Ingresos de dinero, asistencia y estado de las membresías, con fechas en hora de Colombia.',
    acento: 'emerald',
  },
  {
    icono: Monitor,
    etiqueta: 'Experiencia en sala',
    titulo: 'Pantalla TV',
    texto:
      'Un monitor en la recepción que saluda a cada cliente cuando ingresa y muestra los avisos del gimnasio.',
    acento: 'gold',
  },
]

const PASOS = [
  {
    titulo: 'Registra tu gimnasio',
    texto: 'Llena un formulario corto con el nombre del gimnasio, tu nombre, tu correo, tu teléfono y la ciudad.',
  },
  {
    titulo: 'Confirma tu correo',
    texto: 'Te enviamos un enlace de un solo uso. Al abrirlo eliges tu contraseña y se crea tu gimnasio.',
  },
  {
    titulo: 'Entra y prueba',
    texto: `Tu gimnasio queda en su propia dirección, del tipo tugimnasio.${DOMINIO_BASE}, listo para usar.`,
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

export default function Inicio() {
  useTituloPagina('')

  return (
    <div className="landing-page">
      {/* ==================== 1. HERO 3D IMPACTANTE ==================== */}
      <section className="heroe">
        <div className="heroe-ambient" aria-hidden="true">
          <div className="ambient-orb orb-teal" />
          <div className="ambient-orb orb-gold" />
          <div className="ambient-grid" />
        </div>

        <div className="contenedor heroe-grid">
          <div className="heroe-texto-col">
            <motion.div
              className="etiqueta-pill"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span>Software para gimnasios en Colombia</span>
            </motion.div>

            <motion.h1
              className="heroe-titulo"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              Maneja tu gimnasio <span className="texto-gradiente">desde un solo lugar</span>
            </motion.h1>

            <motion.p
              className="heroe-texto"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.16 }}
            >
              GymDesk reúne la recepción, las membresías, la caja, los clientes, las clases y los reportes de tu
              gimnasio. Funciona en el navegador: no tienes que instalar nada.
            </motion.p>

            <motion.div
              className="acciones heroe-acciones"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.24 }}
            >
              <Link to="/registro" className="boton boton-acento boton-glow">
                Prueba gratis <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link to="/planes" className="boton boton-claro">
                Ver planes
              </Link>
            </motion.div>

            <motion.ul
              className="heroe-garantias"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.36 }}
            >
              <li>
                <CheckCircle2 size={15} className="text-emerald" aria-hidden="true" />
                Sin tarjeta de crédito
              </li>
              <li>
                <CheckCircle2 size={15} className="text-emerald" aria-hidden="true" />
                En el navegador
              </li>
              <li>
                <CheckCircle2 size={15} className="text-emerald" aria-hidden="true" />
                Datos aislados por gimnasio
              </li>
            </motion.ul>
          </div>

          {/* Escena 3D protagonista + tarjetas flotantes de telemetría */}
          <div className="heroe-visual-col">
            <Suspense fallback={<div className="hero-3d-fallback" aria-hidden="true" />}>
              <HeroScene3D />
            </Suspense>

            <motion.div
              className="floating-chip chip-top-right"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.35 }}
              aria-hidden="true"
            >
              <span className="chip-icon is-emerald">
                <DoorOpen size={15} />
              </span>
              <div>
                <small>Recepción en vivo</small>
                <strong>Membresía al día</strong>
              </div>
            </motion.div>

            <motion.div
              className="floating-chip chip-bottom-left"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.45 }}
              aria-hidden="true"
            >
              <span className="chip-icon is-gold">
                <Wallet size={15} />
              </span>
              <div>
                <small>Caja diaria · COP</small>
                <strong>Cierre cuadrado</strong>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ==================== 2. MOCKUP INTERACTIVO DEL SOFTWARE ==================== */}
      <section className="seccion-showcase" aria-labelledby="titulo-plataforma">
        <div className="contenedor">
          <motion.div
            className="cabecera-seccion centrada"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
          >
            <p className="kicker-seccion">Explora la plataforma</p>
            <h2 id="titulo-plataforma">Diseñado para el ritmo real de tu gimnasio</h2>
            <p className="texto-suave intro-centrada">
              Cambia entre módulos para ver cómo recepción, caja, pantalla TV y seguimiento de clientes trabajan
              conectados en tiempo real.
            </p>
          </motion.div>

          <InteractiveShowcase />
        </div>
      </section>

      {/* ==================== 3. BENTO GRID 3D DE MÓDULOS ==================== */}
      <section className="seccion seccion-modulos" aria-labelledby="titulo-modulos">
        <div className="contenedor">
          <motion.div
            className="cabecera-seccion"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
          >
            <p className="kicker-seccion">Suite completa</p>
            <h2 id="titulo-modulos">Lo que hace GymDesk por tu gimnasio</h2>
            <p className="texto-suave intro">
              Cada gimnasio trabaja en su propio espacio, con sus datos separados de los demás.
            </p>
          </motion.div>

          <ul className="rejilla-bento">
            {MODULOS.map(({ icono: Icono, etiqueta, titulo, texto, destacado, acento }, idx) => (
              <motion.li
                key={titulo}
                className={destacado ? 'bento-item bento-wide' : 'bento-item'}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.15 }}
                custom={idx}
                variants={fadeUp}
              >
                <TiltCard3D
                  className="bento-card"
                  glowColor={acento === 'gold' ? 'rgba(51, 136, 255, 0.22)' : 'rgba(0, 102, 238, 0.24)'}
                >
                  <div className="bento-card-head">
                    <span className={`modulo-icono ${acento === 'gold' ? 'is-gold' : 'is-emerald'}`} aria-hidden="true">
                      <Icono size={22} />
                    </span>
                    <span className="bento-tag">{etiqueta}</span>
                  </div>
                  <h3>{titulo}</h3>
                  <p>{texto}</p>
                </TiltCard3D>
              </motion.li>
            ))}
          </ul>
        </div>
      </section>

      {/* ==================== 4. CÓMO EMPEZAR (TIMELINE ANIMADO) ==================== */}
      <section className="franja-pasos" aria-labelledby="titulo-pasos">
        <div className="contenedor seccion">
          <motion.div
            className="cabecera-seccion centrada"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
          >
            <p className="kicker-seccion">Activación en minutos</p>
            <h2 id="titulo-pasos">Cómo empezar la prueba gratis</h2>
          </motion.div>

          <ol className="pasos-timeline">
            {PASOS.map((paso, i) => (
              <motion.li
                key={paso.titulo}
                className="paso-card"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                custom={i}
                variants={fadeUp}
              >
                <span className="paso-numero" aria-hidden="true">0{i + 1}</span>
                <h3>{paso.titulo}</h3>
                <p>{paso.texto}</p>
              </motion.li>
            ))}
          </ol>

          <motion.div
            className="nota-transparencia"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
          >
            <p>
              La prueba no pide tarjeta. Si decides seguir, eliges un plan y pagas por transferencia; el equipo de
              GymDesk confirma el pago y tu gimnasio sigue funcionando con lo que ya registraste.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ==================== 6. CIERRE CONVERSIÓN PREMIUM ==================== */}
      <section className="contenedor seccion cierre-section" aria-labelledby="titulo-cierre">
        <motion.div
          className="cierre-portal"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="cierre-glow" aria-hidden="true" />
          <p className="kicker-seccion">Empieza hoy</p>
          <h2 id="titulo-cierre">¿Quieres verlo con los datos de tu gimnasio?</h2>
          <p className="texto-suave intro-centrada">
            Crea tu prueba y empieza a registrar clientes hoy mismo.
          </p>
          <div className="acciones acciones-centradas">
            <Link to="/registro" className="boton boton-acento boton-glow">
              Prueba gratis <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link to="/planes" className="boton boton-claro">
              Ver planes y precios
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
