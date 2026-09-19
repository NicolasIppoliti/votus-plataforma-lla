import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { authorizedReviewItems } from "@/lib/workspace/context";
import { loadWorkspaceSelection } from "@/lib/workspace/selection";
import { ApplicationShell } from "./ApplicationShell";
import { MobileNavigation } from "./MobileNavigation";
import { SituationSidebar } from "./SituationSidebar";
import { WorkspaceTopbar } from "./WorkspaceTopbar";
import { WorkspacePresentation } from "./WorkspacePresentation";
import { WorkspaceFooter } from "./WorkspaceFooter";
import { AccountDisclosure } from "./AccountDisclosure";
import { SignOutForm } from "@/components/SignOutForm";

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

  const activeOrganization = selection.status === "active"
    ? selection.organizations.find((organization) => organization.id === selection.activeOrganizationId)
    : undefined;

  const accountControls = (
    <WorkspaceFooter selection={selection}>
      <AccountDisclosure><SignOutForm /></AccountDisclosure>
    </WorkspaceFooter>
  );
  const sidebar = <SituationSidebar />;

  return (
    <WorkspacePresentation snapshot={{
      organizationId: activeOrganization?.id ?? null,
      organizationName: activeOrganization?.name ?? null,
      status: selection.status,
      revision: selection.revision,
      unresolvedCount: activeOrganization ? unresolvedCount : undefined,
    }}>
    <ApplicationShell
      sidebar={sidebar}
      topbar={
        <WorkspaceTopbar
          accountControls={accountControls}
          mobileNavigation={<MobileNavigation sidebar={<SituationSidebar>{accountControls}</SituationSidebar>} />}
        />
      }
    >
      {children}
    </ApplicationShell>
    </WorkspacePresentation>
  );
}
