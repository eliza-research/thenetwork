# Audit fixes: core, engine, judge, evals, sim, capital, plugins (2026-10-08)

This file records what this session did with each finding of the 2026-10-08 adversarial audit in the packages it owns. The findings and evidence are in `docs/audit/2026-10-08-weaknesses.md` (other worktree). Each row is keyed by finding id.

- **Branch:** `fix/audit` (from `origin/main` 70c988b). Not pushed, not merged.
- **Scope:** packages/core, packages/engine (not packs/slop, packs/peon, packs/friends), packages/sim/src/judge, packages/evals, packages/sim, packages/capital, packages/plugin-network, packages/blooio, prototypes/connector-mcp.
- **Status words.** fixed: the defect is closed and has a regression test. partly fixed: the part in our packages is done; the rest is named. not fixed: the reason is given. belongs-elsewhere: the fix is in a package this session does not own; the change is listed in "Items for the network/platform session".
- **opt-in:** the fix is behind a flag because turning it on by default moves network test results that gate on single-seed accept rates (see item 8 below).

## Summary

| Severity | Total | Fixed | Partly fixed | Not fixed | Belongs elsewhere |
|---|---|---|---|---|---|
| P0 | 1 | 1 | 0 | 0 | 0 |
| P1 | 21 | 14 | 4 | 0 | 3 |
| P2 | 81 | 55 | 15 | 5 | 6 |
| P3 | 81 | 48 | 9 | 21 | 3 |
| All | 184 | 118 | 28 | 26 | 12 |

Two bugs reported by the network build (not in the audit JSON) are also fixed: plan probes dropped by "Free.", and the crew probe grammar.

## The shared reply parser (P0 network-consent-2)

`packages/core/src/replies.ts`, exported from `@thenetwork/core`:

- `parseReply(text): ParsedReply` returns `{ answer: "yes" | "no" | "unsure", constraints: { kind: "time" | "condition", text }[], counter: boolean, leaning?: "yes" | "no", reason }`.
- `classifyYesNo(text): "yes" | "no" | "unsure"`.
- `parseOptOut(text, { apps? }): { match: "exact" | "likely" | "none", scope: "all" | "app", lang: "en" | "es" }`.

Only `"yes"` is consent. Negations ("absolutely not", "ok no", "yeah no", "I'm not in"), hedges ("not sure", "maybe", "who is it?"), conditions ("sure, but only with a woman") and conflicts ("Sounds fun. I can't though.") are never "yes". "yes but not Thursday" is a yes with a time constraint. The test corpus (`packages/core/test/replies.test.ts`) has 190+ hand-written phrasings, including emoji, "k", "nah", "no thanks", Spanish basics and opt-out phrasings. `packages/sim` `parseYesNo` is now a thin adapter over `parseReply`.

## Findings by area

### network build reports

| id | severity | status | note |
|---|---|---|---|
| crew copy grammar (network build report) | bug | fixed | plans.ts: "Your crew for an easy group run is on again"; copy test over every activity. |
| plan probe "Free." (network build report) | bug | fixed | plans.ts: PLAN_COPY_PUBLIC (cost lines, frames) and the time phrase are an allowlist like activity and place words; tests for probes not dropping and private words not appearing; allowlist never contains a sensitive term. |

### core and sim (reply parser)

| id | severity | status | note |
|---|---|---|---|
| network-consent-2 | P0 | fixed | New shared parser `parseReply` / `classifyYesNo` in packages/core/src/replies.ts (negation scope, hedges, conditions, time constraints, reversals, emoji, Spanish), tested on a 180-row hand-written corpus. packages/sim parseYesNo is now an adapter over it. The network-side move (network.ts imports parseYesNo from sim) belongs to the network session: import `parseReply` from `@thenetwork/core` instead. |

### core

