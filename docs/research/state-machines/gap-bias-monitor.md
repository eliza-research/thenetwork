# Weekly bias monitor: state machines

Key: `gap-bias-monitor`. Date: 2026-11-07. Branch: `claude/quint-state-machines`.

This report covers the weekly bias monitor. Earlier reports have one line on it (`network-service-outbound.md:718`) and catalogue entries only.

Method: I read the code in the file list at the end. I also ran the pure functions `biasRows`, `biasReport` and `biasAlerts` on small hand-written inputs. That script is in the session scratchpad, not in the repository. It calls no model and no external service. I did not run `weeklyBias` on Postgres.

## 1. Short answers

| Question | Answer | Evidence |
|---|---|---|
| Does a bias alert have open, acknowledged or closed states? | Not on the report. `network.bias_reports` has no state column, and the service role has only `select, insert`. The ops layer has a derived `open` boolean in `network.ops_alerts`. There is no acknowledged state anywhere. The open state closes by itself about 24 h after the report. | `0014_photo_consent_bias.sql:14-22,35`; `0020_cost_ledger_ops_alerts.sql:31-40`; `deploy/backend/ops.ts:246,288,415-424` |
| Is a skipped week detected? | No. The ops probe reads only `sum(alerts)` for the last 24 h. No code reads the age of the newest report. A missing report reads as 0 alerts. | `deploy/backend/ops.ts:246,288`; `service.ts:539-553` |
| Who can run the monitor by hand? | Nobody. `force` is used only by one integration test. There is no staff route that runs it. | `service.ts:535,539`; `packages/network/test/profile-suggestions.integration.test.ts:1112,1117` |
| Is the weekly run tested? | The cadence guard is not tested. The only caller in a test passes `force = true`. The `bias_report` alert is tested with a fake metric value (`scripts/sim/ops.ts:48,54,371`). Nothing tests the real path from report row to alert. | `git grep` for each symbol |

## 2. Machines in this report

| Id | Kind | Priority | State lives in |
|---|---|---|---|
| `bias-report-cadence` | implicit | P1 | `max(network.bias_reports.at)` per network, plus the clock |
| `bias-alert-lifecycle` | implicit | P1 | Report row `alerts`, `[alert] bias` log line, `network.ops_alerts` row with key `bias_report:<network>` |
| `bias-group-verdict` | implicit | P2 | Derived per report and per group, stored in `report` jsonb |

The design has three layers:

```
afterTick (each ran tick, slop only)
   |  7-day guard on max(at)
   v
weeklyBias: read members -> read opps from memory -> biasReport -> insert row -> log lines
   |
   +--> report row (immutable)
   |       |  read each minute by the ops probe: sum(alerts) where at > now - 24 h
   |       v
   |    evaluate(): Alert key bias_report:<network>, warn, bump
   |       v
   |    AlertDispatcher: network.ops_alerts, webhook or log line
   |
   +--> GET /bias (service) -> /api/bias (observatory) -> Metrics drawer panel
```

## 3. Inputs and constants

| Name | Value | Where | Note |
|---|---|---|---|
| `BIAS_WINDOW_MS` | 28 days | `packages/network/service/bias.ts:13` | Rows use opps by `createdAt`. |
| `BIAS_EVERY_MS` | 7 days | `bias.ts:14` | Measured from the newest stored report, so the cadence drifts later. |
| `BIAS_THRESHOLD` | 0.8 | `bias.ts:15` | Strict: exactly 0.8 is no alert (`biasMonitor.ts:49`). |
| `BIAS_MIN_N` | 8 | `bias.ts:17` | The engine default is 15 (`biasMonitor.ts:29`). The service overrides it for the 40-75 adult pilot. |
| `MONTH` | 30.44 days | `bias.ts:18` | Rates are per member-month. |
| `PHOTO_APPS` | `["slop"]` | `packages/platform/src/photos.ts:89` | Only slop runs the monitor. |
| Tick period | about 1 min | `deploy/backend/backend.ts:388-416` | The tick is the only trigger. |
| Ops round | 1 min (`OPS_EVERY_MS`) | `deploy/backend/ops.ts:93` | |
| Alert repeat | 6 h (`ALERT_REPEAT_MS`) | `deploy/backend/ops.ts:91` | |
| Post limit | 12 an hour (`ALERT_MAX_PER_HOUR`) | `deploy/backend/ops.ts:33` | |

