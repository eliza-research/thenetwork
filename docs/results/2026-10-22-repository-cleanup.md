# Repository cleanup review — 2026-10-22

Base: `d617f7b`. Scope: the user's explicit repository-wide cleanup request.

This report precedes implementation. The file ledger covers all 789 tracked files at the base.
The inventory, syntax scans and reference searches are generated. Findings and dispositions are reviewed by hand.
A scan entry is not a claim that every line received a manual correctness or security audit.
No finite review proves the absence of every possible code smell.

## Method

Read repository rules, MVP section 28, package guidance and prior audit evidence.
Inventory tracked files, including data, SQL, assets, scripts, documentation and generated plugin snapshots.
Parse TypeScript function bodies and type shapes. Search references across tracked source and documentation.
Run the compiler with unused locals and parameters enabled. Inspect each proposed change and its callers.
Retain the upstream wire mirrors, independent judges, migration history and documented CLI entry points.

## Project-wide decisions

Keep core as the owner of deterministic primitives. Keep service cleanup contracts near their service consumers.
Keep app report formatting in the simulator; it is not matching policy.
Reuse the existing Postgres helper instead of inventing another test framework.
Preserve prompt bytes, HTTP headers, member copy, scoring, seeded randomness and policy gates.
Retain distinct owner-withdrawal and OAuth-disconnect authorization paths. Their proofs and storage rules differ.
Do not replace all database `any` assertions with invented types: query result schemas need a separate correctness analysis.
Do not split the large Network state machine solely by line count; moving coupled state does not simplify it.

## Implementation findings

| ID | Work | Status |
|---|---|---|
| C1 | Remove unused parameters and imports | Planned |
| C2 | Reuse core FNV-1a for extraction delimiters without changing prompt bytes | Planned |
| C3 | Share report mean, standard error and formatting across app CLIs | Planned |
| C4 | Share connection cleanup counts and count-only response projection | Planned |
| C5 | Share no-store JSON response construction with identical headers | Planned |
| C6 | Remove unreferenced helper declarations after caller and export inspection | Planned |
| C7 | Consolidate repeated local Postgres administration helper | Planned |
| C8 | Use a typed partial group-search state instead of undefined as any | Planned |

## Retained similarities

- Core and simulation local-time types use different weekday numbering.
- Engine value events and simulator inbound asks have different domain meaning despite equal shapes.
- Simulation distance geometry is an independent oracle; keep it separate from the engine under test.
- Shared signed contract declarations have external consumers and byte pins. Local reference counts do not establish dead code there.
- Test setup closures capture different databases, services and lifecycle state. Share the repeated SQL operation, not whole test lifecycles.
- The mini Network harness and peon seat harness have different state and simulated worlds.
- CLI parsers have different supported options and defaults. Their small local closures do not justify a framework.
- Documentation, corpora, migration history, visual assets and generated plugin mirrors remain evidence or product inputs.

## Alternatives

1. Keep duplicate helpers and synchronize changes manually. This retains avoidable drift.
2. Introduce broad utility frameworks and a generic signed cleanup endpoint. This hides policy boundaries and adds indirection.

Use small existing owners and remove only declarations with no executable caller in this repository.
External consumers of unversioned workspace exports cannot be proven absent; removal is limited to internal helpers and stale APIs.

## Validation plan

Record targeted baseline results before implementation. Compare the same commands and seeds after each relevant batch.
Run typecheck, integration with real local Postgres, e2e, site builds, plugin checks and the contract mirror check.
Run one full simulation at the end. Report tracked failures separately from blocking gates.
Run bounded real-model qualification if credentials are available; never expose keys or enable live sends.
Record unperformed real-client checks explicitly.

## Every-file ledger

“Scan” means inventory plus applicable syntax/reference/duplicate analysis; “retain” is no supported change from that analysis.
Binary assets are inventoried, not interpreted as code. Data and documents are retained as source inputs or historical evidence.

