# Page waterfall measurements — issue #490

## Result

The authorized local helper installation succeeded. A production baseline run collected **80 successful samples, zero classified errors**: 10 cold-process and 10 warm document requests per page, plus 10 Next Link navigations each for drilldown and compare. No optimization was implemented; the candidate JSON is an older blocked receipt, not a comparison result.

Source: [baseline report](page-waterfalls-490-baseline.json), uncommitted instrumentation on SHA `0dcd6a945b5ad74478c71c7250025fca51573d4e`, Node v24.21.0. Public official corpus: 2023 generales / 2025 legislativas, DIPUTADO NACIONAL, distrito 02, sección 027. Synthetic authorized workspace; no hosted access.

## Measurements

All values are milliseconds; p50 is the arithmetic median and p95 nearest-rank. Each document bucket has 10 requests. Cold means a fresh Next process, **not** flushed OS/database caches. TTFB measures streaming response start, not completed evidence.

| Page | Bucket | TTFB p50 / p95 | Instrumented envelope p50 / p95 |
|---|---|---:|---:|
| / | cold | 139.50 / 147.32 | 2219.69 / 5061.13 |
| / | warm | 101.67 / 106.34 | 2937.40 / 5221.86 |
| /drilldown | cold | 149.44 / 162.55 | 1917.75 / 1975.61 |
| /drilldown | warm | 99.87 / 106.34 | 1841.63 / 1877.97 |
| /compare | cold | 148.47 / 161.58 | 7395.07 / 7497.52 |
| /compare | warm | 95.52 / 107.75 | 7381.58 / 7570.43 |
| /drilldown | navigation | 113.36 / 119.59 | 1637.70 / 1696.40 |
| /compare | navigation | 132.17 / 138.63 | 1721.37 / 1766.48 |

### Every observed document span

Counts are total calls **per 10-request bucket** (same cold/warm count). Timings describe individual calls, not per-request totals. `rpc.*` abbreviates `workspace.rpc.*`; nested spans overlap and must not be summed.

