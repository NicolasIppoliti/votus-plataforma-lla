import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coverage: vi.fn(), facets: vi.fn(), createFacetRepository: vi.fn(), result: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/workspace/official-facets", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/workspace/official-facets")>(),
  createAuthorizedOfficialFacetRepository: mocks.createFacetRepository,
}));

vi.mock("@/lib/workspace/fiscalizacion-evidence", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/workspace/fiscalizacion-evidence")>(),
  loadSafeFiscalizacionCoverage: mocks.coverage,
  loadSafeFiscalizacionResult: mocks.result,
}));

const { AuthorizedOfficialFacetsError, OFFICIAL_FACETS_ERROR } = await import("@/lib/workspace/official-facets");
const { sanitizeFiscalizacionCoverage, sanitizeFiscalizacionResult } = await import("@/lib/workspace/fiscalizacion-evidence");
const { fiscalWirePair, fiscalWireStates } = await import("../../../../e2e/fiscalizacion-state-control");
const { default: FiscalizacionPage } = await import("./page");
const { default: FiscalizacionLoading } = await import("./loading");
const { default: FiscalizacionError } = await import("./error");

const COMPLETE_SELECTION = {
  electionId: "50000000-0000-0000-0000-000000000001",
  categoryId: "51000000-0000-0000-0000-000000000001",
  distritoCode: "02",
  seccionCode: "027",
};

const FACETS = {
  status: "ok",
  elections: [
    {
      id: COMPLETE_SELECTION.electionId,
      year: 2025,
      round: "legislativas",
      label: "2025 legislativas",
    },
  ],
  categories: [
    { id: COMPLETE_SELECTION.categoryId, name: "DIPUTADO NACIONAL" },
  ],
  distritos: [
    {
      code: "02",
      name: "Buenos Aires",
      nameStatus: "present",
      nameVariantCount: 1,
    },
  ],
  secciones: [
    {
      code: "027",
      name: "Coronel Rosales",
      nameStatus: "present",
      nameVariantCount: 1,
    },
  ],
  circuitos: [],
  establecimientos: [],
  mesas: [],
  availableLevels: [],
};

const AUTHORIZED_COVERAGE = {
  status: "ok",
  authorization_status: "authorized",
  source_kind: "fiscalizacion",
  is_random_sample: false,
  vote_data: "not_included",
  observed_units: 7,
  denominator_units: 8,
  uncovered: {
    items: Array.from({ length: 100 }, (_, index) => ({
      code: index + 8,
      circuito_code: "00002",
      establecimiento_code: `E${index + 2}`,
      establecimiento_name: index === 0 ? "South school" : `School ${index + 2}`,
    })),
    total: 101,
    truncated: true,
  },
  exclusions: {
    items: [{ reason: "missing_identity", rows: 1 }],
    total: 1,
    truncated: false,
  },
  truncated: true,
};

const AUTHORIZED_RESULT = {
  status: "ok",
  authorization_status: "authorized",
  source_kind: "fiscalizacion",
  is_random_sample: false,
  reference: {
    election_year: 2025,
    election_round: "legislativas",
    category_name: "DIPUTADO NACIONAL",
    distrito_code: "02",
    seccion_code: "027",
    denominator_units: 8,
  },
  rows: {
    items: Array.from({ length: 100 }, (_, index) => ({
      list_id: `A${index}`,
      canonical_party_id: `party-${index}`,
      party_name: index === 0 ? "Guardian Party" : `Party ${index}`,
      granularity: "mesa",
      votes: index === 0 ? 999 : index,
      rows: 1,
    })),
    total: 101,
    truncated: true,
  },
  unmapped: {
    items: [{ list_id: "777", votes: 5, rows: 1 }],
    total: 1,
    truncated: false,
  },
  exclusions: {
    items: [{ reason: "mixed_granularity", rows: 2 }],
    total: 1,
    truncated: false,
  },
  provenance: {
    items: [
      {
        id: "fiscal/a",
        sha256: "a".repeat(64),
        fetched_at: "2026-01-01T00:00:00Z",
        status: "ok",
      },
    ],
    total: 1,
    truncated: false,
  },
  truncated: true,
};

const AUTHORIZED_NO_ROWS_RESULT = {
  ...AUTHORIZED_RESULT,
  status: "no_rows",
  rows: { items: [], total: 0, truncated: false },
  unmapped: { items: [], total: 0, truncated: false },
  exclusions: { items: [], total: 0, truncated: false },
  provenance: { items: [], total: 0, truncated: false },
  truncated: false,
};

