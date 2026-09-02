import { expect, it } from "vitest";
import {
  isRouteActive,
  NAVIGATION_GROUPS,
  type NavigationGroup,
  type NavigationItem,
} from "./navigation";

it("defines every current route in grouped operational navigation", () => {
  const groups: readonly NavigationGroup[] = Object.values(NAVIGATION_GROUPS);
  const items: readonly NavigationItem[] = groups.flatMap<NavigationItem>(
    (group) => group.items,
  );

  expect(groups.map((group) => group.label)).toEqual([
    "Situación",
    "Resultados oficiales",
    "Fiscalización",
    "Escenarios",
    "Operaciones",
  ]);
  expect(items.map((item) => item.href)).toEqual([
    "/dashboard",
    "/drilldown",
    "/compare",
    "/municipal",
    "/fiscalizacion",
    "/simulate",
    "/review",
  ]);
  expect(items.map((item) => item.label)).toEqual([
    "Resumen operativo",
    "Explorar",
    "Comparar",
    "Municipal",
    "Fiscalización (no oficial)",
    "Simulación 2027",
    "Revisión de datos",
  ]);
  expect(NAVIGATION_GROUPS.situation.items).toEqual([
    { label: "Resumen operativo", href: "/dashboard" },
  ]);
  expect(NAVIGATION_GROUPS.fiscalizacion.description).toMatch(/no oficial/i);
  expect(NAVIGATION_GROUPS.fiscalizacion.description).toMatch(
    /separada de los resultados oficiales/i,
  );
});

it("matches exact and descendant routes without matching shared prefixes", () => {
  expect(isRouteActive("/review", "/review")).toBe(true);
  expect(isRouteActive("/review/history", "/review")).toBe(true);
  expect(isRouteActive("/review/", "/review")).toBe(true);
  expect(isRouteActive("/review-history", "/review")).toBe(false);
  expect(isRouteActive("/reviewer", "/review")).toBe(false);
  expect(isRouteActive("/compare", "/review")).toBe(false);
});
