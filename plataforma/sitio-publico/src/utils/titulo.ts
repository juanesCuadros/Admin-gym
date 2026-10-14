import { useEffect } from 'react'

/** Pone el título de la pestaña: "<página> · GymOS". */
export function useTituloPagina(titulo: string) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · GymOS` : 'GymOS · Software para gimnasios en Colombia'
  }, [titulo])
}
