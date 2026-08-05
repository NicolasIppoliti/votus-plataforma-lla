import type { ReactNode } from "react";
import type { Coverage, SourceKind } from "@/lib/results/types";

export interface ElectionFigure {
  electionId: string;
  electionLabel: string;
  sourceKind: SourceKind;
  sharePercent: number;
}

export interface JuxtapositionBadgeProps {
  /** The 26 Oct 2025 fiscalización figure — always carries a `Coverage`. */
  fiscalizacion: ElectionFigure & { coverage: Coverage };
  /** An official figure from a DIFFERENT election, shown for context. */
  official: ElectionFigure;
}

/**
 * fiscalizacion-analysis spec, Requirement 9 ("The cross-election
 * juxtaposition badge is reachable and exercised") — design.md D9.2's
 * concrete misuse case: the 60,48 % LLA fiscalización share must never be
 * rendered beside the 29,31 % 2023 municipal official share without both
 * the unofficial-source badge and the coverage badge attached, and the
 * non-random coverage note MUST sit next to the fiscalización figure
 * itself, not only in a page-level footnote.
 */
export function JuxtapositionBadge({
  fiscalizacion,
  official,
}: JuxtapositionBadgeProps): ReactNode {
  return (
    <div role="group" aria-label="cross-election juxtaposition">
      <section aria-label="fiscalizacion figure">
        <span>
          {fiscalizacion.electionLabel} ({fiscalizacion.electionId})
        </span>
        <span role="status"> — unofficial source</span>
        <span> {fiscalizacion.sharePercent}%</span>
        <p role="note">
          Coverage: {fiscalizacion.coverage.observedUnits} of{" "}
          {fiscalizacion.coverage.denominatorUnits} mesas — not a random
          sample; these are exactly the mesas where the party had a fiscal
          present.
        </p>
      </section>
      <section aria-label="official figure">
        <span>
          {official.electionLabel} ({official.electionId})
        </span>
        <span role="status"> — official source</span>
        <span> {official.sharePercent}%</span>
      </section>
      <p role="alert">
        Different elections, not directly comparable: the fiscalización
        figure covers a partial, self-selected, non-random set of mesas.
      </p>
    </div>
  );
}
