import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
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
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (() => {
            let preference;
            try { preference = localStorage.getItem("votus-theme"); } catch {}
            const theme = preference === "light" || preference === "dark"
              ? preference : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.colorScheme = theme;
          })();
        ` }} />
      </head>
      <body className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        <a className="skip-link" href="#main-content">
          Ir al contenido principal
        </a>
        {children}
      </body>
    </html>
  );
}
