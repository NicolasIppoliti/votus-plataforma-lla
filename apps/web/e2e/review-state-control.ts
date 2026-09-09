import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { FetchHandlerResult } from "next/experimental/testmode/proxy";

const MAX_PROXY_BODY_BYTES = 128 * 1024;
const TEST_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const REVIEW_RPC_PATH = "/rest/v1/rpc/review_items";
const CONTROLLED_DENIAL = {
  authorization_status: null,
  exclusions: [],
  items: [],
  status: "authorization_denied",
  total: 0,
  truncated: false,
};

// Wire fixtures, not sanitized page mocks. The unavailable case exercises the
// sanitizer's unsupported-status refusal, not a thrown fetch/error boundary.
export const REVIEW_SAFE_STATE_PAYLOADS = {
  authorized_empty: {
    ...CONTROLLED_DENIAL, status: "ok", authorization_status: "authorized_empty",
  },
  authorization_denied: CONTROLLED_DENIAL,
  payload_too_large: {
    ...CONTROLLED_DENIAL, status: "payload_too_large", authorization_status: "authorized",
    total: 8675309, truncated: true, exclusions: [{ reason: "payload_bound" }],
  },
  unavailable: { ...CONTROLLED_DENIAL, status: "unavailable" },
} as const;

export type ReviewFetchHandler = (request: Request) => FetchHandlerResult | Promise<FetchHandlerResult>;
type RecordValue = Record<string, unknown>;

export interface ReviewTestWorker {
  host: "127.0.0.1";
  port: number;
  proxyPort: number;
  onFetch(testId: string, handler: ReviewFetchHandler): void;
  cleanupTest(testId: string): void;
  close(): Promise<void>;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proxyResponse(result: FetchHandlerResult) {
  if (!result) return { api: "unhandled" };
  if (result === "abort" || result === "continue") return { api: result };
  return result.arrayBuffer().then((body) => ({
    api: "fetch",
    response: {
      body: result.body ? Buffer.from(body).toString("base64") : null,
      headers: [...result.headers],
      status: result.status,
    },
  }));
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const declared = Number(request.headers["content-length"]);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_PROXY_BODY_BYTES) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PROXY_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validProxyFetch(value: unknown): value is RecordValue {
  const requestKeys = ["body", "cache", "credentials", "headers", "integrity", "method", "mode", "redirect", "referrer", "referrerPolicy", "url"];
  if (!isRecord(value) || Object.keys(value).length !== 3 || !["api", "request", "testData"].every((key) => Object.hasOwn(value, key)) || value.api !== "fetch" || typeof value.testData !== "string" || !TEST_ID.test(value.testData)) return false;
  const request = value.request;
  return isRecord(request) && Object.keys(request).length === requestKeys.length && requestKeys.every((key) => Object.hasOwn(request, key)) && typeof request.url === "string" && typeof request.method === "string" && [request.cache, request.credentials, request.integrity, request.mode, request.redirect, request.referrer, request.referrerPolicy].every((value) => typeof value === "string") && (request.body === null || typeof request.body === "string" && Buffer.from(request.body, "base64").toString("base64") === request.body) && Array.isArray(request.headers) && request.headers.every((header) => Array.isArray(header) && header.length === 2 && header.every((part) => typeof part === "string"));
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: Map<string, ReviewFetchHandler>,
  closing: Promise<void>,
  isClosing: () => boolean,
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/") return void response.writeHead(404).end();
  const body = await readBody(request);
  let payload: unknown;
  try { payload = body && JSON.parse(body.toString("utf8")); } catch { return void response.writeHead(400).end(); }
  if (!body || !validProxyFetch(payload)) return void response.writeHead(400).end();
  const handler = handlers.get(payload.testData as string);
  if (!handler) return void response.writeHead(404).end();
  try {
    const proxyRequest = payload.request as RecordValue;
    const fetchRequest = new Request(proxyRequest.url as string, {
      body: proxyRequest.body === null ? null : Buffer.from(proxyRequest.body as string, "base64"),
      headers: proxyRequest.headers as [string, string][],
      method: proxyRequest.method as string,
    });
    const result = await Promise.race([handler(fetchRequest), closing]);
    const serialized = await proxyResponse(isClosing() ? "abort" : result ?? undefined);
    response.writeHead(200, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(serialized));
  } catch {
    response.writeHead(400).end();
  }
}

export async function createReviewTestWorker(): Promise<ReviewTestWorker> {
  const handlers = new Map<string, ReviewFetchHandler>();
  let releaseClosing!: () => void;
  const closing = new Promise<void>((resolve) => { releaseClosing = resolve; });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const server = createServer((request, response) => void handleRequest(request, response, handlers, closing, () => closed));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("review test worker did not bind a loopback port");
  return {
    host: "127.0.0.1",
    port: address.port,
    proxyPort: address.port,
    onFetch: (testId, handler) => { if (!TEST_ID.test(testId)) throw new Error("review test ID is invalid"); handlers.set(testId, handler); },
    cleanupTest: (testId) => handlers.delete(testId),
    close: () => (closePromise ??= new Promise<void>((resolve, reject) => {
      closed = true;
      releaseClosing();
      server.close((error) => error ? reject(error) : resolve());
    }).then(() => server.closeAllConnections())),
  };
}

export function createReviewStateHandler(
  origin: string,
  onMatch?: () => void,
  selectResponse: (offset: number) => Response = () => Response.json(CONTROLLED_DENIAL),
): ReviewFetchHandler {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error("review state origin must be an exact loopback URL");
  return async (request) => {
    const url = new URL(request.url);
    if (url.origin !== endpoint.origin) return "abort";
    if (url.pathname !== REVIEW_RPC_PATH) return fetch(request, { redirect: "error" });
    if (request.method !== "POST" || url.search || url.hash) return "abort";
    let body: unknown;
    try { body = await request.clone().json(); } catch { return "abort"; }
    if (!isRecord(body) || Object.keys(body).length !== 2 || !Number.isSafeInteger(body.p_offset) || (body.p_offset as number) < 0 || (body.p_offset as number) > 2_000_000_000) return "abort";
    if (body.p_limit === 0) return fetch(request, { redirect: "error" });
    if (body.p_limit !== 50) return "abort";
    onMatch?.();
    return selectResponse(body.p_offset as number);
  };
}
