import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CircleCheckBig, ExternalLink } from 'lucide-react'
import { publicoService } from '@/api/publico.service'
import type { ErrorApi } from '@/api/cliente'
import Campo from '@/components/Campo'
import { Aviso, Cargando } from '@/components/Estados'
import { DOMINIO_BASE, enlaceWhatsApp } from '@/config'
import type { InfoEnlaceRegistro, RegistroConfirmado } from '@/types/publico.types'
import { useTituloPagina } from '@/utils/titulo'

const MIN_PASSWORD = 8
const MAX_PASSWORD = 128

type Estado =
  | { fase: 'validando' }
  | { fase: 'invalido'; error: ErrorApi | null }
  | { fase: 'error'; error: ErrorApi }
  | { fase: 'formulario'; info: InfoEnlaceRegistro }
  | { fase: 'prueba_usada'; mensaje: string }
  | { fase: 'creado'; resultado: RegistroConfirmado }

function validarPassword(valor: string): string | null {
  if (!valor) return 'Escribe una contraseña.'
  if (valor.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  if (valor.length > MAX_PASSWORD) return `La contraseña debe tener como máximo ${MAX_PASSWORD} caracteres.`
  return null
}

function validarRepetida(password: string, repetida: string): string | null {
  if (!repetida) return 'Escribe otra vez la contraseña.'
  if (password !== repetida) return 'Las contraseñas no coinciden.'
  return null
}

/** Un 404 (enlace desconocido) o 410 (vencido o ya usado) invalida el enlace. */
function esEnlaceInvalido(error: ErrorApi): boolean {
  return error.estado === 404 || error.estado === 410
}

function EnlaceInvalido({ error }: { error: ErrorApi | null }) {
  let titulo = 'Este enlace no es válido'
  let texto = 'Puede que esté incompleto o mal copiado. Abre el enlace directamente desde el correo que te enviamos.'
  if (error?.codigo === 'ENLACE_VENCIDO') {
    titulo = 'Este enlace venció'
    texto = 'Los enlaces de confirmación duran 24 horas. Vuelve a registrarte y te enviamos uno nuevo.'
  } else if (error?.codigo === 'ENLACE_USADO') {
    titulo = 'Este enlace ya se usó'
    texto =
      `Cada enlace sirve una sola vez. Si ya creaste tu gimnasio, entra desde su dirección en ${DOMINIO_BASE} ` +
      'con tu correo y tu contraseña.'
  } else if (error?.estado === 410) {
    titulo = 'Este enlace ya no sirve'
    texto = error.message
  }
  return (
    <div className="tarjeta resultado">
      <h1>{titulo}</h1>
      <p>{texto}</p>
      <div className="acciones">
        <Link to="/registro" className="boton boton-primario">Registrarme de nuevo</Link>
        <Link to="/" className="boton boton-secundario">Ir al inicio</Link>
      </div>
    </div>
  )
}

function PruebaYaUsada({ mensaje }: { mensaje: string }) {
  const whatsapp = enlaceWhatsApp('Hola, quiero activar GymOS y me dice que ya usé la prueba gratis.')
  return (
    <div className="tarjeta resultado">
      <h1>Ya existe una prueba con estos datos</h1>
      <p>{mensaje}</p>
      <p className="texto-suave">
        La prueba gratis es una por correo y por teléfono. Si quieres seguir usando GymOS o crees que es un error,
        contacta al equipo de GymOS.
      </p>
      <div className="acciones">
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="boton boton-primario">
            Escribir por WhatsApp
          </a>
        )}
        <Link to="/planes" className="boton boton-secundario">Ver planes</Link>
      </div>
    </div>
  )
}

function GimnasioCreado({ resultado }: { resultado: RegistroConfirmado }) {
  const tituloRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    tituloRef.current?.focus()
  }, [])
  return (
    <div className="tarjeta resultado">
      <span className="resultado-icono resultado-icono-exito" aria-hidden="true"><CircleCheckBig size={32} /></span>
      <h1 ref={tituloRef} tabIndex={-1}>Tu gimnasio está listo</h1>
      <p>Tu prueba gratis ya empezó. Esta es la dirección de tu gimnasio; guárdala en tus favoritos:</p>
      <p className="direccion-final">
        <strong className="direccion">{resultado.subdominio}.{DOMINIO_BASE}</strong>
      </p>
      <p className="texto-suave">Entra con tu correo y la contraseña que acabas de crear.</p>
      <a href={resultado.url_login} className="boton boton-primario boton-bloque">
        Entrar a mi gimnasio <ExternalLink size={18} aria-hidden="true" />
      </a>
    </div>
  )
}