| id | severity | status | note |
|---|---|---|---|
| core-1 | P1 | fixed | guard.ts: SENSITIVE_TERMS matched as whole, stem-aware words inside any forbidden string or fact, however short. explain.ts privateVocabulary keeps short sensitive words and only the member's own shareable facets clear them. Dropped inputs are exposed as `LeakGuard.dropped`. |
| core-2 | P1 | fixed | guard.ts `contactVariants`: number words, other-script digits, O/l in numbers, keycaps, spaced @ and dot, spelled at/dot. New patterns: 7-digit local numbers, provider emails, more TLDs, hxxp, handles inside words and after ig:/insta/snap. Append-only evasion corpus in packages/core/test/guard-evasion.test.ts. |
| core-3 | P1 | fixed | guard.ts: fold keeps \p{L}\p{N}; wider skeleton map (small caps, Armenian, Cherokee, IPA, stroke letters, regional indicators); shorter squash threshold for non-Latin scripts. Engine tokenizer part is engine-pipeline-13. |
| core-10 | P2 | fixed | llm.ts: dated/prefixed model ids are priced (`normalizeModelId`, `priceFor`); unpriced responses flagged; regrows reported; shared `LLMBudget` checked before every HTTP attempt. |
| core-11 | P2 | fixed | llm.ts/chatJson.ts: `deadlineMs` and `signal` (default deadline LLM_DEADLINE_MS, else 3x timeout); aborted backoff; a retry past the deadline fails at once. |
| core-12 | P2 | fixed | llm.ts: `LLMError` carries code, host, status and lengths only; provider body kept on non-enumerable `.body`. Surplus→OpenAI fallback stays default (AGENTS.md) but every fallback is logged and reported via `onFallback`; `fallback: false` per call or client. |
| core-13 | P2 | fixed | guard.ts: whole strings and 4-grams need 2+ content words. The measured-FP-rate gate is not built. |
| core-14 | P2 | fixed | guard.ts: `LeakGuard.checkThread(texts)` checks the last 5 messages to a recipient together. Callers (network, blooio) must pass the thread. |
| core-15 | P2 | fixed | guard.ts: intra-word punctuation/emoji variant; inflections for sensitive vocabulary words. Stems of generic engine vocabulary are not matched (they blocked ordinary explanations). |
| core-16 | P2 | fixed | New core/src/fence.ts `fenceUntrusted` (nonce delimiter, breaks up fence markers); all judge prompts use it. |
| core-4 | P2 | fixed | judge policy.ts uses core `isMinor` (missing/NaN = minor) and blocks on first-person "I'm 16" notes. |
| core-5 | P2 | partly fixed | policy.ts: validAge caps at 120; `effectiveAge` exported. Member.age stays required: making it optional breaks packages/network typing (network session). |
| core-7 | P2 | fixed | guard.ts: bounded email regex (linear time test) and `maxLength` (default 20k) returning `too_long`. |
| core-8 | P2 | fixed | chatJson.ts: errors thrown by `afterAttempt`/`grow` hooks are ignored, so a paid valid reply stays ok; aborted/deadline/budget errors stop the loop. |
| core-9 | P2 | fixed | llm.ts parseJson: a fenced ```json block wins; otherwise the first balanced value that parses (think blocks dropped, candidate starts capped at 64). |
| core-18 | P3 | fixed | 408 retried; non-JSON or choice-less 200 reported and retried; Retry-After honored up to 5 min; still-truncated replies throw `truncated`. |
| core-19 | P3 | fixed | guard.ts `isPhone`: order/booking/ref numbers and year lists are not phones; benign corpus added. Venue addresses: use `allow`. |
| core-20 | P3 | fixed | guard.ts: exact strings under 5 chars match whole words; phone values match on digits in any format. |
| core-21 | P3 | fixed | guard.ts: sensitive terms are never cut out by publicPhrases. |
| core-22 | P3 | fixed | clock.ts: SimClock rejects non-finite times; llm.ts takes injectable clock, rand and seed. |
| core-23 | P3 | fixed | guard.ts: bidi embedding/override/isolate controls return `format:bidi`. |
| core-24 | P3 | fixed | New corpora: replies.test.ts (parser), guard-evasion.test.ts (evasion and benign), policy.test.ts (ages). |
| core-6 | P3 | fixed | guard.ts: `setLeakLabelKey` / LEAK_LABEL_KEY keys the labels; unkeyed by default so simulations stay reproducible. Production must set the key (service config belongs to the network session). |
| core-m3 | P3 | fixed | guard.ts: short canaries match as whole words; empty canaries, exact strings and facts are listed in `LeakGuard.dropped`. |
| core-m4 | P3 | fixed | guard.ts: token index over fuzzy facts; 10k facts check in under 50 ms (test). |

### engine

| id | severity | status | note |
|---|---|---|---|
| engine-pipeline-1 | P1 | fixed | policy.ts: exploration takes only eligible or below_threshold configurations, never a pass-2 "no"; engine.ts: member text never comes from a "no" verdict; deep_insufficient can no longer be picked by exploration, so its question is not skipped. |
| engine-pipeline-15 | P1 | fixed | rules.ts: `romance_group` pre-rule (romance is pairs only, in every generator); romance_incompatible requires stated prefs on both sides when requireStatedPrefs is on. |
| engine-pipeline-4 | P1 | fixed | filters.ts SAFETY_RISK_PATTERNS / HOME_ENTRY_PATTERNS: childcare (digit and word ages), money asks, drugs, medical escort, home-entry variants; tested on a risky corpus and a benign corpus. Not config, so the config hash is unchanged. |
| engine-attention-plans-1 | P2 | fixed | attention.ts: the two-unanswered pause is counted since the last inbound, so a late reply lifts it. |
| engine-attention-plans-10 | P2 | fixed | planFallback returns `partnerPlan` (fresh one-to-one probes) instead of booking two group yes-sayers. |
| engine-attention-plans-12 | P2 | fixed | Disjoint k-best groups per (slot, activity); per-run hash tie-break instead of id. |
| engine-attention-plans-13 | P2 | partly fixed | Romance-lane events skipped; event capacity bounds the group. Events have no ageMin field (activity and venue floors apply). |
| engine-attention-plans-14 | P2 | not fixed | Needs an experiment design (oracle-independence ablation, adversary exposure). |
| engine-attention-plans-2 | P2 | partly fixed | plans.ts: each alternate checked against the group and earlier alternates. Dropping only the later joiner at runtime is network. |
| engine-attention-plans-4 | P2 | fixed | crewSessionPlan advances in local wall-clock time. |
| engine-attention-plans-6 | P2 | fixed | MINOR_OVERNIGHT [22, 7] applies to minors every night. |
| engine-attention-plans-7 | P2 | partly fixed | networkPack itemGate: missing categoriesOptIn means no romance. The network view() must pass categoriesOptIn (network items). |
| engine-attention-plans-8 | P2 | fixed | reengagement respects the logistics streak limit and takes a pack. |
| engine-pipeline-10 | P2 | fixed | filters.ts sendTimeReason/eligibilityFor take the lane and check effective match age; attention revalidateHold passes the category. Network callers must pass the category (network items). |
| engine-pipeline-12 | P2 | fixed | complementarity.ts: neutral only when the anchoring want maps to no objective. No held-out vocabulary eval run. |
| engine-pipeline-13 | P2 | fixed | embed.ts tokenize: NFKC, letters/marks/digits of any script, diacritics folded; ASCII output unchanged. |
| engine-pipeline-17 | P2 | partly fixed | engine.ts `canonicalInput` sorts input lists before building and hashing. Snapshot loader ORDER BY is packages/network/service (network items). |
| engine-pipeline-5 | P2 | fixed | tick.ts: later city ticks in the same hour see earlier ticks' proposals, so budgets are shared; duplicate ids dropped. |
| engine-pipeline-6 | P2 | fixed | scoring.ts `explorationBar`: Quiet members and romance keep their full bar. Per-member exploration not done. |
| engine-pipeline-7 | P2 | fixed | engine.ts: a configuration ineligible before pass 2 stays ineligible (pass 2 only removes). |
| engine-pipeline-8 | P2 | partly fixed | `runLog.judge.coverage` {selected, judged} reported. Gating unjudged picks needs a product decision on LLM volume. |
| engine-attention-plans-11 | P3 | fixed | New PlanAnswer "late" for a refused late yes. |
| engine-attention-plans-16 | P3 | fixed | whenPhrase compares local calendar days. |
| engine-attention-plans-17 | P3 | fixed | fromLocal maps a spring-forward gap to the first instant after it. |
| engine-attention-plans-18 | P3 | not fixed | OutreachController is used by tests only; removal means rewriting outreach.test.ts. |
| engine-attention-plans-19 | P3 | fixed | digestText throws unless given 1-3 lines. |
| engine-attention-plans-20 | P3 | not fixed | Separate meeting hours is a design change. |
| engine-attention-plans-21 | P3 | fixed | openAt handles venues closing after midnight. |
| engine-attention-plans-22 | P3 | fixed | attentionMetrics clips to [start, end]. |
| engine-attention-plans-23 | P3 | not fixed | Exploration sends need a design decision. |
| engine-attention-plans-24 | P3 | not fixed | Re-confirming the first member after a partner swap is not trivial. |
| engine-attention-plans-3 | P3 | not fixed | Crew pair/host checks need a World argument in crewSessionPlan. |
| engine-attention-plans-5 | P3 | fixed | Minors take the stricter cap and the higher shadow price. |
| engine-attention-plans-9 | P3 | partly fixed | A state cap stricter than the plan allowance is kept; "plan items only" is the caller's job. |
| engine-pipeline-11 | P3 | not fixed | Quadratic generators: not trivial. |
| engine-pipeline-14 | P3 | not fixed | Adding the pack id to networkPack keys breaks golden byte-identity by design. |
| engine-pipeline-16 | P3 | fixed | pairReason returns unknown_member before pack rules run. |
| engine-pipeline-18 | P3 | fixed | ontology.ts: case-insensitive tags, values keep extra colons, invalid age ranges admit nobody. |
| engine-pipeline-19 | P3 | fixed | passCacheKey adds connector/revision, city, fixed window, pass2Context. |
| engine-pipeline-2 | P3 | fixed | world.ts rejects duplicate member ids. |
| engine-pipeline-20 | P3 | not fixed | Lowering the evidence prior moves every score; needs a measured re-tune. |
| engine-pipeline-21 | P3 | fixed | explain.ts: event titles and quoted facet values are leak-gated; every exploration pick carries EXPLORATION_LABEL, also on the pack-lead and judge-text paths. |
| engine-pipeline-22 | P3 | fixed | Tick id includes the config hash; the lock is still in-process. |
| engine-pipeline-23 | P3 | fixed | `prob` rejects values in (1, 2); percents start at 2. |
| engine-pipeline-24 | P3 | fixed | judgeScreen screenSnapshot uses live intents and canonical ids. |
| engine-pipeline-25 | P3 | not fixed | Doc/code drift only. |
| engine-pipeline-9 | P3 | partly fixed | help_request alternates checked against every helper; opportunity.ts optional eligibility unchanged. |

### judge and evals

| id | severity | status | note |
|---|---|---|---|
| judge-evals-1 | P1 | fixed | judge metrics.ts: the minors gate counts probe participants, meta.plan, relayFrom, connection-type messages (growth asks) and probe_started/probe_sent logs, also before the proposal record exists. |
| judge-evals-2 | P1 | fixed | Proactive is derived from timing and records (reply within 15 min, join, member's own ask, a real acceptance); new `proactive_mislabeled` rule; meta.proactive/system flags are not trusted. |
| judge-evals-7 | P1 | partly fixed | Optional `AppId`/`app` on core Facet, Member (`apps`), Proposal and on run-log messages, joins and personas; new `cross_app_leak` rule. Plugin `NetworkTurnAuthority.app` added (proto). Network must stamp `app` on its run-log records. |
| judge-evals-8 | P1 | fixed | New rules `name_before_reveal`, `decliner_exposed`, `contact_before_swap` (swap = `contact_swap` record or log). |
| judge-evals-M1 | P1 | fixed | Judge owns `PRD_BUDGETS` (PRD 32.9: Normal 2/7d, Open 4/7d, Quiet 1/30d, Receiving/Paused 0) and grades per participation state; unknown state = Normal. network.test.ts must import it (network session). |
| judge-evals-10 | P2 | fixed | Canary scan normalizes case/spacing, covers failed/suppressed/carrier sends; `selfEcho` and `canary_in_log` reported separately. |
| judge-evals-11 | P2 | fixed | STOP tracked in time order (same-tick send after STOP violates); START or `opt_in` record lifts it. |
| judge-evals-12 | P2 | fixed | Quiet hours by current city (`location` record); per-state budgets; a short "thx" reply does not reset the unanswered streak. |
| judge-evals-13 | P2 | fixed | `pause_path_missing` is an invariant on every proactive message. |
| judge-evals-14 | P2 | fixed | Romance by category; blocks checked on alternates, meetings and relays; review reject removes approval; `requireReview` fails closed without review logs. |
| judge-evals-16 | P2 | partly fixed | Policy calibration items, per-judge agreement and floors in the live test. Offline cassette replay needs recorded responses: not done. |
| judge-evals-17 | P2 | fixed | `leakGuardBaseline` scores engine checkMemberFacing on gold items (offline 68% agreement, misses 15 of 39 true leaks). |
| judge-evals-18 | P2 | not fixed | Needs a dataset redesign and paid live re-runs (founder call). |
| judge-evals-3 | P2 | fixed | Every LLM judge validates the reply shape, retries 3 times, then throws (fail closed). |
| judge-evals-4 | P2 | fixed | evals pipeline returns decision null / all_failed and lists failed stages. The engine's own fail-open pipelineDecision is unchanged (see engine rows). |
| judge-evals-9 | P2 | fixed | Combined case-insensitive name matcher (unique first names, possessives, place-name guards); counts adults named to a minor and connection offers to a minor. |
| judge-evals-M3 | P2 | fixed | A minor_signal or unresolved age_unknown log makes that member a minor from then on. |
| judge-evals-15 | P3 | fixed | rules.ts: impersonation variants, international phones, at/dot emails, handles. Venue false positive remains. |
| judge-evals-19 | P3 | not fixed | Sealing a new test split needs new data and live runs. |
| judge-evals-20 | P3 | fixed | sim cli.ts --judge samples every delivered message, audits all facts in batches of 40, exits 1 on judge errors. |
| judge-evals-21 | P3 | not fixed | Drift is in docs/test-plan.md (git history, 16cde70); a coverage-map test is not trivial. |
| judge-evals-22 | P3 | partly fixed | Vacuous datasetV2 assertion replaced; tests for the new metric rules. |
| judge-evals-24 | P3 | fixed | SpendGuard reserves in-flight calls at the most expensive call seen. |
| judge-evals-25 | P3 | fixed | Combined name matcher; "class of YYYY" relative to the Clock year. |
| judge-evals-M4 | P3 | fixed | Duplicate sends are logged as `network_log` `duplicate_send`. |
| judge-evals-M5 | P3 | partly fixed | Self-addressed echoes counted apart; unsent explanations still count (kept so the canary gate does not weaken) and are marked. |

### sim

| id | severity | status | note |
|---|---|---|---|
| sim-worlds-1 | P1 | fixed | sim snapshot.ts: invite answers come from the member's inbound reply (read with core `parseReply`); an ignored invite is "no response" after 48 h; feedback only from answered feedback requests, read from the member's words. Test covers ignored invite and unanswered feedback. |
| sim-worlds-5 | P1 | belongs-elsewhere | Skipped by instruction: adversaries, two-app personas and cross_app_leak worlds belong to the worlds agents. |
| sim-worlds-10 | P2 | fixed | scenario.ts `factLeaked`: three consecutive content words of the private fact fail the check, not only the canary. |
| sim-worlds-11 | P2 | fixed | world.ts passes the proposal category to the oracle when recording a proposal and scoring a meeting. |
| sim-worlds-12 | P2 | partly fixed | Sim part: post-match-harassment.json scenario and `blocked_pair_kept_apart` check. The slop harness part belongs to the worlds agents. |
| sim-worlds-13 | P2 | fixed (opt-in) | `PolicyOptions.qualityChurn` / `--quality-churn`: trust drops after unsafe or poor intros and bad meetings; low trust leads to STOP. |
| sim-worlds-14 | P2 | partly fixed | `--richness` CLI flag. Default stays perfect onboarding (changing it moves every golden): meetings 32/36/31 default vs 19/22/17 with richness on seeds 1-3. |
| sim-worlds-16 | P2 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-4 | P2 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-6 | P2 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-7 | P2 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-8 | P2 | not fixed | packages/sim/src/plans.ts does not exist on main; the sim imports the engine only as a type. The audit line refers to the console branch. |
| sim-worlds-9 | P2 | fixed | New scenario lying-minor-seeks-romance.json, `no_romance_proposal` check, scenario `claimedAge`. |
| sim-worlds-17 | P3 | fixed | generator.ts: minor-adult links are siblings (gap ≤ 12) or family friends only; RNG draws unchanged. |
| sim-worlds-18 | P3 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-19 | P3 | fixed (opt-in) | `PolicyOptions.tripClock` / `--trip-clock`. Opt-in because on by default it moves the single-seed network test. |
| sim-worlds-20 | P3 | not fixed | Plausible only; not trivial. |
| sim-worlds-21 | P3 | fixed | Name index rebuilt on spawn. |
| sim-worlds-22 | P3 | belongs-elsewhere | packages/sim/src/apps/slop (worlds agents). |
| sim-worlds-23 | P3 | fixed | README performance numbers re-measured (≈4.7 s and ≈73 s). |
| sim-worlds-M3 | P3 | fixed | A scenario whose expectations are all skipped reports `vacuous` and fails. |
| sim-worlds-M4 | P3 | not fixed | Needs an incremental snapshot accumulator. |

### capital

| id | severity | status | note |
|---|---|---|---|
| capital-1 | P2 | fixed | `value_received` takes `confirmedBy`/`verifiedBy`; vouch credit needs an eligible adult provider's confirmation or a check-in/organizer/reviewer verification. New `vouch_ring` flag. Sim vouch-ring net gain −1.9 → −8.8 NC. Network must emit the confirmations (see network items). |
| capital-11 | P2 | fixed | Ring rule for 3–12 members (`ringMaxMembers`), organizer-origin staging, honest weekly friends in the sim. Honest friends flagged 100% → 0.8%; adversaries still 96–100% detected. |
| capital-12 | P2 | partly fixed | Sim reviewer confirms the whole flagged set by default; report adds honest NC lost. Per-member review decisions in the product belong to network. |
| capital-13 | P2 | fixed | Gate reads the 95% CI lower bound with at least 32 seeds. The gate now FAILS (−0.012, CI −0.056..0.033): a real result, not a regression. |
| capital-3 | P2 | partly fixed | New src/validate.ts; `record()` validates first and throws `CapitalEventRejected` with no state change; `ledger.rejected()` lists rejects. The swallowing catch is in packages/network capitalWiring (network session). |
| capital-4 | P2 | fixed | New `age_updated` event; minors and unknown ages stop accrual; turning 18 starts it. |
| capital-5 | P2 | partly fixed | New src/store.ts (`MemoryCapitalStore`, `JsonlCapitalStore`, append-only, torn last line cut); ledger replays on start. Service wiring belongs to the network session. |
| capital-7 | P2 | fixed | Separate `feedback` category with its own decay; feedback is reversed with the attendance it depends on. |
| capital-8 | P2 | fixed | Decay on the most repeated counterpart; staged_meetup counts plans per pair and merges overlapping pairs. |
| capital-10 | P3 | fixed | Member reads redact vouch providers; reads return copies. |
| capital-14 | P3 | not fixed | Windowing the levers is a design change. |
| capital-15 | P3 | not fixed | Product call. |
| capital-16 | P3 | not fixed | Product call (per-app or shared ledger). |
| capital-17 | P3 | partly fixed | Self-vouch ignored, removed members earn nothing. Reviewer self-review needs a subject on review_completed (network). |
| capital-18 | P3 | fixed | Lever functions require `at`. |
| capital-19 | P3 | not fixed | Canonical same-tick order is not trivial. |
| capital-2 | P3 | fixed | Only in-window clawbacks count toward the period cap. |
| capital-20 | P3 | partly fixed | `credit()` reads back only to the longest window, no copies. |
| capital-21 | P3 | belongs-elsewhere | The effort overlay is wired in network and engine pack config. |
| capital-22 | P3 | partly fixed | Entry ids unique. "now active" view copy is member-facing copy (needs video per repo rule): left. |
| capital-6 | P3 | fixed | Semantic dedupe: same organizer+plan or member+need earns once. |
| capital-9 | P3 | fixed | Only eligible adults count as invitees, counterparts, recipients and confirmers. |
| capital-m1 | P3 | belongs-elsewhere | packages/network/src/capital.ts: `ledgerReader(ledger, ledger.cfg)`. |
| capital-m2 | P3 | fixed | `resolveCapital()` refuses unknown keys and out-of-range numbers. |
| capital-m3 | P3 | fixed | `detectGaming` ignores reversed credits (sim flags/seed 18.1 → 8.9). |
| capital-m4 | P3 | belongs-elsewhere | packages/network/src/network.ts:1197: drop `now` from the review_completed key. |

### plugins and prototypes

| id | severity | status | note |
|---|---|---|---|
| plugin-prototypes-1 | P1 | fixed | plugin-network edge.ts registers SET_STATE only in planner mode; the set-state handler runs `authorizeSetState` on the member's message and refuses past dates. |
| plugin-prototypes-12 | P1 | partly fixed | messaging-blooio keywords.ts uses core `parseOptOut`: free-text and Spanish opt-outs are recorded, skip the agent and get one confirmation (Spanish copy `optOutEs`). Per-app leave and the ConsentNetwork inbound path belong to the network/platform session. |
| plugin-prototypes-21 | P1 | fixed | connector-mcp: only private facets of this member's counterparts are guarded (`counterpartId`); `maskEchoes` blanks verbatim echoes of the caller's input before the check, so the answer no longer depends on a guess. |
| plugin-prototypes-22 | P1 | fixed | connector-mcp `noteStatedAge`: a stated 13-17 age lowers the effective age and opens a staff case; under 13 suspends the member (every tool refuses) and adds a `staffEscalations` case with no member text. |
| plugin-prototypes-26 | P1 | belongs-elsewhere | Skipped by instruction: per-site SKILL.md files belong to the sites session. |
| plugin-prototypes-10 | P2 | partly fixed | types.ts `NETWORK_STATE_TO_PARTICIPATION` mapping, type-checked against core. One shared enum needs a core change and a founder check of the mapping. |
| plugin-prototypes-13 | P2 | fixed | outbound-queue.ts: group sends check every participant through a `groupParticipants` resolver; fail closed without one. |
| plugin-prototypes-14 | P2 | fixed | "reply" needs an inbound from that person within `replyWindowMs` (1 h), else suppressed with an alert. |
| plugin-prototypes-15 | P2 | fixed | reply_only lines hold every agent-initiated send; a record with no line gets the strictest line action. |
| plugin-prototypes-16 | P2 | fixed | A "blocked" result no longer falls back to SMS; the hourly cap per person counts across channels. |
| plugin-prototypes-17 | P2 | fixed | consent-store.ts: a corrupt middle line throws on load; a torn last line is cut; appends are fsynced. |
| plugin-prototypes-2 | P2 | fixed | authz.ts `evidenceSupportsState`: evidence must contain a cue for the proposed state; negated cues are refused. |
| plugin-prototypes-24 | P2 | fixed | config.ts: Claude client documents must sit directly under /oauth/ (exact names to confirm with Anthropic). |
| plugin-prototypes-3 | P2 | fixed | dates.ts `zonedNow`: dates resolve on the member's local day when the authority carries `timeZone` (UTC otherwise). |
| plugin-prototypes-4 | P2 | partly fixed | Keys are `network:set_state:v2:{app}:{member}:{origin}:{n}`; InMemoryNetworkStore throws on a reused key with a different payload. The Cloud store must do the same. |
| plugin-prototypes-6 | P2 | fixed | authz.ts `quotedSpans`: single quotes, "X said/wrote/texted", forwarded blocks; state-intent.ts uses the same filter. |
| plugin-prototypes-7 | P2 | fixed | A bare "may" is not May; stated dates are re-checked for the past after overriding the model. |
| plugin-prototypes-M1 | P2 | not fixed | Needs CI to install the eliza deps and assert the plugin suite ran (CI is not ours). The eliza submodule is uninitialized here. |
| plugin-prototypes-M2 | P2 | fixed | structured-field.ts: no message id returns a non-applied direct reply instead of falling through to the planner. |
| plugin-prototypes-11 | P3 | fixed | "Today is" read per call in the member's zone; MEMBER_CONTEXT renders stateFrom. |
| plugin-prototypes-18 | P3 | fixed | Repeated STOP/START recorded but not re-confirmed; START from a stranger grants no proactive consent. |
| plugin-prototypes-19 | P3 | not fixed | Person-keyed consent and strict E.164 are not trivial. |
| plugin-prototypes-20 | P3 | not fixed | Not trivial. |
| plugin-prototypes-23 | P3 | fixed | profiles.ts uses core `isMinor`: unknown age gets the teen-safe rules. |
| plugin-prototypes-25 | P3 | fixed | A blocked reply after a committed write says the Network got the request. |
| plugin-prototypes-27 | P3 | not fixed | Not trivial. |
| plugin-prototypes-8 | P3 | fixed | network-signals.ts reads only the member's own words and ignores negated matches. |
| plugin-prototypes-9 | P3 | not fixed | Needs a labelled corpus. |
| plugin-prototypes-M4 | P3 | fixed | Stated from/until re-checked for the past after override (defense only; no failing repro possible). |
| plugin-prototypes-M5 | P3 | partly fixed | A fallback record with no line gets the strictest line action; it still does not carry the primary line. |

### cross-package (matching)

| id | severity | status | note |
|---|---|---|---|
| matching-e2e-4 | P1 | partly fixed | Sim part: opt-in `PRIMED_MODEL.identityFit` (primed accept scaled by perceived fit) and packages/sim/experiments/primed-sweep.ts (common random numbers, 3+ seeds). Sweep: consent has ~31 fewer unsafe proposals in every setting; the meetings advantage depends on PRIMED and is not established. The network test must gate on outcomes (network items). |
| matching-e2e-5 | P1 | belongs-elsewhere | Exposure gates, floor order and the request-search load term live in packages/network dailyRun. |
| matching-e2e-7 | P1 | partly fixed | Judge reports `proposals.started` and real probe decisions. Precision over started opportunities needs an oracle verdict per probe_started (sim/network); "fulfilled after attendance" is network. |
| matching-e2e-11 | P2 | belongs-elsewhere | Second-chance gate and warm-path cap are network selection logic. |
| matching-e2e-14 | P2 | not fixed | Re-running the fairness levers through ConsentNetwork is an experiment task. |
| matching-e2e-6 | P2 | belongs-elsewhere | The engine reads and returns exposure debt; the network must persist it and count only revealed probes. |
| matching-e2e-8 | P2 | fixed (opt-in) | `OracleOptions.stableDecisions` / `--stable-decisions`: accept draw keyed by participants, category and week; 28-day decline memory. |
| matching-e2e-9 | P2 | partly fixed (opt-in) | `OracleOptions.logistics` / `--logistics`: show-up lowered for travel, sleep, busy blocks and non-free evenings. Time-aware launch arms are network. |
| matching-e2e-16 | P3 | partly fixed | Judge exports `GOOD_MEETING_ENJOYMENT` (0.6); network/harness must import it. |

## Items for the network/platform session

These need changes in files this session does not own (packages/network, packages/platform, packages/observatory, sites, CI, Cloud).

### Consent and replies
1. **network-consent-2.** `packages/network/src/network.ts:21` imports `parseYesNo` from `@thenetwork/sim`. Import the shared parser from core instead: `import { parseReply, classifyYesNo, parseOptOut } from "@thenetwork/core"` (file `packages/core/src/replies.ts`). Treat only `answer === "yes"` as consent. `"unsure"` (hedges, conditions such as "sure, but only with a woman", conflicts) means ask again. `counter: true` means another time, not a yes. A yes can carry `constraints` of kind `"time"` ("yes but not Thursday"). Today network.ts:179 treats the sim's `"counter"` as yes (`yn !== "no"`); fix that too.
2. **plugin-prototypes-12 (rest).** Use `parseOptOut(text, { apps })` on the ConsentNetwork inbound path and the platform. `match: "exact"` opts out at once; `"likely"` opts out and sends one confirmation (Spanish copy when `lang === "es"`). `scope: "app"` is a per-app leave ("leave slop").
3. **PRD PH-003 pause path.** The judge now checks a pause path on every proactive message (`pause_path_missing`). Network probes ("no pressure either way", "no is completely fine") have none: 264 hits per 10-day NYC run. Use engine `withPausePath` (packages/engine/src/attention.ts) or add one to `copy.probe` and `copy.probeForRequest`.
4. **Outreach controller.** "Good news: I may have found someone" and `requestNoneYet` info messages skip the controller, sometimes at night: 27 `proactive_mislabeled`, 7 `quiet_hours`, 15 `over_budget`, 4 `two_unanswered` per 10-day run. Mark them proactive or send them only within 48 h of the member's ask.
5. **Minors.** `copy.plans` reaches minors and offers "Want me to see if anyone else is up for one of them?": 27 minor contacts per 10-day NYC run under the new judge (judge-evals-1).
6. **Budget test (judge-evals-M1).** `packages/network/test/network.test.ts:58` grades at 4/week. Import `PRD_BUDGETS` (and `LANE_BUDGETS` for plan invites and check-ins) from `@thenetwork/sim (src/judge)`.
7. **Review gate.** `unreviewed_contact` now counts probe messages too: 742 per 10-day run (known P0-1).
8. **"Consent beats push" test (matching-e2e-4).** Stop gating on `inviteAcceptRate > 0.75` and `proposalAllYesRate > 0.75` (it fails today at 0.704, as it did at baseline). Gate on outcomes over 3+ seeds: `consent.unsafe < push.unsafe / 4` on every seed, mean meetings held consent > push, `falseFlags == 0`. Use `packages/sim/experiments/primed-sweep.ts`. Then turn on `PRIMED_MODEL.identityFit` (0.55) by default. Add `--identity-fit` to `packages/network/src/experiment.ts`.
9. **classify.ts `feedbackOf`.** "Honestly not great" reads as positive (`/great/` before `/not great/`). Test negatives first, as sim `feedbackReading` does.
10. **matching-e2e-7.** Record an oracle verdict for every `probe_started` opportunity so precision covers started opportunities; mark "fulfilled" only after attendance.
11. **matching-e2e-16.** Import `GOOD_MEETING_ENJOYMENT` from `@thenetwork/sim (src/judge)` in the harness.

### Engine wiring in the network runtime
12. **engine-attention-plans-7.** `view()` in network.ts must set `categoriesOptIn: member.prefs.categoriesOptIn` on MemberAttention. Without it, romance items are now always blocked (fail closed).
13. **engine-pipeline-10.** Pass the opportunity's category to `eligibilityFor(w, optedOut, category)` in the send-time check.
14. **engine-pipeline-17.** Add `ORDER BY` to every query in `packages/network/service/snapshot.ts`.
15. **engine-attention-plans-10.** If the network calls `planFallback`, a returned `partnerPlan` must start a new partner run with one-to-one probes, not a booking.
16. **engine-attention-plans-11.** Code that reads `PlanRun.answers` must handle the new `"late"` value.
17. **engine-attention-plans-2.** At backfill, when two alternates conflict, drop only the later joiner.
18. **matching-e2e-5, -6, -11.** Keep the engine's floor-first order in dailyRun, persist `runLog.exposureDebt` and pass it back as `input.exposureDebt`, count only revealed probes as exposure, add a load term to request search.

### Leak guard and ages
19. **core-14.** Call `LeakGuard.checkThread(lastMessagesToRecipient)` on the send path so split numbers and facts are caught.
20. **core-6.** Set `LEAK_LABEL_KEY` (a secret) in the service environment so leak labels cannot be reversed with a wordlist.
21. **core-5.** Use `effectiveAge(recordAge, ...statedAges)` from core wherever ages from several sources meet. Making `Member.age` optional needs network typing changes.
22. **judge-evals-7.** Stamp `app` on run-log messages and joins, and pass `authority.app` (and `timeZone`) to `createNetworkEdgePlugin`, so `cross_app_leak` runs on real traffic.

### Capital
23. **capital-3.** `packages/network/src/capital.ts` capitalWiring: replace `catch { rejected++ }` with a catch that logs `ledger_rejected {id, reason}`; fail the harness when `ledger.rejected().length > 0`.
24. **capital-5.** Construct `new CapitalLedger(cfg, { store: new JsonlCapitalStore(path) })` (or a Postgres store with the same interface) in the service.
25. **capital-m1.** `ledgerReader(ledger, ledger.cfg)`.
26. **capital-1.** In `onFeedback`, emit `value_received` with `confirmedBy` = other attendees whose own check-in says they came; `verifiedBy: ["checkin"]` with a host check-in; help value passes `confirmedBy: [helper]`. Without this, production vouch credit is zero.
27. **capital-4.** Emit `age_updated` on any age change.
28. **capital-m4.** network.ts:1197: drop `now` from the review_completed key.
29. **capital-17, -12.** Skip review credit when the reviewer is a subject; record per-member review decisions so `fraud_confirmed.members` holds only confirmed members.
30. **capital-18.** `effortOverlay`, `vouchCapacity`, `organizingReach` now require `at`.
31. **capital-13.** `docs/results/2026-10-08-network-capital.md`: the fairness gate now reads the CI lower bound over 32 seeds and reports FAIL (−0.012, CI −0.056..0.033); `stagedRepeat` is 6.

### Plugin, Cloud, Blooio hosts, CI
32. **plugin-prototypes-4.** The Cloud NetworkStore must throw on a reused idempotency key with a different (member, state, from, until).
33. **plugin-prototypes-13, -14.** Hosts that build the Blooio queue must pass `groupParticipants` (group sends are suppressed without it). Callers that enqueue `kind: "reply"` with no inbound in the last hour (onboarding openers, invites) must use `proactive` or `transactional`.
34. **plugin-prototypes-M1.** CI must install the eliza deps for packages/plugin-network and fail when its suites do not load.
35. **plugin-prototypes-26.** One SKILL.md per published site, same backend URL, linted against each site's terms (sites session).
36. **sim-worlds-5** and the worlds-only items (sim-worlds-4, -6, -7, -16, -18, -22) belong to the agents working in packages/sim/src/apps/slop.
37. **slop goldens.** `packages/engine/test/goldens/slop.json` was re-captured here (run ids only; engine-pipeline-17). The slop agents should re-capture after merging.

## Golden changes

Every networkPack golden change is an intentional behavior change, re-baselined in its own commit with the reason:

- `432aa50` attention_v12 and plans_v11: the shared reply parser reads "Not this week, thanks." as no and "I am in" as yes.
- `goldens: re-baseline the capital key` (capital fixes).
- `goldens: re-baseline fast.json for the engine, sim, judge and harness fixes` (key-by-key reasons in the commit message).
- `goldens: re-capture slop.json run ids` (run ids only; slopPack proposals are byte-identical).
- `full.json` (GOLDEN_FULL tier): see the last commit of the branch.

## Results worth a look

- **Capital fairness gate now FAILS** (capital-13): it reads the 95% CI lower bound over 32 seeds: −0.012, CI −0.056 to 0.033 against a −0.02 limit. This is a real result.
- **New judge invariants flag the shipped network** (judge-evals-1, -2, -8, -13, -M1): minor contacts through `copy.plans`, missing pause paths, mislabeled proactive info messages, unreviewed probes. See the network items above. The network's own tests do not run these rules yet.
- **engine_sim precision** moved 0.281/0.292/0.319 → 0.288/0.257/0.296 on about 70 proposals per seed after the exploration and pass-2 fixes. Small samples; worth a multi-seed check.
- **Leak guard baseline on gold items** (judge-evals-17): the engine's `checkMemberFacing` agrees with gold privacy labels 68% of the time offline and misses 15 of 39 true leaks (paraphrases a deterministic guard cannot see).
- **PRIMED sweep** (matching-e2e-4): consent-first has about 31 fewer unsafe proposals than push in every setting; the meetings advantage depends on the PRIMED assumption.

## Test status

Run with API keys unset and no LIVE_TESTS.

- `bunx tsc --noEmit -p .`: clean.
- `bun test --conditions eliza-source ./packages ./prototypes`: 1827 pass, 10 skip, 5 fail. The fails are the same as on `origin/main`:
  - packages/network "meetings happen at real public NYC venues" (baseline).
  - packages/network "consent-first beats push" (baseline; accept-rate gate, see network item 8).
  - packages/plugin-network: 3 files cannot load `@elizaos/*` because the `eliza` submodule is not initialized. The plugin changes were checked in a scratch harness with a symlinked eliza install: 53 pass, 0 fail.
