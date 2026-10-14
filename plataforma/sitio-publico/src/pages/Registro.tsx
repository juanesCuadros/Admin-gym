import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { publicoService } from '@/api/publico.service'
import type { ErrorApi } from '@/api/cliente'
import Campo from '@/components/Campo'
import { Aviso } from '@/components/Estados'
import { DOMINIO_BASE } from '@/config'
import type { SubdominioSugerido } from '@/types/publico.types'
import { useTituloPagina } from '@/utils/titulo'
import {
  normalizarTelefono, validarCorreo, validarNombreGimnasio, validarTelefono, validarTexto,
} from '@/utils/validacion'

type NombreCampo = 'nombre_gimnasio' | 'ciudad' | 'jefe_nombre' | 'jefe_correo' | 'telefono' | 'acepta_terminos'

interface Valores {
  nombre_gimnasio: string
  ciudad: string
  jefe_nombre: string
  jefe_correo: string
  telefono: string
  acepta_terminos: boolean
}

const VALORES_INICIALES: Valores = {
  nombre_gimnasio: '',
  ciudad: '',
  jefe_nombre: '',
  jefe_correo: '',
  telefono: '',
  acepta_terminos: false,
}

const ORDEN_CAMPOS: NombreCampo[] = [
  'nombre_gimnasio', 'ciudad', 'jefe_nombre', 'jefe_correo', 'telefono', 'acepta_terminos',
]

function validar(campo: NombreCampo, v: Valores): string | null {
  switch (campo) {
    case 'nombre_gimnasio':
      return validarNombreGimnasio(v.nombre_gimnasio)
    case 'ciudad':
      return validarTexto(v.ciudad, 'la ciudad', 2, 100)
    case 'jefe_nombre':
      return validarTexto(v.jefe_nombre, 'tu nombre', 2, 150)
    case 'jefe_correo':
      return validarCorreo(v.jefe_correo)
    case 'telefono':
      return validarTelefono(v.telefono)
    case 'acepta_terminos':
      return v.acepta_terminos ? null : 'Debes aceptar los términos y la política de privacidad para continuar.'
  }
}

type EstadoSubdominio =
  | { fase: 'inactivo' }
  | { fase: 'consultando' }
  | { fase: 'listo'; datos: SubdominioSugerido }
  | { fase: 'error' }

const ESPERA_SUBDOMINIO_MS = 500

/** Vista previa del subdominio con GET /public/subdomain-check, con debounce y cancelación. */
function useSubdominio(nombre: string): EstadoSubdominio {
  const [estado, setEstado] = useState<EstadoSubdominio>({ fase: 'inactivo' })
  const limpio = nombre.trim()
  const valido = validarNombreGimnasio(limpio) === null

  useEffect(() => {
    if (!valido) {
      setEstado({ fase: 'inactivo' })
      return
    }
    const control = new AbortController()
    setEstado({ fase: 'consultando' })
    const espera = window.setTimeout(() => {
      publicoService
        .sugerirSubdominio(limpio, control.signal)
        .then((datos) => setEstado({ fase: 'listo', datos }))
        .catch(() => {
          if (!control.signal.aborted) setEstado({ fase: 'error' })
        })
    }, ESPERA_SUBDOMINIO_MS)
    return () => {
      window.clearTimeout(espera)
      control.abort()
    }
  }, [limpio, valido])

  return estado
}

function VistaSubdominio({ estado }: { estado: EstadoSubdominio }) {
  if (estado.fase === 'inactivo') {
    return <>Con el nombre armamos la dirección de tu gimnasio: <strong>tugimnasio.{DOMINIO_BASE}</strong></>
  }
  if (estado.fase === 'consultando') return <>Revisando la dirección…</>
  if (estado.fase === 'error') {
    return <>No pudimos revisar la dirección en este momento. Puedes seguir con el registro.</>
  }
  const { subdominio_sugerido: sub, disponible } = estado.datos
  if (disponible) {
    return (
      <>
        Tu gimnasio quedaría en <strong className="direccion">{sub}.{DOMINIO_BASE}</strong>
        <span className="insignia insignia-ok"> Disponible</span>
      </>
    )
  }
  return (
    <>
      <strong className="direccion">{sub}.{DOMINIO_BASE}</strong> ya está en uso. Al confirmar te asignamos una
      variante libre, por ejemplo <strong className="direccion">{sub}-2.{DOMINIO_BASE}</strong>.
    </>
  )
}

