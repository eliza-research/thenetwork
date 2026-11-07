# Gap report: the active member journey (daily use after join)

Scope: one active member from the first message after onboarding, through open turns, agent context, set-state, signals, updates, MCP tools, notify surfaces, pause and resume, and profile edits. Plus the 13-17 single-player path.

`journey-signup.md` stops at joining. `journey-match.md` starts at the engine run. This report covers the time between them, and how the machines compose.

Hand-written. Nothing here is generated. No code was changed. No database was queried and no test was run. Two small read-only probes ran pure functions (`outputLeaks`, `parseJoinText`, `parseJoin`, `classify`, `detectKeyword`). A defect marked "probe" used these. A defect marked "trace" comes from reading.

Path prefixes:

| Prefix | File |
|---|---|
| `S` | `packages/network/service/service.ts` |
| `R` | `packages/network/service/runtime.ts` |
| `I` | `packages/network/service/inbox.ts` |
| `SN` | `packages/network/service/snapshot.ts` |
| `RE` | `packages/network/service/relay-endpoint.ts` |
| `N` | `packages/network/src/network.ts` |
| `SCH` | `packages/notify/src/scheduler.ts` |
| `T` | `packages/mcp/src/tools.ts` |
| `H` | `packages/mcp/src/hooks.ts` |
| `A` | `packages/platform/src/accounts.ts` |
| `API` | `packages/platform/src/api.ts` |
| `C` | `packages/core/src/svc/contract.ts` |

Other reports cited: `network-service-inbound.md` (IN), `network-harness.md` (HA), `mcp-oauth.md` (MO, defects D1-D23), `journey-signup.md` (J1-J16), `journey-match.md` (JM), `journey-exit-safety.md` (JE), `gap-status-columns.md` (GS), `blooio-notify.md` (BN), `implicit-sweep.md` (IS), `core.md` (CO).

## 1. Summary

### 1.1 Machines

| id | Kind | Priority | State lives in | New here? |
|---|---|---|---|---|
| `turn-disposition` | implicit | P0 | return value of `handleInbound`, `TurnResponse` | new |
| `agent-context-projection` | implicit | P1 | `sharedContext` output, `inbound.response.context` | new |
| `minor-single-player` | implicit | P0 | `MemberState.minor`, `people.lowest_age`, `TurnContext.singlePlayer` | new as a machine |
| `member-status-projection` | implicit | P1 | six stores read as one status | new |
| `profile-stores` | implicit | P1 | `memberships.profile`, `members`/`presence`, `MemberState.learned` | new |
| `member-conversation` | explicit | P1 | `MemberState.stage`, `awaiting`, `pendingAck` | extended |
| `open-turn-binding` | implicit | P1 | `inbound.response` plus live recheck | extended |
| `action-receipts` | explicit in JSON | P1 | `inbound.action_receipts` | extended |
| `inbox-read-seen` | implicit | P1 | `notify.inbox_items.seen_at` | extended |
| `assistant-surface-signal` | implicit | P2 | `notify.surface_signals`, `deliveries.outcome` | extended |
| `participation-window` | implicit | P1 (was P2) | `members.participation_state`, `_window` | extended |
| `active-member` composite | composite | P0 | all of the above | new |

### 1.2 Defects, most severe first

| id | Title | Priority | Confidence |
|---|---|---|---|
| AJ1 | One member named "Nyc" or "Sf" silences every other member of the app | P1, availability | High, probe. Not run end to end |
| AJ2 | A long text from a minor never reaches the agent. A crisis text gets a venue list | P0, safety gap | High, probe |
| AJ3 | `singlePlayer` and `m.minor` are two definitions. A soft minor gets `singlePlayer:false` | P0 | High, trace |
| AJ4 | A minor mid-interview gets the adult questions (when free, which neighborhood) | P1 | High, trace |
| AJ5 | Inbox items that name adults stay readable after a member becomes a minor | P1 | High, trace |
| AJ6 | A hyphen or apostrophe first name that contains another first name gives permanent silence | P1 | High, probe |
| AJ7 | A peon manager with over 50 shareable facets gets permanent silence | P1 | High, trace |
| AJ8 | `resume` is START. It says "Welcome back", no model runs, and the pause stays | P1 | High, probe |
| AJ9 | `traveling` changes nothing but the budget. No writer for trips, no reader for `travel` signals | P1 | High, trace |
| AJ10 | A text-only active member has no way to change their profile, and the read shows old data | P1 | High, trace |
| AJ11 | Slop onboarding stalls for good after the 3-day `awaiting` expiry when matching is off | P2 | High, trace |
| AJ12 | `check_status` says active for a held member. `submit_profile` says submitted and drops it | P2 | High, trace |
| AJ13 | A paused member can get a weekly check-in or an engine ask inside the 48-hour follow-up window | P2 | High for check-in, medium for ask |
| AJ14 | Inbox items never expire. A closed probe reads as a new update weeks later | P2 | High, trace |
| AJ15 | `/internal/updates` has no output gate. MCP `get_updates` has one | P2 | High, trace |
| AJ16 | The agent cannot see open items. A second "what's going on?" gets nothing | P2 | High, trace |
| AJ17 | An open turn is never a thread reply. Replies count as ignored on the channel | P2 | High, trace |
| AJ18 | Wire `open` cannot reach stored `open`. `receiving` and account `paused` have no writer | P2 | High, trace |
| AJ19 | SF members get New York venues | P2 | High, trace |
| AJ20 | A member who turned 18 stays a minor with no exit | P2, founder decision | High, trace |
| AJ21 | Small participation drifts: `note` is write-only, `/api/me` shows a future window as current, resume does nothing for `busy` | P2 | High, trace |
| AJ22 | `submit_profile` can text the member at once inside quiet hours | P2 | Medium, trace |

### 1.3 The three findings to read first

1. **Silence is a real state.** A `handled` turn with no replies sends nothing and calls no model (`C:108`). That is correct for an acknowledgement. It is wrong when it is the only outcome the member will ever get. AJ1, AJ6 and AJ7 reach it through `context_unavailable`. No test asserts a reply there. There is no alert and no fallback text.
2. **The minor path is not a chat.** AGENTS.md says minors "can use the agent for themselves (chat, events, things to do)". The code sends any "other" text over 12 characters to a canned venue reply (`N:835`). Only texts of 12 characters or less can reach Eliza. "pause my messages for two weeks" and "i want to kill myself" both classify as `other` (probe). The first gets places to go. So does the second.
3. **Pause, profile and status have no single owner.** Five things are called "paused". Three stores hold a profile. Six stores decide what the member's status is. Agent tools see a different subset from the agent in the thread, which sees a different subset from the engine.

## 2. The journey, step by step

### 2.1 One inbound text

```
Gateway -> POST /internal/turn (S:1976)
  claim platform.inbound (I:81)                 status processing
  NetworkService.inbound (S:1006)
    route (S:957)
    STOP / STOP ALL -> stop()                   S:1054
    held number -> nothing but HELP             S:1061
    photo consent, photos                       S:1070-1076
    leave <app>                                 S:1079
    non-member, no read -> join                 S:1140
    START                                       S:1100
    SHARE, looking-for                          S:1113-1118
    stopHint                                    S:1121
    memberMessage -> memberUnit (S:1222, 1233)
      profile read? system reply                S:1245
      n.onInbound -> handleInbound              N:595, 673
    statedAge                                   S:1123
  admission, binding (S:2079-2086)
  outcome open and nothing collected:
    sharedContext (R:698)
    context -> open | null -> handled "context_unavailable"
  else handled
  seal row done (I:117)
  replay recheck of open context (S:2098)
```

