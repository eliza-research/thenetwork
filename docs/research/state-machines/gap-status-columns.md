# State columns with a catalogue row and no machine

Scope: `network.facets.status` and `privacy_scope`, `network.intents.status`, `platform.apps.status`, `platform.apps.join_mode`, `platform.networks.matching_enabled` with the stored switch and console `PACK_READY`, and `network.matching_runs`.

All findings come from reading the code on branch `claude/quint-state-machines`. No test was run and no database was queried. Path prefixes: `N` = `packages/network`, `O` = `packages/observatory`, `P` = `packages/platform`, `S` = `N/service`.

Hand-written. Nothing here is generated.

## 1. Verdict table

| Column | Verdict | Live values | Dead values | Who may change it |
|---|---|---|---|---|
| `network.facets.status` | Projection of the origin of a row. No code updates it after insert. | `confirmed`, `proposed` (agent signals only) | `rejected` | Set at insert by the service. No UPDATE exists. Exit is DELETE. |
| Agent signal rows (`service-signal:*`, status `proposed`) | Live implicit queue with no exit | `proposed` | none | Gateway writes. Staff read only. |
| `network.facets.privacy_scope` | Write-once per row. Mutable only on the preview row in `platform.profile_suggestions`. | `agent_private`, `matchable`, `shareable` | `opportunity_specific` | The writer at insert. Member, on the preview only, and only between `agent_private` and `matchable`. |
| `network.intents.status` | Live machine for peon postings only | `active`, `closed` | `paused` | Manager by text, staff `admin` by API. |
| Non-posting intents (`withdrew`) | Dead in production | none | all | No production writer. Simulator and seed only. |
| `platform.apps.status` | Dead state | none | `dev`, `staging`, `live`, `paused` | Migration or DB owner. No reader. |
| `platform.apps.join_mode` | Static configuration, read once at boot. It selects behaviour on five paths. Not a machine at run time. | `invite`, `open` | `waitlist` is reachable by a row edit only | Migration or DB owner. No app role has write. |
| `platform.networks.matching_enabled` | Static upper guard, read once at boot | `true` (all four seeded rows) | `false` has no seeded row today | Migration or DB owner. |
| Stored `state.matchingEnabled` | Live machine, two states, staff driven | `true`, `false` | none | `admin` by `POST /matching`. Also force-written to false by the load path. |
| Console `PACK_READY` | Code constant. A third guard, in the console only. | `ntwrk`, `slop`, `friends` allowed; `peon` locked | n/a | Code change. |
| `network.matching_runs` | Append-only log with no lifecycle | row exists | n/a | Service, in the tick unit. No update and no delete. |

## 2. Machine `facet-row-status`

Kind: explicit column, but behaves as a label.

State lives in `network.facets.status` (`O/db/schema.sql:57`, default `confirmed`). PRD 32.4 lists `proposed/confirmed/rejected` (docs/prd-snapshot.md:1217).

### 2.1 States

`absent`, `proposed`, `confirmed`, `rejected` (never written), `deleted` (the row is gone).

### 2.2 Every writer

| Writer | file:line | Status | Scope | Provenance | Trigger |
|---|---|---|---|---|---|
| Join zip (slop) | `S/service.ts:737` | confirmed | agent_private | said | member join |
| Join interests | `S/service.ts:742` | confirmed | matchable | said | member join |
| Clef rating | `S/service.ts:1617` | confirmed | agent_private | inferred | photo rater |
| Staff verify | `S/service.ts:1642` | confirmed | agent_private | vouched | safety staff |
| Agent signal | `S/service.ts:1953` | proposed | agent_private | inferred | gateway `/internal/signals` |
| Posting facts | `S/postings.ts:34` | confirmed | shareable or matchable | said | manager text or staff API |
| Employer verify | `S/postings.ts:57` | confirmed | shareable, matchable | vouched | staff |
| Accepted suggestion | `S/profile-suggestions.ts:241` | confirmed | agent_private or matchable | inferred | member decision |

There is no `update network.facets` in non-test code. The on-conflict branches at `service.ts:1619` and `:1644` set tags, value, confidence or `valid_from`, never `status` or `privacy_scope`. Only tests move status (`N/test/crossapp.test.ts:166,175,180`).

Deletes: forget path `S/runtime.ts:538`, ratings `S/service.ts:1601`, postings `S/postings.ts:32,56`, suggestions `S/profile-suggestions.ts:278,330,421`, trigger `0039:53`.

### 2.3 Transitions

