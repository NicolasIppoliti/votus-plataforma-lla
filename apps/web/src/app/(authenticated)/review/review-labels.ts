/** Spanish display labels for review_item kinds and severities (database check-constraint values).
 * An unknown value is shown exactly as received, never hidden. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  ambiguous_mesa_circuito: "Mesa con circuito ambiguo",
  ambiguous_official_mesa_identity: "Identidad oficial de mesa ambigua",
  blank_vote_cell: "Celda de voto vacía",
  content_drift: "Contenido de la fuente modificado",
  duplicate_collapsed: "Duplicado idéntico consolidado",
  duplicate_conflict: "Duplicado en conflicto",
  fetch_failure: "Error al descargar la fuente",
  mesa_absent_from_official_import: "Mesa ausente del archivo oficial",
  mesa_discontinuity: "Mesa discontinua entre años",
  mesa_tally_divergence: "Recuento distinto del oficial",
  pba_conflicting_duplicate_semantic_result: "Resultado PBA duplicado en conflicto",
  pba_exact_duplicate_semantic_result: "Resultado PBA duplicado idéntico",
  pba_unreadable_vote_cell: "Celda de voto PBA ilegible",
  source_reexported: "Fuente reexportada",
  unmapped_jurisdiction: "Jurisdicción sin mapear",
  unmapped_party: "Agrupación sin mapear",
  unmergeable_row: "Fila no combinable",
  unreadable_vote_cell: "Celda de voto ilegible",
};
const SEVERITY_LABELS: Readonly<Record<string, string>> = { info: "Informativa", warning: "Advertencia", error: "Error" };

export const reviewKindLabel = (kind: string): string => (Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind]! : kind);
export const reviewSeverityLabel = (severity: string): string =>
  (Object.hasOwn(SEVERITY_LABELS, severity) ? SEVERITY_LABELS[severity]! : severity);