function FormularioPassword({
  token, info, alTerminar,
}: {
  token: string
  info: InfoEnlaceRegistro
  alTerminar: (estado: Estado) => void
}) {
  const [password, setPassword] = useState('')
  const [repetida, setRepetida] = useState('')
  const [tocados, setTocados] = useState({ password: false, repetida: false })
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<ErrorApi | null>(null)
  const enviandoRef = useRef(false)

  const errorPassword = tocados.password ? validarPassword(password) : null
  const errorRepetida = tocados.repetida ? validarRepetida(password, repetida) : null

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (enviandoRef.current) return
    setTocados({ password: true, repetida: true })
    if (validarPassword(password)) {
      document.getElementById('password')?.focus()
      return
    }
    if (validarRepetida(password, repetida)) {
      document.getElementById('password_repetida')?.focus()
      return
    }

    enviandoRef.current = true
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const resultado = await publicoService.confirmar(token, password)
      alTerminar({ fase: 'creado', resultado })
    } catch (err) {
      const error = err as ErrorApi
      if (error.estado === 409 && error.codigo === 'PRUEBA_YA_USADA') {
        alTerminar({ fase: 'prueba_usada', mensaje: error.message })
      } else if (esEnlaceInvalido(error)) {
        alTerminar({ fase: 'invalido', error })
      } else {
        setErrorEnvio(error)
      }
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  return (
    <>
      <h1>Crea tu contraseña</h1>
      <p>
        Último paso para crear <strong>{info.nombre_gimnasio}</strong> en GymOS. Su dirección será parecida
        a <strong className="direccion">{info.subdominio_sugerido}.{DOMINIO_BASE}</strong>; te mostramos la
        definitiva al terminar.
      </p>
      <form className="tarjeta formulario" onSubmit={enviar} noValidate aria-busy={enviando}>
        <fieldset disabled={enviando}>
          <legend className="solo-lector">Contraseña de tu cuenta</legend>
          <Campo
            id="password"
            etiqueta="Contraseña"
            type="password"
            required
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            maxLength={MAX_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, password: true }))}
            error={errorPassword}
            ayuda={`Mínimo ${MIN_PASSWORD} caracteres.`}
          />
          <Campo
            id="password_repetida"
            etiqueta="Repite la contraseña"
            type="password"
            required
            autoComplete="new-password"
            maxLength={MAX_PASSWORD}
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, repetida: true }))}
            error={errorRepetida}
          />
        </fieldset>

        {errorEnvio && (
          <Aviso tipo="error" titulo="No pudimos crear tu gimnasio">
            <p>{errorEnvio.message}</p>
          </Aviso>
        )}

        <button type="submit" className="boton boton-primario boton-bloque" disabled={enviando}>
          {enviando ? 'Creando tu gimnasio…' : 'Crear mi gimnasio'}
        </button>
      </form>
    </>
  )
}

/**
 * Confirmación del registro. Acepta el token en la ruta (/registro/confirmar/:token) y también
 * como parámetro (?token=), que es como hoy lo arma super-admin-api en el correo.
 */
export default function ConfirmarRegistro() {
  useTituloPagina('Confirmar registro')
  const { token: tokenRuta } = useParams()
  const [parametros] = useSearchParams()
  const token = (tokenRuta || parametros.get('token') || '').trim()
  const [estado, setEstado] = useState<Estado>({ fase: 'validando' })

  async function validar(cancelado: { valor: boolean }) {
    if (!token) {
      setEstado({ fase: 'invalido', error: null })
      return
    }
    setEstado({ fase: 'validando' })
    try {
      const info = await publicoService.consultarEnlace(token)
      if (cancelado.valor) return
      setEstado(info.valido ? { fase: 'formulario', info } : { fase: 'invalido', error: null })
    } catch (err) {
      if (cancelado.valor) return
      const error = err as ErrorApi
      setEstado(esEnlaceInvalido(error) ? { fase: 'invalido', error } : { fase: 'error', error })
    }
  }

  useEffect(() => {
    const cancelado = { valor: false }
    void validar(cancelado)
    return () => {
      cancelado.valor = true
    }
  }, [token])

  return (
    <section className="contenedor seccion estrecho">
      {estado.fase === 'validando' && <Cargando texto="Revisando tu enlace…" />}
      {estado.fase === 'invalido' && <EnlaceInvalido error={estado.error} />}
      {estado.fase === 'error' && (
        <Aviso tipo="error" titulo="No pudimos revisar tu enlace">
          <p>{estado.error.message}</p>
          <button type="button" className="boton boton-secundario" onClick={() => void validar({ valor: false })}>
            Reintentar
          </button>
        </Aviso>
      )}
      {estado.fase === 'formulario' && (
        <FormularioPassword token={token} info={estado.info} alTerminar={setEstado} />
      )}
      {estado.fase === 'prueba_usada' && <PruebaYaUsada mensaje={estado.mensaje} />}
      {estado.fase === 'creado' && <GimnasioCreado resultado={estado.resultado} />}
    </section>
  )
}
