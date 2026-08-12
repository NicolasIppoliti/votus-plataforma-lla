import type { CleanupAction, GateOwnership } from "../e2e/gate-contract";
export const SUPABASE_START_TIMEOUT_MS = 10 * 60_000;
export interface PortReservation { port: number; release(): Promise<void>; }
interface OwnershipState { ownership?: GateOwnership; }
interface OwnershipEffects { createWorkdir(): void; writeMarker(): void; rollbackWorkdir(): void; }
export interface StackStatus {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}
function collect(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) errors.push(...error.errors);
  else errors.push(error);
}
export async function runOwnedCleanup(actions: readonly CleanupAction[],
  execute: (action: CleanupAction) => Promise<void>,
  verifyResiduals: () => Promise<void>): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions)
    try { await execute(action); } catch (error) { collect(errors, error); }
  try { await verifyResiduals(); } catch (error) { collect(errors, error); }
  if (errors.length > 0) throw new AggregateError(errors, "owned cleanup failed");
}
export async function runOwnedServerCleanup<T>(servers: readonly T[],
  stop: (server: T) => Promise<void>, verify: (server: T) => Promise<void>): Promise<void> {
  const errors: unknown[] = [];
  for (const server of servers)
    try { await stop(server); } catch (error) { collect(errors, error); }
  for (const server of servers)
    try { await verify(server); } catch (error) { collect(errors, error); }
  if (errors.length > 0) throw new AggregateError(errors, "owned server cleanup failed");
}
export function establishOwnership(state: OwnershipState, ownership: GateOwnership,
  effects: OwnershipEffects): void {
  state.ownership = ownership;
  try {
    effects.createWorkdir();
    effects.writeMarker();
  } catch (error) {
    try { effects.rollbackWorkdir(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "ownership establishment failed");
    } finally {
      delete state.ownership;
    }
    throw error;
  }
}
export async function reserveUniquePorts(count: number,
  reserve: () => Promise<PortReservation>): Promise<PortReservation[]> {
  const reservations: PortReservation[] = [];
  while (reservations.length < count) {
    const candidate = await reserve();
    if (reservations.some(({ port }) => port === candidate.port)) await candidate.release();
    else reservations.push(candidate);
  }
  return reservations;
}
export function assertStackStatus(output: string, expectedApiPort: number): StackStatus {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new Error("Supabase status is not valid JSON"); }
  if (!parsed || typeof parsed !== "object") throw new Error("Supabase status is not an object");
  const status = parsed as Record<string, unknown>;
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "DB_URL"] as const)
    if (typeof status[key] !== "string" || !status[key]) throw new Error(`Supabase status omitted ${key}`);
  const apiUrl = new URL(status["API_URL"] as string);
  if (apiUrl.hostname !== "127.0.0.1") throw new Error("Supabase API URL is not exact loopback");
  if (Number(apiUrl.port) !== expectedApiPort) throw new Error("Supabase API port does not match reservation");
  const dbUrl = new URL(status["DB_URL"] as string);
  if (!dbUrl.protocol.startsWith("postgres") || dbUrl.hostname !== "127.0.0.1")
    throw new Error("Supabase DB_URL is not an exact loopback Postgres endpoint");
  return status as unknown as StackStatus;
}
export function assertTs7Version(output: string): void {
  if (!/^Version 7\./.test(output.trim())) throw new Error("TypeScript 7.x is required");
}
