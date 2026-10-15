import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadRosalesReference } from "@/lib/geography/cne-rosales-reference";
import { RosalesReferenceSection } from "./RosalesReferenceSection";

describe("municipal polling-place selection", () => {
  it("links every plotted place to its complete table row without excluding unplotted places", async () => {
    const result = await loadRosalesReference();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("reference unavailable");
    const html = renderToStaticMarkup(<RosalesReferenceSection result={result} />);
    for (const locale of result.reference.locales) {
      expect(html).toContain(`id="cne-local-${locale.mesa_from}" tabindex="-1"`);
      if (locale.coordinates) expect(html).toContain(`href="#cne-local-${locale.mesa_from}"`);
      else expect(html).not.toContain(`href="#cne-local-${locale.mesa_from}"`);
    }
    expect(html.match(/<tr/g)).toHaveLength(32);
  });
});
