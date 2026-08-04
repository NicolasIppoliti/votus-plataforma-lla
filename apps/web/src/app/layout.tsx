import type { ReactNode } from "react";

export const metadata = {
  title: "Votus",
  description: "Internal electoral analysis platform.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
