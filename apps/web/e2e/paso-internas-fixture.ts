import { createRequire } from "node:module";
const fixture = createRequire(import.meta.url)("./fixtures/paso-2023-rosales-presidente.json") as typeof import("./fixtures/paso-2023-rosales-presidente.json");

/** Source strings are untouched; normalized jurisdiction codes belong to the ETL. */
export const pasoInternasFixture = fixture;
export const pasoMesaRows: ReadonlyArray<Readonly<Record<string, string>>> = fixture.rows.map(
  (values) => Object.fromEntries(fixture.columns.map((column, index) => [column, values[index]!])),
);
export function pasoSectionPayload() {
  return {
    status: "ok", authorization_status: "authorized", source_kind: "official",
    level: "seccion", source_granularity: "mesa", category_name: "PRESIDENTE/A",
    positive_total: fixture.section_lists.reduce((total, list) => total + list.votes, 0),
    truncated: false,
    non_positive: { status: "unavailable", reason: "not_reloaded" },
    // Archive names are evidence, not a substitute for curated canonical identity.
    lists: fixture.section_lists.map((list) => ({
      list_id: list.list_id, source_name: list.source_name, votes: list.votes,
      canonical_party_id: null, display_name: null, identity_status: "unmapped",
    })),
  };
}
