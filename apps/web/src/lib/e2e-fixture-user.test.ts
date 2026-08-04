import { describe, expect, it } from "vitest";

import { findUserByEmail } from "./e2e-fixture-user";

/**
 * access-control / 14c, task 14.8: `e2e/global-setup.ts` needs to find a
 * STALE fixture user left over from a previous interrupted run before
 * seeding a fresh one, so re-running the e2e suite stays reproducible
 * instead of erroring on a duplicate email. `findUserByEmail` is the pure
 * lookup that decision depends on -- exercised directly here so the
 * Supabase Admin API call site itself stays a thin wrapper.
 */
describe("findUserByEmail", () => {
  it("returns the user whose email matches, case-insensitively", () => {
    const users = [
      { id: "a", email: "someone-else@example.test" },
      { id: "b", email: "Votus-E2E-Fixture@Example.test" },
    ];

    const found = findUserByEmail(users, "votus-e2e-fixture@example.test");

    expect(found).toEqual({ id: "b", email: "Votus-E2E-Fixture@Example.test" });
  });

  it("returns undefined when no user matches", () => {
    const users = [{ id: "a", email: "someone-else@example.test" }];

    expect(findUserByEmail(users, "votus-e2e-fixture@example.test")).toBeUndefined();
  });

  it("returns undefined for an empty user list", () => {
    expect(findUserByEmail([], "votus-e2e-fixture@example.test")).toBeUndefined();
  });
});
