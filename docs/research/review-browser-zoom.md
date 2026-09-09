# Native browser zoom: local feasibility verified, application acceptance pending

**Decision:** deliver three sequential reviewable units. A adds pagination and natural keyboard coverage using the existing authenticated review fixture. B owns a native-zoom context and exercises a real authenticated `/review` smoke test. C adds full 200% interaction and lifecycle coverage. Local feasibility is not Next integration or GitHub CI acceptance.

## Verified Chrome API contract

Source [1]: https://developer.chrome.com/docs/extensions/reference/api/tabs

- `setZoom(tabId, zoomFactor)` zooms the specified tab. Positive factors specify the factor; `0` restores the current default, not necessarily 100%. Always reset explicitly to `1`.
- Its promise resolves after the change. Independently require `getZoom(tabId)` readback; both promise forms are documented as Chrome 88+.
- Always supply the owned tab ID; omission targets the active tab of the current window. Resolve exactly one owned tab and retain its identity, failing on ambiguity.
- `setZoomSettings(tabId, {mode: 'automatic', scope: 'per-tab'})` selects browser-managed scaling. Do not use `manual`, which delegates scaling to the extension.
- Automatic mode defaults to per-origin sharing and persistence. Explicit per-tab scope avoids changing sibling tabs.
- Per-tab zoom and settings reset on navigation. Apply settings after final navigation and reapply/check after subsequent navigations.

## Launcher guidance and exact local probe

Source [2]: https://playwright.dev/docs/chrome-extensions

- Extensions require a persistent Chromium context. Chrome and Edge removed the side-loading flags; use Playwright's bundled Chromium, not branded channels.
- The guide uses `launchPersistentContext`, `--disable-extensions-except`, `--load-extension`, and an owned extension directory. `channel: 'chromium'` enables headless extensions.
- The MV3 example discovers the context's service worker or waits for `serviceworker`. Current documentation alone is not release-pinned runtime evidence.

Initial pinned lookup [3]: https://raw.githubusercontent.com/microsoft/playwright/v1.62.1/docs/src/chrome-extensions-js.md

- This URL returned HTTP 404. That is not evidence that the release is absent or unsupported. Initial package lookups at the worktree root missed the application's installed packages.
- The initial research comprised six bounded first-party GET attempts, with one output-size guard rejection. It ran no browser and established only partial feasibility.

**Subsequent parent-owned local probe:** Playwright 1.62.1, Chromium 151.0.7922.34, headless `channel: 'chromium'`, minimal MV3 extension with no permissions.

| Measurement | Baseline | Native 200% | Explicit reset |
| --- | --- | --- | --- |
| Independent native factor | 1 | 2 | 1 |
| Inner width / client width / probe box width | 1280 | 640 | 1280 |
| Outer window width | 1280 | 1280 | 1280 |

One execution/context completed; context and server closed. The parent removed only its owned profile, temporary resources, and sandbox; evidence remains privately preserved. This verifies native layout scaling on the probe, not the authenticated application, sibling-tab isolation, restricted-page behavior, or GitHub runners.

## Installed framework findings and unit B obligations

Source [4]: installed `next/experimental/testmode/playwright` fixture and Playwright fixture/context implementation, inspected by the parent in the application dependency tree.

- Next's provided auto-fixture binds instrumentation to `page.context()`; preserve its baseURL, default context options, timeouts, and trace hooks rather than building a parallel unmanaged browser.
- Persistent-context protocol drops `storageState`. Future B must call the public `context.setStorageState(realLoginState)` before the actual test page or any application navigation. No authentication bypass or replacement login state is acceptable.
- The ordinary default page fixture calls `newPage()`. If needed, retain the captured initial blank page until the actual test page exists; close only that captured identity, never an arbitrary first page.
- Next unregisters its per-test fetch handler but does not unroute the context; the owned persistent context must close during teardown. Actual Next integration remains pending CI.
- Only the future zoom context uses `viewport: null` and a fixed window. Ordinary touch and viewport behavior remain unchanged.
- Project screenshots and traces remain off, as approved. No manual recorder or authentication traces.

## Acceptance and resource boundaries

- B must include a reachable real `/review` smoke test using existing real-login/workspace setup and cleanup, not an unused zoom fixture.
- Require native factor readback plus a materially smaller CSS layout viewport at unchanged outer width. CSS zoom, DPR emulation, viewport resizing, and pinch/page-scale emulation are not substitutes.
- C covers unchanged-factor control, same-origin sibling isolation, navigation reapplication, explicit reset restoring baseline, and usable review layout/interactions at 200%. Allow scrollbar/rounding differences in layout measurements.
- In `finally`, attempt reset while the owned tab is alive, close the context regardless of reset failure, and clean only owned profile resources. Preserve original failures and surface teardown failures; never skip startup/readback failures.
- No human profile, cookies, remote-debugging port, privileged OS automation, public port, production endpoint, or global browser setting changes. Restrict the driver to the owned HTTP(S) page; restricted schemes remain unverified.
- Each unit must fit 400 authored additions plus deletions, including this entire initially untracked note. Do not compress resource safety or erase evidence to fit a forecast.

## Unit A evidence boundary

Pagination payloads are presentation-only wire fixtures validated through the real sanitizer and existing guarded fetch controller. Count-only requests still reach the real database. Tests preserve loading, retry, safe-state, and regional-focus coverage while adding actual URL transitions, masked windows, 320px taps, and fresh-document keyboard order.

Unit tests and Playwright registration can validate fixture behavior and test discovery; they cannot prove browser interactions. New E2E scenarios remain authored but unrun until the parent's GitHub CI publication. Units B and C, real application zoom acceptance, and CI outcomes remain open.