| File | Lines | Disposition |
|---|---:|---|
| `.env.example` | 102 | Inventory; retain |
| `.github/runtime-eb4f-mcpon-v2/EXPECTED-IMAGE.json` | 76 | Scan; retain |
| `.github/runtime-eb4f-mcpon-v2/PINS.json` | 23 | Scan; retain |
| `.github/runtime-eb4f-mcpon-v2/ROOT-GRANT.json` | 19 | Scan; retain |
| `.github/runtime-eb4f-mcpon-v2/oci_to_docker.py` | 118 | Inventory; retain |
| `.github/runtime-eb4f-mcpon-v2/probe.ts` | 26 | Scan; retain |
| `.github/runtime-eb4f-mcpon-v2/qualify.py` | 218 | Inventory; retain |
| `.github/runtime-eb4f-mcpon-v2/setup.ts` | 35 | Scan; retain |
| `.github/runtime-eb4f/EXPECTED-IMAGE.json` | 76 | Scan; retain |
| `.github/runtime-eb4f/PINS.json` | 23 | Scan; retain |
| `.github/runtime-eb4f/oci_to_docker.py` | 118 | Inventory; retain |
| `.github/runtime-eb4f/probe.ts` | 28 | Scan; retain |
| `.github/runtime-eb4f/qualify.py` | 174 | Inventory; retain |
| `.github/runtime-eb4f/setup.ts` | 35 | Scan; retain |
| `.github/slop-project.json` | 18 | Scan; retain |
| `.github/workflows/backend-candidate-artifact.yml` | 143 | Scan; retain |
| `.github/workflows/ci.yml` | 168 | Scan; retain |
| `.github/workflows/deploy-sites.yml` | 198 | Scan; retain |
| `.github/workflows/network-retained-eb4f-mcpon-v2.yml` | 54 | Scan; retain |
| `.github/workflows/probe-network-pages-read.yml` | 87 | Scan; retain |
| `.github/workflows/retained-eb4f-runtime.yml` | 54 | Scan; retain |
| `.gitignore` | 13 | Inventory; retain |
| `AGENTS.md` | 149 | Inventory; retain |
| `CLAUDE.md` | 149 | Inventory; retain |
| `CONTRIBUTING.md` | 407 | Inventory; retain |
| `README.md` | 77 | Inventory; retain |
| `bun.lock` | 180 | Inventory; retain |
| `data/synthetic/README.md` | 396 | Inventory; retain |
| `data/synthetic/v1/edges.jsonl` | 2093 | Inventory; retain |
| `data/synthetic/v1/engine_v1_run.json` | 199 | Scan; retain |
| `data/synthetic/v1/facets.jsonl` | 5227 | Inventory; retain |
| `data/synthetic/v1/hidden_truth.jsonl` | 501 | Inventory; retain |
| `data/synthetic/v1/intents.jsonl` | 660 | Inventory; retain |
| `data/synthetic/v1/manifest.json` | 348 | Scan; retain |
| `data/synthetic/v1/members.jsonl` | 501 | Inventory; retain |
| `data/synthetic/v1/presence.jsonl` | 550 | Inventory; retain |
| `data/synthetic/v1/validation.json` | 551 | Scan; retain |
| `deploy/backend/Dockerfile` | 37 | Inventory; retain |
| `deploy/backend/Dockerfile.dockerignore` | 16 | Inventory; retain |
| `deploy/backend/backend.test.ts` | 474 | Scan; retain |
| `deploy/backend/backend.ts` | 462 | Scan; retain |
| `deploy/backend/observatory.railway.toml` | 25 | Scan; retain |
| `deploy/backend/ops.ts` | 547 | Scan; retain |
| `deploy/backend/railway.toml` | 22 | Scan; retain |
| `deploy/backend/server.ts` | 145 | Scan; retain |
| `deploy/backup/Dockerfile` | 22 | Inventory; retain |
| `deploy/backup/Dockerfile.dockerignore` | 6 | Inventory; retain |
| `deploy/backup/backup.test.ts` | 183 | Scan; retain |
| `deploy/backup/backup.ts` | 130 | Scan; retain |
| `deploy/backup/lib.ts` | 205 | Scan; retain |
| `deploy/backup/railway.toml` | 17 | Scan; retain |
| `deploy/backup/restore.ts` | 129 | Scan; retain |
| `deploy/cloudflare/README.md` | 35 | Inventory; retain |
| `deploy/cloudflare/tsconfig.json` | 14 | Scan; retain |
| `deploy/cloudflare/worker.ts` | 82 | Scan; retain |
| `deploy/cloudflare/wrangler.toml` | 56 | Scan; retain |
| `deploy/pages-worker.ts` | 28 | Scan; retain |
| `deploy/router.test.ts` | 241 | Scan; retain |
| `deploy/router.ts` | 128 | Scan; retain |
| `deploy/smoke.ts` | 75 | Scan; retain |
| `deploy/wrangler.integration.test.ts` | 41 | Scan; retain |
| `design/member-flows/README.md` | 25 | Inventory; retain |
| `design/member-flows/index.html` | 20 | Inventory; retain |
| `design/member-flows/minimal-preview.jpg` | 133 | Inventory; retain |
| `design/member-flows/preview.jpg` | 227 | Inventory; retain |
| `design/member-flows/server.ts` | 99 | C1 |
| `docs/CLEANUP-REPORT.md` | 136 | Inventory; retain |
| `docs/admin-console.md` | 405 | Inventory; retain |
| `docs/audit/2026-10-08-fixes-core.md` | 345 | Inventory; retain |
| `docs/audit/2026-10-08-test-plan.md` | 538 | Inventory; retain |
| `docs/audit/2026-10-08-weaknesses.md` | 442 | Inventory; retain |
| `docs/audit/2026-10-09-platform-status.md` | 157 | Inventory; retain |
| `docs/compliance/a2p-10dlc.md` | 59 | Inventory; retain |
| `docs/deploy.md` | 525 | Inventory; retain |
| `docs/design/2026-10-07-experience-design.md` | 924 | Inventory; retain |
| `docs/design/2026-10-07-growth-capital-ownership.md` | 247 | Inventory; retain |
| `docs/design/eliza-conversation-layer.md` | 73 | Inventory; retain |
| `docs/go-live-handoff.md` | 206 | Inventory; retain |
| `docs/mvp-gaps.md` | 361 | Inventory; retain |
| `docs/mvp-plan.md` | 92 | Inventory; retain |
| `docs/network.md` | 661 | Inventory; retain |
| `docs/observatory.md` | 261 | Inventory; retain |
| `docs/prd-pending-edits.md` | 20 | Inventory; retain |
| `docs/prd-snapshot.md` | 2011 | Inventory; retain |
| `docs/research/2026-10-08-domain-research.md` | 1089 | Inventory; retain |
| `docs/research/2026-10-08-engine-generalization.md` | 590 | Inventory; retain |
| `docs/research/2026-10-08-entry-flows.md` | 272 | Inventory; retain |
| `docs/research/2026-10-08-platform-architecture.md` | 664 | Inventory; retain |
| `docs/research/2026-10-08-skills-plugins-deploy.md` | 940 | Inventory; retain |
| `docs/research/2026-10-10-agent-deep-links.md` | 49 | Inventory; retain |
| `docs/research/blooio.md` | 285 | Inventory; retain |
| `docs/research/connectors/chatgpt.md` | 354 | Inventory; retain |
| `docs/research/connectors/claude.md` | 361 | Inventory; retain |
| `docs/research/connectors/grok.md` | 327 | Inventory; retain |
| `docs/research/connectors/muse.md` | 216 | Inventory; retain |
| `docs/research/eliza-integration.md` | 461 | Inventory; retain |
| `docs/research/entry-flows/research-chatgpt.md` | 267 | Inventory; retain |
| `docs/research/entry-flows/research-claude-grok.md` | 368 | Inventory; retain |
| `docs/research/entry-flows/research-data-sources.md` | 154 | Inventory; retain |
| `docs/research/entry-flows/research-notify-deeplinks.md` | 397 | Inventory; retain |
| `docs/research/matching-and-graphs.md` | 763 | Inventory; retain |
| `docs/results/2026-10-07-attention-budget.md` | 117 | Inventory; retain |
| `docs/results/2026-10-07-engine-v1.2.md` | 233 | Inventory; retain |
| `docs/results/2026-10-07-judge-v2.md` | 265 | Inventory; retain |
| `docs/results/2026-10-07-network-consent.md` | 136 | Inventory; retain |
| `docs/results/2026-10-08-app-packs-core.md` | 215 | Inventory; retain |
| `docs/results/2026-10-08-friends-pack.md` | 398 | Inventory; retain |
| `docs/results/2026-10-08-network-capital.md` | 293 | Inventory; retain |
| `docs/results/2026-10-08-network-hardening.md` | 162 | Inventory; retain |
| `docs/results/2026-10-08-peon-pack.md` | 214 | Inventory; retain |
| `docs/results/2026-10-08-plans.md` | 105 | Inventory; retain |
| `docs/results/2026-10-08-slop-pack.md` | 608 | Inventory; retain |
| `docs/results/2026-10-08-slop-world.md` | 226 | Inventory; retain |
| `docs/results/2026-10-09-chatgpt-custom-pilot.md` | 81 | Inventory; retain |
| `docs/results/2026-10-09-clef-fitting.md` | 339 | Inventory; retain |
| `docs/results/2026-10-09-existing-agent-onboarding.md` | 178 | Inventory; retain |
| `docs/results/2026-10-09-relay.md` | 242 | Inventory; retain |
| `docs/results/2026-10-09-slop-onboarding.md` | 181 | Inventory; retain |
| `docs/results/2026-10-09-staging-authority.md` | 64 | Inventory; retain |
| `docs/results/2026-10-10-profile-contact-guard.md` | 37 | Inventory; retain |
| `docs/results/2026-10-10-relay-heldout.md` | 85 | Inventory; retain |
| `docs/results/2026-10-10-slop-pilot-entry.md` | 36 | Inventory; retain |
| `docs/results/2026-10-11-clef-relay-live.md` | 48 | Inventory; retain |
| `docs/results/2026-10-11-live-reader-judge.md` | 35 | Inventory; retain |
| `docs/results/2026-10-13-oauth-refresh-atomic.md` | 39 | Inventory; retain |
| `docs/results/2026-10-13-otp-provider-receipt.md` | 59 | Inventory; retain |
| `docs/results/2026-10-13-otp-safe-send-diagnostics.md` | 26 | Inventory; retain |
| `docs/results/2026-10-13-own-home-correction.md` | 70 | Inventory; retain |
| `docs/results/2026-10-13-slop-multi-market-radius.md` | 139 | Inventory; retain |
| `docs/results/2026-10-13-truthful-home.md` | 104 | Inventory; retain |
| `docs/results/2026-10-14-service-matching-judge.md` | 67 | Inventory; retain |
| `docs/results/2026-10-15-agent-reply-guidance.md` | 91 | Inventory; retain |
| `docs/results/2026-10-15-agent-return.md` | 78 | Inventory; retain |
| `docs/results/2026-10-15-membership-status-hint.md` | 69 | Inventory; retain |
| `docs/results/2026-10-15-turnstile-feedback.md` | 90 | Inventory; retain |
| `docs/results/2026-10-17-collection-http-retention.md` | 14 | Inventory; retain |
| `docs/results/2026-10-17-collection-pending-replay.md` | 14 | Inventory; retain |
| `docs/results/2026-10-17-imessage-suggestion-review.md` | 12 | Inventory; retain |
| `docs/results/2026-10-17-inferred-facet-provenance.md` | 46 | Inventory; retain |
| `docs/results/2026-10-17-learning-membership-context.md` | 14 | Inventory; retain |
| `docs/results/2026-10-17-profile-review-owner-consumer.md` | 32 | Inventory; retain |
| `docs/results/2026-10-17-profile-review-purpose-factory.md` | 35 | Inventory; retain |
| `docs/results/2026-10-17-reviewed-profile-suggestions.md` | 40 | Inventory; retain |
| `docs/results/2026-10-18-production-cloud-network-handoff.md` | 41 | Inventory; retain |
| `docs/results/2026-10-19-codebase-audit.md` | 482 | Inventory; retain |
| `docs/results/2026-10-19-member-flow-design.md` | 117 | Inventory; retain |
| `docs/results/2026-10-19-scorecard-observation-time.md` | 23 | Inventory; retain |
| `docs/results/2026-10-20-oauth-client-approval.md` | 46 | Inventory; retain |
| `docs/results/2026-10-20-oauth-cloud-composition.md` | 41 | Inventory; retain |
| `docs/results/2026-10-20-scoped-collection-contract.md` | 51 | Inventory; retain |
| `docs/results/2026-10-21-cloudflare-backend-shutdown.md` | 18 | Inventory; retain |
| `docs/results/2026-10-21-cloudflare-backend.md` | 31 | Inventory; retain |
| `docs/results/2026-10-21-stable-roommates-blocked-proposer.md` | 116 | Inventory; retain |
| `docs/results/SUMMARY.md` | 199 | Inventory; retain |
| `docs/results/assets/2026-10-15-agent-return/after.webm` | 1199 | Inventory; retain |
| `docs/results/assets/2026-10-15-agent-return/before.webm` | 529 | Inventory; retain |
| `docs/results/assets/2026-10-15-turnstile-feedback/after.webm` | 59 | Inventory; retain |
| `docs/results/assets/2026-10-15-turnstile-feedback/before.webm` | 49 | Inventory; retain |
| `docs/results/media/2026-10-13-slop-codex-after.mp4` | 676 | Inventory; retain |
| `docs/results/media/2026-10-13-slop-codex-before.mp4` | 689 | Inventory; retain |
| `docs/results/media/2026-10-13-slop-codex-client-playback.mp4` | 529 | Inventory; retain |
| `docs/results/media/2026-10-13-truthful-home-after.mp4` | 530 | Inventory; retain |
| `docs/results/media/2026-10-13-truthful-home-before.mp4` | 481 | Inventory; retain |
| `docs/results/network/arms-21d-send-path-seed1.json` | 249 | Scan; retain |
| `docs/results/network/arms-21d-send-path-seed2.json` | 249 | Scan; retain |
| `docs/results/network/arms-21d-send-path-seed3.json` | 248 | Scan; retain |
| `docs/results/network/capital-plans/after-capital-21d-seed1.json` | 163 | Scan; retain |
| `docs/results/network/capital-plans/after-capital-21d-seed2.json` | 163 | Scan; retain |
| `docs/results/network/capital-plans/after-capital-21d-seed3.json` | 164 | Scan; retain |
| `docs/results/network/capital-plans/after-capital-60d-seed1.json` | 164 | Scan; retain |
| `docs/results/network/capital-plans/after-consent-21d-seed1.json` | 160 | Scan; retain |
| `docs/results/network/capital-plans/after-consent-21d-seed2.json` | 160 | Scan; retain |
| `docs/results/network/capital-plans/after-consent-21d-seed3.json` | 161 | Scan; retain |
| `docs/results/network/capital-plans/after-consent-60d-seed1.json` | 161 | Scan; retain |
| `docs/results/network/capital-plans/after-plansoff-21d-seed1.json` | 160 | Scan; retain |
| `docs/results/network/capital-plans/after-plansoff-21d-seed2.json` | 160 | Scan; retain |
| `docs/results/network/capital-plans/after-plansoff-21d-seed3.json` | 160 | Scan; retain |
| `docs/results/network/capital-plans/after-plansoff-60d-seed1.json` | 161 | Scan; retain |
| `docs/results/network/send-defaults-21d.json` | 1211 | Scan; retain |
| `docs/runbook-deeplink-test.md` | 39 | Inventory; retain |
| `docs/runbook-platform.md` | 191 | Inventory; retain |
| `docs/runbook-real.md` | 573 | Inventory; retain |
| `docs/runbook-simulation.md` | 400 | Inventory; retain |
| `docs/tests-policy.md` | 126 | Inventory; retain |
| `evals/guard/leaks.jsonl` | 133 | Inventory; retain |
| `evals/network/abuse.jsonl` | 106 | Inventory; retain |
| `evals/network/areas.jsonl` | 198 | Inventory; retain |
| `evals/network/benign-adult.txt` | 222 | Inventory; retain |
| `evals/network/consent-heldout.jsonl` | 76 | Inventory; retain |
| `evals/network/consent-replies.jsonl` | 323 | Inventory; retain |
| `evals/network/negations.jsonl` | 103 | Inventory; retain |
| `evals/network/paraphrases.jsonl` | 329 | Inventory; retain |
| `evals/network/teen-age.jsonl` | 165 | Inventory; retain |
| `evals/opt-out-parse.jsonl` | 41 | Inventory; retain |
| `evals/opt-out.jsonl` | 105 | Inventory; retain |
| `evals/relay/clef-answers.jsonl` | 577 | Inventory; retain |
| `evals/relay/clef-relay-weights.json` | 194 | Scan; retain |
| `evals/relay/relay-heldout-1.jsonl` | 66 | Inventory; retain |
| `evals/relay/relay-heldout-2.jsonl` | 66 | Inventory; retain |
| `evals/relay/relay-paraphrases.jsonl` | 66 | Inventory; retain |
| `evals/relay/relay.jsonl` | 161 | Inventory; retain |
| `evals/relay/requests.jsonl` | 38 | Inventory; retain |
| `evals/replies.jsonl` | 185 | Inventory; retain |
| `evals/slop-onboarding/ages.jsonl` | 71 | Inventory; retain |
| `evals/slop-onboarding/ambiguous.jsonl` | 69 | Inventory; retain |
| `evals/slop-onboarding/corrections.jsonl` | 49 | Inventory; retain |
| `evals/slop-onboarding/hard-heldout.jsonl` | 41 | Inventory; retain |
| `evals/slop-onboarding/hard.jsonl` | 165 | Inventory; retain |
| `evals/slop-onboarding/parsers.jsonl` | 129 | Inventory; retain |
| `evals/slop-onboarding/soft.jsonl` | 67 | Inventory; retain |
| `package.json` | 34 | Scan; retain |
| `packages/blooio/README.md` | 69 | Inventory; retain |
| `packages/blooio/package.json` | 9 | Scan; retain |
| `packages/blooio/src/adapters/blooio-adapter.ts` | 33 | Scan; retain |
| `packages/blooio/src/blooio/client.ts` | 267 | Scan; retain |
| `packages/blooio/src/blooio/webhook.ts` | 210 | C6 |
| `packages/blooio/src/index.ts` | 10 | Scan; retain |
| `packages/blooio/src/line.ts` | 20 | Scan; retain |
| `packages/blooio/src/outbound-queue.ts` | 739 | Scan; retain |
| `packages/blooio/src/phone.ts` | 48 | C6 |
| `packages/blooio/src/quiet-hours.ts` | 75 | Scan; retain |
| `packages/blooio/src/types.ts` | 148 | Scan; retain |
| `packages/blooio/test/outbound-queue.test.ts` | 182 | Scan; retain |
| `packages/capital/experiments/run.ts` | 301 | Scan; retain |
| `packages/capital/experiments/world.ts` | 483 | Scan; retain |
| `packages/capital/package.json` | 11 | Scan; retain |
| `packages/capital/src/config.ts` | 141 | Scan; retain |
| `packages/capital/src/detect.ts` | 178 | Scan; retain |
| `packages/capital/src/index.ts` | 9 | Scan; retain |
| `packages/capital/src/ledger.ts` | 462 | Scan; retain |
| `packages/capital/src/levers.ts` | 100 | Scan; retain |
| `packages/capital/src/store.ts` | 66 | Scan; retain |
| `packages/capital/src/types.ts` | 137 | Scan; retain |
| `packages/capital/src/validate.ts` | 80 | Scan; retain |
| `packages/capital/src/view.ts` | 53 | Scan; retain |
| `packages/core/package.json` | 2 | Scan; retain |
| `packages/core/src/chatJson.ts` | 85 | Scan; retain |
| `packages/core/src/clock.ts` | 16 | Scan; retain |
| `packages/core/src/fence.ts` | 36 | Scan; retain |
| `packages/core/src/geo.ts` | 10 | Scan; retain |
| `packages/core/src/guard.ts` | 601 | C6 |
| `packages/core/src/index.ts` | 15 | Scan; retain |
| `packages/core/src/llm.ts` | 484 | Scan; retain |
| `packages/core/src/network.ts` | 192 | Scan; retain |
| `packages/core/src/pii.ts` | 19 | Scan; retain |
| `packages/core/src/policy.ts` | 29 | Scan; retain |
| `packages/core/src/replies.ts` | 374 | Scan; retain |
| `packages/core/src/rng.ts` | 119 | Scan; retain |
| `packages/core/src/runlog.ts` | 69 | C6 |
| `packages/core/src/stats.ts` | 12 | Scan; retain |
| `packages/core/src/svc/contract.ts` | 437 | Scan; retain |
| `packages/core/src/svc/learning-collection-command.ts` | 81 | Scan; retain |
| `packages/core/src/svc/learning-consent-context.ts` | 101 | Scan; retain |
| `packages/core/src/svc/network-delegation.ts` | 44 | Scan; retain |
| `packages/core/src/svc/profile-review-disconnect.ts` | 55 | Scan; retain |
| `packages/core/src/svc/profile-review-owner.ts` | 56 | Scan; retain |
| `packages/core/src/svc/profile-review-source.ts` | 71 | Scan; retain |
| `packages/core/src/svc/profile-review-withdrawal.ts` | 52 | Scan; retain |
| `packages/core/src/svc/svc-auth.ts` | 116 | Scan; retain |
| `packages/core/src/time.ts` | 42 | Scan; retain |
| `packages/core/src/types.ts` | 139 | Scan; retain |
| `packages/core/test/contract-mirror.test.ts` | 29 | Scan; retain |
| `packages/engine/README.md` | 136 | Inventory; retain |
| `packages/engine/package.json` | 10 | Scan; retain |
| `packages/engine/src/attention.ts` | 1207 | C6 |
| `packages/engine/src/complementarity.ts` | 142 | Scan; retain |
| `packages/engine/src/config.ts` | 527 | C6 |
| `packages/engine/src/embed.ts` | 65 | Scan; retain |
| `packages/engine/src/engine.ts` | 310 | Scan; retain |
| `packages/engine/src/explain.ts` | 99 | Scan; retain |
| `packages/engine/src/filters.ts` | 252 | Scan; retain |
| `packages/engine/src/genkit.ts` | 64 | Scan; retain |
| `packages/engine/src/geo.ts` | 62 | Scan; retain |
| `packages/engine/src/group.ts` | 159 | C8 |
| `packages/engine/src/hash.ts` | 16 | Scan; retain |
| `packages/engine/src/index.ts` | 34 | Scan; retain |
| `packages/engine/src/interval.ts` | 31 | Scan; retain |
| `packages/engine/src/judge.ts` | 136 | Scan; retain |
| `packages/engine/src/judgeCommon.ts` | 335 | Scan; retain |
| `packages/engine/src/judgeConstants.ts` | 12 | Scan; retain |
| `packages/engine/src/judgeDeep.ts` | 124 | Scan; retain |
| `packages/engine/src/judgeScreen.ts` | 89 | Scan; retain |
| `packages/engine/src/pack.ts` | 359 | Scan; retain |
| `packages/engine/src/packs/friends/copy.ts` | 34 | Scan; retain |
| `packages/engine/src/packs/friends/generators.ts` | 135 | Scan; retain |
| `packages/engine/src/packs/friends/geo.ts` | 190 | Scan; retain |
| `packages/engine/src/packs/friends/index.ts` | 155 | Scan; retain |
| `packages/engine/src/packs/friends/info.ts` | 97 | Scan; retain |
| `packages/engine/src/packs/friends/planner.ts` | 481 | Scan; retain |
| `packages/engine/src/packs/friends/rules.ts` | 73 | Scan; retain |
| `packages/engine/src/packs/network/activities.ts` | 97 | Scan; retain |
| `packages/engine/src/packs/network/calibrator.ts` | 12 | Scan; retain |
| `packages/engine/src/packs/network/copy.ts` | 54 | Scan; retain |
| `packages/engine/src/packs/network/generators.ts` | 631 | Scan; retain |
| `packages/engine/src/packs/network/index.ts` | 128 | Scan; retain |
| `packages/engine/src/packs/network/judgeContext.ts` | 428 | Scan; retain |
| `packages/engine/src/packs/network/ontology.ts` | 77 | Scan; retain |
| `packages/engine/src/packs/network/prompts.ts` | 151 | Scan; retain |
| `packages/engine/src/packs/network/rules.ts` | 128 | Scan; retain |
| `packages/engine/src/packs/network/taxonomy.ts` | 72 | Scan; retain |
| `packages/engine/src/packs/network/vocabulary.ts` | 129 | Scan; retain |
| `packages/engine/src/packs/peon/copy.ts` | 57 | Scan; retain |
| `packages/engine/src/packs/peon/generators.ts` | 93 | Scan; retain |
| `packages/engine/src/packs/peon/index.ts` | 146 | Scan; retain |
| `packages/engine/src/packs/peon/judge.ts` | 52 | Scan; retain |
| `packages/engine/src/packs/peon/match.ts` | 63 | Scan; retain |
| `packages/engine/src/packs/peon/profile.ts` | 223 | Scan; retain |
| `packages/engine/src/packs/peon/rules.ts` | 128 | Scan; retain |
| `packages/engine/src/packs/peon/schema.ts` | 74 | C6 |
| `packages/engine/src/packs/peon/seats.ts` | 125 | Scan; retain |
| `packages/engine/src/packs/peon/selection.ts` | 132 | Scan; retain |
| `packages/engine/src/packs/peon/testkit.ts` | 95 | Scan; retain |
| `packages/engine/src/packs/slop/appearance.ts` | 187 | Scan; retain |
| `packages/engine/src/packs/slop/assign.ts` | 220 | Scan; retain |
| `packages/engine/src/packs/slop/biasMonitor.ts` | 59 | Scan; retain |
| `packages/engine/src/packs/slop/clef-fit/audit.ts` | 109 | Scan; retain |
| `packages/engine/src/packs/slop/clef-fit/features.ts` | 79 | Scan; retain |
| `packages/engine/src/packs/slop/clef-fit/fit.ts` | 472 | Scan; retain |
| `packages/engine/src/packs/slop/clef-fit/index.ts` | 7 | Scan; retain |
| `packages/engine/src/packs/slop/clef.ts` | 250 | Scan; retain |
| `packages/engine/src/packs/slop/clefWeights.ts` | 77 | Scan; retain |
| `packages/engine/src/packs/slop/copy.ts` | 72 | Scan; retain |
| `packages/engine/src/packs/slop/extract.ts` | 1086 | C2 |
| `packages/engine/src/packs/slop/generators.ts` | 108 | Scan; retain |
| `packages/engine/src/packs/slop/geo.ts` | 64 | Scan; retain |
| `packages/engine/src/packs/slop/index.ts` | 225 | Scan; retain |
| `packages/engine/src/packs/slop/judge.ts` | 82 | Scan; retain |
| `packages/engine/src/packs/slop/learn.ts` | 130 | Scan; retain |
| `packages/engine/src/packs/slop/onboard.ts` | 152 | Scan; retain |
| `packages/engine/src/packs/slop/options.ts` | 205 | Scan; retain |
| `packages/engine/src/packs/slop/plan.ts` | 87 | Scan; retain |
| `packages/engine/src/packs/slop/profile.ts` | 288 | Scan; retain |
| `packages/engine/src/packs/slop/rules.ts` | 142 | Scan; retain |
| `packages/engine/src/packs/slop/score.ts` | 214 | Scan; retain |
| `packages/engine/src/packs/slop/zips.ts` | 456 | Scan; retain |
| `packages/engine/src/plans.ts` | 744 | C6 |
| `packages/engine/src/policy.ts` | 283 | Scan; retain |
| `packages/engine/src/relay.ts` | 508 | Scan; retain |
| `packages/engine/src/relayClef.ts` | 308 | Scan; retain |
| `packages/engine/src/relayClefFit.ts` | 208 | Scan; retain |
| `packages/engine/src/retrieval.ts` | 121 | Scan; retain |
| `packages/engine/src/scoring.ts` | 211 | Scan; retain |
| `packages/engine/src/testkit.ts` | 214 | C6 |
| `packages/engine/src/types.ts` | 273 | Scan; retain |
| `packages/engine/src/world.ts` | 423 | Scan; retain |
| `packages/mcp/README.md` | 143 | Inventory; retain |
| `packages/mcp/db/oauth.sql` | 148 | Scan; retain |
| `packages/mcp/package.json` | 14 | Scan; retain |
| `packages/mcp/src/apps.ts` | 81 | Scan; retain |
| `packages/mcp/src/dev-server.ts` | 31 | Scan; retain |
| `packages/mcp/src/handler.ts` | 980 | C1, C6 |
| `packages/mcp/src/hooks.ts` | 221 | Scan; retain |
| `packages/mcp/src/index.ts` | 8 | Scan; retain |
| `packages/mcp/src/leaks.ts` | 35 | Scan; retain |
| `packages/mcp/src/pages.ts` | 101 | C1 |
| `packages/mcp/src/pg-store.ts` | 223 | Scan; retain |
| `packages/mcp/src/store.ts` | 285 | Scan; retain |
| `packages/mcp/src/tools.ts` | 331 | Scan; retain |
| `packages/mcp/src/util.ts` | 66 | Scan; retain |
| `packages/mcp/test/cloud-authority.pg.test.ts` | 91 | Scan; retain |
| `packages/mcp/test/cloud-oauth-continuation.integration.test.ts` | 153 | Scan; retain |
| `packages/mcp/test/fixtures/cloud-authorization-producer.ts` | 84 | Scan; retain |
| `packages/mcp/test/harness.ts` | 159 | Scan; retain |
| `packages/mcp/test/mcp.test.ts` | 256 | Scan; retain |
| `packages/mcp/test/oauth.test.ts` | 634 | Scan; retain |
| `packages/mcp/test/output-schemas.integration.test.ts` | 78 | Scan; retain |
| `packages/mcp/test/pg.test.ts` | 266 | C7 |
| `packages/mcp/test/signup-draft.test.ts` | 187 | Scan; retain |
| `packages/mcp/test/updates.test.ts` | 75 | Scan; retain |
| `packages/network/db/network-state.sql` | 91 | Scan; retain |
| `packages/network/harness/experiment.ts` | 290 | Scan; retain |
| `packages/network/harness/growth.ts` | 53 | Scan; retain |
| `packages/network/harness/index.ts` | 7 | Scan; retain |
| `packages/network/harness/paraphrase.ts` | 71 | Scan; retain |
| `packages/network/harness/scenarios.ts` | 406 | Scan; retain |
| `packages/network/package.json` | 22 | Scan; retain |
| `packages/network/service/README.md` | 284 | Inventory; retain |
| `packages/network/service/bias.ts` | 56 | Scan; retain |
| `packages/network/service/channel.ts` | 250 | Scan; retain |
| `packages/network/service/cloud-channel.ts` | 72 | Scan; retain |
| `packages/network/service/cloud-profile-review-owner.ts` | 66 | Scan; retain |
| `packages/network/service/cost.ts` | 261 | Scan; retain |
| `packages/network/service/inbox.ts` | 282 | Scan; retain |
| `packages/network/service/learning-consent-context-endpoint.ts` | 99 | Scan; retain |
| `packages/network/service/main.ts` | 84 | Scan; retain |
| `packages/network/service/packs.ts` | 315 | Scan; retain |
| `packages/network/service/photoIntake.ts` | 157 | Scan; retain |
| `packages/network/service/postings.ts` | 159 | Scan; retain |
| `packages/network/service/profile-review-factory.ts` | 110 | Scan; retain |
| `packages/network/service/profile-review-proof-transport.ts` | 41 | Scan; retain |
| `packages/network/service/profile-suggestion-disconnect-endpoint.ts` | 70 | C4 |
| `packages/network/service/profile-suggestion-endpoint.ts` | 157 | C6 |
| `packages/network/service/profile-suggestion-review.ts` | 58 | Scan; retain |
| `packages/network/service/profile-suggestion-withdrawal-endpoint.ts` | 67 | C4 |
| `packages/network/service/profile-suggestions.ts` | 461 | Scan; retain |
| `packages/network/service/relay-endpoint.ts` | 263 | C5 |
| `packages/network/service/route-authority.ts` | 35 | Scan; retain |
| `packages/network/service/runtime.ts` | 768 | Scan; retain |
| `packages/network/service/serve.ts` | 143 | Scan; retain |
| `packages/network/service/service.ts` | 2540 | Scan; retain |
| `packages/network/service/snapshot.ts` | 138 | Scan; retain |
| `packages/network/src/apphooks.ts` | 70 | Scan; retain |
| `packages/network/src/capital.ts` | 61 | Scan; retain |
| `packages/network/src/classify.ts` | 789 | Scan; retain |
| `packages/network/src/copy.ts` | 210 | Scan; retain |
| `packages/network/src/extract.ts` | 141 | C2 |
| `packages/network/src/geo.ts` | 157 | Scan; retain |
| `packages/network/src/index.ts` | 14 | Scan; retain |
| `packages/network/src/jobs.ts` | 295 | C6 |
| `packages/network/src/network.ts` | 4999 | Scan; retain |
| `packages/network/src/outreach.ts` | 112 | Scan; retain |
| `packages/network/src/plans.ts` | 92 | Scan; retain |
| `packages/network/src/relay.ts` | 409 | Scan; retain |
| `packages/network/src/reports.ts` | 43 | Scan; retain |
| `packages/network/src/store.ts` | 337 | Scan; retain |
| `packages/network/src/trust.ts` | 146 | Scan; retain |
| `packages/network/test/block-target-plan.test.ts` | 62 | Scan; retain |
| `packages/network/test/cloud-outbound.integration.test.ts` | 250 | Scan; retain |
| `packages/network/test/cost.integration.test.ts` | 71 | Scan; retain |
| `packages/network/test/crossapp.test.ts` | 233 | C7 |
| `packages/network/test/eliza-takeover.integration.test.ts` | 262 | Scan; retain |
| `packages/network/test/fixtures/learning-collection-command-vectors.ts` | 64 | Scan; retain |
| `packages/network/test/gateway-fixtures.integration.test.ts` | 161 | Scan; retain |
| `packages/network/test/inbox-order.integration.test.ts` | 173 | Scan; retain |
| `packages/network/test/invites-honest.test.ts` | 22 | Scan; retain |
| `packages/network/test/mini.ts` | 153 | Scan; retain |
| `packages/network/test/peon-postings.integration.test.ts` | 131 | C7 |
| `packages/network/test/peon-seats.integration.test.ts` | 107 | Scan; retain |
| `packages/network/test/profile-cleanup-reconciliation.postgres.test.ts` | 593 | Scan; retain |
| `packages/network/test/profile-suggestion-disconnect.integration.test.ts` | 159 | Scan; retain |
| `packages/network/test/profile-suggestion-review.test.ts` | 87 | Scan; retain |
| `packages/network/test/profile-suggestion-withdrawal.integration.test.ts` | 133 | Scan; retain |
| `packages/network/test/profile-suggestions.integration.test.ts` | 1123 | Scan; retain |
| `packages/network/test/relay-classifier-env.test.ts` | 31 | Scan; retain |
| `packages/network/test/relay.test.ts` | 176 | Scan; retain |
| `packages/network/test/report-booked.test.ts` | 28 | Scan; retain |
| `packages/network/test/service-apps.test.ts` | 609 | C7 |
| `packages/network/test/service-platform.test.ts` | 615 | Scan; retain |
| `packages/network/test/service-safety.test.ts` | 445 | C7 |
| `packages/network/test/service.test.ts` | 277 | C7 |
| `packages/network/test/shared-actions.integration.test.ts` | 123 | Scan; retain |
| `packages/network/test/shared-agent.integration.test.ts` | 482 | Scan; retain |
| `packages/network/test/shared-relay.integration.test.ts` | 380 | Scan; retain |
| `packages/network/test/slop-block-target.integration.test.ts` | 120 | C7 |
| `packages/network/test/slop-date-path.integration.test.ts` | 286 | C7 |
| `packages/network/test/staging-authority.integration.test.ts` | 83 | Scan; retain |
| `packages/network/test/store.test.ts` | 284 | C7 |
| `packages/notify/README.md` | 48 | Inventory; retain |
| `packages/notify/db/retention.sql` | 132 | Scan; retain |
| `packages/notify/db/schema.sql` | 75 | Scan; retain |
| `packages/notify/package.json` | 11 | Scan; retain |
| `packages/notify/scripts/link-test-page.ts` | 39 | Scan; retain |
| `packages/notify/src/compose.ts` | 29 | Scan; retain |
| `packages/notify/src/index.ts` | 9 | Scan; retain |
| `packages/notify/src/links.ts` | 60 | C6 |
| `packages/notify/src/pg-store.ts` | 205 | Scan; retain |
| `packages/notify/src/scheduler.ts` | 282 | Scan; retain |
| `packages/notify/src/store.ts` | 195 | Scan; retain |
| `packages/notify/src/surface.ts` | 78 | Scan; retain |
| `packages/notify/src/tokens.ts` | 37 | C6 |
| `packages/notify/src/types.ts` | 48 | Scan; retain |
| `packages/notify/src/wiring.ts` | 53 | Scan; retain |
| `packages/notify/test/store-contract.test.ts` | 109 | Scan; retain |
| `packages/notify/test/wiring.test.ts` | 122 | Scan; retain |
| `packages/observatory/db/dev-pg.ts` | 73 | Scan; retain |
| `packages/observatory/db/migrate.ts` | 122 | Scan; retain |
| `packages/observatory/db/migrations/0003_platform.sql` | 252 | Scan; retain |
| `packages/observatory/db/migrations/0004_network_apps.sql` | 164 | Scan; retain |
| `packages/observatory/db/migrations/0005_console_apps.sql` | 62 | Scan; retain |
| `packages/observatory/db/migrations/0006_platform_safety.sql` | 100 | Scan; retain |
| `packages/observatory/db/migrations/0007_friends_platform_safety.sql` | 271 | Scan; retain |
| `packages/observatory/db/migrations/0010_console_read_paths.sql` | 80 | Scan; retain |
| `packages/observatory/db/migrations/0011_bans_photos_packs.sql` | 46 | Scan; retain |
| `packages/observatory/db/migrations/0012_person_cap_release.sql` | 20 | Scan; retain |
| `packages/observatory/db/migrations/0014_photo_consent_bias.sql` | 44 | Scan; retain |
| `packages/observatory/db/migrations/0015_outbound_queue.sql` | 112 | Scan; retain |
| `packages/observatory/db/migrations/0020_cost_ledger_ops_alerts.sql` | 87 | Scan; retain |
| `packages/observatory/db/migrations/0021_shared_agent_turns.sql` | 14 | Scan; retain |
| `packages/observatory/db/migrations/0022_cloud_outbound_receipts.sql` | 5 | Scan; retain |
| `packages/observatory/db/migrations/0023_shared_agent_actions.sql` | 4 | Scan; retain |
| `packages/observatory/db/migrations/0024_notification_projection.sql` | 5 | Scan; retain |
| `packages/observatory/db/migrations/0025_eliza_notices.sql` | 11 | Scan; retain |
| `packages/observatory/db/migrations/0026_relay.sql` | 70 | Scan; retain |
| `packages/observatory/db/migrations/0030_ntwrk_party_domain.sql` | 5 | Scan; retain |
| `packages/observatory/db/migrations/0031_relay_network.sql` | 14 | Scan; retain |
| `packages/observatory/db/migrations/0032_outbound_leak_review.sql` | 7 | Scan; retain |
| `packages/observatory/db/migrations/0033_phone_changes.sql` | 23 | Scan; retain |
| `packages/observatory/db/migrations/0034_otp_provider_chat_id.sql` | 4 | Scan; retain |
| `packages/observatory/db/migrations/0035_pending_join_home.sql` | 3 | Scan; retain |
| `packages/observatory/db/migrations/0036_inbound_route_authority.sql` | 4 | Scan; retain |
| `packages/observatory/db/migrations/0037_photo_relay.sql` | 54 | Scan; retain |
| `packages/observatory/db/migrations/0038_matching_age_floor.sql` | 26 | Scan; retain |
| `packages/observatory/db/migrations/0039_profile_suggestions.sql` | 73 | Scan; retain |
| `packages/observatory/db/migrations/0040_profile_suggestion_connection_receipts.sql` | 22 | Scan; retain |
| `packages/observatory/db/migrations/0041_profile_cleanup_results.sql` | 5 | Scan; retain |
| `packages/observatory/db/schema.sql` | 336 | Scan; retain |
| `packages/observatory/db/seed.ts` | 52 | Scan; retain |
| `packages/observatory/db/writer.ts` | 208 | Scan; retain |
| `packages/observatory/package.json` | 29 | Scan; retain |
| `packages/observatory/src/appProfile.ts` | 110 | Scan; retain |
| `packages/observatory/src/apps.ts` | 106 | C6 |
| `packages/observatory/src/engineCapture.ts` | 66 | Scan; retain |
| `packages/observatory/src/events.ts` | 256 | Scan; retain |
| `packages/observatory/src/health.ts` | 337 | Scan; retain |
| `packages/observatory/src/lab.ts` | 200 | Scan; retain |
| `packages/observatory/src/ops.ts` | 75 | Scan; retain |
| `packages/observatory/src/people.ts` | 109 | Scan; retain |
| `packages/observatory/src/projector.ts` | 543 | Scan; retain |
| `packages/observatory/src/report.ts` | 57 | Scan; retain |
| `packages/observatory/src/runDiff.ts` | 37 | Scan; retain |
| `packages/observatory/src/scoring.ts` | 106 | Scan; retain |
| `packages/observatory/src/scrub.ts` | 59 | Scan; retain |
| `packages/observatory/src/server.ts` | 898 | Scan; retain |
| `packages/observatory/src/shape.ts` | 83 | Scan; retain |
| `packages/observatory/src/sources/game.ts` | 838 | Scan; retain |
| `packages/observatory/src/sources/real.ts` | 968 | Scan; retain |
| `packages/observatory/src/sources/service.ts` | 257 | Scan; retain |
| `packages/observatory/src/sources/source.ts` | 98 | Scan; retain |
| `packages/observatory/src/staff.ts` | 425 | Scan; retain |
| `packages/observatory/src/store.ts` | 178 | Scan; retain |
| `packages/observatory/src/takeover.ts` | 92 | Scan; retain |
| `packages/observatory/src/types.ts` | 752 | Scan; retain |
| `packages/observatory/test/apps.test.ts` | 381 | Scan; retain |
| `packages/observatory/test/consent.test.ts` | 236 | Scan; retain |
| `packages/observatory/test/held-photo-ui.test.tsx` | 68 | Scan; retain |
| `packages/observatory/test/held.test.ts` | 145 | Scan; retain |
| `packages/observatory/test/migrations.test.ts` | 137 | Scan; retain |
| `packages/observatory/test/pg.ts` | 41 | Scan; retain |
| `packages/observatory/test/real-console.test.ts` | 200 | Scan; retain |
| `packages/observatory/test/real-fixes.test.ts` | 239 | Scan; retain |
| `packages/observatory/test/real-service.test.ts` | 129 | Scan; retain |
| `packages/observatory/test/real.test.ts` | 178 | Scan; retain |
| `packages/observatory/test/server.test.ts` | 152 | Scan; retain |
| `packages/observatory/test/staff-apps.test.ts` | 179 | Scan; retain |
| `packages/observatory/test/staff.test.ts` | 485 | Scan; retain |
| `packages/observatory/tsconfig.json` | 10 | Scan; retain |
| `packages/observatory/web/admin.tsx` | 589 | Scan; retain |
| `packages/observatory/web/apps.tsx` | 195 | Scan; retain |
| `packages/observatory/web/drawer.tsx` | 480 | Scan; retain |
| `packages/observatory/web/graph.ts` | 378 | Scan; retain |
| `packages/observatory/web/index.html` | 18 | Inventory; retain |
| `packages/observatory/web/main.tsx` | 498 | Scan; retain |
| `packages/observatory/web/map.ts` | 184 | Scan; retain |
| `packages/observatory/web/network.tsx` | 33 | Scan; retain |
| `packages/observatory/web/ops.tsx` | 48 | Scan; retain |
| `packages/observatory/web/panels.tsx` | 768 | Scan; retain |
| `packages/observatory/web/review.tsx` | 373 | Scan; retain |
| `packages/observatory/web/safe.ts` | 18 | Scan; retain |
| `packages/observatory/web/store.ts` | 820 | Scan; retain |
| `packages/observatory/web/styles.css` | 412 | Inventory; retain |
| `packages/observatory/web/ui.tsx` | 172 | Scan; retain |
| `packages/platform/README.md` | 117 | Inventory; retain |
| `packages/platform/package.json` | 18 | Scan; retain |
| `packages/platform/src/accounts.ts` | 487 | Scan; retain |
| `packages/platform/src/age.ts` | 25 | Scan; retain |
| `packages/platform/src/api.ts` | 696 | Scan; retain |
| `packages/platform/src/apps.ts` | 190 | C6 |
| `packages/platform/src/body.ts` | 36 | Scan; retain |
| `packages/platform/src/cloud-delegation.ts` | 40 | Scan; retain |
| `packages/platform/src/consent.ts` | 107 | Scan; retain |
| `packages/platform/src/env.ts` | 73 | Scan; retain |
| `packages/platform/src/index.ts` | 16 | Scan; retain |
| `packages/platform/src/otp-config.ts` | 13 | Scan; retain |
| `packages/platform/src/otp.ts` | 214 | Scan; retain |
| `packages/platform/src/pg-store.ts` | 381 | Scan; retain |
| `packages/platform/src/phone.ts` | 50 | C6 |
| `packages/platform/src/photo-relay.ts` | 269 | C5 |
| `packages/platform/src/photos.ts` | 641 | C6 |
| `packages/platform/src/proxy.ts` | 83 | Scan; retain |
| `packages/platform/src/public-types.ts` | 13 | Scan; retain |
| `packages/platform/src/sessions.ts` | 66 | Scan; retain |
| `packages/platform/src/store.ts` | 399 | Scan; retain |
| `packages/platform/src/turnstile.ts` | 50 | Scan; retain |
| `packages/platform/test/api-security.test.ts` | 268 | Scan; retain |
| `packages/platform/test/api.test.ts` | 442 | Scan; retain |
| `packages/platform/test/blooio-otp.integration.test.ts` | 165 | Scan; retain |
| `packages/platform/test/cloud-auth.pg.test.ts` | 166 | Scan; retain |
| `packages/platform/test/db.test.ts` | 238 | Scan; retain |
| `packages/platform/test/notify-retention.pg.test.ts` | 90 | Scan; retain |
| `packages/platform/test/number-change.pg.test.ts` | 169 | Scan; retain |
| `packages/platform/test/pg.ts` | 37 | C7 |
| `packages/platform/test/photos.test.ts` | 501 | Scan; retain |
| `packages/platform/test/proxy.test.ts` | 95 | Scan; retain |
| `packages/sim/README.md` | 251 | Inventory; retain |
| `packages/sim/package.json` | 16 | Scan; retain |
| `packages/sim/scenarios/band-week-apart.json` | 91 | Scan; retain |
| `packages/sim/scenarios/group-flake-morning-of.json` | 236 | Scan; retain |
| `packages/sim/scenarios/lying-minor-seeks-romance.json` | 31 | Scan; retain |
| `packages/sim/scenarios/member-goes-silent.json` | 64 | Scan; retain |
| `packages/sim/scenarios/minor-joins-single-player.json` | 66 | Scan; retain |
| `packages/sim/scenarios/nyc-to-sf-traveler.json` | 81 | Scan; retain |
| `packages/sim/scenarios/post-match-harassment.json` | 33 | Scan; retain |
| `packages/sim/scenarios/private-disclosure-canary.json` | 62 | Scan; retain |
| `packages/sim/scenarios/stop-keyword.json` | 57 | Scan; retain |
| `packages/sim/src/agent/availability.ts` | 58 | Scan; retain |
| `packages/sim/src/agent/llmAgent.ts` | 183 | Scan; retain |
| `packages/sim/src/agent/policy.ts` | 780 | Scan; retain |
| `packages/sim/src/agent/types.ts` | 147 | Scan; retain |
| `packages/sim/src/apps/README.md` | 33 | Inventory; retain |
| `packages/sim/src/apps/friends/arms.ts` | 27 | Scan; retain |
| `packages/sim/src/apps/friends/baselines.ts` | 169 | C6 |
| `packages/sim/src/apps/friends/cli.ts` | 95 | C3 |
| `packages/sim/src/apps/friends/gates.ts` | 82 | Scan; retain |
| `packages/sim/src/apps/friends/metrics.ts` | 200 | Scan; retain |
| `packages/sim/src/apps/friends/oracle.ts` | 221 | Scan; retain |
| `packages/sim/src/apps/friends/packMatcher.ts` | 94 | Scan; retain |
| `packages/sim/src/apps/friends/persona.ts` | 220 | Scan; retain |
| `packages/sim/src/apps/friends/snapshot.ts` | 204 | Scan; retain |
| `packages/sim/src/apps/friends/visible.ts` | 41 | Scan; retain |
| `packages/sim/src/apps/friends/world.ts` | 324 | Scan; retain |
| `packages/sim/src/apps/gates.ts` | 3 | Scan; retain |
| `packages/sim/src/apps/peon/arms.ts` | 60 | Scan; retain |
| `packages/sim/src/apps/peon/audit.ts` | 68 | Scan; retain |
| `packages/sim/src/apps/peon/baselines.ts` | 142 | Scan; retain |
| `packages/sim/src/apps/peon/cli.ts` | 111 | C3 |
| `packages/sim/src/apps/peon/gates.ts` | 56 | Scan; retain |
| `packages/sim/src/apps/peon/metrics.ts` | 203 | Scan; retain |
| `packages/sim/src/apps/peon/oracle.ts` | 153 | Scan; retain |
| `packages/sim/src/apps/peon/persona.ts` | 252 | Scan; retain |
| `packages/sim/src/apps/peon/skills.ts` | 77 | C6 |
| `packages/sim/src/apps/peon/snapshot.ts` | 132 | Scan; retain |
| `packages/sim/src/apps/peon/world.ts` | 391 | Scan; retain |
| `packages/sim/src/apps/slop/adversarial.ts` | 284 | Scan; retain |
| `packages/sim/src/apps/slop/baselines.ts` | 148 | Scan; retain |
| `packages/sim/src/apps/slop/behavior.ts` | 129 | Scan; retain |
| `packages/sim/src/apps/slop/bodyType.ts` | 39 | Scan; retain |
| `packages/sim/src/apps/slop/clefSynth.ts` | 167 | Scan; retain |
| `packages/sim/src/apps/slop/cli.ts` | 73 | C3 |
| `packages/sim/src/apps/slop/enginePack.ts` | 75 | Scan; retain |
| `packages/sim/src/apps/slop/geo.ts` | 43 | C6 |
| `packages/sim/src/apps/slop/metrics.ts` | 133 | Scan; retain |
| `packages/sim/src/apps/slop/oracle.ts` | 300 | C6 |
| `packages/sim/src/apps/slop/packEval.ts` | 515 | Scan; retain |
| `packages/sim/src/apps/slop/persona.ts` | 359 | C6 |
| `packages/sim/src/apps/slop/relay.ts` | 236 | Scan; retain |
| `packages/sim/src/apps/slop/snapshot.ts` | 339 | Scan; retain |
| `packages/sim/src/apps/slop/visible.ts` | 111 | C6 |
| `packages/sim/src/apps/slop/world.ts` | 323 | Scan; retain |
| `packages/sim/src/channel.ts` | 117 | Scan; retain |
| `packages/sim/src/cli.ts` | 172 | Scan; retain |
| `packages/sim/src/engineAdapter.ts` | 18 | Scan; retain |
| `packages/sim/src/generator.ts` | 380 | Scan; retain |
| `packages/sim/src/index.ts` | 24 | Scan; retain |
| `packages/sim/src/judge/llmJudges.ts` | 111 | C6 |
| `packages/sim/src/judge/metrics.ts` | 697 | Scan; retain |
| `packages/sim/src/judge/rules.ts` | 98 | C6 |
| `packages/sim/src/llmGenerator.ts` | 59 | Scan; retain |
| `packages/sim/src/network.ts` | 3 | Scan; retain |
| `packages/sim/src/oracle.ts` | 396 | Scan; retain |
| `packages/sim/src/persona.ts` | 193 | C6 |
| `packages/sim/src/plans.ts` | 249 | Scan; retain |
| `packages/sim/src/scenario.ts` | 293 | Scan; retain |
| `packages/sim/src/scheduler.ts` | 92 | Scan; retain |
| `packages/sim/src/snapshot.ts` | 400 | Scan; retain |
| `packages/sim/src/sources.ts` | 412 | Scan; retain |
| `packages/sim/src/stubNetwork.ts` | 478 | Scan; retain |
| `packages/sim/src/taxonomy.ts` | 40 | Scan; retain |
| `packages/sim/src/time.ts` | 48 | Scan; retain |
| `packages/sim/src/world.ts` | 558 | Scan; retain |
| `plugins/.claude-plugin/marketplace.json` | 16 | Scan; retain |
| `plugins/README.md` | 23 | Inventory; retain |
| `plugins/build.ts` | 104 | Scan; retain |
| `plugins/claude/.claude-plugin/plugin.json` | 10 | Scan; retain |
| `plugins/claude/.mcp.json` | 9 | Scan; retain |
| `plugins/claude/skills/friends-help/SKILL.md` | 169 | Inventory; retain |
| `plugins/claude/skills/ntwrk-party/SKILL.md` | 172 | Inventory; retain |
| `plugins/claude/skills/peon-biz/SKILL.md` | 129 | Inventory; retain |
| `plugins/claude/skills/slop-date/SKILL.md` | 187 | Inventory; retain |
| `plugins/openai/assets/icon.png` | 14 | Inventory; retain |
| `plugins/openai/assets/logo.png` | 61 | Inventory; retain |
| `plugins/openai/mcp.json` | 7 | Scan; retain |
| `plugins/openai/plugin.json` | 29 | Scan; retain |
| `plugins/openai/skills/friends-help/SKILL.md` | 169 | Inventory; retain |
| `plugins/openai/skills/friends-help/agents/openai.yaml` | 9 | Scan; retain |
| `plugins/openai/skills/ntwrk-party/SKILL.md` | 171 | Inventory; retain |
| `plugins/openai/skills/ntwrk-party/agents/openai.yaml` | 9 | Scan; retain |
| `plugins/openai/skills/peon-biz/SKILL.md` | 129 | Inventory; retain |
| `plugins/openai/skills/peon-biz/agents/openai.yaml` | 9 | Scan; retain |
| `scripts/check-contract-mirror.ts` | 40 | Scan; retain |
| `scripts/clef-fit.ts` | 207 | Scan; retain |
| `scripts/platform-dev.ts` | 127 | Scan; retain |
| `scripts/relay-clef-lib.ts` | 71 | Scan; retain |
| `scripts/relay-eval.ts` | 219 | Scan; retain |
| `scripts/require-pg.ts` | 25 | Scan; retain |
| `scripts/sim.ts` | 107 | Scan; retain |
| `scripts/sim/audit.ts` | 428 | Scan; retain |
| `scripts/sim/capital.ts` | 20 | Scan; retain |
| `scripts/sim/clef.ts` | 223 | Scan; retain |
| `scripts/sim/conformance.ts` | 189 | Scan; retain |
| `scripts/sim/evals.ts` | 163 | Scan; retain |
| `scripts/sim/friends.ts` | 125 | Scan; retain |
| `scripts/sim/gate.ts` | 75 | Scan; retain |
| `scripts/sim/network.ts` | 319 | Scan; retain |
| `scripts/sim/onboard.ts` | 460 | Scan; retain |
| `scripts/sim/ops.ts` | 463 | Scan; retain |
| `scripts/sim/peon-seats.ts` | 269 | Scan; retain |
| `scripts/sim/peon.ts` | 158 | Scan; retain |
| `scripts/sim/pipeline.ts` | 438 | Scan; retain |
| `scripts/sim/pipeline/harness.ts` | 153 | C7 |
| `scripts/sim/relay.ts` | 615 | Scan; retain |
| `scripts/sim/safety.ts` | 489 | Scan; retain |
| `scripts/sim/slop-live.ts` | 296 | Scan; retain |
| `scripts/sim/slop.ts` | 342 | Scan; retain |
| `scripts/sites-dev.ts` | 141 | Scan; retain |
| `scripts/synthetic/common.ts` | 171 | Scan; retain |
| `scripts/synthetic/generate.ts` | 939 | Scan; retain |
| `scripts/synthetic/load.ts` | 195 | Scan; retain |
| `scripts/synthetic/names.ts` | 47 | Scan; retain |
| `scripts/synthetic/validate.ts` | 608 | Scan; retain |
| `scripts/wrangler.sh` | 117 | Scan; retain |
| `sites/PRODUCT.md` | 61 | Inventory; retain |
| `sites/README.md` | 121 | Inventory; retain |
| `sites/agents.ts` | 75 | Scan; retain |
| `sites/friends.help/public/404.html` | 19 | Inventory; retain |
| `sites/friends.help/public/favicon.svg` | 2 | Inventory; retain |
| `sites/friends.help/public/index.html` | 31 | Inventory; retain |
| `sites/friends.help/public/join.html` | 82 | Inventory; retain |
| `sites/friends.help/public/privacy.html` | 61 | Inventory; retain |
| `sites/friends.help/public/styles.css` | 155 | Inventory; retain |
| `sites/friends.help/public/terms.html` | 50 | Inventory; retain |
| `sites/friends.help/static/robots.txt` | 3 | Inventory; retain |
| `sites/friends.help/wrangler.toml` | 23 | Scan; retain |
| `sites/ntwrk.party/public/404.html` | 7 | Inventory; retain |
| `sites/ntwrk.party/public/favicon.svg` | 2 | Inventory; retain |
| `sites/ntwrk.party/public/index.html` | 31 | Inventory; retain |
| `sites/ntwrk.party/public/join.html` | 87 | Inventory; retain |
| `sites/ntwrk.party/public/privacy.html` | 57 | Inventory; retain |
| `sites/ntwrk.party/public/styles.css` | 110 | Inventory; retain |
| `sites/ntwrk.party/public/terms.html` | 37 | Inventory; retain |
| `sites/ntwrk.party/static/robots.txt` | 3 | Inventory; retain |
| `sites/ntwrk.party/wrangler.toml` | 23 | Scan; retain |
| `sites/peon.biz/public/404.html` | 19 | Inventory; retain |
| `sites/peon.biz/public/favicon.svg` | 2 | Inventory; retain |
| `sites/peon.biz/public/index.html` | 31 | Inventory; retain |
| `sites/peon.biz/public/join.html` | 82 | Inventory; retain |
| `sites/peon.biz/public/privacy.html` | 61 | Inventory; retain |
| `sites/peon.biz/public/styles.css` | 154 | Inventory; retain |
| `sites/peon.biz/public/terms.html` | 50 | Inventory; retain |
| `sites/peon.biz/static/robots.txt` | 3 | Inventory; retain |
| `sites/peon.biz/wrangler.toml` | 23 | Scan; retain |
| `sites/shared/agent.ts` | 89 | Scan; retain |
| `sites/shared/api.ts` | 197 | Scan; retain |
| `sites/shared/auth.ts` | 144 | Scan; retain |
| `sites/shared/demo.ts` | 51 | Scan; retain |
| `sites/shared/fonts/host-grotesk.woff2` | 91 | Inventory; retain |
| `sites/shared/join.ts` | 191 | Scan; retain |
| `sites/shared/landing.css` | 86 | Inventory; retain |
| `sites/shared/logos/claude.svg` | 1 | Inventory; retain |
| `sites/shared/logos/cursor.svg` | 1 | Inventory; retain |
| `sites/shared/logos/gemini.svg` | 1 | Inventory; retain |
| `sites/shared/logos/grok.svg` | 1 | Inventory; retain |
| `sites/shared/logos/hermesagent.svg` | 1 | Inventory; retain |
| `sites/shared/logos/imessage.svg` | 1 | Inventory; retain |
| `sites/shared/logos/muse.svg` | 1 | Inventory; retain |
| `sites/shared/logos/openai.svg` | 1 | Inventory; retain |
| `sites/shared/logos/openclaw.svg` | 1 | Inventory; retain |
| `sites/shared/logos/perplexity.svg` | 1 | Inventory; retain |
| `sites/shared/member.css` | 13 | Inventory; retain |
| `sites/shared/prefill.ts` | 12 | Scan; retain |
| `sites/shared/turnstile.ts` | 78 | Scan; retain |
| `sites/shared/ui.ts` | 86 | Scan; retain |
| `sites/sites.ts` | 260 | Scan; retain |
| `sites/skill-responses.ts` | 44 | Scan; retain |
| `sites/skills.config.ts` | 66 | Scan; retain |
| `sites/skills/friends-help/SKILL.md` | 130 | Inventory; retain |
| `sites/skills/ntwrk-party/SKILL.md` | 133 | Inventory; retain |
| `sites/skills/peon-biz/SKILL.md` | 129 | Inventory; retain |
| `sites/skills/slop-date/SKILL.md` | 148 | Inventory; retain |
| `sites/slop.date/public/404.html` | 19 | Inventory; retain |
| `sites/slop.date/public/favicon.svg` | 2 | Inventory; retain |
| `sites/slop.date/public/index.html` | 32 | Inventory; retain |
| `sites/slop.date/public/join.html` | 83 | Inventory; retain |
| `sites/slop.date/public/privacy.html` | 62 | Inventory; retain |
| `sites/slop.date/public/styles.css` | 166 | Inventory; retain |
| `sites/slop.date/public/terms.html` | 50 | Inventory; retain |
| `sites/slop.date/static/robots.txt` | 3 | Inventory; retain |
| `sites/slop.date/wrangler.toml` | 23 | Scan; retain |
| `sites/test/contract.test.ts` | 166 | Scan; retain |
| `sites/test/sites.test.ts` | 525 | Scan; retain |
| `sites/tsconfig.json` | 11 | Scan; retain |
| `tests/e2e/agent-return.e2e.test.ts` | 78 | Scan; retain |
| `tests/e2e/auth-feedback.e2e.test.ts` | 93 | Scan; retain |
| `tests/e2e/harness.ts` | 291 | Scan; retain |
| `tests/e2e/notify.e2e.test.ts` | 89 | Scan; retain |
| `tests/e2e/platform.e2e.test.ts` | 1097 | Scan; retain |
| `tests/e2e/signup-draft.e2e.test.ts` | 131 | Scan; retain |
| `tools/clef-label/README.md` | 76 | Inventory; retain |
| `tools/clef-label/index.html` | 237 | Inventory; retain |
| `tsconfig.json` | 10 | Scan; retain |
