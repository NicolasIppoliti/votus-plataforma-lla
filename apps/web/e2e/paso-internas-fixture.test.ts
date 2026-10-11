import { expect, it } from "vitest";
import { pasoInternasFixture as fixture, pasoMesaRows, pasoSectionPayload } from "./paso-internas-fixture";
it("retains source strings and complete section totals, not sample totals", () => {
  expect(fixture.mesa_count).toBe(151);
  expect(pasoSectionPayload().positive_total).toBe(33250);
  expect(fixture.section_lists.map((l) => `${l.list_id}:${l.votes}`)).toEqual([
    "13-3017:115", "131-3002:1", "131-3003:0", "131-3004:0", "132-3007:3997", "132-3008:8698",
    "133-3001:436", "134-3005:3879", "134-3006:1375", "135-3016:13206", "136-3009:413", "136-3010:131",
    "137-3011:323", "20-3018:1", "40-3019:203", "57-3025:104", "90-3026:33", "90-3027:69",
    "92-3020:64", "94-3022:141", "94-3023:1", "94-3024:0", "95-3021:60",
  ]);
  expect(pasoMesaRows).toHaveLength(16);
  expect(pasoMesaRows.every((r) => r["distrito_id"] === "2" && r["seccion_id"] === "27" && r["cargo_id"] === "1" && r["votos_tipo"] === "POSITIVO")).toBe(true);
  expect(new Set(pasoMesaRows.map((r) => `${r["circuito_id"]}:${r["mesa_id"]}`)).size).toBe(2);
  expect(pasoMesaRows.some((r) => r["votos_cantidad"] === "0")).toBe(true);
  expect(fixture.provenance.sha256).toBe("25558e7b73e8c273726ea12f04040e2fac8e693ad0eb866386502eb112bd2c0c");
});
