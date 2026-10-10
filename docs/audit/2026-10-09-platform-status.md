# Audit status: platform packages (2026-10-09)

This file gives the status of every P0 and P1 finding of the 2026-10-08 audit ([2026-10-08-weaknesses.md](2026-10-08-weaknesses.md)) in these packages: network, network/service, platform, blooio, observatory, observatory/db, sites, mcp and deploy. It also covers the P0 and P1 hand-offs to these packages in [2026-10-08-fixes-core.md](2026-10-08-fixes-core.md).

- **Worktree:** `thenetwork-console`, branch `obs/network-console`, HEAD 6a55050 plus uncommitted work of this round.
- **Method:** each finding was checked against the current code. The 2026-10-08 cleanup moved code and deleted the unit tests that proved most fixes. A finding is "proven" only by a gate in `bun run sim` or a case in `bun run security`.
- **No LLM, no live send, no deploy.** The gates use fakes. Phones are +1 212 555 01xx.

## Status words

| Status | Meaning |
|---|---|
| fixed-before | The code fix was made before this round (mostly 2026-10-08). The "Proof" column names the gate that holds it now. |
| fixed-before, gate now | The code fix was made before, but its test was deleted in the cleanup. This round added the gate or security case. |
| fixed-now | This round changed the code. |
| partly | One part is fixed. The "Open" column says what is not. |
| open | Not fixed. The reason is given. |

"audit block" is the new `bun run sim --only audit` block (`scripts/sim/audit.ts`). "security" is `bun run security`.

## Summary

| Severity | Findings | fixed-before | fixed-before, gate now | fixed-now | partly | open |
|---|---|---|---|---|---|---|
| P0 | 6 | 5 | 1 | 0 | 0 | 0 |
| P1 | 42 | 18 | 20 | 1 | 2 | 1 |

- No finding needed a new code fix in these packages this round. The one "fixed-now" finding (network-service-2) is the pipeline agent's fix in this round.
- 21 fixes had no proof after the cleanup. This round added 16 sim gates (the audit block) and 2 security cases that prove them. Four of the new checks ran once against the old defect. Each failed, as it must (see "Negative controls").
- Two P0/P1 rows keep an open note while their status is fixed: matching-e2e-1 (the LLM reader is not wired) and observatory-6 (SSO expiry has no gate).

## P0

| ID | Package | Status | Proof | Open |
|---|---|---|---|---|
| network-consent-1 | network | fixed-before | evals block: "consent replies consent-replies.jsonl: accuracy >= 97%" and "no refusal or hedge read as yes" (318 lines), the held-out file (75 lines). `parseProbeReply` reads refusals first; a mixed reply is `unclear`. | |
| network-consent-2 | network | fixed-before | `packages/network/src/classify.ts` owns the parser and uses core `parseReply`; nothing imports the simulator's parser. evals block: "core replies" gates. ops block: "image: the backend ... import nothing from the simulator". | |
| network-consent-3 | network | fixed-before, gate now | audit block: "network-consent-3 (P0): a member declined under the join age after a meeting: the adults they met keep a contact_with_minor case that survives the delete". | |
| network-consent-4 | network | fixed-before | network block: scenarios `scam_money`, `contact_extraction`, `block_abuse`, `harassment`. | |
| matching-e2e-1 | network | fixed-before | evals block: "wants (20): recall >= 0.8", "areas: recall >= 0.9", "areas: an unknown place is never defaulted". | The LLM reader (`llmUnderstand`) exists but the service does not pass it. Under the 2026-10-09 founder decision 2, Eliza runs the conversation, so the backend may not need it. |
| matching-e2e-2 | network, platform | fixed-before | slop block: official gates; friends block: "conformance friends: no romance at any layer". `ALLOWED_CATEGORIES` per app in `network.ts`. | |

## P1

### network and network/service

