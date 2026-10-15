import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResponsiveSelect } from "./ResponsiveSelect";

const options = <><option value="">Seleccionar</option><option value="long">Una denominación electoral sintética suficientemente larga para envolver</option></>;
// Production callers include arrays of native options; fragments are supported too.
const directOptions = [<option key="empty" value="">Seleccionar</option>, <option key="long" value="long">Una denominación electoral sintética suficientemente larga para envolver</option>];

describe("ResponsiveSelect", () => {
  it("preserves native names, labels, disabled state and full selected text without duplicating its accessible name", () => {
    const html = renderToStaticMarkup(<label htmlFor="scope">Alcance<ResponsiveSelect id="scope" name="scope" value="long" disabled aria-describedby="help">{directOptions}</ResponsiveSelect></label>);
    expect(html).toContain('<select id="scope" name="scope" disabled="" aria-describedby="help"');
    expect(html).toContain('<option value="long" selected="">');
    expect(html).toContain('data-mobile-select-value="" aria-hidden="true">Una denominación electoral sintética suficientemente larga para envolver</span>');
  });
  it("renders default values for native GET forms and the first option when no value is supplied", () => {
    const html = renderToStaticMarkup(<ResponsiveSelect defaultValue="long">{directOptions}</ResponsiveSelect>);
    expect(html).toContain('aria-hidden="true">Una denominación electoral sintética suficientemente larga para envolver</span>');
    expect(renderToStaticMarkup(<ResponsiveSelect>{directOptions}</ResponsiveSelect>)).toContain('aria-hidden="true">Seleccionar</span>');
  });
  it("supports implicit option values, empty options and numeric values", () => {
    expect(renderToStaticMarkup(<ResponsiveSelect value="Rosales"><option>Argentina</option><option>Rosales</option></ResponsiveSelect>)).toContain('aria-hidden="true">Rosales</span>');
    expect(renderToStaticMarkup(<ResponsiveSelect value={2}><option value={1}>Uno</option><option value={2}>Dos</option></ResponsiveSelect>)).toContain('aria-hidden="true">Dos</span>');
    expect(renderToStaticMarkup(<ResponsiveSelect />)).toContain('aria-hidden="true"></span>');
  });
  it("uses the first enabled native option and supports option groups", () => {
    expect(renderToStaticMarkup(<ResponsiveSelect><option value="" disabled>Elegir</option><optgroup label="Grupo"><option value="one">Primera opción</option></optgroup></ResponsiveSelect>)).toContain('aria-hidden="true">Primera opción</span>');
  });
  it("supports fragments of options", () => {
    expect(renderToStaticMarkup(<ResponsiveSelect value="long">{options}</ResponsiveSelect>)).toContain('aria-hidden="true">Una denominación electoral sintética suficientemente larga para envolver</span>');
  });
});