| Page | Span | Count | Cold p50 / p95 | Warm p50 / p95 |
|---|---|---:|---:|---:|
| / | auth.middleware.getUser | 10 | 45.29 / 48.20 | 46.34 / 48.46 |
| / | page.panorama | 10 | 2147.25 / 5006.26 | 2886.85 / 5170.00 |
| / | panorama.load | 10 | 2147.20 / 5006.22 | 2886.81 / 5169.96 |
| / | auth.layout.getUser | 10 | 34.56 / 39.24 | 28.52 / 30.98 |
| / | auth.getClaims | 80 | 1.21 / 17.31 | 1.17 / 8.11 |
| / | rpc.official_facets | 30 | 410.24 / 1718.57 | 402.24 / 1672.60 |
| / | rpc.bootstrap_workspace_context | 10 | 2.69 / 3.23 | 2.65 / 3.05 |
| / | rpc.available_organizations | 10 | 2.11 / 2.42 | 2.07 / 2.23 |
| / | rpc.current_workspace | 10 | 1.79 / 2.51 | 1.64 / 1.85 |
| / | rpc.review_items | 10 | 3.47 / 4.40 | 3.14 / 3.87 |
| / | evidence.drilldown | 10 | 140.71 / 144.54 | 128.51 / 134.04 |
| / | rpc.official_result | 10 | 33.60 / 35.14 | 33.61 / 35.32 |
| / | rpc.official_schools | 10 | 31.77 / 32.39 | 31.74 / 34.75 |
| / | rpc.official_reference | 10 | 9.13 / 10.09 | 8.92 / 10.70 |
| / | rpc.official_provenance | 10 | 33.60 / 35.24 | 33.93 / 36.38 |
| / | rpc.official_section_completeness | 10 | 32.26 / 32.76 | 32.47 / 35.55 |
| / | rpc.official_section_circuit_outcomes | 10 | 52.56 / 56.90 | 52.05 / 56.06 |
| /drilldown | auth.middleware.getUser | 10 | 45.06 / 46.50 | 44.68 / 46.71 |
| /drilldown | page.drilldown | 10 | 1836.91 / 1896.68 | 1803.48 / 1827.09 |
| /drilldown | auth.layout.getUser | 10 | 35.42 / 44.91 | 29.02 / 30.85 |
| /drilldown | auth.getClaims | 60 | 1.16 / 17.82 | 1.36 / 8.11 |
| /drilldown | rpc.official_facets | 10 | 1672.88 / 1728.24 | 1668.50 / 1687.49 |
| /drilldown | rpc.bootstrap_workspace_context | 10 | 2.74 / 3.30 | 2.59 / 2.92 |
| /drilldown | rpc.available_organizations | 10 | 2.20 / 2.65 | 1.96 / 2.73 |
| /drilldown | rpc.current_workspace | 10 | 1.75 / 2.31 | 1.82 / 2.67 |
| /drilldown | rpc.review_items | 10 | 3.44 / 4.32 | 3.12 / 7.10 |
| /drilldown | evidence.drilldown | 10 | 147.03 / 152.03 | 129.10 / 131.65 |
| /drilldown | rpc.official_result | 10 | 39.48 / 41.49 | 33.33 / 34.91 |
| /drilldown | rpc.official_schools | 10 | 37.41 / 38.93 | 31.71 / 34.53 |
| /drilldown | rpc.official_reference | 10 | 15.26 / 18.08 | 9.43 / 14.87 |
| /drilldown | rpc.official_provenance | 10 | 39.17 / 41.84 | 33.35 / 35.11 |
| /drilldown | rpc.official_section_completeness | 10 | 31.72 / 34.28 | 31.74 / 33.46 |
| /drilldown | rpc.official_section_circuit_outcomes | 10 | 53.07 / 57.10 | 52.98 / 57.01 |
| /compare | auth.middleware.getUser | 10 | 44.94 / 47.46 | 45.99 / 47.87 |
| /compare | page.compare | 10 | 7310.85 / 7422.17 | 7336.15 / 7525.38 |
| /compare | auth.layout.getUser | 10 | 35.66 / 38.62 | 28.79 / 32.53 |
| /compare | auth.getClaims | 100 | 2.42 / 17.59 | 2.03 / 6.46 |
| /compare | rpc.official_facets | 70 | 1802.36 / 1873.03 | 1821.37 / 1899.31 |
| /compare | rpc.bootstrap_workspace_context | 10 | 2.61 / 2.69 | 2.38 / 3.63 |
| /compare | rpc.available_organizations | 10 | 1.97 / 2.30 | 1.78 / 2.40 |
| /compare | rpc.current_workspace | 10 | 1.74 / 2.08 | 1.65 / 2.39 |
| /compare | rpc.review_items | 10 | 3.42 / 3.55 | 2.99 / 4.04 |
| /compare | rpc.official_comparison | 10 | 43.66 / 117.70 | 43.50 / 45.89 |
| /compare | rpc.official_reference | 20 | 8.99 / 11.45 | 8.84 / 11.67 |
| /compare | rpc.official_provenance | 20 | 34.72 / 41.49 | 25.52 / 35.44 |

### Every observed navigation span

| Page | Span | Count | p50 / p95 |
|---|---|---:|---:|
| /drilldown | auth.middleware.getUser | 10 | 25.28 / 26.86 |
| /drilldown | page.drilldown | 10 | 1611.38 / 1671.54 |
| /drilldown | auth.getClaims | 10 | 1.67 / 2.32 |
| /drilldown | rpc.official_facets | 10 | 1609.06 / 1669.42 |
| /compare | auth.middleware.getUser | 10 | 26.63 / 28.40 |
| /compare | page.compare | 10 | 1693.06 / 1737.93 |
| /compare | auth.getClaims | 10 | 2.07 / 2.41 |
| /compare | rpc.official_facets | 10 | 1690.26 / 1735.14 |

Navigation click-to-main/response-completion p50/p95: drilldown **1786.67 / 1841.63**, compare **1891.34 / 1936.55**. These links enter selector state, not the scoped document corpus. This is not hydrated filter-to-evidence latency. Home has no navigation bucket. Geometry and SessionMonitor work, if present, belongs to separate requests in the JSON, not these document counts.

## Findings and limits

