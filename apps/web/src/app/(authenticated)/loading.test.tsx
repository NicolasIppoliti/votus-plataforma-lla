import { existsSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// #431: Next renders these files while the route's server work is pending.
const ROUTES = {
  "/": () => import("./(home)/loading"),
  "/drilldown": () => import("./drilldown/loading"),
  "/compare": () => import("./compare/loading"),
} as const;

describe("route loading states", () => {
  it.each(Object.entries(ROUTES))("%s shows a busy, figure-free skeleton", async (_route, load) => {
    const Loading = (await load()).default as () => ReactElement;
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/role="status"[^>]*>/);
    expect(html).toContain("Cargando");
    // No invented figures: the skeleton carries no digits at all.
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/[0-9]/);
  });

  // /municipal must stay fully readable without JavaScript (e2e/municipal.spec.ts
  // SSR readiness). A route Suspense fallback streams the content behind a
  // client-side swap, so this route deliberately has no loading.tsx.
  it("/municipal keeps a blocking SSR document instead of a streamed skeleton", () => {
    expect(existsSync(new URL("./municipal/loading.tsx", import.meta.url))).toBe(false);
  });
});
