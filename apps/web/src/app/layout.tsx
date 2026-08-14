import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Votus | Internal electoral analysis",
  description:
    "Internal electoral analysis using official and public evidence with explicit source status.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
