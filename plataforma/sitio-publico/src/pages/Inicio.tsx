import { Link } from 'react-router-dom'
import {
  BarChart3, CalendarDays, DoorOpen, Monitor, Ruler, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DOMINIO_BASE } from '@/config'
import { useTituloPagina } from '@/utils/titulo'

interface Modulo {
  icono: LucideIcon
  titulo: string
  texto: string
}

const MODULOS: Modulo[] = [
  {
    icono: DoorOpen,
    titulo: 'Recepción y control de ingreso',
    texto:
      'Registra el ingreso de cada cliente. Recepción ve al momento si su membresía está al día o tiene saldo pendiente.',
  },
  {
    icono: Wallet,
    titulo: 'Membresías y caja',
    texto:
      'Vende y renueva membresías, registra los pagos en pesos y lleva la caja del día hasta su cierre.',
  },
  {
    icono: Ruler,
    titulo: 'Clientes y medidas',
    texto:
      'La ficha de cada cliente con sus datos, su historial de membresías y el seguimiento de su peso y medidas.',
  },
  {
    icono: CalendarDays,
    titulo: 'Clases y entrenamiento',
    texto:
      'Organiza las clases del gimnasio y las rutinas que los entrenadores asignan a sus clientes.',
  },
  {
    icono: BarChart3,
    titulo: 'Reportes',
    texto:
      'Ingresos de dinero, asistencia y estado de las membresías, con fechas en hora de Colombia.',
  },
  {
    icono: Monitor,
    titulo: 'Pantalla TV',
    texto:
      'Un monitor en la recepción que saluda a cada cliente cuando ingresa y muestra los avisos del gimnasio.',
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

export default function Inicio() {
  useTituloPagina('')

  return (
    <>
      <section className="heroe">
        <div className="contenedor heroe-contenido">
          <p className="etiqueta">Software para gimnasios en Colombia</p>
          <h1>Maneja tu gimnasio desde un solo lugar</h1>
          <p className="heroe-texto">
            GymOS reúne la recepción, las membresías, la caja, los clientes, las clases y los reportes de tu gimnasio.
            Funciona en el navegador: no tienes que instalar nada.
          </p>
          <div className="acciones">
            <Link to="/registro" className="boton boton-acento">Prueba gratis</Link>
            <Link to="/planes" className="boton boton-claro">Ver planes</Link>
          </div>
        </div>
      </section>

      <section className="contenedor seccion" aria-labelledby="titulo-modulos">
        <h2 id="titulo-modulos">Lo que hace GymOS por tu gimnasio</h2>
        <p className="texto-suave intro">
          Cada gimnasio trabaja en su propio espacio, con sus datos separados de los demás.
        </p>
        <ul className="rejilla-modulos">
          {MODULOS.map(({ icono: Icono, titulo, texto }) => (
            <li key={titulo} className="tarjeta modulo">
              <span className="modulo-icono" aria-hidden="true"><Icono size={22} /></span>
              <h3>{titulo}</h3>
              <p>{texto}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="franja" aria-labelledby="titulo-pasos">
        <div className="contenedor seccion">
          <h2 id="titulo-pasos">Cómo empezar la prueba gratis</h2>
          <ol className="pasos">
            {PASOS.map((paso, i) => (
              <li key={paso.titulo} className="paso">
                <span className="paso-numero" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{paso.titulo}</h3>
                  <p>{paso.texto}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="texto-suave">
            La prueba no pide tarjeta. Si decides seguir, eliges un plan y pagas por transferencia; el equipo de
            GymOS confirma el pago y tu gimnasio sigue funcionando con lo que ya registraste.
          </p>
        </div>
      </section>

      <section className="contenedor seccion cierre" aria-labelledby="titulo-cierre">
        <h2 id="titulo-cierre">¿Quieres verlo con los datos de tu gimnasio?</h2>
        <p className="texto-suave">Crea tu prueba y empieza a registrar clientes hoy mismo.</p>
        <Link to="/registro" className="boton boton-primario">Prueba gratis</Link>
      </section>
    </>
  )
}
