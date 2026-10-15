import { describe, expect, it } from "vitest";
import { MOBILE_FORM_ATTACHMENT, MOBILE_FORM_CONTENT_TYPE, MOBILE_FORM_FACTS_LIMIT, mobileFormFactsFromAttachments } from "./mobile-form-facts";

const facts = { version: 1, phase: "action-geometry", index: 2, viewportWidth: 390, sample: { kind: "action", width: 100, height: 40, left: 12, right: 112, scrollWidth: 98, scrollHeight: 38, valid: false } };
const attachment = (body: unknown) => ({ name: MOBILE_FORM_ATTACHMENT, contentType: MOBILE_FORM_CONTENT_TYPE, body: Buffer.from(JSON.stringify(body)) });
describe("mobile form failure facts boundary", () => {
  it("accepts only the bounded numeric/boolean snapshot", () => {
    expect(mobileFormFactsFromAttachments([attachment(facts)])).toEqual(facts);
  });
  it.each([
    { ...facts, message: "SECRET" },
    { ...facts, phase: "SECRET" },
    { ...facts, index: -1 },
    { ...facts, viewportWidth: 1_000_001 },
    { ...facts, sample: { ...facts.sample, value: "SECRET" } },
    { ...facts, sample: { ...facts.sample, width: -1 } },
    { ...facts, sample: { ...facts.sample, valid: "SECRET" } },
  ])("rejects extra text, invalid enums and unbounded metrics %#", candidate => {
    expect(mobileFormFactsFromAttachments([attachment(candidate)])).toBeUndefined();
  });
  it("never follows paths or decodes unrelated, oversized or invalid attachments", () => {
    for (const candidate of [
      { name: MOBILE_FORM_ATTACHMENT, contentType: MOBILE_FORM_CONTENT_TYPE, path: "/SECRET" },
      { ...attachment(facts), name: "SECRET" },
      { ...attachment(facts), contentType: "text/plain" },
      { ...attachment(facts), body: Buffer.alloc(MOBILE_FORM_FACTS_LIMIT + 1) },
      { ...attachment(facts), body: Buffer.from("SECRET invalid json") },
    ]) expect(mobileFormFactsFromAttachments([candidate])).toBeUndefined();
  });
});
