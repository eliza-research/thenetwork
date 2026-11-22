# Formal coverage at the source revision

This is the historical coverage ledger from `30d950e1d6fa027a67b94cc6b03ba379dc923a63`. Its model names refer to [the imported models](../README.md). Its code and proof paths refer to that revision. The counts, verdicts, and runtime coverage have yet to be reconciled with the current branch.

## Verdicts

- **covered**: a Quint model covers the flow and a LemmaScript core holds the decisions. Or one level applies and the reason says why the other level adds nothing (for example, interval arithmetic has no state).
- **na**: the file has no decision and no state, or it is not production code. Examples: types, data tables, prompts, copy, re-exports, the simulator harness, dev tools, and SQL migrations. The Quint schema models and the integration tests cover the SQL.
- **gap-quint**, **gap-lemma**, **gap-both**: production code with a flow or a decision that has no model. On 2026-11-08 the first classification found 22 gaps. The same day, this branch closed all 22 (see docs/results/2026-11-08-lemmascript-frontend.md, section "Whole-app gaps"). The count is now 0.

How the ledger was made: six agents read every file and the models on the three branches through git (no checkout). Each agent returned one row for each file in its slice, and a script checked that no file was missing and no file was extra. The rows are generated. This header and the 22 closed rows are hand-written. Keep the ledger current: a PR that adds a file adds its row.

## Ledger

| Verdict | Files |
|---|---|
| covered | 311 |
| na | 416 |
| gap-quint | 0 |
| gap-lemma | 0 |
| gap-both | 0 |
| total | 727 |