Stored data: `network.bias_reports (app_id, id, network_id, at, members, alerts, report)`, with `id = bias_<network>_<ms>` (`service.ts:549`). `alerts` is the count of (group, metric) pairs, not of groups. The row does not store `minN`, the threshold or the window. The migration comment says "one row a week per network" but no constraint enforces that (`0014_photo_consent_bias.sql:7,14-22`).

Retention: no code deletes rows. The role has no delete grant. The console reads the newest 8 (`service.ts:556`).

## 4. Machine: `bias-report-cadence`

### 4.1 State

One network has this derived state, with `age = now - max(at)`:

| State | Meaning |
|---|---|
| `NeverRun` | No row. |
| `Fresh` | `age < 7 days`. Each tick does one read and stops. |
| `Due` | `age >= 7 days`, no run in progress. |
| `Computing` | In `weeklyBias`, after the guard and before the insert. In memory only. |
| `Stored` | Row committed. Same as `Fresh` with `age = 0`. |
| `Overdue` (implied, no code knows it) | `age` is well past 7 days. Same code path as `Due`. |

`Overdue` is the important implied state. The system cannot tell it from `Due`.

### 4.2 Transitions

| From | Event, trigger | Guard | Effect | To | Evidence |
|---|---|---|---|---|---|
| any | Tick, clock via backend timer | `runTick` got the lock and saved | Calls `afterTick` | same | `runtime.ts:658-667`, `store.ts:66-70` |
| any | Tick | Lock held elsewhere, `ran = false` | No `afterTick` | same | `runtime.ts:666` |
| any | Tick | `deliver`, `flush`, `storeStatuses` or `projectNotifications` throws | No `afterTick`. `tick failed` is logged. | same | `runtime.ts:661-666`, `backend.ts:395` |
| any | `afterTick` | App not in `PHOTO_APPS` | Nothing | same | `service.ts:535` |
| `Fresh` | Guard | `last.at` set and `now - last < 7 d`, `force` false | Return undefined | `Fresh` | `service.ts:541-542` |
| `NeverRun` or `Due` | Guard passes | none | Reads members | `Computing` | `service.ts:542-546` |
| `Computing` | `[...rt.net.opps.values()]` | none | Pure `biasReport` | `Computing` | `service.ts:547` |
| `Computing` | Insert commits | id is new | Row stored | `Stored` | `service.ts:548-549` |
| `Computing` | Insert or read throws | none | `[tick] after-tick work failed` log. No row. | `Due` | `runtime.ts:666` |
| `Stored` | Log lines | none | `[bias]` line, then one `[alert] bias` line per alert | `Fresh` | `service.ts:550-551` |
| any | Test call with `force = true` | none | Skips the guard | `Computing` | `service.ts:542` |

A clock moved back gives a negative age. The guard stays `Fresh` until the clock passes the old time. Nothing breaks.

### 4.3 Invariants and liveness

| Id | Property | Holds now? | Link |
|---|---|---|---|
| C1 | At most one report for a network in any 7-day period | Not with overlapping replicas (D8) | Migration comment; AGENTS decision 12 |
| C2 | A report holds no member id and no score | Yes. `MemberOutcome.group` and aggregates only. | `bias.ts:8`; decision 13 "never shown" |
| C3 | Only adults count | Weakly. See D11. | AGENTS age policy, decision 1 |
| C4 | Time comes from `Clock` | Yes. `this.clock.now()`, `new Date(now)` with an argument. | AGENTS code invariants |
| L1 | If ticks succeed, a due report is stored within one tick | Yes, unless a read or write fails | Decision 12 |
| L2 | A failure to run within 7 days plus a margin raises an alert | **No** (D1) | Decision 12 "Admin runs biasMonitor weekly" |
| L3 | After a failure the next tick tries again | Yes. No row means `Due` remains. | `service.ts:542` |

### 4.4 Concurrency and failure

