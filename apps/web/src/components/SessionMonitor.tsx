"use client";

import { useEffect } from "react";

const CHECK_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Checks session validity only; electoral data and HttpOnly tokens stay server-side. */
export default function SessionMonitor() {
  useEffect(() => {
    let disposed = false;
    let redirecting = false;
    let inFlight: AbortController | null = null;

    const check = async () => {
      if (disposed || redirecting || document.hidden || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        let ended = response.status === 401;
        if (response.ok) {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && !Array.isArray(body)) {
            const status = (body as Record<string, unknown>)["status"];
            ended = status === "expired" || status === "revoked";
          }
        }
        if (ended && !disposed && !controller.signal.aborted && inFlight === controller) {
          redirecting = true;
          window.location.replace("/login");
        }
      } catch {
        // Offline, timeout, malformed response and temporary service failure do
        // not establish expiry. A later visible check can recover normally.
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };

    const onFocus = () => { void check(); };
    const onVisibilityChange = () => {
      if (document.hidden) {
        inFlight?.abort();
        inFlight = null;
      } else {
        void check();
      }
    };
    const interval = window.setInterval(() => { void check(); }, CHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void check();

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      inFlight?.abort();
    };
  }, []);

  return null;
}
