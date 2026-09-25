import { spawn } from "node:child_process";

const TIMEOUT_MS = 10 * 60_000;
const GRACE_MS = 5_000;
const MAX_STAGE_EVIDENCE_BYTES = 1024;
const MIGRATION_MARKER = "E2E_ETL_MIGRATION ";
const MIGRATION_NAME = /^(?:[0-9]{4}|[0-9]{14})_[a-z0-9_]+\.sql$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const STAGES = ["disposable_database_setup", "apply_migrations", "grant_test_privileges", "pytest", "owned_database_cleanup"] as const;
type EtlStage = (typeof STAGES)[number];

export const ETL_FAILURE_REASON = {
  CHILD_EXIT: "child_exit",
  SPAWN_ERROR: "spawn_error",
  TIMEOUT: "timeout",
  TIMEOUT_CLEANUP: "timeout_cleanup",
} as const;

export class OwnedEtlFailure extends Error {
  readonly reason: (typeof ETL_FAILURE_REASON)[keyof typeof ETL_FAILURE_REASON];
  readonly exitCode: number | null;
  readonly stage: EtlStage | null;
  readonly migration: string | null;
  readonly sqlstate: string | null;
  constructor(message: string, reason: (typeof ETL_FAILURE_REASON)[keyof typeof ETL_FAILURE_REASON], exitCode: number | null = null, stage: EtlStage | null = null, migration: string | null = null, sqlstate: string | null = null) {
    super(message);
    this.reason = reason;
    this.exitCode = exitCode;
    this.stage = stage;
    this.migration = migration;
    this.sqlstate = sqlstate;
  }
}

interface OwnedEtlOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

export function startOwnedEtlChild({ cwd, env }: OwnedEtlOptions): {
  completed: Promise<void>;
  stop: () => Promise<void>;
} {
  if (process.platform === "win32") throw new Error("POSIX process groups required; details redacted");
  const child = spawn("uv", ["run", "--project", "etl", "etl-verify"], {
    cwd, env: env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "ignore", "pipe"],
  });
  // Drain all stderr while retaining only one bounded line and validated stage evidence.
  const marker = "E2E_ETL_STAGE ";
  let line = "";
  let lineBytes = 0;
  let markerCount = 0;
  let stage: EtlStage | null = null;
  let migrationCount = 0;
  let migration: string | null = null;
  let sqlstate: string | null = null;
  function finishLine(): void {
    if (line.startsWith(marker)) {
      markerCount++;
      const candidate = line.slice(marker.length);
      stage = lineBytes <= MAX_STAGE_EVIDENCE_BYTES
        ? STAGES.find((value) => value === candidate) ?? null
        : null;
    }
    if (line.startsWith(MIGRATION_MARKER)) {
      migrationCount++;
      const candidate = line.slice(MIGRATION_MARKER.length);
      const separator = candidate.indexOf(" ");
      const name = candidate.slice(0, separator);
      const state = candidate.slice(separator + 1);
      migration = lineBytes <= MAX_STAGE_EVIDENCE_BYTES && name.length <= 128 && MIGRATION_NAME.test(name) && (SQLSTATE.test(state) || state === "-") && separator > 0 ? name : null;
      sqlstate = migration && SQLSTATE.test(state) ? state : null;
    }
    line = "";
    lineBytes = 0;
  }
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const byte of chunk) {
      if (byte === 10) { finishLine(); continue; }
      lineBytes++;
      if (lineBytes <= MAX_STAGE_EVIDENCE_BYTES) line += String.fromCharCode(byte);
    }
  });
  function parsedEvidence(): { stage: EtlStage | null; migration: string | null; sqlstate: string | null } {
    if (lineBytes > 0) finishLine();
    const validStage = markerCount === 1 ? stage : null;
    return { stage: validStage, migration: validStage === "apply_migrations" && migrationCount === 1 ? migration : null, sqlstate: validStage === "apply_migrations" && migrationCount === 1 && migration ? sqlstate : null };
  }
  const pid = child.pid;
  let closed = false;
  let closeResult: number | null = null;
  let resolveClose!: () => void;
  const close = new Promise<void>((resolve) => { resolveClose = resolve; });
  child.once("close", (code) => {
    closed = true;
    closeResult = code;
    resolveClose();
  });
  let rejectError!: () => void;
  let spawnErrorSeen = false;
  let clearCompletionTimer = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectError = () => reject(new OwnedEtlFailure("ETL child failed; details redacted", ETL_FAILURE_REASON.SPAWN_ERROR));
  });
  child.once("error", () => { spawnErrorSeen = true; clearCompletionTimer(); rejectError(); });

  let stopPromise: Promise<void> | undefined;
  function groupExists(): boolean {
    try { process.kill(-pid!, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw new Error("ETL group status unconfirmed; details redacted");
    }
  }
  function signal(signalName: NodeJS.Signals): void {
    if (closed || child.exitCode !== null || child.signalCode != null)
      throw new Error("ETL child signal unconfirmed; details redacted");
    try {
      if (child.kill(signalName)) return;
    } catch { /* Never expose process or environment details. */ }
    throw new Error("ETL child signal unconfirmed; details redacted");
  }
  async function stopOwned(): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid! <= 0) {
      if (pid === undefined && spawnErrorSeen) {
        if (!closed) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([close, new Promise<void>((resolve) => { timer = setTimeout(resolve, GRACE_MS); })]);
          } finally { if (timer) clearTimeout(timer); }
        }
        if (closed) return;
        throw new Error("ETL child close unconfirmed; details redacted");
      }
      throw new Error("ETL group identity invalid; details redacted");
    }
    if (closed) {
      if (groupExists()) throw new Error("ETL group remains after owner exit; details redacted");
      return;
    }
    if (groupExists()) {
      if (child.exitCode !== null || child.signalCode != null)
        throw new Error("ETL group remains after owner exit; details redacted");
      signal("SIGTERM");
    }
    await Promise.race([close, new Promise<void>((resolve) => setTimeout(resolve, GRACE_MS))]);
    if (groupExists()) {
      if (closed || child.exitCode !== null || child.signalCode != null) throw new Error("ETL group remains after owner exit; details redacted");
      signal("SIGKILL");
      await Promise.race([close, new Promise<void>((resolve) => setTimeout(resolve, GRACE_MS))]);
    }
    if (!closed || groupExists()) throw new Error("ETL group settlement unconfirmed; details redacted");
  }
  const stop = () => (stopPromise ??= stopOwned());
  const completedOnClose = new Promise<void>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stop().then(
        () => reject(new OwnedEtlFailure("ETL timed out; details redacted", ETL_FAILURE_REASON.TIMEOUT)),
        () => reject(new OwnedEtlFailure("ETL timeout cleanup unconfirmed; details redacted", ETL_FAILURE_REASON.TIMEOUT_CLEANUP)),
      );
    }, TIMEOUT_MS);
    clearCompletionTimer = () => clearTimeout(timer);
    void close.then(() => {
      clearCompletionTimer();
      if (timedOut) return;
      if (closeResult === 0) resolve();
      else {
        const evidence = parsedEvidence();
        reject(new OwnedEtlFailure("ETL child failed; details redacted", ETL_FAILURE_REASON.CHILD_EXIT, closeResult, evidence.stage, evidence.migration, evidence.sqlstate));
      }
    });
  });
  const completed = Promise.race([completedOnClose, failed]);
  return { completed, stop };
}
