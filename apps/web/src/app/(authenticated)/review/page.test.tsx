import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReviewPage from "./page";

const READ_ONLY_NOTICE =
  "Esta pantalla es solo de consulta. Puede inspeccionar los elementos pendientes, pero no modificarlos ni resolverlos aquí.";
const AUTHORIZATION_DENIED = "No se pudo autorizar la cola de revisión.";
const PAYLOAD_TOO_LARGE = "La respuesta de la cola de revisión supera el límite seguro.";
const UNAVAILABLE = "La cola de revisión no está disponible por el momento.";
const AUTHORIZED_EMPTY = "No hay elementos de revisión pendientes.";

const reviewState = vi.hoisted(() => ({
  status: "ok",
  total: 0,
  truncated: false,
  items: [] as Array<{
    id: string;
    kind: string;
severity: string;
    subject_ref?: string;
    detectedAt: string;
    note?: string | null;
  }>,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({ verified: true }),
}));
vi.mock("@/lib/workspace/context", () => ({
  authorizedReviewItems: async () => ({ status: reviewState.status, items: reviewState.items, total: reviewState.total, truncated: reviewState.truncated }),
}));

describe("review page — responsive review evidence", () => {
  it("renders populated review evidence in a labelled, focusable scroll region", async () => {
    const longSubjectRef = `subject-${"a".repeat(64)}`;
    const longNote = `Ley 19.945 Arts. 160–161 ${"statute-note-".repeat(12)}`;
    reviewState.status = "ok";
    reviewState.total = 51;
    reviewState.truncated = true;
    reviewState.items = [
      {
        id: "review-1",
        kind: "fetch_failure",
        severity: "warning",
        subject_ref: longSubjectRef,
        detectedAt: "2026-02-01T12:00:00Z",
        note: longNote,
      },
    ];

    const markup = renderToStaticMarkup(
      (await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(markup).toContain(READ_ONLY_NOTICE);
    expect(markup).toContain("Mostrando 1 de 51.");
    expect(markup).toContain('href="/review?offset=50"');
    expect(renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({ offset: "2000000000" }) })) as ReactElement)).not.toContain('href="/review?offset=2000000050"');
    expect(markup).toMatch(
      /<div class="table-scroll" role="region" aria-label="Elementos de revisión pendientes" tabindex="0">/,
    );
    expect(markup).toMatch(
      /<table class="data-table data-table--review">/,
    );
    expect(markup).toMatch(
      /<caption>Elementos de revisión pendientes<\/caption>/,
    );
    expect(markup).toMatch(/<col[^>]+class="review-column review-column--subject"/);
    expect(markup).toMatch(/<col[^>]+class="review-column review-column--note"/);
    expect(markup).toContain('class="table-cell--short">fetch_failure');
    expect(markup).toContain('class="table-cell--short">warning');
    expect(markup).toContain(
      'class="table-cell--timestamp">2026-02-01T12:00:00Z',
    );
    expect(markup.match(/scope="col"/g)).toHaveLength(5);
    expect(markup.match(/Oculto por alcance/g)).toHaveLength(2);
    expect(markup).not.toContain(longSubjectRef);
    expect(markup).not.toContain(longNote);
  });

  it("keeps the exact empty state without rendering a table", async () => {
    reviewState.status = "ok";
    reviewState.total = 0;
    reviewState.truncated = false;
    reviewState.items = [];

    const markup = renderToStaticMarkup(
      (await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement,
    );

    expect(markup).toContain(READ_ONLY_NOTICE);
    expect(markup).toContain("No hay elementos de revisión pendientes.");
    expect(markup).not.toContain("<table");
  });

  it("renders authorization denial distinctly from every other safe state", async () => {
    reviewState.status = "authorization_denied";
    reviewState.total = 0;
    reviewState.truncated = false;
    reviewState.items = [];

    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain(AUTHORIZATION_DENIED);
    expect(markup).not.toContain(AUTHORIZED_EMPTY);
    expect(markup).not.toContain(PAYLOAD_TOO_LARGE);
    expect(markup).not.toContain(UNAVAILABLE);
    expect(markup).not.toContain("<table");
  });

  it("renders an oversized response refusal without payload figures or exclusions", async () => {
    reviewState.status = "payload_too_large";
    reviewState.total = 8675309;
    reviewState.truncated = true;
    reviewState.items = [{
      id: "payload-item-sentinel",
      kind: "payload-exclusion-reason-sentinel",
      severity: "warning",
      detectedAt: "2026-02-01T12:00:00Z",
    }];

    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain(PAYLOAD_TOO_LARGE);
    expect(markup).not.toContain(AUTHORIZATION_DENIED);
    expect(markup).not.toContain("8675309");
    expect(markup).not.toContain("payload-item-sentinel");
    expect(markup).not.toContain("payload-exclusion-reason-sentinel");
    expect(markup).not.toContain("<table");
  });

  it("renders a generic unavailable refusal without payload figures or exclusions", async () => {
    reviewState.status = "unavailable";
    reviewState.total = 246801357;
    reviewState.truncated = true;
    reviewState.items = [{
      id: "unavailable-item-sentinel",
      kind: "unavailable-exclusion-reason-sentinel",
      severity: "error",
      detectedAt: "2026-02-01T12:00:00Z",
    }];

    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain(UNAVAILABLE);
    expect(markup).not.toContain(AUTHORIZATION_DENIED);
    expect(markup).not.toContain("246801357");
    expect(markup).not.toContain("unavailable-item-sentinel");
    expect(markup).not.toContain("unavailable-exclusion-reason-sentinel");
    expect(markup).not.toContain("<table");
  });

  it("keeps authorized empty distinct from every refusal", async () => {
    reviewState.status = "authorized_empty";
    reviewState.total = 8675309;
    reviewState.truncated = true;
    reviewState.items = [{
      id: "authorized-empty-item-sentinel",
      kind: "authorized-empty-exclusion-reason-sentinel",
      severity: "warning",
      detectedAt: "2026-02-01T12:00:00Z",
    }];

    const markup = renderToStaticMarkup((await ReviewPage({ searchParams: Promise.resolve({}) })) as ReactElement);

    expect(markup).toContain(AUTHORIZED_EMPTY);
    expect(markup).not.toContain(AUTHORIZATION_DENIED);
    expect(markup).not.toContain(PAYLOAD_TOO_LARGE);
    expect(markup).not.toContain(UNAVAILABLE);
    expect(markup).not.toContain("8675309");
    expect(markup).not.toContain("authorized-empty-item-sentinel");
    expect(markup).not.toContain("authorized-empty-exclusion-reason-sentinel");
    expect(markup).not.toContain("<table");
  });
});
