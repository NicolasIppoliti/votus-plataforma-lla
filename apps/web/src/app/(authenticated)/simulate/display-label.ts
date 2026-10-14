const LABELS: Readonly<Record<string, string>> = {
  pba_municipal: "Concejales (concejo municipal)",
  pba_provincial: "Legisladores provinciales (PBA)",
  national: "Diputados nacionales",
  seccion: "sección",
  circuito: "circuito",
  mesa: "mesa",
  establecimiento: "establecimiento",
  distrito: "distrito",
};

/** One display boundary; unknown codes remain explicit rather than guessed. */
export function simulationDisplayLabel(value: string): string {
  return LABELS[value] ?? `no informado (${value})`;
}