| From | Event | Guard | To | Who |
|---|---|---|---|---|
| absent | any writer above except signal | see table | confirmed | member, staff, rater |
| absent | signal | valid signed turn | proposed | other service |
| confirmed | `revoke`, `delete`, `forget`, rating drop, posting save | per path | deleted | member, staff, other service |
| proposed | forget | member removed | deleted | member |
| proposed | none | | confirmed | no writer |
| any | none | | rejected | no writer |

`proposed` is absorbing apart from member removal. `confirmed` never returns to `proposed`.

### 2.4 Readers

- Snapshot admits `status <> 'rejected'` (`S/snapshot.ts:90-91`). So `proposed` rows enter the snapshot.
- `facetOf` maps `status = 'confirmed'` to `confirmedByMember: true` (`S/snapshot.ts:44`).
- `knownProfiles` skips inferred, unconfirmed facets (`N/src/network.ts:4297`). It also skips `agent_private`.
- Open-turn context needs `shareable` and `confirmedByMember === true` (`S/runtime.ts:725`).
- Bias and adult checks use `<> 'rejected'` (`S/service.ts:544,1582`). With no `rejected` writer these filters are vacuous.
- Export reads `status` but hides `agent_private` (`S/service.ts:834`).

### 2.5 Invariants

- I1. A `proposed` or Google-sourced fact is not matching evidence (`automatedFacetPredicate`, `S/snapshot.ts:13`; crossapp test).
- I2. A `rejected` row never enters a snapshot. This holds vacuously in production.
- I3. PRD 32.4: "contradictions create a confirmation question". Nothing implements it on this column.
- Liveness: a `proposed` row must reach a terminal state. It does not (GS-1).

### 2.6 Interactions

`platform.profile_suggestions.status` is a separate real machine (proposed, accepted, rejected, expired, withdrawn; see sql-schema.md). The word `rejected` in that table never reaches `network.facets`: a rejected suggestion writes no facet. `fact_id` links the two.

### 2.7 Defects

GS-2 below (`confirmed` has more than one meaning). PRD F5 (`docs/prd-snapshot.md:1019`) says a member can correct, delete or change scope. The founder correction of 2026-10-19 removes the website controls, not the agent path. The MCP tool list (`packages/mcp/src/tools.ts:48-107`) has `submit_profile` and no fact correction. So `rejected` has no route from a member. This is a scope question for a maintainer, not a verified bug.

## 3. Machine `agent-signal-review`

Kind: implicit. The only live use of `proposed`.

Row id `service-signal:<id>:<index>`, tag `signal:<kind>`, kind in `opt_out`, `travel`, `safety_concern` (`S/service.ts:1868` validates; `:1953-1954` writes).

### 3.1 States

`absent`, `pending_visible` (in the newest 200), `pending_hidden` (older than the newest 200), `unread_kind` (`travel`), `deleted`.

### 3.2 Transitions

| From | Event | Guard | Effect | To | Who |
|---|---|---|---|---|---|
| absent | `POST /internal/signals` | HMAC, receipt idempotent, up to 20, evidence up to 500 chars | row, event `network_signals_proposed`, alert log line for two kinds, in one transaction (`:1951-1960`) | pending_visible or unread_kind | other service |
| pending_visible | 200 newer rows arrive | `limit 200`, `order by valid_from desc` (`:1837`) | | pending_hidden | clock and volume |
| pending_* | member forget | | row deleted | deleted | member |
| pending_visible | staff read `GET /signals` (`:2276`) | reviewer or safety role | none | pending_visible | staff |

There is no dismiss, resolve or act route. `grep` finds `/signals` only as GET.

### 3.3 Properties

- Safety (AGENTS, README line 28): a signal never changes consent by itself. Holds: no reader acts on `signal:*`. `grep "signal:"` in `packages/engine/src` and `N/src` finds no tag consumer.
- Liveness: every `opt_out` and `safety_concern` signal reaches a staff decision. Fails (GS-1).

### 3.4 Failure analysis

The write, the event and the action receipt are in one transaction. A replay returns the receipt. The alert line is a log call inside the transaction, so a rollback after the log gives an alert with no row. This is harmless.

The evidence text is `agent_private`, so it joins the leak guard list (`N/src/network.ts:4245`, `:4272`). When `NETWORK_ENGINE_JUDGE=1`, the deep pass context lists `agent_private` values (`packages/engine/src/packs/network/judgeContext.ts:336`). So an unreviewed signal can reach the model through that pass. I did not trace whether the deep pass runs in the service, so I do not report this as a defect.

### 3.5 Quint notes

