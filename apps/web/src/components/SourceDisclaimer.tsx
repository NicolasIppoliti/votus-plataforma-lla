import type { ReactNode } from "react";

/**
 * provenance-display spec: "Persistent non-official-source disclaimer".
 *
 * Deliberately has NO dismiss affordance at all — not a dismiss button
 * whose state is merely session-scoped, but none whatsoever. The spec
 * only forbids a PERMANENT dismissal; the simplest way to satisfy that
 * without accidentally building a persistence mechanism (localStorage,
 * a cookie, a `resolved_at`-style flag) is to give the operator nothing
 * that could ever suppress it.
 */
export function SourceDisclaimer(): ReactNode {
  return (
    <p role="note">
      This tool is not an official electoral source. Figures are derived
      from archived third-party data and internal fiscalización records;
      always verify against the official Junta Electoral results before
      acting on them.
    </p>
  );
}
