import { Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Inicio from '@/pages/Inicio'
import NoEncontrada from '@/pages/NoEncontrada'
import Planes from '@/pages/Planes'
import Registro from '@/pages/Registro'
import ConfirmarRegistro from '@/pages/ConfirmarRegistro'
import Terminos from '@/pages/Terminos'
import Privacidad from '@/pages/Privacidad'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="planes" element={<Planes />} />
        <Route path="registro" element={<Registro />} />
        {/* El token llega en la ruta; ?token= se acepta por compatibilidad con el enlace actual del backend. */}
        <Route path="registro/confirmar/:token" element={<ConfirmarRegistro />} />
        <Route path="registro/confirmar" element={<ConfirmarRegistro />} />
        <Route path="terminos" element={<Terminos />} />
        <Route path="privacidad" element={<Privacidad />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  )
}
