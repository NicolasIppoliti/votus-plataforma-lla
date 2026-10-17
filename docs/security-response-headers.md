# App-owned security response headers

Votus enforces a nonce-based Content Security Policy independently of hosting
protection. `apps/web/src/lib/security/headers.ts` is the single policy builder.
Middleware applies it to public pages, authenticated pages, redirects and APIs;
`next.config.ts` supplies a nonce-free fallback for static assets and framework
errors. No hosting settings or authentication/cookie decisions are changed.

## Resource inventory

| Resource | Actual loading path and policy |
| --- | --- |
| Next.js runtime, hydration and route chunks | Same-origin external bundles plus inline framework scripts. Middleware forwards the CSP on the request; Next extracts its nonce and attaches it to scripts. Root layout awaits `connection()` so login is not prerendered without a nonce. |
| CSS | Global styles, CSS modules, Tailwind and dynamically imported MapLibre CSS are same-origin. React style props and MapLibre canvas/control positioning require inline styles. |
| Supabase | `src/lib/supabase/server-client.ts` and middleware use the public URL server-side; there is currently no browser Supabase client. Allow only the configured HTTP(S) origin and its WS(S) equivalent, not `*.supabase.co`. Paths are stripped; credentials and non-HTTP protocols are rejected. |
| Maps | `SectionReferenceMap.tsx` dynamically imports MapLibre and deck.gl, uses WebGL2 and MapLibre's blob worker. Its style has empty sources/layers: no remote basemap tiles, glyphs or sprites. National/province references use local geography and SVG. No map CDN is allowed. |
| Fonts | `next/font/google` fetches IBM Plex at build time and self-hosts the resulting font files under Next static assets; the browser does not need Google font origins. |
| Images | Same-origin images/SVG, plus `data:` and `blob:` for locally generated resources. No arbitrary remote image hosts. |
| Preview feedback | Vercel live feedback scripts/frames are not application dependencies and are deliberately not allowed, including on previews. No `vercel.live` exception or hosted-setting change. |

## Enforced policy

Production HTML uses the following value (N is a fresh cryptographically random
128-bit base64 nonce; SUPABASE and SOCKET are the configured origins):

```text
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; connect-src 'self' SUPABASE SOCKET; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; frame-src 'none'; form-action 'self';
```

| Directive | Reason |
| --- | --- |
| `default-src 'self'` | Restricts unspecified resource types to the application origin. |
| `script-src` | Nonce authorizes framework inline scripts; strict-dynamic permits their trusted chunk-loading chain. No production unsafe-inline, unsafe-eval or wasm-unsafe-eval. |
| `style-src` | The sole production unsafe allowance supports existing React style attributes and MapLibre-generated styles. A script nonce cannot authorize style attributes; adding one here would cause browsers to ignore unsafe-inline. |
| `connect-src` | Same-origin APIs/geography and only the configured Supabase origin pair. |
| `img-src`, `font-src` | Local images/generated image URLs and self-hosted fonts. |
| `worker-src` | MapLibre's blob worker, without allowing blob scripts generally. |
| `object-src 'none'` | No embedded plugin content. |
| `base-uri 'self'` | Prevents off-origin base URL injection. |
| `frame-ancestors 'none'` | No embedding of Votus, including same-origin frames. |
| `frame-src 'none'` | The application embeds no frames. |
| `form-action 'self'` | Login and other forms submit only to this app. |

The config fallback omits the nonce and strict-dynamic (script-src is self only).
It is not a permission to render static HTML containing inline scripts. Middleware
replaces it on application routes. Middleware's existing matcher still excludes
Next static/image paths and favicon so auth cannot intercept those resources.
The fallback also remains available if middleware throws before returning.

Development alone adds `script-src 'unsafe-eval'`, as required by the installed
Next 16.3.6 CSP guide for React debugging. There is no blanket WebSocket allowance
and no upgrade-insecure-requests directive: local HTTP Supabase must keep working.

Other response headers are:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), fullscreen=()
X-Robots-Tag: noindex, nofollow
```

Root metadata also emits `noindex, nofollow`. No robots.txt disallow is introduced:
crawlers must be able to see the directive. HSTS remains a hosting/TLS concern;
this change does not configure it for local HTTP or alter hosting protection.

## Change safely

1. Identify the production caller and exact origin/resource type before adding
   an allowance. Do not add wildcard origins or unsafe script execution to fix
   a blocked request. Keep credentials and session values out of diagnostics.
2. Add a policy assertion in `src/lib/security/headers.test.ts` and an entry-point
   regression where appropriate. Preserve fresh nonces through cookie refresh and
   never trust a caller-supplied CSP or x-nonce.
3. Run unit tests, typecheck, lint and Vitest, then the focused auth/root gate and
   full browser gate. The auth scenario checks login hydration, anonymous redirect,
   API errors/success, authenticated HTML and 404 headers. The municipal scenario
   owns its configured server/result fixture and checks a genuinely loaded MapLibre
   canvas with zero securitypolicyviolation events and CSP console errors.

## Authentication differential check

The original auth body is retained as `authenticatedResponse`; the source diff
changes only public-route request-header forwarding inside that body. Security
headers wrap its returned response, including cookie-refresh replacements.
Middleware regression cases lock the original outcomes below (the authenticated
pass-through is subsequently subject to the unchanged render-time workspace guard):

| Route | Anonymous middleware | Authenticated middleware |
| --- | --- | --- |
| `/` | 307 to login, returnTo `/` | 200 pass-through |
| `/login` | 200 pass-through; no Supabase call | 200 pass-through; no Supabase call |
| `/dashboard` | 307 to login, returnTo `/dashboard` | 200 pass-through |
| `/api/session` | 401 status-only JSON | 200 pass-through to API handler |

The pre-implementation run passed all 28 original middleware tests. Four added
anonymous cases reached their expected status assertions before failing on absent
headers. Post-implementation tests also cover the four authenticated paths,
existing cookie refresh/deletion semantics and retryable/definitive Auth errors.
This is source-and-regression comparison, not a separate hosted A/B deployment.

Nonce rendering disables static HTML/CDN reuse; do not introduce ISR or a cached
HTML shell without revisiting the nonce contract. Review policy changes against
the installed Next docs in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
and the adjacent proxy, connection and next-config headers API references.