### 2.2 What `handleInbound` does, in order

Each line is a stop. The first that applies ends the turn. This is the real decision list for daily use.

| # | Test | Result | Line |
|---|---|---|---|
| 1 | keyword STOP, START, HELP | deterministic | N:675-677 |
| 2 | age rules: decline, conflict, minor transition | decline, or `minorNotice` | N:697-729 |
| 3 | stage `new` | welcome | N:730 |
| 4 | stage `age` | `afterAgeQuestion` | N:731 |
| 5 | block or report | safety flow, or learned for MCP | N:740-743 |
| 6 | `pendingSafety` answer | safety flow | N:745 |
| 7 | trust hold | **nothing**, no reply | N:746 |
| 8 | swap ask in a match | `open`, unscored | N:751 |
| 9 | abuse | scored, reply | N:752 |
| 10 | peon posting turn | deterministic | N:755 |
| 11 | MCP and not a people request | learn quietly | N:759 |
| 12 | `awaiting` probe, crew, booked, checkin | deterministic | N:760-798 |
| 13 | `cancel` of a booked plan | deterministic | N:799 |
| 14 | feedback | deterministic | N:804 |
| 15 | engine ask answer | learn, next question | N:814 |
| 16 | growth name | invite or "not open" | N:820 |
| 17 | onboarding answer, stage not active | learn, next | N:824-830 |
| 18 | people request, adult | `openRequest` | N:833 |
| 19 | plans request, or people request by a minor | `onPlans` | N:834 |
| 20 | **minor, kind `other`, over 12 chars** | **`concierge`** | N:835 |
| 21 | `ACK_ONLY` | nothing | N:836 |
| 22 | anything else | `open` | N:837 |

Step 22 is the only way into a model. Two things follow.

- After onboarding, nothing in steps 1-22 calls `learnFrom` for a member's free text. See AJ10.
- There is no "pause" or "resume" branch. Those words reach step 22 only if a keyword did not take them first. See AJ8.

### 2.3 What the agent can do in an open turn

| Action | Path | Effect | Lives on |
|---|---|---|---|
| set state | `/internal/set-state` | `members.participation_*`, event | S:1935-1950 |
| signals | `/internal/signals` | `facets` row `proposed`, event | S:1952-1961 |
| updates | `/internal/updates` | marks seen, returns summaries | S:1911-1931 |
| relay | `/internal/relay` | relay desk, off until `NETWORK_RELAY_ENABLED=1` | RE:136 on |

The agent has no action to edit a profile, cancel a date, answer a probe, or read an open item. Those stay deterministic, or do not exist.

### 2.4 What the assistant can do through MCP

`app_info`, `start_signup`, `check_status`, `submit_profile`, `get_updates`, `prepare_signup` (`T:11`). No pause, no resume, no state read, no profile read. The assistant cannot see participation at all. See 3.4.

## 3. Machines

### 3.1 `turn-disposition` (P0)

**Kind:** implicit. **State:** the outcome of one turn. **Wire:** `TurnResponse` (`C:107-138`).

States of a turn outcome:

| State | Replies | Model | When |
|---|---|---|---|
| `open` | none | yes | step 22, `swapAsk`, context present |
| `handled_said` | 1+ | no | any deterministic reply |
| `handled_quiet_ok` | 0 | no | an ack folded for later (`N:3849`), `ACK_ONLY` |
| `handled_quiet_blocked` | 0 | no | trust hold (`N:746`), concierge or plans with no venues left |
| `handled_context_unavailable` | 0 | no | `open` from the Network, `sharedContext` null (`S:2089-2096`) |
| `ignored` | 0 | gateway choice | no network, unknown sender |

The difference between the three quiet states is not on the wire, except for `reason`. A member cannot tell them apart.

Transitions:

| From | Event | Guard | To | Where | Actor |
|---|---|---|---|---|---|
| start | Network returns `open` | nothing collected, binding ok, context non-null | `open` | S:2089-2092 | member |
| start | Network returns `open` | context null | `handled_context_unavailable` | S:2096 | member |
| start | Network returns `open` | collected non-empty (stop hint) | `handled_said`, `reason` reads `context_unavailable` | S:2089, 2096 | member |
| start | Network returns `handled` | collected non-empty | `handled_said` | S:2094 | member |
| start | Network returns `handled` | collected empty | a quiet state | S:2094 | member |

Invariants wanted:

- INV-D1: a member with an active membership whose turn is `handled_context_unavailable` is a transient state. It fails. See AJ1, AJ6, AJ7.
- INV-D2: a quiet outcome never repeats for a text the member sent as a question. Cannot be stated without a model of intent. Use a nondet `isQuestion`.
- LIVE-D1: from an active member with no hold and no STOP, a question eventually gets a reply. It fails for the same cases.

Interactions: every other machine feeds it. Concurrency: covered in IN.

Quint: model outcome as a sum type. It is the join of the other machines. See 9.

### 3.2 `agent-context-projection` (P1)

**State:** computed per turn by `sharedContext` (`R:698-735`). Stored once in `inbound.response.context`. Recomputed on every replay (`S:2098-2104`).

**Output states:** `context`, or `null`. Causes of `null`:

| Cause | Where | Exit |
|---|---|---|
| no address or no accounts | R:703 | n/a |
| `activeMembership` none | R:704-705 | STOP, leave, review, ban, age |
| member not in snapshot | R:708 | n/a |
| `state` not mapped | R:714 | none reachable |
| `safe(firstName)` false | R:724 | **none** |
| `safe(homeCity)` false | R:724 | **none** |
| over 50 facets, or one over 300 chars | R:729 | **none** |

Guard detail, `R:716-723`:

- `forbidden` holds the phone, person id, every facet id, every other member's id, every other member's full name unless it equals the caller's first name, and every other member's first name unless it equals the caller's first name.
- `facts` holds every `agent_private` value of every member, and the window note.
- `safe` is `outputLeaks(text, {forbidden, facts, contacts:true})`.

Probe results with `outputLeaks`:

| text | forbidden | leak? |
|---|---|---|
| `nyc` | `Nyc` | **yes** |
| `sf` | `Sf` | **yes** |
| `Ann-Marie` | `Ann` | **yes** |
| `Jean-Luc` | `Luc` | **yes** |
| `O'Brien` | `Brien` | **yes** |
| `Annabel` | `Ann` | no |
| `Sam` | facts `Sam wants to stop` | no |
| `nyc` | facts `nyc` | no |

So `facts` do not poison short values: one- and two-word strings do not match (core guard). `forbidden` does, on a word boundary.

**What the agent actually gets.** `facets` keeps only `scope = shareable` and `status = confirmed` (`R:725`). Production writers of `shareable` facets: peon postings (`jobs.ts:218`) and staff company verification (`postings.ts:57`). Join interests are `matchable` (`S:743`). Accepted profile suggestions are `agent_private` or `matchable` (`profile-suggestions.ts:17`). `learned` never reaches `network.facets` (no writer). So for ntwrk, slop and friends `facets` is empty in production. The agent knows a first name, a city and a state. `activeItems` is always `null` (`R:732`).

Note on `singlePlayer`. The contract says "True while the member is a minor" (`C:103`). The code also sets it for any member not present in NYC for six days (`R:732`), and the e2e tests pin that for SF adults (`tests/e2e/platform.e2e.test.ts:153, 301`). That is intended, so the contract comment is narrow. It is not a defect. The defect in the other direction is AJ3.

