import { Route, Routes } from 'react-router-dom'
import Layout from '@/components/Layout'
import Inicio from '@/pages/Inicio'
import NoEncontrada from '@/pages/NoEncontrada'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  )
}