Priority P0, because it holds the human step for `opt_out` and `safety_concern`. Merge with the consent model as a set of pending signals. Variables: `signals: Set[{member, kind, age}]`. Actions: `record`, `staffView`, `forget`. Add an abstract `resolve` only after a fix. Invariant to check: no signal changes consent. Temporal check: `always(pending(s) implies eventually(resolved(s)))` fails today.

## 4. Machine `facet-privacy-scope`

Kind: explicit column, write-once.

### 4.1 States

`agent_private`, `matchable`, `shareable`, `opportunity_specific` (CHECK `schema.sql:53`). No DB writer uses `opportunity_specific`; `grep` finds it only in the type, the CHECK and two engine comments.

### 4.2 Transitions

| Object | From | Event | Guard | To | file:line |
|---|---|---|---|---|---|
| `network.facets` row | any | none | | no change | no writer |
| Posting facet | row | delete and insert on each save | scopes are constants in `postingFacts` | same scope | `S/postings.ts:32-34`, `N/src/jobs.ts:219-227` |
| `platform.profile_suggestions` row | agent_private or matchable | member decision with `scope` | action accept, batch eligible, source authorized, revision matches, still proposed | other of the two, then a new preview | `S/profile-suggestions.ts:204-233` |
| Suggestion to facet | preview scope | member decision with the same scope | same guards | facet row with that scope | `:241` |

The member path can never produce `shareable`: both the type (`:17`) and the check (`:219`) limit scope to two values.

### 4.3 Invariants

- I1. PRD 17.1: `agent_private` never reaches another person. `leakGuard` is the runtime fence. Since a row cannot widen, no scope change can open a leak. This is a useful simplification for the model.
- I2. Accepted Google facts stay out of matching whatever their scope (`automatedFacetPredicate`). So a member who picks `matchable` gets no matching effect today.
- I3. "Sensitive facets are always agent_private" (`packages/core/src/types.ts:49`). No production insert writes the `sensitive` column, so this holds vacuously. `valid_to` and `revision` also have no production writer, so PRD 32.4 decay and revision rules are not implemented on this table.

### 4.4 Defect

GS-3: the export omits what a member said when it is `agent_private`.

### 4.5 Quint notes

P2 alone. Do not model as a machine. Use a constant map `scopeOf(rowOrigin)` in the leak model, and one action for the suggestion preview, merged with the `profile-suggestion` machine.

## 5. Machine `job-posting-status` (`network.intents.status`)

Kind: explicit, peon only. In production `S/postings.ts:28` is the only `network.intents` insert. The other writers are test fixtures and the seed writer. So every production row has `details like 'peon:job%'`.

### 5.1 States

| State | Stored form |
|---|---|
| `active` | intent `active`, openings facet `peon:openings:<n>` |
| `closed` | intent `closed`, openings facet `peon:openings:0` |
| `expired_silent` | implied: `active`, older than `created_at + 90 days` |
| `filled_derived` | implied: `active`, but `filled.size >= posted` in `checkSeats` |
| `paused` | CHECK allows it. No writer. |
| `deleted` | manager forgotten (`S/runtime.ts:539`) |

`closedReason` (closed or filled) is in the `JobPosting` object but has no column and no tag. It is lost at save (`N/src/jobs.ts:216-230`, `:243-246`).

### 5.2 Transitions

| From | Event | Guard | Effect | To | Who | file:line |
|---|---|---|---|---|---|---|
| absent | yes to read-back | `managerProblem` undefined | rows saved in unit | active | member | `N/src/network.ts:4610-4623`, `:4596` |
| absent | `POST /postings` | admin, `postingProblem`, `managerProblem` | same | active | staff | `S/postings.ts:141-157` |
| active | text close, yes | none on the manager | rows saved, `endSeat` | closed | member | `:188` in jobs.ts, `network.ts:4597-4600` |
| active | `POST /postings/:id/close` | admin, row exists | same | closed | staff | `S/postings.ts:129-135` |
| closed | `POST /postings` with the same id | admin, owner matches | status forced to active | active | staff | `S/postings.ts:149` |
| closed | stale draft yes | draft read back while active | status forced to active | active | member | `N/src/jobs.ts:196` |
| active | clock passes 90 days | none | engine drops the intent; `p.open = false` | expired_silent | clock | `packages/engine/src/world.ts:207`, `packs/peon/profile.ts:188` |
| active | enough both-yes intros | tick | `endSeat("posting filled")`, row unchanged | filled_derived | clock | `N/src/network.ts:4551-4553` |
| filled_derived | a booked intro closes | tick | seat has capacity again | active | clock | same |
| any | manager forget | unit | rows deleted, next tick `endSeat` | deleted | member | `S/runtime.ts:538-539`, `network.ts:4548-4549` |
| any | manager under 18 | snapshot | seat not built, rows hidden | hidden | other | `packages/engine/src/packs/peon/seats.ts:65` |

