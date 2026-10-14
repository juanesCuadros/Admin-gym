import { Link } from 'react-router-dom'
import { useTituloPagina } from '@/utils/titulo'

export default function Inicio() {
  useTituloPagina('')
  return (
    <section className="contenedor seccion">
      <h1>GymOS</h1>
      <p>Software para gimnasios en Colombia.</p>
      <p><Link to="/registro" className="boton boton-primario">Prueba gratis</Link></p>
    </section>
  )
}
