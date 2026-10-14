import type { CircuitOutcome } from "../workspace/official-section-circuit-outcomes";

// Categorical identifiers, not asserted party branding. Names remain authoritative.
export function circuitColor(id: string | null): string {
  if (id === null) return "var(--surface-muted)";
  const hash = [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
  return ["#487a9f", "#a77a4b", "#77875a", "#8f719e", "#548b86", "#ae6e7d"][hash % 6]!;
}
export function circuitBandColor(color: string, band: string): string {
  if (!color.startsWith("#") || band === "neutral" || band === "intense") return color;
  // Opaque lightness steps, not alpha over navy: all categorical fills stay >=3:1.
  const white = band === "light" ? 0.6 : 0.3;
  return "#" + color.slice(1).match(/../g)!.map(channel =>
    Math.round(parseInt(channel, 16) * (1 - white) + 255 * white).toString(16).padStart(2, "0")).join("");
}
export function circuitPresentation(c: CircuitOutcome) {
  const ranked = [...c.parties].sort((a, b) => b.votes - a.votes);
  const first = ranked[0], second = ranked[1];
  const tie = c.positive_total > 0 && first?.votes === second?.votes;
  const winner = c.positive_total === 0 ? "Sin votos positivos" : tie ? "Empate" : first?.identity_status === "canonical"
    ? first.display_name : `Lista sin mapear ${first?.list_id ?? "no identificada"}`;
  const margin = c.positive_total === 0 ? null : ((first?.votes ?? 0) - (second?.votes ?? 0)) / c.positive_total * 100;
  const band = margin === null || tie ? "neutral" : margin < 5 ? "light" : margin <= 15 ? "medium" : "intense";
  const coverage = c.status === "complete" ? "complete" : `provisorio · ${Math.min(99, Math.floor(c.counts.counted / c.counts.expected * 100))} % de mesas`;
  return { winner, margin, band, coverage, color: circuitColor(!tie && c.positive_total > 0 ? first?.canonical_party_id ?? null : null) };
}
