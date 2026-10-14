import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UnitSwing } from "@/lib/results/compare";
import { ComparisonChart } from "./ComparisonChart";

const parties = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const left = { P1: 41, P2: 35.4, P3: 2.69, P5: 20.91 } as Record<string, number>;
const right = { P1: 61.63, P3: 3.67, P4: 20.67, P6: 0.27, P7: 13.76 } as Record<string, number>;
const swing: UnitSwing = {
  unitId: "02/027",
  flipped: false,
  shares2023: Object.entries(left).map(([party, sharePercent]) => ({ party, votes: Math.round(sharePercent * 100), sharePercent })),
  shares2025: Object.entries(right).map(([party, sharePercent]) => ({ party, votes: Math.round(sharePercent * 100), sharePercent })),
  swings: parties.map((party) => ({ party, swingPercentPoints: (right[party] ?? 0) - (left[party] ?? 0) })),
} as UnitSwing;
const names = Object.fromEntries(parties.map((party) => [party, `Agrupación ${party}`]));

describe("ComparisonChart — compact approved hierarchy", () => {
  it("keeps the four largest agrupaciones visible and every other one named inside a closed disclosure", () => {
    const markup = renderToStaticMarkup(<ComparisonChart swing={swing} leftNames={names} rightNames={names} />);
    const [visible, folded = ""] = markup.split("<details");
    for (const party of ["P1", "P2", "P5", "P4"]) expect(visible).toContain(`Agrupación ${party}`);
    expect(folded).toMatch(/^[^>]*><summary>Otras agrupaciones \(3\)<\/summary>/);
    for (const party of ["P3", "P7", "P6"]) {
      expect(visible).not.toContain(`Agrupación ${party}<`);
      expect(folded).toContain(`Agrupación ${party}`);
    }
    expect(markup).not.toMatch(/<details[^>]*open/);
  });

  it("states an unavailable side as a full-width note instead of a clipped number cell", () => {
    const markup = renderToStaticMarkup(<ComparisonChart swing={swing} leftNames={names} rightNames={names} />);
    expect(markup).toMatch(/class="[^"]*unavailable[^"]*">Lado A: observación no disponible</);
  });
});
