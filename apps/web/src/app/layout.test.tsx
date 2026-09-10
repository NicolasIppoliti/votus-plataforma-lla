import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const rootLayoutSource = readFileSync(
  new URL("./layout.tsx", import.meta.url),
  "utf8",
);

it("loads explicit IBM Plex fonts while preserving the root document contract", () => {
  expect(rootLayoutSource).toContain(
    'import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";',
  );
  expect(rootLayoutSource).toMatch(
    /IBM_Plex_Sans\(\{[\s\S]*display:\s*"swap"[\s\S]*variable:\s*"--font-sans"[\s\S]*\}\)/,
  );
  expect(rootLayoutSource).toMatch(
    /IBM_Plex_Mono\(\{[\s\S]*display:\s*"swap"[\s\S]*variable:\s*"--font-mono"[\s\S]*\}\)/,
  );
  expect(rootLayoutSource.match(/subsets:\s*\["latin"\]/g)).toHaveLength(2);
  expect(
    rootLayoutSource.match(/weight:\s*\["400", "500", "600", "700"\]/g),
  ).toHaveLength(2);
  expect(rootLayoutSource).toContain('<html lang="es">');
  expect(rootLayoutSource).toContain('className="skip-link" href="#main-content"');
  expect(rootLayoutSource).toContain("Votus | Análisis electoral interno");
  expect(rootLayoutSource).toContain(
    "className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}",
  );
});