### 5.3 Readers

`paused` reads as closed in `postingFromFacts` (`jobs.ts:246`), `checkSeats` (`network.ts:4548`), `postingsOf` (`jobs.ts:135`) and `peonSeats` (`seats.ts:79`). `world.ts:207` and `knownProfiles` (`network.ts:4318`) test `active` only.

### 5.4 Invariants

- Seat capacity: never more both-yes intros than openings (peon pack, `seatFills`).
- A closed posting gets no new match. Holds, unless it is reopened (GS-4).
- AGENTS decision 4: peon matching is local only (see section 8).

### 5.5 Concurrency

- `applyPosting` and the save run in one unit under the network lock.
- `S/postings.ts:127,132,140` reads `stored()` in its own transaction, before the unit. So staff edits and closes are built from a stale read. Two staff calls, or a staff call and a manager text, can overwrite each other. The last unit wins with whole-row fields.
- `verifyEmployer` (`S/postings.ts:55`) runs outside any unit and does not touch state. A snapshot refresh sees it. No problem found.

### 5.6 Defects

GS-4, GS-5.

### 5.7 Quint notes

P1, local only today. Model with the seat capacity. Variables: `status`, `openings`, `createdAt`, `draft`, `filled`. Actions: `post`, `closeText`, `closeStaff`, `editStaff`, `draftUpdate`, `draftYes`, `tick`, `managerForget`. Invariant: `closed` is terminal, or a reopen needs an explicit action. Bounds: 1 manager, 2 candidates, 2 openings, abstract clock with one 90-day step.

## 6. Dead: non-posting intents and `withdrew`

`withdrew` (`N/src/network.ts:1657-1662`) reads a `closed` intent with the objective equal to a desire text. No production path writes a non-posting intent. Desires live in `m.learned.desires` in the stored state. A member removes one with `x.notWanted` (`:1034`). The pack builds synthetic `active` intents at `:3707` and `S/packs.ts:233`; these are never stored.

So in production `withdrew` is always false and `counters.withdrawnWant` stays 0. sim.md `intent-liveness` confirms the source is the simulator (`packages/sim/src/snapshot.ts:126`). This is a state that the simulator exercises and production cannot reach. A gate that passes through this path proves nothing about production.

Do not model it.

## 7. `platform.apps.status`: dead state

Defined at `0003:26` with default `dev`. The only other mention is the rename copy at `0007:48-49`. `fromDatabase` does not select it (`S/service.ts:455`). No TS or SQL reader exists. Setting `paused` has no effect on joins, matching or sends.

`platform.networks.run_hour` and `pack_version` are the same: defined at `0003:50-51`, no reader. `docs/runbook-platform.md:121` says that run hour is policy that an operator changes in the row. That is wrong. The hour comes from `opts.runHour` (`N/src/network.ts:576`).

Do not model. A row edit that sets `paused` is a false safety control (GS-9).

## 8. Configuration `app-join-mode`

Kind: explicit column, static at run time.

Seed: ntwrk `invite`, slop, peon and friends `open` (`0003:28-33`, `0007:78`). Constant copy: `P/src/apps.ts:70-85`. Test pin: `P/test/db.test.ts:28`. No migration after 0007 changes it. `platform_service` has no write (`0007:237`) and `network_service` has select only (`0004:163`); `P/test/db.test.ts:217` proves a denied update for the sibling column. So only a migration or the DB owner can change it.

`fromDatabase` reads the row once (`S/service.ts:455-458`). A row edit needs a restart of every instance. `docs/runbook-platform.md:121` says "Change the rows for a running server". It does not say that a restart is needed.

docs/mvp-plan.md:84 lists the mode of peon and friends as an open founder decision, so a row edit is a planned event. The founder note of 2026-10-09 sets them to open, and the plan text was not updated.

### 8.1 Where each mode acts

| Path | invite | open | waitlist | Source of the mode |
|---|---|---|---|---|
| Web join `joinLocked` | needs `invited` (`P/src/accounts.ts:364`) | active | onboarding (`:378`) | DB row |
| `canJoin` | same (`:314`) | | | DB row |
| Text join | needs `invited`, except no-keyword shared line on ntwrk (`S/service.ts:1393`) | active | onboarding (`:1444`) | DB row |
| `enroll` from looking_for | **no check** (`:1478-1495`) | active | onboarding, then still listed as joined | DB row |
| `GET /api/app` | site shows invite step (`sites/shared/join.ts:90`) | | | DB row (`S/service.ts:931`) |
| MCP `app_info`, `start_signup`, `check_status` | guidance (`packages/mcp/src/tools.ts:205,222,268`) | | | **Constant** (`S/serve.ts:61`, `packages/mcp/src/apps.ts:37`) |
| SKILL.md | "Respect joinMode" | | | Text |

