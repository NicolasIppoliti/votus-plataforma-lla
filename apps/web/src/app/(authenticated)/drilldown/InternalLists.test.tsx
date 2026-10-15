import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InternalLists } from "./InternalLists";

it("renders each measured non-positive kind separately without changing positive shares", () => {
  const html = renderToStaticMarkup(<InternalLists evidence={{
    status: "ok", authorization_status: "authorized", truncated: false,
    source_kind: "official", level: "seccion", source_granularity: "mesa",
    category_name: "PRESIDENTE/A", positive_total: 33250, lists: [],
    non_positive: { status: "available", totals: {
      "EN BLANCO": 2121, NULO: 319, IMPUGNADO: 12, RECURRIDO: 4, COMANDO: 12,
    } },
  }} />);
  expect(html).toContain("En blanco");
  expect(html).toContain("2.121 votos");
  expect(html).toContain("Nulos");
  expect(html).toContain("319 votos");
  expect(html).toContain("Impugnados");
  expect(html).toContain("Recurridos");
  expect(html).toContain("Comando");
  expect(html).toContain("33.250 votos");
  expect(html).not.toContain("No disponible");
});
