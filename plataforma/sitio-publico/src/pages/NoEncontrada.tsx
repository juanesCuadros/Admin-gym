import { Link } from 'react-router-dom'
import { useTituloPagina } from '@/utils/titulo'

export default function NoEncontrada() {
  useTituloPagina('Página no encontrada')
  return (
    <section className="contenedor seccion estrecho">
      <h1>No encontramos esta página</h1>
      <p>Puede que el enlace esté mal escrito o que la página ya no exista.</p>
      <p><Link to="/" className="boton boton-secundario">Ir al inicio</Link></p>
    </section>
  )
}
