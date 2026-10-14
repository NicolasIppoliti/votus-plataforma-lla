import { describe, expect, it } from "vitest";
import { reviewKindLabel, reviewSeverityLabel } from "./review-labels";

describe("review display labels", () => {
  it.each([
    ["fetch_failure", "Error al descargar la fuente"],
    ["content_drift", "Contenido de la fuente modificado"],
    ["blank_vote_cell", "Celda de voto vacía"],
    ["duplicate_collapsed", "Duplicado idéntico consolidado"],
    ["mesa_discontinuity", "Mesa discontinua entre años"],
    ["mesa_tally_divergence", "Recuento distinto del oficial"],
    ["pba_conflicting_duplicate_semantic_result", "Resultado PBA duplicado en conflicto"],
  ])("labels %s in Spanish", (kind, label) => expect(reviewKindLabel(kind)).toBe(label));

  it("keeps an unknown kind visible as received instead of hiding it", () => {
    expect(reviewKindLabel("safe-state-kind-sentinel")).toBe("safe-state-kind-sentinel");
  });

  it.each([["info", "Informativa"], ["warning", "Advertencia"], ["error", "Error"], ["other", "other"]])(
    "labels severity %s", (severity, label) => expect(reviewSeverityLabel(severity)).toBe(label));
});
