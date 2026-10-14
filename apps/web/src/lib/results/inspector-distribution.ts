import type { ExplorationParty } from "./exploration";

/** Compact official summary: top four by votes, all unresolved identities, canonical remainder. */
export function inspectorDistribution(parties: readonly ExplorationParty[]) {
  const ranked = [...parties].sort((a, b) => b.votes - a.votes);
  const visible = ranked.filter((party, index) => index < 4 || party.identityStatus !== "canonical");
  const remainder = ranked.filter((party, index) => index >= 4 && party.identityStatus === "canonical");
  const rows = visible.map(party => ({
    name: party.identityStatus === "canonical" ? party.displayName : `Lista sin mapear ${party.listId ?? "(ID de lista no disponible)"}`,
    grouped: false,
    votes: party.votes,
    share: party.voteShare === null ? null : Number(party.voteShare) * 100,
    canonicalPartyId: party.canonicalPartyId,
  }));
  if (remainder.length) rows.push({
    name: `Otras agrupaciones (${remainder.length})`,
    grouped: true,
    votes: remainder.reduce((sum, party) => sum + party.votes, 0),
    share: remainder.some(party => party.voteShare === null) ? null : remainder.reduce((sum, party) => sum + Number(party.voteShare) * 100, 0),
    canonicalPartyId: null,
  });
  return rows;
}
