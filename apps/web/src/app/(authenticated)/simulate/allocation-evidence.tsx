import type { ReactNode } from "react";
import { TableScroll } from "@/components/TableScroll";
import { UNMODELED_VOTE_REASON } from "@/domain/seat-allocation/source-coverage";
import {
  THRESHOLD_POLICY,
  type AllocationResult,
  type DhondtAllocationResult,
  type HareAllocationResult,
  type SeatAward,
  type UnmodeledVoteBreakdownEntry,
} from "@/domain/seat-allocation/types";

const UNMODELED_VOTE_REASON_LABEL: Record<
  UnmodeledVoteBreakdownEntry["reason"],
  string
> = {
  [UNMODELED_VOTE_REASON.OMITTED_NON_QUALIFYING_LISTS]:
    "Listas no clasificadas omitidas",
  [UNMODELED_VOTE_REASON.OTHER_SOURCE_ROWS]: "Otras filas de la fuente",
};

const ALLOCATION_TABLE_VARIANT = {
  COMPACT: "compact",
  STANDARD: "standard",
  WIDE: "wide",
} as const;

type AllocationTableVariant =
  (typeof ALLOCATION_TABLE_VARIANT)[keyof typeof ALLOCATION_TABLE_VARIANT];

const TABLE_COLUMN_KIND = {
  EVIDENCE: "evidence",
  IDENTITY: "identity",
  NUMBER: "number",
  SHORT: "short",
} as const;

type TableColumnKind =
  (typeof TABLE_COLUMN_KIND)[keyof typeof TABLE_COLUMN_KIND];

interface EvidenceTableProps {
  caption: string;
  headers: string;
  rows: ReactNode[][];
  variant: AllocationTableVariant;
  columnKinds: readonly TableColumnKind[];
}

    function formatNumber(value: number): string {
      if (Number.isInteger(value)) return value.toLocaleString("es-AR");
      return value.toLocaleString("es-AR", {
        maximumFractionDigits: 20,
        useGrouping: false,
      });
    }

    const AWARDED_BY_LABEL: Record<SeatAward["awardedBy"], string> = {
      cuociente_division: "división por cociente", largest_remainder: "mayor residuo", halving: "reducción sucesiva a la mitad", dhondt_quotient: "cociente D’Hondt", tie_break: "desempate",
    };
    const EVIDENCE_VALUE_LABEL: Record<string, string> = {
      cuociente: "cociente", divisor: "divisor", quotient: "cociente", rawVotes: "votos sin procesar", remainder: "residuo", votes: "votos",
    };
    const TIE_BREAK_RULE_LABEL: Record<string, string> = {
      "Equal remainder resolved by higher raw vote total": "El residuo igual se resolvió por el mayor total de votos sin procesar",
      "Equal remainder and equal vote total resolved by lower list id": "El residuo y el total de votos iguales se resolvieron por el menor ID de lista",
      "Equal votes at the Art. 110 seat cap resolved by lower list id": "Los votos iguales en el límite de bancas del art. 110 se resolvieron por el menor ID de lista",
      "Equal quotient resolved by higher raw vote total": "El cociente igual se resolvió por el mayor total de votos sin procesar",
      "Equal quotient and equal vote total resolved by lower list id": "El cociente y el total de votos iguales se resolvieron por el menor ID de lista",
    };
    const TIE_BREAK_CITATION_LABEL: Record<string, string> = {
      "Ley 5109 Art. 109(c) does not resolve equal remainders with equal vote totals": "La Ley 5109, art. 109(c), no resuelve residuos iguales con totales de votos iguales",
      "Ley 5109 Art. 110 does not resolve equal vote totals at the seat cap": "La Ley 5109, art. 110, no resuelve totales de votos iguales en el límite de bancas",
      "Ley 19.945 Art. 161(c) resolves this case by sorteo, which the system does not perform": "La Ley 19.945, art. 161(c), resuelve este caso por sorteo, que el sistema no realiza",
    };
    const awardedByLabel = (value: SeatAward["awardedBy"]) => AWARDED_BY_LABEL[value];
    const evidenceValueLabel = (value: string) => EVIDENCE_VALUE_LABEL[value] ?? value;
    const tieBreakRuleLabel = (value: string) => TIE_BREAK_RULE_LABEL[value] ?? value;
    const tieBreakBasisLabel = (value: "statutory" | "simulation_convention") => value === "statutory" ? "criterio legal" : "convención de simulación";
    const tieBreakCitationLabel = (value: string) => TIE_BREAK_CITATION_LABEL[value] ?? value;