- **Transactions.** The `max(at)` read, the member read and the insert are three separate `rt.scoped` transactions (`service.ts:541,543,548`). The opps come from process memory, not from any transaction.
- **Crash before insert.** No row. The next tick retries. Safe.
- **Crash after insert, before the log lines.** The `[alert] bias` lines are lost. The row remains, so the ops alert still fires. Safe.
- **Duplicate delivery.** Not applicable. There is no inbound trigger.
- **Two replicas.** `afterTick` runs after the tick lock is released (`store.ts:68` releases it, `runtime.ts:666` runs later). A second replica can take the lock and also reach `weeklyBias`. See D8.
- **Same millisecond.** The primary key collides and the second insert throws. `afterTick` catches and logs it. Safe, by accident. The test advances the clock by 1 ms for this reason (`profile-suggestions.integration.test.ts:1116`).
- **Shutdown.** `track(rt.tick())` includes `afterTick`, so drain waits for it (`backend.ts:392`).
- **Stale memory.** `rt.net.opps` is read outside the lock. See D13.

### 4.5 Suspected defects

**D1. A skipped week is not detected.** Confidence: high. Severity: medium.
- `collectNetwork` reads `biasAlerts` only (`ops.ts:215,246`). `evaluate` has no key for a late report (`ops.ts:288`, full list in `docs/deploy.md:427-443`).
- Trigger A: the member query fails each tick, for example from a bad migration. Each failure logs `[tick] after-tick work failed (slop:nyc): ...` once a minute. That line has no `[alert]` prefix. Ops sees no report and reads 0 alerts. `/ops/metrics` looks clean.
- Trigger B: `deliver()` throws on each tick after `runTick` has saved. `tick_late` depends on the stored tick, which is fresh, so it stays quiet (`ops.ts:275`). Whether `deliver` throws in practice is not traced.
- Console effect: the panel shows the old report in green, with only its timestamp as a hint. It has no age warning (`packages/observatory/web/admin.tsx:36-44`).
- Note: a tick outage does raise `tick_late:<network>`, so a full outage is seen. A monitor-only failure is not.

**D8. Two reports for one week with overlapping replicas.** Confidence: medium. Severity: low.
- `docs/deploy.md:74` says one replica today and that more are safe.
- Trigger: replica A ticks at the 7-day mark and is still in `deliver`. Replica B gets the lock, ticks and finishes. Both read the old `max(at)`. Both insert, with different `now` values, so the primary key does not stop it. There is no `on conflict` and no unique key on the week (`service.ts:548`).
- Effect: `sum(alerts)` doubles the count for 24 h (`ops.ts:246`). `bump` posts again if the second row lands later (`ops.ts:410`). Earlier note: `network-service-outbound.md:718`.

**D12. The member read is per app, the opps are per network.** Confidence: high that the code does this. Latent today.
- `service.ts:545` filters on `m.app_id` only. `rt.net.opps` holds one network's opps. Multi-city routing exists (`runtimeForHome`, `service.ts:482`). The migrations seed only `slop:nyc` (`0003_platform.sql:57`).
- Trigger: add `slop:la`. Each slop report then holds all slop members. Members of the other city have 0 outcomes in this report. The rate and the quintiles of both reports are wrong.

**D13. Opps are read outside the lock.** Confidence: medium. Severity: low.
- `stored()` mutates `net` between `importState` and `save` (`store.ts:53-59`). Inbound units run in the same process. If `afterTick` runs during one, it reads uncommitted stages. A failed save leaves unsaved stages in memory until the next import.
- Effect: one stage off in an aggregate. Other runtime methods use `readState` for this reason (`runtime.ts:688`).

## 5. Machine: `bias-alert-lifecycle`

### 5.1 State

The monitor has no alert entity. Three separate things carry the signal:

| Layer | Storage | Life |
|---|---|---|
| Report alert | `bias_reports.alerts`, `report.alerts[]` | Immutable. Forever. |
| Log line | `[alert] bias <network>: group ... ` | One shot. Lost in a crash. `docs/deploy.md` documents only the `"msg":"alert"` log line as a fallback (`:453`), so the `[alert]` text depends on a host rule that the repository does not show. |
| Ops alert | `network.ops_alerts` key `bias_report:<network>` | Derived again each minute from a 24 h window. |

The ops row has these states, from `open`, `lastSentAt` and membership in the current alerts:

| State | `open` | `lastSentAt` | In current alerts |
|---|---|---|---|
| `Absent` or `Closed` | false or no row | any | no |
| `OpenUnsent` | true | unset | yes |
| `OpenSent` | true | set | yes |
| `ResolvePending` | true | set | no |
| `ClosedQuiet` | false | unset | no |

