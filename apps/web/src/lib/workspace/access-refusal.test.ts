import { expect, it } from "vitest";
import { classifyAccessRefusal } from "./access-refusal";

it("separates a missing organization and an ended context from a denial (#426)", () => {
  expect(classifyAccessRefusal("selection_required")).toBe("selection_required");
  expect(classifyAccessRefusal("context_expired")).toBe("context_ended");
  expect(classifyAccessRefusal("context_revoked")).toBe("context_ended");
  for (const status of ["authorization_denied", "membership_revoked", "scope_denied", "context_stale", "anything_else"]) {
    expect(classifyAccessRefusal(status)).toBe("denied");
  }
});
