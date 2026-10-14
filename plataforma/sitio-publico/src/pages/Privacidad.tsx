import { Link } from 'react-router-dom'
import PaginaLegal, { Pendiente } from '@/components/PaginaLegal'
import { enlaceWhatsApp } from '@/config'

export default function Privacidad() {
  const whatsapp = enlaceWhatsApp()
  return (
    <PaginaLegal titulo="Política de privacidad y tratamiento de datos personales">
      <p>
        Esta política explica cómo GymOS trata los datos personales de quienes registran un gimnasio en
        este sitio, conforme a la Ley 1581 de 2012 de protección de datos personales de Colombia y sus normas
        reglamentarias.
      </p>

      <h2>1. Responsable del tratamiento</h2>
      <ul>
        <li>Razón social: <Pendiente>razón social</Pendiente></li>
        <li>NIT: <Pendiente>NIT</Pendiente></li>
        <li>Domicilio: <Pendiente>dirección</Pendiente></li>
        <li>Correo para consultas y reclamos: <Pendiente>correo de contacto</Pendiente></li>
        {whatsapp && (
          <li>WhatsApp: <a href={whatsapp} target="_blank" rel="noopener noreferrer">escríbenos aquí</a></li>
        )}
      </ul>

      <h2>2. Datos que recogemos en el registro</h2>
      <ul>
        <li>Nombre y ciudad del gimnasio.</li>
        <li>Nombre, correo y teléfono de la persona que registra el gimnasio.</li>
        <li>La fecha y hora en que aceptas estos términos y la dirección IP desde la que te registras.</li>
        <li>La contraseña que eliges al confirmar, que se guarda cifrada y nadie del equipo puede leer.</li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Verificar tu correo y crear tu gimnasio en GymOS con la prueba gratis.</li>
        <li>Darte acceso a tu cuenta y enviarte mensajes sobre el servicio, como avisos de vencimiento o pagos.</li>
        <li>Evitar el abuso de la prueba gratis, que es una por correo y por teléfono.</li>
        <li>Contactarte para el paso de la prueba a un plan de pago si así lo decides.</li>
        <li>Cumplir obligaciones legales y atender requerimientos de autoridades competentes.</li>
      </ul>

      <h2>4. Datos de los clientes de tu gimnasio</h2>
      <p>
        Los datos de los clientes que tu gimnasio registra dentro de GymOS los decide y controla el gimnasio.
        En ese caso el gimnasio es el responsable del tratamiento frente a sus clientes y GymOS actúa como
        encargado: los guarda y los procesa solo para prestar el servicio. Cada gimnasio debe contar con la
        autorización de sus clientes para tratar sus datos.
      </p>

      <h2>5. Tus derechos</h2>
      <p>Como titular de los datos puedes:</p>
      <ul>
        <li>Conocer, actualizar y rectificar tus datos personales.</li>
        <li>Pedir prueba de la autorización que nos diste.</li>
        <li>Ser informado sobre el uso que les damos.</li>
        <li>
          Revocar la autorización o pedir que se supriman, cuando no exista un deber legal o contractual de
          conservarlos.
        </li>
        <li>
          Presentar quejas ante la Superintendencia de Industria y Comercio después de agotar el trámite de
          consulta o reclamo con nosotros.
        </li>
        <li>Acceder gratis a tus datos.</li>
      </ul>

      <h2>6. Cómo ejercerlos</h2>
      <p>
        Envía tu solicitud al correo de contacto indicado arriba con tu nombre, el correo con el que te
        registraste y lo que pides. Las consultas se atienden en un máximo de 10 días hábiles y los reclamos en
        un máximo de 15 días hábiles, como indica la Ley 1581 de 2012.
      </p>

      <h2>7. Seguridad y terceros</h2>
      <p>
        Los datos de cada gimnasio se guardan separados de los de los demás. Usamos proveedores para el
        alojamiento del servicio y el envío de correos, que solo tratan los datos para prestarnos ese
        servicio. <Pendiente>lista de proveedores y país donde se alojan los datos</Pendiente>
      </p>

      <h2>8. Cuánto tiempo los guardamos</h2>
      <p>
        Mientras tu gimnasio use GymOS. Si cancelas, puedes descargar una copia de tus datos durante 30 días;
        después de ese plazo los datos del gimnasio pueden eliminarse de forma definitiva.{' '}
        <Pendiente>plazo de conservación de los registros de prueba no confirmados</Pendiente>
      </p>

      <h2>9. Cambios a esta política</h2>
      <p>
        Publicaremos aquí cualquier cambio. Vigente desde: <Pendiente>fecha de vigencia</Pendiente>.
      </p>

      <p>
        Consulta también los <Link to="/terminos">términos del servicio</Link>.
      </p>
    </PaginaLegal>
  )
}
