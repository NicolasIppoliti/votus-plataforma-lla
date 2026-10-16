import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ComparisonMapView } from "./ComparisonMap";

const SHA = "964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673";

it("keeps the geometry hash inside a provenance disclosure, not in the map card body (#615)", () => {
  const html = renderToStaticMarkup(<ComparisonMapView electionLabels={["2023 generales", "2025 legislativas"]}
    coordinates={[[[[-62, -38], [-61, -38], [-61, -37], [-62, -38]]]]} name="Coronel Rosales" fetchedAt="2026-09-24T03:29:24Z" sha256={SHA}
    swing={{ unitId: "02/027", flipped: false, shares2023: [{ party: "lla", votes: 40, sharePercent: 40 }], shares2025: [{ party: "lla", votes: 60, sharePercent: 60 }], swings: [{ party: "lla", swingPercentPoints: 20 }] }}
    leftNames={{ lla: "LLA" }} rightNames={{ lla: "LLA" }} party="lla" metric="Participación" onMetric={() => {}} />);
  expect(html.replace(/<details\b[\s\S]*?<\/details>/g, "")).not.toContain("SHA-256");
  expect(html).toMatch(new RegExp(`<details[^>]*><summary>Procedencia de la geometría</summary>SHA-256 (?:<!-- -->)?${SHA}`));
  expect(html).toContain("archivada el");
});
