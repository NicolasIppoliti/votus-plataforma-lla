# Pre-proposal state — operational-verification

**What**: Retained documentation research is complete with bounded source-backed answers; product decisions remain confirmed.
**Why**: Current child-local fetch access succeeded, and full exploration readback now agrees. Earlier failures remain historical facts, not active blockers.
**Where**: This file and `sdd/operational-verification/preproposal`; evidence in research revision 3 / memory 7200.
**Learned**: Provider metadata is not effective route behavior or deployed-state certification. No proposal or architecture was produced; readiness is only a handoff to the orchestrator.

```json
{
  "schema": "gentle-ai.sdd-preproposal/v1",
  "revision": 5,
  "changeName": "operational-verification",
  "artifactStore": "both",
  "retainedIntentRevision": 2,
  "explorationReference": "openspec/changes/operational-verification/exploration.md",
  "explorationOutcome": "complete",
  "explorationMemoryReference": {"topic": "sdd/operational-verification/explore", "memoryId": 7197, "readback": "Full canonical Markdown matches file after parent reconciliation; no exploration edits in this phase."},
  "research": {
    "selection": "selected",
    "requestedClasses": ["documentation"],
    "outcome": "done",
    "admission": "admitted_child_local_and_executed",
    "observedExactGrants": {"documentation": ["fetch_content"], "open-web": ["web_search", "source_check", "fetch_content", "get_search_content"]},
    "openWebScope": "not selected; prohibited by retained source restriction; observed inventory is not permission to execute",
    "missingSelectedTools": [],
    "executedEvidenceTools": ["fetch_content"],
    "allowedPublishers": ["Supabase", "Vercel", "PostgreSQL"],
    "questions": [
      "Which read-only observations establish deployment and migration alignment?",
      "Which Auth, role, grant and route observations are authoritative without exposing secrets or personal data?",
      "Which existing provider interfaces support a bounded operator evidence record?"
    ],
    "requestClarifications": [
      "Read-only deployment/migration observation authority; effective Auth/session/grant/RLS versus route behavior; least privilege and metadata exposure; provenance/privacy/retention for a bounded manual operator path.",
      "Public official documentation only; not project APIs, deployments, DB, Auth, credentials, logs or raw data. Open-web is not selected. Do not infer hosted PostgreSQL version from CI."
    ],
    "reference": "openspec/changes/operational-verification/research.md",
    "memoryReference": {"topic": "sdd/operational-verification/research", "memoryId": 7200, "revision": 3},
    "validatedEvidenceReferences": ["research.md#S1", "research.md#S2", "research.md#S3", "research.md#S4", "research.md#S5", "research.md#S6", "research.md#S7", "research.md#S8"],
    "referenceNotation": "S identifiers are JSON source IDs in research.md, not rendered HTML anchors; C1-C8 map to those sources; S0 is the changelog discovery index.",
    "callResults": "15 fetch_content calls: successful official passages, two 404 URLs replaced by S8, and explicitly limited PG extraction with no omitted-function claims. Only fetch_content was used for evidence.",
    "retrievalWindow": "2026-09-11T19:35:10Z parent-observed start through this phase; exact per-call times/end unknown, parent may pin end."
  },
  "evidenceReferences": ["docs/audits/2026-09-11-project-status.md", "openspec/changes/operational-verification/exploration.md", "openspec/changes/operational-verification/research.md", "engram:7197", "engram:7200"],
  "productDecisions": {
    "status": "confirmed",
    "assuranceDepth": "deployed revision, migrations, effective access, routes and selected official-data reconciliation; storage and monitoring recorded as observed or unknown",
    "dataScope": "official 2023/2025 sources for distrito 02, seccion 027 (Coronel Rosales); metadata and aggregates only; no fiscalizacion or raw rows",
    "identities": "existing approved accounts only; no user creation or permission widening; exact target and identities authorized before any future hosted run",
    "audience": "responsible internal operators",
    "evidenceLocation": "private, outside Git; repository contains procedure and sanitized template only",
    "retentionDays": 30,
    "releaseConsequence": "diagnosis only; failures and unknowns require human evaluation, with no automatic release gate or implied approval",
    "researchAuthority": "unchanged owner decisions, not conclusions supplied by provider documentation"
  },
  "constraints": [
    "Research only; no apply, production contact, deployment or delivery actions.",
    "No fabricated JWTs, permission widening, personal data, credentials or raw archive collection.",
    "No implementation architecture selected; no custom CLI, table or ledger by default.",
    "Proposal admission belongs to the orchestrator after source and hybrid-readback validation; native planning recommendation is not approval."
  ],
  "session": {"execution": "auto", "delivery_strategy": "ask-on-risk", "review_budget": 400, "chain_strategy": "deferred"},
  "sessionConstraints": [
    "Human-confirmed persistence remains both; native openspec is only the file projection.",
    "STOP BEFORE APPLY; this phase writes no proposal, spec, design, tasks or roadmap.",
    "Only research.md, preproposal.md and matching Engram topics may change; preserve audit, exploration, config and all other files.",
    "No installs, asset updates, tests, builds, hosted calls, commits, pushes, issues or model changes."
  ],
  "limits": [
    "Documentation completion does not verify any actual target, deployed SHA, migration/schema bytes, Auth session, route, aggregate, storage or monitoring.",
    "Migration history compares timestamps, not SQL bytes; reconstructed SQL is not original migration content.",
    "Auth refresh can change tokens/cookies; future read-only domain-data observation must not promise zero provider/session side effects.",
    "No minimum operator role, exact CLI compatibility or full metadata endpoint contract was certified; missing authorized observations must remain unknown rather than widen access.",
    "Eight substantive official pages plus the required changelog index were collected; failed URLs and extraction omissions are recorded, never cited as proof."
  ],
  "history": ["Preproposal revision 4 and research revision 2 were blocked before any fetch, with zero sources/claims and an exploration-summary mismatch.", "Current child read the full reconciled exploration in both stores, removing only the obsolete active mismatch blocker; historical failed admission is preserved."],
  "blockers": [],
  "persistence": {"canonicalization": "UTF-8 full Markdown payload without EOF newline in both stores", "activation": "Readiness activates only after research revision 3 and preproposal revision 5 are written and fully read back identically from file and Engram. On divergence, retain intent, set readiness false and recover a new positive revision; never choose a surviving store."},
  "proposal_ready": true,
  "next": "Return to orchestrator for admission review only; confirmed product decisions need not be asked again. No next phase executed.",
  "skill_resolution": "paths-injected"
}
```