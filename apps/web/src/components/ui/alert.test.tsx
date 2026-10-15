import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert";

describe("Alert", () => {
  it.each([
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
