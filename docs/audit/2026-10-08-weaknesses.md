# Weakness report, 2026-10-08

This report merges the adversarial audit of every package. Each dimension had a finder and a skeptic. The skeptic re-ran the repros and set the final verdict and severity. This report uses the skeptic's severity.

Checkouts audited:

- the `thenetwork-audit` worktree (main, d8d339c).
- the `thenetwork-console` worktree (branch obs/network-console, uncommitted, changing during the audit).

Line numbers on the console branch can drift. Re-run the repro before you fix a finding.

The test plan is in [2026-10-08-test-plan.md](2026-10-08-test-plan.md).

## How to read this report

- **Severity.** P0 breaks consent, minors safety or the core product promise for real members. P1 is a serious safety, privacy, compliance or launch blocker. P2 is a real defect with limited reach or a strong mitigation. P3 is minor, latent or a cleanup.
- **Verdict.** "confirmed" means the skeptic reproduced it or read the code path to a clear result. "plausible" means the code supports it but nobody ran it.
- **Merged findings.** When two dimensions found the same defect, the row keeps one id and lists the others in brackets.
- **Repro scripts** are in `/private/tmp/claude-501/-Users-shawwalters-Desktop-thenetwork/dc0217e9-737e-4ff5-9dd6-26732468518e/scratchpad/audit/<dimension>/`.

## Summary

| Severity | Count |
|---|---|
| P0 | 6 |
| P1 | 55 |
| P2 | 122 |
| P3 | 138 |
| Total | 321 |

Six refuted findings are listed in the appendix.

The six P0 findings share one cause. The consent and understanding layer of `packages/network` reads member text with regexes that were written against the simulator's own sentences. Real members will say "No. Saturday I'm at a wedding" and get booked. They will say "absolutely not" and get seated. They will describe what they want in their own words and get nothing. Fix these before anything else.

## Ordered table

### P0

| ID | Package | File:line | Title | Verdict | Fix direction |
|---|---|---|---|---|---|
| network-consent-1 (also consent-M2, consent-M4) | network | packages/network/src/classify.ts:262 | parseProbeReply reads refusals that name a day as yes, then books and reveals names. Conditional and hedged replies ("sure, but only with a woman", "who is it? thursday maybe") are also yes. | confirmed | Check negation and refusal first, per sentence. A mixed or conditional reply returns "unclear" and the member is asked again. |
| network-consent-2 (also sim-worlds-3, sim-worlds-M1) | network, sim | packages/sim/src/agent/policy.ts:41 | parseYesNo reads "absolutely not", "not sure", "ok no" as yes. Production imports this parser from the simulator, so the sim grades its own parser. | confirmed | Move the parser into packages/network. Add negation scope. Test it on a human-written corpus the persona generator never sees. |
| network-consent-3 | network | packages/network/src/network.ts:506 | An explicit under-join-age statement after a meeting runs the decline and forget before minorAfterContact. No safety record of the adults survives. | confirmed | Run minorAfterContact before forget. Keep an id-only case on the adults that survives the delete. |
| network-consent-4 | network | packages/network/src/network.ts:533 | A victim who reports a scam or contact extraction is scored as the abuser and put on hold. The block is never applied. | confirmed | Run block and report handling before abuse scoring. Do not attribute reported words to the reporter. |
| matching-e2e-1 (also matching-e2e-M3) | network | packages/network/src/classify.ts:181 | Profile and request parsing only matches the simulator's template sentences. Paraphrases give no desire and no area. An unknown area silently becomes Midtown, which also biases request search. | confirmed | Replace substring matching with a real extractor (LLM or trained). Leave unknown areas unset and ask. Add a paraphrase sim arm. |
| matching-e2e-2 | network, platform | packages/network/src/network.ts:2737 | The want gate scores every romance proposal 0, so no dating match is ever made. Apps have no category scope, so slop and peon would get generic intros. | confirmed | Let engine romance proposals pass the gate when the engine's opt-in and preference checks passed. Add allowedCategories per app. |

### P1

