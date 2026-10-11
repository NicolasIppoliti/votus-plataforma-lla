import { TableRegion } from "@/components/TableRegion";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExactShare, OfficialInternalLists } from "@/lib/workspace/official-internal-lists";

const share = (value: ExactShare | null) => value === null ? "No disponible" : `${(value.numerator / value.denominator * 100).toFixed(2)}%`;
const states: Record<string, string> = {
  authorization_denied: "Acceso denegado a las internas de esta selección.",
  no_rows: "La consulta autorizada no encontró listas internas.",
  source_unavailable: "Las internas no están disponibles para esta fuente.",
  unavailable: "Las internas no están disponibles. Volvé a intentar la selección.",
  selection_invalid: "Se rechazó la selección de internas.",
  payload_too_large: "Se rechazó la evidencia de internas: excede el límite seguro. No se muestran cifras parciales.",
  malformed: "Se rechazó la evidencia de internas: no superó la validación de integridad.",
};

export function InternalLists({ evidence }: { evidence: OfficialInternalLists }) {
  if (evidence.status !== "ok") return <section aria-labelledby="internas-heading"><h2 id="internas-heading">Internas</h2>
    <p role={evidence.status === "authorization_denied" || evidence.status === "malformed" ? "alert" : "status"}>{states[evidence.status]}</p></section>;
  const groups = new Map<string | null, typeof evidence.lists>();
  for (const list of evidence.lists) {
    const group = groups.get(list.canonical_party_id) ?? [];
    group.push(list); groups.set(list.canonical_party_id, group);
  }
  return <section aria-labelledby="internas-heading">
    <h2 id="internas-heading">Internas</h2>
    <p>Fuente: oficial · Nivel: sección · Granularidad: {evidence.source_granularity}.</p>
    <p>Base de porcentajes: votos positivos de la selección ({evidence.positive_total} votos), no todos los votos emitidos.</p>
    <TableRegion label="Internas: votos y porcentajes por agrupación">
      <Table className="data-table">
        <TableCaption>Internas: votos y porcentajes por agrupación</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">Lista interna</TableHead><TableHead scope="col">Votos</TableHead><TableHead scope="col">Dentro de la agrupación</TableHead><TableHead scope="col">De los positivos</TableHead></TableRow></TableHeader>
        {Array.from(groups, ([id, lists]) => <TableBody key={id ?? "unmapped"}>
          <TableRow><TableHead scope="rowgroup" colSpan={4}>{lists[0]?.display_name ?? "Agrupación sin mapear"}{lists[0]?.singleList ? " · Lista única" : ""}</TableHead></TableRow>
          {lists.map((list, index) => <TableRow key={list.list_id ?? index}>
            <TableHead scope="row">{list.label}</TableHead><TableCell>{list.votes} votos</TableCell>
            <TableCell>{share(list.withinParty)}</TableCell><TableCell>{share(list.ofPositive)}</TableCell>
          </TableRow>)}
        </TableBody>)}
      </Table>
    </TableRegion>
    <p role="note">Votos no positivos (blancos, nulos, impugnados, recurridos y comando): No disponible. La ingesta nacional no persiste estos tipos de voto; no equivalen a cero.</p>
  </section>;
}