`packages/mcp/src/apps.ts:2-3` says the server and sites "cannot drift". That holds against the constant, not against the DB row.

The exception at `:1393` matches founder decision 2 and the note "ntwrk stays invite-only on the web". It is intended.

### 8.2 Machine it drives

It selects the first state of `platform.memberships` (sql-schema machine `sql-membership`). Nothing else. `onboarding` has no exit (SS-12): `joined` returns at `S/service.ts:791`, the text path at `:1448`, and no writer moves `onboarding` to `active`.

### 8.3 Quint notes

P1. Model as a constant per app, not as a variable, and run the join model once per value. Actions: `webJoin`, `textJoin`, `enroll`. Invariants: `mode = invite` implies no membership became `active` without `invited` (except the shared ntwrk route); `mode = waitlist` implies a path to `active` exists. The second fails. Add the constant as a parameter of the `sql-membership` model.

## 9. Machine `network-matching-gate`

Kind: three layers, one live.

### 9.1 Layers

| Layer | Where | Values | Set by | Read when |
|---|---|---|---|---|
| Registry | `platform.networks.matching_enabled` to `rt.matchingAllowed` | seeded true for all four (`0003:55-59`, `0007:80`, `0011:45`, `P/test/db.test.ts:31`) | migration | boot only (`S/service.ts:454`) |
| Stored switch | `network.network_state.state.matchingEnabled` | false at birth (`S/runtime.ts:152`), `network.ts:4652` exports it | `POST /matching` (admin) | every unit (`S/runtime.ts:356-363`, `network.ts:4689`) |
| Console | `PACK_READY` (`O/src/apps.ts:21`) | peon locked | code | console only (`O/src/sources/real.ts:864`, `game.ts:730`) |

Effective matching = `allowed && stored`. The console lock is not part of it.

`matching_enabled` does not turn matching on. Comment `S/packs.ts:18-19` states this correctly. A `false` row with no stored state still gives off, because the constructor default is false.

### 9.2 Combined states

For one network: `(allowed, stored)`.

| State | Meaning |
|---|---|
| (t, f) | Start state for every network in production. Admin may turn on. |
| (t, t) | Matching runs. |
| (f, f) | Off. `on` refused with an audit row (`S/service.ts:1811-1814`). |
| (f, t) | Transient. Only between a boot with a new registry value and the first unit. |

### 9.3 Transitions

| From | Event | Guard | Effect | To | Who | file:line |
|---|---|---|---|---|---|---|
| (t, f) | `POST /matching on` | admin role | audit, unit, event `matching_switch`, audit | (t, t) | staff | `S/service.ts:2489-2493,1816`, `network.ts:1862` |
| (t, t) | `POST /matching off` | admin | same | (t, f) | staff | same |
| (f, *) | `POST /matching off` | admin | same | (f, f) | staff | `:1811` lets `off` pass |
| (f, f) | `POST /matching on` | none | refused, audited | (f, f) | staff | `:1811-1814` |
| (t, *) | row edit and restart | migration | allowed becomes false | (f, *) | deploy | `:454` |
| (f, t) | any unit load, then save | none | `state.matchingEnabled = false`, saved, no event | (f, f) | clock | `S/runtime.ts:361` |
| (f, f) | row edit and restart | | allowed true, stored stays false | (t, f) | deploy | |

Effects of off (`network.ts:1856-1864` and readers): no daily run (`:3293`), no local encounters (`:3812`), requests wait (`:1592,1615`), no plans (`:2850`), approve refused with `matching_paused` (`:1953`), no availability offer (`:1803`). Probes already approved go on. Items waiting in review can expire, because `approve` is refused while off.

### 9.4 Invariants

- I1. `not allowed implies no engine run`. Holds in production. It relies on `load` returning a state. See GS-8 for the dev case.
- I2. Decision 4: peon and friends matching is local only. Not enforced for peon on the service, and not enforced for friends anywhere (GS-6).
- I3. Every switch change is audited. Holds for staff. The load-path write has no event (GS-7).
- I4. Off never bypasses the review gate. Holds: review is independent.

### 9.5 Concurrency

