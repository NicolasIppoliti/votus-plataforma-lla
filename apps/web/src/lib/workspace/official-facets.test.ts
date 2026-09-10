import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
  schema: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({ createSupabaseServerClient: mocks.createClient }));

import { AuthorizedOfficialFacetRepository, createAuthorizedOfficialFacetRepository, OFFICIAL_FACETS_ERROR } from "./official-facets";

const IDS = { election: "10000000-0000-4000-8000-000000000001", category: "20000000-0000-4000-8000-000000000001" } as const;
const parent = { election_id: IDS.election, category_id: IDS.category, distrito_code: "02", seccion_code: "027" };
const row = { ...parent, year: 2025, round: "generales", category_name: "DIPUTADOS", distrito_name: "Buenos Aires", distrito_name_status: "present", distrito_name_variant_count: 1, seccion_name: "Coronel Rosales", seccion_name_status: "present", seccion_name_variant_count: 1 };
const circuit = { ...parent, circuito_code: "00001", circuito_name: null, circuito_name_status: "missing", circuito_name_variant_count: 0 };
const establishment = { ...parent, circuito_code: "00001", establecimiento_code: "E1", establecimiento_name: "School", establecimiento_name_status: "present", establecimiento_name_variant_count: 1 };
const mesa = { ...parent, circuito_code: "00001", establecimiento_code: "E1", mesa_code: 7 };
const payload = (facets: unknown[] = [row], extra: Record<string, unknown> = {}) => ({ status: "ok", facets, total: facets.length, truncated: false, circuitos: [], establecimientos: [], mesas: [], exclusions: [], ...extra });

async function expectFactoryMalformedDiagnostic(data: unknown, reason: string, sentinel: string): Promise<void> {
  mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
    error: null,
  });
  mocks.schema.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data, error: null });
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  try {
    await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({
      code: OFFICIAL_FACETS_ERROR.MALFORMED,
      message: "authorized official facets: malformed",
    });
    expect(error.mock.calls).toEqual([["[workspace:official_facets]", { code: "malformed", reason }]]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(sentinel);
  } finally {
    error.mockRestore();
  }
}