- Facet loading dominates drilldown (roughly 1.67 s versus 0.13–0.15 s evidence loading) and compare (seven calls/request at roughly 1.8 s/call). Investigate its query cost and sequencing before proposing auth memoization. SDK spans include transport; these are not isolated SQL timings.
- Panorama has 13 RPCs and two getUser calls per document request, now observed rather than merely inferred. Drilldown has 11 RPCs; compare has 16. Claims counts are 8/6/10 respectively.
- Fast streaming TTFB obscures multi-second page evaluation. Warm Panorama is slower in this small run; do not claim cache improvements or causal effects from these samples.
- Instrumented envelopes are not fully attributed critical paths. Promise success does not prove authorization success or complete hydrated evidence. No revocation/security optimization matrix was run. No request memoization was introduced.

## Local installation ledger

Executed successfully, exit 0:

```sh
docker exec -i supabase_db_votus-plataforma-lla psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < apps/web/e2e/service-role-grants.sql
```

Only the existing local database container (port 54322) was targeted. No reset, stop, recreation, migration gate or hosted operation was performed. No additional helper SQL was required. This installation **persists local authorization changes**:

- `service_role`: SELECT/INSERT/UPDATE/DELETE on public category, jurisdiction, election, archive_entry, result_row; SELECT/INSERT/DELETE on party_canonical, party_mapping, list_identity, official_expected_mesa, official_mesa_count_status, official_mesa_circuit_membership.
- `service_role`: review_item INSERT on (id, kind, severity, subject_ref, detected_at, note), DELETE, SELECT(id).
- Role memberships retained: workspace_admin_owner inherits workspace_context_owner and workspace_review_ingest_owner, SET false; workspace_audit_owner inherits workspace_admin_owner, SET false. Temporary postgres memberships in workspace_admin_owner/workspace_audit_owner were revoked at the end.
- Six policies created: `e2e_workspace_audit_organization_delete`, `e2e_workspace_audit_membership_delete`, `e2e_workspace_audit_entitlement_delete`, `e2e_workspace_audit_section_scope_delete`, `e2e_workspace_audit_owner_delete` on their corresponding workspace_private tables; `e2e_workspace_audit_review_all` on public.review_item. The first five permit DELETE to workspace_audit_owner; review_all permits ALL with true USING/WITH CHECK.
- workspace_audit_owner received UPDATE/DELETE on public.review_item. Its temporary CREATE on public schema was revoked.
- Six public SECURITY DEFINER functions owned by workspace_audit_owner, empty search_path: `e2e_setup_authorized_review_fixture(uuid,uuid)`, `e2e_cleanup_authorized_review_fixture(jsonb)`, `e2e_setup_authorized_fiscal_fixture(uuid,text,text)`, `e2e_extend_authorized_fiscal_fixture(jsonb,text,text)`, `e2e_cleanup_authorized_fiscal_fixture(jsonb)`, `e2e_revoke_authorized_fiscal_fixture(jsonb)`. All privileges revoked from PUBLIC/anon/authenticated; EXECUTE granted to service_role.
- The SQL's direct-review-context-DML denial assertion passed and PostgREST schema reload notification completed.

The successful runner reported no setup/cleanup blocker. The initial timed-out invocation did not update the prior receipt; its finally cleanup cannot be certified from that invocation. Do not remove pre-existing users or fixtures to compensate.

## Reproduction and checks

From apps/web:

```sh
node --experimental-strip-types scripts/profile-page-waterfalls.ts baseline 10
pnpm typecheck && pnpm exec vitest run && pnpm lint
```

First profiler attempt timed out at 1200 seconds without report update. Retrying with an 1800-second allowance succeeded: status collected, blocker null, successfulSamples 80. Checks passed: TypeScript 7.0.2, 105 Vitest files / 2078 tests, eslint zero warnings. Test output includes mocked e2e gate preflight failure scenarios; the suite itself passed and no real e2e release gate was launched.

No behavior was added in this continuation, so new RED evidence is inapplicable. Existing reachable instrumentation and deterministic tests were preserved unchanged; production browser sampling exercised login, organization switching, and all three real page entries. See [original instrumentation notes](page-waterfalls-490.md) for span semantics and earlier test-first evidence; its missing-helper result is superseded by this document.
