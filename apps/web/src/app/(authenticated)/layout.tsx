import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutForm } from "@/components/SignOutForm";
import { SourceDisclaimer } from "@/components/SourceDisclaimer";
import { WorkspaceSelector } from "@/components/WorkspaceSelector";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedReviewItems } from "@/lib/workspace/context";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import { PrimaryNavigation } from "./PrimaryNavigation";

/**
 * Layout gate for every in-scope route (task 9.6).
 *
 * Single authenticated role: this checks only "is there a valid session" —
 * no role, privilege flag, or user attribute is read here, so every
 * authenticated user renders through the exact same path
 * (specs/access-control/spec.md, "Single authenticated role"). Any route
 * placed under `src/app/(authenticated)/` inherits this gate automatically;
 * `middleware.ts` already denies unauthenticated requests earlier in the
 * pipeline, so this is a second, independent check at render time.
 *
 * Task 11.12/11.18 and design.md D7: the disclaimer and the unresolved
 * review-item banner are rendered HERE, once, rather than repeated per
 * page — every route under `(authenticated)/` inherits both structurally,
 * so no future page can forget either.
 *
 * Task 13.10: the `/fiscalizacion` route is linked here so it is reachable
 * by an operator navigating the app, not merely addressable by URL —
 * closing the reachability gap `sdd-verify` found (fiscalizacion-analysis
 * spec, "An operator route reaches fiscalización through the opt-in path").
 *
 * Phase 16c introduced the `/municipal` and `/compare` workflows. UI #78a
 * makes both routes directly reachable from the shared primary-navigation
 * contract while preserving `/simulate` as the projection workflow entry.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const selection = await loadWorkspaceSelection();

  // A denied or failed workspace check is "unknown", never a false clean queue.
  let unresolvedCount: number | undefined;
  try {
    const review = await authorizedReviewItems(supabase, 0, 0);
    if (typeof review === "object" && review !== null) {
      const payload = review as Record<string, unknown>;
      if (payload["status"] === "ok" && typeof payload["total"] === "number" && Number.isSafeInteger(payload["total"]) && payload["total"] >= 0) {
        unresolvedCount = payload["total"];
      }
    }
  } catch {
    unresolvedCount = undefined;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="shell-container site-header__inner">
          <Link className="site-brand" href="/dashboard" aria-label="Panel de Votus">
            <span className="site-brand__name">Votus</span>
            <span className="site-brand__descriptor">espacio de evidencia</span>
          </Link>
          <p className="site-context">Análisis electoral interno</p>
          <WorkspaceSelector initialSelection={selection} />
          <SignOutForm />
        </div>
        <PrimaryNavigation />
      </header>
      <div className="shell-container app-content" id="main-content" tabIndex={-1}>
        <div className="source-disclaimer">
          <SourceDisclaimer />
        </div>
        {unresolvedCount === undefined ? <p className="review-alert" role="status">No se pudo verificar el estado de revisión.</p> : null}
        {typeof unresolvedCount === "number" && unresolvedCount > 0 ? (
          <p className="review-alert" role="alert">
                <span className="status-label">Requiere revisión</span>
                <Link href="/review">
                  {unresolvedCount} elemento(s) de revisión pendiente(s)
                </Link>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