Invariants: INV-C1 no private value in context (holds by construction). INV-C2 `sharedContext = null` implies the member gets a told state. Fails.

Quint: model `sharedContext` as a pure function of a set of first names, one city, a facet count. Check INV-D1 with two members and small name sets.

### 3.3 `minor-single-player` (P0)

**Kind:** implicit. Reports named this only as an invariant.

**Age inputs:** `people.lowest_age`, `age_floor.lowest_age`, `members.age`, all merged by the view `platform.matching_ages` as `least(...)` (migration 0038). The snapshot reads the view (`SN:117`). So `MemberState.age` is the person's lowest age, on every app, at the next unit.

**State set of one member in one Network:**

| State | Definition |
|---|---|
| `adult` | valid age 18+, `minor=false` |
| `age_unknown` | no valid age, `minor=true`, `ageUnknown=true` |
| `minor_age` | record or stated age 13-17 |
| `minor_soft` | adult record, `minor=true`, `minorSignal=true`, no age stated. From a school sign in text |
| `minor_reported` | adult record, `minor=true`, `minorReported=true`. From another member |
| `declined` | under 13: `declinedIds`, forgotten |

**Transitions:**

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| none | join 13-17 | `joinAgeCheck` ok | member with `age` | `minor_age` | S:1416-1450 | member |
| none | first text, stage new | minor | `welcomeMinor`, stage active | `minor_age` | N:985 | member |
| adult | text states 13-17 | | `minor`, `minorAfterContact`, `dropMember`, `minorNotice` once | `minor_age` | N:717-728 | member |
| adult | school sign | not `ADULT_SCHOOL_CTX` | same as above, no age recorded | `minor_soft` | N:717-728 | member |
| adult | report "he's only 15" | | flags, drop, this Network only | `minor_reported` | N:1550-1558 | other member |
| adult | another app states 15 | `recordAge` | `ageLowered`; next unit `syncRecord` | `minor_age` | S:776-785, N:4424 | member |
| `age_unknown` | states 18+ | no signal, no conflict | `minor=false` | adult | N:713 | member |
| `minor_soft`, `minor_reported` | staff clear | record 18+, no stated minor age | flags cleared | adult | N:1565-1580, S:1697 | staff |
| `minor_age` | any | | **none** | `minor_age` | N:1572-1573 | none |
| any | states under 13 | no adult record | decline | `declined` | N:697, 897 | member |

**What a minor can do, by route.** This table is the audit that the brief asked for. "Closed" means no connection to another person.

| Route | Guard | Verdict | Where |
|---|---|---|---|
| Engine proposal | `eligible` and gates | closed | N:4360 |
| Engine alternate | `distinctAlternates`; closes open items | closed | N:3962, 2572 |
| Approval | `approvalCheck` | closed | N:1995 |
| People request by text | `!m.minor` | closed: goes to `onPlans` | N:833-834 |
| People request by MCP | same line | closed | N:759, 833 |
| Engine-ask answer with a request | `!m.minor` | closed | N:1125 |
| Quiet onboarding request | `!m.minor` | closed | N:827 |
| Plans buddy | `offer` false | closed | N:1803-1805 |
| Plan seat | `planSeatOk` | closed | N:2889 |
| Newcomer welcome, second encounter | `eligible` | closed | N:3817, 3825 |
| Inviting a friend | `canInvite`, and `ctx.invite` is unset | closed | N:2652, 2662 |
| Inviter told of a minor joining | `welcome` returns first | closed | N:985, 1009 |
| Growth ask, re-engagement, weekly check-in | `m.minor` | closed | N:869, 3317, 3336 |
| Engine ask to a minor | `m.minor` in `sendAsks`, hook `valid` | closed | N:3495, 4115 |
| Slop onboarding | `ob` and `m.minor` | closed | N:1050, 1074 |
| Enroll from looking-for | slop filtered | closed | S:1481 |
| Peon posting | `managerProblem` `adults_only` | closed, unless the draft closes a posting | N:4629 |
| Relay | `relayParties` `adult`, no match | closed | R:221, RE |
| Photos, ratings | `verifiedAdult`, `ageLowered` | closed | S:1577, 779 |
| Sends about others | `ABOUT_OTHERS` | closed | N:4226 |
| Open turn model | `singlePlayer` | **depends on the model**, and see AJ3 | R:732 |
| Inbox read | none | **open**. See AJ5 | S:1911, T:326 |
| Onboarding questions already in flight | none | **open**. See AJ4 | N:824, 1094 |

No route found introduces a minor to a person. The two open rows leak or collect information. They do not create a connection.

**The chat loop.** After the notice, a minor's texts go as follows.

| Text | Kind | Result |
|---|---|---|
| "what's up" (9 chars) | ack, not `ACK_ONLY` | `open`, model, `singlePlayer:true` |
| "ok" | `ACK_ONLY` | nothing |
| "things to do this weekend" | plans | `plansNoOffer`, 3 venues |
| "find me climbing friends" | people | `plansNoOffer` |
| any other text over 12 chars | `other` | `concierge`, 2 venues, or silence |

`concierge` never answers the words. It picks the first known interest and two venues (`N:1826-1833`). There are 40 venues (`geo.ts`) and a 7-day repeat rule, so after 20 long messages in a week it says nothing (`N:1830`).

Invariants:

- INV-M1 (AGENTS, decision 1): a minor is never in `participants` of an open opportunity. Holds on every route.
- INV-M2: a minor reaches no text about a named adult. Fails, AJ5, for summaries already stored.
- INV-M3: `singlePlayer` is true whenever `m.minor`. Fails, AJ3.
- LIVE-M1 (AGENTS "chat"): a minor's question eventually reaches the agent. Fails, AJ2.
- LIVE-M2: `minor_soft` and `minor_reported` reach a staff decision. No SLA.

Interactions: `age-floor` (IN), `member-age-policy` (network-consent-core), `turn-disposition`, `inbox-read-seen`.

Failure: `statedAge` runs after the unit commits (`S:1123`). Ages sit in memory (`R:131`). A crash between them loses the person-level age. Known: MO section 15, IN. A soft signal is never recorded at person level, by the filter at `S:1294`. Known: J-variant at `journey-signup.md:427`, JE6.

Quint: `minor_single_player.qnt`. Variables: per person `lowestAge`, per app `minorFlags`. Actions: `stateAge`, `softSignal`, `report`, `clear`. Merge with `age-floor`.

### 3.4 `member-status-projection` (P1)

There is no one status. These stores each hold a part.

| Store | Values | Writers | Exit |
|---|---|---|---|
| `platform.memberships.state` | invited, onboarding, active, paused, restricted, removed | join, STOP (`S:804`), ban (`S:1754`), START (`S:1110`), forget | START; none for restricted |
| `memberships.review` | null or a reason | recycled flow | staff |
| `platform.consent_events` | opted_in, opted_out | STOP, START, leave, join | new opt-in |
| `network.members.opted_out` | bool | writeUnit (`R:519`) | START |
| `network.members.account_status` | active, restricted, removed in production | createMember, ban, forget | none |
| `members.participation_state` + window | normal, quiet, paused in production | set-state, resume | agent |
| `MemberState.trust` | ok, watch, hold | abuse, staff | decay, staff |
| `MemberState.onlyWhenAsked` | bool | two unanswered | any inbound |
| `phone_identities.hold` | null, recycled_number | `seen` | staff |

Readers:

