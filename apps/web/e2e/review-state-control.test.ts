import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeReviewItems } from "../src/lib/workspace/review-items";
import {
  createReviewStateHandler,
  createReviewTestWorker,
  REVIEW_SAFE_STATE_PAYLOADS,
} from "./review-state-control";

const TEST_PROXY_ENVIRONMENT = "VOTUS_E2E_TEST_PROXY";
const initialTestProxyEnvironment = process.env[TEST_PROXY_ENVIRONMENT];

afterEach(() => {
  if (initialTestProxyEnvironment === undefined) delete process.env[TEST_PROXY_ENVIRONMENT];
  else process.env[TEST_PROXY_ENVIRONMENT] = initialTestProxyEnvironment;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function proxyRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: null,
    cache: "default",
    credentials: "same-origin",
    headers: [],
    integrity: "",
    method: "GET",
    mode: "cors",
    redirect: "follow",
    referrer: "about:client",
    referrerPolicy: "",
    url: "http://127.0.0.1:54321",
    ...overrides,
  };
}

describe("review test transport", () => {
  it("enables Next's test proxy only for the gate child environment", async () => {
    process.env[TEST_PROXY_ENVIRONMENT] = "1";
    vi.resetModules();

    const { default: nextConfig } = await import("../next.config");

    expect(nextConfig.experimental?.testProxy).toBe(true);
  });

  it.each([undefined, "true", "0"])(
    "keeps Next's test proxy off for an unrecognized gate environment: %s",
    async (gateValue) => {
      if (gateValue === undefined) delete process.env[TEST_PROXY_ENVIRONMENT];
      else process.env[TEST_PROXY_ENVIRONMENT] = gateValue;
      vi.resetModules();

      const { default: nextConfig } = await import("../next.config");

      expect(nextConfig.experimental?.testProxy).toBe(false);
    },
  );


  it("binds its registered per-test handler to IPv4 loopback", async () => {
    const worker = await createReviewTestWorker();
    try {
      expect(worker.host).toBe("127.0.0.1");
      expect(() => worker.onFetch("../foreign", () => undefined)).toThrow("review test ID");
      worker.onFetch("test-1", () => new Response("ok", { status: 503 }));
      const response = await fetch(`http://localhost:${worker.port}`, {
        method: "POST",
        body: JSON.stringify({
          api: "fetch",
          testData: "test-1",
          request: proxyRequest({ url: "http://127.0.0.1:54321/rest/v1/rpc/review_items", method: "POST" }),
        }),
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.response.status).toBe(503);
      expect(Buffer.from(body.response.body, "base64").toString()).toBe("ok");
      for (const payload of [{ api: "other" }, { api: "fetch", testData: "unknown", request: {} }]) {
        const rejected = await fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify(payload) });
        expect(rejected.status).toBe(400);
      }
      worker.cleanupTest("test-1");
      const missing = await fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify({ api: "fetch", testData: "test-1", request: proxyRequest() }) });
      expect(missing.status).toBe(404);
    } finally {
      await worker.close();
    }
  });

  it("rejects proxy payloads outside Next's encoded fetch wire format", async () => {
    const worker = await createReviewTestWorker();
    const payload = {
      api: "fetch",
      request: proxyRequest({ body: Buffer.from("wire").toString("base64"), method: "POST" }),
      testData: "wire",
    };
    try {
      worker.onFetch("wire", async (request) => new Response(await request.text()));
      const valid = await fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify(payload) });
      expect(Buffer.from((await valid.json()).response.body, "base64").toString()).toBe("wire");
      worker.onFetch("empty", () => new Response(""));
      const empty = await fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify({ ...payload, testData: "empty" }) });
      expect((await empty.json()).response.body).toBe("");
      for (const malformed of [
        { ...payload, extra: true },
        { ...payload, request: { ...payload.request, body: "not-base64" } },
      ]) {
        const rejected = await fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify(malformed) });
        expect(rejected.status).toBe(400);
      }
    } finally {
      await worker.close();
    }
  });

  it("closes a fast worker without leaving a listening proxy", async () => {
    const worker = await createReviewTestWorker();
    const port = worker.port;
    await worker.close();
    await expect(fetch(`http://localhost:${port}`)).rejects.toThrow();
  });

  it("releases a pending proxy request and terminates its server during teardown", async () => {
    const worker = await createReviewTestWorker();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = new Promise<void>(() => undefined);
    worker.onFetch("pending", async () => { markStarted(); await pending; return new Response("late"); });
    const response = fetch(`http://localhost:${worker.port}`, { method: "POST", body: JSON.stringify({ api: "fetch", testData: "pending", request: proxyRequest() }) });
    const port = worker.port;
    await started;
    await worker.close();
    expect(await (await response).json()).toEqual({ api: "abort" });
    await expect(fetch(`http://localhost:${port}`)).rejects.toThrow();
  });

  it("forwards permitted owned POSTs over the test worker", async () => {
    const worker = await createReviewTestWorker();
    const clientFetch = globalThis.fetch;
    const outboundFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const forwarded = input instanceof Request ? input : new Request(input, init);
      expect(forwarded.method).toBe("POST");
      expect(forwarded.headers.get("authorization")).toBe("Bearer review-token");
      expect(forwarded.headers.get("x-review-trace")).toBe("forwarded");
      expect(await forwarded.clone().text()).toBe('{"operation":"allowed"}');
      expect(init?.redirect).toBe("error");
      return new Response("forwarded", { headers: { "x-forwarded": "true" }, status: 201 });
    });
    vi.stubGlobal("fetch", outboundFetch);
    try {
      worker.onFetch("forward", createReviewStateHandler(`http://127.0.0.1:${worker.port}`));
      const response = await clientFetch(`http://localhost:${worker.port}`, {
        body: JSON.stringify({
          api: "fetch",
          request: proxyRequest({
            body: Buffer.from('{"operation":"allowed"}').toString("base64"),
            headers: [["authorization", "Bearer review-token"], ["x-review-trace", "forwarded"]],
            method: "POST",
            url: `http://127.0.0.1:${worker.port}/auth/v1/user`,
          }),
          testData: "forward",
        }),
        method: "POST",
      });
      const payload = await response.json();
      expect(payload.response.status).toBe(201);
      expect(Buffer.from(payload.response.body, "base64").toString()).toBe("forwarded");
      expect(payload.response.headers).toContainEqual(["x-forwarded", "true"]);
      expect(outboundFetch).toHaveBeenCalledTimes(1);
    } finally {
      await worker.close();
    }
  });

  it("aborts external fetches, forwards count-only review requests, and controls the exact review RPC", async () => {
    let matched = 0;
    const outboundFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const forwarded = input instanceof Request ? input : new Request(input, init);
      expect(forwarded.method).toBe("POST");
      expect(await forwarded.clone().text()).toBe('{"p_limit":0,"p_offset":0}');
      expect(init?.redirect).toBe("error");
      return new Response("count-only");
    });
    vi.stubGlobal("fetch", outboundFetch);
    const handler = createReviewStateHandler("http://127.0.0.1:54321", () => { matched += 1; });
    expect(await handler(new Request("https://example.test/"))).toBe("abort");
    const countOnly = await handler(new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { method: "POST", body: JSON.stringify({ p_limit: 0, p_offset: 0 }) }));
    expect(countOnly).toBeInstanceOf(Response);
    expect(await (countOnly as Response).text()).toBe("count-only");
    expect(matched).toBe(0);
    const response = await handler(new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { method: "POST", body: JSON.stringify({ p_limit: 50, p_offset: 0 }) }));
    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).json()).toMatchObject({ status: "authorization_denied" });
    expect(matched).toBe(1);
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });

  it("selects a response using the validated review offset without intercepting counts", async () => {
    const selectedOffsets: number[] = [];
    let matched = 0;
    const outboundFetch = vi.fn(async () => new Response("forwarded"));
    vi.stubGlobal("fetch", outboundFetch);
    const handler = createReviewStateHandler("http://127.0.0.1:54321", () => { matched += 1; }, (offset: number) => {
      selectedOffsets.push(offset);
      return Response.json({
        authorization_status: "authorized_empty", exclusions: [], items: [],
        status: "ok", total: 0, truncated: false,
      });
    });
    const request = (p_limit: number, p_offset: number) => new Request(
      "http://127.0.0.1:54321/rest/v1/rpc/review_items",
      { method: "POST", body: JSON.stringify({ p_limit, p_offset }) },
    );

    expect(await handler(request(50, -1))).toBe("abort");
    expect(await handler(request(50, 2_000_000_001))).toBe("abort");
    expect(await handler(request(51, 0))).toBe("abort");
    await handler(request(0, 0));
    expect(selectedOffsets).toEqual([]);
    expect(matched).toBe(0);
    for (const offset of [0, 50, 2_000_000_000]) {
      const response = await handler(request(50, offset));
      if (!(response instanceof Response)) throw new Error("expected selected review response");
      expect(sanitizeReviewItems(await response.json(), 50, offset)).toEqual({ status: "authorized_empty" });
    }
    expect(selectedOffsets).toEqual([0, 50, 2_000_000_000]);
    expect(matched).toBe(3);
    expect(outboundFetch).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(REVIEW_SAFE_STATE_PAYLOADS))(
    "projects the browser wire fixture through the real sanitizer as %s",
    async (status, payload) => {
      const handler = createReviewStateHandler("http://127.0.0.1:54321", undefined, () => Response.json(payload));
      const response = await handler(new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", {
        method: "POST", body: JSON.stringify({ p_limit: 50, p_offset: 0 }),
      }));
      if (!(response instanceof Response)) throw new Error("expected controlled review response");
      expect(response.status).toBe(200);
      expect(sanitizeReviewItems(await response.json(), 50, 0)).toEqual({ status });
    },
  );

  it("aborts malformed variants of the review RPC", async () => {
    const outboundFetch = vi.fn();
    vi.stubGlobal("fetch", outboundFetch);
    const handler = createReviewStateHandler("http://127.0.0.1:54321");
    const invalidRequests = [
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { method: "GET" }),
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items?extra", { body: JSON.stringify({ p_limit: 50, p_offset: 0 }), method: "POST" }),
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items#extra", { body: JSON.stringify({ p_limit: 50, p_offset: 0 }), method: "POST" }),
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { body: "{", method: "POST" }),
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { body: JSON.stringify({ extra: true, p_limit: 50, p_offset: 0 }), method: "POST" }),
      new Request("http://127.0.0.1:54321/rest/v1/rpc/review_items", { body: JSON.stringify({ p_limit: 50, p_offset: 2_000_000_001 }), method: "POST" }),
    ];
    for (const request of invalidRequests) expect(await handler(request)).toBe("abort");
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});
