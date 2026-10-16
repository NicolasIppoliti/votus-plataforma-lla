import type { CircuitOutcome } from "../workspace/official-section-circuit-outcomes";

import { circuitColor, MARGIN_BANDS } from "@/components/maps/reference-colors";
export function circuitPresentation(c: CircuitOutcome) {
  const ranked = [...c.parties].sort((a, b) => b.votes - a.votes);
  const first = ranked[0], second = ranked[1];
  const tie = c.positive_total > 0 && first?.votes === second?.votes;
  const winner = c.positive_total === 0 ? "Sin votos positivos" : tie ? "Empate" : first?.identity_status === "canonical"
    ? first.display_name : `Lista sin mapear ${first?.list_id ?? "no identificada"}`;
  const margin = c.positive_total === 0 ? null : ((first?.votes ?? 0) - (second?.votes ?? 0)) / c.positive_total * 100;
  const band = margin === null || tie ? "neutral" : margin < MARGIN_BANDS.light.below ? "light" : margin <= MARGIN_BANDS.medium.through ? "medium" : "intense";
  const coverage = c.status === "complete" ? "Completo" : `provisorio · ${Math.min(99, Math.floor(c.counts.counted / c.counts.expected * 100))} % de mesas`;
  return { winner, margin, band, coverage, color: circuitColor(!tie && c.positive_total > 0 ? first?.canonical_party_id ?? null : null) };
}

/** Winner colours actually drawn, keyed by canonical party (#614). Ties, zero
 * positive votes and unmapped lists stay neutral and are explained separately. */
export function circuitWinnerKey(circuits: readonly CircuitOutcome[]): { name: string; color: string }[] {
  const key = new Map<string, { name: string; color: string }>();
  for (const c of circuits) {
    const first = [...c.parties].sort((a, b) => b.votes - a.votes)[0];
    const p = circuitPresentation(c);
    if (!first || first.identity_status !== "canonical" || p.band === "neutral" || c.positive_total === 0) continue;
    key.set(first.canonical_party_id, { name: first.display_name, color: p.color });
  }
  return [...key.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