| Reader | Sees | Does not see |
|---|---|---|
| Open turn gate | consent, membership, review, phone, ban, age | trust (trust acts first, in the Network) |
| `TurnContext.state` | participation | everything else |
| MCP `check_status` | `memberships.state`, `review` | **trust hold, participation, onlyWhenAsked, phone hold (reads as not joined)** |
| `GET /api/me` | membership, consent, participation | trust |
| Engine | snapshot state, account, age | |
| Send path | everything in the Network | |

The word "paused" names five things:

1. `memberships.state = paused`: STOP. `publicStatus` calls it `stopped` (`H:83`).
2. `participation_state = paused`: the member asked the agent. MCP calls it `active`.
3. `effectiveParticipation.state = paused` because `opted_out` (`SN:32`).
4. `account_status = paused`: read at `N:4421`, no production writer.
5. `matching_paused`: the switch.

Invariant wanted: INV-S1 `check_status = active` implies the Network will act on a `submit_profile`. Fails, AJ12.

Quint: do not model the projection as a machine. Add `publicStatus` as a pure def over the composite state and check INV-S1.

### 3.5 `profile-stores` (P1)

| Store | Holds | Written by | Read by |
|---|---|---|---|
| `memberships.profile` | homeCity, neighborhood, zip, interests, about | web join (`A:380`), text join homeCity only (`S:1444`), `correctHome` | profile read, export |
| `network.members` + `presence` + join facets | name, home, age, join interests | `createMember`, `correctHome` | snapshot |
| `MemberState.learned`, `appTags`, `availability`, `area` | what the Network read from chat | `learnFrom` callers only | engine input |
| `network.facets` from suggestions | Gmail and calendar facts | accept | profile review only |

`learnFrom` has four callers: `N:743` (MCP block or report text), `N:1082` (interview), `N:1108` (MCP profile), `N:1123` (engine ask). Requests add tags and desires too (`N:1610-1611`).

Transitions for one fact "I moved to Williamsburg":

| Path | Result |
|---|---|
| Text, stage active, no awaiting | step 22, `open`. Nothing stored. Model cannot store it |
| Text, answering an engine ask | `learned`, `m.area` |
| MCP `submit_profile` | `learned`, `m.area`. `membership.profile` unchanged |
| `POST /api/me/home` | `memberships.profile`, `members`, `presence`. `m.area` stays old: `area` is read once at `member()` (`N:4445`), and is kept in stored state |

The last row needs care. `N:4445` loads `area` only when the member is first created in state. No sync later reads `home_area`. So a home correction changes the snapshot and `presence` but not `m.area`, which `minutesBetween` and `nearbyVenues` read. Founder correction 2026-10-19 removed the site screen for this route, so the route has no caller in the product. The backend route stays.

Invariant wanted: INV-P1 a read of "my profile" shows the newest stored fact. Fails, AJ10.

### 3.6 `member-conversation` (P1)

Base table in IN section 19 and HA 3.3. Additions from this journey:

- **`pendingAck`:** written by `ack` (`N:3849`). Cleared by the next send, or dropped. In a signed turn an ack is `handled_quiet_ok`, so the answer to the last onboarding question, a check-in answer, "ok" to a booked plan and "never mind" all get no text. This is by design (`N:3847`). Quint: keep it as a nondet quiet outcome.
- **`awaiting` expiry:** `N:3285`. Everything but `probe` ends after 3 days. `booked` ends after 48 h or at the meeting. A late answer then goes down the list as ordinary text. For an engine ask or a slop question that means step 22: the answer is lost. See AJ11.
- **`clarify`:** once per probe (`N:846`). A second unclear reply falls through to the list, then to `open`. So a reply to a probe can reach the model, which has no probe action and no `activeItems`.
- **`pendingSafety`:** one day. Dropped by the first message that does not resolve it (`N:1530`).
- **`onlyWhenAsked`:** set by two unanswered (`N:3326`). Cleared by any inbound (`N:641`). An MCP profile also clears it, as `heardFrom` has no source check (`N:615`).
- **Missing:** a member at step 7 (hold) has `lastInbound` and `msgsIn` updated before the return (`N:610`), so a held member reads as active to the unanswered rules. Harmless.

### 3.7 `open-turn-binding` (P1)

Base in IN section 18.

| State of the binding | Means |
|---|---|
| `bound` | row `done`, `open`, same sender hash, active membership same member id |
| `revoked` | STOP, leave, ban, review, phone hold, age, suppression |
| `sealed` | `response` null by purge at 7 days or forget |

Rules checked on each action: `S:1872-1877`, and again under locks at `S:1880-1890`. Checked again before commit (`complete`, `S:1905`).

Actions are not bound to time, other than the 7-day seal. A six-day-old open turn can still set state. The gateway uses the current turn, and the signature has its own window, so this is not reachable by a bad actor. Noted for the model.

`turn_context_changed` (`S:2103`) runs on the first answer too (IN D13). The window boundary is one way to hit it: a scheduled state that starts between the stored context and the recheck. The effect is a 409 not retryable on a turn already `done`: no reply. This is a second route into silence, shorter than AJ1.

Relay: `RE:162-175` also requires `text` to equal the stored inbound body.

### 3.8 `action-receipts` (P1)

Base in HA 4.7 and CO. Entry states: `absent`, `processing`, `completed`, `unresolved`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| absent | action | under 16 entries, window valid | processing | S:1899-1901 |
| processing | effect commits | digest match | completed, in the effect tx | S:1905-1909 |
| processing | fault | | unresolved | S:1969 |
| processing | route authority expired | | **stays processing** | S:1968 |
| processing | crash | | **stays processing** | none |
| completed | replay, same digest | | completed | S:1897 |
| any | replay, other digest | | 409 `action_conflict` | S:1895 |
| processing, unresolved | replay, same digest | | 409 `action_unresolved` | S:1896 |
| any | forget, purge | | map cleared | R:525, I:198 |

`processing` is a dead end after a crash, with the same outcome as `unresolved`: a retry is refused and the effect did not happen. No data harm. The agent reads an error and must say so. A new key can set state. For updates the key is fixed per turn, so that turn can read no updates, and the next turn can.

### 3.9 `inbox-read-seen` (P1)

Base in MO 13, BN 16. For this journey:

| Item state | Means |
|---|---|
| `unseen_notified` | the Network sent it, `recordSent` stored it |
| `unseen_orphan` | item stored, delivery not. The only input the scheduler has |
| `seen` | read on any surface |
| `expired` | unused: no producer sets `expiresAt` (AJ14) |
| `erased` | forget |

Two readers, not the same:

| | `/internal/updates` | MCP `get_updates` |
|---|---|---|
| Identity | open turn | grant |
| App | turn's app | grant's app |
| Atomic with its receipt | yes (`S:1916-1925`) | no receipt |
| Output gate | **none** | `outputLeaks`, after `markSeen` (`T:326`) |
| Surface recorded | `web` always | assistant |
| Replay | cached items | new read |
| After STOP | 403 | still reads |

`NOTIFY_TYPES` (`S:218`) is `probe, plan_probe, proposal, reminder, feedback_request, cancellation, scheduling`. Replies in the thread with those types become items too (`R:631`). So the agent can read back what the member saw a minute ago.

`seen` means "an assistant read it", not "the member saw it". Every item was already texted. So `seen` carries no delivery meaning, and only limits repeat reads.

Invariant wanted: INV-U1 an item about a closed opportunity is never returned as new. Fails, AJ14.

