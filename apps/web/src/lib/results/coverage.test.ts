import { describe, expect, it } from "vitest";
import {
  CoverageContractError,
  ResultsCoverageRepository,
  type CoverageSelection,
} from "./coverage";

const SELECTION: CoverageSelection = {
  electionId: "20000000-0000-0000-0000-000000000001",
  categoryId: "20000000-0000-0000-0000-000000000003",
  distritoCode: "02",
  seccionCode: "027",
};

function successPayload() {
  return {
    status: "ok",
    source_kind: "fiscalizacion",
    is_random_sample: false,
    election_year: 2025,
    election_round: "legislativas",
    distrito_code: "02",
    seccion_code: "027",
    mesas_coverage: { observed_units: 1, denominator_units: 2, is_random_sample: false },
    mesas: [
      { code: 1, circuito_code: "00001", establecimiento_code: "E1",
        establecimiento_name: "Fixture school", covered: true,
        official_result_href: null },
      { code: 2, circuito_code: "00001", establecimiento_code: "E1",
        establecimiento_name: "Fixture school", covered: false,
        official_result_href: null },
    ],
    escuelas: { status: "available", exclusions: [], items: [{ circuito_code: "00001", code: "E1",
      name: "Fixture school", observed_units: 1, denominator_units: 2,
      is_random_sample: false,
      official_archive_entry_ids: ["national/2025-legislativas"] }] },
    source_audit: [{ kind: "fiscalizacion", rows: 1, votes: 999, mesas: 1 }],
    denominator_audit: [{ kind: "official", rows: 4, votes: 300, mesas: 2 }],
    exclusions: [],
    provenance: {
      official_archive_entry_ids: ["national/2025-legislativas"],
      fiscalizacion_archive_entry_ids: ["fiscalizacion/runtime"],
    },
  };
}

function repository(payload: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    value: new ResultsCoverageRepository({
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve({ data: payload, error: null });
      },
    }),
  };
}