There is no `Acknowledged`, no assignee and no link to the runbook's incident log (`docs/runbook-real.md:540`). The columns are `key, level, count, text, open, first_at, last_at, last_sent_at, last_sent_level, last_sent_count` (`0020_cost_ledger_ops_alerts.sql:31-40`).

### 5.2 Transitions

| From | Event | Guard | Effect | To | Evidence |
|---|---|---|---|---|---|
| `Closed` | Ops round sees `alerts > 0` in 24 h | none | New state, `firstAt = now`, due | `OpenUnsent` | `ops.ts:288,403-411` |
| `OpenUnsent` | Post | Under limit, 2xx | Sets `lastSent*` | `OpenSent` | `ops.ts:428-435` |
| `OpenUnsent` | Post | Failed | `recordPost(ok=false)`, retries next round | `OpenUnsent` | `ops.ts:428-435` |
| `OpenUnsent` | Rate limit | `postsLastHour >= max` | Held | `OpenUnsent` | `ops.ts:426` |
| `OpenSent` | Round | `now - lastSentAt >= 6 h`, or count rose | Post again | `OpenSent` | `ops.ts:408-411` |
| `OpenSent` | Row leaves the 24 h window, or the network read fails | Post ok | "resolved" notice, `open = false` | `Closed` | `ops.ts:415-421,434` |
| `OpenSent` | Same | Post failed or held | Retry | `ResolvePending` | `ops.ts:428-435` |
| `OpenUnsent` | Same | `lastSentAt` unset | Close, no notice | `ClosedQuiet` | `ops.ts:418-419` |
| any | Staff read the panel | none | `read_bias_reports` audit row. State does not change. | same | `service.ts:2355-2360` |

With defaults, one report gives 4 firing posts (hours 0, 6, 12, 18) and one "resolved" post at hour 24.

### 5.3 Invariants and liveness

| Id | Property | Holds now? |
|---|---|---|
| A1 | An alert in a stored report reaches a person | Not if ops is down or the webhook fails for the whole 24 h (D9) |
| A2 | "Resolved" means someone acted or the ratio recovered | **No** (D2) |
| A3 | A breach that lasts several weeks is visible as one continuing problem | **No**. Each week is a new alert with a new `firstAt`. |
| A4 | Text sent to ops holds counts only | Yes (`ops.ts:245,288`). Groups stay in the console. |
| A5 | The panel and `/bias` need admin or analyst for the app | Yes. `allowed` passes admin for the app (`service.ts:2248,2357`; `packages/observatory/src/staff.ts:194-198`; `server.ts:688-695`). |

### 5.4 Suspected defects

**D2. A bias alert closes itself after 24 h with no human action.** Confidence: high. Severity: medium.
- `ops.ts:246` counts rows with `at > now - 24 h`. After 24 h the alert leaves `current`, and the dispatcher posts "resolved" (`ops.ts:415-421`).
- Trigger: the report on Monday shows q1 dates at 0.5x. Nobody opens the console. On Tuesday the channel shows "resolved: slop:nyc: the weekly bias monitor found ...". q1 is still at 0.5x. Next Monday a new alert fires.
- `docs/mvp-plan.md:76` lists "under 0.8x" in the "Roll back or pause if" column of the weekly pilot table. No machine records whether that decision was made. The level is `warn` and nothing pauses ratings or matching. The runbook asks for an incident log entry (`docs/runbook-real.md:540`), which the system does not check.

**D9. An alert can vanish unsent.** Confidence: high for the code path. Severity: medium.
- `ops.ts:418-419`: never posted and no longer current means close quietly. The comment expects a short gap between rate-limited rounds. The bias alert depends on a 24 h age, so the same branch runs after a long webhook outage.
- Trigger: the webhook fails for 24 h after the report. Each post returns false. `lastSentAt` stays unset. At hour 24 the alert closes with no notice.
- Other trigger: the backend is down for 24 h after the insert. Replica startup then sees no recent row. No alert is ever created. This needs the report written just before the outage.
- Only the one-shot `[alert] bias` log line remains.

