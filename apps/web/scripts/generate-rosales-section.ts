import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { deriveRosalesSection, SECTION_SOURCE, sha256 } from "../src/lib/geography/rosales-section-artifact.ts";

const { values } = parseArgs({ options: {
  "source-root": { type: "string", default: "../.." },
  "output-dir": { type: "string", default: "data/geography" },
} });
const root = resolve(values["source-root"]!);
const bytes = deriveRosalesSection(
  JSON.parse(await readFile(resolve(root, "archive-manifest.json"), "utf8")),
  await readFile(resolve(root, SECTION_SOURCE.archived_path)),
);
const digest = sha256(bytes);
const filename = `cne-rosales-section.${digest}.json`;
const output = resolve(values["output-dir"]!);
await mkdir(output, { recursive: true });
try {
  await writeFile(resolve(output, filename), bytes, { flag: "wx" });
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  if (!(await readFile(resolve(output, filename))).equals(bytes)) throw new Error("existing_artifact_mismatch");
}
console.log(JSON.stringify({ filename, sha256: digest, bytes: bytes.length }));