- The switch change is one unit under the network lock. A second instance imports it at its next load (`network.ts:4689`), so the stored row is the only truth. No lost update found.
- Registry is per process. In a rolling deploy with a new registry value, old instance A has `allowed = true`, new instance B has `false`. B writes false on its first unit. A staff `on` through A writes true, and A can run the engine with it until B writes false again. It ends when A stops.
- The audit row "requested" is written before the unit. A crash between them leaves "requested" with no "result". Staff can read the true value at `/health`.
- `health()` reads raw state and returns `allowed && stored` (`S/runtime.ts:755`). This is correct. The console instead reads raw stored state from `network_state_console` (`O/src/sources/real.ts:481,505,515`), so it can show on in the transient (f, t) state.

### 9.6 Quint notes

P1. A small model of value. Variables: `allowed` per instance, `stored`, `audit`, `consoleLock`. Actions: `boot(newRow)`, `load`, `save`, `staffOn`, `staffOff`, `consoleOn`, `tickRun`. Check: `tickRun implies allowedHere and stored`; `consoleSays == serviceDoes`, which fails for peon. Merge the outcome into the tick model as a boolean precondition of `dailyRun`. Two instances are enough.

## 10. Log `matching-run-log`

Kind: implicit, append-only.

### 10.1 States

`absent`, `written`. No status column (`schema.sql:195-203`). Primary key `id` alone; `app_id` added by 0004; RLS forced (`0004:127-130`).

### 10.2 Transitions

| From | Event | Guard | Effect | To | Who | file:line |
|---|---|---|---|---|---|---|
| absent | daily run in a tick | `matchingEnabled`, hour window, `lastRunDay` differs | push to `unit.runs`, then insert in the save transaction | written | clock | `network.ts:3289-3293,3449`, `S/runtime.ts:158-161,516` |
| written | same id again | `on conflict (id) do nothing` | none | written | replay | `S/runtime.ts:516` |
| absent | seed | dev only | insert | written | staff | `O/db/writer.ts:151` |

No update and no delete exist in code. Shadow runs stay in console memory (`O/src/sources/real.ts:858-860,910`).

### 10.3 Id

`<app>.<runId>-<city>`, app prefix absent for ntwrk (`S/runtime.ts:159-160`, `O/src/engineCapture.ts:22`). `runId` hashes the whole input, including `now`, the config and the seed (`packages/engine/src/engine.ts:48-51,87`). Two different days cannot share an id. A retry after a failed save has new `now`, so it gets a new id. Thus `on conflict` is close to dead.

`lastRunDay` and the run row commit in one transaction, so a crash loses both and the run repeats. This is safe, except that LLM judge calls are paid twice when the judge is on.

### 10.4 Readers

Console run list (`O/src/sources/real.ts:296`), heartbeat `max(at)` (`:492`), opportunity link `run_id` (`:711`), test `N/test/slop-date-path.integration.test.ts:143`, README judge check (`S/README.md:85`).

### 10.5 Defects

GS-10, GS-11.

### 10.6 Quint notes

P2. Do not model alone. Add `runs` as a history variable of the tick model. It is useful only for: `forget` must remove a member id from all history (GS-10). Add `runs` to the forget invariant in the merged P0 model.

## 11. Suspected defects

| Id | Title | Priority | Confidence |
|---|---|---|---|
| GS-1 | `proposed` signals have no exit, and old ones leave the staff view | P0 | high |
| GS-2 | `confirmed` does not mean that the member confirmed | P2 | high |
| GS-3 | Export omits member-stated `agent_private` facts | P2 | medium |
| GS-4 | A closed posting reopens through an edit or a stale draft, with openings reset to 1 | P1 | high |
| GS-5 | A posting older than 90 days stops matching and stays `active`; an update does not renew it | P1 | high |
| GS-6 | "Local only" is enforced by a console check for peon, and not at all for friends | P1 | high |
| GS-7 | Console and docs disagree with the registry; `locked` hides a live switch; silent reset | P1 | high |
| GS-8 | No stored state skips the registry override | P2 | high, dev only |
| GS-9 | `join_mode` values are not honoured on every path | P1 | high, latent |
| GS-10 | Forget leaves member ids in `matching_runs.summary` | P1 | high |
| GS-11 | `run_id` link hard-codes `-nyc` | P2 | high, latent |

### GS-1. Proposed signals have no exit

- Where: `S/service.ts:1833-1839,1953-1954,2276-2280`.
- Trigger: the agent records `safety_concern` for member A. Staff read `GET /signals` and act. The row stays `proposed`. It appears in every later read. There is no way to mark it handled, so staff cannot separate handled from new.
- Second trigger: 201 newer `opt_out` or `safety_concern` rows arrive. The first concern leaves the response (`limit 200`). The only trace is a log line and an event.
- `travel` rows are stored and no reader uses them, apart from the leak guard list.
- AGENTS: human review before action. A signal that nobody can close breaks the review loop. Not a contact risk: signals never act alone.