function tableCellClass(kind: TableColumnKind): string {
  return kind === TABLE_COLUMN_KIND.EVIDENCE
    ? "evidence-text"
    : `table-cell--${kind}`;
}

function tableRowHeaderClass(kind: TableColumnKind): string | undefined {
  return kind === TABLE_COLUMN_KIND.EVIDENCE
    ? undefined
    : tableCellClass(kind);
}

function EvidenceTable({
  caption,
  headers,
  rows,
  variant,
  columnKinds,
}: EvidenceTableProps) {
  const headerLabels = headers.split("|");

  return (
    <TableScroll label={caption}>
      <table className={`data-table data-table--allocation-${variant}`}>
        <caption>{caption}</caption>
        <colgroup>
          {headerLabels.map((header, index) => {
            const kind = columnKinds[index] ?? TABLE_COLUMN_KIND.EVIDENCE;
            return (
              <col
                className={`allocation-column allocation-column--${kind}`}
                key={`${header}-${index}`}
              />
            );
          })}
        </colgroup>
        <thead>
          <tr>
            {headerLabels.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label, ...cells]) => (
            <tr key={String(key)}>
              <th
                className={tableRowHeaderClass(
                  columnKinds[0] ?? TABLE_COLUMN_KIND.EVIDENCE,
                )}
                scope="row"
              >
                {label}
              </th>
              {cells.map((cell, index) => (
                <td
                  className={tableCellClass(
                    columnKinds[index + 1] ?? TABLE_COLUMN_KIND.EVIDENCE,
                  )}
                  key={index}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function listNames(result: AllocationResult): Map<string, string> {
  return new Map(result.results.map((entry) => [entry.listId, entry.listName]));
}

interface AwardTableProps {
  awards: SeatAward[];
  caption: string;
  names: Map<string, string>;
}

function AwardTable({ awards, caption, names }: AwardTableProps) {
  return (
    <EvidenceTable
      caption={caption}
      headers="Banca|Lista|Regla de asignación|Evidencia numérica|Evidencia de desempate"
      variant={ALLOCATION_TABLE_VARIANT.WIDE}
      columnKinds={[
        TABLE_COLUMN_KIND.SHORT,
        TABLE_COLUMN_KIND.IDENTITY,
        TABLE_COLUMN_KIND.EVIDENCE,
        TABLE_COLUMN_KIND.EVIDENCE,
        TABLE_COLUMN_KIND.EVIDENCE,
      ]}
      rows={awards.map((award, index) => [
        `${award.listId}-${index}`,
        `Banca ${index + 1}`,
        names.get(award.listId) ?? `sin mapear (lista ${award.listId})`,
        awardedByLabel(award.awardedBy),
        Object.entries(award.values)
          .map(([name, value]) => `${evidenceValueLabel(name)}: ${formatNumber(value)}`)
          .join("; "),
        award.tieBreak
          ? `${tieBreakRuleLabel(award.tieBreak.rule)}; ${tieBreakBasisLabel(award.tieBreak.basis)}; ${tieBreakCitationLabel(award.tieBreak.citation)}`
          : "No requerido",
      ])}
    />
  );
}

function HareEvidence({ result }: { result: HareAllocationResult }) {
  const names = listNames(result);
  const capLosers = result.seatCap?.excludedListIds ?? [];
  const voteTotals = result.voteTotals;

  return (
    <section aria-labelledby="hare-evidence-heading">
      <h3 id="hare-evidence-heading">Cociente Hare con mayor residuo</h3>
      <p>
        Método legal: <strong>Ley 5109, arts. 109–110</strong> (niveles municipal
        y provincial de PBA).
      </p>
      <dl>
        <dt>Base de votos válidos</dt>
        <dd>
          {voteTotals.kind === "reported_breakdown" ? (
            <>
              {formatNumber(result.validVotes)} ={" "}
              {formatNumber(voteTotals.totalVotes)} total −{" "}
              {formatNumber(voteTotals.blankVotes)} en blanco −{" "}
              {formatNumber(voteTotals.annulledVotes)} anulados
            </>
          ) : voteTotals.kind === "combined_blank_and_annulled" ? (
            <>
              {formatNumber(result.validVotes)} ={" "}
              {formatNumber(voteTotals.totalVotes)} total −{" "}
              {formatNumber(voteTotals.combinedBlankAndAnnulledVotes)} en blanco
              y anulados combinados
            </>
          ) : (
            <>
              {formatNumber(voteTotals.validVotes)} votos válidos; no se informaron
              los valores totales, en blanco y anulados
            </>
          )}
        </dd>
        <dt>Bancas por asignar</dt>
        <dd>{formatNumber(result.seatsToFill)}</dd>
        <dt>Cociente inicial</dt>
        <dd>{formatNumber(result.initialCuociente)}</dd>
        <dt>Cociente Hare</dt>
        <dd>
          {formatNumber(result.cuociente)} después de {result.halvingIterations}{" "}
          {result.halvingIterations === 1 ? "reducción a la mitad" : "reducciones a la mitad"}
        </dd>
      </dl>

      <EvidenceTable
        caption="Asignación Hare por lista"
        headers="Lista|Votos|Cociente sin redondear|Bancas iniciales por cociente|Bancas después del límite|Residuo exacto|Bancas por residuo|Total de bancas"
        variant={ALLOCATION_TABLE_VARIANT.WIDE}
        columnKinds={[
          TABLE_COLUMN_KIND.IDENTITY,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
        ]}
        rows={result.results.map((entry) => [
          entry.listId,
          entry.listName,
          formatNumber(entry.votes),
          formatNumber(entry.quotient),
          entry.initialSeatsByCuociente,
          entry.seatsByCuociente,
          formatNumber(entry.remainder),
          entry.seatsByResidue,
          entry.totalSeats,
        ])}
      />

      {result.halvingSteps.length > 0 ? (
        <EvidenceTable
          caption="Rastreo de reducciones del cociente Hare"
          headers="Paso|Cociente|Listas que alcanzan el cociente"
          variant={ALLOCATION_TABLE_VARIANT.COMPACT}
          columnKinds={[
            TABLE_COLUMN_KIND.SHORT,
            TABLE_COLUMN_KIND.NUMBER,
            TABLE_COLUMN_KIND.EVIDENCE,
          ]}
          rows={result.halvingSteps.map((step) => [
            String(step.iteration),
            `Iteración ${step.iteration}`,
            formatNumber(step.cuociente),
            step.qualifyingListIds.length > 0
              ? step.qualifyingListIds
                  .map(
                    (listId) =>
                      names.get(listId) ?? `sin mapear (lista ${listId})`,
                  )
                  .join(", ")
              : "Ninguna lista clasificó",
          ])}
        />
      ) : null}

      {result.seatCap ? (
        <section aria-labelledby="seat-cap-heading">
          <h4 id="seat-cap-heading">Listas excluidas por el límite de bancas</h4>
          {result.seatCap.tieBreak ? (
            <p>
              Empate en el límite: {tieBreakRuleLabel(result.seatCap.tieBreak.rule)};{" "}
              {tieBreakBasisLabel(result.seatCap.tieBreak.basis)};{" "}
              {tieBreakCitationLabel(result.seatCap.tieBreak.citation)}
            </p>
          ) : null}
          {capLosers.length > 0 ? (
            <ul>
              {capLosers.map((listId) => (
                <li key={listId}>
                  {names.get(listId) ?? `sin mapear (lista ${listId})`}:{" "}
                  {formatNumber(
                    result.results.find((entry) => entry.listId === listId)
                      ?.votes ?? 0,
                  )}
                  votos; clasificó, pero no recibió una banca porque solo había{" "}
                  {result.seatCap?.availableSeats} bancas disponibles
                </li>
              ))}
            </ul>
          ) : (
            <p>El límite de bancas no excluyó ninguna lista clasificada.</p>
          )}
        </section>
      ) : null}

      <AwardTable
        awards={result.seatAwards}
        caption="Evidencia de asignación por banca"
        names={names}
      />
    </section>
  );
}

function DhondtEvidence({ result }: { result: DhondtAllocationResult }) {
  const names = listNames(result);
  const votes = new Map(
    result.results.map((entry) => [entry.listId, entry.votes]),
  );

  return (
    <section aria-labelledby="dhondt-evidence-heading">
      <h3 id="dhondt-evidence-heading">D’Hondt</h3>
      <p>
        Método legal: <strong>Ley 19.945, arts. 160–161</strong> (nivel
        nacional).
      </p>
      <p>
        <strong>
          {result.thresholdPolicy === THRESHOLD_POLICY.STATUTORY
            ? "Base legal del umbral:"
            : "Base del umbral definida por el escenario:"}
        </strong>{" "}
        {formatNumber(result.thresholdPercent)}% del padrón{" "}
        {formatNumber(result.padron)} = {formatNumber(result.thresholdVotes)}{" "}
        votos.
      </p>
      {result.thresholdPolicy === THRESHOLD_POLICY.SCENARIO ? (
        <p role="note">
          Política del escenario proyectado; no es el umbral histórico legal.
        </p>
      ) : null}

      <EvidenceTable
        caption="Resultado del umbral nacional por lista"
        headers="Lista|Votos|Porcentaje del padrón|Resultado del umbral|Bancas"
        variant={ALLOCATION_TABLE_VARIANT.STANDARD}
        columnKinds={[
          TABLE_COLUMN_KIND.IDENTITY,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.EVIDENCE,
          TABLE_COLUMN_KIND.NUMBER,
        ]}
        rows={result.results.map((entry) => [
          entry.listId,
          entry.listName,
          formatNumber(entry.votes),
          `${formatNumber(entry.votingSharePercent)}%`,
          entry.excludedByThreshold
            ? `excluida: ${formatNumber(entry.votes)} votos están por debajo de ${formatNumber(result.thresholdVotes)}`
            : "incluida en D’Hondt",
          entry.seats,
        ])}
      />

      <EvidenceTable
        caption="Tabla de cocientes D’Hondt"
        headers="Lista|Votos|Divisor|Cociente"
        variant={ALLOCATION_TABLE_VARIANT.COMPACT}
        columnKinds={[
          TABLE_COLUMN_KIND.IDENTITY,
          TABLE_COLUMN_KIND.NUMBER,
          TABLE_COLUMN_KIND.SHORT,
          TABLE_COLUMN_KIND.NUMBER,
        ]}
        rows={result.quotientTable.map((entry) => [
          `${entry.listId}-${entry.divisor}`,
          names.get(entry.listId) ?? `sin mapear (lista ${entry.listId})`,
          formatNumber(votes.get(entry.listId) ?? 0),
          `Divisor ${entry.divisor}`,
          formatNumber(entry.quotient),
        ])}
      />

      <AwardTable
        awards={result.seatAwards}
        caption="Cocientes ganadores ordenados"
        names={names}
      />
    </section>
  );
}

export function AllocationEvidence({ result }: { result: AllocationResult }) {
  const coverage = result.coverage;
  const coverageNote = !coverage.complete
    ? `Cobertura de votos incompleta: ${formatNumber(coverage.uncoveredVotes)} votos no están en las listas ni se declararon explícitamente fuera del modelo; son datos de un escenario, no evidencia histórica oficial.`
    : result.isProjection
      ? "Datos de un escenario proyectado, no evidencia histórica oficial."
      : undefined;
  return (
    <>
      <section aria-labelledby="vote-coverage-heading">
        <h3 id="vote-coverage-heading">Cobertura de votos</h3>
        <p>
          {formatNumber(coverage.basisVotes)} votos de base ={" "}
          {formatNumber(coverage.listedVotes)} incluidos en listas +{" "}
          {formatNumber(coverage.unmodeledVotes)} explícitamente fuera del modelo.
        </p>
        {coverage.unmodeledVoteBreakdown.length > 0 ? (
          <ul aria-label="Desglose de votos fuera del modelo">
            {coverage.unmodeledVoteBreakdown.map((entry) => (
              <li key={entry.reason}>
                {UNMODELED_VOTE_REASON_LABEL[entry.reason]}:{" "}
                {formatNumber(entry.votes)} votos
              </li>
            ))}
          </ul>
        ) : null}
        {coverageNote ? <p role="note">{coverageNote}</p> : null}
      </section>
      {result.level === "national" ? (
        <DhondtEvidence result={result} />
      ) : (
        <HareEvidence result={result} />
      )}
    </>
  );
}
