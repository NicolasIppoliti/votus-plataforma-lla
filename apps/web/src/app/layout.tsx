import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { connection } from "next/server";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata = {
  robots: { index: false, follow: false },
  title: "Votus | Análisis electoral interno",
  description:
    "Análisis electoral interno basado en evidencia oficial y pública, con el estado explícito de cada fuente.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  // Nonces must be attached at request time, including on public login HTML.
  await connection();
  return (
    <html lang="es">
      <body className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        <a className="skip-link" href="#main-content">
          Ir al contenido principal
        </a>
        {children}
      </body>
    </html>
  );
}
