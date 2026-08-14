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
      Esta herramienta no es una fuente electoral oficial. Las cifras se
      obtienen de datos de terceros archivados y de registros internos de
      fiscalización. Verifíquelas siempre con los resultados oficiales de la
      Junta Electoral antes de tomar decisiones.
    </p>
  );
}
