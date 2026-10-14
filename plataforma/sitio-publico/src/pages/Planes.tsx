import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { publicoService } from '@/api/publico.service'
import type { ErrorApi } from '@/api/cliente'
import { Aviso, Cargando } from '@/components/Estados'
import { enlaceWhatsApp } from '@/config'
import type { PlanPublico } from '@/types/publico.types'
import { formatearCop, formatearEntero, plural } from '@/utils/formato'
import { useTituloPagina } from '@/utils/titulo'

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; error: ErrorApi }
  | { fase: 'listo'; planes: PlanPublico[] }

function limite(valor: number | null): string {
  return valor === null ? 'Sin límite' : formatearEntero(valor)
}

function TarjetaPlan({ plan }: { plan: PlanPublico }) {
  const esPrueba = plan.tipo === 'prueba'
  return (
    <li className={esPrueba ? 'tarjeta plan plan-prueba' : 'tarjeta plan'}>
      <h2 className="plan-nombre">{plan.nombre}</h2>
      {esPrueba ? (
        <p className="plan-precio">
          Gratis
          {plan.dias_prueba !== null && (
            <span className="plan-periodo"> · {plural(plan.dias_prueba, 'día', 'días')}</span>
          )}
        </p>
      ) : (
        <p className="plan-precio">
          {formatearCop(plan.precio)}
          <span className="plan-periodo"> al mes</span>
        </p>
      )}
      {plan.descripcion && <p className="plan-descripcion">{plan.descripcion}</p>}
      <dl className="plan-datos">
        {!esPrueba && plan.duracion_meses !== null && (
          <div>
            <dt>Duración</dt>
            <dd>{plural(plan.duracion_meses, 'mes', 'meses')}</dd>
          </div>
        )}
        <div>
          <dt>Clientes activos</dt>
          <dd>{limite(plan.max_clientes_activos)}</dd>
        </div>
        <div>
          <dt>Usuarios del personal</dt>
          <dd>{limite(plan.max_staff)}</dd>
        </div>
      </dl>
      {esPrueba && (
        <Link to="/registro" className="boton boton-primario boton-bloque">Empezar prueba gratis</Link>
      )}
    </li>
  )
}

export default function Planes() {
  useTituloPagina('Planes')
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const whatsapp = enlaceWhatsApp('Hola, quiero información sobre los planes de GymOS.')

  const cargar = useCallback(async (signal?: { cancelado: boolean }) => {
    setEstado({ fase: 'cargando' })
    try {
      const planes = await publicoService.listarPlanes()
      if (!signal?.cancelado) setEstado({ fase: 'listo', planes })
    } catch (e) {
      if (!signal?.cancelado) setEstado({ fase: 'error', error: e as ErrorApi })
    }
  }, [])

  useEffect(() => {
    const signal = { cancelado: false }
    void cargar(signal)
    return () => {
      signal.cancelado = true
    }
  }, [cargar])

  return (
    <section className="contenedor seccion">
      <h1>Planes</h1>
      <p className="texto-suave intro">
        Cada plan define cuántos clientes activos y cuántos usuarios del personal puede tener tu gimnasio.
      </p>

      <div aria-live="polite">
        {estado.fase === 'cargando' && <Cargando texto="Cargando planes…" />}

        {estado.fase === 'error' && (
          <Aviso tipo="error" titulo="No pudimos cargar los planes">
            <p>{estado.error.message}</p>
            <button type="button" className="boton boton-secundario" onClick={() => void cargar()}>
              Reintentar
            </button>
          </Aviso>
        )}

        {estado.fase === 'listo' && estado.planes.length === 0 && (
          <Aviso tipo="info" titulo="Aún no hay planes publicados">
            <p>
              Todavía no tenemos planes para mostrar aquí.
              {whatsapp ? (
                <> Escríbenos por <a href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a> y te
                  contamos las opciones.</>
              ) : (
                ' Vuelve a revisar pronto.'
              )}
            </p>
          </Aviso>
        )}

        {estado.fase === 'listo' && estado.planes.length > 0 && (
          <ul className="rejilla-planes">
            {estado.planes.map((plan) => <TarjetaPlan key={plan.id} plan={plan} />)}
          </ul>
        )}
      </div>

      <div className="tarjeta nota-pago">
        <h2>Cómo se paga</h2>
        <p>
          El pago es manual, por transferencia. No hay pasarela de pago ni cobros automáticos a tarjeta.
          Después de transferir, el equipo de GymOS confirma el pago y activa tu plan.
        </p>
        <p className="texto-suave">
          Los precios están en pesos colombianos. Puedes empezar con la prueba gratis y elegir un plan después.
        </p>
        {whatsapp && (
          <p>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a> si tienes dudas
            sobre un plan.
          </p>
        )}
      </div>
    </section>
  )
}
