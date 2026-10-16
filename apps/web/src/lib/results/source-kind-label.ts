/** One boundary for source-kind display labels (#612): never echo a machine value. */
const SOURCE_KIND_LABELS: Readonly<Record<string, string>> = {
  official: "oficial",
  fiscalizacion: "fiscalización",
  unknown: "desconocida",
};

export function sourceKindLabel(kind: string): string {
  return SOURCE_KIND_LABELS[kind] ?? "Sin clasificar";
}
