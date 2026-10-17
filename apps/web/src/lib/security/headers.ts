interface PolicyOptions {
  nonce?: string;
  supabaseUrl?: string | undefined;
  development?: boolean;
}

/** Shared by config (fallback) and middleware (request-specific nonce). */
export function securityHeaders({ nonce, supabaseUrl, development = false }: PolicyOptions) {
  if (nonce !== undefined && !/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error("Invalid CSP nonce");
  }
  const connections = ["'self'"];
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Invalid Supabase origin");
    }
    connections.push(url.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    connections.push(url.origin);
  }
  const script = ["'self'", ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []), ...(development ? ["'unsafe-eval'"] : [])];
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src ${script.join(" ")}`,
      // MapLibre positions canvases/controls inline; React components also use style props.
      "style-src 'self' 'unsafe-inline'",
      `connect-src ${connections.join(" ")}`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
    ].join("; ") + ";",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), fullscreen=()",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
