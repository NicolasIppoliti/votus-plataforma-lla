# Browser coverage: Chrome primary, Firefox/WebKit critical journeys

Google Chrome remains the primary testing browser (`channel: "chrome"`). The
owned release gate adds a bounded Firefox/WebKit lane, not three copies of the
full suite. Native zoom retains its bundled Chromium extension fixture.

## Coverage

| Browser project | Coverage | When |
| --- | --- | --- |
| `chrome` | Existing complete suite, or explicitly focused specs | Default local and existing CI gate |
| `firefox` | Four `@cross-browser` critical journeys | Additional lane only |
| `webkit` | Same four critical journeys | Additional lane only |

The additional projects reuse existing tests:

- `auth.spec.ts`: real login, session monitor, cookie removal and redirect to login.
- `review.spec.ts`: select an organization through onboarding, complete the guide,
  and reach authorized review data.
- `root.spec.ts`: municipal analysis route with labelled electoral selectors;
  change the native source select and verify URL and rendered source state.
- `municipal.spec.ts`: block WebGL2 at the browser boundary, activate the map,
  and verify the visible fallback outline, exact official table and keyboard link.

The zoom describe is tagged `@chromium-only`; the additional projects exclude it
in project configuration, rather than discovering an unsupported zoom scenario.
The fixture retains its defensive Chromium assertion. Physical devices, branded
Safari certification, and complete Firefox/WebKit suite coverage are out of scope.
Playwright WebKit is engine coverage, not a claim that every Safari version passes.

## Run locally

Use the pinned project toolchain. Before installing browsers or running a gate,
check `df -h /` for more than 5 GB free. Before **each gate**, check
`pgrep -fl "e2e-release-gate"`; wait if another worktree owns a gate, polling at
intervals no longer than 60 seconds. Never run two gates simultaneously.

```sh
pnpm --dir apps/web exec playwright install firefox webkit
pnpm --dir apps/web test:e2e:gate --lane cross-browser
# Default focused selection remains Google Chrome:
pnpm --dir apps/web test:e2e:focused e2e/auth.spec.ts
```

The new lane uses the existing marker-owned disposable Supabase stack, production
build, scenario servers and cleanup. It selects only auth, review, root and
municipal specs, so no prototype prerequisites or visual-evidence specs are needed.
Global setup uses the first selected engine to create the shared login state;
each critical login scenario still runs in both engines. One worker runs eight
cases serially. The reporter rejects missing engines, duplicate/missing journeys,
untagged discoveries, failures and skips. Value-free per-engine counts survive
cleanup in `apps/web/test-results/e2e-facts-cross-browser.json`.

## CI policy and cost

The separate `e2e-cross-browser` job runs on pushes to `develop` and pull requests
into `main`, and only when scope selects the existing E2E gate. It does not run on
PRs into `develop` or pushes to `main`. It installs only Firefox and WebKit with
`playwright install --with-deps firefox webkit`; it does not require Chromium for
bootstrap. No prototype generation is needed.

`verify` requires this job to succeed on eligible, E2E-selected events and requires
an exact skip otherwise. There is no `continue-on-error`. Existing Chrome, SQL,
static and ETL requirements remain intact. Per-engine counts upload for 14 days;
GitHub job timing supplies the CI duration measurement.

### Initial local measurement (#597)

The real owned gate passed on macOS with **Firefox 4/4 and WebKit 4/4**, zero skips:

| Phase | Seconds |
| --- | ---: |
| Preflight/ports | 1.205 |
| Supabase startup | 35.873 |
| Migrations | 2.012 |
| Rollback/reapply | 1.455 |
| Production build | 8.792 |
| Next server lifecycle | 1.635 |
| Playwright, including setup/teardown | 19.190 |
| Cleanup | 2.243 |
| Sum of gate phases | **72.405** |

The default focused `auth.spec.ts` gate also passed in Google Chrome: **7/7**
browser cases, zero skips, owned stack cleaned. Its phase sum was **116.834 s**
(including 55.866 s pgTAP and 10.485 s Playwright); unlike the additional browser
lane, focused mode includes the SQL proofs, so these totals are not equivalent
browser-performance measurements.

This is a phase sum, not a cold Linux CI measurement; dependency/browser download
and workflow setup are excluded. Budget **3–6 additional Linux runner-minutes per
eligible workflow** initially, with a 20-minute job timeout. The two engines share
one stack and build, so the added cost is one bounded job, not two full-suite jobs.
At N eligible workflows the estimate is 3N–6N runner-minutes. Confirm or revise
this estimate using the first green develop job's elapsed time and emitted
`E2E_RELEASE_GATE_TIMING` record; no Linux measurement is claimed yet.

**Risk item 5 — CI:** Linux Firefox/WebKit and system-library installation may
behave differently from local macOS. A green local WebKit run does not establish
Linux CI success. The independent CI lane is required precisely to catch that gap.
