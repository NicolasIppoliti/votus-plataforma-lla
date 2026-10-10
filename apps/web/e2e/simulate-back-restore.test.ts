import { expect, test, vi } from "vitest";
import { writeSimulateBackRestore } from "./simulate-back-restore";

const capture = {
  version: 1,
  urlMatchesBaseline: true,
  inputMatchesBaseline: true,
  resultMatchesBaseline: false,
  resultShowsEditedList: true,
  resultBusy: false,
  resultLength: 1840,
  baselineLength: 1832,
  editorFirstListMatchesBaseline: true,
  elapsedMs: 5012,
};

test("writes a bounded, private, facts-only capture", async () => {
  const writer = vi.fn().mockResolvedValue(undefined);
  expect(await writeSimulateBackRestore(capture, { outputPath: (name) => name }, writer)).toBe(true);
  expect(writer).toHaveBeenCalledWith("simulate-back-restore.json", JSON.stringify(capture), { mode: 0o600, flag: "wx" });
  const call = writer.mock.calls[0];
  if (!call) throw new Error("Capture was not written");
  expect(Buffer.byteLength(call[1])).toBeLessThanOrEqual(1024);
});

test.each([
  ["an unversioned capture", { ...capture, version: undefined }],
  ["raw page text", { ...capture, resultText: "ALIANZA" }],
  ["an out-of-range length", { ...capture, resultLength: -1 }],
  ["an out-of-range elapsed time", { ...capture, elapsedMs: 10_000_000 }],
])("rejects %s without filesystem calls", async (_name, invalid) => {
  const outputPath = vi.fn((name: string) => name);
  const writer = vi.fn().mockResolvedValue(undefined);
  expect(await writeSimulateBackRestore(invalid, { outputPath }, writer)).toBe(false);
  expect(outputPath).not.toHaveBeenCalled();
  expect(writer).not.toHaveBeenCalled();
});

test("reports a failed write instead of throwing over the original assertion", async () => {
  const writer = vi.fn().mockRejectedValue(new Error("exists"));
  expect(await writeSimulateBackRestore(capture, { outputPath: (name) => name }, writer)).toBe(false);
});
