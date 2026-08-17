"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Panel" },
  { href: "/drilldown", label: "Explorar resultados" },
  { href: "/fiscalizacion", label: "Fiscalización (no oficial)" },
  { href: "/simulate", label: "Simulación de bancas" },
  { href: "/review", label: "Revisión" },
] as const;

export function PrimaryNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="principal" className="main-navigation">
      <ul className="shell-container navigation-list">
        {links.map(({ href, label }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href}>
              <Link href={href} aria-current={isActive ? "page" : undefined}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