### 3.10 `assistant-surface-signal` (P2)

Base in MO 14, BN 16. For this journey: the signal changes one thing, `resolveDelivery` (`surface.ts`), which only `build` calls, which only runs on orphan items. So with today's producers, the whole `acted`, `ignored`, `ignored_streak`, `score` machine feeds a decision that happens only after a crash. Model it last.

Three inputs are wrong in a way that would matter once producers exist: `/internal/updates` touches `web`, not the channel; an open turn is not a thread reply (AJ17); `threadReply` closes all deliveries with one reply (BN).

### 3.11 `participation-window` (P1)

Raised from P2. Reason: it is the only member-controlled off switch short of STOP, and the PRD defines it as a safety of attention.

**Stored:** `participation_state` in `{normal, quiet, paused}` from this path. `participation_window` jsonb or null.

**Effective:** `effectiveParticipation` (`SN:20-33`): `paused` if opted out; the mapped window state if active; else stored.

**Wire to stored, on set-state (`S:1935-1950`):**

| Request | `scheduled`? | Stored state | Stored window |
|---|---|---|---|
| open, no dates, no note | no | normal | null |
| busy, no dates, no note | no | quiet | null |
| paused, no dates, no note | no | paused | null |
| traveling, anything | yes | unchanged | set |
| any, with from or until or note | yes | unchanged | set |

| From | Event | Guard | To | Where | Actor |
|---|---|---|---|---|---|
| any | set-state | active membership, open turn, `until` in the future | as above | S:1900, 1946 | member via agent |
| any | set-state, same value | | no write, `unchanged`, no event | S:1942-1945 | member via agent |
| window pending | clock passes `from` | | active, no event | SN:30 | clock |
| window active | clock passes `until` | | stored state, no event | SN:30 | clock |
| window or paused | `POST /api/me/resume` | row has a window, or state paused | window null, paused to normal | S:869-880 | member, no UI |
| quiet, no window | resume | | **no change** | S:874 | member |
| any | STOP | | effective `paused`, row unchanged | SN:32 | member |
| any | START | | row unchanged, effective row state | S:1100-1111 | member |
| any | forget | | window null, state unchanged | R:544-545 | member |

**Effects of each effective state:**

| Effect | normal | quiet | paused |
|---|---|---|---|
| Intro budget `OUTREACH.budget` | 2/7d | 1/30d | 0 |
| Unsolicited budget `PRD_BUDGETS` | 2/7d | 1/30d | 0 |
| Engine filter | passes | passes, higher bar | `state_paused` |
| `eligible` | no state test | no state test | **no state test** (`N:4360`) |
| `searchFor` candidate | yes | yes | **yes**; refused at probe by budget, then swapped |
| Plan seat | yes | yes | yes; compose refuses |
| Open opportunity | stays | stays | stays (JM J7) |
| Replies | yes | yes | yes |

Wire states `open`, `busy`, `traveling`, `paused` map onto 3 stored ones. `busy` and `traveling` are the same to every reader but the context. See AJ9, AJ18.

Invariants:

- INV-W1 (PRD 221, "Paused: no proactive outreach except safety/account notices"). Fails inside the 48-hour window, AJ13.
- INV-W2 agree between readers on one instant. `sharedContext` uses `active`. `memberParticipation` uses "until in the future". Differ for a future window. AJ21.
- LIVE-W1 a paused member has an exit they can find. Fails for "resume", AJ8.

Interactions: JM J7 covers the mid-opportunity table. CO covers the mapping.

Concurrency: set-state takes the person, membership and member row locks, then the turn row (`S:1880-1885`). Network units do not write these columns, so there is no lost update. `correctHome` locks `for update of m, pm, p, ph` in one statement (`S:904`), which is the opposite order to `lock` (person, membership, member). A deadlock would abort one side. The action then goes `unresolved`. Plausible, low, and the route has no UI.

Clock skew: `until` is checked at the claim, and not at commit. A window that ends between the two is stored, inert. Harmless.

### 3.12 `active-member` composite (P0)

The composite is a product. Keep it small.

```
person:     lowestAge, banned, phoneHold, consent(global, per app)
membership: state per app
member:     minor flags, trust, onlyWhenAsked, stage, awaiting, participation
turn:       outcome
inbox:      items
```

Key composition results:

| Pair | Result |
|---|---|
| STOP then START | `paused` membership cleared for one app; participation untouched. A member who paused, then sent STOP, then START, is still participation-paused and hears "Welcome back" |
| Participation paused, then ban | window stays, irrelevant |
| Trust hold and `open` | never open; `check_status` active |
| Minor, then `resume` | START path, then no state change |
| Set-state by a minor | possible only if a short text reaches the model, or by the word "pause" (kind ack) |
| Age lowered and inbox | items kept, AJ5 |
| Age lowered mid-onboarding | questions continue, AJ4 |
| Leave and inbox | `forget_data` runs in the save tx (`R:546`) |
| Context null and STOP | STOP still works, as it is earlier in the list |
| Hold and report | reports still file (`N:740`), good |

## 4. Member-visible states with no exit

| State | How the member gets there | Member sees | Exit | Gap |
|---|---|---|---|---|
| Silent, name clash | another member's name | nothing, ever | none in any tool | AJ1, AJ6 |
| Silent, facet limit | peon postings | nothing, ever | staff SQL | AJ7 |
| Trust hold | abuse or staff | one notice, then silence | `liftHold`, staff | No timer by design. `check_status` says active |
| Restricted (ban) | staff | silence | none, by design | no unban route |
| Second app after global STOP | STOP, then START on one app | silence on the other | no text route | J5 |
| Participation paused, open-ended | agent | no prompts | agent set-state only; "resume" misroutes | AJ8 |
| `quiet` from busy | agent | fewer prompts | agent set-state; `/api/me/resume` no-ops | AJ21 |
| Minor by age | age stated | single-player | none, by rule | AJ20 |
| Minor soft or reported | signal | single-player, no reason | staff clear, per person | no SLA; one app (JE6) |
| Recycled number hold | 12 months with no text or login | silence | staff | MCP use does not touch `last_seen_at`. An agent-first member who used only MCP for a year is treated as a new owner at the first text |
| Slop onboarding stalled | no reply for 3 days | nothing | a later engine ask, only with matching on | AJ11 |
| Withheld update | gate | nothing | none | MO D8 |
| Age floor from a joke | "I'm 15 lol" | single-player, forever | none (J2) | known |

## 5. Defects in detail

### AJ1. One member named "Nyc" silences the app. P1, high, probe, not run end to end.

`sharedContext` adds every other member's first name to `forbidden`, and then checks `safe(member.homeCity)` (`R:716-724`). `homeCity` is the code `nyc` or `sf`. `first` is free text.

Trigger:

1. A stranger texts `slop`, then `Nyc, 29`. `parseJoinText` returns `{age:29, name:"Nyc"}` (probe). `Sf, 31` works too. Web `parseJoin` takes any `firstName` (probe with `nyc`).
2. The member is created. slop, peon and friends are open.
3. Any other member of that app with `home_city='nyc'` sends a text that reaches step 22.
4. `forbidden` holds `Nyc`. `outputLeaks("nyc", {forbidden:["Nyc"], contacts:true})` returns a leak (probe).
5. `sharedContext` returns null at `R:724`. The turn is `handled`, `replies:[]`, `reason:"context_unavailable"` (`S:2096`).
6. Eliza says nothing. The cause stays until staff remove the member.

