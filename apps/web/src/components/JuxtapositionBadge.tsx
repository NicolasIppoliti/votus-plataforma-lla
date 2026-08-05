import type { ReactNode } from "react";
import type { Coverage, SourceKind, SourceRef } from "@/lib/results/types";

export interface ElectionFigure {
  electionId: string;
  electionLabel: string;
  sourceKind: SourceKind;
  sharePercent: number;
  /**
   * Whose share this is. Both sides of the badge carry the SAME party: a
   * badge showing each election's own top list compared two different parties
   * and read as one party's trend. Naming it makes the match checkable by the
   * person looking at it.
   */
  partyName: string;
}

export interface JuxtapositionBadgeProps {
  /**
   * Sources backing the OFFICIAL figure, rendered inside its own section.
   *
   * An EMPTY list is announced, not skipped: a displayed percentage with no
   * `SourceRef` and nothing saying so is the untraceable figure this whole
   * change exists to remove.
   *
   * The page merged the comparison election's archive entries into the
   * fiscalización block's `ProvenanceLink`, so the 2023 official ZIP's sha256
   * rendered under the unofficial figure with nothing saying which number it
   * backed.
   */
  officialSources: SourceRef[];
  /**
   * Archive entries backing the official figure that resolved to no source
   * record.
   *
   * Announcing only the EMPTY case left a partial trace silent: two entries,
   * one resolving, rendered a list that reads as complete.
   */
  officialMissingProvenance?: string[];
  /** The 26 Oct 2025 fiscalización figure — always carries a `Coverage`. */
  fiscalizacion: ElectionFigure & { sourceKind: "fiscalizacion"; coverage: Coverage };
  /** An official figure from a DIFFERENT election, shown for context. */
  official: ElectionFigure & { sourceKind: "official" };
}

/**
 * The label a figure earns from its OWN `sourceKind`.
 *
 * Both slots used to print a fixed string, so a `fiscalizacion` figure passed
 * as `official` rendered under an official-source badge with no coverage
 * denominator. That is the leakage guard's fourth path — the rendering one,
 * where a mislabel becomes the number a human reads. The literal prop types
 * above make the mismatch a compile error; this makes the label follow the
 * data rather than the slot.
 */
function sourceLabel(sourceKind: SourceKind): string {
  // Exhaustive, not a fallback. `!== "official" ? unofficial` labelled ANY
  // future kind "unofficial source" — a label nobody asserted, attached to a
  // number a human then reads.
  switch (sourceKind) {
    case "official":
      return " — official source";
    case "fiscalizacion":
      return " — unofficial source";
    default: {
      // Adding a kind to `SourceKind` breaks the build on THIS assignment,
      // which is the real guard — the comment used to claim it while the
      // assignment was missing, so nothing enforced anything.
      const _exhaustive: never = sourceKind;
      void _exhaustive;
      // At RUNTIME a value can still escape typing through an untyped
      // repository row. Throwing turned a labelling problem into a 500;
      // everywhere else in this capability an unknown REFUSES and reports, so
      // the figure renders under an explicit "unverified" label instead.
      return " — UNVERIFIED source kind, treat this figure as unlabelled";
    }
  }
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
  officialSources,
  officialMissingProvenance = [],
}: JuxtapositionBadgeProps): ReactNode {
  return (
    <div role="group" aria-label="cross-election juxtaposition">
      <section aria-label="fiscalizacion figure">
        <span>
          {fiscalizacion.electionLabel} ({fiscalizacion.electionId})
        </span>
        <span role="status">{sourceLabel(fiscalizacion.sourceKind)}</span>
        <span>
          {" "}
          {fiscalizacion.partyName}: {fiscalizacion.sharePercent}%
        </span>
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
        <span role="status">{sourceLabel(official.sourceKind)}</span>
        <span>
          {" "}
          {official.partyName}: {official.sharePercent}%
        </span>
        {officialMissingProvenance.length > 0 ? (
          <p role="alert">
            {officialMissingProvenance.length} archive entry/entries behind this
            figure resolved to no source record (
            {officialMissingProvenance.join(", ")}); it is only partly traced.
          </p>
        ) : null}
        {officialSources.length === 0 ? (
          <p role="alert">
            No archived source for this figure — it cannot be traced and must
            not be quoted.
          </p>
        ) : (
          <ul aria-label="official figure sources">
            {officialSources.map((source) => (
              <li key={source.archiveEntryId}>
                <a href={source.url}>{source.archiveEntryId}</a> — sha256{" "}
                {source.sha256 ? source.sha256.slice(0, 8) : "unhashed — cannot be verified"}, fetched {source.fetchedAt}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p role="alert">
        Different elections, not directly comparable: the fiscalización
        figure covers a partial, self-selected, non-random set of mesas.
      </p>
    </div>
  );
}
