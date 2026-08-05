/**
 * Reading query parameters, in ONE place.
 *
 * `stringParam` was copy-pasted into four routes, and the repeated-param fix
 * landed on exactly one of them: on the other three
 * `?electionId=A&electionId=B` still collapsed a SUPPLIED value to `undefined`,
 * so the page answered "Provide electionId" to a request that sent it twice.
 * Next.js hands `string[]` for a repeated param — supplied-but-unusable is a
 * third state, not absence.
 */

type ParamResult =
  | { status: "ok"; value: string }
  | { status: "absent" }
  | { status: "repeated" };

/** One parameter, distinguishing absent from supplied-more-than-once. */
function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): ParamResult {
  const value = params[key];
  if (Array.isArray(value)) return { status: "repeated" };
  if (typeof value === "string") return { status: "ok", value };
  return { status: "absent" };
}

/**
 * The plain accessor, for call sites that have already refused repeats.
 *
 * It returns `undefined` for a repeated param, which is why every route must
 * call `repeatedParams` FIRST — the docstring on the old per-file copy claimed
 * this function carried the third state, and it never did.
 */
export function stringParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const result = readParam(params, key);
  return result.status === "ok" ? result.value : undefined;
}

/** Every parameter supplied more than once, named. */
export function repeatedParams(
  params: Record<string, string | string[] | undefined>,
): string[] {
  return Object.entries(params)
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key)
    .sort();
}
