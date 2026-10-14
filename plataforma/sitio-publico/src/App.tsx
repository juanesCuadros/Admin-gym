import { Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Inicio from '@/pages/Inicio'
import NoEncontrada from '@/pages/NoEncontrada'
import Planes from '@/pages/Planes'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="planes" element={<Planes />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  )
}
