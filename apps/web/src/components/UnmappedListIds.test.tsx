import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnmappedListIds } from "./UnmappedListIds";

const entries = [{ listId: "4321", rows: 2, votes: 700 }];

describe("UnmappedListIds", () => {
  it("withholds vote totals and renders the exact source-kind reason", () => {
    const reason =
      "rows mix source kinds (fiscalizacion, official); official and fiscalización figures are never combined in one number";
    const markup = renderToStaticMarkup(
      <UnmappedListIds entries={entries} totalRows={2} unsummable={reason} />,
    );

    expect(markup).toContain("4321: 2 rows");
    expect(markup).not.toContain("4321: 2 rows, 700 votes");
    expect(markup).not.toContain("700 votes");
    expect(markup).toContain(reason);
  });

  it("omits every vote total from no-list-id tallies when rows cannot be combined", () => {
    const reason =
      "rows mix source kinds (fiscalizacion, official); official and fiscalización figures are never combined in one number";
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

    expect(markup).toContain("777: 1 rows");
    expect(markup).toContain("3 row(s) carry no list id at all");
    expect(markup).toContain("2 official row(s)");
    expect(markup).toContain("1 fiscalizacion row(s)");
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

    expect(markup).toContain("2 of 2 rows (700 votes)");
    expect(markup).toContain("4321: 2 rows, 700 votes");
    expect(markup).toContain("2 official row(s) / 300 vote(s)");
  });
});