| ID | Status | Proof | Open |
|---|---|---|---|
| network-service-1 | fixed-before | network block: "send-time recipient policy: minors, declined pairs and replies; stated ages fail closed" ("I am 12 years old" from an adult record is an `age_conflict` case, not a delete). | |
| network-service-2 | fixed-now (pipeline agent, this round) | pipeline block: "restart keeps waiting rows: a quiet-hours row from before the restart goes in the morning (audit network-service-2)" and "crash during a provider call". | |
| network-service-M1 | fixed-before, gate now | audit block: "network-service-M1, network-consent-12, plugin-prototypes-22: the service runs under a network_service-only login ...". The service runs as a login with no superuser and no BYPASSRLS, as production does. It joins, onboards, declines an under-13, takes STOP, restarts and loads its state. The same login sees 0 rows outside an app transaction. security: "row-level security: each app's console role reads its own rows only". | |
| network-consent-5 | fixed-before, gate now | audit block: "network-consent-5: after a probe \"no\", the pair is not probed again". | |
| network-consent-6 | fixed-before | network block: scenario `corroborated_report` ("both reports in the staff case"). safety block: "report -> case -> hold -> ban". | |
| network-consent-7 | fixed-before, gate now | network block: scenario `corroborated_report` ("no points from strangers"). audit block: "network-consent-7: one weight per reporter, none for a stranger, and a staff lift clears old corroboration". | |
| network-consent-8 | fixed-before | evals block: "benign adult phrasing: precision >= 99%", "abuse: recall >= 95%". network block: "trust: no honest member is flagged". | |
| network-consent-9 | fixed-before | evals block: "teen ages: recall >= 95%", "third-party ages are read exactly". network block: scenarios `minor_signal`, `stated_minor_first_message`. | |
| network-consent-10 | fixed-before, gate now | evals block: "teen ages: 0 adults (or teachers) read as minors". audit block: "network-consent-10: a minor signal on an adult record is cleared only by an audited staff action". | |
| network-consent-11 | fixed-before, gate now | audit block: "network-consent-11: an interest named to a member in a probe or a reveal is one another participant marked shareable". | |
| network-consent-12 | fixed-before, gate now | audit block (service gate above): "actually I'm 16" on friends sets the person's lowest age to 16. A later "slop" join that says 25 makes a slop member aged 16, a minor. pipeline block: "nothing stored for an under-13". | |
| matching-e2e-M1 | fixed-before | evals block: "negated wants (n 102): 0 read as a want, interest or request". | |
| matching-e2e-M2 | fixed-before, gate now | audit block: "matching-e2e-M2: without an engine LLM the Network reports the engine judge off". The service wires no engine LLM, so the judge is off and the run log says so. | Wiring the judge (`engineLLM`) is a product decision, not a defect. |
| matching-e2e-4 | partly | network block: "unsafe proposals < push / 4 (seed 1)", "more meetings than push (seed 1)". | The block still gates on accept rates ("everyone-yes > 0.73", "invite-yes > 0.85"). The outcome gates run on seed 1 only, because the push arm runs on seed 1 only. The fix needs push arms on seeds 2-3 (more run time on a loaded machine) and the engine session's `PRIMED_MODEL.identityFit` decision. |
| matching-e2e-5 | open | | An A/B of the engine's floor order on seeds 1-3 gave no fairness gain and a lower enjoyed share (docs/results/2026-10-08-network-hardening.md section 4). The load term in request search is in. The decision needs 8 seeds of 42 days. |
| matching-e2e-7 | fixed-before | The harness reports precision over every started opportunity, and "fulfilled" counts only after attendance (docs/results/2026-10-08-network-hardening.md, section 4 table). | This is a measurement. It has no blocking gate. |
| attention-MISSED-1 | fixed-before, gate now | audit block: "attention-MISSED-1: a plan invite the member answered carries repliedAt". network block: "<= 1 plan invite per member per 7 days". | |
| judge-evals-M1 (network part) | fixed-before | network block: "consent arms: judge 0 invariants ... (quiet hours, over budget, streak included)". The judge uses the PRD budgets. | |

### platform, blooio and observatory/db