export default function Registro() {
  useTituloPagina('Prueba gratis')
  const [valores, setValores] = useState<Valores>(VALORES_INICIALES)
  const [tocados, setTocados] = useState<Partial<Record<NombreCampo, boolean>>>({})
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<ErrorApi | null>(null)
  const [enviado, setEnviado] = useState<{ mensaje: string; correo: string } | null>(null)
  const enviandoRef = useRef(false)
  const tituloExitoRef = useRef<HTMLHeadingElement>(null)
  const subdominio = useSubdominio(valores.nombre_gimnasio)

  useEffect(() => {
    if (enviado) tituloExitoRef.current?.focus()
  }, [enviado])

  const error = (campo: NombreCampo) => (tocados[campo] ? validar(campo, valores) : null)

  const cambiar = (campo: Exclude<NombreCampo, 'acepta_terminos'>) =>
    (e: ChangeEvent<HTMLInputElement>) => setValores((v) => ({ ...v, [campo]: e.target.value }))

  const salir = (campo: NombreCampo) => () => setTocados((t) => ({ ...t, [campo]: true }))

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (enviandoRef.current) return

    const todos = Object.fromEntries(ORDEN_CAMPOS.map((c) => [c, true])) as Record<NombreCampo, boolean>
    setTocados(todos)
    const primeroInvalido = ORDEN_CAMPOS.find((c) => validar(c, valores) !== null)
    if (primeroInvalido) {
      document.getElementById(primeroInvalido)?.focus()
      return
    }

    enviandoRef.current = true
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const correo = valores.jefe_correo.trim().toLowerCase()
      const respuesta = await publicoService.registrar({
        nombre_gimnasio: valores.nombre_gimnasio.trim(),
        ciudad: valores.ciudad.trim(),
        jefe_nombre: valores.jefe_nombre.trim(),
        jefe_correo: correo,
        telefono: normalizarTelefono(valores.telefono),
        acepta_terminos: true,
      })
      setEnviado({ mensaje: respuesta.mensaje, correo })
    } catch (err) {
      setErrorEnvio(err as ErrorApi)
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  function registrarOtro() {
    setValores(VALORES_INICIALES)
    setTocados({})
    setErrorEnvio(null)
    setEnviado(null)
  }

  if (enviado) {
    return (
      <section className="contenedor seccion estrecho">
        <div className="tarjeta resultado">
          <span className="resultado-icono" aria-hidden="true"><MailCheck size={32} /></span>
          <h1 ref={tituloExitoRef} tabIndex={-1}>Revisa tu correo</h1>
          <p>{enviado.mensaje}</p>
          <p className="texto-suave">
            Busca un mensaje de GymOS en <strong>{enviado.correo}</strong>. Si no lo ves en unos minutos, revisa la
            carpeta de spam o de promociones. El enlace sirve una sola vez.
          </p>
          <div className="acciones">
            <button type="button" className="boton boton-secundario" onClick={registrarOtro}>
              Registrar con otros datos
            </button>
            <Link to="/" className="boton boton-primario">Volver al inicio</Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="contenedor seccion estrecho">
      <h1>Prueba GymOS gratis</h1>
      <p className="texto-suave">
        Llena tus datos y te enviamos un enlace para confirmar tu correo. Tu gimnasio se crea cuando lo confirmes.
        Los campos con <span aria-hidden="true">*</span><span className="solo-lector">asterisco</span> son
        obligatorios.
      </p>

      <form className="tarjeta formulario" onSubmit={enviar} noValidate aria-busy={enviando}>
        <fieldset disabled={enviando}>
          <legend className="solo-lector">Datos del gimnasio y del responsable</legend>

          <Campo
            id="nombre_gimnasio"
            etiqueta="Nombre del gimnasio"
            required
            autoComplete="organization"
            maxLength={150}
            value={valores.nombre_gimnasio}
            onChange={cambiar('nombre_gimnasio')}
            onBlur={salir('nombre_gimnasio')}
            error={error('nombre_gimnasio')}
            ayuda={<span aria-live="polite"><VistaSubdominio estado={subdominio} /></span>}
          />
          <Campo
            id="ciudad"
            etiqueta="Ciudad"
            required
            autoComplete="address-level2"
            maxLength={100}
            value={valores.ciudad}
            onChange={cambiar('ciudad')}
            onBlur={salir('ciudad')}
            error={error('ciudad')}
          />
          <Campo
            id="jefe_nombre"
            etiqueta="Tu nombre"
            required
            autoComplete="name"
            maxLength={150}
            value={valores.jefe_nombre}
            onChange={cambiar('jefe_nombre')}
            onBlur={salir('jefe_nombre')}
            error={error('jefe_nombre')}
            ayuda="Serás el jefe del gimnasio en GymOS."
          />
          <Campo
            id="jefe_correo"
            etiqueta="Correo"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            value={valores.jefe_correo}
            onChange={cambiar('jefe_correo')}
            onBlur={salir('jefe_correo')}
            error={error('jefe_correo')}
            ayuda="Aquí llega el enlace de confirmación. Con este correo entrarás a GymOS."
          />
          <Campo
            id="telefono"
            etiqueta="Teléfono"
            type="tel"
            required
            autoComplete="tel-national"
            inputMode="tel"
            maxLength={20}
            placeholder="300 123 4567"
            value={valores.telefono}
            onChange={cambiar('telefono')}
            onBlur={salir('telefono')}
            error={error('telefono')}
            ayuda="Celular o fijo de Colombia, 10 dígitos."
          />

          <div className={error('acepta_terminos') ? 'campo campo-casilla campo-con-error' : 'campo campo-casilla'}>
            <input
              id="acepta_terminos"
              name="acepta_terminos"
              type="checkbox"
              required
              checked={valores.acepta_terminos}
              onChange={(e) => {
                const marcado = e.target.checked
                setValores((v) => ({ ...v, acepta_terminos: marcado }))
                setTocados((t) => ({ ...t, acepta_terminos: true }))
              }}
              aria-invalid={error('acepta_terminos') ? true : undefined}
              aria-describedby={error('acepta_terminos') ? 'acepta_terminos-error' : undefined}
            />
            <label htmlFor="acepta_terminos">
              Acepto los <Link to="/terminos" target="_blank" rel="noopener">términos del servicio</Link> y
              la <Link to="/privacidad" target="_blank" rel="noopener">política de privacidad</Link>, incluido el
              tratamiento de mis datos personales.
              <span className="obligatorio" aria-hidden="true"> *</span>
            </label>
            {error('acepta_terminos') && (
              <p id="acepta_terminos-error" className="campo-error">{error('acepta_terminos')}</p>
            )}
          </div>
        </fieldset>

        {errorEnvio && (
          <Aviso tipo="error" titulo="No pudimos enviar tu registro">
            <p>{errorEnvio.message}</p>
          </Aviso>
        )}

        <button type="submit" className="boton boton-primario boton-bloque" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Crear mi prueba gratis'}
        </button>
      </form>
    </section>
  )
}