**D10. A failed network read posts a false "resolved".** Confidence: high. Severity: low.
- `evaluate` does `continue` on `n.error` (`ops.ts:274`), so no bias alert is in `current`. `seen` lacks the key, and the dispatcher resolves it (`ops.ts:415-421`). The next good round fires it again. This applies to every per-network key, not only bias.

**D14. The threshold has more than one source.** Confidence: high. Severity: low.
- 0.8 is hard-coded in the panel (`admin.tsx:41,44,48`) and in the ops text (`ops.ts:288`). A new `BIAS_THRESHOLD` would leave these wrong.
- The panel paints any group under 0.8 red, also when `n < 8`. Such a group raises no alert. A red cell can sit beside "No group under 0.8x." (`admin.tsx:42-48`).
- Reports do not store `minN` or the threshold, so an old row cannot be re-read under its own rules.
- Docs differ. AGENTS decision 12 and `docs/deploy.md:437` use 0.8. `docs/results/2026-10-08-slop-pack.md:606` says alert under 0.85x. `docs/mvp-gaps.md:220` still says "Sim-only" and 0.85x. The mvp-plan table uses both: gate 0.85x, pause under 0.8x. Between 0.8 and 0.85 the gate fails and nothing happens.

## 6. Machine: `bias-group-verdict`

### 6.1 State

For one report, each (group, metric) pair has an implied verdict. The report as a whole has an implied verdict too.

| Pair verdict | Condition | Stored as |
|---|---|---|
| `Ineligible` | `n < 8` | Group present, ratio present, no alert |
| `NoSignal` | `overall[metric] = 0` | `ratio = 1`, the same as a perfect result (`biasMonitor.ts:42`) |
| `Pass` | `ratio >= 0.8` | No alert |
| `Alert` | `n >= 8`, `ratio < 0.8` | Row in `alerts` |

| Report verdict | Condition | What the panel shows |
|---|---|---|
| `Empty` | No adult rows | "No group under 0.8x." in green |
| `Blind` | No eligible group: all `min[m].group === "-"` | Same green text |
| `PartlyBlind` | Some metric or group is `Ineligible` or `NoSignal` | Same green text if nothing alerts |
| `Clean` | Eligible groups, non-zero overall, no alert | Same green text |
| `Alerting` | At least one alert | Red lines |

The first four are different facts. The stored row can tell them apart (`min.group`, `groups[].n`, `overall`), but no reader does.

Group assignment: a rated adult gets `q1`..`q5` by rank of the overall score, ties by id (`biasMonitor.ts:55-58`). An adult with no parseable rating, which needs all of face, body, overall and conf (`appearance.ts:162`), is `unrated` (`bias.ts:37`). The group uses today's rating for the whole 28-day window.

Who is `unrated`: members with no photo, members whose rating was deleted (a ban keeps them `restricted`, `service.ts:1757`, with the rating gone, `service.ts:1596-1603`), and everyone when the rater is off. With `CLEF_RATINGS=off` or no Workers AI token, the report has one group, `unrated`, ratio 1, and shows green.

Counting, per adult in `active`, `paused` or `restricted` with `joined_at` set and at least one day in the window (`bias.ts:26`, `service.ts:545`):

| Metric | Rule | Evidence |
|---|---|---|
| `proposals` | Opps in the window with this member in `participants`, stage past review | `bias.ts:32,39` |
| `dates` | Opps in the window, stage `done`, `meetingAt <= now` | `bias.ts:33,40` |
| `secondDates` | Pairs with 2 or more `held` opps in the window | `bias.ts:34-35,41` |

### 6.2 Invariants

| Id | Property | Holds now? |
|---|---|---|
| V1 | `alerts` is exactly the eligible pairs with ratio under the threshold | Yes (`biasMonitor.ts:47-49`) |
| V2 | "No alert" means the groups were measured and passed | **No** (D4) |
| V3 | `secondDates`, "the one to watch" (`biasMonitor.ts:8`), can fire on slop | **No** (D3) |
| V4 | `proposals` counts proposals that reached the member (`bias.ts:5`) | **No** (D6) |
| V5 | `dates` counts dates held (`bias.ts:5`) | **No** (D7) |
| V6 | Overall rate is over members who can be matched | **No** (D5) |
| V7 | Monitor covers "rating quintile and group" | **No** (D15) |

### 6.3 Suspected defects

