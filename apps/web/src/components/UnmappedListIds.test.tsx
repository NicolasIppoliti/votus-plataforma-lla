import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnmappedListIds } from "./UnmappedListIds";

const entries = [{ listId: "4321", rows: 2, votes: 700 }];

describe("UnmappedListIds", () => {
  it("withholds vote totals and renders the exact source-kind reason", () => {
    const reason =
      "las filas mezclan tipos de fuente (fiscalizacion, official); las cifras oficiales y de fiscalización nunca se combinan en un mismo número";
    const markup = renderToStaticMarkup(
      <UnmappedListIds entries={entries} totalRows={2} unsummable={reason} />,
    );

    expect(markup).toContain("4321: 2 filas");
    expect(markup).not.toContain("4321: 2 filas, 700 votos");
    expect(markup).not.toContain("700 votos");
    expect(markup).toContain(reason);
  });

  it("omits every vote total from no-list-id tallies when rows cannot be combined", () => {
    const reason =
      "las filas mezclan tipos de fuente (fiscalizacion, official); las cifras oficiales y de fiscalización nunca se combinan en un mismo número";
    const markup = renderToStaticMarkup(
      <UnmappedListIds
        entries={[{ listId: "777", rows: 1, votes: 80 }]}
        totalRows={4}
        withoutListId={{
          official: { rows: 2, votes: 300 },
          fiscalizacion: { rows: 1, votes: 40 },
          unknown: { rows: 0, votes: 900 },
        }}
        unsummable={reason}
      />,
    );

    expect(markup).toContain("777: 1 filas");
    expect(markup).toContain("3 fila(s) no tienen id de lista");
    expect(markup).toContain("2 fila(s) official");
    expect(markup).toContain("1 fila(s) fiscalizacion");
    expect(markup).toContain(reason);
    expect(markup).not.toContain("80");
    expect(markup).not.toContain("300");
    expect(markup).not.toContain("40");
    expect(markup).not.toContain("900");
    expect(markup).not.toContain("unknown");
  });

  it("renders vote totals when rows can be combined", () => {
    const markup = renderToStaticMarkup(
      <UnmappedListIds
        entries={entries}
        totalRows={2}
        withoutListId={{ official: { rows: 2, votes: 300 } }}
        unsummable={null}
      />,
    );

    expect(markup).toContain("2 de 2 filas (700 votos)");
    expect(markup).toContain("4321: 2 filas, 700 votos");
    expect(markup).toContain("2 filas oficial / 300 votos");
  });

  it("uses denominator-neutral copy for every unresolved identity caller", () => {
    const markup = renderToStaticMarkup(
      <UnmappedListIds
        label="2023"
        entries={entries}
        totalRows={4}
        withoutListId={{ official: { rows: 2, votes: 300 } }}
        unsummable={null}
      />,
    );

    expect(markup).toContain("Se informan por separado");
    expect(markup).toContain("sin un partido asignado");
    expect(markup).toContain("no se descartan silenciosamente");
    expect(markup).not.toContain("todos los denominadores");
    expect(markup).toContain("2023: 2 fila(s) no tienen id de lista");
  });
});
