import { Alert } from "@/components/ui/alert";
import type { ReactNode } from "react";
import type { SourceRef } from "@/lib/results/types";

export interface ProvenanceLinkProps {
  /** One entry for a direct figure; more than one for a derived figure
   * (e.g. a swing computed from a 2023 AND a 2025 source). */
  sources: SourceRef[];
}

/**
 * provenance-display spec: "Every displayed figure is traceable to its
 * archived source" — lists every contributing `SourceRef` with its
 * archive entry id, sha256 digest, original URL, and fetch timestamp.
 */
export function ProvenanceLink({ sources }: ProvenanceLinkProps): ReactNode {
  return (
    <ul aria-label="procedencia">
      {sources.map((source) => (
        <li key={source.archiveEntryId}>
          <span>{source.archiveEntryId}</span>
          {" — sha256: "}
          {source.sha256 ? (
            <code>{source.sha256}</code>
          ) : (
            // Named, not blank. An entry with no hash cannot be verified, and
            // rendering an empty code block reads as a digest that is simply
            // hard to see.
            <Alert variant="unavailable">sin hash — esta entrada no puede verificarse</Alert>
          )}
          {" — "}
          <a href={source.url}>{source.url}</a>
          {" — descargada el "}
          <time dateTime={source.fetchedAt}>{source.fetchedAt}</time>
        </li>
      ))}
    </ul>
  );
}
