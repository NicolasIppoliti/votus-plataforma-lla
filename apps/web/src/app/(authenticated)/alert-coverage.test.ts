import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// These announcements describe live progress, counts, or successful results;
// they are not refusal, warning, selection-required, or empty-state boxes.
const exceptions: Record<string, string[]> = {
  // Inline source-kind/granularity badges qualify figures, not refusal/empty boxes.
  "components/JuxtapositionBadge.tsx": ['<span role="status">', '<span role="status">'],
  "components/GranularityBadge.tsx": [
    '<span role="status" aria-label={`granularidad: ${inline(granularity)}`}>',
    '<span role="alert">', '<span role="alert">',
  ],
  // WorkspaceReviewStatus: queue summary, not an empty/refusal state.
  "WorkspaceTopbar.tsx": ['<div className="review-alert" role="status">'],
  // Header counters remain live summaries (including a zero/no-rows count).
  "panorama/PanoramaChildren.tsx": ['<p role="status">'],
  // Successful authorized-result scope, not an unavailable-result box.
  "municipal/page.tsx": ['<p role="status">'],
  // Pending/loading announcements suppress stale evidence while requests run.
  "ElectoralContextBar.tsx": ['<p role="status">'],
  "evidencia/EvidenceContext.tsx": ['<section className={styles.notice} role="status">'],
  "evidencia/loading.tsx": ['<section className={styles.notice} role="status">'],
  // Completeness metadata alongside the authorized evidence, not a refusal box.
  "evidencia/page.tsx": ['<p className={styles.status} role="status">'],
  // Filtered unit count in the inspection header.
  "evidencia/EvidenceUnits.tsx": ['<p role="status">'],
  // Pending selection transitions, never error/refusal/empty results.
  "drilldown/DrilldownSelectionForm.tsx": ['<p role="status" aria-live="polite">'],
  "compare/ComparisonSelectionForm.tsx": ['<p className={styles.pending} role="status" aria-live="polite">'],
  "fiscalizacion/FiscalizacionSelectionForm.tsx": ['<p className={styles.state} role="status" aria-live="polite">'],
  // Count of comparable pairs; the unavailable-comparison branch uses Alert.
  "compare/ComparisonChildren.tsx": ['<p role="status">'],
  // Successful fiscalización/official-result metadata summaries.
  "fiscalizacion/page.tsx": ['<p role="status">'],
  "drilldown/page.tsx": ['<p role="status">'],
  // Selected-circuit reference and successful hypothetical-output summaries.
  // Validation summaries are NOT excluded: all three must use Alert.
  "simulate/simulation-form.tsx": ['<p role="status">', '<p role="status" className="simulation-output__status">'],
};

function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("authenticated Alert coverage", () => {
  it("keeps refusal and empty announcements behind the shared Alert", () => {
    const root = join(process.cwd(), "src/app/(authenticated)");
    const violations: string[] = [];
    const components = join(process.cwd(), "src/components");
    for (const path of [...sources(root), ...sources(components)]) {
      const name = path.startsWith(components) ? `components/${relative(components, path)}` : relative(root, path);
      // The shared implementation owns the native role assignment.
      if (name === "components/ui/alert.tsx") continue;
      const approved = [...(exceptions[name] ?? [])];
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/<[A-Za-z][\w.]*\b[^>]*\brole=(?:"(?:alert|status)"|\{[^}]*\})[^>]*>/g)) {
        if (match[0].startsWith("<Alert ")) continue;
        const index = approved.indexOf(match[0]);
        if (index === -1) violations.push(`${name}: ${match[0]}`);
        else approved.splice(index, 1);
      }
      expect(approved, `stale announcement exceptions in ${name}`).toEqual([]);
    }
    expect(violations).toEqual([]);
  });
});