| ID | Status | Proof | Open |
|---|---|---|---|
| platform-1 | fixed-before | security: "PLAT-02 the lowest age is monotone per phone" (a refusal stores the age floor). | |
| platform-2 | fixed-before | security: "PLAT-02 ... delete-all never let an older age through". | |
| platform-3 | fixed-before, gate now | security (new, memory and Postgres): "platform-3 a number not seen for 12 months ... logs in: no membership shown, export and delete answer 403 review, the old data stays". mcp oauth: "a held number cannot sign in". | |
| platform-4 | fixed-before | security: "an undeclared environment does not start", "a deployed environment needs every secret". `devShortcutsAllowed` needs PLATFORM_ENV=dev. | |
| platform-5 | fixed-before, gate now | `createPublicApi` throws without a Turnstile verifier outside dev. audit block: "platform-5: every site's phone step renders the Turnstile widget with the build's site key". | |
| platform-7 | fixed-before, gate now | Migration 0010. security (new): "platform-7 catalog: a console role selects only row-level-security tables, its own app's views and a fixed list; never network_state_console". A new table or view that a console role can read without row-level security fails this case. | |
| platform-8 | fixed-before | security: "PLAT-11 channel identities are per app". | |
| platform-9 | fixed-before, gate now | `consent.ts`: STOP is global by default. evals block: "platform: leave <app> is that app only". pipeline block: "keyword routing ... leave one app". audit block: "plugin-prototypes-26, platform-9: ... STOP stops every app and \"leave <site>\" one, in the skill and the SMS terms". | |
| platform-10 | fixed-before | security: "PLAT-15 ten parallel joins with one phone". | |
| platform-M1 | fixed-before | pipeline block: "0 sends after STOP (only the STOP confirmation, until START)". The send path reads the platform ledger and the member's opt-out (`NetworkRuntime.optedOut`). | |
| plugin-prototypes-12 (platform and network part) | fixed-before | evals block: "platform opt-out (en + es): every opt-out line is a STOP", "core parseOptOut: leave <app> is app-scoped; Spanish is tagged". | |

### observatory

| ID | Status | Proof | Open |
|---|---|---|---|
| observatory-1 | fixed-before, gate now | audit block: "observatory-1: no console web code hands a string to an HTML sink ...; the page has a CSP". | |
| observatory-6 | fixed-before, gate now | audit block: "observatory-6: a mode switch re-checks every open console socket: the engineer's (no role in real mode) is closed 4403, a reviewer's stays". | The SSO-expiry path (4401) has no gate. It needs a Cloudflare Access token fake. |

### mcp (was prototypes/connector-mcp)

| ID | Status | Proof | Open |
|---|---|---|---|
| plugin-prototypes-21 | fixed-before | The prototype is retired. `packages/mcp` has no tool that returns anything about another person (`tools.ts`), and its output gate withholds a summary that fails (evals block: "MCP output gate"). | |
| plugin-prototypes-22 | fixed-before, gate now | `submit_profile` goes through the Network's own age rules (`NetworkService.submitProfile`). audit block (service gate): an agent-submitted "I'm 15" sets the person's lowest age to 15 and makes the member a minor. | |
| plugin-prototypes-26 | fixed-before, gate now | One SKILL.md per site in `sites/skills/`. audit block: "plugin-prototypes-26, platform-9: one SKILL.md per site, same backend, its own MCP URL ...". | |

### sites, deploy, scripts and CI