describe("fiscalizacion coverage repository", () => {
  it("returns covered and uncovered mesas with a scope-derived denominator", async () => {
    const fixture = repository(successPayload());
    const result = await fixture.value.coverage(SELECTION);

    expect(result).toMatchObject({
      status: "ok",
      sourceKind: "fiscalizacion",
      isRandomSample: false,
      mesasCoverage: { observedUnits: 1, denominatorUnits: 2, isRandomSample: false },
      mesas: [{ code: 1, covered: true }, { code: 2, covered: false }],
    });
    expect(fixture.calls).toEqual([{ name: "results_exploration_coverage", args: {
      p_election_id: SELECTION.electionId,
      p_category_id: SELECTION.categoryId,
      p_distrito_code: "02",
      p_seccion_code: "027",
    } }]);
  });

  it("carries partial school coverage and literal non-random evidence", async () => {
    const result = await repository(successPayload()).value.coverage(SELECTION);
    expect(result).toMatchObject({ status: "ok", escuelas: { status: "available", items: [{
      code: "E1", observedUnits: 1, denominatorUnits: 2, isRandomSample: false,
    }] } });
  });

  it("keeps one establecimiento code separate in every circuito", async () => {
    const payload = successPayload();
    payload.mesas[1]!.circuito_code = "00002";
    payload.mesas[1]!.establecimiento_name = "Other fixture school";
    payload.mesas.push({ code: 3, circuito_code: "00003", establecimiento_code: "E1",
      establecimiento_name: "Fixture school", covered: true, official_result_href: null });
    payload.mesas_coverage = { observed_units: 2, denominator_units: 3, is_random_sample: false };
    payload.source_audit = [{ kind: "fiscalizacion", rows: 2, votes: 1_776, mesas: 2 }];
    payload.denominator_audit = [{ kind: "official", rows: 5, votes: 320, mesas: 3 }];
    payload.escuelas.items = [
      { circuito_code: "00001", code: "E1", name: "Fixture school",
        observed_units: 1, denominator_units: 1, is_random_sample: false,
        official_archive_entry_ids: ["national/2025-legislativas"] },
      { circuito_code: "00002", code: "E1", name: "Other fixture school",
        observed_units: 0, denominator_units: 1, is_random_sample: false,
        official_archive_entry_ids: ["national/2025-legislativas"] },
      { circuito_code: "00003", code: "E1", name: "Fixture school",
        observed_units: 1, denominator_units: 1, is_random_sample: false,
        official_archive_entry_ids: ["national/2025-legislativas"] },
    ] as never;

    const result = await repository(payload).value.coverage(SELECTION);
    if (result.status !== "ok" || result.escuelas.status !== "available") {
      throw new Error("expected available school coverage");
    }
    expect(result.escuelas.items).toEqual([
      expect.objectContaining({ circuitoCode: "00001", code: "E1",
        observedUnits: 1, denominatorUnits: 1 }),
      expect.objectContaining({ circuitoCode: "00002", code: "E1",
        observedUnits: 0, denominatorUnits: 1 }),
      expect.objectContaining({ circuitoCode: "00003", code: "E1",
        observedUnits: 1, denominatorUnits: 1 }),
    ]);
    expect(result.escuelas.items.map((school) => school.officialResultHref)).toEqual([
      expect.stringContaining("circuitoCode=00001"),
      expect.stringContaining("circuitoCode=00002"),
      expect.stringContaining("circuitoCode=00003"),
    ]);
  });

  it("keeps an uncovered mesa linked to official results without carrying its votes", async () => {
    const result = await repository(successPayload()).value.coverage(SELECTION);
    if (result.status !== "ok") throw new Error("expected coverage");
    expect(result.mesas[1]).toEqual(expect.objectContaining({
      code: 2, covered: false,
    }));
    expect(result.mesas[1]?.officialResultHref).toContain("mesaCode=2");
    expect(result.mesas[1]).not.toHaveProperty("votes");
  });

  it("accepts honest zero presence only with an empty fiscalizacion provenance set", async () => {
    const payload = successPayload();
    payload.mesas_coverage.observed_units = 0;
    payload.mesas[0]!.covered = false;
    payload.escuelas.items[0]!.observed_units = 0;
    payload.source_audit = [{ kind: "fiscalizacion", rows: 0, votes: 0, mesas: 0 }];
    payload.provenance.fiscalizacion_archive_entry_ids = [];

    await expect(repository(payload).value.coverage(SELECTION)).resolves.toMatchObject({
      status: "ok", mesasCoverage: { observedUnits: 0, denominatorUnits: 2 },
    });
  });

  it("preserves school identity unavailability with a per-reason breakdown", async () => {
    const payload = successPayload();
    payload.escuelas = {
      status: "source_unavailable",
      reason: "the registered source publishes no establecimiento data",
      exclusions: [{ reason: "official_mesas_without_establecimiento_identity", rows: 2, votes: 300 }],
      items: [],
    } as never;

    await expect(repository(payload).value.coverage(SELECTION)).resolves.toMatchObject({
      status: "ok",
      escuelas: { status: "source_unavailable", exclusions: [{
        reason: "official_mesas_without_establecimiento_identity", rows: 2, votes: 300,
      }] },
    });
  });

  it("returns a denominator refusal instead of a numerator-only figure", async () => {
    const payload = { status: "denominator_unavailable",
      reason: "no official mesa rows exist for the selected scope",
      counts: { official_mesa_rows: 0, fiscalizacion_rows: 3 } };
    await expect(repository(payload).value.coverage(SELECTION)).resolves.toEqual({
      status: "denominator_unavailable",
      reason: "no official mesa rows exist for the selected scope",
      counts: { officialMesaRows: 0, fiscalizacionRows: 3 },
    });
  });

  it.each([
    ["denominator mismatch", (payload: ReturnType<typeof successPayload>) => {
      payload.denominator_audit[0]!.mesas = 3;
    }],
    ["mixed source audit", (payload: ReturnType<typeof successPayload>) => {
      payload.source_audit.push({ kind: "official", rows: 1, votes: 50, mesas: 1 });
    }],
    ["missing official provenance", (payload: ReturnType<typeof successPayload>) => {
      payload.provenance.official_archive_entry_ids = [];
    }],
    ["random-sample claim", (payload: ReturnType<typeof successPayload>) => {
      payload.is_random_sample = true;
    }],
  ])("fails closed on %s", async (_case, mutate) => {
    const payload = successPayload();
    mutate(payload);
    await expect(repository(payload).value.coverage(SELECTION))
      .rejects.toBeInstanceOf(CoverageContractError);
  });
});
