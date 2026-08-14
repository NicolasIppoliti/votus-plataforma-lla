import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Votus | Análisis electoral interno",
  description:
    "Análisis electoral interno basado en evidencia oficial y pública, con el estado explícito de cada fuente.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="es">
      <body>
        <a className="skip-link" href="#main-content">
          Ir al contenido principal
        </a>
        {children}
      </body>
    </html>
  );
}
