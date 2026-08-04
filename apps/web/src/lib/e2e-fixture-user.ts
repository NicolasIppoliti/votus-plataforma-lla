/**
 * access-control / 14c, task 14.8: the pure lookup `e2e/global-setup.ts`
 * and `e2e/global-teardown.ts` use to find the seeded e2e fixture user
 * (via the Supabase Admin API's `auth.admin.listUsers()`) by email --
 * kept separate from the Admin API call site so it stays independently
 * unit-testable (vitest only covers `src/**`, not `e2e/**`).
 */

export interface MinimalAuthUser {
  id: string;
  email?: string | null;
}

/**
 * Find a user by email, case-insensitively -- Supabase Auth treats email
 * as case-insensitive for uniqueness, so a lookup that only matched exact
 * case could miss a stale fixture user and attempt to create a duplicate.
 */
export function findUserByEmail<T extends MinimalAuthUser>(
  users: readonly T[],
  email: string,
): T | undefined {
  const target = email.toLowerCase();
  return users.find((user) => (user.email ?? "").toLowerCase() === target);
}
