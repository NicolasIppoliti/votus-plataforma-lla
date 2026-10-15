import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { profileSpan, profileRoute, PROFILE_REQUEST_HEADER, PROFILE_ROUTE_HEADER, type ProfileContext, type ProfileSpanName } from "./profile-span";

const scope = new AsyncLocalStorage<ProfileContext>();

/** Headers originate in middleware, which overwrites any incoming trace metadata. */
export async function profileServerSpan<T>(name: ProfileSpanName, operation: () => PromiseLike<T>): Promise<T> {
  if (process.env.VOTUS_PROFILE_SPANS !== "1") return operation();
  let context = scope.getStore();
  if (!context) {
    try {
      const incoming = await headers();
      const requestId = incoming.get(PROFILE_REQUEST_HEADER);
      if (requestId && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(requestId)) {
        context = { requestId, route: profileRoute(incoming.get(PROFILE_ROUTE_HEADER) ?? "other"), parentSpanId: null };
      }
    } catch { /* Pure loaders may also be called outside a Next request in tests. */ }
  }
  const spanId = crypto.randomUUID();
  const parent = context;
  return profileSpan(name, () => parent
    ? scope.run({ ...parent, parentSpanId: spanId }, operation)
    : operation(), parent, spanId);
}