**D3. `secondDates` cannot fire on slop, and the meet-again flow is dead there.** Confidence: high. Severity: high for this monitor.
- `localEncounters` composes the second date with `category: "social"` (`network.ts:3818`). `submit` closes any opp outside the app's categories (`network.ts:2050-2053`). Slop allows only `romance` (`network.ts:224`). The service does not pass `allowedCategories` (no match in `packages/network/service`).
- The pair's mutual "again" is deleted first (`network.ts:3816`), so there is no retry.
- The closed opp has `closedFrom = "review"`, so `bias.ts:32` does not count it.
- The engine cannot supply a second date either. `already_introduced` refuses a pair with a `met` edge or a post-reveal interaction (`packages/engine/src/packs/slop/rules.ts:91-100`). `gateReason` adds a 60-day block after a completed meeting (`network.ts:3607,1747-1757`).
- Remaining paths, not fully traced: a member request for a pair where nobody gave feedback (the `completed` interaction is written only on feedback, `network.ts:2641`), and staff-composed opps.
- Result: `overall.secondDates` is about 0, so every ratio is 1 (`biasMonitor.ts:42`). My run confirmed this: q1 with 0 dates reads `secondDates: 1`. Also, `docs/mvp-plan.md` "Second-date rate 20% or more" cannot be measured from these opps.
- Trigger: A and B date, and both say they want to meet again. At the next daily run the opp is created and closed as "category not allowed". The `gatedOut` counter rises. No second date is proposed.
- This is a defect in the consent network as much as in the monitor. The sim does not show it, because the slop world computes second dates itself.

**D4. A report with no statistical reach reads as a clean pass.** Confidence: high. Severity: high.
- `biasMonitor.ts:48` gives `{group: "-", ratio: 1}`. `admin.tsx:42-44` prints green "No group under 0.8x." whenever `alerts` is empty.
- q1 has `ceil(rated / 5)` members, so q1 can alert only with 36 or more rated adults. The pilot is 40-75 adults, and not all will have photos.
- My run with 35 rated adults and q1 at 0 dates: five groups of 7, `alerts: []`, every `min` is `"-"`.
- Other triggers: matching off (`overall` is 0, all ratios 1), rater off (one group), first weeks of the pilot.
- `ops` sees 0 alerts. A blind report also resets the 7-day guard, so it counts as a week done.

**D5. The overall rate includes people who cannot be matched.** Confidence: high for the arithmetic, medium for its size. Severity: high.
- `biasMonitor.ts:34` adds every row to `tot`. `service.ts:545` filters only on `account_status`. It does not filter on `opted_out`: STOP writes only that column (`runtime.ts:519`). It does not filter on `paused`, on the onboarding stage, or on the romance opt-in.
- Each such member adds member-months with no outcomes. This lowers `overall` and raises every other group's ratio.
- My run: 40 rated adults, q1 at half the rate of the rest. Alone, q1 dates are 0.56x and q1 alerts. With 40 unrated members at 0 outcomes added, q1 dates become 1.11x, and the alerts move to `unrated`.
- So the quantity the monitor exists to catch, low-rated members starved of dates (`biasMonitor.ts:7`), can be hidden. `unrated` may also alert every week as noise, which trains staff to ignore it.
- Note: a missing rating is neutral in scoring, so `unrated` members with complete profiles can match. The effect depends on how many unrated members are not matchable. I do not have production data.

**D6. `proposals` counts people the proposal never reached.** Confidence: high. Severity: medium.
- `BiasOpp` has no `contacted` field (`bias.ts:21`), although the Opp has one (`network.ts:352-353`).
- Probes are sequential. The second member is probed only after the first says yes (`network.ts:2137-2143`). If the first says no, the opp closes from `probing`, and the second member was never contacted.
- `bias.ts:32` counts both. My run: `closedFrom: "probing"` gives `[1, 1]`.
- Also, a member replaced after a probe leaves `participants` (`network.ts:2383`), so a member who really was reached is not counted. And a probe waiting for its send window counts before it is sent.
- Effect: this credits the passive side. If low-rated members are more often second, the metric hides their lack of real reach. I did not measure which side they are on.

