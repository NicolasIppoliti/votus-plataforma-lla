/** One boundary for territory display names (#611, rule 8). Official files spell
 * the same distrito or sección in upper case (2025) or mixed case (2023); turning
 * an all-upper-case spelling into mixed case makes both read the same, so a
 * case-only difference is never reported as conflicting names. Mixed-case
 * spellings are kept as published. */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e"]);

export function displayTerritoryName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name !== name.toLocaleUpperCase("es")) return name;
  return name.toLocaleLowerCase("es").split(" ").map((word, index) =>
    index > 0 && PARTICLES.has(word) ? word : word.charAt(0).toLocaleUpperCase("es") + word.slice(1)).join(" ");
}

/** Nullable source names, as parsed from authorized evidence rows. */
export function territoryName(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? displayTerritoryName(raw) : null;
}