const FIGURE_SENTINELS = [
  "7 unidades observadas de 8",
  "South school",
  "missing_identity: 1 filas",
  "Guardian Party",
  "999",
  "Sin mapeo: 777; 5 votos, 1 filas",
  "mixed_granularity: 2 filas",
  "fiscal/a",
];

type PageParams = Record<string, string | string[] | undefined>;

function expectFigureFree(markup: string): void {
  for (const sentinel of FIGURE_SENTINELS) {
    expect(markup).not.toContain(sentinel);
  }
}

function copyWithout(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

async function renderPage(params: PageParams = {}): Promise<string> {
  const page = await FiscalizacionPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(page as ReactElement);
}

async function renderComplete(): Promise<string> {
  return renderPage(COMPLETE_SELECTION);
}

beforeEach(() => {
  mocks.coverage.mockReset(); mocks.result.mockReset(); mocks.facets.mockReset();
  mocks.createFacetRepository.mockReset().mockReturnValue({ facets: mocks.facets });
});

describe("FiscalizacionPage", () => {
  it("renders the reusable dependent selector journey from authorized facets", async () => {
    mocks.facets.mockResolvedValue(FACETS);

    const cold = await renderPage();
    expect(cold).toContain('<form action="/fiscalizacion" method="get">');
    for (const name of [
      "electionId",
      "categoryId",
      "distritoCode",
      "seccionCode",
    ]) {
      expect(cold).toContain(`name="${name}"`);
    }
    expect(cold).toContain("Elegir una elección");
    expect(cold).toContain("02 — Buenos Aires");
    expect(cold).toContain("027 — Coronel Rosales");
    expect(cold).toContain(">Mostrar cobertura</button>");

    const selected = await renderPage(COMPLETE_SELECTION);
    expect(selected).toContain(
      `<option value="${COMPLETE_SELECTION.electionId}" selected="">`,
    );
    expect(selected).toContain('<option value="02" selected="">');
    expect(selected).toContain('<option value="027" selected="">');
    expect(mocks.createFacetRepository).toHaveBeenCalled();
  });

  it("renders authorization denial distinctly from unavailable or empty facets", async () => {
    mocks.facets.mockRejectedValue(new AuthorizedOfficialFacetsError(OFFICIAL_FACETS_ERROR.AUTHORIZATION_DENIED));
    const denied = await renderPage();
    expect(denied).toContain("No tiene autorización para consultar estas opciones");
    expect(denied).not.toContain("No se pudieron cargar las opciones");
    expect(mocks.coverage).not.toHaveBeenCalled(); expect(mocks.result).not.toHaveBeenCalled();
  });

  it.each(["coverage", "result"] as const)(
    "suppresses both regions when the independently settled %s loader throws",
    async (side) => {
      mocks.facets.mockResolvedValue(FACETS);
      if (side === "coverage") {
        mocks.coverage.mockRejectedValue(new Error("coverage denied"));
        mocks.result.mockResolvedValue(AUTHORIZED_RESULT);
      } else {
        mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
        mocks.result.mockRejectedValue(new Error("result denied"));
      }

      const markup = await renderComplete();

      expect(mocks.coverage).toHaveBeenCalledWith(COMPLETE_SELECTION, true);
      expect(mocks.result).toHaveBeenCalledWith(COMPLETE_SELECTION, true);
      expect(markup).toContain("Error técnico de evidencia");
      expect(markup).not.toContain("Evidencia no disponible");
      expectFigureFree(markup);
    },
  );

  it.each([
    ["coverage unavailable", "coverage", { status: "unavailable" }],
    ["coverage malformed", "coverage", {}],
    ["result unavailable", "result", { status: "unavailable" }],
    ["result malformed", "result", {}],
  ] as const)("suppresses both regions for %s loader output", async (_name, side, payload) => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(
      side === "coverage" ? payload : AUTHORIZED_COVERAGE,
    );
    mocks.result.mockResolvedValue(side === "result" ? payload : AUTHORIZED_RESULT);

    const markup = await renderComplete();

    expect(markup).toContain("Evidencia no disponible");
    expect(markup).toContain("Estado de evidencia: unavailable");
    expectFigureFree(markup);
  });

  it("renders authorized bounded coverage, results, exclusions, unmapped rows, and provenance", async () => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderComplete();

    for (const evidence of [
      "Estado de cobertura: ok",
      "Fuente: fiscalización; no es una muestra aleatoria; datos de votos no incluidos.",
      "7 unidades observadas de 8 del denominador oficial",
      "South school",
      "missing_identity: 1 filas",
      "Unidades sin cobertura: se muestran 100 de 101; respuesta truncada",
      "Estado del resultado: ok",
      "Guardian Party",
      "999",
      "Sin mapeo: 777; 5 votos, 1 filas",
      "mixed_granularity: 2 filas",
      "fiscal/a",
      "Resultados: se muestran 100 de 101; respuesta truncada",
    ]) {
      expect(markup).toContain(evidence);
    }
    expect(markup).toContain(
      'aria-label="Resultados de fiscalización" tabindex="0"',
    );

    const qualification = markup.indexOf('class="fiscalizacion-workspace__qualification"');
    const resultHeading = markup.indexOf('id="workspace-result"');
    const voteTable = markup.indexOf('<caption>Resultados de fiscalización</caption>');
    const coverageDetail = markup.indexOf('id="workspace-coverage"');
    expect(qualification).toBeGreaterThanOrEqual(0);
    expect(qualification).toBeLessThan(resultHeading);
    expect(resultHeading).toBeLessThan(voteTable);
    expect(voteTable).toBeLessThan(coverageDetail);
    expect(markup).toContain("No es una muestra aleatoria");
    expect(markup.match(/Denominador oficial: 8\./g)).toHaveLength(2);
    expect(markup).toContain("Detalle acotado: 100 de 101 unidades sin cobertura");
    expect(markup).toContain("Detalle acotado: 100 de 101 filas de resultado");
  });

  it("keeps accepted paired evidence visible when authorized facets are unavailable", async () => {
    mocks.facets.mockRejectedValue(new Error("controlled facets unavailable"));
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderComplete();

    expect(markup).toContain('class="fiscalizacion-workspace__qualification"');
    expect(markup).toContain("7 unidades observadas de 8 del denominador oficial");
    expect(markup).toContain("Guardian Party");
    expect(markup).toContain("South school");
    expect(markup).not.toContain('<form action="/fiscalizacion" method="get">');
  });

  it.each([
    ["coverage denominator missing", (value: Record<string, unknown>) => copyWithout(value, "denominator_units")],
    ["coverage denominator unsafe", (value: Record<string, unknown>) => ({ ...value, denominator_units: Number.MAX_SAFE_INTEGER + 1 })],
    ["coverage denominator noninteger", (value: Record<string, unknown>) => ({ ...value, denominator_units: 7.5 })],
    ["coverage denominator below observed", (value: Record<string, unknown>) => ({ ...value, denominator_units: 6 })],
  ] as const)("refuses before figures when %s", async (_name, mutate) => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(mutate(AUTHORIZED_COVERAGE));
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderComplete();

    expect(markup).toContain("Evidencia no disponible");
    expect(markup).toContain("Estado de evidencia: invalid");
    expectFigureFree(markup);
  });

  it.each([
    ["result reference non-object", (value: Record<string, unknown>) => ({ ...value, reference: null })],
    ["result reference denominator missing", (value: Record<string, unknown>) => ({ ...value, reference: copyWithout(value.reference as Record<string, unknown>, "denominator_units") })],
    ["result reference denominator negative", (value: Record<string, unknown>) => ({ ...value, reference: { ...(value.reference as Record<string, unknown>), denominator_units: -1 } })],
    ["result reference denominator noninteger", (value: Record<string, unknown>) => ({ ...value, reference: { ...(value.reference as Record<string, unknown>), denominator_units: 7.5 } })],
    ["result reference denominator unsafe", (value: Record<string, unknown>) => ({ ...value, reference: { ...(value.reference as Record<string, unknown>), denominator_units: Number.MAX_SAFE_INTEGER + 1 } })],
  ] as const)("refuses before figures when %s", async (_name, mutate) => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    mocks.result.mockResolvedValue(mutate(AUTHORIZED_RESULT));

    const markup = await renderComplete();

    expect(markup).toContain("Evidencia no disponible");
    expect(markup).toContain("Estado de evidencia: invalid");
    expectFigureFree(markup);
  });

  it.each([
    ["coverage", "denominator_unavailable"],
    ["coverage", "selection_invalid"],
    ["coverage", "source_unavailable"],
    ["coverage", "opt_in_required"],
    ["coverage", "source_inconsistent"],
    ["coverage", "authorization_denied"],
    ["coverage", "payload_too_large"],
    ["result", "opt_in_required"],
    ["result", "source_inconsistent"],
    ["result", "authorization_denied"],
    ["result", "payload_too_large"],
  ] as const)("refuses disclosure when the %s side returns %s", async (side, status) => {
    mocks.facets.mockResolvedValue(FACETS);
    const payload =
      status === "source_inconsistent"
        ? {
            status,
            exclusions: {
              items: [{ reason: "guarded_reason", rows: 2 }],
              total: 1,
              truncated: false,
            },
          }
        : side === "coverage" &&
            [
              "denominator_unavailable",
              "selection_invalid",
              "source_unavailable",
            ].includes(status)
          ? { ...AUTHORIZED_COVERAGE, status }
          : side === "coverage" && status === "payload_too_large"
            ? {
                status,
                authorization_status: "authorized",
                source_kind: "fiscalizacion",
                is_random_sample: false,
                vote_data: "not_included",
                truncated: true,
              }
            : side === "result" && status === "payload_too_large"
                ? {
                    status,
                    authorization_status: "authorized",
                    source_kind: "fiscalizacion",
                    is_random_sample: false,
                    truncated: true,
                  }
                : status === "authorization_denied"
                  ? { status, authorization_status: null }
                  : { status };
    mocks.coverage.mockResolvedValue(
      side === "coverage" ? payload : AUTHORIZED_COVERAGE,
    );
    mocks.result.mockResolvedValue(
      side === "result" ? payload : AUTHORIZED_RESULT,
    );

    const markup = await renderComplete();

    expect(markup).toContain("Evidencia no disponible");
    expect(markup).toContain("Estado de evidencia:");
    expectFigureFree(markup);
  });

  it.each([
    ["rows", { items: [{ list_id: "A", canonical_party_id: "party-a", party_name: "Party A", granularity: "mesa", votes: 1, rows: 1 }], total: 1, truncated: false }],
    ["unmapped", { items: [{ list_id: "777", votes: 1, rows: 1 }], total: 1, truncated: false }],
    ["exclusions", { items: [{ reason: "missing_identity", rows: 1 }], total: 1, truncated: false }],
    ["provenance", { items: [{ id: "fiscal/a", sha256: "a".repeat(64), fetched_at: "2026-01-01T00:00:00Z", status: "ok" }], total: 1, truncated: false }],
  ] as const)("refuses contradictory no_rows %s before figures", async (collection, value) => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    mocks.result.mockResolvedValue({ ...AUTHORIZED_NO_ROWS_RESULT, [collection]: value });

    const markup = await renderComplete();

    expect(markup).toContain("Evidencia no disponible");
    expect(markup).toContain("Estado de evidencia: invalid");
    expect(markup).not.toContain("Evidencia sin filas");
    expectFigureFree(markup);
  });

  it("renders valid no_rows as an explicit figure-free empty state", async () => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    const payload = fiscalWireStates(COMPLETE_SELECTION)[0].payload;
    const safe = sanitizeFiscalizacionResult(payload, COMPLETE_SELECTION);
    expect(safe?.status).toBe("no_rows");
    mocks.coverage.mockResolvedValue(sanitizeFiscalizacionCoverage(fiscalWirePair(COMPLETE_SELECTION).coverage));
    mocks.result.mockResolvedValue(safe);

    const markup = await renderComplete();
    expect(markup).not.toContain("source_kind_official");
    expect(markup).not.toContain('id="workspace-coverage"');
    expect(markup).not.toContain('id="workspace-result"');

    expect(markup).toContain("Evidencia sin filas");
    expect(markup).toContain("La consulta autorizada no devolvió resultados de fiscalización.");
    expect(markup).not.toContain("Evidencia no disponible");
    expectFigureFree(markup);
  });

  it.each(["ok", "no_rows"] as const)("refuses independently valid %s evidence with different official denominators", async (status) => {
    mocks.facets.mockResolvedValue(FACETS);
    const pair = fiscalWirePair(COMPLETE_SELECTION);
    const coverage = sanitizeFiscalizacionCoverage(pair.coverage);
    const payload = status === "no_rows" ? fiscalWireStates(COMPLETE_SELECTION)[0].payload : pair.result;
    const result = sanitizeFiscalizacionResult({ ...payload, reference: {
      ...payload.reference, denominator_units: 2,
    } }, COMPLETE_SELECTION);
    expect(coverage?.status).toBe("ok");
    expect(result?.status).toBe(status);
    mocks.coverage.mockResolvedValue(coverage);
    mocks.result.mockResolvedValue(result);
    const markup = await renderComplete();
    expect(markup).toContain("Estado de evidencia: invalid");
    expect(markup).not.toContain('id="workspace-coverage"');
    expect(markup).not.toContain('id="workspace-result"');
    expectFigureFree(markup);
  });

  it("renders a figure-free technical error when an evidence loader rejects", async () => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockRejectedValue(new Error("coverage failure"));
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderComplete();

    expect(markup).toContain("Error técnico de evidencia");
    expect(markup).not.toContain("Evidencia no disponible");
    expectFigureFree(markup);
  });

  it("offers a native retry at the normalized selection without disclosing failed evidence", async () => {
    mocks.facets.mockResolvedValue(FACETS);
    mocks.coverage.mockRejectedValue(new Error("unsafe remote detail"));
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderPage({ ...COMPLETE_SELECTION, distritoCode: "2", seccionCode: "27" });
    const href = `/fiscalizacion?electionId=${COMPLETE_SELECTION.electionId}&amp;categoryId=${COMPLETE_SELECTION.categoryId}&amp;distritoCode=02&amp;seccionCode=027`;
    expect(markup).toContain(`<a class="button button--primary" href="${href}">Reintentar carga</a>`);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('<option value="027" selected="">');
    expect(markup).not.toContain("unsafe remote detail");
    expect(markup).not.toContain('id="workspace-coverage"');
    expect(markup).not.toContain('id="workspace-result"');
    expectFigureFree(markup);
  });

  it("renders stable labelled loading geometry", () => {
    const markup = renderToStaticMarkup(<FiscalizacionLoading />);

    expect(markup).toContain('aria-label="Cargando fiscalización"');
    expect(markup).toContain("Cargando el espacio de fiscalización");
    expect(markup).toContain("fiscalizacion-loading__block");
  });

  it("renders a safe keyboard-operable retry without error or evidence contents", () => {
    const markup = renderToStaticMarkup(
      <FiscalizacionError
        error={Object.assign(new Error("Guardian Party 999"), { digest: "unsafe" })}
        reset={vi.fn()}
      />,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain("Reintentar carga");
    expect(markup).not.toContain("Guardian Party");
    expect(markup).not.toContain("unsafe");
    expectFigureFree(markup);
  });

  it.each([
    ["coverage authorization missing", "coverage", (value: Record<string, unknown>) => copyWithout(value, "authorization_status")],
    ["coverage authorization widened", "coverage", (value: Record<string, unknown>) => ({ ...value, authorization_status: "pending" })],
    ["coverage source missing", "coverage", (value: Record<string, unknown>) => copyWithout(value, "source_kind")],
    ["coverage source widened", "coverage", (value: Record<string, unknown>) => ({ ...value, source_kind: "official" })],
    ["coverage sample claim missing", "coverage", (value: Record<string, unknown>) => copyWithout(value, "is_random_sample")],
    ["coverage sample claim widened", "coverage", (value: Record<string, unknown>) => ({ ...value, is_random_sample: true })],
    ["coverage vote claim missing", "coverage", (value: Record<string, unknown>) => copyWithout(value, "vote_data")],
    ["coverage vote claim widened", "coverage", (value: Record<string, unknown>) => ({ ...value, vote_data: "included" })],
    ["result authorization missing", "result", (value: Record<string, unknown>) => copyWithout(value, "authorization_status")],
    ["result authorization widened", "result", (value: Record<string, unknown>) => ({ ...value, authorization_status: "pending" })],
    ["result source missing", "result", (value: Record<string, unknown>) => copyWithout(value, "source_kind")],
    ["result source widened", "result", (value: Record<string, unknown>) => ({ ...value, source_kind: "official" })],
    ["result sample claim missing", "result", (value: Record<string, unknown>) => copyWithout(value, "is_random_sample")],
    ["result sample claim widened", "result", (value: Record<string, unknown>) => ({ ...value, is_random_sample: true })],
  ] as const)(
    "refuses before figures when %s",
    async (_name, side, widen) => {
      mocks.facets.mockResolvedValue(FACETS);
      mocks.coverage.mockResolvedValue(
        side === "coverage"
          ? widen(AUTHORIZED_COVERAGE)
          : AUTHORIZED_COVERAGE,
      );
      mocks.result.mockResolvedValue(
        side === "result" ? widen(AUTHORIZED_RESULT) : AUTHORIZED_RESULT,
      );

      const markup = await renderComplete();

      expect(markup).toContain("Evidencia no disponible");
      expect(markup).toContain("Estado de evidencia: invalid");
      expectFigureFree(markup);
    },
  );

  it.each([
    [{ jurisdictionId: "legacy" }, "parámetros de consulta no admitidos"],
    [{ electionId: ["first", "second"] }, "parámetros de consulta repetidos"],
    [{ distritoCode: "2A" }, "selectores administrativos están malformados"],
  ] as const)("rejects unsupported or ambiguous query input", async (params, reason) => {
    const markup = await renderPage(params as PageParams);

    expect(markup).toContain("Se rechazó la solicitud");
    expect(markup).toContain(reason);
    expect(mocks.coverage).not.toHaveBeenCalled();
    expect(mocks.result).not.toHaveBeenCalled();
  });
});