| ID | Status | Proof | Open |
|---|---|---|---|
| sites-infra-1 | fixed-before, gate now | audit block: "sites-infra-1: every POST from the sites' API client is JSON". | |
| sites-infra-4 | fixed-before, gate now | audit block: "sites-infra-4: the deploy guard refuses every changing command ..." (23 commands, with flag values before the command; each exits 3 before wrangler runs). | |
| sites-infra-5 | partly | CI typechecks the sites and runs the security suite with REQUIRE_PG=1. | CI is not in these packages. The CI sim job has no Postgres, so the Postgres gates of the pipeline, safety, ops and audit blocks are tracked as skipped there. The plugin-network typecheck is not blocking. |
| sites-infra-6 | fixed-before | `bun install --frozen-lockfile --dry-run` exits 0 on 2026-10-09; `bun.lock` lists packages/platform and packages/blooio. | |
| sites-infra-9 | fixed-before | Renamed to friends.help. The four `wrangler.toml` files are Pages projects with no routes or custom domains. | |
| sites-infra-10 | fixed-before, gate now | audit block: "sites-infra-10, -14: each production build ships _headers, robots.txt, SKILL.md and the router; no page says Draft". | |
| sites-infra-13 | fixed-before | The API host is `api.ntwrk.party`, reached through each site's Pages router. security: "router to backend (deploy/router.ts, the real Worker code)". `.github/workflows/deploy-sites.yml` deploys behind the "production" environment. | |
| sites-infra-14 | fixed-before, gate now | audit block: "sites-infra-14: a production build with draft legal text fails". | |

## P0 and P1 findings outside these packages

The engine session owns these. They are listed so that the two status files cover every P0 and P1. The status is from [2026-10-08-fixes-core.md](2026-10-08-fixes-core.md).

| ID | Owner | Status there |
|---|---|---|
| core-1, core-2, core-3 | core | fixed |
| engine-pipeline-1, -4, -15 | engine | fixed |
| judge-evals-1, -2, -8, -M1 | judge | fixed |
| judge-evals-7 | judge, core | partly. The network part (an `app` on proposals and messages) is not done. In production each app has its own Network runtime and its own rows (row-level security), and the service gate above runs under that login. A sim world with two-app personas (sim-worlds-5) is needed before `cross_app_leak` can see real traffic. |
| sim-worlds-1 | sim | fixed |
| sim-worlds-5 | sim worlds | belongs to the worlds agents |
| plugin-prototypes-1 | plugin-network | fixed |

## Negative controls

Each check below changed the code back to the defect for one run, then restored it (`git diff` empty after).

| Gate | Change for the control | Result |
|---|---|---|
| network-consent-3 | `minorAfterContact` after `forget` in `declineUnderMinAge` | FAIL ("expected 0 to be > 0") |
| network-consent-5 | `markDeclined` writes nothing | FAIL (the re-probed pairs are listed) |
| network-consent-11 | `probeReason` uses all interests, not shareable ones | FAIL (every named interest) |
| platform-3 (security) | `Accounts.seen` never holds a stale number | FAIL (memory and Postgres) |

## Commands

```bash
bun run sim --only audit     # the new block: 16 blocking gates
bun run security             # 86 cases in 4 files (2 new: platform-3, platform-7)
bunx tsc --noEmit -p .
```

Results on 2026-10-09 (dev Postgres on :54339 running): `bun run sim` PASS, 209/209 blocking gates in 894 s (audit 16/16). `bun run security`: 86 pass, 0 fail. `bunx tsc`: no errors.

## Open items

| Item | Owner | Why |
|---|---|---|
| matching-e2e-4: gate on outcomes over 3 or more seeds, not on accept rates | engineering, engine session | Needs push arms on seeds 2-3 and the `identityFit` decision. |
| matching-e2e-5: the engine's floor order in `dailyRun` | engineering | The A/B showed no gain. A run of 8 seeds and 42 days must decide. |
| sites-infra-5: Postgres in the CI sim job | engineering (CI) | Without it, CI tracks the Postgres gates as skipped. |
| observatory-6: SSO expiry (4401) | engineering | Needs a Cloudflare Access token fake. |
| matching-e2e-1: the LLM reader in the service | FOUNDER | Only needed if the backend reads member text itself (decision 2 puts the conversation in Eliza). |
| P2 hand-offs core-14 (`checkThread` on send) and core-6 (`LEAK_LABEL_KEY`) | engineering | P2, so not in this file's scope. AGENTS.md decision 11 asks for both. Neither is wired in the network or the service. |
