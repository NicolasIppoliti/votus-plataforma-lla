import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadCircuitGeometry } from "@/app/(authenticated)/drilldown/circuit-geometry";
import { CircuitReferenceSvg } from "./CircuitReferenceSvg";
import { circuitPresentation } from "@/lib/geography/circuit-presentation";
import type { CircuitOutcome } from "@/lib/workspace/official-section-circuit-outcomes";
function outcome(votes = [60, 40]): CircuitOutcome {
  return { circuito_code: "00248", positive_total: votes.reduce((a, b) => a + b, 0), status: "partial",
    counts: { expected: 3, counted: 2, not_counted: 1, missing: 0, unexpected: 0, quarantined: 0 },
    parties: votes.map((v, i) => ({ identity_status: "canonical", canonical_party_id: String(i), display_name: `Partido ${i}`, list_id: null, votes: v })) };
}
describe("reference circuits and presentation", () => {
  it("reuses all ten pinned polygons, with canonical codes and neutral intersection clipping", async () => {
    const geometry = await loadCircuitGeometry();
    expect(geometry).toHaveLength(10);
    expect(geometry!.map(g => g.code)).toContain("00248");
    const html = renderToStaticMarkup(<CircuitReferenceSvg geometry={geometry!} circuits={[outcome()]} selected={null} onSelect={() => {}} />);
    expect(html.match(/role="button"/g)).toHaveLength(10);
    expect(html.match(/tabindex="0"/g)).toHaveLength(10);
    expect(html).toContain("<clipPath");
    expect(html).toContain("clip-path=");
    expect(html).toContain("superposición en la fuente");
    expect(html).toContain('data-hatched="true"');
    expect(html).toContain("Partido 0; provisorio · 66 % de mesas");
  });
  it.each([[52,48,"light"],[52.5,47.5,"medium"],[53,47,"medium"],[57.5,42.5,"medium"],[58,42,"intense"]] as const)("bands %s/%s as %s", (a,b,band) => {
    expect(circuitPresentation(outcome([a,b])).band).toBe(band);
  });
  it("ranks every group, preserves ties and zero denominator, caps partial coverage", () => {
    const c = outcome([10, 10, 80]);
    expect(circuitPresentation(c).winner).toBe("Partido 2");
    expect(circuitPresentation(outcome([50,50])).winner).toBe("Empate");
    expect(circuitPresentation(outcome([0,0])).margin).toBeNull();
    c.counts.counted = 3; c.counts.not_counted = 0; c.counts.unexpected = 1;
    expect(circuitPresentation(c).coverage).toBe("provisorio · 99 % de mesas");
  });
});

describe("legend party key (#614)", () => {
  const circuit = (code: string, winner: string, name: string): CircuitOutcome => ({ circuito_code: code, positive_total: 100, status: "complete",
    counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 },
    parties: [{ identity_status: "canonical", canonical_party_id: winner, display_name: name, list_id: null, votes: 80 },
      { identity_status: "canonical", canonical_party_id: "runner-up", display_name: "Segundo", list_id: null, votes: 20 }] });

  it("names every winner colour actually drawn, with the drawn swatch, and only those", async () => {
    const geometry = await loadCircuitGeometry();
    const circuits = [circuit("00248", "lla", "LA LIBERTAD AVANZA"), circuit("00249", "lla", "LA LIBERTAD AVANZA"), circuit("0248A", "fp", "FUERZA PATRIA")];
    const html = renderToStaticMarkup(<CircuitReferenceSvg geometry={geometry!} circuits={circuits} selected={null} />);
    const legend = html.slice(html.indexOf('aria-label="Codificación de circuitos"'));
    for (const c of circuits.slice(1)) {
      const color = circuitPresentation(c).color;
      expect(html).toContain(`fill="${color}"`);
      expect(legend).toMatch(new RegExp(`background:${color}"></span>Ganador: ${c.parties[0]!.display_name}<`));
    }
    expect(legend.match(/Ganador: LA LIBERTAD AVANZA/g)).toHaveLength(1);
    expect(legend).not.toContain("Ganador: Segundo");
    expect(legend).not.toContain("Relleno: ganador y margen; neutro sin resultado atribuible");
    expect(legend).toContain("Neutro: empate, sin votos positivos o lista sin mapear");
  });
});
