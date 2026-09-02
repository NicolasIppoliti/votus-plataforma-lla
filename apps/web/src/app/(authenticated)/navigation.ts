export const NAVIGATION_GROUPS = {
  situation: {
    label: "Situación",
    items: [{ label: "Resumen operativo", href: "/dashboard" }],
  },
  officialResults: {
    label: "Resultados oficiales",
    items: [
      { label: "Explorar", href: "/drilldown" },
      { label: "Comparar", href: "/compare" },
      { label: "Municipal", href: "/municipal" },
    ],
  },
  fiscalizacion: {
    label: "Fiscalización",
    description:
      "Fuente no oficial, separada de los resultados oficiales.",
    items: [
      { label: "Fiscalización (no oficial)", href: "/fiscalizacion" },
    ],
  },
  scenarios: {
    label: "Escenarios",
    items: [{ label: "Simulación 2027", href: "/simulate" }],
  },
  operations: {
    label: "Operaciones",
    items: [{ label: "Revisión de datos", href: "/review" }],
  },
} as const;

export type NavigationGroup =
  (typeof NAVIGATION_GROUPS)[keyof typeof NAVIGATION_GROUPS];
export type NavigationItem = NavigationGroup["items"][number];

export function isRouteActive(
  pathname: string,
  href: NavigationItem["href"],
): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