### GS-2. `confirmed` is overloaded

- Where: `S/snapshot.ts:44`, `S/service.ts:1618,1643`, `S/postings.ts:34`, `packages/engine/src/packs/slop/appearance.ts:151`.
- The engine builds a rating with `confirmedByMember: false`. The service stores `confirmed`, and `facetOf` returns `confirmedByMember: true`. Staff verify rows, company facets and postings saved by staff through `POST /postings` get the same value. `basisOf` (`packages/engine/src/judgeCommon.ts:288`) then reports `confirmed` evidence for a source fact.
- Effect today is small: ratings and verify rows are `agent_private`, so `network.ts:4294` skips them, and the open-turn context needs `shareable`. The staff-written company facet (`S/postings.ts:57`) is `shareable` and stays on the manager, so it counts as member-confirmed in `S/runtime.ts:725` for the manager's own context. A posting facet moves to the seat in the snapshot, so it does not reach that context.
- Fix direction is out of scope.

### GS-3. Export omits stated private facts

- Where: `S/service.ts:834`, `:737`.
- The export filter is `privacy_scope <> 'agent_private'`. The join zip is `said` and `agent_private`. An accepted suggestion the member kept at `agent_private` is the same. Neither is in the export, although the function comment says "what they told it".
- The rating is excluded on purpose (`S/service.ts:1608-1610`). The filter does not separate these cases.
- Confidence medium: legal scope of export is not stated for these rows.

### GS-4. Closed posting reopens

- Where: `S/postings.ts:141-150`, `N/src/jobs.ts:196,242`, `N/src/network.ts:4610-4620,4577-4585`.
- Trigger A: staff close post `p`. Later staff call `POST /postings` with `id: p` to fix pay. `status: "active"` is forced. `prev.openings` is `Number("0") || 1` = 1 (`jobs.ts:242`), so the original count is lost. Audit says `save_posting`, not reopen.
- Trigger B: manager sends "update my analyst post", gets a read-back. Staff close the post. Manager says yes. `storedPosting` still finds the row, `postingFromDraft` sets `active`, and the reply says updated. `managerProblem` is the only guard.
- `peon-postings.integration.test.ts:123-125` covers close only. No test states whether reopen is intended. If it is intended, the `closed` state in `POSTING_COPY.readBackClose` ("no new candidates are sent") is still false for trigger B.
- Also, `stored()` reads outside the unit (`S/postings.ts:127,140`), which widens trigger A.

### GS-5. Silent expiry

- Where: `N/src/jobs.ts:229` (`horizonDays: 90`), `packages/engine/src/world.ts:207`, `packs/peon/profile.ts:155,188`, `S/postings.ts:30`, `N/src/jobs.ts:196`.
- Trigger: post on day 0. On day 91 the engine has no live intent, so `p.open` is false and the rule gives `job_closed`. The row is `active`, the openings facet is positive, `postingsOf` says active, and the manager gets no message. `update` keeps `createdAt`, and the upsert does not write `created_at`. The only cure is a new post.
- In-flight seat items continue, since `checkSeats` tests status only (`network.ts:4548`).

### GS-6. Local-only is not enforced

- Where: `O/src/apps.ts:21`, `O/src/sources/real.ts:864`, `S/service.ts:1810-1816`, `0011:45`, AGENTS decision 4, `docs/mvp-plan.md:13-14`.
- Peon: registry true, so `POST /matching {"on":true}` with an admin token on the service succeeds. Only the console refuses. This confirms observatory.md:743.
- Friends: `PACK_READY` holds all apps but peon. The console turns friends on with no lock. The plan says friends "runs locally only".
- Sends still need `FRIENDS_LIVE_APPROVED` or `PEON_LIVE_APPROVED` (`S/channel.ts:95`). So the real gap is matching, review load and dry-run sends, not a live text.
- Open question for the founder: `docs/runbook-platform.md:129` says that an admin may turn friends on, and the two documents disagree.

### GS-7. Console and docs misstate the gate