Scope: every member of that app whose home is that city, for all free conversation. Deterministic turns still work. The caller named Nyc is not affected. No log line says why.

Fix point, not applied: `homeCity` is the service's own code and needs no leak check. Do not check it.

### AJ2. Long texts from a minor never reach the agent. P0, high, probe.

`N:835` runs before step 22. Any `other` text over 12 characters goes to `concierge`. In a signed turn that is `handled`.

`classify` gives `other` for these (probe): "i dont feel safe at home", "my dad hits me and i dont know what to do", "i want to kill myself", "how do I change my profile", "pause my messages for two weeks".

There is no crisis branch anywhere in `packages/network/src` or `packages/core/src` (grep for crisis, 988, self-harm finds only leak-guard word lists).

Sequence: member aged 15, stage active, in friends. Text "i want to kill myself". `kind=other`, `abuse=[]`. Reply: "For something new, try X or Y; they're public and run free things often. Happy to suggest more anytime." No model, no staff signal, no case.

The adult path reaches the model (step 22), which may answer. The minor path is the stricter one, and this is the group the rule protects.

Also lost for a minor, through the same line: set-state (other than the bare word "pause"), the `safety_concern` signal, and any answer to a question.

After 20 long texts in 7 days, `concierge` returns with no send (`N:1830`). Then the text gets silence too.

`eliza-takeover.integration.test.ts:225` accepts either `open` or `handled`, so no test pins this. Founder decision needed on what a minor's chat is. AGENTS.md says "chat, events, things to do".

### AJ3. `singlePlayer` and `m.minor` differ. P0, high, trace.

`singlePlayer` is `!presentInNyc || !canBeMatched(lowestAge)` (`R:732`). `canBeMatched` reads the person's age. `m.minor` also comes from a school sign (`N:717`) and a member report (`N:1555`). Neither lowers `lowest_age`.

Trigger: adult record 30, NYC. Text "i have homework tonight". `minorSignal` true (probe), `m.minor` true (`N:718`). `statedAge` filter drops it (`S:1294`). Next short text "hey" reaches step 22 (not `other`, 3 chars). `sharedContext` returns `singlePlayer:false`. The agent is told this member can be introduced, while the Network will not. The same holds for a reported member (JE6) and for `age_unknown`.

The agent's copy is outside this repo. The contract says "True while the member is a minor" (`C:103`), so the flag breaks its own text.

### AJ4. Minor mid-interview gets adult questions. P1, high, trace.

`N:985` skips the interview for a minor. But an adult who becomes a minor during q1 keeps `awaiting=interview`: `dropMember` does not clear it, and `N:728` returns.

Trigger on ntwrk or friends (no onboarding hook on those apps, by `packs.ts`): join as 30. Stage q1. Text "I'm 16 actually". `minorNotice`. Text "climbing". Step 17 runs `onInterviewAnswer`. `N:1094`: "When are you usually free, and which neighborhood are you around most?". Then q3: "do you prefer one-on-one or small groups?".

`onInterviewAnswer` tests `!m.minor` only for the hook branch (`N:1085`). `onboardNext` has the guard. The plain path does not.

Effect: the Network collects a minor's free times and area after it said it will not introduce them. Nothing is proposed.

### AJ5. Inbox items survive a move to minor. P1, high, trace.

`ageLowered` (`S:776-785`) deletes photos and ratings, and lowers `members.age`. `minorAfterContact` opens a case. Neither touches `notify.inbox_items`. `dropMember` closes opportunities and does not retract items.

Trigger: adult in a booked intro. `reminder` text names a person and a venue, so an item exists. It stays unseen, as nothing reads it. Member states 16. Later `/internal/updates` (`S:1920`) or MCP `get_updates` (`T:326`) returns the summary. Neither checks age. The summary may name the adult (`N:1224` shows the Network knows it did).

The text already went out once, so this is not a new disclosure to the member. It is a new disclosure to the agent, after the rule changed, and it breaks "plans copy never reaches minors" (decision 11).

### AJ6. Compound first names. P1, high, probe.

Same mechanism as AJ1. `safe(firstName)` at `R:724`. `firstName` is the first space-separated word (`R:715`). Web join allows hyphens and apostrophes. `forbidden` matches on word boundaries with punctuation as a boundary.

| Caller | Another member | Result |
|---|---|---|
| Ann-Marie | Ann | silent |
| Jean-Luc | Luc or Jean | silent |
| Mary-Kate | Kate or Mary | silent |
| O'Brien | Brien | silent |

The other member need not be connected to the caller. As the app grows, the chance grows. The text path cuts at the hyphen (`Ann-Marie, 29` gives `Ann`), so only web and agent joins are hit.

Note the rule that lets a shared first name pass (`R:718-720`) shows the intent: the caller's own name must not be blocked.

### AJ7. Over 50 shareable facets. P1, high, trace.

`R:729` returns null when `facets.length > 50`, by design ("Withhold it whole; never truncate a fact"). `postingFacts` gives each posting up to 27 shareable facets: role, pay, mode, up to 12 must, up to 12 nice (`jobs.ts:219-227`). Closing a posting re-saves them with no `valid_to` (`postings.ts:26-36`), and they stay shareable.

Trigger: a hiring manager with five postings of 8 skills each, open or closed. 55 facets. Every free text from then on is `context_unavailable`. They can still post by text (step 10). They cannot chat. Nothing tells them.

### AJ8. `resume` is START. P1, high, probe.

`detectKeyword("resume")` returns `start` (probe). So `isComplianceText` is true, and it skips the turn hold (`I:85`). In `S:1100-1111` it records an opted-in event and clears a `paused` membership. `memberUnit` sends `copy.stopWelcomeBack`: "Welcome back. I'll only reach out when something looks worth it." (`N:676`). `participation_state` stays. No model runs.

Trigger: member says "pause for now" (model sets `paused`, no dates). Weeks later: "resume". Reply: welcome back. Proactive stays at 0. The member expects outreach and gets none. `TurnContext.state` reads `paused` on the next open turn, so the model could fix it, only if the member asks again in other words ("I'm ready to start again" has more words and reaches step 22).

Also a side effect: `resume` from a member with no STOP writes a consent event anyway (`S:1105`). Harmless.

The same gap in the other direction: STOP, then START, keeps a participation pause.

### AJ9. `traveling` does almost nothing. P1, high, trace.

- Set-state `traveling` stores a window. Effective state is `quiet` (`SN:31`).
- `presentInNyc` reads `presence` rows of type `temporary` (`N:490`). Production writes only type `home` (`S:734`, `S:918`). The e2e test inserts a trip by hand (`tests/e2e/platform.e2e.test.ts:247`).
- `eligible` and `probe` test `inNyc` (`N:4364`, `N:2176`). For an NYC-home member it is true.
- `evidence.away` reads the same rows (`N:2286`).
- A `travel` signal becomes a facet tagged `signal:travel` (`S:1953`). `reviewSignals` selects only `opt_out` and `safety_concern` (`S:1837`). No other reader exists. The row stays `proposed` for good (GS-1 covers the others).

Trigger: "I'm in LA next week". Agent: `set-state traveling`, from Monday to Friday. The next day a probe goes out with times inside the trip, allowed by the quiet budget of 1 in 30 days. Time options ignore the window.

`singlePlayer` stays false for the same reason, so the agent is told the member can be matched while traveling.

### AJ10. No profile edit by text. P1, high, trace.

See 3.5. For a text-only member after onboarding:

