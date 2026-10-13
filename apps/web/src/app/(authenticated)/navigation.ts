export const NAVIGATION_GROUPS = {
  panorama: { label: "Panorama", items: [{ label: "Panorama", href: "/" }] },
  exploration: { label: "Exploración", items: [{ label: "Exploración", href: "/drilldown" }, { label: "Municipal", href: "/municipal" }] },
  comparison: { label: "Comparación", items: [{ label: "Comparación", href: "/compare" }] },
  simulation: { label: "Simulación", items: [{ label: "Simulación", href: "/simulate" }, { label: "Escenarios Rosales 2027", href: "/scenarios" }] },
  evidence: {
    label: "Evidencia",
    description: "Fuente no oficial, separada de los resultados oficiales.",
    items: [{ label: "Evidencia", href: "/evidencia" }, { label: "Revisión de datos", href: "/review" }, { label: "Fiscalización (no oficial)", href: "/fiscalizacion" }],
  },
} as const;

export type NavigationGroup = (typeof NAVIGATION_GROUPS)[keyof typeof NAVIGATION_GROUPS];
export type NavigationItem = NavigationGroup["items"][number];

export function isRouteActive(pathname: string, href: NavigationItem["href"]): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
