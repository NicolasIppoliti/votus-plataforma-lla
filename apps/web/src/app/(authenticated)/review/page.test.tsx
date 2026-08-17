import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReviewPage from "./page";

const READ_ONLY_NOTICE =
  "Esta pantalla es solo de consulta. Puede inspeccionar los elementos pendientes, pero no modificarlos ni resolverlos aquí.";

const reviewState = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    kind: string;
    severity: string;
    subject_ref: string;
    detected_at: string;
    note: string | null;
  }>,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        is: () => ({
          order: async () => ({ data: reviewState.items, error: null }),
        }),
      }),
    }),
  }),
}));

describe("review page — responsive review evidence", () => {
  it("renders populated review evidence in a labelled, focusable scroll region", async () => {
    const longSubjectRef = `subject-${"a".repeat(64)}`;
    const longNote = `Ley 19.945 Arts. 160–161 ${"statute-note-".repeat(12)}`;
    reviewState.items = [
      {
        id: "review-1",
        kind: "provider_defect",
        severity: "warning",
        subject_ref: longSubjectRef,
        detected_at: "2026-02-01T12:00:00Z",
        note: longNote,
      },
    ];

    const markup = renderToStaticMarkup(
      (await ReviewPage()) as ReactElement,
    );

    expect(markup).toContain(READ_ONLY_NOTICE);
    expect(markup).toMatch(
      /<div class="table-scroll" role="region" aria-label="Elementos de revisión pendientes" tabindex="0">/,
    );
    expect(markup).toMatch(
      /<table class="data-table data-table--review">/,
    );
    expect(markup).toMatch(
      /<caption>Elementos de revisión pendientes<\/caption>/,
    );
    expect(markup).toMatch(
      /<col[^>]+class="review-column review-column--subject"/,
    );
    expect(markup).toMatch(
      /<col[^>]+class="review-column review-column--note"/,
    );
    expect(markup).toContain('class="table-cell--short">provider_defect');
    expect(markup).toContain('class="table-cell--short">warning');
    expect(markup).toContain(
      `class="evidence-token table-cell--identity">${longSubjectRef}`,
    );
    expect(markup).toContain(
      'class="table-cell--timestamp">2026-02-01T12:00:00Z',
    );
    expect(markup.match(/scope="col"/g)).toHaveLength(5);
    expect(markup).toContain(longSubjectRef);
    expect(markup).toContain(longNote);
    expect(markup).toContain(`class="evidence-text">${longNote}`);
  });

  it("keeps the exact empty state without rendering a table", async () => {
    reviewState.items = [];

    const markup = renderToStaticMarkup(
      (await ReviewPage()) as ReactElement,
    );

    expect(markup).toContain(READ_ONLY_NOTICE);
    expect(markup).toContain("No hay elementos de revisión pendientes.");
    expect(markup).not.toContain("<table");
  });
});