**D7. `dates` counts booked dates, not held ones.** Confidence: high. Severity: medium.
- `stage = "done"` is set at `meetingAt + 3 h` with no attendance check (`network.ts:3405-3406`). Attendance comes later in `finalize` and `o.post` (`network.ts:2734-2745`), and `biasRows` reads neither.
- Trigger: B ghosts A. The opp is `done`. Both count a date held. A ratio of the group that ghosts or is ghosted looks normal.

**D11. Age check bypasses the policy helpers and the person-level age.** Confidence: high for the code, low for the harm. Severity: low.
- `bias.ts:26` hard-codes `m.age >= 18`. AGENTS says to use `canBeMatched` and not to hard-code ages. Elsewhere `canBeMatched` is exported from `packages/core/src/policy.ts:24`.
- `service.ts:543` reads `m.age`. Matching reads `platform.matching_ages`, `least(m.age, p.lowest_age, f.lowest_age)`, because propagation to the app row can fail or lag (`0038_matching_age_floor.sql:1,7`; `snapshot.ts:85-87`).
- Trigger: a person states 16 on another app and propagation fails. The slop row stays 25. The person is in the adult rows and in a quintile if a rating remains. The output is aggregate and nobody is contacted, so this does not break "minors never matched". It breaks "lowest age wins".

**D15. The "group" half of the monitor does not exist.** Confidence: high. Severity: medium.
- `docs/mvp-plan.md:76`, `docs/prd-snapshot.md:1520,1543` and `bias.ts:2` name "rating quintile and group". `BiasMember` has no demographic field (`bias.ts:20`). The service passes only quintiles. `biasMonitor.ts:5-7` and `clef-fit/audit.ts:79` support real groups, so the gap is only in the service.
- A rater that lowers ratings for one demographic group would show only as that group's members moving to q1. The monitor would not attribute it.

**D16. Leavers disappear from the window.** Confidence: high. Severity: low to medium.
- `forget` deletes every opp that names the member (`network.ts:920`), and leaving the app is a forget path (`runtime.ts:520`). The counterpart's date goes too, so a stayer's `dates` falls.
- The leaver leaves `rows`. A low-rated member who gave up after no matches stops counting as starved. This is survivorship: the worst outcomes leave the denominator.

**D17. Second dates spanning the window are lost.** Confidence: high. Severity: low. Moot until D3 is fixed.
- `recent` filters on `createdAt` (`bias.ts:31`), and both dates must be in the 28 days. A second date five weeks after the first is not counted. The 60-day gate would make this the usual case for any flow subject to it.

Observations, not defects:
- `/bias` and `/api/bias` write the audit row with `ok: true` before the read (`service.ts:2358`, `server.ts:691`). The result is not recorded. This is the one-phase read pattern (`observatory.md:197`).
- Groups with `n` as low as 1 are in the report with exact rates. No id or score is present, and only admin or analyst can read it.
- A ratio on 8 members over 28 days is noisy. There is no interval and no two-week rule, unlike the "for 2 weeks" row above it in the plan. The 28-day window also means one bad cohort alerts for up to 4 weekly reports.
- The comparison is to the overall rate, which includes the group itself. The classic four-fifths rule compares to the best group. This is a stated choice (`bias.ts:7`).

## 7. Interactions with other machines

| Machine | Shared | Direction |
|---|---|---|
| `tick-lock` and `network-state` (`network-consent-core.md`, `network-service-outbound.md`) | `ran` gates the monitor, `rt.net.opps` is the data source | Read |
| Opportunity stage machine | `stage`, `closedFrom`, `meetingAt`, `createdAt`, `participants` | Read. Stage meanings drive D6, D7. |
| Second encounter and `again` | D3 | Read, indirect |
| Rating lifecycle (`writeRating`, `dropRatings`) | `appearance:*` tags | Read. The rating row has one id, updated in place (`service.ts:1616-1619`), so old and new tags do not mix. Older per-photo rows are removed on drop. An old row that survives could mix tags, since `array_agg` has no order. |
| Facet source fence | `automatedFacetPredicate(tx, true)` keeps Google-derived tags out | Read. Covered by the one integration test. |
| Member lifecycle, STOP, leave, ban | `account_status`, `opted_out`, `forget` | Read. D5, D16. |
| Age floor | `m.age` not `matching_ages` | D11 |
| Ops alert dispatcher (`deploy-ops.md`) | `ops_alerts`, webhook, rate limit | One-way from report to alert. |
| Observatory console | `/bias`, panel | Read only. Nothing flows back. |

