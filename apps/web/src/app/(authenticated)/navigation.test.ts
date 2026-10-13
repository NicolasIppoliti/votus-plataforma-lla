import { expect, it } from "vitest";
import { isRouteActive, NAVIGATION_GROUPS } from "./navigation";

it("defines five prototype modules and every existing route exactly once", () => {
  const groups = Object.values(NAVIGATION_GROUPS);
  expect(groups.map((group) => group.label)).toEqual(["Panorama", "Exploración", "Comparación", "Simulación", "Evidencia"]);
  const items = groups.flatMap((group) => [...group.items]);
  expect(items.map(({ label, href }) => [label, href])).toEqual([
    ["Panorama", "/"], ["Exploración", "/drilldown"], ["Municipal", "/municipal"],
    ["Comparación", "/compare"], ["Simulación", "/simulate"], ["Escenarios Rosales 2027", "/scenarios"],
    ["Evidencia", "/review"], ["Fiscalización (no oficial)", "/fiscalizacion"],
  ]);
  expect(new Set(items.map(({ href }) => href)).size).toBe(8);
});

it("matches exact and descendant routes without matching shared prefixes", () => {
  expect(isRouteActive("/review", "/review")).toBe(true);
  expect(isRouteActive("/review/history", "/review")).toBe(true);
  expect(isRouteActive("/review/", "/review")).toBe(true);
  expect(isRouteActive("/review-history", "/review")).toBe(false);
  expect(isRouteActive("/reviewer", "/review")).toBe(false);
  expect(isRouteActive("/compare", "/review")).toBe(false);
});

it("treats Panorama as active only at the exact root", () => {
  expect(isRouteActive("/", "/")).toBe(true);
  expect(isRouteActive("/dashboard", "/")).toBe(false);
  expect(isRouteActive("/review", "/")).toBe(false);
});