| ID | Package | File:line | Title | Verdict | Fix direction |
|---|---|---|---|---|---|
| network-service-1 | network/service | packages/network/src/network.ts:492 | "I act like I am 12 years old" from an attested 30-year-old irreversibly deletes the account and cancels others' plans. | confirmed | Match only first-person present-tense statements. When the record says adult, hold for staff instead of forgetting. |
| network-service-2 | network/service | packages/network/service/service.ts:124 (now runtime.ts start) | Restart hands waiting rows to the queue before state loads, so every deferred or held message is suppressed as unknown_member. | confirmed | Load Network state before redelivery. Expire stale rows with a TTL. |
| network-service-M1 | network/service | packages/network/src/store.ts | Under the network_service RLS role, load reads nothing and save overwrites state with a fresh Network. | confirmed | Set app.app_id in a local transaction for every read and write. Test under a non-superuser login. |
| network-consent-5 (also matching-e2e-3) | network | packages/network/src/network.ts:1575 | A probe "no" never marks the pair declined. The same member is probed again and the requester is offered the same candidate almost daily, outside the budget. | confirmed | Call markDeclined on every probe or confirm "no". Exclude met and no-show pairs. Cap non-proactive confirms. |
| network-consent-6 | network | packages/network/src/network.ts:910 | A first report leaves no case or log, but the member is told it was flagged for the safety team. | confirmed | Every report opens a staff case with zero points. Copy only claims what happened. |
| network-consent-7 | network | packages/network/src/trust.ts:92 | One reporter can put a target on hold. Strangers can hold anyone by first name. A staff lift keeps old corroboration. | confirmed | Count one weight per reporter. Require a shared interaction for points. Clear reportsFrom on lift. |
| network-consent-8 | network | packages/network/src/classify.ts:35 | Abuse regexes flag "my startup", "I'll pay $50", "print the" and "they're cute". A single message can reach hold, and the request is dropped. | confirmed | Narrow the patterns. No single message from a fresh member reaches hold. Still handle the request. |
| network-consent-9 (also consent-M1) | network | packages/network/src/classify.ts:122 | Common teen age phrasings ("I'm only 15", "15f here") and third-party reports ("he's only 15") are missed. | confirmed | Widen age extraction. A third-party minor report removes the target from matching until staff review. |
| network-consent-10 | network | packages/network/src/network.ts:522 | "I teach high school" permanently flags an adult as a minor. No staff path clears it. | confirmed | Narrow the signal. Add an audited staff action to clear a signal when no stated or record age is under 18. |
| network-consent-11 | network | packages/network/src/network.ts:1062 | Matchable (not shareable) facets are quoted to other members in probes and confirms. | confirmed | Build member-facing reasons from shareable facets only. |
| network-consent-12 (also network-service-13) | network, platform | packages/network/src/network.ts:498 | Ages stated in chat and under-13 declines never reach platform.people.lowest_age or the platform membership. Other apps keep matching the person. | confirmed | Add an onAgeStated callback. The service writes noteAge and removes the membership on decline. |
| matching-e2e-M1 | network | packages/network/src/classify.ts | "I don't want to meet other founders" becomes a want and starts a people request that probes others. | confirmed | Handle negation before desire and interest extraction. |
| matching-e2e-M2 | network | packages/network/src/network.ts:2614 | The shipped Network calls runEngine with no LLM, so the judge and verdict gates never run in production. | confirmed | Wire the judge, or set judge.enabled=false and say so. Test that config and wiring agree. |
| matching-e2e-4 (also sim-worlds-2, sim-worlds-M2) | sim, network | packages/network/test/network.test.ts:291 | "Consent beats push" depends on PRIMED_MODEL (identity 0.95). At 0.8 consent loses on meetings. Sensitivity runs used one seed and a narrow range. | confirmed | Gate on outcome metrics, not accept rates. Sweep PRIMED with common random numbers over 3+ seeds. Tie primed accept to partner fit. |
| matching-e2e-5 | network, engine | packages/network/src/network.ts:2611 | 54% of honest adults get no revealed proposal and 64% no meeting in 21 days. Meeting Gini 0.73. No test bounds it. | confirmed | Add exposure gates. Keep the engine's floor order in dailyRun. Add a load term to request search. |
| matching-e2e-7 (also judge-evals-6) | network, judge | packages/network/src/network.ts:1668 | Precision and fairness are computed only on revealed opportunities (20% oracle-good across all started, 36% reported). revealYes and "fulfilled" are inflated. | confirmed | Report precision over every probed opportunity. Count real decisions. Mark fulfilled only after attendance. |
| core-1 (also engine-pipeline-3 short-word part) | core, engine | packages/core/src/guard.ts:202 | Short sensitive facts (gay, HIV+, AA, IVF, sober, bipolar) are never matched by LeakGuard or the engine leak gate. Another member's shareable text can whitelist a private word. | confirmed | Match short facts as whole words. Build vocabulary per member. Report dropped strings. |
| core-2 (also core-m1) | core | packages/core/src/guard.ts:99 | Contact patterns miss spaced emails, spelled digits, handles without a space, unlisted TLDs and all 7-digit local numbers. | confirmed | Normalize separators, scripts and digit words before matching. Keep an append-only evasion corpus. |
| core-3 (also engine-pipeline-3 non-Latin part) | core, engine | packages/core/src/guard.ts:47 | fold() deletes letters outside a small confusables table. Small caps and Armenian evade vocab. Non-Latin private facts compile to nothing. | confirmed | Fold with UTS#39 skeletons and keep \p{L}\p{N}. |
| engine-pipeline-1 (also engine-pipeline-M3) | engine | packages/engine/src/policy.ts:169 | The exploration slice selects judge-, screen- and deep-rejected configurations and shows the "no" verdict's text. deep_insufficient skips its question. | confirmed | Use an allow-list (eligible or below_threshold). Never explain from a non-yes verdict. |
| engine-pipeline-4 | engine | packages/engine/src/config.ts:198 | Risk and home-entry filters miss childcare asks ("watch my 6 year old"), money and drug phrasings. | confirmed | Expand to a curated corpus with digit and abbreviation variants. Add a benign corpus. |
| engine-pipeline-15 (also engine-pipeline-M1) | engine | packages/engine/src/packs/network/generators.ts:214 | Romance-category events produce 4-person romance groups. requireStatedPrefs is enforced only in one generator, so people with no stated orientation get romance proposals. | confirmed | Make romance pairs-only in the engine. Enforce stated prefs in the pair rule. |
| attention-MISSED-1 | network | packages/network/src/plans.ts:81 | planLedger has no repliedAt, so the plan allowance stops for good after the second plan invite, even for members who said yes. | confirmed | Carry repliedAt from inbound replies, or clear the ledger on inbound. |
| judge-evals-1 (also sim-worlds-15) | judge | packages/sim/src/judge/metrics.ts:225 | minorContacts, the blocking minors gate, cannot see probes, plan probes, relays or growth asks to or about minors. | confirmed | Count meta.probe.participants, meta.plan, relayFrom, growth_ask and probe_started logs. |
| judge-evals-2 | judge | packages/sim/src/judge/metrics.ts:242 | Interruption invariants trust meta.proactive, system and reengagement flags set by the system under test. | confirmed | Derive proactive from timing. Add a mislabel detector. |
| judge-evals-7 (also core-17, plugin-prototypes-5) | judge, core, plugin | packages/core/src/runlog.ts:171 | No app field in run logs, core types or the plugin authority. cross_app_leak cannot be computed or enforced. | confirmed | Add app to core types, run logs and NetworkTurnAuthority. Add the cross_app_leak invariant. |
| judge-evals-8 | judge | packages/sim/src/judge/metrics.ts:225 | No invariants for names before reveal, decliner identity or contact details before a swap. | confirmed | Add name_before_reveal, decliner_exposed and contact_before_swap. |
| judge-evals-M1 | network, judge | packages/network/test/network.test.ts:39 | The budget check is graded against the network's own 4/week, not the PRD's 2/week in Normal. | confirmed | Judge owns a per-state budget table copied from the PRD. |
| sim-worlds-1 (also sim-worlds-M5) | sim | packages/sim/src/snapshot.ts:282 | The console snapshot leaks hidden accept/decline for ignored invites and feedback built from hidden enjoyment. | confirmed | Build interactions from inbound replies only. Build feedback from answered requests. |
| sim-worlds-5 | sim, worlds | packages/sim/src/apps/README.md:9 | PRD 40.8 worlds and adversaries are missing: ban evader, bot farm, two-app personas, cross_app_leak, lowest age across apps. | confirmed | Add slop adversaries and two-app personas first. friends and peon worlds are Phase 3-4 (P3 today). |
| platform-1 (also sites-infra-3) | platform | packages/platform/src/accounts.ts:118 | An under-age refusal on a new phone stores nothing, so the same session can retry with age 25 and join. | confirmed | Record a keyed-hash age marker on every refusal. |
| platform-2 | platform | packages/platform/src/store.ts:176 | Delete-everything resets lowest age and person id, laundering age and escaping blocks. | confirmed | Keep the lowest age and block identity on the phone hash. |
| platform-3 | platform | packages/platform/src/api.ts:172 | A new owner of a recycled number logs in and reads, exports and deletes the old owner's data. | confirmed | Check recycling at login. Hold export and delete for review. |
| platform-4 | platform | packages/platform/src/env.ts:5 | Without NODE_ENV=production, the dev OTP console, Turnstile bypass and public dev hash key run. | confirmed | Dev shortcuts need an explicit PLATFORM_ENV=dev or test. |
| platform-5 (also sites-infra-M1) | platform, network/service | packages/network/service/service.ts:350 | The production API is mounted without Turnstile, so OTP sends are open to SMS pumping. No site renders the widget. | confirmed | Require a verifier in production. Ship the widget and token on the sites. |
| platform-7 (also observatory-4, platform-M6) | observatory/db | packages/observatory/db/schema.sql:234 | network_state_console runs as owner. The ntwrk-only console role reads every app's state, minors and safety cases. | confirmed | Use security_invoker views or revoke. Add a catalog golden test. |
| platform-8 | observatory/db | packages/observatory/db/schema.sql:37 | channel_identities is global. One phone can belong to one app's member, and the service reads every app's phones. | confirmed | Add app_id to the key and an RLS policy. |
| platform-9 (also sites-infra-7) | platform, sites | packages/platform/src/consent.ts:33 | STOP defaults to one app and the sites say "STOP ALL". PRD 40.3 says STOP stops every app on the shared line. | confirmed | Default to global STOP. Add "leave <app>". Fix copy on all four sites. |
| platform-10 | platform | packages/platform/src/accounts.ts:121 | Parallel joins run onJoin several times and orphan network members that delete never reaches. | confirmed | Join in one transaction with an advisory lock per (person, app). |
| platform-M1 (also network-service-5, network-service-6) | platform, network/service | packages/network/service/service.ts:301 | Inbound STOP writes only network.members, web STOP writes only the platform ledger, and the send path reads neither consistently. | confirmed | One consent ledger read on every send. Record STOP before running the unit. |
| plugin-prototypes-12 (also platform-29, network-consent-M3) | messaging-blooio, platform, network | packages/blooio/src/ledger.ts:31 | Only exact keywords opt out. "please stop texting me" and Spanish opt-outs are never honored. No per-app leave. | confirmed | Add a reasonable-means classifier with a confirm step. |
| observatory-1 | observatory | packages/observatory/web/map.ts:113 | Stored XSS: member name and area go into Leaflet tooltips as HTML. | confirmed | Build tooltip content as DOM nodes. Add a CSP. |
| observatory-6 (also observatory-M1) | observatory | packages/observatory/src/server.ts:388 | WebSockets are authorized once. After a mode switch an engineer socket receives real minors' data. Expired or revoked grants keep streaming. | confirmed | Store identity on the socket. Re-check on mode switch, expiry and grant reload. Shape deltas per role. |
| plugin-prototypes-1 | plugin-network | packages/plugin-network/src/actions/set-state.ts:118 | Planner SET_STATE runs no authz and stays registered in the Cloud default mode. Past dates are stored. | confirmed | Remove it in structured mode or run authorizeSetState in its handler. |
| plugin-prototypes-21 | connector-mcp | prototypes/connector-mcp/src/server.ts:186 | The leak guard blocks on other members' private facts. Members can probe them, and one member can break another's connector. | confirmed | Scope the forbidden list to counterparts. Redact echoed input instead of failing. |
| plugin-prototypes-22 | connector-mcp | prototypes/connector-mcp/src/fake-network.ts:406 | "I'm 15" from an adult account is not recorded. "I'm 12" declines one request but does not suspend or escalate. | confirmed | Lower the effective age on any statement. Suspend and escalate under 13. |
| plugin-prototypes-26 (also sites-infra-19) | connector-mcp, sites | prototypes/connector-mcp/SKILL.md:1 | Only one SKILL.md exists, for ntwrk, with no sign-up, intent, age, consent or STOP content. ConnectorPrincipal has no app. | confirmed | One SKILL.md per published site, same backend URL, linted against the site's terms. |
| sites-infra-1 | sites | sites/shared/api.ts:56 | Settings "Stop messages" and "Log out" always fail with 415. Logout shows success while the session stays valid. | confirmed | Send JSON content-type on every POST. Show logout only after the server confirms. |
| sites-infra-4 | scripts | scripts/wrangler.sh:17 | The deploy guard is bypassed by any flag with a value before the command, and it misses many mutating verbs. | confirmed | Use an allowlist of read-only commands. Parse flags with values. |
| sites-infra-5 | ci | .github/workflows/ci.yml:44 | CI does not test or typecheck sites or plugin-network, and every Postgres suite skips silently. | confirmed | Add those steps. Fail when REQUIRE_PG=1 and Postgres is missing. |
| sites-infra-6 | root | bun.lock:1 | bun.lock lacks packages/platform, so frozen install fails once the branch is committed. | confirmed | Regenerate bun.lock in the same commit. |
| sites-infra-9 | sites, platform | sites/buddies.nyc/wrangler.toml:11 | buddies is not renamed to friends.help, and peon and buddies have production custom-domain configs although they are local-only. | confirmed (resolved: renamed to friends.help, AppId `friends`, migration 0007) | Rename everywhere. Remove production routes. Deploy allowlist is ntwrk and slop. |
| sites-infra-10 | sites | sites/sites.ts:40 | The build drops every non-HTML file, so _headers, SKILL.md and robots.txt can never ship. | confirmed | Copy public/ passthrough files into dist. |
| sites-infra-13 (also sites-infra-M3, platform-31, platform-M3) | sites, platform | sites/ntwrk.love/wrangler.toml:6 | /api/* is not routed on any site. The API runs only as a Bun process. No deploy workflow exists. Deploying ntwrk now replaces the working 10DLC page with broken forms. | confirmed | Choose the API host. Route /api through one backend. Add a gated deploy workflow with a smoke test. |
| sites-infra-14 | sites | sites/slop.date/public/terms.html:15 | slop, peon and buddies legal pages say "Draft. Not yet in effect." | confirmed | Block any production build that contains "Draft". |

### P2

| ID | Package | File:line | Title | Verdict | Fix direction |
|---|---|---|---|---|---|
| core-4 (also core-m5, judge-evals-5) | judge, core | packages/sim/src/judge/policy.ts:49 | The judge's isMinor treats undefined and NaN ages as adult. Explicit "I'm 16" notes are missed. judgePolicy has no production caller. | confirmed | Import core's fail-closed predicate. Fix the "production" header. |
| core-5 | core | packages/core/src/policy.ts:13 | validAge accepts 150 and 1e9. Member.age is required, so loaders cast undefined. No effectiveAge helper. | confirmed | Cap at 120. Make age optional. Export effectiveAge. |
| core-7 | core | packages/core/src/guard.ts:100 | The email regex is quadratic and check() has no length cap. | confirmed | Rewrite the regex. Return too_long above a cap. |
| core-8 | core | packages/core/src/chatJson.ts:40 | tryChatJson throws when hooks throw and discards a paid success. | confirmed | Wrap hooks. Never reject. |
| core-9 | core | packages/core/src/llm.ts:196 | parseJson takes first bracket to last brace and can return the wrong value. | confirmed | Extract the first balanced value that parses. Prefer fenced JSON. |
| core-10 | core | packages/core/src/llm.ts:72 | Dated model ids cost 0. Regrow retries are invisible. No shared budget. | confirmed | Normalize model ids. Add a budget that stops all HTTP attempts. |
| core-11 | core | packages/core/src/llm.ts:130 | No total deadline or caller abort. One chatJson can take about 12 minutes. | confirmed | Add deadlineMs and signal. |
| core-12 | core | packages/core/src/llm.ts:198 | Model output and prompts reach errors and logs. Fallback to a second provider is silent. | confirmed | Errors carry lengths and codes only. Fallback opt-in per call. |
| core-13 | core | packages/core/src/guard.ts:207 | Stopword 4-grams and loose fuzzy facts block benign messages. The rate grows with facts. | confirmed | Drop grams with fewer than 2 content words. Gate on a measured FP rate. |
| core-14 | core | packages/core/src/guard.ts:314 | The guard is per message, so split numbers and facts pass. | confirmed | Add checkThread over recent messages to the same recipient. |
| core-15 | core | packages/core/src/guard.ts:331 | privateVocab misses inflections, splits and symbol leet. | confirmed | Stem and normalize separators and symbols. |
| core-16 (also judge-evals-23) | core, judge | packages/sim/src/judge/llmJudges.ts:56 | Untrusted text is fenced with """ that members can close. | plausible | Add fenceUntrusted with a nonce delimiter. |
| core-m2 | network | packages/network/src/network.ts:~3185 | The network guard cache is keyed by facet ids only, so edited values use a stale guard. | plausible | Key the cache on ids and values. |
| engine-pipeline-5 | engine | packages/engine/src/tick.ts:43 | Per-city ticks emit the same proposal id for cross-city pairs and double-spend budgets. Latent: production runs NYC only. | confirmed | Put the city in the id. Share budgets across markets. |
| engine-pipeline-6 | engine | packages/engine/src/scoring.ts:190 | Exploration lowers every bar to 0.15, including Quiet members and romance. | confirmed | Respect Quiet and lane bars. Make exploration per member. |
| engine-pipeline-7 | engine | packages/engine/src/engine.ts:112 | The pass-2 judge promotes below-threshold candidates. Docs say it can only remove. | confirmed | Either cap the lift or stop promotion. Fix the docs. |
| engine-pipeline-8 | engine | packages/engine/src/engine.ts:113 | Only the top 10 pairs are judged. Rejecting them fills slots with unjudged worse candidates. | confirmed | Report coverage. Judge after selection or gate unjudged picks. |
| engine-pipeline-10 | engine | packages/engine/src/filters.ts:188 | Send-time re-check ignores withdrawn romance consent and higher match ages. | confirmed | Pass the lane. Check opt-ins and effective age. |
| engine-pipeline-12 | engine | packages/engine/src/packs/network/taxonomy.ts:17 | Complementarity uses the sim oracle's own taxonomy and penalizes off-taxonomy wants. | confirmed | Make it neutral off-taxonomy. Evaluate on a held-out vocabulary. |
| engine-pipeline-13 | engine | packages/engine/src/embed.ts:13 | The tokenizer is ASCII-only, so non-Latin profiles get zero vectors and are never retrieved. | confirmed | Use \p{L}\p{N} with NFKC and diacritic folding. |
| engine-pipeline-17 (also engine-pipeline-M2) | engine, network/service | packages/network/service/snapshot.ts:46 | Output and runId depend on row order, and the snapshot loader has no ORDER BY. | confirmed | Sort inputs by id before hashing. Add ORDER BY. |
| engine-attention-plans-1 | engine | packages/engine/src/attention.ts:137 | The two-unanswered pause is permanent. Late replies and resume never clear it. | confirmed | Clear on any later inbound or an explicit resume marker. |
| engine-attention-plans-2 | engine, network | packages/engine/src/plans.ts:331 | Plan alternates are not checked against each other. Blocked pairs are both probed and can break quorum (with attention-MISSED-2). | confirmed | Check every pair in invited and alternates. Drop only the later joiner. |
| engine-attention-plans-4 | engine | packages/engine/src/plans.ts:617 | Crew sessions drift one hour across DST. | confirmed | Advance in local wall-clock time. |
| engine-attention-plans-6 | engine | packages/engine/src/attention.ts:266 | Minors can be messaged at 3am on weekends if their own quiet hours are off. | confirmed | Enforce a minors overnight floor every day. |
| engine-attention-plans-7 | engine, network | packages/engine/src/packs/network/index.ts:88 | The send-time romance gate fails open when categoriesOptIn is absent, and the runtime view never sets it. | confirmed | Default to no romance. Pass categoriesOptIn in view(). |
| engine-attention-plans-8 | engine | packages/engine/src/attention.ts:534 | reengagement ignores the Blooio streak and the caller's pack. | confirmed | Check the streak. Pass the pack. |
| engine-attention-plans-10 | engine, network | packages/engine/src/plans.ts:541 | The "smaller" fallback books two group yes-sayers as a pair with no fresh 1:1 consent. | confirmed | Turn it into a fresh partner probe. |
| engine-attention-plans-12 | engine | packages/engine/src/plans.ts:307 | One plan per (slot, activity) with an id tie-break, so the same low-id members win every plan. | confirmed | Generate disjoint k-best groups. Use a seeded tie-break. |
| engine-attention-plans-13 | engine | packages/engine/src/plans.ts:289 | Event-anchored plans ignore event category, age floor and capacity. | confirmed | Skip romance events. Add ageMin and capacity checks. |
| engine-attention-plans-14 | engine | packages/engine/experiments/plansHarness.ts:86 | Plan experiments grade the planner with its own objective and ignore adversarial exposure. | plausible | Add an oracle-independence ablation and adversary exposure metrics. |
| engine-attention-plans-15 | network | packages/network/src/network.ts:3094 | Runtime view treats unknown age as 18 and uses New York time for everyone. | confirmed | Unknown age is minor. Use the member's zone. |
| judge-evals-3 | judge | packages/sim/src/judge/llmJudges.ts:76 | LLM judges accept any JSON shape. String booleans and a missing leaks key read as pass. | confirmed | Validate shape and retry. Fail closed. |
| judge-evals-4 | evals, engine | packages/evals/src/runPasses.ts:257 | An all-failed pipeline counts as "yes" with prob 1 and 0 failures. | confirmed | Report stage failures. Never say yes with no successful pass. |
| judge-evals-9 | judge | packages/sim/src/judge/metrics.ts:128 | Minor name detection is case-sensitive and full-name only. Messages to minors naming adults are not counted. | confirmed | Case-insensitive, first-name and possessive matching. Count connection offers to minors. |
| judge-evals-10 | judge | packages/sim/src/judge/metrics.ts:259 | The canary scan misses system, failed and suppressed sends, case variants and logs. Self-echo counts as a leak. | confirmed | Normalize. Scan attempts and logs. Report selfEcho separately. |
| judge-evals-11 | judge | packages/sim/src/judge/metrics.ts:237 | START cannot be logged, and a same-tick send after STOP passes. | confirmed | Add opt_in records. Use <= consistently. |
| judge-evals-12 | judge | packages/sim/src/judge/metrics.ts:72 | Quiet hours use home city only. Any inbound resets the unanswered streak. The judge ignores participation state. | confirmed | Use current location, reply-to-proactive resets and per-state budgets. |
| judge-evals-13 | judge | packages/sim/src/judge/metrics.ts:261 | Opt-out wording is checked only on the first proactive message, and only as style. | confirmed | Make pause_path_missing an invariant on every proactive message. |
| judge-evals-14 | judge | packages/sim/src/judge/metrics.ts:215 | Romance checks ignore category. Blocks are not checked on alternates, meetings or relays. Review gating is off without logs. | confirmed | Check by category, everywhere, and fail closed when gating is configured. |
| judge-evals-16 | judge | packages/sim/src/judge/calibration.ts:2 | Calibration is pooled, has no policy items and never runs in CI, despite the comment. | confirmed | Per-judge floors. Offline cassette replay. |
| judge-evals-17 | evals | packages/evals/src/judgeDataset.ts:233 | The production leak guard is never scored against the gold privacy items, and the rules baseline is meaningless on shareability. | confirmed | Score checkMemberFacing on gold items. Add items for new risk classes. |
| judge-evals-18 | evals | packages/evals/src/recDataset.ts:96 | Recommender labels come from the sim's own utility. Hidden-risk strata are tiny. Thresholds are copied. | confirmed | Ablate the oracle. Raise stratum sizes. Export shared thresholds. |
| judge-evals-M2 | network | packages/network/src/network.ts:~2643 | Engine ask texts say they use the budget but are sent proactive:false. | confirmed | Decide with the founder. Make code, comment and PRD agree. |
| judge-evals-M3 | judge | packages/sim/src/judge/metrics.ts | The judge ignores the network's own minor_signal and age logs. | confirmed | Treat a minor_signal or unresolved age_unknown as minor. |
| sim-worlds-4 | worlds | packages/sim/src/apps/slop/persona.ts:313 | Occupation "student" identifies every age-lying minor with zero false positives. | confirmed | Give adults "student" at a realistic rate. |
| sim-worlds-6 | worlds | packages/sim/src/apps/slop/snapshot.ts:75 | LA is cast into core City, so time zones are undefined and depend on the host. | confirmed | Add la to every tz table. Throw on unknown city. |
| sim-worlds-7 | worlds | packages/sim/src/apps/slop/oracle.ts:203 | Backout at the booked reveal is capped at 12%, the assumption the reveal design rests on. | confirmed | Sweep backout. Calibrate or cite. |
| sim-worlds-8 | sim | packages/sim/src/plans.ts:17 | The sim imports the engine and copies its plan and availability models. | confirmed | Remove runtime engine imports. Use an alternative availability model. |
| sim-worlds-9 | sim | packages/sim/src/generator.ts:315 | The lying minor never seeks romance, so the most dangerous case is never exercised. | confirmed | Add a romance-seeking lying minor scenario. |
| sim-worlds-10 | sim | packages/sim/src/scenario.ts:200 | Leak checks match only the exact canary token, so paraphrased leaks pass. | confirmed | Add a fact-level n-gram check. |
| sim-worlds-11 (also matching-e2e-12) | sim | packages/sim/src/world.ts:156 | On main, the oracle is called without category, so category-only romance proposals are not flagged unsafe. | confirmed | Pass category (done on console, untested). |
| sim-worlds-12 | worlds, sim | packages/sim/src/apps/slop/world.ts:111 | Harassment after a match is barely modelled. The slop harness neither enforces nor measures holds and blocks. | confirmed | Add held and blocked invariants and a post-match harassment scenario. |
| sim-worlds-13 | sim | packages/sim/src/agent/policy.ts:98 | Personas churn only from volume. Bad or unsafe intros cost nothing. | confirmed | Add quality-driven trust and churn. |
| sim-worlds-14 | sim | packages/sim/src/snapshot.ts:367 | The default snapshot has perfect onboarding: hidden boundaries and romance prefs are known. | confirmed | Default to richness tiers. Gate on richness-on numbers. |
| sim-worlds-16 | worlds | packages/sim/src/apps/slop/world.ts:82 | slop has no arrivals, no verification step and duplicate names. Fairness ignores desirability. | confirmed | Add Poisson arrivals, unique names, desirability deciles. |
| capital-1 | capital | packages/capital/src/ledger.ts:110 | An invitee's own say-so earns the voucher the vouch credit, so sybil vouching pays and is never flagged. | confirmed | Require counterpart or verified confirmation. |
| capital-3 | capital, network | packages/capital/src/ledger.ts:80 | NaN t disables time order, Infinity bricks the ledger, NaN amounts poison balances, and capitalWiring swallows the errors. | confirmed | Validate atomically. Log and fail the harness on rejects. |
| capital-4 | capital | packages/capital/src/ledger.ts:87 | Age eligibility is frozen at first join. | confirmed | Add an age_updated event. |
| capital-5 | capital | packages/capital/src/ledger.ts:58 | The ledger is in memory with no persistence, and the service does not wire it. | confirmed | Persist events and replay. |
| capital-7 | capital | packages/capital/src/ledger.ts:190 | Giving feedback lowers total NC, and feedback survives fraud clawback. | confirmed | Separate the feedback category. Reverse dependent feedback. |
| capital-8 | capital | packages/capital/src/ledger.ts:297 | Rotating fillers cancel pair decay and evade staged_meetup detection. | confirmed | Weight decay on the recurring core. Detect core pairs. |
| capital-11 | capital | packages/capital/src/detect.ts:64 | Detection misses rings of 8+ and organizer-origin staging, and flags honest repeat friends. | confirmed | Widen ring and origin rules. Model honest friends in the sim. |
| capital-12 | capital, network | packages/capital/experiments/world.ts:397 | The sim reviewer uses persona truth. The real reviewer confirms the whole flag set. | confirmed | Whole-set sim reviewer. Per-member decisions in the product. |
| capital-13 | capital | packages/capital/experiments/run.ts:203 | The fairness gate passes on a point estimate whose CI is far past the bound, with 2 seeds allowed. | confirmed | Gate on the CI lower bound with at least 32 seeds. |
| network-consent-13 | network | packages/network/src/network.ts:898 | Block by name is a membership oracle and fires on "report back when Grace is free". | confirmed | Same reply either way. Require prior contact. Tighten parsing. |
| network-consent-14 | network | packages/network/src/trust.ts:85 | Blocking several harassers marks the victim as a block abuser and discredits their reports. | confirmed | Do not count blocks of prior counterparts. Reports are not blocks. |
| network-consent-15 | network | packages/network/src/network.ts:1484 | Two-letter names leak into "no names yet" probes. | confirmed | Check all name tokens as whole words in the send guard. |
| network-consent-16 | network | packages/network/src/network.ts:660 | forget() leaves the declined child's id and name in queued proposals and opportunity maps. | confirmed | Scrub every structure. Property-test the export. |
| network-consent-17 | network | packages/network/src/network.ts:1804 | One "never showed" claim penalizes a silent partner. "didn't show me her art" counts. | confirmed | Require corroboration. Fix the regex. |
| network-consent-18 | network | packages/network/src/network.ts:1749 | A block after booking cancels silently. The blocked member may go alone. | confirmed | Send a neutral cancellation. Cancel the meeting record. |
| network-consent-19 | network | packages/network/src/network.ts:506 | On 18+ apps "I'm 16" keeps the member as a teen with ntwrk teen copy. | confirmed | Remove from matching and open staff review. |
| network-consent-21 | network | packages/network/src/network.ts:1365 | Opportunities are never pruned and the whole state is reserialized on every unit. | plausible | Archive closed opportunities. |
| network-consent-22 | network | packages/network/test/units.test.ts:141 | Consent and abuse parsers are graded on the simulator's own phrasing. | confirmed | Add held-out human corpora. |
| network-consent-23 | network | packages/network/src/classify.ts:43 | "My friend X" anywhere spends an invite and drops the request. | confirmed | Require explicit invite intent. |
| network-service-7 | network/service | packages/network/service/service.ts:247 | A delivery error after commit loses sends from memory. The webhook answers 500 and the retry is a duplicate. | confirmed | Redeliver from the DB each tick. Answer 200 after commit. |
| network-service-8 | network/service | packages/network/src/store.ts:218 | The advisory lock has no fencing, so a lost lock lets two instances overwrite each other. | confirmed | Compare-and-set save on a generation column. |
| network-service-9 | network/service | packages/network/service/service.ts:217 | Message ids come from a mutable seq, so a regressed state reuses ids and drops rows while still sending. | confirmed | Fail on id collision or use UUIDs. |
| network-service-11 | network/service | packages/network/service/service.ts:195 | Refused, dry-run and suppressed sends count as delivered. Parked leak reviews cannot be resolved. | plausible | Report real status back. Add a staff route for parked items. |
| network-service-12 | network/service | packages/network/service/channel.ts:105 | Line safety, consent and rate counters are in memory per process. Statuses after restart are dropped. | confirmed | Persist them in Postgres. |
| network-service-M2 | network/service | packages/network/service/service.ts | Shared-line routing sends a member's reply to whichever app's domain appears in the text, or the last app that wrote. | confirmed | Route by open item first. Match app keywords only as whole messages. |
| platform-6 | platform | packages/platform/src/phone.ts:5 | "+1 US and Canada" accepts Caribbean premium SMS-pumping destinations. | confirmed | Allowlist US and Canadian area codes. |
| platform-11 (also sites-infra-M2) | platform | packages/platform/src/api.ts:50 | Client IP comes from spoofable headers, so the per-IP OTP limit is bypassable. | confirmed | Configure the trusted proxy. Never key on an empty header. |
| platform-12 | platform | packages/platform/src/otp.ts:105 | OTP limits are per app and count refused hits, so a victim gets 12 SMS an hour and can be locked out. | confirmed | Cross-app per-phone limit and daily cap. Refused hits do not extend locks. |
| platform-13 | platform | packages/platform/src/api.ts:53 | One malformed cookie on the domain makes every API call return 500. | confirmed | Guard decodeURIComponent. |
| platform-14 | observatory/db | packages/observatory/db/migrations/0003_platform.sql:262 | platform_service can write staff_roles, settings and apps. | confirmed | Least-privilege grants. |
| platform-15 | platform | packages/platform/src/store.ts:190 | Delete-everything erases the STOP records. | confirmed | Keep hashed opt-out proof and check suppression on send. |
| platform-19 (also sites-infra-8) | platform, sites | packages/platform/src/apps.ts:7 | App ids, domains and ages drift from PRD 40 (18+ join vs 13+, buddies vs friends). platform.apps rows are never read. | confirmed | Golden registry from PRD 40. Read policy from the DB. Founder and counsel decide the age. |
| platform-20 | platform | packages/platform/src/sessions.ts:30 | Sessions have no absolute lifetime and rotation logs out parallel requests. Delete-all has no step-up. | confirmed | Absolute lifetime, grace window, fresh OTP for delete. |
| platform-28 (also sites-infra-M4, sites-infra-25 header part) | platform | packages/platform/src/apps.ts:88 | The production host map accepts localhost hosts and origins. No body size cap. | confirmed | Per-environment host map. 16 KB body cap. |
| observatory-3 | observatory/db | packages/observatory/db/migrations/0005_console_apps.sql:42 | The cross-app console role can read every app's message bodies, bios and minors' ages. | confirmed | Column grants or a counts-only view. |
| observatory-7 | observatory | packages/observatory/src/scrub.ts:20 | The PII scrub misses spelled phones, bare handles, SSNs and cards. It has no tests. | confirmed | Golden and property tests. Shared normalization with core. |
| observatory-10 | observatory, network/service | packages/observatory/src/sources/service.ts:46 | The reviewer of record is the service token, not the person. secondsSpent has no upper bound. | confirmed | Honor the staff header from the console token. Clamp time. |
| observatory-18 | observatory | packages/observatory/src/sources/real.ts:243 | /api/state sends every member's age, minor flag and trust to every role, including analysts. | confirmed | Shape state per role. |
| plugin-prototypes-2 | plugin-network | packages/plugin-network/src/routing/authz.ts:46 | The evidence check does not bind the proposed state. "hi" authorizes "paused". | confirmed | Require a state cue in the evidence. Refuse negations. |
| plugin-prototypes-3 | plugin-network | packages/plugin-network/src/routing/dates.ts:25 | Dates resolve in UTC, so US evening messages resolve a month late. | confirmed | Use the member's IANA zone. |
| plugin-prototypes-4 (also plugin-prototypes-M3) | plugin-network, cloud | packages/plugin-network/src/actions/set-state.ts:45 | Idempotency keys are not member-scoped and can be client-chosen. Cloud replays another member's event. | confirmed | Scope keys by member and app. Conflict on a different payload. |
| plugin-prototypes-6 | plugin-network | packages/plugin-network/src/routing/authz.ts:35 | Quoted-text detection misses single quotes, "X said:" and forwarded blocks. | confirmed | Widen quote detection. |
| plugin-prototypes-7 | plugin-network | packages/plugin-network/src/routing/dates.ts:20 | The date parser reads "may" as May and overrides the model. Past stated dates skip the past check. | confirmed | Handle homographs. Re-check after override. |
| plugin-prototypes-10 | plugin-network, core | packages/plugin-network/src/types.ts:9 | State vocabulary differs across plugin, core and connector. | confirmed | One enum with a mapping table. |
| plugin-prototypes-13 | messaging-blooio | packages/blooio/src/outbound-queue.ts:301 | Group sends check consent on the chat id, not the participants. | confirmed | Require a participant resolver. Fail closed without it. |
| plugin-prototypes-14 | messaging-blooio | packages/blooio/src/outbound-queue.ts:48 | kind "reply" is caller-asserted and skips quiet hours and proactive consent. | confirmed | Require inReplyTo a recent inbound. |
| plugin-prototypes-15 | messaging-blooio | packages/blooio/src/outbound-queue.ts:347 | reply_only lines still send proactive messages. Safety is ignored with no from. | confirmed | Hold all agent-initiated sends on reply_only. Fail closed with no line. |
| plugin-prototypes-16 | messaging-blooio | packages/blooio/src/outbound-queue.ts:477 | A "blocked" result falls back to SMS, evading line protections. | confirmed | No fallback on policy blocks. Per-person caps across channels. |
| plugin-prototypes-17 | messaging-blooio | packages/blooio/src/consent-store.ts:37 | A corrupt middle line forgets a STOP. Appends are not fsynced. | confirmed | Fail closed on corruption. fsync. |
| plugin-prototypes-24 | connector-mcp | prototypes/connector-mcp/src/config.ts:83 | Any claude.ai path resolves as a verified client. | confirmed | Pin the CIMD path. |
| plugin-prototypes-M1 | plugin-network, ci | packages/plugin-network/test/runtime-construction.test.ts | The plugin suite does not load on a fresh main checkout (missing eliza deps). | confirmed | Install eliza deps in CI. Assert the runtime tests ran. |
| plugin-prototypes-M2 | plugin-network | packages/plugin-network/src/routing/structured-field.ts | An authorized change with no message.id falls through to the unguarded planner. | confirmed | Fail closed with a non-applied reply. |
| sites-infra-11 (also platform-16) | sites, platform | sites/shared/join.ts:105 | The consent ledger stores whatever wording the client sends. | confirmed | Accept only the canonical text and store its version. |
| sites-infra-12 | sites | sites/slop.date/wrangler.toml:20 | No CSP, HSTS, frame-ancestors or nosniff on any site. | confirmed | Ship _headers with a strict policy. |
| sites-infra-15 | sites | sites/test/sites.test.ts:66 | The sites test forbids naming other apps, but the founder wants ntwrk to link them and say "powered by The Network". | confirmed | Test the privacy rule (no per-number disclosure) instead. |
| sites-infra-16 | sites | sites/ntwrk.love/public/index.html:20 | SMS terms omit keyword opt-in and the line number. The ntwrk invite starts with an unsolicited text. | plausible | Document every opt-in path. Invitee opts in first. |
| sites-infra-17 | sites | sites/shared/api.ts:48 | Client error mapping misses many platform codes. A 500 shows "can't reach our server". | confirmed | Export a typed error union and map all of it. |
| sites-infra-18 | supply chain | scripts/wrangler.sh:67 | wrangler is fetched unpinned. Actions are pinned by tag. @types/bun is "latest". .wrangler/ is not ignored. | confirmed | Pin everything. |
| sites-infra-20 | sites | sites/test/sites.test.ts:1 | No behavioural tests of join and settings. Destructive actions run without confirmation if a dialog is missing. | confirmed | DOM tests. Fail closed without the dialog. |
| sites-infra-22 | sites | sites/ntwrk.love/public/privacy.html:1 | Privacy policies make operational promises no test verifies. | plausible | Add a policy-claims test suite. |
| matching-e2e-6 | network, engine | packages/network/src/network.ts:2786 | Exposure debt is never persisted, and unrevealed probes count as exposure. | confirmed | Round-trip debt in state. Count revealed only. |
| matching-e2e-8 | sim | packages/sim/src/oracle.ts:173 | Oracle decisions are keyed by proposal id, so re-asking is a fresh coin flip and nagging pays. | confirmed | Key by participants, category and week. Add decline memory. |
| matching-e2e-9 | sim, network | packages/sim/src/oracle.ts:178 | Travel and time are not scored. Time-aware runs cut meetings by 40%. Queens is underserved. | confirmed | Add travel and time to showProb. Run launch arms time-aware. |
| matching-e2e-10 | network | packages/network/src/network.ts:2737 | Busy parents, introverts and nonbinary members are rarely matched. Cause not isolated. | plausible | Stratified parity gates on larger populations. |
| matching-e2e-11 | network, engine | packages/network/src/network.ts:2786 | An early meeting predicts later meetings. Most members with none stay at zero. | plausible | Second-chance gate. Cap warm-path share. |
| matching-e2e-14 | engine | packages/engine/experiments/diversity.ts:1 | Engine fairness research runs the push path and does not transfer to the shipped Network. | confirmed | Measure every lever through ConsentNetwork. |

### P3

| ID | Package | File:line | Title | Verdict | Fix direction |
|---|---|---|---|---|---|
| core-6 | core | packages/core/src/guard.ts:154 | Leak labels are unsalted 32-bit FNV, reversible with a wordlist. | confirmed | Keyed labels. |
| core-18 | core | packages/core/src/llm.ts:161 | 408 not retried, non-JSON 200 unobserved, Retry-After capped, truncated replies returned. | confirmed | Fix each case. |
| core-19 | core | packages/core/src/guard.ts:105 | Contact patterns flag order numbers, year lists and venue addresses. | confirmed | Benign corpus. Venue allow list. |
| core-20 | core | packages/core/src/guard.ts:338 | exact matching ignores word boundaries and reformatted values. | confirmed | Normalize by type. |
| core-21 | core | packages/core/src/guard.ts:269 | publicPhrases can cut away the sensitive part of a fact on the forbidden path. | confirmed | Fall back to whole-fact matching. |
| core-22 | core | packages/core/src/clock.ts:7 | SimClock accepts NaN. No LLM seed. Wall time in llm.ts. | confirmed | Reject non-finite. Inject seed and clock. |
| core-23 | core | packages/core/src/guard.ts:45 | Bidi controls are stripped but never flagged. | confirmed | Return format:bidi. |
| core-24 | core | packages/core/src/policy.test.ts:5 | Thin safety test coverage in core. | confirmed | Add the corpora and property tests. |
| core-m3 | core | packages/core/src/guard.ts | Short canaries and empty-folding strings are dropped silently. | confirmed | Expose dropped inputs. |
| core-m4 | core | packages/core/src/guard.ts | Check cost grows linearly with total facts. | confirmed | Index-based lookup. |
| engine-pipeline-2 | engine | packages/engine/src/world.ts:96 | Duplicate member ids decide age by row order. Not reachable in production today. | confirmed | Reject duplicate ids. |
| engine-pipeline-9 | engine | packages/engine/src/packs/network/generators.ts:368 | help_request alternates are not checked against participants. Opportunity helpers fail open. | confirmed | Pairwise checks. Require eligible. |
| engine-pipeline-11 | engine | packages/engine/src/packs/network/generators.ts:56 | Generators and selection are quadratic. | confirmed | Caps and indexes. |
| engine-pipeline-14 | engine | packages/engine/src/pack.ts:332 | validatePack never runs at runtime. Pack id is missing from runId and cache keys. | plausible | Validate in runEngine. Add pack id. |
| engine-pipeline-16 | engine | packages/engine/src/filters.ts:76 | Pack pair rules get undefined members before the unknown check. | confirmed | Check unknown first. |
| engine-pipeline-18 | engine | packages/engine/src/packs/network/ontology.ts:25 | Romance pref parsing fails open on bad ages, is case-sensitive, truncates values. | confirmed | Strict parsing. |
| engine-pipeline-19 | engine | packages/engine/src/judgeCommon.ts:71 | Judge cache key omits via, timing and config. | confirmed | Add them. |
| engine-pipeline-20 | engine | packages/engine/src/scoring.ts:147 | Missing evidence gets higher confidence than real evidence. | confirmed | Lower the prior. |
| engine-pipeline-21 | engine | packages/engine/src/explain.ts:70 | Exploration picks are not labelled. Template text bypasses the leak gate. | confirmed | Label. Gate all text. |
| engine-pipeline-22 | engine | packages/engine/src/tick.ts:43 | Tick id ignores config. Lock is in-process. | confirmed | Add config hash. |
| engine-pipeline-23 | engine | packages/engine/src/judgeCommon.ts:140 | prob(1.5) becomes 0.015. | confirmed | Reject ambiguous values. |
| engine-pipeline-24 | engine | packages/engine/src/judgeScreen.ts:62 | Pass 1 shows expired intents and uses raw ids. | confirmed | Live intents, canonical ids. |
| engine-pipeline-25 | engine | packages/engine/src/pack.ts:17 | Docs and code drift on judge, purity and cache key. | confirmed | One executable check per claim. |
| engine-attention-plans-3 | engine | packages/engine/src/plans.ts:616 | Crew sessions have no pair or host check in the engine. Runtime mitigates. | confirmed | Add pair and host checks. |
| engine-attention-plans-5 | engine | packages/engine/src/attention.ts:115 | Quiet minors get a looser cap than Quiet adults. | confirmed | Take the stricter cap. |
| engine-attention-plans-9 | engine | packages/engine/src/plans.ts:113 | The plan allowance gives Quiet members weekly invites and accepts non-plan items. | confirmed | Respect the state rate. Plan items only. |
| engine-attention-plans-11 | engine | packages/engine/src/plans.ts:491 | A refused late yes is stored as yes. | confirmed | Store as "late". |
| engine-attention-plans-16 | engine | packages/engine/src/attention.ts:299 | whenPhrase says "later today" for tomorrow. | confirmed | Use the local calendar. |
| engine-attention-plans-17 | engine | packages/engine/src/outreach.ts:86 | fromLocal maps spring-forward gaps an hour early. | confirmed | Map to the first instant after the gap. |
| engine-attention-plans-18 | engine | packages/engine/src/outreach.ts:159 | OutreachController is dead and disagrees with attention. | confirmed | Remove it. |
| engine-attention-plans-19 | engine | packages/engine/src/attention.ts:369 | digestText says "Three things" for any count. | confirmed | Clamp or throw. |
| engine-attention-plans-20 | engine | packages/engine/src/attention.ts:409 | Quiet hours zero meeting availability. | plausible | Separate meeting hours. |
| engine-attention-plans-21 | engine | packages/engine/src/plans.ts:246 | Venues closing after midnight are never open. | confirmed | Wrap hours. |
| engine-attention-plans-22 | engine | packages/engine/src/attention.ts:604 | Attention metric denominators ignore the window. | confirmed | Clip spans. |
| engine-attention-plans-23 | engine | packages/engine/src/attention.ts:326 | Send-time learning reinforces its own default. | plausible | Add exploration sends. |
| engine-attention-plans-24 | engine | packages/engine/src/plans.ts:514 | Partner backfill swaps the partner silently. | confirmed | Re-confirm the first member. |
| attention-MISSED-2 | network | packages/network/src/network.ts:~2227 | bookPlan drops both members of a blocked pair and can collapse quorum. | confirmed | Drop only the later joiner. |
| judge-evals-15 | judge | packages/sim/src/judge/rules.ts:419 | checkMessage misses impersonation variants and contacts, flags venues. | confirmed | Expand tables. |
| judge-evals-19 | evals | packages/evals/src/runPasses.ts:89 | The test split was used for selection. | plausible | Seal a new split. |
| judge-evals-20 | sim | packages/sim/src/cli.ts:125 | The CLI audit samples only proactive messages and 40 facts. Errors become n/a. | confirmed | Wider sampling. Exit non-zero on error. |
| judge-evals-21 | judge, docs | docs/test-plan.md:273 (git history, 16cde70) | Test plan invariants and code drift. | plausible | Coverage map test. |
| judge-evals-22 | evals, judge | packages/evals/test/datasetV2.test.ts:45 | Vacuous tests and untested metric rules. | confirmed | Replace and add tests. |
| judge-evals-24 | evals | packages/evals/src/judgeV2.ts:454 | Spend guard can overshoot. Calibration ignores failures. | plausible | Bound and report coverage. |
| judge-evals-25 | judge | packages/sim/src/judge/metrics.ts:231 | Metrics scale as messages x minors x canaries. Class-year regex rots. | plausible | Combined matcher. Clock-relative year. |
| judge-evals-M4 | sim | packages/sim/src/world.ts:146 | Duplicate sends are dropped before the judge sees them. | confirmed | Log duplicates. |
| judge-evals-M5 | judge | packages/sim/src/judge/metrics.ts:199 | Unsent and self-addressed explanations count as canary leaks. | confirmed | Separate selfEcho and stored leaks. |
| sim-worlds-17 | sim | packages/sim/src/generator.ts:356 | Minors are wired as exes and coworkers of adults. | confirmed | Age-plausible links only. |
| sim-worlds-18 | worlds | packages/sim/src/apps/slop/world.ts:68 | slop slot times are UTC. | confirmed | Local times. |
| sim-worlds-19 | sim | packages/sim/src/agent/policy.ts:63 | Travelers use home-city time. | confirmed | Use trip city. |
| sim-worlds-20 | sim | packages/sim/src/oracle.ts:317 | Precision can be gamed by re-introducing friends. Ex flags are unknowable. | plausible | Exclude known pairs. Split knowable flags. |
| sim-worlds-21 | sim | packages/sim/src/world.ts:244 | Spawned personas get an incomplete name index. | confirmed | Rebuild on spawn. |
| sim-worlds-22 | worlds | packages/sim/src/apps/slop/metrics.ts:88 | goodDateRate includes unsafe dates. City is not validated. | confirmed | Safe-only metrics. Validate city. |
| sim-worlds-23 | sim | packages/sim/README.md:144 | Replay and performance claims drift. | confirmed | Fix claims or code. |
| sim-worlds-M3 | sim | packages/sim/src/scenario.ts | Scenarios pass when every expectation is skipped. | confirmed | Report vacuous. |
| sim-worlds-M4 | sim | packages/sim/src/snapshot.ts | The console snapshot rescans every record on each call. | confirmed | Incremental state. |
| capital-2 | capital | packages/capital/src/ledger.ts:303 | Clawbacks of older credits add room under the period cap. | confirmed | Count only in-window reversals. |
| capital-6 | capital | packages/capital/src/ledger.ts:206 | Duplicate logical events with new ids are credited again. | confirmed | Semantic dedupe. |
| capital-9 | capital | packages/capital/src/ledger.ts:177 | Non-members and minors count as counterparts. Recruiting a 13-year-old pays. | confirmed | Eligible adults only. |
| capital-10 | capital | packages/capital/src/ledger.ts:46 | entriesFor shows the voucher who their invitee met. Audit arrays are mutable. | confirmed | Redact. Freeze. |
| capital-14 | capital | packages/capital/src/levers.ts:52 | NC never decays. vouch periodDays is unused. | confirmed | Window the levers. |
| capital-15 | capital | packages/capital/src/types.ts:44 | Silence confirmation enables no-show penalties. Reschedules are ignored. | plausible | Add explicit flag. Product call. |
| capital-16 | capital | packages/capital/src/types.ts:28 | Capital events have no app. | plausible | Decide per-app vs shared. |
| capital-17 | capital | packages/capital/src/ledger.ts:263 | Self-vouch pays. Removed members earn. Reviewers can review themselves. | confirmed | Close each path. |
| capital-18 | capital | packages/capital/src/levers.ts:60 | Default at=Infinity locks inactive members forever. | confirmed | Require now. |
| capital-19 | capital | packages/capital/src/ledger.ts:198 | Same-tick order changes results. | plausible | Canonical order. |
| capital-20 | capital | packages/capital/src/ledger.ts:286 | Credit cost is quadratic per member. | confirmed | Incremental indexes. |
| capital-21 | capital, network | packages/capital/src/levers.ts:38 | The engine half of the effort overlay is dead. | confirmed | Wire or remove. |
| capital-22 | capital | packages/capital/src/view.ts:18 | View says "now active" for people who left. Entry ids can collide. | confirmed | Fix view. Unique ids. |
| capital-m1 | network | packages/network/src/capital.ts | ledgerReader ignores the ledger's own config. | confirmed | Pass ledger.cfg. |
| capital-m2 | capital | packages/capital/src/config.ts | resolveCapital accepts invalid config. | confirmed | Validate. |
| capital-m3 | capital | packages/capital/src/detect.ts | Clawed-back credits re-queue flags every 14 days. | confirmed | Exclude reversed entries. |
| capital-m4 | network | packages/network/src/network.ts:1197 | review_completed key includes now, so review credit can repeat. | confirmed | Drop now from the key. |
| network-consent-20 | network | packages/network/src/network.ts:3508 | Unknown briefId maps to "info" and skips about-others checks. | plausible | Refuse unknown briefs. |
| network-consent-24 | network | packages/network/src/network.ts:950 | Members on watch get no reply to requests. | confirmed | Reply honestly. |
| network-consent-25 | network | packages/network/src/network.ts:1807 | Feedback text is logged verbatim. | confirmed | Log flags only. |
| network-consent-26 | network | packages/network/src/network.ts:1606 | Replacement alternates skip avoid and pair history. | confirmed | Same checks as reroll. |
| network-consent-27 | network | packages/network/src/trust.ts:4 | Watch duration doc says 14 days, code takes up to 42. | confirmed | Fix doc or decay. |
| network-consent-28 | network | packages/network/src/network.ts:2865 | Hosts and growth helpers are chosen in insertion order with no load cap. | plausible | Spread load. |
| network-consent-29 | network | packages/network/src/network.ts:2244 | Late plan joiners are not announced to the group. | plausible | Announce. |
| network-service-10 | network/service | packages/network/src/store.ts:163 | Each unit rewrites all history. 576 ms at 10k opportunities. | confirmed | Write changed rows. Archive. |
| network-service-14 | network/service | packages/network/service/service.ts:226 | Under-13 forget leaves the name in others' rows and run summaries. | confirmed | Scrub. |
| network-service-15 | network/service, observatory | packages/observatory/src/staff.ts:91 | Staff tokens accepted in ?token=, shared identities, no length minimum. | confirmed | Header only. 32-char minimum. |
| network-service-16 | network/service | packages/network/service/service.ts:409 | Malformed staff input answers 503. | confirmed | Validate. 400. |
| network-service-17 | network/service | packages/network/service/service.ts:435 | Webhook buffers the whole body before checking size. | plausible | maxRequestBodySize. |
| network-service-18 | network/service | packages/sim/src/channel.ts:113 | "cancel" is STOP with no plan-aware copy. | confirmed | Explain in the confirmation. |
| network-service-19 | network/service | packages/network/service/service.ts:338 | GET /review saves state. Shutdown does not drain. | confirmed | Read-only path. Drain. |
| network-service-20 | network/service | packages/network/service/snapshot.ts:39 | Snapshot is not one transaction and includes invited members. | plausible | One repeatable-read read. Joined only. |
| network-service-M3 | network | packages/network/src/network.ts | Ids carry app but not city, so two cities would collide. | confirmed | Add city. |
| network-service-M4 | network/service | packages/network/service/service.ts | Join writes platform rows outside the unit transaction. | confirmed | One transaction or idempotent retry. |
| network-service-M5 | network/service | packages/network/service/channel.ts | Queue records grow without bound. | confirmed | Evict. |
| platform-17 | platform | packages/platform/src/accounts.ts:205 | Share grants cannot be revoked, are not logged and have no effect. | confirmed | Revoke route and audit. |
| platform-18 | platform | packages/observatory/db/migrations/0003_platform.sql:222 | OTP challenges, sessions and rate rows are never purged. | confirmed | Retention job. |
| platform-21 | observatory/db | packages/observatory/db/migrations/0003_platform.sql:242 | Synthetic-phone guard depends on a settings row defaulting to dev. | confirmed | Check env and DB agree at boot. |
| platform-22 | observatory/db | packages/observatory/db/schema.sql:256 | requests and feedback have no composite FK to their member. | confirmed | Add composite FKs. |
| platform-23 | platform | packages/observatory/db/migrations/0004_network_apps.sql:10 | Session SET leaks across pooled connections and writers default to ntwrk. | plausible | Local set_config. No default in production. |
| platform-24 | platform | packages/platform/src/accounts.ts:119 | last_seen_at updates only on join. | confirmed | Update on login and inbound. |
| platform-25 | platform | packages/platform/src/accounts.ts:95 | Staff invites mark phones verified. Under-13 invitees keep phone and age. | confirmed | Unverified until proven. Remove on decline. |
| platform-26 | platform | packages/platform/src/store.ts:158 | Parallel starts send two SMS. Fixed windows allow bursts. | confirmed | Sliding window, atomic. |
| platform-27 | platform | packages/platform/src/otp.ts:67 | Twilio Verify sends one service name for every app. | confirmed | Per-app name. Timeout. |
| platform-30 | platform | packages/platform/src/api.ts:157 | /api/me reveals a cross-app age record. | confirmed | Same shape as a new phone. |
| platform-M2 | platform | packages/platform/src/store.ts | Age is a number with no date, so a minor never ages in. | confirmed | Store stated_at. |
| platform-M4 | platform | packages/platform/test/db.test.ts | The migration test fails after 0005. | confirmed | Derive the list from the directory. |
| platform-M5 | platform | packages/platform/src/otp.ts | Twilio Verify state is per number, not per app. | confirmed | Bind challenges to the verification SID. |
| observatory-5 | observatory | packages/observatory/src/store.ts:150 | Hidden oracle truth reaches every role in game mode. | confirmed | Strip until resolved or lens on. |
| observatory-8 | observatory | packages/observatory/src/staff.ts:131 | Static tokens work alongside SSO and in query strings. | confirmed | Refuse in SSO mode. |
| observatory-9 | observatory | packages/observatory/src/sources/real.ts:127 | Isolation and read-only are assumed from configuration. | plausible | Check the login at init. |
| observatory-11 | observatory | packages/observatory/src/sources/real.ts:209 | One state row per app hides other cities. | confirmed | Merge per city. |
| observatory-12 | observatory | packages/observatory/src/staff.ts:154 | Access certs fetch has no timeout or stale grace. | confirmed | Timeout and grace. |
| observatory-13 | observatory | packages/observatory/src/server.ts:319 | Prototype keys reach role checks. Raw errors are returned. | confirmed | Object.hasOwn. Generic 500. |
| observatory-14 | observatory | packages/observatory/src/lab.ts:105 | Lab queue is unbounded and children inherit secrets. | confirmed | Cap and env allowlist. |
| observatory-15 | observatory | packages/observatory/src/server.ts:283 | Audit rows from any staff, verbatim client fields, one bad line breaks /api/audit. | confirmed | Allowlist. Tolerate corruption. |
| observatory-16 | observatory | packages/observatory/src/server.ts:311 | Reveal grants are not keyed by mode and cannot be revoked. | confirmed | Key by mode. Revoke route. |
| observatory-17 | observatory | packages/observatory/src/sources/real.ts:81 | Global PII reveal trusts localhost, including tunnels. | confirmed | Require a dev marker in the DB. |
| observatory-19 | observatory | packages/observatory/src/sources/real.ts:74 | minorAt fails open for unknown ages. | confirmed | Agree with ageView. |
| observatory-20 | observatory | packages/observatory/src/server.ts:240 | No security headers on the console. | confirmed | Add them. |
| observatory-21 | observatory | packages/observatory/src/server.ts:132 | Mode is global. Commands go to the global source. | confirmed | Mode per request. |
| observatory-22 | observatory | packages/observatory/src/sources/real.ts:776 | shadow_run has no single-flight guard. | plausible | Single-flight. |
| observatory-23 | observatory | packages/observatory/src/sources/real.ts:244 | A null name crashes the real-mode load. | confirmed | "Unnamed member". |
| observatory-M2 | observatory | packages/observatory/web/store.ts | The token stays in history and Referer. | plausible | Header bootstrap. Referrer policy. |
| observatory-M3 | observatory | packages/observatory/src/server.ts | /api/reveal 404 leaks membership without an audit row. | plausible | Audit ok:false. |
| plugin-prototypes-8 | plugin-network | packages/plugin-network/src/evaluators/network-signals.ts:15 | Signals record false travel, safety and opt-out. | confirmed | Quote and negation handling. |
| plugin-prototypes-9 | plugin-network | packages/plugin-network/src/routing/state-intent.ts:12 | Design-A trigger misses common pause phrasing. | confirmed | Larger labelled corpus. |
| plugin-prototypes-11 | plugin-network | packages/plugin-network/src/routing/structured-field.ts:158 | Frozen "Today is", stateFrom not rendered. | plausible | Per-call now. Render windows. |
| plugin-prototypes-18 | messaging-blooio | packages/blooio/src/ledger.ts:109 | Unlimited STOP confirmations. START from strangers grants consent. | confirmed | One confirmation per change. Restore only prior consent. |
| plugin-prototypes-19 | messaging-blooio | packages/blooio/src/phone.ts:14 | Email and phone are separate consent keys. International numbers mis-normalize. | confirmed | Person-keyed consent. Strict E.164. |
| plugin-prototypes-20 | messaging-blooio | packages/blooio/src/gateway.ts:50 | Multi-bubble replies hit the cap. Dedupe has no TTL. Copy drifts from Cloud. | plausible | Count turns. TTL. Shared copy. |
| plugin-prototypes-23 | connector-mcp | prototypes/connector-mcp/src/profiles.ts:115 | Unknown age defaults to adult. | confirmed | Default to minor. |
| plugin-prototypes-25 | connector-mcp | prototypes/connector-mcp/src/server.ts:175 | A committed write is reported as a failure. | confirmed | Truthful receipt. |
| plugin-prototypes-27 | connector-mcp | prototypes/connector-mcp/src/policy.ts:63 | Unbounded maps, fixed windows, permissive dev server. | confirmed | Evict. Bind loopback. |
| plugin-prototypes-M4 | plugin-network | packages/plugin-network/src/routing/authz.ts | Stated from and grace until can be in the past. | confirmed | Re-check after override. |
| plugin-prototypes-M5 | messaging-blooio | packages/blooio/src/outbound-queue.ts | Fallback drops line attribution. | confirmed | Carry the line. |
| sites-infra-21 | sites | sites/peon.biz/public/join.html:1 | peon collects exact age and ZIP and hides the role in interests. | plausible | Typed role. Over-18 boolean only. |
| sites-infra-23 | sites | sites/slop.date/public/index.html:1 | help@ addresses for slop, peon and buddies may not exist. | plausible | Check MX and routing before deploy. |
| sites-infra-24 | sites | sites/ntwrk.love/public/join.html:10 | ntwrk accepts 13-17 in New York with no minors-specific notice. | plausible | Counsel review. Data minimization. |
| sites-infra-25 | scripts | scripts/sites-dev.ts:76 | Dev server open redirect and forwarded client IP headers. | confirmed | Same-origin redirect. Strip IP headers. |
| sites-infra-26 | sites | sites/ntwrk.love/public/index.html:5 | ntwrk has no skip link and its landmarks sit inside main. | confirmed | Fix markup. |
| matching-e2e-15 | network | packages/network/src/network.ts:1039 | Request search has an id-order tie-break and no load term. | confirmed | Seeded tie-break. Load term. |
| matching-e2e-16 | network, judge | packages/network/harness/experiment.ts:130 | "Good meeting" thresholds differ across metrics. | confirmed | One constant. |

## Notes per package

### packages/network (consent, matching, service)

This is where most P0 and P1 findings live. The consent layer reads replies with regexes tuned to persona templates. It treats a refusal that names a day as a yes. It treats "absolutely not" as a yes. It reads "I don't want to meet founders" as a request. The parser lives in the simulator, so the sim cannot catch its own misreads.

Safety handling is upside down in places. Reporters of scams get held. A first report leaves no record. A child who states an explicit age after a meeting is forgotten before the adults are recorded. An adult who jokes "I act like I am 12" is deleted.

Matching only works for text the simulator writes. Romance is never matched. Most honest members get nothing in 21 days. Precision is measured after members filtered the proposals. The LLM judge never runs.

The service loses deferred messages on restart and has no fencing on its lock. Under the intended RLS role it would lose all state on every message.

### packages/core

The leak guard misses short sensitive words, non-Latin text, spaced or spelled contact details and 7-digit numbers. The email regex is quadratic. The LLM client has no deadline or budget and leaks model output into errors.

### packages/engine

Exploration can select configurations the judge rejected and show the rejection text. The risk filter misses childcare asks. Romance can form groups and pair people with no stated orientation. The planner favours low-id members and books group yes-sayers as pairs.

### packages/sim/src/judge and packages/evals

The minors gate cannot see probes. Interruption checks trust flags the system sets about itself. There is no cross-app, name-before-reveal or contact-before-swap invariant. The LLM judges fail open on bad JSON. Calibration never runs in CI.

### packages/sim and packages/sim/src/apps

The simulator grades the system with its own assumptions. PRIMED_MODEL decides the consent-first result. The oracle forgets declines. The console snapshot leaks hidden decisions. slop worlds give minors away through occupation. PRD 40.8 adversaries and the cross-app world are missing.

### packages/capital

Sybil vouching pays and is never flagged. The ledger has no persistence and is not wired into the service. The fairness gate passes on a point estimate.

### packages/platform and the console DB roles

A minor can retry with a higher age. Delete-everything launders age and escapes blocks. A recycled number reads the old owner's data. Dev shortcuts run unless NODE_ENV is exactly production. There is no Turnstile in production. STOP is per app, against PRD 40.3. Two consent systems disagree. A console view leaks every app's state to the ntwrk role.

### packages/observatory

Member names reach Leaflet tooltips as HTML. Sockets keep streaming real minors' data after a mode switch. The cross-app role can read all message bodies. Analysts receive per-member ages.

### packages/plugin-network and prototypes

SET_STATE runs with no authorization in the Cloud default mode. The evidence check does not bind the state. Dates resolve a month late for US evening messages. Idempotency keys collide across members. The Blooio queue ignores group participants' opt-outs and falls back to SMS after a policy block. The connector leak guard is a membership oracle. Only one SKILL.md exists.

### sites, scripts and CI

Stop and logout always fail against the real API. /api is not routed. The deploy guard is bypassable. CI skips sites, plugin-network and every Postgres test. The lockfile is stale. The build drops _headers and SKILL.md. Legal pages for three sites say "Draft". peon and buddies have production configs although they are local-only. buddies is not renamed.

**Deploy note.** The user asked to publish all four sites to Cloudflare Pages. AGENTS.md decisions 4 and 6 say peon and friends are local-only. CI/CD should deploy ntwrk and slop only, behind a founder-approved environment, until the founder changes that decision. Deploying the current ntwrk build would replace the working 10DLC page with forms whose /api calls fail.

## Appendix A: refuted findings

| ID | Why refuted |
|---|---|
| observatory-2 | Fixed on the current tree. Per-app grants are enforced on every route, and reveal and read keys include the app. |
| network-service-3 | Fixed on the current tree. The snapshot and every write are app-scoped. A slop inbound now returns 200 invite_only. |
| network-service-4 | Fixed on the current tree. The default store id is ntwrk:nyc and legacy nyc is mapped. |
| sites-infra-2 | Production mounts createPublicApi without Turnstile, so login works. The real defect is the reverse (platform-5 / sites-infra-M1). |
| matching-e2e-13 | The judge is never wired, in the sim or in production, so they measure the same ranker. The real defect is matching-e2e-M2. |
| network-consent-30 | Branded copy goes through this.copy. The direct copy keys carry no brand text. |

## Appendix B: superseded detail

platform-31 said createPublicApi is not mounted. On the current tree service.ts:350 mounts it and the onJoin, onStop, onForget and onExport hooks exist. The remaining gap is hosting: the API runs only as a Bun process and no site routes /api. That gap is tracked in sites-infra-13.