1. "I moved to Williamsburg" is step 22. No store changes. The model has no tool.
2. "update my profile" is not a read (`profile-read.ts:35`), so it is also step 22.
3. "show my profile" reads `memberships.profile` only (`profile-read.ts:54`). It says "I left it unchanged."
4. `submit_profile` learns into `MemberState` and never updates `memberships.profile`. So the MCP tool reports success and the read shows old data. For a text join, `about` and `interests` are empty for good.
5. `/api/me/home` has no site screen after the 2026-10-19 correction.

Founder correction: "People use their agent or text conversation". So the only edit paths left are the MCP tool, for people with a connector, and the answer to an engine ask.

Export has the same hole: `exportMember` reads SQL only (`S:828-842`). `learned`, `appTags`, `availability` and `standing` are in `network_state` JSON and are not exported.

### AJ11. Slop onboarding stalls. P2, high, trace.

The loop asks one question and sets `awaiting=interview` with an `ask`. `N:3285` clears `awaiting` after 3 days. The next question comes only from `onboardNext` (after an answer) or `sendAsks` (daily engine run, `N:3495`), and `dailyRun` runs only with matching on (`N:3293`). Slop's stored switch starts off.

Trigger: slop member stops at the age-range question. Four days later they answer "28-35". `aw` is undefined, so the text goes down the list to `open`. `learnAppTags` does not run. The fact is lost. With matching off, nothing asks again. The member is `active` with hard fields missing.

### AJ12. `check_status` and `submit_profile` for a held member. P2, high, trace.

`hold` runs `holdMember` only (`S:1675-1686`). It writes trust, and not `memberships`. So `publicStatus` returns `active` (`H:82`). `next_step`: "You are signed up."

`submit_profile`: status `active` passes `T:312`. `svc.submitProfile` runs (`S:1207`). `handleInbound` returns at `N:746`. The answer is `submitted:true`, "has it" (`T:315`). Nothing was stored.

The comment at `H:84` says a restriction is not explained to an agent, which is fine. The issue is that the tool says the opposite of the truth. `on_hold` is reached only by ban or review.

### AJ13. Paused member gets a check-in or ask. P2, high for check-in, medium for ask.

`LANE_BUDGETS` says "Members whose state budget is 0 (receiving, paused) get nothing in any lane" (`outreach.ts`). The budget check runs only when `unsolicited()` is true (`N:3911`). `unsolicited` is false for 2 follow-ups within 48 h of the member's own ask (`N:4007`). The message that asked for a pause is itself an ask: `initiated`, or a `MEMBER_ASK` match (`N:608`).

Trigger: weekly check-in on. On check-in day, member texts "pause me for two weeks, can you do that?". `askAt=now`, `askUsed=0`. Model sets `paused`. At the next tick in the send window, `weeklyCheckins` (`N:3313`) has no state test. `send` kind `checkin`, not proactive. `overBudget` is skipped. `unsolicited` false. It goes out.

`sendAsks` has the same shape. Medium because the engine's ask list may already leave out paused members; not traced to the end.

### AJ14. Inbox items never expire. P2, high, trace.

`delivered` passes no `expiresAt` (`S:625-628`). No other producer exists. A probe expires in 26 h. Its item stays unseen until read.

Trigger: probe at day 0, member ignores it, opportunity closes. Day 20 the member connects Claude and calls `get_updates`. It returns "Quick check, no names yet...". `next_step`: "They answer by replying to the text." The reply answers nothing.

Also dedupe: the key is person, app, type, subject (`store.ts:9`). A second reminder of one opportunity adds no item.

### AJ15. `/internal/updates` skips the gate. P2, high, trace.

MCP filters with `outputLeaks` (`T:326`). `/internal/updates` returns `item.summary` as is (`S:1921`, `S:1928`). Same items, same model-facing use. A summary with a phone pattern is withheld from Claude and given to Eliza. Eliza already has the text in history, so the extra exposure is small. Guard on one path and not the other. Note D4 (gate gaps) and D8 (withheld and consumed) apply to the MCP side only.

### AJ16. The agent cannot see open items. P2, high, trace.

`activeItems: null` (`R:732`), by contract "cannot supply safe summaries". `updates` returns only unseen, once. So: member, "any news on my intro?". Model reads updates: gets the probe summary. Marks seen. Next turn, same question: empty. Model says nothing is happening, while an opportunity is open. `relay.itemId` must be null for the same reason (`RE:172`).

### AJ17. Open turns are not thread replies. P2, high, trace.

`S:1226`: `threadReply` runs only when `out === "handled"`. Free chat is `open`. So a member who replies to a text in free chat gives no `acted`. `sweep` marks the delivery `ignored` at 72 h, and the channel's `score` falls by 2 each (`surface.ts`). Effect today is small, as the scheduler has no producers (3.10). It will bias surface choice toward assistants once it has.

### AJ18. Unreachable participation and account values. P2, high, trace.

- Wire `open` stores `normal` (`SN:31`, `S:1941`). Stored `open` has no writer outside the simulator (`packages/observatory/db/writer.ts`). The PRD's Open budget of 4 per 7 days cannot apply to a real member.
- `receiving` has no writer. `receiving_contributor` (`N:3600`) and `N:1719` are dead in production.
- `account_status` `paused` and `onboarding` have no writer (grep). `m.account === "paused"` is dead.
- PRD line 348 lists five states for `network.set_state`. The wire has four.

### AJ19. SF members get New York venues. P2, high, trace.

`VENUES` holds 40 places, all NYC (`geo.ts:45`). `nearbyVenues` defaults to Midtown for an unknown area (`geo.ts:142`). SF homes are live on ntwrk, friends and slop (e2e). `onPlans` and `concierge` send "A few ideas nearby: Prospect Park..." to an SF member. For a minor it is the only feature.

### AJ20. A person who turned 18. P2, founder decision.

Age is the lowest ever stated (decision 1). There is no birth date and no aging. `clearMinorSignal` refuses a record under 18 (`N:1572`). `clearMinor` passes that through. So a member who joined at 17 is single-player forever, on every app, with no staff route. A rejoin is refused by the age floor. This follows the rule as written. I found no PRD text on it. Raise it with the founder.

### AJ21. Small participation drifts. P2, high, trace.

- `note` is stored and read only as a leak fact (`R:722`). No reader gives it to the agent or to staff.
- `memberParticipation` returns a window with `until` in the future as the current state, even when `from` is in the future (`S:857`). `sharedContext` tests `active`. They disagree until `from`.
- `resumeMember` returns with no change for stored `quiet` with no window (`S:874`). The API answers 200.
- A scheduled window keeps `base` (`S:941`), so "open until Friday" from a paused base goes back to paused. The wire reply does not say so.
- `TurnContext` has no pending window. The agent cannot tell a member about a scheduled pause.

### AJ22. `submit_profile` can text at once. P2, medium, trace.

`memberUnit` sets `rt.replyingTo` and `replyTo` for an MCP text (`S:1242`, `N:618`). A `people_request` passes `N:759`. `send` treats it as a reply (`N:3867`), timing `now` (`N:4143`). `R:429` gives kind `reply`, as `replyingTo` matches. So the ack goes out in quiet hours, in a thread the member did not write in. The tool's `next_step` warns of texts. Medium because the outbound queue's rule for replies with no recent inbound was not traced to the end.

## 6. Failure and concurrency along the journey

