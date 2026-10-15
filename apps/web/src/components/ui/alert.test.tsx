import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { EvidenceState } from "../EvidenceState";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert";

describe("Alert", () => {
  it("preserves the danger variant through the rendered error entry point", () => {
    const html = renderToStaticMarkup(<EvidenceState state="error" title="Error" titleId="error" />);
    expect(html).toContain('data-variant="error"');
    expect(html).toContain('role="alert"');
  });
  it("supports an inline presentation without the full-width box", () => {
    const html = renderToStaticMarkup(<Alert variant="caveat" presentation="inline">Mensaje</Alert>);
    expect(html).toContain('workspace-alert--inline');
    expect(html).not.toContain('w-full');
    expect(html).toContain('role="status"');
  });
  it.each([
    ["error", "alert"],
    ["denied", "alert"],
    ["unavailable", "alert"],
    ["needs-selection", "status"],
    ["empty", "status"],
    ["caveat", "status"],
  ] as const)("announces %s as %s and supports an action", (variant, role) => {
    const html = renderToStaticMarkup(<Alert variant={variant} action={<Link href="/">Volver</Link>}>Mensaje</Alert>);
    expect(html).toContain(`role="${role}"`);
    expect(html).toContain(`data-variant="${variant}"`);
    expect(html).toContain('<a href="/">Volver</a>');
  });
});