- `O/src/health.ts:334` returns `locked` when `matchingAllowed(app)` is false, before it reads the stored switch. After a direct `POST /matching on` for peon the overview says `locked`, and `:67` says matching is off, while engine runs occur.
- `O/src/sources/real.ts:544,820`: with no stored state the fallback is `matchingAllowed(app)`, which reads on for ntwrk, slop and friends while the service default is off. `admin.tsx:398` shows "on". Window: until the first save.
- Silent reset: `S/runtime.ts:361` writes `false` into stored state with no `matching_switch` event. Config history (`real.ts:807-820`) ends on `on` while the true value is off. After a registry false then true cycle, matching stays off with no reason shown.
- Stale docs and comments: `docs/deploy.md:400` asks to see `"matching":"off"` for slop and peon in the boot log, but the log prints `allowed` (`deploy/backend/server.ts:98`), because of 0011. This go-live check cannot pass. Same stale text: `docs/runbook-platform.md:20,129`, `docs/runbook-real.md:362`, `docs/network.md:107`, `S/service.ts:1809`, `0003:44`.

### GS-8. No stored state skips the override

- Where: `S/runtime.ts:361` (`if (state && ...)`), `S/service.ts:380,382`.
- A `devMatching` network with a false registry row and no stored state keeps `opts.matchingEnabled = true` for the first tick. `devShortcutsAllowed` limits `devMatching` to dev. `ServiceOptions.network` could carry the same flag, and `spec.matchingEnabled ?? true` fails open for a caller without a registry. Production uses `fromDatabase`, which passes the row, and no production caller sets the flag.
- Report as a latent ordering issue only.

### GS-9. Join mode paths differ

- `enroll` (`S/service.ts:1478-1495`) never reads `joinMode` for the invite case. If peon or friends becomes `invite` (open decision, mvp-plan 84), a person who answers "work" joins with no invite, and the web and MCP refuse the same person.
- `waitlist` on the same path pushes the app to `joined` (`:1493`), so `enrolledText` tells the person they are in. The membership is `onboarding`, with no member and no exit (SS-12). Web join returns `ok: true` for the same state.
- MCP reads the constant (`S/serve.ts:61`), so a row edit makes `start_signup` tell the person to sign up at a page that refuses them, or the reverse. `packages/mcp/src/apps.ts:2-3` claims no drift.
- A row edit needs a restart, which the runbook does not say.
- `platform.apps.status = 'paused'` looks like an emergency stop and does nothing (section 7).
- Latent: no effect with the seeded values.

### GS-10. Forget leaves ids in run summaries

- Where: `S/runtime.ts:521-551` (no statement on `network.matching_runs`), `O/src/engineCapture.ts:13-16` (`top[].participants`, `key`), `:38` (`proposalIds`).
- Trigger: A is in a top-30 pair on a daily run. A deletes everything. `events`, `capital_events`, `feedback` and `messages` are scrubbed by id. The summary still holds A's member id, paired with B, with score components, for ever. No retention job touches the table, and the row is read by the console.
- The audit lists it: `docs/audit/2026-10-08-weaknesses.md:319` (network-service-14) and test row SVC-20 (`docs/audit/2026-10-08-test-plan.md:138`). `grep` finds no such test or scrub.
- Partial mitigation: `members.person_id` is nulled, so the id no longer maps to a person, and the member row keeps the same id by design. So this is a retained relationship record, not a retained name. PRD SEC-005 asks that deletion includes derived data where feasible.

### GS-11. `run_id` hard-codes New York

- Where: `N/src/network.ts:3448`, `O/src/engineCapture.ts:22`, `S/runtime.ts:159`, `O/src/sources/real.ts:711`.
- For `ntwrk:sf` the summary id ends in `-sf`, the opportunity `run_id` ends in `-nyc`, and the console link finds no run.
- Latent: every seeded network is in NYC. Same family as SS-11.

## 12. Modelling summary

| Id | Decision | Priority | Model with |
|---|---|---|---|
| facet-row-status | Constant by origin, not a machine | P2 | Leak and matching input model |
| agent-signal-review | Model | P0 | Consent model |
| facet-privacy-scope | Constant, plus one preview action | P2 | `profile-suggestion` |
| job-posting-status | Model | P1 | peon seat capacity |
| intent-withdrew | Skip, dead in production | P2 | none |
| app-status | Skip, dead | P2 | none |
| app-join-mode | Model parameter | P1 | `sql-membership`, signup journey |
| network-matching-gate | Model, small | P1 | Tick model precondition |
| matching-run-log | History variable | P2 | Forget invariant |

Suggested small cross-check: one spec with `allowed`, `stored`, `consoleLock`, `joinMode` as parameters and the actions `consoleOn`, `serviceOn`, `boot`, `load`, `enroll`, `webJoin`, `mcpAdvice`. Bounds: 2 apps, 2 instances. Expected counterexamples on today's code: GS-6, GS-7, GS-9.
