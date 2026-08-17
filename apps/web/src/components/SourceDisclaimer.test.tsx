import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceDisclaimer } from "./SourceDisclaimer";

/**
 * provenance-display spec: "Persistent non-official-source disclaimer" —
 * MUST be displayed on every view, and MUST NOT be permanently dismissible
 * such that it never appears again.
 */

describe("SourceDisclaimer", () => {
  it("test_disclaimer_present_and_not_permanently_dismissible", () => {
    const html = renderToStaticMarkup(<SourceDisclaimer />);
    expect(html).toContain("no es una fuente electoral oficial");

    // "Not permanently dismissible" is verified by construction: there is
    // no dismiss affordance at all (no button, no aria-hidden toggle) that
    // could ever suppress it, so re-rendering the same component (as every
    // fresh page render does) always reproduces the disclaimer.
    expect(html).not.toContain("<button");
    const secondRenderHtml = renderToStaticMarkup(<SourceDisclaimer />);
    expect(secondRenderHtml).toContain("no es una fuente electoral oficial");
  });
});
