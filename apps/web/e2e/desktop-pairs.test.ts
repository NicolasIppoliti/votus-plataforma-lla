import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const tool = new URL("../../../docs/visual-review/pair-desktop.mjs", import.meta.url);
// Drive the actual CLI without writing artifacts outside the authorized surfaces.
function run(input: unknown) {
  return spawnSync(process.execPath, [tool.pathname, "--stdin"], {
    input: JSON.stringify(input), encoding: "utf8",
  });
}
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
};
const input = () => ({ name: "evidencia", production: { png: png(1440, 3611), fullPage: true }, prototype: { png: png(1276, 2400), fullPage: true }, segmentHeight: 900 });

describe("desktop same-scale pairing CLI", () => {
  it("retains production below 900px and crops equal-height native-scale segments", () => {
    const result = run(input());
    expect(result.status, result.stderr).toBe(0);
    const pairs = JSON.parse(result.stdout);
    expect(pairs).toHaveLength(5);
    expect(pairs[1].svg).toContain('y="-900"');
    expect(pairs[1].svg).toContain('width="1440" height="3611"');
    expect(pairs[1].svg).toContain('width="1276" height="2400"');
    expect(pairs[1].svg).toContain("no son viewports idénticos");
    expect(pairs[4].svg).toContain("Fin de captura del prototipo");
    expect(pairs[4].range).toEqual([3600, 3611]);
    expect(pairs[1].svg).not.toContain("scale(");
  });
  it.each([false, undefined])("rejects unconfirmed full-page production (%s)", (fullPage) => {
    const data = input();
    Object.assign(data.production, { fullPage });
    const result = run(data);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("fullPage");
  });
  it("rejects unsupported widths and invalid segment heights", () => {
    const data = input();
    data.production.png = png(900, 3611);
    expect(run(data).status).not.toBe(0);
    const invalid = input();
    invalid.segmentHeight = 0;
    expect(run(invalid).status).not.toBe(0);
  });
});
