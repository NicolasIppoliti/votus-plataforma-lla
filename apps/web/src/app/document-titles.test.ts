import { expect, it, vi } from "vitest";
import { NAVIGATION_GROUPS } from "./(authenticated)/navigation";

vi.mock("next/font/google", () => ({
  IBM_Plex_Sans: () => ({ variable: "sans" }),
  IBM_Plex_Mono: () => ({ variable: "mono" }),
}));

const routes: [string, string][] = [
  ["./login/page", "Iniciar sesión"],
  ["./(onboarding)/onboarding/page", "Configurar organización"],
  ["./not-found", "Página no encontrada"],
  ...Object.values(NAVIGATION_GROUPS).flatMap(group => group.items.map(item => [
    item.href === "/" ? "./(authenticated)/(home)/page" : `./(authenticated)${item.href}/page`,
    item.label,
  ] as [string, string])),
];

it("the real root layout provides the shared Spanish document title template", async () => {
  const { metadata } = await import("./layout");
  expect(metadata.title).toEqual({ default: "Votus · Análisis electoral interno", template: "%s · Votus" });
});

it.each(routes)("real route %s exports its distinct Spanish title", async (path, title) => {
  const route = await import(/* @vite-ignore */ path);
  expect(route.metadata?.title).toBe(title);
});

it("all user-facing route titles are distinct", async () => {
  const titles = await Promise.all(routes.map(async ([path]) => (await import(/* @vite-ignore */ path)).metadata?.title));
  expect(new Set(titles).size).toBe(routes.length);
});