| File | Role | Quint | LemmaScript | Verdict | Reason |
|---|---|---|---|---|---|
| .github/runtime-eb4f-mcpon-v2/oci_to_docker.py | harness | none | none | na | CI image qualification script; deploy-ops.md M19 says this receipt flow needs no model. |
| .github/runtime-eb4f-mcpon-v2/probe.ts | harness | none | none | na | Read-only HTTP probe for image qualification; it makes no product decision. |
| .github/runtime-eb4f-mcpon-v2/qualify.py | harness | none | none | na | CI qualification driver with a closed grant check; deploy-ops.md M19 gives it no Quint value. |
| .github/runtime-eb4f-mcpon-v2/setup.ts | harness | none | none | na | Setup step for image qualification; no product state or decision. |
| .github/runtime-eb4f/oci_to_docker.py | harness | none | none | na | CI image conversion script; deploy-ops.md M19 says this flow needs no model. |
| .github/runtime-eb4f/probe.ts | harness | none | none | na | Read-only HTTP probe for image qualification; it makes no product decision. |
| .github/runtime-eb4f/qualify.py | harness | none | none | na | CI qualification driver; deploy-ops.md M19 gives it no Quint value. |
| .github/runtime-eb4f/setup.ts | harness | none | none | na | Setup step for image qualification; no product state or decision. |
| .github/workflows/deploy-sites.yml | production | boot_config [wave4/boot_config] | none | covered | The sites deploy workflow (M-148) with one proxy secret per Pages project (M-131): approval, Inspect, PATCH and readback, deploy, smoke, in matrix order. |
| apps/site/prerender.ts | production | spec/sitePages.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, sitePages and does not recompute them. |
| apps/site/src/App.tsx | production | spec/browserJoin.md, spec/landingEntry.md, spec/sitePages.md, spec/phonePage.md, spec/homeHelpPage.md, spec/photoUploadPage.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, sitePages and does not recompute them. |
| apps/site/src/entry-server.tsx | production | spec/brandIdentity.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, sitePages and does not recompute them. |
| apps/site/src/main.tsx | production | spec/landingEntry.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| apps/site/src/site.ts | production | spec/sitePages.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, sitePages and does not recompute them. |
| apps/site/test/render.tsx | harness | none | none | na | Render check of the site pages; no production decision. |
| apps/site/vite.config.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| deploy/backend/backend.ts | production | auth_edge [wave2/auth_edge], runtime_ops [wave2/runtime_ops], notify_capital [wave2/notify_capital], boot_config [wave4/boot_config] | deploy/backend/route.ts [claude/lemmascript-backend] | covered | The public route allow-list is the verified publicRoute core, and edge trust, tick loop and boot are in Quint. |
| deploy/backend/ops.ts | production | runtime_ops [wave2/runtime_ops] | none | covered | Alert dispatcher and bias alerts are modelled in runtime_ops; the backend doc rates a LemmaScript proof as model-only with no invariant. |
| deploy/backend/route.ts | production | runtime_ops, auth_edge [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| deploy/backend/server.ts | production | runtime_ops [wave2/runtime_ops], boot_config [wave4/boot_config] | none | covered | Process boot and lifecycle are modelled in runtime_ops; boot_config models its config gate (loadConfig), the environment-row init and the service-login check. No pure decision for LemmaScript. |
| deploy/backup/backup.ts | production | runtime_ops [wave2/runtime_ops] | none | covered | Backup flow is in the pg-restore-recovery machine; the file is process and stream code with no pure decision. |
| deploy/backup/lib.ts | production | runtime_ops [wave2/runtime_ops] | none | covered | Restore recovery is modelled in runtime_ops; sameServer and compareCounts are small helpers the backend doc rates model-only. |
| deploy/backup/refusal.ts | production | backup_restore [claude/lemmascript-frontend] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| deploy/backup/restore.ts | production | backup_restore [claude/lemmascript-frontend] | deploy/backup/refusal.ts [claude/lemmascript-backend] | covered | Gap closed on 2026-11-08: The restore refusal checks (restore.ts:38-46) are not extracted into a verified restoreRefusal core. |
| deploy/cloudflare/worker.ts | production | runtime_ops [wave2/runtime_ops] | none | covered | The backend cutover is machine M-147 in runtime_ops; the file is container config checks with no LemmaScript fragment. |
| deploy/pages-worker.ts | production | auth_edge [wave2/auth_edge], boot_config [wave4/boot_config] | none | covered | It is an env-merge wrapper around the router, named as evidence for the edge-trust machine; no decision of its own. |
| deploy/router.ts | production | auth_edge [wave2/auth_edge], spec/sitePages.md | packages/core/src/generated/sitePages.ts | covered | The retired settings and join paths and the backend forward call the generated routeFor and answerFor; the signed proxy hop is in the edge-trust machine. The cited in-place proof of isBackendPath is from the source revision. |
| deploy/smoke.ts | devtool | none | none | na | Read-only post-deploy HTTP check; it holds no product state or decision. |
| design/member-flows/server.ts | removed | none | none | na | Not on this branch. The generated storybook of packages/ui replaces the design studio. |
| eslint.config.js | devtool | none | none | na | Lint configuration: the stack import bans and the design-system token rules. It holds no product state or decision. |
| packages/blooio/src/adapters/blooio-adapter.ts | production | none | none | na | I/O wrapper over the provider client; the DryRunAdapter counter has no lifecycle (blooio-notify.md, messaging-ops.md N/A). |
| packages/blooio/src/blooio/client.ts | production | outbound_queue [claude/quint-state-machines] | self (classifyFailure) [claude/lemmascript-backend] | covered | classifyFailure is proved in place; provider send idempotency is in the outbound_queue model (blooio-notify.md section 5). |
| packages/blooio/src/blooio/webhook.ts | production | turn_consent [claude/quint-state-machines] | none | covered | webhook-intake is a turn_consent machine; LemmaScript is not applicable to HMAC, regex and JSON parse (messaging-ops.md N/A), and the security tests cover the signature window. |
| packages/blooio/src/gate.ts | production | outbound_queue [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/blooio/src/index.ts | production | none | none | na | Re-exports only. |
| packages/blooio/src/line.ts | production | none | none | na | A line constant and an env read; resolveSenderLine is pure with no decision of note (blooio-notify.md). |
| packages/blooio/src/outbound-queue.ts | production | outbound_queue, identity_sagas, opportunity [claude/quint-state-machines] | packages/blooio/src/gate.ts [claude/lemmascript-backend] | covered | dispatch and applyStatus call the proved gate core, and outbound_queue models the row lifecycle, cap slot and live-send gate. |
| packages/blooio/src/phone.ts | production | phone_identity [claude/lemmascript-frontend] | packages/core/src/phone-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: toE164 normalizes numbers that bans key on, but it does not call the proved phoneE164 in core/src/phone-core.ts and has no proof of its own. |
| packages/blooio/src/quiet-hours.ts | production | outbound_queue [claude/quint-state-machines] | packages/blooio/src/quiet-window.ts [claude/lemmascript-backend] | covered | isQuietAt and nextAllowedAt call the proved quiet-window core; outbound_queue has the quiet-hours machine as an oracle. |
| packages/blooio/src/quiet-window.ts | production | outbound_queue [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/blooio/src/types.ts | data | none | none | na | Types and one error class. |
| packages/capital/experiments/run.ts | harness | none | none | na | Experiment harness for the synthetic capital world, not production. |
| packages/capital/experiments/world.ts | harness | none | none | na | Synthetic world that drives the levers in experiments only. |
| packages/capital/src/config.ts | config | none | none | na | Object merge of amounts and limits with runtime range checks; no decision (messaging-ops.md N/A). |
| packages/capital/src/credit.ts | production | notify_capital [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/capital/src/detect.ts | production | none | none | na | Graph fraud detection whose output goes to a human reviewer and has no production caller (capital.md 0.1). |
| packages/capital/src/index.ts | production | none | none | na | Re-exports only. |
| packages/capital/src/ledger.ts | production | notify_capital [wave2/notify_capital] | packages/capital/src/credit.ts, packages/core/src/policy.ts [claude/lemmascript-backend] | covered | credit amounts and eligibility call proved cores, and notify_capital models intake, vouch, plan and reversal. |
| packages/capital/src/levers.ts | production | notify_capital [wave2/notify_capital] | packages/capital/src/credit.ts [claude/lemmascript-backend] | covered | tierOf, capacity and reachOf are proved in credit.ts; capital-lever-locks is a notify_capital machine with actions left out because levers have no production trigger. |
| packages/capital/src/store.ts | production | none | none | na | JSON Lines file I/O with no production caller (capital.md 0.1). |
| packages/capital/src/types.ts | data | none | none | na | Types only. |
| packages/capital/src/validate.ts | production | notify_capital [wave2/notify_capital] | none | covered | Event rejection is part of the capital-event-intake machine (capital.md I3); LemmaScript is not applicable to typeof narrowing over unknown. |
| packages/capital/src/view.ts | production | none | none | na | Member-facing copy only. |
| packages/core/src/chatJson.ts | production | chatjson_loop [claude/lemmascript-frontend] | packages/core/src/chatjson-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The ask, parse, validate and retry loop is the chatjson-loop machine (core.md, P2) but no Quint module models it; LemmaScript is not applicable to its await and callbacks. |
| packages/core/src/chatjson-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/core/src/clock.ts | production | none | none | na | Clock interface and a small SimClock class; no decision. |
| packages/core/src/fact-window.ts | production | profile_learning [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/core/src/fence.ts | production | none | self (defang, splitAfter, tripleAt) [claude/lemmascript-backend] | covered | defang is proved in place; the file has no state, so a Quint model is not meaningful. |
| packages/core/src/geo.ts | production | none | none | na | Trigonometric distance math with no decision. |
| packages/core/src/guard.ts | production | outbound_queue, oauth_mcp [claude/quint-state-machines, wave2/oauth_mcp] | packages/core/src/fact-window.ts [claude/lemmascript-backend] | covered | factMatches calls the proved windowHit core; the leak-gate machine is an oracle in outbound_queue and output-leak-gate in oauth_mcp. |
| packages/core/src/index.ts | production | none | none | na | Re-exports only. |
| packages/core/src/llm.ts | production | runtime_ops [wave2/runtime_ops] | none | covered | runtime_ops models the llm-call retry and fallback bound; LemmaScript is not applicable to network, await and ** (core.md MODEL ONLY). |
| packages/core/src/network.ts | data | none | none | na | Types and one constant table. |
| packages/core/src/phone-core.ts | production | join_flow [claude/lemmascript-frontend] | self (phoneE164) [claude/lemmascript-frontend] | covered | phoneE164 is a verify file and join_flow names it for the site join flow. |
| packages/core/src/pii.ts | production | none | none | na | Regex detection only; neither tool fits and corpora test it (core.md N/A). |
| packages/core/src/policy.ts | production | join_age, plan_run [claude/quint-state-machines] | self (ageInRange, joinableAge, adultAge) [claude/lemmascript-backend] | covered | The age predicates are proved, and join_age models the age floor and minor policy. |
| packages/core/src/replies.ts | production | opportunity, turn_consent [claude/quint-state-machines] | packages/core/src/reply-decision.ts [claude/lemmascript-backend] | covered | parseReply calls the proved decideReply core; reply-reader is in opportunity and optout-reader is in turn_consent. |
| packages/core/src/reply-decision.ts | production | turn_consent, opportunity [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/core/src/rng.ts | production | none | self (indexOf01) [claude/lemmascript-backend] | covered | The index bound is proved; seeded RNG has no lifecycle, so a Quint model is not meaningful. |
| packages/core/src/runlog.ts | data | none | none | na | Run record types and JSON parse. |
| packages/core/src/stats.ts | production | none | none | na | Evaluation metric (gini) with no safety decision. |
| packages/core/src/svc/contract.ts | data | turn_consent [claude/quint-state-machines] | none | na | Pinned wire types and paths; turn_consent models the TurnResponse consent field it declares. |
| packages/core/src/svc/learning-collection-command.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The deadline calls the proved collectionExpiry, and profile_learning models batch expiry and collection-claim. |
| packages/core/src/svc/learning-consent-context.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The proof window calls the proved proofWindowOk, and profile_learning models learning-context-proof. |
| packages/core/src/svc/network-delegation.ts | production | auth_edge [wave2/auth_edge], cloud_auth [wave4/cloud_auth] | none | covered | auth_edge names this file for Cloud login delegation; LemmaScript is not applicable to its unknown, Object.entries and regex (core.md). |
| packages/core/src/svc/profile-review-disconnect.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The time window calls proofWindowOk, and profile_learning models review-proofs and connection cleanup. |
| packages/core/src/svc/profile-review-owner.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The time window calls proofWindowOk, and profile_learning models the owner proof. |
| packages/core/src/svc/profile-review-source.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The time window calls proofWindowOk, and profile_learning names this file for the 5 s source proof. |
| packages/core/src/svc/profile-review-withdrawal.ts | production | profile_learning [wave2/profile_learning] | packages/core/src/svc/proof-window.ts [claude/lemmascript-backend] | covered | The time window calls proofWindowOk, and profile_learning models owner-withdrawal-v2. |
| packages/core/src/svc/proof-window.ts | production | turn_consent [claude/quint-state-machines], cloud_auth [wave4/cloud_auth] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/core/src/svc/svc-auth.ts | production | auth_edge, profile_learning [wave2/auth_edge, wave2/profile_learning] | none | covered | auth_edge models svc-auth acceptance and skew; the file is a pinned byte-identical mirror with WebCrypto, so LemmaScript is not applicable. |
| packages/core/src/time.ts | production | none | self (hourInWindow) [claude/lemmascript-backend] | covered | The quiet-hour window is proved in place; the file is pure, so a Quint model is not meaningful. |
| packages/core/src/types.ts | data | none | none | na | Domain types plus one typeof guard. |
| packages/design-system/build.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| packages/design-system/src/brands.ts | data | none | none | na | Brand id list of the design system; brands differ only by tokens, logos and text. |
| packages/engine/src/attention.ts | production | matching_engine [wave2/matching_engine], opportunity [claude/quint-state-machines] | packages/engine/src/attentionCore.ts, packages/engine/src/planCore.ts [claude/lemmascript-backend] | covered | Cap, item gate and probe quorum call proved cores, and attention-compose and probe-flow are in matching_engine. |
| packages/engine/src/attentionCore.ts | production | matching_engine, opportunity [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/complementarity.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: The romanceMutual gate and complement scores read World and no model names this file; backend marks it MODEL ONLY. |
| packages/engine/src/config.ts | config | plan_run [claude/quint-state-machines], matching_engine [wave2/matching_engine] | none | na | Default values and a deep merge; the Quint models pin its quorum, probe wait and judge TTL as constants. |
| packages/engine/src/embed.ts | production | none | none | na | Regex tokenizer and cosine arithmetic with no safety decision or state. |
| packages/engine/src/engine.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/filterCore.ts, packages/engine/src/selectionGuard.ts (via policy.ts guardSelection) [claude/lemmascript-backend] | covered | The engine-pipeline machine is in matching_engine, and the judge-only-removes rule and final selection guard are proved cores. |
| packages/engine/src/explain.ts | production | none | none | na | Text assembly; the leak checks that matter live in the core guard. |
| packages/engine/src/filterCore.ts | production | matching_engine [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/filters.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] | covered | memberReason and pairReason call filterCore, and the hard-filter-chain is in matching_engine. |
| packages/engine/src/genkit.ts | production | none | none | na | Small candidate helpers and bounds that no safety decision depends on. |
| packages/engine/src/geo.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: The city-bucket geo pair reason and presence overlap have no model; only interval.ts below it is proved. |
| packages/engine/src/group.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: Group beam search uses proved filter cores, but no Quint model covers group composition. |
| packages/engine/src/hash.ts | production | none | none | na | Hash helper over node:crypto with no decision. |
| packages/engine/src/index.ts | production | none | none | na | Re-exports only. |
| packages/engine/src/interval.ts | production | none | packages/engine/src/intervalCore.ts [claude/lemmascript-backend] | covered | subtract and union call intervalCore; interval arithmetic has no state, so a Quint model is not meaningful. |
| packages/engine/src/intervalCore.ts | production | plan_run [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/judge.ts | production | matching_engine [wave2/matching_engine] | none | covered | The judge-passes machine is in matching_engine; pipelineDecision runs in evals only, so a proof adds little. |
| packages/engine/src/judgeCommon.ts | production | matching_engine [wave2/matching_engine] | none | covered | The judge cache TTL is in matching_engine judge-passes-and-cache; the rest is async I/O and parsing. |
| packages/engine/src/judgeConstants.ts | data | none | none | na | Constants only. |
| packages/engine/src/judgeDeep.ts | production | matching_engine [wave2/matching_engine] | none | covered | The deep pass is part of the judge-passes machine in matching_engine; deepDecision is one comparison and hardGate reads World. |
| packages/engine/src/judgeScreen.ts | production | matching_engine [wave2/matching_engine] | none | covered | The screen pass is part of the judge-passes machine; the file is a prompt and parser with a one-line decision. |
| packages/engine/src/pack.ts | production | none | none | na | AppPack types plus validatePack, which only the sim conformance script calls. |
| packages/engine/src/packs/decisions.ts | production | matching_engine [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/packs/friends/copy.ts | data | none | none | na | Copy strings and a regex framing list. |
| packages/engine/src/packs/friends/generators.ts | production | none | none | na | World-bound generators; the guarantees live in the core filters. |
| packages/engine/src/packs/friends/geo.ts | data | none | none | na | Neighborhood tables and transit arithmetic. |
| packages/engine/src/packs/friends/index.ts | production | none | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | The pair reason calls the proved beyondTolerance; the rest is config, and a stateless symmetric predicate needs no Quint model. |
| packages/engine/src/packs/friends/info.ts | production | none | none | na | Tag reader with no decision of its own. |
| packages/engine/src/packs/friends/planner.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: Crews are in plan_crew and eligibility uses filterCore, but the weekly planner pass order has no model (local only). |
| packages/engine/src/packs/friends/rules.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: groupSizeOk is proved, but matching_engine models only the slop and peon filter chains, not the friends chain. |
| packages/engine/src/packs/network/activities.ts | data | none | none | na | Activity data table. |
| packages/engine/src/packs/network/calibrator.ts | data | none | none | na | Calibration knot constants. |
| packages/engine/src/packs/network/copy.ts | data | none | none | na | Copy strings. |
| packages/engine/src/packs/network/generators.ts | production | none | none | na | World-bound generators; every pair, member and minor rule repeats in candidateReason, which is proved. |
| packages/engine/src/packs/network/index.ts | production | none | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | itemGate calls the proved romanceItemAllowed; the rest is config, and a stateless gate needs no Quint model. |
| packages/engine/src/packs/network/judgeContext.ts | production | none | none | na | Pseudonymous JSON context builder with no decision. |
| packages/engine/src/packs/network/ontology.ts | data | none | none | na | Ontology data and a regex constraint reader covered by sims. |
| packages/engine/src/packs/network/prompts.ts | data | none | none | na | Prompt strings. |
| packages/engine/src/packs/network/rules.ts | production | engine_rules [claude/lemmascript-frontend] | packages/engine/src/packs/network/rulesCore.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The network member and pair rules (budgets, cooldowns, romanceCompatible) have no proved core and are not in matching_engine. |
| packages/engine/src/packs/network/rulesCore.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/engine/src/packs/network/taxonomy.ts | data | none | none | na | Taxonomy data. |
| packages/engine/src/packs/network/vocabulary.ts | data | none | none | na | Vocabulary data. |
| packages/engine/src/packs/peon/copy.ts | data | none | none | na | Copy with leak checks. |
| packages/engine/src/packs/peon/generators.ts | production | none | none | na | World-bound generator; guarantees are in the core filters. |
| packages/engine/src/packs/peon/index.ts | config | none | none | na | Pack config object. |
| packages/engine/src/packs/peon/judge.ts | production | none | none | na | Prompt and context builder. |
| packages/engine/src/packs/peon/match.ts | production | none | none | na | Float scoring tuned by sims; no safety decision. |
| packages/engine/src/packs/peon/profile.ts | production | matching_engine [wave2/matching_engine] | none | covered | Open postings and candidates are in matching_engine; the file is a tag parser, so a proof is not meaningful. |
| packages/engine/src/packs/peon/rules.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | workAuthOk and locationOk call proved cores, and the peon rule chain is in matching_engine. |
| packages/engine/src/packs/peon/schema.ts | data | none | none | na | Constants. |
| packages/engine/src/packs/peon/seats.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | seatLeft and the age check are proved, and job-seat-item is in matching_engine. |
| packages/engine/src/packs/peon/selection.ts | production | none | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | slateCap calls the proved slateCapOf; it is per-run arithmetic, and seat state is modeled through seats.ts in matching_engine. |
| packages/engine/src/packs/peon/testkit.ts | harness | none | none | na | Test data generator. |
| packages/engine/src/packs/slop/appearance.ts | production | photos_rating [wave2/photos_rating] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | canRatePhotos calls the proved photosRatable, and the photo-rating gate is the clef-rating machine in photos_rating. |
| packages/engine/src/packs/slop/assign.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | greedyRound calls the proved greedyPick, and slop-assignment is in matching_engine. |
| packages/engine/src/packs/slop/biasMonitor.ts | production | runtime_ops [wave2/runtime_ops] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | isAlert and quintileOf are proved, and the weekly bias report and alert lifecycle are in runtime_ops. |
| packages/engine/src/packs/slop/clef-fit/audit.ts | devtool | none | none | na | Offline statistics report for weight fitting. |
| packages/engine/src/packs/slop/clef-fit/features.ts | devtool | none | none | na | Operator feature extraction tool, not on the production path. |
| packages/engine/src/packs/slop/clef-fit/fit.ts | devtool | none | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | na | Offline Newton fitter; it already reuses the proved photoPasses gate. |
| packages/engine/src/packs/slop/clef-fit/index.ts | devtool | none | none | na | Re-exports. |
| packages/engine/src/packs/slop/clef.ts | production | photos_rating [wave2/photos_rating] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | The adult gate calls the proved photoPasses, and the rater is the clef-rating oracle in photos_rating. |
| packages/engine/src/packs/slop/clefWeights.ts | data | none | none | na | Placeholder weights and a JSON validator; platform photos.ts refuses files without provenance first. |
| packages/engine/src/packs/slop/copy.ts | production | photos_rating [wave2/photos_rating] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | slopProbeMessage is proved in decisions.ts and is the probe-photo claim in photos_rating; other strings are copy. |
| packages/engine/src/packs/slop/extract.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | finalize and the age merge call matchableOf, minorOf and lowerAge, and slop-onboarding is in matching_engine. |
| packages/engine/src/packs/slop/generators.ts | production | none | none | na | World-bound generator; firstOf only orders a pair. |
| packages/engine/src/packs/slop/geo.ts | production | engine_rules [claude/lemmascript-frontend] | packages/engine/src/packs/slop/geoCore.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The mutual radius filter is a hard decision with no proved core, and matching_engine abstracts distance as an oracle bit. |
| packages/engine/src/packs/slop/geoCore.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/engine/src/packs/slop/index.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | itemGate and the seek checks call proved cores, and the basics ask is in matching_engine. |
| packages/engine/src/packs/slop/judge.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | The seek test uses the proved mutualSeek and judge passes are in matching_engine; the rest is a prompt builder. |
| packages/engine/src/packs/slop/learn.ts | production | none | none | na | Attraction model off by default, float exp and log with no safety decision. |
| packages/engine/src/packs/slop/onboard.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | applyCorrection and nextQuestion call confirmedAfter and firstQuestion, and slop-onboarding is in matching_engine. |
| packages/engine/src/packs/slop/options.ts | config | matching_engine [wave2/matching_engine] | none | na | Default options data; matching_engine pins its reprobe and ask values as constants. |
| packages/engine/src/packs/slop/plan.ts | production | matching_engine [wave2/matching_engine], photos_rating [wave2/photos_rating] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | probePhotoRefs calls the proved probePhotoIds, and venue booking and probe photos are modeled. |
| packages/engine/src/packs/slop/profile.ts | production | matching_engine [wave2/matching_engine], safety_trust [claude/quint-state-machines] | none | covered | Member history and silent asks are in the Quint models; the file is a tag parser, so a proof is not meaningful. |
| packages/engine/src/packs/slop/rules.ts | production | matching_engine [wave2/matching_engine], safety_trust [claude/quint-state-machines] | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | reviewReason, agesMutual, reprobeReason and mutualSeek are proved, and the rule chain and review hold are modeled. |
| packages/engine/src/packs/slop/score.ts | production | none | packages/engine/src/packs/decisions.ts [claude/lemmascript-backend] | covered | dealbreakerHit is proved; the rest is float scoring, where a state model is not meaningful. |
| packages/engine/src/packs/slop/zips.ts | data | none | none | na | ZIP centroid table and distance arithmetic. |
| packages/engine/src/pairKey.ts | production | matching_engine [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/planCore.ts | production | plan_run [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/plans.ts | production | plan_run, plan_crew [claude/quint-state-machines], matching_engine [wave2/matching_engine] | packages/engine/src/planCore.ts, packages/engine/src/attentionCore.ts [claude/lemmascript-backend] | covered | Plan choice, answers and fallback call planCore, and plan-run and plan-fallback are in plan_run; the crew offer and sessions (crewOptIn, crewSessionPlan) are in plan_crew. |
| packages/engine/src/policy.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/selectionGuard.ts, packages/engine/src/scoreCore.ts [claude/lemmascript-backend] | covered | guardSelection and the debt step call proved cores, and global-selection is in matching_engine. |
| packages/engine/src/relay.ts | production | relay [claude/quint-state-machines] | packages/engine/src/relayCore.ts [claude/lemmascript-backend] | covered | relayItem decisions call relayCore, and relay-item is in the relay module. |
| packages/engine/src/relayClef.ts | production | relay [claude/quint-state-machines] | packages/engine/src/relayCore.ts [claude/lemmascript-backend] | covered | relayClefDecide calls the proved headOutcome, and the relay-classifier-hook machine is in the relay module. |
| packages/engine/src/relayClefFit.ts | devtool | none | none | na | Offline logistic fitter and arm report. |
| packages/engine/src/relayCore.ts | production | relay [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/retrieval.ts | production | candidate_pool [claude/lemmascript-frontend] | packages/engine/src/filterCore.ts [claude/lemmascript-backend] for the filters; the rest is World search and scores | covered | Gap closed on 2026-11-08: eligibleMembers and two-hop retrieval filter the pool with no model; backend marks it MODEL ONLY. |
| packages/engine/src/scoreCore.ts | production | matching_engine [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/scoring.ts | production | matching_engine [wave2/matching_engine] | packages/engine/src/scoreCore.ts [claude/lemmascript-backend] | covered | netValue calls scoreCore, and the candidate lifecycle is merged into the engine-pipeline machine. |
| packages/engine/src/selectionGuard.ts | production | matching_engine [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/engine/src/testkit.ts | harness | none | none | na | Random world generator for tests and sims. |
| packages/engine/src/types.ts | data | none | none | na | Types and one constant. |
| packages/engine/src/world.ts | production | matching_engine [wave2/matching_engine], opportunity [claude/quint-state-machines] | packages/engine/src/pairKey.ts, packages/engine/src/scoreCore.ts [claude/lemmascript-backend] | covered | pairKey and acceptanceOf call proved cores, and budgets and interaction reads are in the Quint models. |
| packages/mcp/db/oauth.sql | sql | oauth_mcp [wave2/oauth_mcp] | none | covered | oauth_mcp models the grant foreign key and the cloud-grant trigger; SQL is outside LemmaScript and the security suite tests it. |
| packages/mcp/src/apps.ts | production | oauth_mcp, spec/connectorTools.md | packages/core/src/generated/connectorTools.ts | covered | The app table and host maps, and mcpPath and appAtPath: the app of each MCP path on each host. The paths call the generated hostBindsApp; oauth_mcp models the host of a client and the app of a request (hostBindsApp, startAuth). |
| packages/mcp/src/decisions.ts | production | oauth_mcp [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/mcp/src/dev-server.ts | devtool | none | none | na | Local development entry point. |
| packages/mcp/src/handler.ts | production | oauth_mcp, spec/connectorTools.md, spec/authorizationPages.md | packages/core/src/generated/connectorTools.ts, packages/core/src/generated/oauthBrowserAuthorization.ts, packages/core/src/generated/oauthGrantIssuance.ts, packages/core/src/generated/oauthTokenLifecycle.ts | covered | The router binds each request to its host and app (requestApp, servedResource, liveRequest) and each token to the resource and app of its grant (bearer, grantServesApp). oauth_mcp models the host binding (startAuth, approveReadOn, bearerOk with host and app), the consents removal on each host (consentsRevokeOn) and the signup prefill (openSignup). The cited decisions.ts is not on this branch. |
| packages/mcp/src/hooks.ts | production | oauth_mcp [wave2/oauth_mcp] | packages/mcp/src/decisions.ts [claude/lemmascript-backend] | covered | publicStatus comes from the verified core and the platform hooks are part of oauth_mcp. |
| packages/mcp/src/html-core.ts | removed | spec/authorizationPages.md | none | covered | Not on this branch. spec/authorizationPages.md owns the page views and the retry link; `esc` is in packages/mcp/src/util.ts. |
| packages/mcp/src/index.ts | production | none | none | na | Re-exports only. |
| packages/mcp/src/leaks.ts | production | oauth_mcp [wave2/oauth_mcp] | none | covered | The regex leak matcher is outside LemmaScript; oauth_mcp models it as an oracle and the gate around it is proved in update-gate.ts. |
| packages/mcp/src/pages.ts | production | oauth_mcp, spec/authorizationPages.md, spec/connectedAssistants.md | packages/core/src/generated/authorizationPages.ts, packages/core/src/generated/connectedAssistants.ts | covered | The connector pages. spec/authorizationPages.md owns the view of each reply and spec/connectedAssistants.md owns /oauth/consents. pageAppOf gives the app of the page and absolute legal links when another host renders it; oauth_mcp leaves the page views out (no state). The cited html-core.ts is not on this branch. |
| packages/mcp/src/pages/build-css.ts | devtool | none | none | na | Build step: it renders the sample pages and compiles the connector CSS from the design-system tokens. It makes no product decision. |
| packages/mcp/src/pages/samples.ts | data | none | none | na | Fictional sample pages for the CSS build and the design preview; not production data. |
| packages/mcp/src/pages/styles.ts | production | none | none | na | Reads the built connector CSS once and gives its CSP style hash. It holds no state and no decision that a spec owns. |
| packages/mcp/src/pg-store.ts | production | oauth_mcp | packages/core/src/generated/authorizationPages.ts, packages/core/src/generated/mcpSignupDraft.ts | covered | oauth_mcp models each Postgres statement as one action; SQL is outside LemmaScript. useSignupPrefill locks the grants, then the drafts, and the generated rules decide each row (oauth_mcp openSignup). |
| packages/mcp/src/request-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/mcp/src/store.ts | production | oauth_mcp, spec/authorizationPages.md, spec/mcpSignupDraft.md | packages/core/src/generated/authorizationPages.ts, packages/core/src/generated/mcpSignupDraft.ts | covered | OAuth store types and the in-memory store. useSignupPrefill calls the generated signupPrefillAllowed and useSignupPrefill; oauth_mcp openSignup models the once-only use. |
| packages/mcp/src/tools.ts | production | oauth_mcp, spec/connectorTools.md, spec/mcpSignupDraft.md | packages/core/src/generated/connectorTools.ts, packages/core/src/generated/mcpSignupDraft.ts | covered | spec/connectorTools.md owns the tool list, scopes, status rules, daily limit and update reads as the agent sees them. The connection takes the app of the MCP path as its host (connectionOf), so the draft tool works only at a friends or ntwrk path; oauth_mcp models this as the friends guard of prepareSignup after bearerOk. The cited decisions.ts and update-gate.ts are not on this branch. |
| packages/mcp/src/update-gate.ts | production | oauth_mcp [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/mcp/src/util.ts | production | oauth_mcp [wave2/oauth_mcp] | none | covered | Hashing, PKCE shape checks, form and JSON reads, `esc` and cookieValue; the cited request-core.ts and html-core.ts are not on this branch. |
| packages/network/db/network-state.sql | sql | none | none | na | Schema only; sql-schema.md maps it and the integration tests use it. |
| packages/network/harness/experiment.ts | harness | none | none | na | Simulation harness that reads hidden truth; no production decision. |
| packages/network/harness/growth.ts | harness | none | none | na | Persona factory for the harness only. |
| packages/network/harness/index.ts | harness | none | none | na | Re-exports of the harness. |
| packages/network/harness/paraphrase.ts | harness | none | none | na | Text rewrite for the simulation; no decision. |
| packages/network/harness/scenarios.ts | harness | none | none | na | Scenario data and runner for the simulation. |
| packages/network/service/bias.ts | production | runtime_ops [wave2/runtime_ops] | packages/network/service/decisions.ts biasEligible [claude/lemmascript-backend] | covered | Adult filter calls a proved core and runtime_ops models the report cadence. |
| packages/network/service/channel.ts | production | outbound_queue [claude/quint-state-machines], notify_capital [wave2/notify_capital] | packages/network/service/decisions.ts liveAllowed [claude/lemmascript-backend] | covered | Live-send gate calls a proved core and the send queue flow is modeled. |
| packages/network/service/cloud-channel.ts | production | outbound_queue [claude/quint-state-machines] | packages/network/service/decisions.ts classifyDeliver [claude/lemmascript-backend] | covered | Deliver response class calls a proved core and outbound_queue models the resend rule. |
| packages/network/service/cloud-profile-review-owner.ts | production | profile_learning [wave2/profile_learning] | none | covered | Parent-turn proof flow is modeled; the rules sit in SQL and core parsers, so no local core is useful. |
| packages/network/service/cost.ts | production | none | none | na | Float cost estimates and ledger rows; no safety invariant depends on them per network-service.md. |
| packages/network/service/decisions.ts | production | turn_consent, join_age, outbound_queue [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/network/service/inbox.ts | production | turn_consent, join_age [claude/quint-state-machines], photos_rating [wave2/photos_rating] | packages/network/service/decisions.ts turnHeldBack, priorAnswer, pickWaiting, rescueAction [claude/lemmascript-backend] | covered | Claim and hold-back decisions call proved cores and the signed-turn flow is modeled. |
| packages/network/service/learning-consent-context-endpoint.ts | production | profile_learning [wave2/profile_learning] | packages/platform/src/consent.ts resolveConsent [claude/lemmascript-backend] | covered | Consent read uses the proved resolveConsent and the learning-context proof is modeled. |
| packages/network/service/main.ts | production | boot_config [wave4/boot_config] | none | covered | The local service entry: boot_config models its assertBootConfig gate, the database URL read, the service-login check and the trustForwardedHost decision. |
| packages/network/service/packs.ts | production | safety_trust [claude/quint-state-machines], matching_engine [wave2/matching_engine], photos_rating [wave2/photos_rating] | packages/core/src/policy.ts canBeMatched [claude/lemmascript-backend] | covered | Pack wiring uses the proved age policy and engine cores; its hooks are named in three modules. |
| packages/network/service/photoIntake.ts | production | identity_sagas [claude/quint-state-machines], photos_rating [wave2/photos_rating] | packages/network/service/decisions.ts photoIntakeStep [claude/lemmascript-backend] | covered | Intake step calls a proved core and the photo consent order is modeled. |
| packages/network/service/postings.ts | production | matching_engine [wave2/matching_engine] | packages/network/src/transitions.ts payRangeOk, postingAction via src/jobs.ts [claude/lemmascript-backend] | covered | SQL shell over jobs.ts rules, which call proved cores; matching_engine models postingFromFacts. |
| packages/network/service/profile-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/network/service/profile-read.ts | production | profile_read [claude/lemmascript-frontend] | packages/network/service/profile-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: profileReadRequest decides read, ambiguous or refused and no core or module models it. |
| packages/network/service/profile-review-factory.ts | production | profile_learning [wave2/profile_learning] | none | covered | Proof factory flow is modeled; closures and network calls give no pure core to prove. |
| packages/network/service/profile-review-proof-transport.ts | production | profile_learning [wave2/profile_learning] | none | na | HTTP proof transport only; the proof chain it carries is modeled in profile_learning. |
| packages/network/service/profile-suggestion-disconnect-endpoint.ts | production | profile_learning [wave2/profile_learning] | none | covered | Auth shell with no local decision; the disconnect flow is modeled. |
| packages/network/service/profile-suggestion-endpoint.ts | production | profile_learning [wave2/profile_learning] | none | covered | Wire checks over unknown input with identity in SQL; the suggestion flow is modeled. |
| packages/network/service/profile-suggestion-review.ts | production | profile_read [claude/lemmascript-frontend] | packages/network/service/profile-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The currentBatch decision has no proved core because its regex blocks lsc. |
| packages/network/service/profile-suggestion-withdrawal-endpoint.ts | production | profile_learning [wave2/profile_learning] | none | covered | Auth shell with no local decision; the withdrawal flow is modeled. |
| packages/network/service/profile-suggestions.ts | production | profile_learning [wave2/profile_learning] | packages/network/service/decisions.ts cleanupAction, reviewPath [claude/lemmascript-backend] | covered | Cleanup and review path call proved cores and the suggestion item flow is modeled. |
| packages/network/service/relay-endpoint.ts | production | relay [claude/quint-state-machines], auth_edge [wave2/auth_edge] | packages/network/service/decisions.ts relayDelivered, relayWire [claude/lemmascript-backend] | covered | Delivered predicate calls a proved core and the action-receipt flow is modeled. |
| packages/network/service/route-authority.ts | production | turn_consent (machine route-authority) [claude/quint-state-machines] | none | covered | Backend verdict is model only; the plan json puts the route-authority machine in turn_consent. |
| packages/network/service/runtime.ts | production | outbound_queue, relay, opportunity, safety_trust, identity_sagas, join_age [claude/quint-state-machines], runtime_ops [wave2/runtime_ops], staff_console [wave2/staff_console] | packages/network/service/decisions.ts collectGate, outboundKind, pairReason, relayCanonical [claude/lemmascript-backend] | covered | Send kind and relay checks call proved cores and many modules model its flows. |
| packages/network/service/serve.ts | production | runtime_ops [wave2/runtime_ops], oauth_mcp [wave2/oauth_mcp] | none | covered | Tick loop and OAuth sweep are modeled; HTTP serving has no pure core to prove. |
| packages/network/service/service.ts | production | turn_consent, join_age, identity_sagas, outbound_queue, relay, safety_trust [claude/quint-state-machines], auth_edge, runtime_ops, profile_learning [wave2/*] | packages/network/service/decisions.ts turnDecision, sendRefusal, receiptAction and others [claude/lemmascript-backend] | covered | Turn, consent and receipt decisions call proved cores and the turn flows are modeled. |
| packages/network/service/snapshot.ts | production | safety_trust, turn_consent (participation-window) [claude/quint-state-machines] | packages/network/service/decisions.ts effectiveState, windowActive [claude/lemmascript-backend] | covered | Participation state calls proved cores and holds and windows are modeled. |
| packages/network/src/apphooks.ts | production | matching_engine [wave2/matching_engine] | none | na | Interfaces only; no decision. |
| packages/network/src/capital.ts | production | notify_capital [wave2/notify_capital] | none | covered | capitalWiring is modeled; it is wiring with no pure decision to prove. |
| packages/network/src/classify.ts | production | opportunity [claude/quint-state-machines] | packages/network/src/transitions.ts probeRoute, readingOf, routeIsYes [claude/lemmascript-backend] | covered | Probe reply tail calls proved cores and opportunity models consentOf readings. |
| packages/network/src/copy.ts | production | none | none | na | Message templates and regex style checks; no state. |
| packages/network/src/extract.ts | production | none | packages/network/src/transitions.ts llmReading [claude/lemmascript-backend] | covered | Consent merge calls a proved core; it is a pure step with no flow for Quint. |
| packages/network/src/geo.ts | data | none | none | na | Venue table and distance math; no invariant. |
| packages/network/src/index.ts | production | none | none | na | Re-exports only. |
| packages/network/src/jobs.ts | production | opportunity [claude/quint-state-machines], matching_engine [wave2/matching_engine] | packages/network/src/transitions.ts payRangeOk, postingAction [claude/lemmascript-backend] | covered | Posting checks call proved cores and posting flow is modeled. |
| packages/network/src/network.ts | production | opportunity, plan_run, plan_crew, relay, safety_trust, turn_consent, join_age, outbound_queue [claude/quint-state-machines], matching_engine, runtime_ops [wave2/*], review_desk [claude/lemmascript-frontend] | packages/network/src/transitions.ts [claude/lemmascript-backend] | covered | State machine calls proved transition cores and many modules model its stages. |
| packages/network/src/outreach.ts | production | opportunity [claude/quint-state-machines], matching_engine [wave2/matching_engine] | packages/network/src/transitions.ts inHourWindow [claude/lemmascript-backend] | covered | Window check calls a proved core and budgets and ABOUT_OTHERS are modeled. |
| packages/network/src/plans.ts | production | none | none | na | Venue mapping and ledger helpers; the engine owns plan logic, modeled in plan_run. |
| packages/network/src/relay.ts | production | relay, safety_trust [claude/quint-state-machines] | packages/network/src/transitions.ts heldAfter, keepsHeldText, swapPlan [claude/lemmascript-backend] | covered | Relay desk calls proved cores and relay.qnt models items and swaps. |
| packages/network/src/reports.ts | production | safety_trust [claude/quint-state-machines] | none | covered | Report status is modeled; the file is regex classification with no core to prove. |
| packages/network/src/store.ts | production | runtime_ops [wave2/runtime_ops], outbound_queue [claude/quint-state-machines], observatory_sync [claude/lemmascript-frontend] | none | covered | Backend verdict is model only; runtime_ops models the store unit of work and locks. |
| packages/network/src/transitions.ts | production | opportunity, relay, plan_run [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/network/src/trust.ts | production | safety_trust [claude/quint-state-machines] | packages/network/src/transitions.ts nextLevel, decayedScore, reportPoints [claude/lemmascript-backend] | covered | Trust levels call proved cores and safety_trust models the levels. |
| packages/notify/db/retention.sql | sql | notify_capital [wave2/notify_capital] | none | na | SQL triggers and forget_data; notify_capital models them and notify-retention.pg.test.ts covers them. |
| packages/notify/db/schema.sql | sql | none | none | na | Table definitions only; integration tests cover the schema. |
| packages/notify/scripts/link-test-page.ts | devtool | none | none | na | One-off page writer for link tests. |
| packages/notify/src/compose.ts | production | none | none | na | Text assembly; no name in a link is true by construction (messaging-ops.md N/A). |
| packages/notify/src/decide.ts | production | notify_capital [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/notify/src/index.ts | production | none | none | na | Re-exports only. |
| packages/notify/src/links.ts | production | none | none | na | URL building with a small runtime host guard; URL and regex are out of the fragment. |
| packages/notify/src/pg-store.ts | sql | notify_capital [wave2/notify_capital] | none | covered | notify_capital models its delivery, cap-count and outcome transactions; SQL is not meaningful for LemmaScript. |
| packages/notify/src/scheduler.ts | production | notify_capital [wave2/notify_capital] | packages/notify/src/decide.ts [claude/lemmascript-backend] | covered | plan and build call the proved capFilter and countsTowardCap, and notify_capital models the item, dispatch and weekly cap. |
| packages/notify/src/store.ts | production | notify_capital [wave2/notify_capital] | none | na | Store interface and an in-memory test double; the dedupe key rule is in the notify_capital model. |
| packages/notify/src/surface.ts | production | notify_capital [wave2/notify_capital] | packages/notify/src/decide.ts [claude/lemmascript-backend] | covered | The explicit route calls the proved explicitRoute, and notify_capital models the surface ignored streak. |
| packages/notify/src/tokens.ts | production | none | none | na | Token format, random generation and regex find; no state. |
| packages/notify/src/types.ts | data | none | none | na | Types only. |
| packages/notify/src/wiring.ts | production | none | none | na | Adapters that connect the notifier to the queue and thread hooks; no decision. |
| packages/observatory/db/dev-pg.ts | devtool | none | none | na | Local dev Postgres starter; the backend table marks it dev tooling with no production decision. |
| packages/observatory/db/migrate.ts | production | runtime_ops [wave2/runtime_ops] | packages/observatory/db/numbers.ts [claude/lemmascript-backend] | covered | The number check calls dupAt in the numbers core, and runtime_ops models the migration runner lock and ledger. |
| packages/observatory/db/migrations/0003_platform.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0004_network_apps.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0005_console_apps.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0006_platform_safety.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0007_friends_platform_safety.sql | sql | outbound_queue [claude/quint-state-machines], join_age [claude/quint-state-machines] | none | na | SQL migration; outbound_queue models its person_cap_take function and join_age models its min_join_age rows. |
| packages/observatory/db/migrations/0010_console_read_paths.sql | sql | none | none | na | SQL migration for read grants; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0011_bans_photos_packs.sql | sql | staff_console [wave2/staff_console] | none | na | SQL migration; staff_console models its pack registry row and the integration tests run it. |
| packages/observatory/db/migrations/0012_person_cap_release.sql | sql | outbound_queue [claude/quint-state-machines] | none | na | SQL migration; outbound_queue models the person cap release on every not-sent status. |
| packages/observatory/db/migrations/0014_photo_consent_bias.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0015_outbound_queue.sql | sql | none | none | na | SQL migration for the queue table; the backend read it in full and the integration tests run it. |
| packages/observatory/db/migrations/0020_cost_ledger_ops_alerts.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0021_shared_agent_turns.sql | sql | turn_consent [claude/quint-state-machines] | none | na | SQL migration; sql-schema.md maps its one-processing-turn-per-sender index to the turn model. |
| packages/observatory/db/migrations/0022_cloud_outbound_receipts.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0023_shared_agent_actions.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0024_notification_projection.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0025_eliza_notices.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0026_relay.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0030_ntwrk_party_domain.sql | sql | none | none | na | SQL data migration; the backend tables mark it N/A. |
| packages/observatory/db/migrations/0031_relay_network.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0032_outbound_leak_review.sql | sql | outbound_queue [claude/quint-state-machines] | none | na | SQL migration; outbound_queue models its leak_released_by column. |
| packages/observatory/db/migrations/0033_phone_changes.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0034_otp_provider_chat_id.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0035_pending_join_home.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0036_inbound_route_authority.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0037_photo_relay.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0038_matching_age_floor.sql | sql | join_age [claude/quint-state-machines] | none | na | SQL migration; join_age models its lowest-age matching view. |
| packages/observatory/db/migrations/0039_profile_suggestions.sql | sql | profile_learning [wave2/profile_learning] | none | na | SQL migration; profile_learning names it in its code map. |
| packages/observatory/db/migrations/0040_profile_suggestion_connection_receipts.sql | sql | profile_learning [wave2/profile_learning] | none | na | SQL migration; profile_learning names it in its code map. |
| packages/observatory/db/migrations/0041_profile_cleanup_results.sql | sql | none | none | na | SQL migration; the backend tables mark it N/A and the integration tests run it. |
| packages/observatory/db/migrations/0042_turn_consent.sql | sql | turn_consent [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0043_join_age.sql | sql | join_age [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0044_identity_sagas.sql | sql | identity_sagas [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0045_outbound_queue_network.sql | sql | outbound_queue [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0049_safety_trust.sql | sql | safety_trust [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0052_profile_learning.sql | sql | profile_learning [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0054_runtime_ops.sql | sql | runtime_ops [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/migrations/0057_notify_capital_state_machines.sql | sql | notify_capital [claude/quint-state-machines] | none | covered | Schema for the state machine that the Quint module of the same name models; the integration tests cover the SQL. |
| packages/observatory/db/numbers.ts | production | staff_console [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/observatory/db/schema.sql | sql | runtime_ops [wave2/runtime_ops] | none | na | Base SQL schema; runtime_ops cites its keys and the security tests check the audit triggers. |
| packages/observatory/db/seed.ts | devtool | staff_console [wave2/staff_console] | none | na | Local seed tool behind a local-host guard; staff_console lists the seed-writer machine. |
| packages/observatory/db/writer.ts | devtool | staff_console [wave2/staff_console] | none | na | Row writer for the dev seed, one truncate and insert transaction; staff_console lists the seed-writer machine. |
| packages/observatory/src/appProfile.ts | production | staff_console [wave2/staff_console] | packages/core/src/policy.ts [claude/lemmascript-backend] | covered | photosAllowed takes its age decision from validAge in the policy core, and staff_console models the photo gate. |
| packages/observatory/src/apps.ts | config | staff_console [wave2/staff_console] | none | covered | App registry and env parsing; staff_console models its PACK_READY gate, and a proof adds nothing to a table. |
| packages/observatory/src/console-gate.ts | production | staff_console, runtime_ops [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/observatory/src/engineCapture.ts | devtool | none | none | na | Summary of a simulated engine run with no production decision. |
| packages/observatory/src/events.ts | data | none | none | na | Row mapping and event labels; the backend tables mark it N/A. |
| packages/observatory/src/health.ts | production | staff_console [wave2/staff_console] | none | covered | Alert and scorecard arithmetic that enforces nothing; staff_console models the appHealth matching line. |
| packages/observatory/src/lab.ts | devtool | none | none | na | Lab run launcher for simulator jobs; the backend tables mark it N/A. |
| packages/observatory/src/ops.ts | production | none | none | na | Cost SQL and arithmetic for display only; the backend tables mark it N/A. |
| packages/observatory/src/people.ts | production | console_privacy [claude/lemmascript-frontend] | packages/observatory/src/privacy-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The cross-app person view hides private apps and folds their holds into restricted, and no model or core holds this privacy rule. |
| packages/observatory/src/privacy-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/observatory/src/projector.ts | production | staff_console [wave2/staff_console] | none | covered | Game-mode opportunity projection that staff_console models as opp-projection; a lemma core adds little to a dashboard projection. |
| packages/observatory/src/report.ts | devtool | none | none | na | Run report writer with no production decision. |
| packages/observatory/src/runDiff.ts | devtool | none | none | na | Diff of two run reports with no production decision. |
| packages/observatory/src/scoring.ts | devtool | none | none | na | Game scoring, not a safety path, per the backend tables. |
| packages/observatory/src/scrub.ts | production | none | none | na | Regex contact scrubbing that LemmaScript cannot model and that has no state; corpora test it. |
| packages/observatory/src/server.ts | production | staff_console [wave2/staff_console], observatory_sync [claude/lemmascript-frontend] | packages/observatory/src/console-gate.ts [claude/lemmascript-backend] | covered | The start guard calls deployVerdict, route checks go through the staff-roles core, and staff_console models reveals, tickets, sockets and audit. |
| packages/observatory/src/shape.ts | production | console_privacy [claude/lemmascript-frontend] | packages/observatory/src/privacy-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: viewClass and the counts shaping decide what member data each socket class sees, and no core or model holds them. |
| packages/observatory/src/sources/game.ts | devtool | none | none | na | Game-mode world driver that the real-only image never loads. |
| packages/observatory/src/sources/real.ts | production | staff_console [wave2/staff_console] | packages/observatory/src/console-gate.ts [claude/lemmascript-backend] | covered | Age view and login check call consoleMinor and loginVerdict, and staff_console models real-source and console-age-view. |
| packages/observatory/src/sources/service.ts | production | staff_console [wave2/staff_console] | none | covered | HTTP client to the service whose status mapping and timeout staff_console models as staff-action-relay; a lemma core is not meaningful here. |
| packages/observatory/src/sources/source.ts | data | none | none | na | Source interface and error tables only. |
| packages/observatory/src/staff-roles.ts | production | staff_console [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/observatory/src/staff.ts | production | staff_console [wave2/staff_console] | packages/observatory/src/staff-roles.ts [claude/lemmascript-backend] | covered | Role checks call the staff-roles core, and staff_console models staff identity and grant reloads. |
| packages/observatory/src/store.ts | production | staff_console [wave2/staff_console] | none | na | In-memory view store with no decision; staff_console covers its setEdges replacement. |
| packages/observatory/src/takeover.ts | devtool | none | none | na | Game-mode play-as agent; it uses the shared yes/no parser. |
| packages/observatory/src/types.ts | data | none | none | na | Types and constant lists with no logic. |
| packages/observatory/web/admin.tsx | production | review_desk, observatory_sync [claude/lemmascript-frontend], staff_console [wave2/staff_console], spec/consoleWorkspace.md | none | covered | Held texts, cases, reports, requests, the matching switch, the audit log and the lab; spec/consoleWorkspace.md owns their view states. The cited logic/review.ts is not on this branch. |
| packages/observatory/web/apps.tsx | production | console_privacy, console_views [claude/lemmascript-frontend], spec/consoleNavigation.md | none | covered | App switcher, all-apps page and person page; spec/consoleNavigation.md owns which page shows and spec/staffPermissions.md the role scope. The cited privacy-core.ts is not on this branch. |
| packages/observatory/web/drawer.tsx | production | console_views, observatory_sync [claude/lemmascript-frontend], spec/consoleNavigation.md | none | covered | spec/consoleNavigation.md owns tab visibility, the fallback to the feed and the filter keys of each tab; the cited logic/views.ts is not on this branch. |
| packages/observatory/web/graph.ts | production | none | none | na | Canvas force graph and colors for display only. |
| packages/observatory/web/logic/filters.ts | removed | spec/observatorySync.md, spec/consoleNavigation.md | none | covered | Not on this branch. spec/observatorySync.md owns the filter sync and spec/consoleNavigation.md owns the filter dimming. |
| packages/observatory/web/logic/review.ts | removed | spec/staffReview.md | none | covered | Not on this branch. review.tsx imports the generated staffReview decisions. |
| packages/observatory/web/logic/sync.ts | removed | spec/observatorySync.md | none | covered | Not on this branch. store.ts imports the generated observatorySync decisions. |
| packages/observatory/web/logic/views.ts | removed | spec/consoleNavigation.md, spec/consoleWorkspace.md | none | covered | Not on this branch. spec/consoleNavigation.md owns tabs, search and picks; spec/consoleWorkspace.md owns panel views and the propose gate. |
| packages/observatory/web/main.tsx | production | console_views [claude/lemmascript-frontend], spec/consoleNavigation.md, spec/staffSignIn.md | none | covered | The top bar, search, stage and sign-in panels; spec/consoleNavigation.md and spec/staffSignIn.md own them. The cited logic/views.ts is not on this branch. |
| packages/observatory/web/map.ts | production | observatory_sync [claude/lemmascript-frontend] | none | covered | Map renderer; marker data comes from the store, which imports the generated observatorySync decisions (spec/observatorySync.md). The cited logic/sync.ts is not on this branch. |
| packages/observatory/web/network.tsx | production | none | none | na | Game-mode scenario buttons; the server gates reset. |
| packages/observatory/web/ops.tsx | production | none | none | na | Cost panel display with a budget tone only. |
| packages/observatory/web/panels.tsx | production | console_views, staff_console [wave2/staff_console], spec/consoleMemberView.md, spec/consoleWorkspace.md | none | covered | The inspector imports the generated consoleMemberView decisions for photo reads; spec/consoleWorkspace.md owns the panel views. The cited logic/views.ts is not on this branch. |
| packages/observatory/web/review.tsx | production | review_desk [claude/lemmascript-frontend], spec/staffReview.md | none | covered | The review controller imports the generated staffReview decisions. The cited logic/review.ts is not on this branch. |
| packages/observatory/web/safe.ts | production | none | none | na | DOM text node and tooltip text helpers with no decision. |
| packages/observatory/web/store.ts | production | observatory_sync, staff_console [wave2/staff_console], spec/observatorySync.md, spec/staffPermissions.md | none | covered | Imports the generated observatorySync and staffPermissions decisions. The cited logic/sync.ts is not on this branch. |
| packages/observatory/web/ui.tsx | production | console_views [claude/lemmascript-frontend] | none | covered | Shared display helpers with no state. The cited logic/views.ts is not on this branch. |
| packages/platform/src/accounts.ts | production | identity_sagas, join_age, turn_consent [claude/quint-state-machines], auth_edge [wave2/auth_edge], profile_learning [wave2/profile_learning], photos_rating [wave2/photos_rating] | packages/platform/src/decisions.ts, packages/platform/src/consent.ts, packages/core/src/policy.ts [claude/lemmascript-backend] | covered | joinPlan, resolveConsent and validAge are verified cores, and join, leave and delete are in several Quint models. |
| packages/platform/src/age.ts | production | join_age [claude/quint-state-machines] | packages/core/src/policy.ts, packages/platform/src/decisions.ts [claude/lemmascript-backend] | covered | Age rules call the verified policy core and lowestOf, and join_age models the age flow. |
| packages/platform/src/api.ts | production | auth_edge [wave2/auth_edge], join_flow [claude/lemmascript-frontend], cloud_auth [wave4/cloud_auth] | packages/platform/src/routing-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: Routes and gates are in auth_edge, but oauthReturnPath, cloudReturnPath and parseCookies have no verified core. |
| packages/platform/src/apps.ts | production | join_age [claude/quint-state-machines] | packages/platform/src/routing-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: keywordApp and lookingFor are only oracles in join_age, and appForHost and keyword routing have no verified core. |
| packages/platform/src/body.ts | production | none | none | na | Capped stream reader; the backend doc rates it N/A and the 413 step is part of the edge-trust flow. |
| packages/platform/src/cloud-delegation.ts | production | auth_edge [wave2/auth_edge], cloud_auth [wave4/cloud_auth] | none | covered | The Cloud handoff is in auth_edge; the file is a signed network call with no pure decision. |
| packages/platform/src/consent.ts | production | turn_consent [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | resolveConsent is verified in place and the consent ledger is in turn_consent. |
| packages/platform/src/decisions.ts | production | join_age, auth_edge, identity_sagas [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/platform/src/env-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/platform/src/env.ts | production | boot_config [claude/lemmascript-frontend] | packages/platform/src/env-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: devShortcutsAllowed and the fail-closed boot config check have no LemmaScript core and no Quint model names them. Wave 4: main.ts and the production entry (server.ts, through loadConfig) both call bootConfigProblems (W3-448; Q-boot_config-W4-1 fixed). |
| packages/platform/src/index.ts | production | none | none | na | Re-exports only. |
| packages/platform/src/otp-config.ts | config | none | none | na | Env presence checks for the OTP provider; the backend doc rates it N/A. |
| packages/platform/src/otp-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/platform/src/otp.ts | production | auth_edge [wave2/auth_edge], phone_identity [claude/lemmascript-frontend] | packages/platform/src/otp-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The OTP challenge machine is in auth_edge, but the start and verify decisions are mixed with store calls and not extracted. |
| packages/platform/src/pg-store.ts | production | identity_sagas, join_age, turn_consent [claude/quint-state-machines], auth_edge [wave2/auth_edge], profile_learning [wave2/profile_learning], oauth_mcp [wave2/oauth_mcp] | packages/platform/src/decisions.ts [claude/lemmascript-backend] | covered | The rate check calls hitPasses and the store transactions are actions in several Quint models. |
| packages/platform/src/phone.ts | production | none | packages/core/src/phone-core.ts [claude/lemmascript-frontend] | covered | E.164 normalisation calls the verified phone-core; the rest is crypto with no state to model. |
| packages/platform/src/photo-relay-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/platform/src/photo-relay.ts | production | relay [claude/quint-state-machines], photo_relay_item [claude/lemmascript-frontend] | packages/platform/src/photo-relay-core.ts [claude/lemmascript-frontend] | covered | Gap closed on 2026-11-08: The photo relay states are in relay.qnt, but no verified nextState core exists for the item transitions. |
| packages/platform/src/photos.ts | production | photos_rating [wave2/photos_rating] | packages/platform/src/decisions.ts, packages/platform/src/riff.ts, packages/core/src/policy.ts [claude/lemmascript-backend] | covered | adultGate and the RIFF walk are verified cores, and the photo and rating flow is in photos_rating. |
| packages/platform/src/proxy.ts | production | auth_edge [wave2/auth_edge] | packages/platform/src/decisions.ts [claude/lemmascript-backend] | covered | withinSkew is a verified core and the proxy signature is in auth_edge. |
| packages/platform/src/public-types.ts | production | none | none | na | Types only. |
| packages/platform/src/riff.ts | production | photos_rating [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/platform/src/routing-core.ts | production | see its shell | self [claude/lemmascript-frontend] | covered | New import-free core with //@ contracts; the shell calls it. |
| packages/platform/src/segments.ts | production | photos_rating [claude/quint-state-machines] | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/platform/src/sessions.ts | production | auth_edge [wave2/auth_edge] | packages/platform/src/decisions.ts [claude/lemmascript-backend] | covered | sessionExpiry and sessionLive are verified cores and the web session machine is in auth_edge. |
| packages/platform/src/store.ts | production | none | packages/platform/src/decisions.ts, packages/platform/src/consent.ts [claude/lemmascript-backend] | covered | Store types and a memory test store that call hitPasses, challengeClaimable and lastEvents; its state is modelled through pg-store.ts. |
| packages/platform/src/turnstile.ts | production | none | none | na | Siteverify network call; auth_edge treats Turnstile as an oracle. |
| packages/sim/src/agent/availability.ts | harness | none | none | na | Simulator harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/agent/llmAgent.ts | harness | none | none | na | LLM voice for simulated personas; every decision comes from policy.ts and it never runs in production. |
| packages/sim/src/agent/policy.ts | harness | none | none | na | Persona choice model from hidden truth; it uses core parseReply and never runs in production. |
| packages/sim/src/agent/types.ts | harness | none | none | na | Types and a memory constructor for the simulated personas; no decision. |
| packages/sim/src/apps/friends/arms.ts | harness | none | none | na | Friends simulator harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/friends/baselines.ts | harness | none | none | na | Friends simulator harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/friends/cli.ts | harness | none | none | na | Friends simulator harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/friends/gates.ts | harness | none | none | na | Friends simulator gate bodies that never run in production; backend coverage-gaps.md marks them not applicable. |
| packages/sim/src/apps/friends/metrics.ts | harness | none | none | na | Friends simulator metrics that never run in production; backend coverage-gaps.md marks them not applicable. |
| packages/sim/src/apps/friends/oracle.ts | harness | none | none | na | Hidden-truth outcome model for the friends world; it never runs in production. |
| packages/sim/src/apps/friends/packMatcher.ts | harness | none | none | na | Friends simulator harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/friends/persona.ts | harness | none | none | na | Friends simulator personas; they never run in production. |
| packages/sim/src/apps/friends/snapshot.ts | harness | none | none | na | Friends simulator snapshot that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/friends/visible.ts | harness | none | none | na | Friends simulator model of what staff can see; it never runs in production. |
| packages/sim/src/apps/friends/world.ts | harness | none | none | na | Friends simulator world that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/gates.ts | harness | none | none | na | Gate types shared by the per-app worlds; no decision. |
| packages/sim/src/apps/peon/arms.ts | harness | none | none | na | Peon hiring harness code that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/peon/audit.ts | harness | none | none | na | Simulator model of the company audit monitor, not production code. |
| packages/sim/src/apps/peon/baselines.ts | harness | none | none | na | Peon hiring harness baselines that never run in production. |
| packages/sim/src/apps/peon/cli.ts | harness | none | none | na | Peon simulator CLI that never runs in production. |
| packages/sim/src/apps/peon/gates.ts | harness | none | none | na | Peon simulator gate bodies that never run in production; backend coverage-gaps.md marks them not applicable. |
| packages/sim/src/apps/peon/metrics.ts | harness | none | none | na | Peon simulator metrics that never run in production; backend coverage-gaps.md marks them not applicable. |
| packages/sim/src/apps/peon/oracle.ts | harness | none | none | na | Hidden-truth outcome model for the peon world; it never runs in production. |
| packages/sim/src/apps/peon/persona.ts | harness | none | none | na | Peon simulator personas; they never run in production. |
| packages/sim/src/apps/peon/skills.ts | data | none | none | na | Static simulator skill tables; no decision or state. |
| packages/sim/src/apps/peon/snapshot.ts | harness | none | none | na | Peon simulator snapshot that never runs in production. |
| packages/sim/src/apps/peon/world.ts | harness | none | none | na | Peon simulator world that never runs in production; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/apps/slop/adversarial.ts | harness | none | none | na | Relay and photo adversarial scenarios for the sim; they never run in production. |
| packages/sim/src/apps/slop/baselines.ts | harness | none | none | na | Slop simulator baselines that never run in production. |
| packages/sim/src/apps/slop/behavior.ts | harness | none | none | na | Simulated persona behaviour for the slop world; it never runs in production. |
| packages/sim/src/apps/slop/bodyType.ts | harness | none | none | na | Simulated body-type model for the slop world; it never runs in production. |
| packages/sim/src/apps/slop/clefSynth.ts | harness | none | none | na | Synthetic Clef data generator for the sim; it never runs in production. |
| packages/sim/src/apps/slop/cli.ts | harness | none | none | na | Slop baseline CLI that never runs in production. |
| packages/sim/src/apps/slop/enginePack.ts | harness | none | none | na | Maps the sim snapshot to engine input and back; it reads no hidden truth and never runs in production. |
| packages/sim/src/apps/slop/geo.ts | harness | none | none | na | Simulated geography for the slop world; it never runs in production. |
| packages/sim/src/apps/slop/metrics.ts | harness | none | none | na | Slop simulator flow metrics that never run in production. |
| packages/sim/src/apps/slop/oracle.ts | harness | none | none | na | Hidden-truth outcome model for the slop world; it never runs in production. |
| packages/sim/src/apps/slop/packEval.ts | harness | none | none | na | Slop pack evaluation arms and gates; it never runs in production. |
| packages/sim/src/apps/slop/persona.ts | harness | none | none | na | Slop simulator personas; they never run in production. |
| packages/sim/src/apps/slop/relay.ts | harness | none | none | na | Sim relay exchange and scoring; production relay decisions are in engine relayCore, and bug 10 here is fixed with a gate. |
| packages/sim/src/apps/slop/snapshot.ts | harness | none | none | na | Slop simulator snapshot and reviewer models; they never run in production. |
| packages/sim/src/apps/slop/visible.ts | harness | none | none | na | Slop simulator model of visible profile data; it never runs in production. |
| packages/sim/src/apps/slop/world.ts | harness | none | none | na | Probe-first slop simulator world that never runs in production. |
| packages/sim/src/channel.ts | harness | none | none | na | Simulated message channel; it never runs in production. |
| packages/sim/src/cli.ts | harness | none | none | na | Simulator operator CLI that never runs in production. |
| packages/sim/src/engineAdapter.ts | harness | none | none | na | Adapter from the sim world to the engine; it never runs in production. |
| packages/sim/src/generator.ts | harness | none | none | na | Seeded persona generator for the sim; it never runs in production. |
| packages/sim/src/index.ts | harness | none | none | na | Re-exports of the simulator package; no decision. |
| packages/sim/src/judge/llmJudges.ts | harness | none | none | na | LLM judge calls with fail-closed parsers; they run only in the sim. |
| packages/sim/src/judge/metrics.ts | harness | none | packages/sim/src/judge/predicates.ts [claude/lemmascript-backend] | covered | The judge takes its window, budget and minor-flag decisions from the proved predicates core on the backend branch; a Quint model of the judge is not meaningful. |
| packages/sim/src/judge/predicates.ts | harness | none (simulator judge) | self [claude/lemmascript-backend] | covered | Proved import-free core; its callers are the shells, and the named Quint modules model their flows. |
| packages/sim/src/judge/rules.ts | harness | none | none | na | Regex rules for the sim judge; backend coverage-gaps.md marks it not applicable. |
| packages/sim/src/llmGenerator.ts | harness | none | none | na | LLM bio texture for simulated personas; it never runs in production. |
| packages/sim/src/network.ts | harness | none | none | na | Simulator network interface; it never runs in production. |
| packages/sim/src/oracle.ts | harness | none | none | na | Hidden-truth outcome model; it never runs in production. |
| packages/sim/src/persona.ts | harness | none | none | na | Persona types and intent timing for the sim; they never run in production. |
| packages/sim/src/plans.ts | harness | none | none | na | Plan oracle and sim reference parsers; they never run in production. |
| packages/sim/src/scenario.ts | harness | none | none | na | Scenario grading for the sim; bug 11 here is fixed and it never runs in production. |
| packages/sim/src/scheduler.ts | harness | none | none | na | Discrete event queue of the sim; it never runs in production. |
| packages/sim/src/snapshot.ts | harness | none | none | na | Public-side snapshot of the sim world; it never runs in production. |
| packages/sim/src/sources.ts | harness | none | none | na | Simulated connected sources; they never run in production. |
| packages/sim/src/stubNetwork.ts | harness | none | none | na | Push baseline network by design with no review; it never runs in production. |
| packages/sim/src/taxonomy.ts | data | none | none | na | Static simulator taxonomy tables; no decision or state. |
| packages/sim/src/time.ts | harness | none | packages/core/src/time.ts [claude/lemmascript-backend] | covered | It keys core's proved local-time parts by city and has no state, so a Quint model is not meaningful. |
| packages/sim/src/world.ts | harness | none | none | na | Simulator event loop and outcome recording; it never runs in production. |
| packages/ui/.storybook/main.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| packages/ui/.storybook/preview.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| packages/ui/src/api/client.ts | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/api/homeHelp.ts | production | spec/homeHelpPage.md | packages/core/src/generated/homeHelpPage.ts | covered | Calls the generated link and address decisions; the regexes, the counts, the request body and the status-to-answer map are the shell (tests/e2e/home-help-page.e2e.test.ts). |
| packages/ui/src/api/join.ts | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/api/phone.ts | production | spec/phonePage.md | packages/core/src/generated/phonePage.ts | covered | A total map from status and error code to one generated answer variant; tests/e2e/phone-page.e2e.test.ts covers it. |
| packages/ui/src/api/photoUpload.ts | production | spec/photoUploadPage.md | packages/core/src/generated/photoUploadPage.ts | covered | The token regex, the file facts and the status-to-answer map are a shell; the generated machine decides (tests/e2e/photo-upload-page.e2e.test.ts). |
| packages/ui/src/api/stepPages.ts | production | spec/oneStepPage.md | packages/core/src/generated/oneStepPage.ts | covered | Maps each API answer to one generated sign-in answer or session value and decides nothing that the spec owns. |
| packages/ui/src/api/turnstile.ts | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/brand/agentLogos.ts | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/brand/landing.ts | production | spec/landingEntry.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/landingEntry.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, landingEntry, sitePages and does not recompute them. |
| packages/ui/src/components/AgentLogo.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AgentLogo.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/AgentRow.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AgentRow.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/AgentTile.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AgentTile.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/Alert.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Alert.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/AuthCodeView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AuthCodeView.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts | covered | Calls the generated decisions of authorizationPages and does not recompute them. |
| packages/ui/src/components/AuthMessageView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AuthMessageView.tsx | production | spec/authorizationPages.md, spec/connectedAssistants.md | packages/core/src/generated/authorizationPages.ts, packages/core/src/generated/connectedAssistants.ts | covered | Calls the generated decisions of authorizationPages, connectedAssistants and does not recompute them. |
| packages/ui/src/components/AuthPhoneView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AuthPhoneView.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts | covered | Calls the generated decisions of authorizationPages and does not recompute them. |
| packages/ui/src/components/AuthShell.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AuthShell.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts, packages/core/src/generated/brandIdentity.ts | covered | Calls the generated decisions of authorizationPages, brandIdentity and does not recompute them. |
| packages/ui/src/components/AuthSignupView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/AuthSignupView.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts | covered | Shows the signup form and the prefill that the server gives; consent never starts ticked (signupConsentStartsTicked). The once-only prefill is in oauth_mcp openSignup. |
| packages/ui/src/components/BlockedStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/BlockedStep.tsx | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/components/BrandMark.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/BrandMark.tsx | production | spec/brandIdentity.md | packages/core/src/generated/brandIdentity.ts | covered | Calls the generated decisions of brandIdentity and does not recompute them. |
| packages/ui/src/components/Button.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Button.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Card.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Card.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Checkbox.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Checkbox.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/CodeInput.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/CodeInput.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/CodeStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/CodeStep.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/ConnectedAssistantsView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/ConnectedAssistantsView.tsx | production | spec/connectedAssistants.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/connectedAssistants.ts | covered | Calls the generated decisions of brandIdentity, connectedAssistants and does not recompute them. |
| packages/ui/src/components/ConsentView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/ConsentView.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts | covered | Calls the generated decisions of authorizationPages and does not recompute them. |
| packages/ui/src/components/Dialog.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Dialog.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Disclosure.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Disclosure.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/DoneStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/DoneStep.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/EmptyState.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/EmptyState.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Field.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Field.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/FieldError.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/FieldError.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/FlowNotice.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/FlowNotice.tsx | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/components/Headline.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Headline.tsx | production | spec/brandIdentity.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/HomeHelpPageView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/HomeHelpPageView.tsx | production | spec/homeHelpPage.md | packages/core/src/generated/homeHelpPage.ts, packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of homeHelpPage and oneStepPage and does not recompute them. |
| packages/ui/src/components/Icon.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Icon.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Input.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Input.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/JoinView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/JoinView.tsx | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/components/Label.stories.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Label.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/LandingView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/LandingView.tsx | production | spec/landingEntry.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of brandIdentity, landingEntry and does not recompute them. |
| packages/ui/src/components/LegalDocument.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/LegalDocument.tsx | production | spec/brandIdentity.md, spec/sitePages.md | packages/core/src/generated/brandIdentity.ts | covered | Calls the generated decisions of brandIdentity and does not recompute them. |
| packages/ui/src/components/Link.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Link.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/MemberStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/MemberStep.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/MessagesButton.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/MessagesButton.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/NotFoundView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/NotFoundView.tsx | production | spec/sitePages.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/OneStepPage.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/OneStepPage.tsx | production | spec/oneStepPage.md | packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of oneStepPage and does not recompute them. |
| packages/ui/src/components/PageShell.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PageShell.tsx | production | spec/sitePages.md | packages/core/src/generated/brandIdentity.ts | covered | Calls the generated decisions of brandIdentity and does not recompute them. |
| packages/ui/src/components/PhoneInput.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PhoneInput.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/PhonePageView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PhonePageView.tsx | production | spec/phonePage.md | packages/core/src/generated/phonePage.ts, packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of phonePage and oneStepPage and does not recompute them. |
| packages/ui/src/components/PhoneStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PhoneStep.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/PhotoUploadPageView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PhotoUploadPageView.tsx | production | spec/photoUploadPage.md | packages/core/src/generated/photoUploadPage.ts | covered | Display only: it shows the machine state and the copy. |
| packages/ui/src/components/Popover.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Popover.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/PopoverClose.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/ProfileStep.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/ProfileStep.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/Progress.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Progress.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/PromptCopy.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/PromptCopy.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/Prose.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Prose.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/RadioGroup.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/RadioGroup.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/ScopeList.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/ScopeList.tsx | production | spec/authorizationPages.md | packages/core/src/generated/authorizationPages.ts | covered | Calls the generated decisions of authorizationPages and does not recompute them. |
| packages/ui/src/components/SecurityCheck.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/SecurityCheck.tsx | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/components/Select.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Select.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/SiteFooter.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/SiteFooter.tsx | production | spec/sitePages.md | packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of sitePages and does not recompute them. |
| packages/ui/src/components/SkipLink.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/SkipLink.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/SmsTerms.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/SmsTerms.tsx | production | spec/sitePages.md | packages/core/src/generated/brandIdentity.ts, packages/core/src/generated/sitePages.ts | covered | Calls the generated decisions of brandIdentity, sitePages and does not recompute them. |
| packages/ui/src/components/Spinner.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Spinner.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/StatusLine.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/StatusLine.tsx | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/components/StepFrame.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/StepFrame.tsx | production | spec/browserJoin.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/StepSignInView.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/StepSignInView.tsx | production | spec/oneStepPage.md | packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of oneStepPage and does not recompute them. |
| packages/ui/src/components/Table.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Table.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Tabs.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Tabs.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Textarea.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Textarea.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Toast.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Toast.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Tooltip.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Tooltip.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/VisuallyHidden.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/VisuallyHidden.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/Wordmark.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/Wordmark.tsx | production | spec/brandIdentity.md | packages/core/src/generated/brandIdentity.ts | covered | Calls the generated decisions of brandIdentity and does not recompute them. |
| packages/ui/src/components/console/AppSwitcher.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/AppSwitcher.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/AuditQuery.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/AuditRow.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/AuditRow.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/CaseCard.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/CaseCard.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/ConfigField.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ConfigField.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/ConsoleShell.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ConsoleShell.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/Countdown.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/Countdown.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/DataTable.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/DataTable.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/DisclosureCard.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/DisclosureCard.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/DrawerTabs.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/DrawerTabs.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/FactLine.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/FactLine.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/FilterBar.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/FilterBar.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/HeldItemCard.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/HeldItemCard.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/InspectorSection.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/InspectorSection.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/Kpi.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/Kpi.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/KpiGrid.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/KpiGrid.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/Legend.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/Legend.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/LorenzCurve.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/LorenzCurve.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/MeterBars.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/MeterBars.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/ModeIndicator.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ModeIndicator.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/ProposeTray.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ProposeTray.tsx | production | spec/consoleNavigation.md, spec/consoleWorkspace.md | packages/core/src/generated/consoleNavigation.ts, packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleNavigation, consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/ReportCard.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ReportCard.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/RequestRow.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/RequestRow.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/RevealControl.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/RevealControl.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/ReviewCard.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/ReviewCard.tsx | production | spec/staffReview.md | packages/core/src/generated/staffReview.ts | covered | Calls the generated decisions of staffReview and does not recompute them. |
| packages/ui/src/components/console/SearchBox.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/SearchBox.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/Segments.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/Segments.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/SignInNotice.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/SignInNotice.tsx | production | spec/staffSignIn.md | packages/core/src/generated/staffSignIn.ts | covered | Calls the generated decisions of staffSignIn and does not recompute them. |
| packages/ui/src/components/console/StatusMark.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/StatusMark.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/StatusRow.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/StatusRow.tsx | production | spec/consoleWorkspace.md | packages/core/src/generated/consoleWorkspace.ts | covered | Calls the generated decisions of consoleWorkspace and does not recompute them. |
| packages/ui/src/components/console/SubjectLink.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/SubjectLink.tsx | production | spec/consoleNavigation.md | packages/core/src/generated/consoleNavigation.ts | covered | Calls the generated decisions of consoleNavigation and does not recompute them. |
| packages/ui/src/components/console/TokenPrompt.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/TokenPrompt.tsx | production | spec/staffSignIn.md | none | covered | Display only: it shows what its props give and decides nothing that the spec owns. |
| packages/ui/src/components/console/TopBar.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/components/console/TopBar.tsx | production | none | none | na | Display only: a token-styled primitive with no state that a spec owns. |
| packages/ui/src/components/console/VenueLink.meta.tsx | harness | none | none | na | Story data for the generated storybook: args and play functions only; it ships in no page. |
| packages/ui/src/content/landing.ts | data | spec/brandIdentity.md | packages/core/src/generated/brandIdentity.ts | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/friendsPrivacy.tsx | data | spec/brandIdentity.md | none | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/friendsTerms.tsx | data | spec/sitePages.md | none | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/content/legal/index.ts | data | spec/sitePages.md | packages/core/src/generated/brandIdentity.ts | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/content/legal/ntwrkPrivacy.tsx | data | spec/brandIdentity.md | none | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/ntwrkTerms.tsx | data | spec/sitePages.md | none | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/content/legal/parts.tsx | data | spec/brandIdentity.md | packages/core/src/generated/brandIdentity.ts | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/peonPrivacy.tsx | data | spec/brandIdentity.md | none | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/peonTerms.tsx | data | spec/sitePages.md | none | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/content/legal/slopPrivacy.tsx | data | spec/brandIdentity.md | none | covered | Copy and legal text only; spec/brandIdentity.md owns what each site may name. |
| packages/ui/src/content/legal/slopTerms.tsx | data | spec/sitePages.md | none | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/content/legal/types.ts | data | spec/sitePages.md | packages/core/src/generated/sitePages.ts | covered | Copy and legal text only; spec/sitePages.md owns what each site may name. |
| packages/ui/src/hooks/stepSignIn.ts | production | spec/oneStepPage.md | packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of oneStepPage and does not recompute them. |
| packages/ui/src/hooks/useHomeHelpPage.ts | production | spec/homeHelpPage.md | packages/core/src/generated/homeHelpPage.ts, packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of homeHelpPage and oneStepPage and does not recompute them. |
| packages/ui/src/hooks/useJoin.ts | production | spec/browserJoin.md | packages/core/src/generated/browserJoin.ts | covered | Calls the generated decisions of browserJoin and does not recompute them. |
| packages/ui/src/hooks/useLanding.ts | production | spec/landingEntry.md | packages/core/src/generated/landingEntry.ts | covered | Calls the generated decisions of landingEntry and does not recompute them. |
| packages/ui/src/hooks/usePhonePage.ts | production | spec/phonePage.md | packages/core/src/generated/phonePage.ts, packages/core/src/generated/oneStepPage.ts | covered | Calls the generated decisions of phonePage and oneStepPage and does not recompute them. |
| packages/ui/src/hooks/usePhotoUploadPage.ts | production | spec/photoUploadPage.md | packages/core/src/generated/photoUploadPage.ts | covered | Calls the generated decisions of photoUploadPage and does not recompute them. |
| packages/ui/src/index.ts | production | none | none | na | Re-exports only. |
| packages/ui/src/lib/cn.ts | production | none | none | na | Class name and type helpers; no decision. |
| packages/ui/src/lib/meta.ts | production | none | none | na | Class name and type helpers; no decision. |
| packages/ui/src/lib/stepLink.ts | production | spec/oneStepPage.md | packages/core/src/generated/oneStepPage.ts | covered | The fragment rules are in oneStepPage; the history and session storage access is a thin shell. |
| packages/ui/vite.config.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| packages/ui/vitest.config.ts | devtool | none | none | na | Build, test or storybook configuration; no product state or decision. |
| plugins/build.ts | devtool | spec/agentEntry.md, spec/brandIdentity.md | packages/core/src/generated/agentEntry.ts, packages/core/src/generated/brandIdentity.ts | na | Plugin snapshot build with a --check mode. The MCP URL of each skill comes from the generated pluginEndpoint, endpointPath and endpointHost (every app at its own path on ntwrk.party), and the OpenAI manifest server from openAiManifestApp. It holds no state for a Quint flow. |
| scripts/check-contract-mirror.ts | devtool | none | none | na | Dev tool that compares the mirror files with upstream; the contract-mirror test checks the pinned hashes. |
| scripts/clef-fit.ts | devtool | none | none | na | Operator CLI for Clef weight fitting; it does not run in production. |
| scripts/inspect-network-backend.py | devtool | none | none | na | Read-only Python inspection tool that sends GET requests only. |
| scripts/platform-dev.ts | devtool | none | none | na | Local dev launcher that refuses production and keeps sends dry-run; it does not run in production. |
| scripts/quint-check.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/quint-drift.ts | devtool | none | none | na | Drift check runner: it hashes the models and their mapped files and has no production decision. |
| scripts/relay-clef-lib.ts | devtool | none | none | na | Corpus loader and base relay context for the relay eval; production relay decisions are in engine relayCore. |
| scripts/relay-eval.ts | devtool | none | none | na | Operator CLI that reports relay classifier results; it does not run in production. |
| scripts/require-pg.ts | devtool | none | none | na | Dev tool that checks that the local Postgres is there before tests. |
| scripts/sim.ts | harness | none | none | na | Runner for the sim gate blocks; it does not run in production. |
| scripts/sim/audit.ts | harness | none | none | na | Sim gate block that checks production code; it does not run in production. |
| scripts/sim/capital.ts | harness | none | none | na | Sim gate block for network capital; it does not run in production. |
| scripts/sim/clef.ts | harness | none | none | na | Sim gate block for the Clef rater; it does not run in production. |
| scripts/sim/conformance.ts | harness | none | none | na | Sim conformance gates for the engine; they do not run in production. |
| scripts/sim/evals.ts | harness | none | none | na | Sim eval gates over corpora; they do not run in production. |
| scripts/sim/formal.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/sim/friends.ts | harness | none | none | na | Sim gate block for the friends world; it does not run in production. |
| scripts/sim/gate.ts | harness | none | none | na | Assertion helper for the sim gates; no production decision. |
| scripts/sim/judge.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/sim/network.ts | harness | none | none | na | Sim gate block for the ConsentNetwork; it does not run in production. |
| scripts/sim/onboard.ts | harness | none | none | na | Sim gate block for onboarding; it does not run in production. |
| scripts/sim/ops.ts | harness | none | none | na | Sim gates for alerts, cost and the deploy guard; they do not run in production. |
| scripts/sim/peon-seats.ts | harness | none | none | na | Sim gate block for peon seats; it does not run in production. |
| scripts/sim/peon.ts | harness | none | none | na | Sim gate block for the peon world; it does not run in production. |
| scripts/sim/persona.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/sim/pipeline.ts | harness | none | none | na | Sim pipeline gate block; it does not run in production. |
| scripts/sim/pipeline/harness.ts | harness | none | none | na | Harness for the sim pipeline block; it does not run in production. |
| scripts/sim/relay.ts | harness | none | none | na | Sim gate block for the relay; it does not run in production. |
| scripts/sim/safety.ts | harness | none | none | na | Sim safety gate block; it does not run in production. |
| scripts/sim/slop-live.ts | harness | none | none | na | Sim gate block for the live slop flow; it does not run in production. |
| scripts/sim/slop.ts | harness | none | none | na | Sim gate block for the slop world; it does not run in production. |
| scripts/sim/stub.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/sim/worlds.ts | devtool | none | none | na | Check runner or sim block; it runs the models and gates and has no production decision. |
| scripts/sites-dev.ts | devtool | none | none | na | Local dev server for the sites; backend paths use the production router, which has its own proved core. |
| scripts/synthetic/common.ts | devtool | none | none | na | Synthetic dataset tool for the dev database; it does not run in production. |
| scripts/synthetic/generate.ts | devtool | none | none | na | Synthetic dataset generator for the dev database; it does not run in production. |
| scripts/synthetic/load.ts | devtool | none | none | na | Synthetic dataset loader for local hosts; it does not run in production. |
| scripts/synthetic/names.ts | data | none | none | na | Name tables for the synthetic dataset; no decision or state. |
| scripts/synthetic/validate.ts | devtool | none | none | na | Synthetic dataset validator; it does not run in production. |
| scripts/wrangler.sh | devtool | runtime_ops [wave2/runtime_ops] | none | covered | Machine M-149 wrangler-deploy-guard models decide(); the file is Bash, so a LemmaScript core is not meaningful. |
| sites/agents.ts | removed | spec/landingEntry.md | none | na | Not on this branch. spec/landingEntry.md owns the agent table; packages/ui/src/brand/agentLogos.ts holds the logos. |
| sites/shared/agent.ts | removed | spec/landingEntry.md | none | na | Not on this branch. packages/ui/src/hooks/useLanding.ts runs the landing page and calls the generated landingEntry decisions. |
| sites/shared/api.ts | removed | spec/browserJoin.md | none | covered | Not on this branch. packages/ui/src/api/client.ts and join.ts replace it; spec/browserJoin.md owns the 10-digit US number rule and the answers. |
| sites/shared/auth.ts | removed | spec/browserJoin.md | none | covered | Not on this branch. packages/ui/src/hooks/useJoin.ts runs sign-in mode, security check, code request and code check through the generated browserJoin machine. |
| sites/shared/demo.ts | removed | none | none | na | Not on this branch. Dead demo replay code that no page loaded. |
| sites/shared/join-core.ts | removed | spec/browserJoin.md | none | covered | Not on this branch. spec/browserJoin.md owns the join page steps and the form rules. |
| sites/shared/join.ts | removed | spec/browserJoin.md | none | covered | Not on this branch. packages/ui/src/hooks/useJoin.ts and JoinView.tsx replace the peon.biz join page. |
| sites/shared/prefill.ts | removed | spec/browserJoin.md | none | covered | Not on this branch. useJoin.ts reads the fragment; spec/browserJoin.md owns the fragment rule. |
| sites/shared/turnstile.ts | removed | spec/browserJoin.md | none | na | Not on this branch. packages/ui/src/api/turnstile.ts loads the widget. |
| sites/shared/ui.ts | removed | none | none | na | Not on this branch. DOM helpers that the React components replace. |
| sites/sites.ts | devtool | spec/agentSignup.md, spec/sitePages.md, spec/brandIdentity.md | packages/core/src/generated/agentSignup.ts, packages/core/src/generated/sitePages.ts, packages/core/src/generated/brandIdentity.ts | na | Site build script with file I/O and constant headers. Its skill check walks each SKILL.md through the generated agentSignup machine, the connector setup step included. It holds no state for a Quint flow. |
| sites/skill-responses.ts | removed | none | none | na | Not on this branch. sites/sites.ts serves the SKILL.md files without it. |
| sites/skills.config.ts | config | none | none | na | Skill build configuration with a URL check. |
| tools/clef-label/build.ts | devtool | none | none | na | Inlines core.ts into the local rater page. |
| tools/clef-label/core.ts | devtool | none | self [claude/lemmascript-frontend] | covered | The rater plan, resume and undo rules are verified in place; the local tool has no shared state to model. |
