import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { OfficialSectionCircuitOutcomes } from "@/lib/workspace/official-section-circuit-outcomes";
import { CircuitOutcomes } from "./CircuitOutcomes";

const outcomes: OfficialSectionCircuitOutcomes = {
  status: "ok", authorization_status: "authorized", source_kind: "official", level: "seccion", truncated: false,
  circuit_membership: "known", category_applicability: "district_reported_categories",
  unassigned: { catalogue_mesas_without_membership: 0, membership_quarantined_mesas: 0, membership_quarantine_reasons: {}, completeness_quarantines: 0, completeness_quarantine_reasons: {}, unexpected_status_mesas: 0 },
  circuits: ["00248", "00249"].map(circuito_code => ({ circuito_code, positive_total: 100, status: "complete", counts: { expected: 1, counted: 1, not_counted: 0, missing: 0, unexpected: 0, quarantined: 0 }, parties: [{ identity_status: "canonical", canonical_party_id: "p6", display_name: "Grupo 6", list_id: null, votes: 70 }, { identity_status: "canonical", canonical_party_id: "p5", display_name: "Grupo 5", list_id: null, votes: 30 }] })),
};

it("shows a circuit code once when the source names the circuit by its code (#452)", () => {
  const html = renderToStaticMarkup(<CircuitOutcomes outcomes={outcomes} rosales circuitNames={{ "00248": "00248", "00249": "Sur" }} view="table" />);
  expect(html).not.toContain("— 00248");
  expect(html).toContain("<span> — Sur</span>");
});

it("labels circuit status in Spanish and keeps the per-reason counters in a disclosure (#612)", () => {
  const html = renderToStaticMarkup(<CircuitOutcomes outcomes={outcomes} rosales view="table" />);
  expect(html).not.toMatch(/>complete</);
  expect(html).not.toContain("<td>complete");
  expect(html).toContain("<td>Completo<details><summary>Detalle de mesas</summary>no escrutadas: 0; sin estado: 0; inesperadas: 0; cuarentena: 0</details></td>");
});
