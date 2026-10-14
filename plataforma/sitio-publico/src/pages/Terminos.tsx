import { Link } from 'react-router-dom'
import PaginaLegal, { Pendiente } from '@/components/PaginaLegal'
import { DOMINIO_BASE } from '@/config'

export default function Terminos() {
  return (
    <PaginaLegal titulo="Términos del servicio">
      <p>
        Estos términos regulan el uso de GymOS, el software para gimnasios que se ofrece en {DOMINIO_BASE}.
        Al registrar tu gimnasio aceptas estos términos y la <Link to="/privacidad">política de privacidad</Link>.
      </p>

      <h2>1. Quién presta el servicio</h2>
      <p>
        <Pendiente>razón social</Pendiente>, identificada con NIT <Pendiente>NIT</Pendiente>, con domicilio
        en <Pendiente>ciudad y dirección</Pendiente>.
      </p>

      <h2>2. El servicio</h2>
      <p>
        GymOS es un software que se usa desde el navegador. Cada gimnasio tiene su propia dirección
        (tugimnasio.{DOMINIO_BASE}) y sus datos separados de los de los demás gimnasios.
      </p>

      <h2>3. Registro y cuenta</h2>
      <ul>
        <li>
          Quien registra el gimnasio queda como su jefe dentro de GymOS y responde por las cuentas que cree para
          su personal.
        </li>
        <li>Los datos del registro deben ser reales. El gimnasio se crea solo después de confirmar el correo.</li>
        <li>Debes guardar tu contraseña de forma segura y no compartirla.</li>
      </ul>

      <h2>4. Prueba gratis</h2>
      <ul>
        <li>La prueba no tiene costo y dura lo indicado en la <Link to="/planes">página de planes</Link>.</li>
        <li>Hay una prueba por correo y por teléfono.</li>
        <li>Al terminar la prueba, el acceso al gimnasio se bloquea hasta que se active un plan de pago.</li>
      </ul>

      <h2>5. Planes y pagos</h2>
      <ul>
        <li>Los precios están en pesos colombianos y se publican en la <Link to="/planes">página de planes</Link>.</li>
        <li>El pago es manual, por transferencia. El equipo de GymOS confirma cada pago y activa o renueva el plan.</li>
        <li>
          Si el pago no llega en la fecha de corte, el gimnasio sigue funcionando con aviso durante 3 días y desde
          el día 4 queda bloqueado hasta que se registre el pago.
        </li>
        <li>
          Cada plan tiene límites de clientes activos y de usuarios del personal. Al llegar al límite no se pueden
          crear más, pero la operación diaria sigue funcionando.
        </li>
        <li>Facturación: <Pendiente>cómo y cuándo se entrega la factura</Pendiente></li>
      </ul>

      <h2>6. Cancelación y tus datos</h2>
      <ul>
        <li>
          Puedes pedir la cancelación en cualquier momento.{' '}
          <Pendiente>canal y condiciones de la solicitud</Pendiente>
        </li>
        <li>Al cancelar recibes un enlace para descargar tus datos en archivos CSV. El enlace vence a los 30 días.</li>
        <li>
          Pasados 30 días desde la cancelación, los datos del gimnasio pueden eliminarse de forma definitiva y su
          dirección queda libre.
        </li>
      </ul>

      <h2>7. Uso aceptable</h2>
      <p>
        No está permitido usar GymOS para actividades ilegales, intentar acceder a datos de otros gimnasios ni
        afectar el funcionamiento del servicio.
      </p>

      <h2>8. Responsabilidad</h2>
      <p>
        <Pendiente>alcance de la responsabilidad, disponibilidad del servicio y soporte</Pendiente>
      </p>

      <h2>9. Cambios y ley aplicable</h2>
      <p>
        Avisaremos los cambios a estos términos antes de que entren en vigor. Estos términos se rigen por las leyes
        de la República de Colombia. Vigentes desde: <Pendiente>fecha de vigencia</Pendiente>.
      </p>
    </PaginaLegal>
  )
}
