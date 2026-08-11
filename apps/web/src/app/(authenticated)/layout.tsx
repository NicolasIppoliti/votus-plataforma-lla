import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { SourceDisclaimer } from "@/components/SourceDisclaimer";

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
 * Phase 16c: `/municipal` is linked here for the same reason — the
 * `coronel_rosales_municipal` party mappings (Phase 15) had no reachable
 * route, this project's 8th instance of shipped-correct-but-unreachable code.
 * `/simulate` follows the same production reachability contract: an operator
 * can enter the projection workflow from this authenticated navigation.
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

  // `review_item_unresolved_count` (0007_review_item.sql) — a missing row
  // or a query error is treated as "unknown", not "zero", so the banner
  // never falsely claims a clean queue; it simply does not render.
  const { data: unresolvedRow } = await supabase
    .from("review_item_unresolved_count")
    .select("unresolved_count")
    .maybeSingle();
  const unresolvedCount = unresolvedRow?.["unresolved_count"] as number | undefined;

  return (
    <>
      <SourceDisclaimer />
      <nav aria-label="main">
        <Link href="/dashboard">Dashboard</Link>
        {" | "}
        <Link href="/compare">Compare</Link>
        {" | "}
        <Link href="/drilldown">Explore results</Link>
        {" | "}
        <Link href="/fiscalizacion">Fiscalización (unofficial)</Link>
        {" | "}
        <Link href="/municipal">Municipal (Concejales)</Link>
        {" | "}
        <Link href="/simulate">Seat simulation</Link>
        {" | "}
        <Link href="/review">Review</Link>
      </nav>
      {typeof unresolvedCount === "number" && unresolvedCount > 0 ? (
        <p role="alert">
          <Link href="/review">{unresolvedCount} unresolved review item(s)</Link>
        </p>
      ) : null}
      {children}
    </>
  );
}
