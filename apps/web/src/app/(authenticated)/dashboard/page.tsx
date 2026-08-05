import type { ReactNode } from "react";

/**
 * Placeholder in-scope route, reachable only through
 * `(authenticated)/layout.tsx` and `middleware.ts`'s session gate.
 * Real dashboard content is added starting in Phase 11 (results
 * repository) and Phase 12 (UI); this Phase 9 stub exists to give the
 * access-control tests a concrete in-scope route to exercise.
 */
export default function DashboardPage(): ReactNode {
  return <main>Votus dashboard — content added starting in Phase 11.</main>;
}
