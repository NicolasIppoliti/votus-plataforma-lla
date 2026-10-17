import { describe, expect, it } from "vitest";
import { securityHeaders } from "./headers";

const nonce = "YWJjZGVmZ2hpamtsbW5vcA==";
describe("security header policy", () => {
  it("enforces a nonce policy with narrowly scoped resources", () => {
    const headers = securityHeaders({ nonce, supabaseUrl: "https://project.supabase.co/path" });
    const csp = headers["Content-Security-Policy"];
    for (const directive of ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, "style-src 'self' 'unsafe-inline'", "connect-src 'self' https://project.supabase.co wss://project.supabase.co", "img-src 'self' data: blob:", "font-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "frame-src 'none'", "form-action 'self'"]) expect(csp).toContain(directive);
    expect(csp.split(";").find(value => value.trim().startsWith("script-src"))).not.toMatch(/unsafe-/);
    expect(headers).toMatchObject({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex, nofollow" });
    for (const capability of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(headers["Permissions-Policy"]).toContain(`${capability}=()`);
    expect(csp).not.toContain("vercel.live");
  });
  it("allows eval only in development and local Supabase websockets", () => {
    const csp = securityHeaders({ nonce, development: true, supabaseUrl: "http://127.0.0.1:54321" })["Content-Security-Policy"];
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(securityHeaders({ nonce })["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });
  it("provides a nonce-free fallback without inline script permission", () => {
    expect(securityHeaders({})["Content-Security-Policy"]).toContain("script-src 'self';");
  });
  it.each(["bad'nonce", "bad;nonce", "", "injected\r\nheader"]) ("rejects malformed nonces: %j", value => {
    expect(() => securityHeaders({ nonce: value })).toThrow();
  });
  it.each(["javascript:alert(1)", "https://user:password@example.test", "not a URL"]) ("rejects invalid connection origins: %s", supabaseUrl => {
    expect(() => securityHeaders({ nonce, supabaseUrl })).toThrow();
  });
});
