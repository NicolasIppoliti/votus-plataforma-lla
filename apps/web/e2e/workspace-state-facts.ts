import { writeFile } from "node:fs/promises";
import type { ElementHandle, Locator, Page, TestInfo } from "@playwright/test";

interface WorkspaceStateFacts {
  pathname: string;
  headings: string[];
  alerts: string[];
  statuses: string[];
}

// Diagnostics must never serialize arbitrary DOM text (including organization
// option labels), credentials, errors, or a URL's query string. Unknown copy is
// represented explicitly rather than guessed safe by a redaction regex.
const SAFE_COPY = new Set([
  "Panorama", "Comparación electoral", "Cola de revisión", "Elementos pendientes",
  "Seleccioná una organización", "Organización no disponible",
  "Elegí una organización autorizada para cargar los datos de esta página.",
  "No tenés autorización para acceder a esta organización.",
  "No tiene autorización vigente para consultar toda la comparación.",
  "No tiene autorización para cargar las opciones de comparación. Verifique su sesión y espacio de trabajo.",
  "Las opciones de comparación están temporalmente no disponibles. La solicitud pudo superar el tiempo de espera. Intente nuevamente.",
  "La comparación autorizada excede el límite seguro y no se muestran cifras.",
  "La evidencia autorizada no superó la validación integral y no se muestran cifras.",
  "No hay evidencia oficial completa para ambas selecciones.",
  "La evidencia oficial autorizada no está disponible y no se muestran cifras.",
  "No se pudo autorizar la cola de revisión.",
  "El contexto de organización venció. Volvé a iniciar sesión.",
  "El contexto de organización fue revocado. Volvé a iniciar sesión.",
  "No se pudo verificar la organización. Intentá de nuevo más tarde.",
  "Tu acceso a la organización activa cambió. Seleccioná una organización autorizada nuevamente.",
  "Seleccioná una organización para continuar.",
  "No hay organizaciones disponibles.", "Organización activa.",
  "Ya no tenés acceso a esa organización.",
  "No se pudo cambiar la organización.",
  "No se pudo cargar la organización.",
  "No se pudo verificar que este contexto pertenezca a tu sesión.",
  "La organización cambió en otra pestaña. Actualizá la página e intentá de nuevo.",
]);

export function sanitizeWorkspaceStateFacts(facts: WorkspaceStateFacts): WorkspaceStateFacts {
  const pathname = facts.pathname.split(/[?#]/, 1)[0]!;
  const texts = (values: string[]) => values.slice(0, 20).map(value => {
    const text = value.replace(/\s+/g, " ").trim();
    return SAFE_COPY.has(text) ? text : "[unrecognized UI text]";
  });
  return {
    pathname: ["/", "/login", "/compare", "/review", "/drilldown"].includes(pathname) ? pathname : "[unrecognized route]",
    headings: texts(facts.headings), alerts: texts(facts.alerts), statuses: texts(facts.statuses),
  };
}

interface FocusFacts {
  focusedId: string; focusedTag: string; focusedName: string; controlId: string;
  controlReplaced: boolean; searchKeys: string[];
}
export function sanitizeFocusFacts(facts: FocusFacts): FocusFacts {
  const allow = (value: string, known: string[]) => known.includes(value) ? value : "[unrecognized]";
  const ids = ["", "coverage-election", "coverage-category", "coverage-distrito", "coverage-seccion"];
  const names = ["", "electionId", "categoryId", "distritoCode", "seccionCode", "sourceKind"];
  return { focusedId: allow(facts.focusedId, ids), focusedTag: allow(facts.focusedTag, ["SELECT", "BUTTON", "BODY", "INPUT", "A", "HTML"]),
    focusedName: allow(facts.focusedName, names), controlId: allow(facts.controlId, ids), controlReplaced: facts.controlReplaced,
    searchKeys: facts.searchKeys.slice(0, 20).map(key => allow(key, names)) };
}

export async function writeFocusFacts(testInfo: TestInfo, name: string, control: Locator, original: ElementHandle): Promise<void> {
  const facts = await control.evaluate((element, previous) => ({
    focusedId: document.activeElement?.id ?? "", focusedTag: document.activeElement?.tagName ?? "",
    focusedName: document.activeElement?.getAttribute("name") ?? "", controlId: element.id,
    controlReplaced: element !== previous, searchKeys: Array.from(new URL(location.href).searchParams.keys()),
  }), original);
  await writeFile(testInfo.outputPath(`e2e-facts-${name}.json`), JSON.stringify(sanitizeFocusFacts(facts)));
}

export async function writeWorkspaceStateFacts(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const facts = await page.evaluate(() => {
    const texts = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
      .slice(0, 20).map(element => {
        const copy = element.cloneNode(true) as HTMLElement;
        // An outer selection status also contains the organization selector.
        copy.querySelectorAll("select, option, input, textarea, button, label").forEach(control => control.remove());
        return copy.textContent ?? "";
      });
    return { pathname: location.pathname, headings: texts("main h1, main h2, main [role=heading]"),
      alerts: texts("main [role=alert]"), statuses: texts("main [role=status]") };
  });
  const selectionRequiredPresent = await page.getByRole("region", { name: "Selección de organización", exact: true }).isVisible();
  await writeFile(testInfo.outputPath(`e2e-facts-${name}.json`), JSON.stringify({ ...sanitizeWorkspaceStateFacts(facts), selectionRequiredPresent }));
}