| Point | Transaction | Crash or race | Result |
|---|---|---|---|
| Turn claim to seal | Many | Crash | `unresolved`; effects stand; replay refused (IN) |
| Member unit | One save tx | Crash | Replay refused, `duplicate` guard |
| Unit to `statedAge` | Two | Crash | Person age lost; `statedAges` in memory (`R:131`). Known |
| `statedAge` throws | | Turn fails | Ages already taken by `takeAges`: lost, no retry (`R:133-137`) |
| Context to seal | Two | State changes between | `turn_context_changed` on replay; on first response too (IN D13) |
| Action claim to effect | Two tx | Crash | Receipt `processing` for good. Effect absent. No harm |
| Updates | One tx | Fault | Items stay unread (test pins it) |
| `get_updates` | No tx | Two clients | Same item twice; harmless |
| `get_updates` response lost | | Client retry | Items gone (MCP has no receipt). Known at CO:491 for the surface |
| `recordSent` | Two commits | Crash, or second instance tick | Orphan item, second text (IS:351) |
| Set-state vs unit | No shared lock | Unit reads old state | Next unit sees it. Fine |
| Set-state vs forget | Row locks | Forget first | `authorized` false, 403 |
| Long tick | Network lock | Turn waits in `sharedContext` and `memberUnit` | Over the 8 s budget; gateway retries get `turn_busy` |
| Clock at window edge | `from` passes between context and replay | | 409, no reply |

## 7. Checked and found sound

- Actions bind to the original open turn, app, member and live membership. A STOP revokes cached actions.
- `updates` is atomic with its receipt, and rolls back seen state.
- Set-state idempotency and `unchanged` semantics.
- Window expiry is computed and survives restart.
- Opted-out members read as paused everywhere the snapshot is used.
- No route connects a minor to a person (table in 3.3).
- `facts` do not poison context: a one- or two-word string does not match (probe).
- `get_updates` is scoped to the grant's app, and a foreign token reads as nothing.
- A held member can still file a report (`N:740` is before `N:746`).
- `singlePlayer` for an SF adult is intended (e2e pins it).
- An opted-out member's request ends at `approvalCheck` (`N:1992`) and contacts nobody. It does reach the review queue, and `searchFor` runs. Staff time only.
- Plan probes to a paused member are refused in both branches (`attention.ts:477`, `overBudget`).

## 8. Questions for the founder

1. What is a minor's chat? Canned places, or the model with `singlePlayer`? Is there a crisis path? (AJ2)
2. Does a person ever leave `minor` by age? (AJ20)
3. Should `traveling` take a member out of matching for the window? (AJ9)
4. Should "resume" end a participation pause? It is a carrier keyword today. (AJ8)
5. How does a text-only member edit a profile? (AJ10)

## 9. Quint modelling notes

**Module `active_member.qnt` (P0).** Merge: `turn-disposition`, `minor-single-player`, `participation-window`, `member-status-projection`.

Variables, for 2 people, 2 apps:

```
lowestAge:   person -> int or none
softMinor:   person -> app -> bool
consent:     person -> { global, perApp }
membership:  person -> app -> Active | Paused | Restricted | Removed
trust:       person -> Ok | Watch | Hold
partStored:  person -> app -> Normal | Quiet | PausedP
partWindow:  person -> app -> None | { state, from, until }
stage:       person -> app -> Q1 | Q2 | Q3 | Active
awaiting:    person -> app -> None | Interview | Ask | Probe
names:       person -> Name          // small set incl. "Nyc", "Ann", "Ann-Marie"
city:        person -> Nyc | Sf
facetCount:  person -> app -> 0..52  // abstract to two buckets
outcome:     Open | Said | Quiet | ContextUnavailable | Ignored
inbox:       set of { person, app, aboutOther, closed, seen }
now:         int
```

Actions:

```
memberText(p, app, kind, length)     // kind: Other, Ack, Plans, People, Keyword(k), AgeStatement(a), SoftSignal
agentSetState(p, app, state, from, until)
staffHold, staffLift, staffClearMinor, ban
join(p, app, name, age)
sendItem(p, app, aboutOther)
readUpdates(p, app, surface)
tick (now + 1)
```

`memberText` should be a pure decision list that follows 2.2 line by line. Keep the order. It is the machine.

`contextNull(p)` as a pure def:

```
exists other: name(other) wordIn name(p), other != p, name differs
or exists other: name(other) ~ city(p)
or facetCount(p, app) > 50
```

Invariants:

```
INV-M1  minor implies no open opportunity
INV-M3  turn Open and minorAny(p,app) implies context.singlePlayer
INV-M2  readUpdates by a minor returns no item with aboutOther
INV-M4  minor and stage != Active implies no interview question sent
INV-W1  effective Paused implies no unsolicited send
INV-S1  publicStatus = active implies trust != Hold
INV-D1  active, no hold, not ack: outcome != ContextUnavailable
```

Temporal:

```
LIVE-M1  minor question eventually reaches Open or Said-with-answer
LIVE-W1  paused and member says resume eventually effective != Paused
LIVE-D1  active member question eventually Open or Said
```

Expected results: INV-M3, INV-M2, INV-M4, INV-W1, INV-S1, INV-D1 fail with short traces. INV-M1 holds. Good first run for the tool.

Abstractions: leave the Network's matching out; `aboutOther` stands in for it. Leave Cloud out. `classify` is nondet over `kind`. Length is a bool over 12. Time in days, bounds 0..30. Two names, one with a hyphen.

**Module `action_receipts.qnt` (P1).** Alone. Small. States as 3.8. Check: at most one effect per key, `processing` never reports success, forget clears.

**Module `inbox.qnt` (P1).** Two readers with different gates. Merge MO `output-leak-gate`. Check INV-U1 and D8. Add a nondet `orphan` for the two-commit `recordSent`.

**Skip for now:** `assistant-surface-signal`. Its output is only used by orphan items.

## 10. Coverage limits

- Read in full: `service.ts`, `runtime.ts`, `inbox.ts`, `snapshot.ts`, `profile-read.ts`, `contract.ts`, `accounts.ts`, `tools.ts`, `hooks.ts`, `leaks.ts`, `policy.ts`, `outreach.ts`, `trust.ts`, the notify `src` files, its schema, and `docs/design/eliza-conversation-layer.md`.
- `network.ts` read in part: 1-1275, 1400-1850, 1987-2210, 2564-2586, 2649-2681, 2888-2898, 2966-2998, 3263-3345, 3490-3503, 3595-3660, 3783-3970, 3986-4045, 4042-4135, 4136-4455, 4610-4648, 4825-4845. The rest is `journey-match.md` and `network-consent-core.md` scope.
- `relay-endpoint.ts`, `api.ts`, `classify.ts`, `copy.ts`, `geo.ts`, `packs.ts`, `jobs.ts`, `postings.ts`, `consent.ts`, `guard.ts`: the parts named above.
- Tests read in part: `shared-actions.integration.test.ts`, `eliza-takeover.integration.test.ts`, `tests/e2e/platform.e2e.test.ts`, `packages/mcp/test/updates.test.ts`, `service-safety.test.ts`. `shared-agent.integration.test.ts` and the two sim scenarios were read through grep and HA.
- The Eliza side is upstream and not in this repo. What the model does with `singlePlayer`, and whether it answers a crisis text, is not known. Whether the gateway sends anything on an empty `handled` was taken from the contract comment.
- AJ1 and AJ6 were proved on the gate and the parser, and traced through `sharedContext`. They were not run on a database. One integration case in `shared-agent.integration.test.ts` would confirm them: two members, one named `Nyc`.
- `outbound-queue.ts` rules for a `reply` with no recent inbound were not read for AJ22.
