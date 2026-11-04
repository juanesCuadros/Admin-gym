import { useEffect } from 'react'

/** Pone el título de la pestaña: "<página> · GymDesk". */
export function useTituloPagina(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · GymDesk` : 'GymDesk · Software para gimnasios en Colombia'
  }, [titulo])
}
