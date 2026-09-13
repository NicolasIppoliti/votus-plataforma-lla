import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MobileNavigation } from "./MobileNavigation";

// Portal interaction, resize, queued focus and disclosure precedence are exercised
// through the real Root/Review browser entrypoints, not a mocked React scheduler.
test("the closed navigation exposes an opener without a second inline footer", () => {
  const markup = renderToStaticMarkup(
    <MobileNavigation sidebar={<footer>Server-composed account controls</footer>} />,
  );
  expect(markup).toContain("Abrir navegación");
  expect(markup).toContain('aria-haspopup="dialog"');
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('aria-controls="mobile-navigation-drawer"');
  expect(markup).not.toContain("Server-composed account controls");
  expect(markup).not.toContain('role="dialog"');
});