Process boundaries: backend tick to Postgres, ops round to Postgres, observatory to service over staff HTTP (`sources/service.ts:212-218`). The cost ledger is not touched: the monitor makes no model call.

## 8. Quint modelling notes

Model `bias-report-cadence` and `bias-alert-lifecycle` together, as one module. Model `bias-group-verdict` as pure definitions, or leave it to a table test. The Quint value is mostly in the first two.

**State variables**

```
var now: int                         // in hours; step 1 or 24
var reports: Set[{ at: int, alerts: int }]   // append only
var opsRow: { open: bool, lastSent: Option[int], count: int, firstAt: int }
var webhookUp: bool
var monitorHealthy: bool             // false: read or insert throws
var tickRan: bool
var acked: bool                      // ghost: human action. No code writes it.
var replicas: Map[int, { phase: Idle | Read(Option[int]) }]   // for the D8 race
```

**Actions**

- `advanceClock`
- `tick(r)`: nondeterministic lock result. Sets `tickRan`.
- `guardRead(r)`, then `insert(r)`: two steps, so that two replicas interleave.
- `opsRound`: computes `sum(alerts) where at > now - 24h`, then `dispatch`.
- `dispatch`: firing, repeat, resolved, quiet close.
- `failWebhook`, `healWebhook`, `failMonitor`, `healMonitor`, `opsReadError`.
- `staffAck`: ghost action, to show that nothing depends on it.

**Invariants to check, expected results**

| Name | Formula idea | Expected |
|---|---|---|
| `AtMostOneWeekly` | No two reports with `abs(a.at - b.at) < 7d` | Fails with 2 replicas (D8) |
| `ResolvedMeansAcked` | `opsRow.open` goes false with reports alerting only if `acked` | Fails (D2) |
| `NoFalseResolve` | Resolve only if the newest report has `alerts = 0` | Fails (D2, D10) |
| `AlertDelivered` | Report with `alerts > 0` implies a sent post, with weak fairness on the webhook | Fails if the webhook is down for 24 h (D9) |
| `ReportAgeBounded` temporal | `always(eventually(now - lastReport < 8d))` under tick fairness | Passes only when `monitorHealthy` is fair |
| `StaleIsSignalled` | `now - lastReport > 8d` implies an open alert | Fails, no such alert exists (D1) |
| `CountIsDistinct` | `sum(alerts)` equals alerts of one report | Fails with duplicates (D8) |

**Pure table model for verdicts.** Small enumerations:

- `n` in `{0, 7, 8}`, `overall` in `{0, >0}`, `ratio` in `{0.5, 0.8, 1}`.
- `reportVerdict` must return different values for `Empty`, `Blind`, `Clean`. The state is present in the data, so the check is on the reader: `panelText(verdict)` must differ. Expected to fail (D4).

**Abstractions**

- Hours as integers. 7-day cadence, 24 h window, 6 h repeat. Three weeks of steps is enough: bound `now` at 504 with step 1, or use step 6 for speed.
- Replace rates by a boolean `breach` per report.
- Rate limit: model as a nondeterministic `held`.
- Keep the 1-minute tick out. One `tick` an hour is enough, since the guards are on days.

**Merge notes.** Reuse the alert dispatcher model from `deploy-ops.md` if one exists; `bias_report` is only one key, with a 24 h source window and `bump`. Model D3 in the opportunity machine, not here: add `submit` category rejection to the `second_encounter` path and check "mutual again on slop eventually gives a review item".

## 9. Priority of follow-up, for the reader

This section does not propose fixes. It orders what to confirm first.

1. D3: confirm with one integration run on `slop:nyc` with a mutual "again". It also affects members, not only the report.
2. D5 and D4: these decide whether the monitor can catch what decision 12 wants. Check with real member counts.
3. D1 and D2: the state gaps the task asked about.

## 10. Files read

The list is in the coverage file for this key. Sections read in part, for large files: `packages/network/src/network.ts` (the opp, close, probe, feedback, gate, encounter and export parts), `packages/network/service/service.ts` (the parts cited), `packages/network/service/runtime.ts` (the tick and unit parts), `docs/mvp-plan.md`, `docs/deploy.md`, `docs/runbook-real.md`, `docs/prd-snapshot.md` (matches only).
