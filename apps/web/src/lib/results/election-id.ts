/**
 * The election year an id declares.
 *
 * ONE boundary, because three pages derived this three ways: a `yearOf`
 * helper returning `null`, an inline `Number(...)` guarded by
 * `Number.isInteger`, and an inline `Number(...)` compared with `!==` against
 * `NaN`. Three implementations, three miss-behaviours — the shape rule 8
 * records as "the same padding bug in two independent functions".
 *
 * The year is not cosmetic: it selects the party mapping, and the mapping is
 * what stops `135`, `20135` and `110` from reading as three different parties.
 *
 * The year is NOT the whole story, and this states the limit rather than
 * assuming it away: `2023-paso` and `2023-generales` both answer `2023`, and
 * `PartyMappingContext` carries no round. AGENTS.md records that one party is
 * `135` in the 2023 PASO and `20135` in the 2023 generales, so those two rounds
 * resolve through ONE `(year, jurisdiction, category)` mapping. That is safe
 * only while `curated/party_map.yaml` keeps a list id from meaning two
 * different parties across rounds of one year -- enforced by the
 * database: migration 0005 declares `unique (year, jurisdiction, category,
 * list_id)` on `party_mapping`, so one id cannot carry two meanings inside a
 * year, and `validate-curated` reports any archived id the table does not
 * cover. If a round ever needs its own mapping, the round
 * belongs in `PartyMappingContext`, not in a wider year regex.
 *
 * Requires the id to START with the year, so an id like `2023-2025-comparativa`
 * is refused rather than silently resolved to whichever four digits came
 * first. Verified against the ids this deployment registers:
 * `2023-paso`, `2023-generales`, `2023-balotaje`, `2023-municipal`,
 * `2025-legislativas-nacional`, `2025-municipal`.
 */
export function electionYear(electionId: string | undefined): number | null {
  if (!electionId) return null;
  const match = /^(\d{4})(?:-|$)/.exec(electionId);
  if (!match?.[1]) return null;
  // A SECOND four-digit run means the id names more than one year, and this
  // function cannot say which one selects the mapping. Refused rather than
  // resolved to whichever came first.
  if ((electionId.match(/\d{4}/g) ?? []).length > 1) return null;
  return Number(match[1]);
}
