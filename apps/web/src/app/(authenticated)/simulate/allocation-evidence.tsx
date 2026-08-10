import type { ReactNode } from "react";
import {
  THRESHOLD_POLICY,
  type AllocationResult,
  type DhondtAllocationResult,
  type HareAllocationResult,
  type SeatAward,
} from "@/domain/seat-allocation/types";

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toString();
}

function EvidenceTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string;
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {headers.split("|").map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label, ...cells]) => (
            <tr key={String(key)}>
              <th scope="row">{label}</th>
              {cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      headers="Seat|List|Award rule|Numeric evidence|Tie-break evidence"
      rows={awards.map((award, index) => [
        `${award.listId}-${index}`,
        `Seat ${index + 1}`,
        names.get(award.listId) ?? `unmapped (list ${award.listId})`,
        award.awardedBy,
        Object.entries(award.values)
          .map(([name, value]) => `${name}: ${formatNumber(value)}`)
          .join("; "),
        award.tieBreak
          ? `${award.tieBreak.rule}; ${award.tieBreak.basis}; ${award.tieBreak.citation}`
          : "Not required",
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
      <h3 id="hare-evidence-heading">Hare quota with largest remainder</h3>
      <p>
        Statutory method: <strong>Ley 5109 Arts. 109–110</strong> (PBA municipal
        and provincial levels).
      </p>
      <dl>
        <dt>Valid-vote basis</dt>
        <dd>
          {voteTotals.kind === "reported_breakdown" ? (
            <>
              {formatNumber(result.validVotes)} ={" "}
              {formatNumber(voteTotals.totalVotes)} total −{" "}
              {formatNumber(voteTotals.blankVotes)} blank −{" "}
              {formatNumber(voteTotals.annulledVotes)} annulled
            </>
          ) : voteTotals.kind === "combined_blank_and_annulled" ? (
            <>
              {formatNumber(result.validVotes)} ={" "}
              {formatNumber(voteTotals.totalVotes)} total −{" "}
              {formatNumber(voteTotals.combinedBlankAndAnnulledVotes)} combined
              blank and annulled
            </>
          ) : (
            <>
              {formatNumber(voteTotals.validVotes)} valid votes; total, blank,
              and annulled values were not reported
            </>
          )}
        </dd>
        <dt>Seats being allocated</dt>
        <dd>{formatNumber(result.seatsToFill)}</dd>
        <dt>Initial cuociente</dt>
        <dd>{formatNumber(result.initialCuociente)}</dd>
        <dt>Hare cuociente</dt>
        <dd>
          {formatNumber(result.cuociente)} after {result.halvingIterations}{" "}
          halving iteration(s)
        </dd>
      </dl>

      <EvidenceTable
        caption="Hare allocation by list"
        headers="List|Votes|Raw quotient|Initial quotient seats|Seats after cap|Exact remainder|Seats by remainder|Total seats"
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
          caption="Hare halving trace"
          headers="Step|Cuociente|Lists reaching the cuociente"
          rows={result.halvingSteps.map((step) => [
            String(step.iteration),
            `Iteration ${step.iteration}`,
            formatNumber(step.cuociente),
            step.qualifyingListIds.length > 0
              ? step.qualifyingListIds
                  .map(
                    (listId) =>
                      names.get(listId) ?? `unmapped (list ${listId})`,
                  )
                  .join(", ")
              : "No list qualified",
          ])}
        />
      ) : null}

      {result.seatCap ? (
        <section aria-labelledby="seat-cap-heading">
          <h4 id="seat-cap-heading">Seat-cap losers</h4>
          {result.seatCap.tieBreak ? (
            <p>
              Boundary tie: {result.seatCap.tieBreak.rule};{" "}
              {result.seatCap.tieBreak.basis};{" "}
              {result.seatCap.tieBreak.citation}
            </p>
          ) : null}
          {capLosers.length > 0 ? (
            <ul>
              {capLosers.map((listId) => (
                <li key={listId}>
                  {names.get(listId) ?? `unmapped (list ${listId})`}:{" "}
                  {formatNumber(
                    result.results.find((entry) => entry.listId === listId)
                      ?.votes ?? 0,
                  )}
                  votes; qualified but received no seat because only{" "}
                  {result.seatCap?.availableSeats} seats were available
                </li>
              ))}
            </ul>
          ) : (
            <p>No qualifying list was excluded by the seat cap.</p>
          )}
        </section>
      ) : null}

      <AwardTable
        awards={result.seatAwards}
        caption="Per-seat award evidence"
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
        Statutory method: <strong>Ley 19.945 Arts. 160–161</strong> (national
        level).
      </p>
      <p>
        <strong>
          {result.thresholdPolicy === THRESHOLD_POLICY.STATUTORY
            ? "Statutory threshold basis:"
            : "Scenario policy threshold basis:"}
        </strong>{" "}
        {formatNumber(result.thresholdPercent)}% of padrón{" "}
        {formatNumber(result.padron)} = {formatNumber(result.thresholdVotes)}{" "}
        votes.
      </p>
      {result.thresholdPolicy === THRESHOLD_POLICY.SCENARIO ? (
        <p role="note">
          Projection scenario policy; not the statutory historical threshold.
        </p>
      ) : null}

      <EvidenceTable
        caption="National threshold outcome by list"
        headers="List|Votes|Padrón share|Threshold outcome|Seats"
        rows={result.results.map((entry) => [
          entry.listId,
          entry.listName,
          formatNumber(entry.votes),
          `${formatNumber(entry.votingSharePercent)}%`,
          entry.excludedByThreshold
            ? `excluded: ${formatNumber(entry.votes)} votes are below ${formatNumber(result.thresholdVotes)}`
            : "included in D’Hondt",
          entry.seats,
        ])}
      />

      <EvidenceTable
        caption="D’Hondt quotient table"
        headers="List|Votes|Divisor|Quotient"
        rows={result.quotientTable.map((entry) => [
          `${entry.listId}-${entry.divisor}`,
          names.get(entry.listId) ?? `unmapped (list ${entry.listId})`,
          formatNumber(votes.get(entry.listId) ?? 0),
          `Divisor ${entry.divisor}`,
          formatNumber(entry.quotient),
        ])}
      />

      <AwardTable
        awards={result.seatAwards}
        caption="Ordered winning quotients"
        names={names}
      />
    </section>
  );
}

export function AllocationEvidence({ result }: { result: AllocationResult }) {
  const coverage = result.coverage;
  const coverageNote = !coverage.complete
    ? `Incomplete vote coverage: ${formatNumber(coverage.uncoveredVotes)} votes are neither listed nor explicitly unmodeled; this is scenario input, not official historical evidence.`
    : result.isProjection
      ? "Projection scenario input, not official historical evidence."
      : undefined;
  return (
    <>
      <section aria-labelledby="vote-coverage-heading">
        <h3 id="vote-coverage-heading">Vote coverage</h3>
        <p>
          {formatNumber(coverage.basisVotes)} basis votes ={" "}
          {formatNumber(coverage.listedVotes)} listed +{" "}
          {formatNumber(coverage.unmodeledVotes)} explicitly unmodeled.
        </p>
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
