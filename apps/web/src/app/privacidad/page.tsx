import Link from "next/link";

export const metadata = { title: "Aviso de privacidad" };

export default function PrivacyPage() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-6 p-6" tabIndex={-1}>
      <header>
        <h1>Aviso de privacidad</h1>
        <p>Este aviso explica cómo el equipo operador de Votus trata los datos de quienes usan la aplicación.</p>
        <p>Los datos electorales de las fuentes oficiales son públicos y son distintos de los datos personales de las cuentas de usuarios.</p>
      </header>
      <section aria-labelledby="datos">
        <h2 id="datos">Qué datos tratamos</h2>
        <ul>
          <li>Correo electrónico y credenciales de acceso. La contraseña se envía a Supabase Auth para autenticarte; Votus no la guarda en su propia base de datos.</li>
          <li>Datos de sesión y cookies de autenticación.</li>
          <li>Pertenencia a organizaciones, organización seleccionada y finalización de la guía de inicio por organización.</li>
          <li>Eventos de auditoría de acciones del espacio de trabajo: fecha y hora, tipo de actor, identificadores de usuario, sesión, contexto y organización cuando corresponden, acción, resultado, motivo y detalles de la operación.</li>
        </ul>
      </section>
      <section aria-labelledby="fines">
        <h2 id="fines">Para qué los usamos</h2>
        <p>Para iniciar y mantener tu sesión, autorizar el acceso según tu organización y sus permisos, recordar la finalización de la guía de inicio y proteger el servicio mediante controles de seguridad y auditoría.</p>
      </section>
      <section aria-labelledby="usos">
        <h2 id="usos">Sin usos secundarios</h2>
        <p>El uso de estos datos se limita a operar el acceso y la seguridad de Votus. No usamos analítica de navegación ni rastreo publicitario. No vendemos tus datos ni los usamos para marketing.</p>
      </section>
      <section aria-labelledby="proveedores">
        <h2 id="proveedores">Proveedores</h2>
        <p>Usamos Supabase para la autenticación y la base de datos, y Vercel para el alojamiento de la aplicación. Estos proveedores procesan datos para prestar esos servicios.</p>
      </section>
      <section aria-labelledby="retencion">
        <h2 id="retencion">Retención</h2>
        <p>Conservamos los datos de la cuenta hasta la baja de la cuenta o la revocación del acceso. Después de la baja o revocación, las copias de respaldo pueden conservarlos durante 30 días adicionales.</p>
      </section>
      <section aria-labelledby="derechos">
        <h2 id="derechos">Derechos y contacto</h2>
        <p>El responsable del tratamiento es el equipo operador de Votus. Para consultas o solicitudes de acceso, rectificación o eliminación de tus datos, escribí a <a href="mailto:votus@fragua.dev">votus@fragua.dev</a>.</p>
      </section>
      <section aria-labelledby="cookies">
        <h2 id="cookies">Cookies</h2>
        <p>Usamos únicamente cookies esenciales para la sesión y la autenticación. No usamos cookies de analítica ni publicidad y no mostramos un banner de consentimiento.</p>
      </section>
      <section aria-labelledby="cambios">
        <h2 id="cambios">Cambios</h2>
        <p>Última actualización: 17 de octubre de 2026. Publicaremos los cambios de este aviso en esta página.</p>
      </section>
      <Link href="/login">Ir a iniciar sesión</Link>
    </main>
  );
}