describe("AuthorizedOfficialFacetRepository", () => {
  it("logs only the malformed diagnostic when the authorized RPC response cannot be decoded", async () => {
    const secretSentinel = "synthetic-secret-sentinel";
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      schema: mocks.schema,
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: "10000000-0000-4000-8000-000000000001", sub: "10000000-0000-4000-8000-000000000002" } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({
      data: { status: "ok", synthetic_secret: secretSentinel },
      error: null,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({
        code: OFFICIAL_FACETS_ERROR.MALFORMED,
        message: "authorized official facets: malformed",
      });
      expect(mocks.schema).toHaveBeenCalledWith("workspace_api");
      expect(mocks.rpc).toHaveBeenCalledWith("official_facets", {
        p_election_id: null,
        p_category_id: null,
        p_distrito_code: null,
        p_seccion_code: null,
        p_circuito_code: null,
        p_establecimiento_code: null,
      });
      expect(error).toHaveBeenCalledExactlyOnceWith("[workspace:official_facets]", { code: "malformed" });
      expect(JSON.stringify(error.mock.calls)).not.toContain(secretSentinel);
    } finally {
      error.mockRestore();
    }
  });

  it("logs the district-metadata reason without response data when coarse rows disagree", async () => {
    const metadataSentinel = "synthetic-district-metadata-sentinel";
    const currentElection = { ...row, distrito_name: metadataSentinel };
    const otherSection = {
      ...currentElection,
      seccion_code: "028",
      seccion_name: "Section 028",
      distrito_name: null,
      distrito_name_status: "missing",
      distrito_name_variant_count: 0,
    };
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      schema: mocks.schema,
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: payload([currentElection, otherSection]), error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({
        code: OFFICIAL_FACETS_ERROR.MALFORMED,
        message: "authorized official facets: malformed",
      });
      expect(error.mock.calls).toEqual([[
        "[workspace:official_facets]",
        { code: "malformed", reason: "facets.metadata.distrito_inconsistent" },
      ]]);
      expect(JSON.stringify(error.mock.calls)).not.toContain(metadataSentinel);
    } finally {
      error.mockRestore();
    }
  });

  it("logs the section-metadata reason without response data when coarse rows disagree", async () => {
    const metadataSentinel = "synthetic-section-metadata-sentinel";
    const currentElection = { ...row, seccion_name: metadataSentinel };
    const conflictingSection = {
      ...currentElection,
      seccion_name: null,
      seccion_name_status: "missing",
      seccion_name_variant_count: 0,
    };
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      schema: mocks.schema,
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: payload([currentElection, conflictingSection]), error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({
        code: OFFICIAL_FACETS_ERROR.MALFORMED,
        message: "authorized official facets: malformed",
      });
      expect(error.mock.calls).toEqual([[
        "[workspace:official_facets]",
        { code: "malformed", reason: "facets.metadata.seccion_inconsistent" },
      ]]);
      expect(JSON.stringify(error.mock.calls)).not.toContain(metadataSentinel);
    } finally {
      error.mockRestore();
    }
  });

  it("logs the invalid-round reason without response data", async () => {
    const invalidRound = "synthetic-round-sentinel ";
    await expectFactoryMalformedDiagnostic(
      payload([{ ...row, round: invalidRound }]),
      "facets.row.round_invalid",
      invalidRound,
    );
  });

  it("logs the invalid-category-name reason without response data", async () => {
    const invalidCategoryName = "synthetic-category-name-sentinel ";
    await expectFactoryMalformedDiagnostic(
      payload([{ ...row, category_name: invalidCategoryName }]),
      "facets.row.category_name_invalid",
      invalidCategoryName,
    );
  });

  it("logs the invalid-distrito-code reason without response data", async () => {
    const invalidDistritoCode = "synthetic-distrito-code-sentinel ";
    await expectFactoryMalformedDiagnostic(
      payload([{ ...row, distrito_code: invalidDistritoCode }]),
      "facets.row.distrito_code_invalid",
      invalidDistritoCode,
    );
  });

  it("logs the invalid-seccion-code reason without response data", async () => {
    const invalidSeccionCode = "synthetic-seccion-code-sentinel ";
    await expectFactoryMalformedDiagnostic(
      payload([{ ...row, seccion_code: invalidSeccionCode }]),
      "facets.row.seccion_code_invalid",
      invalidSeccionCode,
    );
  });

  it("logs only unavailable when the real RPC wrapper rejects a provider error", async () => {
    const secretSentinel = "synthetic-provider-secret-sentinel";
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: secretSentinel } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({
        code: OFFICIAL_FACETS_ERROR.UNAVAILABLE,
        message: "authorized official facets: unavailable",
      });
      expect(error).toHaveBeenCalledExactlyOnceWith("[workspace:official_facets]", { code: "unavailable" });
      expect(JSON.stringify(error.mock.calls)).not.toContain(secretSentinel);
    } finally {
      error.mockRestore();
    }
  });

  it("logs malformed when decoded child options do not belong to the requested scope", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: payload([row], { circuitos: [circuit] }), error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(createAuthorizedOfficialFacetRepository().facets({})).rejects.toMatchObject({ code: OFFICIAL_FACETS_ERROR.MALFORMED });
      expect(error).toHaveBeenCalledExactlyOnceWith("[workspace:official_facets]", { code: "malformed" });
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    ["valid response", payload(), null],
    ["authorization refusal", payload([], { status: "context_stale" }), OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED],
    ["selection refusal", payload([], { status: "selection_invalid" }), OFFICIAL_FACETS_ERROR.NONMEMBER],
    ["safe-limit refusal", payload([], { status: "payload_too_large", total: 240, truncated: true, exclusions: [{ reason: "mesas_overflow", rows: 240 }] }), OFFICIAL_FACETS_ERROR.PAYLOAD_TOO_LARGE],
  ] as const)("does not log a diagnostic for %s", async (_name, data, code) => {
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims }, schema: mocks.schema });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { exp: Math.floor(Date.now() / 1_000) + 60, session_id: IDS.election, sub: IDS.category } },
      error: null,
    });
    mocks.schema.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data, error: null });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = createAuthorizedOfficialFacetRepository().facets({});
      if (code === null) await expect(result).resolves.toMatchObject({ elections: [{ id: IDS.election }] });
      else await expect(result).rejects.toMatchObject({ code });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("projects each authorized depth only after its parent selectors", async () => {
    const load = vi.fn().mockImplementation((selection) => Promise.resolve(payload([row], {
      circuitos: selection.seccionCode ? [circuit] : [], establecimientos: selection.circuitoCode ? [establishment] : [], mesas: selection.establecimientoCode ? [mesa] : [],
    })));
    const repository = new AuthorizedOfficialFacetRepository(load);
    const cold = await repository.facets({});
    const section = await repository.facets({ electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027" });
    const circuitResult = await repository.facets({ electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027", circuitoCode: "00001" });
    const establishmentResult = await repository.facets({ electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027", circuitoCode: "00001", establecimientoCode: "E1" });
    expect(cold).toMatchObject({ elections: [{ id: IDS.election, label: "2025 generales" }], categories: [], circuitos: [], availableLevels: [] });
    expect(section.circuitos).toEqual([{ code: "00001", name: null, nameStatus: "missing", nameVariantCount: 0 }]);
    expect(circuitResult.establecimientos).toEqual([{ code: "E1", name: "School", nameStatus: "present", nameVariantCount: 1 }]);
    expect(establishmentResult).toMatchObject({ mesas: [{ code: 7 }], availableLevels: ["distrito", "seccion", "circuito", "establecimiento", "mesa"] });
    expect(load).toHaveBeenLastCalledWith({ electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027", circuitoCode: "00001", establecimientoCode: "E1" });
  });

  it.each([
    ["denial", payload([], { status: "context_stale" }), {}, OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED],
    ["SQL nonmember", payload([], { status: "selection_invalid" }), {}, OFFICIAL_FACETS_ERROR.NONMEMBER],
    ["truncation", payload([row], { truncated: true }), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["count mismatch", payload([row], { total: 2 }), {}, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["malformed deep row", payload([row], { circuitos: [{ ...circuit, mesa_code: 7 }] }), { electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027" }, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["duplicate deep tuple", payload([row], { circuitos: [circuit, circuit] }), { electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027" }, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["foreign deep parent", payload([row], { circuitos: [{ ...circuit, seccion_code: "028" }] }), { electionId: IDS.election, categoryId: IDS.category, distritoCode: "02", seccionCode: "027" }, OFFICIAL_FACETS_ERROR.MALFORMED],
    ["nonmember selection", payload(), { electionId: "30000000-0000-4000-8000-000000000001" }, OFFICIAL_FACETS_ERROR.NONMEMBER],
  ] as const)("rejects %s", async (_case, raw, selection, code) => {
    await expect(new AuthorizedOfficialFacetRepository(() => Promise.resolve(raw)).facets(selection)).rejects.toMatchObject({ code });
  });

  it("accepts canonical district metadata that differs across election and category scopes", async () => {
    const firstSection = {
      ...row,
      distrito_name: null,
      distrito_name_status: "conflict",
      distrito_name_variant_count: 2,
    };
    const secondSection = {
      ...firstSection,
      seccion_code: "028",
      seccion_name: null,
      seccion_name_status: "missing",
      seccion_name_variant_count: 0,
    };
    const otherElection = {
      ...row,
      election_id: "10000000-0000-4000-8000-000000000003",
      year: 2023,
    };
    const otherCategory = {
      ...row,
      category_id: "20000000-0000-4000-8000-000000000003",
      category_name: "SENADORES",
    };
    const repository = new AuthorizedOfficialFacetRepository(() => Promise.resolve(payload([
      firstSection,
      secondSection,
      otherElection,
      otherCategory,
    ])));

    await expect(repository.facets({})).resolves.toMatchObject({
      elections: [
        { id: IDS.election, year: 2025 },
        { id: otherElection.election_id, year: 2023 },
      ],
    });
    await expect(repository.facets({ electionId: IDS.election, categoryId: IDS.category })).resolves.toMatchObject({
      distritos: [{ code: "02", name: null, nameStatus: "conflict", nameVariantCount: 2 }],
      secciones: [],
    });
    await expect(repository.facets({
      electionId: IDS.election,
      categoryId: IDS.category,
      distritoCode: "02",
    })).resolves.toMatchObject({
      secciones: [
        { code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 },
        { code: "028", name: null, nameStatus: "missing", nameVariantCount: 0 },
      ],
    });
  });

  it("propagates bounded exclusion evidence without widening no-selector official facets", async () => { const repository = new AuthorizedOfficialFacetRepository(() => Promise.resolve(payload([row], { exclusions: [{ reason: "non_official_source_rows", rows: 3 }, { reason: "official_rows_with_incomplete_lineage", rows: 2 }] })));
    await expect(repository.facets({})).resolves.toMatchObject({ elections: [{ id: IDS.election }], categories: [], exclusions: [{ reason: "non_official_source_rows", rows: 3 }, { reason: "official_rows_with_incomplete_lineage", rows: 2 }] });
  });

  it("preserves validated overflow depth and count in a distinct typed refusal", async () => { const read=new AuthorizedOfficialFacetRepository(()=>Promise.resolve(payload([],{status:"payload_too_large",total:240,truncated:true,exclusions:[{reason:"mesas_overflow",rows:240}]}))).facets({});
    await expect(read).rejects.toMatchObject({code:"payload_too_large",exclusions:[{reason:"mesas_overflow",rows:240}]});
  });

  it("keeps authorized empty distinct from authorization denial", async () => {
    await expect(new AuthorizedOfficialFacetRepository(() => Promise.resolve(payload([]))).facets({})).resolves.toMatchObject({ elections: [] });
  });
});
