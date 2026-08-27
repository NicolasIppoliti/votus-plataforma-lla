import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  coverage: vi.fn(),
  facetsRpc: vi.fn(),
  result: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      rpc: mocks.facetsRpc,
    }),
}));

vi.mock("@/lib/workspace/fiscalizacion-evidence", () => ({
  loadSafeFiscalizacionCoverage: mocks.coverage,
  loadSafeFiscalizacionResult: mocks.result,
}));

import FiscalizacionPage from "./page";

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
      name_status: "present",
      name_variant_count: 1,
    },
  ],
  secciones: [
    {
      code: "027",
      name: "Coronel Rosales",
      name_status: "present",
      name_variant_count: 1,
    },
  ],
  circuitos: [],
  establecimientos: [],
  mesas: [],
  available_levels: [],
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

type PageParams = Record<string, string | string[] | undefined>;

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

afterEach(() => {
  mocks.coverage.mockReset();
  mocks.result.mockReset();
  mocks.facetsRpc.mockReset();
});

describe("FiscalizacionPage", () => {
  it("renders the reusable dependent selector journey from source-backed facets", async () => {
    mocks.facetsRpc.mockResolvedValue({ data: FACETS, error: null });

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
  });

  it("loads coverage and result independently with explicit opt-in", async () => {
    mocks.facetsRpc.mockResolvedValue({ data: FACETS, error: null });
    mocks.coverage.mockRejectedValue(new Error("coverage denied"));
    mocks.result.mockResolvedValue({ status: "authorization_denied" });

    const markup = await renderComplete();

    expect(mocks.coverage).toHaveBeenCalledWith(COMPLETE_SELECTION, true);
    expect(mocks.result).toHaveBeenCalledWith(COMPLETE_SELECTION, true);
    expect(markup).toContain("Estado de cobertura: unavailable (thrown)");
    expect(markup).toContain("Estado del resultado: authorization_denied");
  });

  it("renders authorized bounded coverage, results, exclusions, unmapped rows, and provenance", async () => {
    mocks.facetsRpc.mockResolvedValue({ data: FACETS, error: null });
    mocks.coverage.mockResolvedValue(AUTHORIZED_COVERAGE);
    mocks.result.mockResolvedValue(AUTHORIZED_RESULT);

    const markup = await renderComplete();

    for (const evidence of [
      "Estado de cobertura: ok",
      "7 unidades observadas de 8",
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
  });

  it.each([
    ["coverage", "denominator_unavailable"],
    ["coverage", "selection_invalid"],
    ["coverage", "source_unavailable"],
    ["coverage", "opt_in_required"],
    ["coverage", "source_inconsistent"],
    ["coverage", "authorization_denied"],
    ["coverage", "payload_too_large"],
    ["result", "no_rows"],
    ["result", "opt_in_required"],
    ["result", "source_inconsistent"],
    ["result", "authorization_denied"],
    ["result", "payload_too_large"],
  ] as const)("renders the %s status %s", async (side, status) => {
    mocks.facetsRpc.mockResolvedValue({ data: FACETS, error: null });
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
            : side === "result" && status === "no_rows"
              ? {
                  ...AUTHORIZED_RESULT,
                  status,
                  rows: { items: [], total: 0, truncated: false },
                  unmapped: { items: [], total: 0, truncated: false },
                  provenance: { items: [], total: 0, truncated: false },
                  truncated: false,
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
      side === "coverage" ? payload : { status: "opt_in_required" },
    );
    mocks.result.mockResolvedValue(
      side === "result" ? payload : { status: "opt_in_required" },
    );

    const markup = await renderComplete();

    expect(markup).toContain(
      `Estado ${side === "coverage" ? "de cobertura" : "del resultado"}: ${status}`,
    );
    if (status === "source_inconsistent") {
      expect(markup).toContain("guarded_reason: 2 filas");
    }
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
      mocks.facetsRpc.mockResolvedValue({ data: FACETS, error: null });
      mocks.coverage.mockResolvedValue(
        side === "coverage"
          ? widen(AUTHORIZED_COVERAGE)
          : AUTHORIZED_COVERAGE,
      );
      mocks.result.mockResolvedValue(
        side === "result" ? widen(AUTHORIZED_RESULT) : AUTHORIZED_RESULT,
      );

      const markup = await renderComplete();

      expect(markup).toContain("Evidencia rechazada");
      expect(markup).toContain(
        "no superó la verificación independiente de fuente de la página",
      );
      expect(markup).not.toContain("7 unidades observadas de 8");
      expect(markup).not.toContain("Guardian Party");
      expect(markup).not.toContain("999");
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
