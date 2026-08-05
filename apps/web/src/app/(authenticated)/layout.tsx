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
      {typeof unresolvedCount === "number" && unresolvedCount > 0 ? (
        <p role="alert">
          <Link href="/review">{unresolvedCount} unresolved review item(s)</Link>
        </p>
      ) : null}
      {children}
    </>
  );
}
