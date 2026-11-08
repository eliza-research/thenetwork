# State machines: network capital (packages/capital)

Scope: `packages/capital` (ledger, validation, store, detection, levers, view, simulation), and the code that crosses its boundary: `packages/network/src/capital.ts`, the `emit` sites in `packages/network/src/network.ts`, `packages/network/service/runtime.ts`, the table `network.capital_events`, and `scripts/sim/capital.ts`.

Hand-written, 2026-11-07, from a full read of the source. Line numbers are for commit a0ed7bc. No code was changed.

## 0. Summary

### 0.1 What runs in production

This fact changes the priority of everything below.

- The service builds the ledger with `capitalWiring(undefined, { reader: false })` (runtime.ts:118). The levers and `flags` are not read. `NetworkOptions.capital` is not set.
- So in production the ledger only records events. The only output that anything reads is the count `capital.rejected` in `/health` (runtime.ts:763).
- `network.capital_events` is written in the unit's transaction (runtime.ts:504-507) and is deleted on forget (runtime.ts:537).
- The fraud review path, the three levers, `entriesFor`, `whatYouBuilt`, `audit` and `JsonlCapitalStore` have no production caller.
- Levers are on only in `harness/experiment.ts --capital` (experiment.ts:98-101) and in the synthetic world `packages/capital/experiments/world.ts`.
- `bun run sim` never runs the ConsentNetwork with a ledger reader. No file in `scripts/` passes `capital: true`. The `capital` block uses the synthetic event stream only.
- The unit tests `packages/capital/test/{gates,ledger,store}.test.ts` were deleted (docs/tests-policy.md:105). The only remaining test is `packages/network/test/service-platform.test.ts:575-585` (join stores events; leave deletes them).

So most defects below are latent: they do no harm to members today and they will do harm on the day the levers are switched on. docs/mvp-gaps.md:165 says the levers stay off for slop. The PRD lists them as MVP (39.2.3, 39.2.7). The defect list says which ones affect stored data today.

### 0.2 Machines

| id | kind | priority | state lives in |
|---|---|---|---|
| capital-event-intake | implicit | P1 | `CapitalLedger.seen`, `lastT`, `rejects` |
| capital-member-eligibility | implicit | P0 | `MemberRec.eligible`, `removed` |
| capital-vouch-lifecycle | implicit | P1 | `MemberRec` vouch fields |
| capital-plan-commitment | implicit | P1 | `PlanRec`, keyed by member and plan |
| capital-help-confirmation | implicit | P2 | `HelpRec` |
| capital-entry-reversal | implicit | P1 | `log`, `reversed`, `basis`, `reverses` |
| capital-fraud-review | explicit | P1 | `FraudItem.status` (network state) plus the ledger |
| capital-rate-windows | implicit | P1 | derived from `byMember` entries |
| capital-lever-locks | implicit | P1 | derived from entries; `MemberState.invites` |
| capital-service-persistence | implicit | P1 | `network.capital_events` and the in-memory ledger |
| capital-jsonl-store | implicit | P2 | a JSON Lines file |
| capital-staff-read-audit | implicit | P2 | `staffReads`, store reads |
| capital-sim-review-loop | implicit | P2 | `reviewQ`, `reviewed`, persona fields in world.ts |
| capital-launch-gates | implicit | P2 | computed in run.ts, scripts/sim/capital.ts |

### 0.3 Verification method

I read every defect in the code. I also ran the real `CapitalLedger` from scratch scripts (`/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/capital-check/check.ts` and `check2.ts`). No repository file changed and no external service was called. One check used a temp table in the local dev Postgres on :54339. Results:

| Check | Result |
|---|---|
| help_given then help_confirmed, same t: live order vs `order by t, id` | balance 3 vs 0 |
| plan_attended then feedback_given, same t: live vs `order by t, id` | balance 2.5 vs 2 |
| `value_received` with the product's shape vs the simulator's shape | voucher balance 0 vs 10 |
| Ring a, b, c; fraud confirmed; b is forgotten; replay | a's balance -10 becomes +4.849 |
| Voucher forgotten; replay; invitee's earlier credit | 2 becomes 0; invitee is no longer eligible |
| Minor not signalled to the ledger | eligible true, balance 2 |
| `safety_flag` with `serious: false` before value | voucher credit 0 |
| `need_answered` while ineligible, retry at 18 vs `organized` the same way | 0 vs 4 |
| JSONL: partial write with the process alive, then one more append | next load throws on line 2 |
| Staff read before any event, then reload from JSONL | t is -Infinity live, null after reload |
| Event rejected as out of order live, then replay sorted by t | rejected live, accepted on replay |
| Bun `tx(rows)` insert of an object into jsonb | `jsonb_typeof` is object, so `position('"id"' in event::text)` matches |

## 1. capital-event-intake

Name: event intake gate. Kind: implicit (idempotency set, monotonic cursor).

### 1.1 State

- `seen: Set<eventId>` (ledger.ts:50), `lastT: number` starts at -Infinity (ledger.ts:54), `rejects: Rejection[]` (ledger.ts:53), optional `store` (ledger.ts:56).
- `credited: Set<string>` (ledger.ts:46): semantic dedupe keys `organized|org|plan` and `need|member|need`.

State for one event id: `unseen`, `accepted`. Rejected is not a state of the id: a rejected id stays `unseen` and can be sent again.

### 1.2 Transitions (`record`, ledger.ts:131-138). Trigger: other service (the Network `emit`) or replay.

| From | Event | Guard | Effects | To | Line |
|---|---|---|---|---|---|
| unseen or accepted | record(e) | `validateCapitalEvent(e)` is a reason | push to `rejects`, throw | unchanged | 132-133, 332-337 |
| accepted | record(e) | valid, id in `seen` | return `[]`; `lastT` unchanged | accepted | 134 |
| unseen | record(e) | valid, `e.t < lastT` | push to `rejects`, throw | unseen | 135 |
| unseen | record(e) | valid, `e.t >= lastT`, `store.appendEvent` throws | nothing changed | unseen | 136 |
| unseen | record(e) | valid, in order, stored | `seen += id`, `lastT = e.t`, apply | accepted | 136-138 |

Semantic dedupe:

| Key | Set when | Line | Note |
|---|---|---|---|
| `organized\|org\|plan` | only when `credit` returned an entry | 289, 292-293 | a refused credit can be tried again |
| `need\|member\|need` | before `credit`, whatever it returns | 299-301 | a refused credit burns the key (D10) |

### 1.3 Invariants

- I1. An accepted id is applied exactly once. Replay of a log with duplicates gives the same entries (ledger.ts:3-4, store.ts:4).
- I2. `lastT` never decreases.
- I3. A rejected event changes no state except `rejects` (validate.ts:1-3).
- I4. An event is in the store before it changes state (store.ts:13).
- I5. State is a pure function of accepted events in accepted order (store.ts:1-2). "Accepted order" matters: see D1.

Liveness: none. A bad event stays out. `capitalWiring` keeps it for the harness (capital.ts:56).

### 1.4 Interactions

- `network.ts:2683-2685` makes ids `<type>:<key>` and stamps `t` from the Clock. The id is stable across a retry of the same unit, except `safety_flag`, whose key has `now` in it (network.ts:1192), and `state_changed` (network.ts:4418).
- `capitalWiring` catches each rejection (capital.ts:57) so the send path never sees it.

### 1.5 Concurrency and failure

- In-process and synchronous. No await inside `record`.
- Crash between `store.appendEvent` and apply: memory is lost anyway; replay applies the event. Safe.
- `appendEvent` throws: nothing changed. Safe.
- The switch does not throw on valid input (`credit` guards the `!` on line 380 with `isEligible`). So `seen` cannot be set for an event whose apply fails half way.
- Same t is allowed. Same-t order is not canonical (capital-19, not fixed). This is the root of D1.
- Clock skew: a backward step gives a rejection live. See D7 for what the service does then.

### 1.6 Quint notes

Merge with capital-service-persistence. Vars: `seen`, `lastT`, `applied: List[Event]`, `stored: Set[Event]`. Action `record`. Abstraction: 3 ids, 3 times. Check I1 to I4. For I5, compare two ledgers: one fed in append order, one fed in stored order.

## 2. capital-member-eligibility

Priority P0: this is where "minors never accrue" lives.

### 2.1 State

`members: Map<MemberId, MemberRec>` (ledger.ts:47). Fields `eligible`, `removed` (ledger.ts:20-30).

| State | Meaning |
|---|---|
| Unknown | no record; all events about the member are ignored |
| EligibleActive | `eligible`, not `removed` |
| EligibleRemoved | `eligible`, `removed`; earns nothing, can still be penalized, still counts as confirmer |
| Ineligible | not `eligible`; `internalEntries` returns `[]`; no entries written |
| IneligibleRemoved | both |

### 2.2 Transitions

| From | Event | Guard | Effects | To | Line |
|---|---|---|---|---|---|
| Unknown | member_joined | `age` adult | store rec; a self-vouch is dropped | EligibleActive | 142-149 |
| Unknown | member_joined | minor, null or invalid age | store rec | Ineligible | 146, policy `isMinor` |
| any known | member_joined | | ignored; the new age is lost | same | 143 |
| Eligible* | age_updated | minor or null | `eligible=false` | Ineligible* | 151-156 |
| Ineligible* | age_updated | adult | `eligible=true`; older entries are visible again | Eligible* | 151-156 |
| Unknown | age_updated | | ignored | Unknown | 154-155 |
| *Active | member_removed | any reason | `removed=true` | *Removed | 192-195 |

No transition leaves `removed`. No transition goes back to Unknown: the ledger has no forget (D5).

Trigger: the Network only. Network emits `member_joined` once, when age is known (network.ts:2690-2696). It sends `age: null` for a member treated as a minor. It emits `member_removed` only with `serious_abuse` (network.ts:1267). `age_updated`, and reasons `left` and `other`, are never emitted (D3).

### 2.3 Invariants

- E1 (P0, AGENTS age policy; PRD 39.2.6 "under-18s excluded"; pack `minorsExcluded: true`): a member who is a minor now has no new entries.
- E2: `internalEntries(minor) = []`, so levers sit at the floor.
- E3 (capital-9): a minor or unknown member never counts as counterpart, confirmer, recipient, invitee or provider (ledger.ts:175, 254-255, 283, 290, 298, 360).
- E4: a removed member earns nothing (ledger.ts:380).
- E5 (expected, not enforced): a removed member's confirmation does not create credit for others.

### 2.4 Interactions

- Reads: every credit path, `tryVouchCredit`, `noShow`, `member_removed` stake, `abuse_confirmed`, `plan_ghosted`, `fraud_confirmed`.
- Crosses a boundary: the Network's age logic (`m.minor`, `m.minorSignal`, the lowest stated age; network.ts:700-720) is richer than the ledger's copy. The ledger copy is frozen at first join (D3).
- Person-level age is on `platform.people`. The ledger does not read it.

### 2.5 Concurrency and failure

Single-threaded within a runtime. In the service the ledger is per runtime and per process. `age_updated`, if it is added, must be in the same unit as the age change.

### 2.6 Defects

D3, D5, D26. See section 15.

### 2.7 Quint notes

Model alone, then compose with plan and vouch machines. Vars: `age: Member -> Option[int]`, `netMinor: Member -> bool` (Network's view), `ledgerEligible`, `removed`. Add a nondeterministic action `networkLearnsMinor(m)` that does not emit. Invariant `netMinor(m) implies no new entry for m` fails today. That gives the counterexample for D3.

## 3. capital-vouch-lifecycle

One instance per invitee. Lives in the invitee's `MemberRec`: `vouchedBy`, `activated`, `valueInWindow`, `valueProviders`, `safetyFlagged`, `vouchCreditId`, `stakeTaken`, `abuseAt`, `joinedAt`.

### 3.1 States

Implied product of flags. The useful projection:

| State | Condition |
|---|---|
| NoVouch | no `vouchedBy` |
| Waiting | `vouchedBy`; missing activation, value or both |
| ActivatedOnly / ValueOnly | one of the two set |
| Credited | `vouchCreditId` set |
| Blocked | `safetyFlagged`, or `removed`, or ineligible; no credit is possible |
| WindowClosed | value window passed with no credit |
| StakeTaken | `stakeTaken` |
| CreditReversed | `vouchCreditId` entry in `reversed` |

### 3.2 Transitions

| From | Event | Guard | Effects | To | Line | Who |
|---|---|---|---|---|---|---|
| none | member_joined with `vouchedBy` | not self | set `vouchedBy` | Waiting | 146 | Network at welcome |
| Waiting | member_activated | | `activated=true`, try credit | ActivatedOnly or Credited | 158-164 | Network, onboarding end |
| Waiting | value_received | in 30 days, not yet set, at least one provider who is not voucher, not self, not tied to voucher, eligible; and a confirmer in that set or a non-counterpart verification | `valueInWindow=true`, `valueProviders=confirmed`, try credit | ValueOnly or Credited | 165-186 | Network, feedback |
| any | safety_flag | | `safetyFlagged=true` (permanent; `serious` not read) | Blocked if not Credited | 187-191 | Network, trust change |
| any | abuse_confirmed | first time | `abuseAt = t` | same | 208 | staff closes case |
| not Stake | member_removed serious_abuse | within 90 days of `joinedAt`, measured to `min(abuseAt, t)`, voucher eligible | `stakeTaken=true`; reverse credit if any; penalty -10 | StakeTaken | 192-204 | staff closes case |
| not Stake | member_removed serious_abuse | within window, voucher not eligible | `stakeTaken=true`; no penalty | StakeTaken | 199-201 | |
| Credited | fraud_confirmed | credit involved | clawback | CreditReversed | 308-318 | reviewer |

`tryVouchCredit` (ledger.ts:356-364): skip if no voucher, or credit exists, or stake taken. Skip if invitee ineligible, not activated, no value, flagged, removed. Skip if `t - joinedAt > 30 days`. A refused `credit` (voucher ineligible or removed) leaves `vouchCreditId` unset.

### 3.3 Invariants

- V1 (PRD 39.2.2): credit needs activation, value inside 30 days, and no safety flag.
- V2: at most one credit and at most one stake per invitee.
- V3 (capital-1): the invitee's own word is not proof.
- V4 (capital-17): no self-vouch.
- V5 (PRD 39.2.2): the stake is bounded to serious abuse within about 90 days.
- V6: a stake never fires twice, with or without a credit.

Liveness (conditional): if an adult invitee activates and gets confirmed value in the window with no flag, the voucher gets a credit. This fails in the product (D2).

### 3.4 Interactions

- `tiesOf` reads the whole log (ledger.ts:342-354).
- `detectGaming` reads `confirmedBy` on vouch entries (vouch_ring; detect.ts:124-140).
- `vouchCapacity` counts unreversed vouch entries and stake entries (levers.ts:71-78).
- Network's `abuse_confirmed` and `member_removed` have the same key (`caseId`) and the same t (network.ts:1266-1267). In `order by t, id` the abuse event sorts first, so replay is safe by luck of the alphabet.

### 3.5 Concurrency and failure

- Activation after value and value after activation both work, because `tryVouchCredit` runs on both.
- A `member_removed` before `abuse_confirmed` at an earlier t would use the removal time. The Network never does this.
- Activation later than day 30 with value in the window gives no credit (line 361 tests the current event's t). The PRD says value within 30 days and says nothing on activation time. Low importance.

### 3.6 Defects

D2, D9, D15. Open by product choice: capital-14.

### 3.7 Quint notes

One invitee, one voucher, two providers. Vars: the flags, `day` bounded to 0..100 with steps at 29, 30, 31, 89, 90, 91. Keep `tiesOf` as a nondeterministic boolean. Invariants V1, V2, V6. Add a witness: `Credited` is reachable. Under the product's emitter (`value_received` with no `confirmedBy` and no `verifiedBy`), the witness has no trace. Also check `StakeTaken` without earlier credit is reachable: a voucher can lose but never win.

## 4. capital-plan-commitment

One instance per `(member, planId)`. `plans: Map<string, PlanRec>` (ledger.ts:48, type line 31).

### 4.1 States

`PlanRec { accepted, startsAt, confirmed, resolved, attendedEntry?, feedback }`.

| State | Condition |
|---|---|
| Absent | no record |
| Accepted | not confirmed, not resolved |
| Confirmed | confirmed, not resolved |
| CancelledFree | resolved, no entry |
| CancelledLate | resolved, no_show entry (maybe forgiven) |
| NoShowFree | resolved, not confirmed, no entry |
| NoShowForgiven | resolved, entry with amount 0 |
| NoShowPenalized | resolved, -3 |
| Ghosted | resolved, -2 (no entry if ineligible) |
| AttendedUncredited | resolved, no `attendedEntry` |
| AttendedCredited | resolved, `attendedEntry` |
| AttendedFeedback | `attendedEntry` and `feedback` |

`accepted` is always true on a record. So `!p.accepted` on lines 242 and 250 is dead.

### 4.2 Transitions

| From | Event | Guard | Effects | To | Line | Who |
|---|---|---|---|---|---|---|
| Absent | plan_accepted | | store `startsAt` | Accepted | 213-216 | Network, reveal sent (network.ts:4083) |
| not Absent | plan_accepted | | ignored; `startsAt` is not updated | same | 215 | |
| Accepted | plan_confirmed | | `confirmed=true` | Confirmed | 218-221 | member says yes, or 48 h silence (network.ts:2356-2365) |
| resolved | plan_confirmed | | ignored | same | 220 | |
| Absent | any resolve event | | ignored | Absent | 224, 233, 241, 249 | |
| Accepted or Confirmed | plan_cancelled | `t <= startsAt - 4h` or not confirmed | `resolved` | CancelledFree | 226-228 | member, or STOP (network.ts:2508) |
| Confirmed | plan_cancelled | `t > startsAt - 4h` | `resolved`, `noShow` | CancelledLate | 229 | |
| Accepted | plan_no_show | | `resolved` | NoShowFree | 234-236 | Network finalize |
| Confirmed | plan_no_show | | `resolved`, `noShow` | NoShowForgiven or NoShowPenalized | 237 | |
| Accepted or Confirmed | plan_ghosted | | `resolved`, -2 if eligible | Ghosted | 241-245 | finalize |
| Accepted or Confirmed | plan_attended | no verification | `resolved` | AttendedUncredited | 250-252 | finalize |
| Accepted or Confirmed | plan_attended | only counterpart verification and no valid confirmer | `resolved` | AttendedUncredited | 257 | |
| Accepted or Confirmed | plan_attended | verified, member can earn | `resolved`, credit | AttendedCredited | 258-260 | |
| Accepted or Confirmed | plan_attended | verified, member cannot earn | `resolved` | AttendedUncredited | 258-260 | |
| AttendedCredited | feedback_given | not yet | `feedback=true`, credit scaled by the attendance multiplier, `basis` | AttendedFeedback | 264-271 | finalize |
| not AttendedCredited | feedback_given | | ignored | same | 265 | |

`noShow` (ledger.ts:366-375): skip if ineligible. If fewer than `forgivenNoShows` forgiven entries in the last 90 days, write a forgiven entry with amount 0. Otherwise -3.

Network side (finalize, network.ts:2733-2769), one attempt per opportunity (`o.finalized`):

- Present and verified: `plan_attended`, then `feedback_given` at the same t if the member answered.
- `said.came === false`: `plan_no_show`.
- Pair, reported missing by the other: `plan_ghosted`, or `plan_no_show` if the member spoke in words.
- Nothing known: no event. The record stays open for ever.

### 4.3 Invariants

- P1: every plan record resolves at most once. A resolved record never changes.
- P2 (PRD 39.2.2): a no-show costs NC only after confirming.
- P3: cancelling at least 4 hours before start is free. Declining is never a cost (design 2.4).
- P4 (PRD 15.2): one forgiven no-show per 90 days.
- P5: attendance credit needs verification by someone other than the member.
- P6 (capital-7): feedback credit needs an attendance credit, and goes with it.
- P7: a net penalty on one plan is at most max(noShow, ghosting).

### 4.4 Interactions

- The Network's own record: `o.status`, `o.bookedAt`, `o.confirmed`, `o.explicit`, `o.finalized`. `plan_confirmed` is emitted by silence too. So "confirmed" in the ledger does not mean "the member said yes". `o.explicit` selects ghosted or no_show, but the ledger has no such field.
- STOP: `handleDrop` emits `plan_cancelled` when `m.optedOut` (network.ts:2508). So a STOP inside the 4-hour cutoff is a late cancellation (D12).
- A drop forced by trust, by minors policy or by an other member has `ack=false` and no opt-out, so no event. The record stays open.
- `value_received` does not depend on this machine.

### 4.5 Concurrency and failure

- All Network emits for one opportunity are in one unit, under the advisory lock. They commit with the state. Crash before commit: state rolls back and `finalize` runs again with the same ids. Memory is ahead (D6) but ids dedupe.
- Same-t order: `plan_attended` then `feedback_given` is inverted by the service replay (D1).
- `plan_cancelled` and `plan_confirmed` in one unit: the replay runs cancelled first. Live order was confirmed first. Then replay gives a free cancellation where live gave a late one. Rare.
- The ledger does not check that `plan_attended` or `plan_no_show` come after `startsAt`. It trusts the emitter.

### 4.6 Defects

D1, D11, D12, D14.

### 4.7 Quint notes

One member, one plan, two time points relative to the cutoff. Vars: `pstate`, `confirmed`, `confirmedBySilence`, `forgivenCount`. Keep the Network's `explicit` as a separate var. Invariants P1 to P7. Add a property that the code does not claim yet: `silentConfirmed and cancelled late implies no penalty`. It fails. Use it to record capital-15 as a product decision. Merge with capital-entry-reversal for the feedback link.

## 5. capital-help-confirmation

One instance per `helpId`. `helps: Map<string, HelpRec>` (ledger.ts:49).

| From | Event | Guard | Effects | To | Line |
|---|---|---|---|---|---|
| Absent | help_given | helper is not recipient | store | Open | 274-277 |
| Open or Resolved | help_given | same id | ignored | same | 275 |
| Absent | help_confirmed | | ignored, and the id is `seen` for ever | Absent | 281 |
| Open | help_confirmed | wrong recipient | ignored | Open | 281 |
| Open | help_confirmed | not useful, or recipient not eligible | `resolved` | ResolvedNoCredit | 282-283 |
| Open | help_confirmed | useful, eligible | `resolved`, credit to helper | ResolvedCredited | 284 |

If the helper cannot earn, `credit` returns undefined and the state is ResolvedNoCredit.

States: Absent, Open, ResolvedNoCredit, ResolvedCredited. No expiry on Open.

Network emits both events in one call, same t (network.ts:2802-2803), for a two-person request with a skill match and not a retry. `need_answered` replaces it on a retried request (network.ts:2798).

Invariants: H1 one credit per helpId. H2 (PRD 39.2.2) credit only on the recipient's confirmation. H3 no self-help. H4 the confirmer is the stored recipient.

Failure: the order of `help_given` before `help_confirmed` is required. There is no pending state for an early confirmation. So any reorder loses the credit for good. The id is already in `seen`, so a resend does not help. That is D1.

Quint notes: small, 2 members, 2 ids. Model with a reorder action to show the loss. Merge into the persistence model for D1.

Defects: D1, D26.

## 6. capital-entry-reversal

### 6.1 State

Append-only `log`, `byMember`, `byId`, `reversed: Set<entryId>` (ledger.ts:42-44, 51). Entry states: Active, ZeroAmount (still written so detection sees it), Reversed. Reversed is terminal.

### 6.2 Transitions

| From | Event | Guard | Effects | To | Line |
|---|---|---|---|---|---|
| none | credit | member eligible, not removed, base > 0 | entry; amount after multipliers | Active or ZeroAmount | 378-411 |
| Active | fraud_confirmed, member in set and eligible | `sign=1`, `amount>0`, not reversed, a counterpart or confirmer in set, or `basis` reversed | clawback entry `-amount`, `reverses` | Reversed | 309-318, 417-423 |
| Active vouch | member_removed serious_abuse | in window | clawback entry | Reversed | 202 |
| none | fraud_confirmed, member in set | no fraud entry in last 30 days | penalty -10 | penalty Active | 320-321 |

Entries are frozen (ledger.ts:429-434). Id is `${log.length}:${ev.id}:${member}`. It depends on log position, so a different replay order gives different ids. Nothing outside the ledger stores them today.

### 6.3 Invariants

- R1: entries are never edited or deleted (ledger.ts:3-5).
- R2: an entry is reversed at most once. The clawback amount is the exact negative.
- R3: `balance` = sum of entry amounts. A reversed credit plus its clawback sums to 0.
- R4: dependents go with their base: feedback goes with attendance (capital-7). Order in `byMember` is by time, so a base is reached before its feedback, in one pass.
- R5: fraud penalty at most once per member per 30 days. Clawback has no such limit.
- R6: a clawback never touches another member's entry (`orig.member !== member` guard, line 419).

### 6.4 Interactions

- `credit` counts clawbacks of in-period credits against the cap (ledger.ts:399, capital-2).
- `credit` still counts reversed entries in `seenWith` and `nCat`. Reversed credits still decay later credits. Conservative.
- `detectGaming` ignores reversed entries (detect.ts:26-27, capital-m3). `whatYouBuilt`, `vouchCapacity`, `organizingReach` do too.

### 6.5 Concurrency and failure

Synchronous. A feedback that arrives after its attendance was reversed is credited and stays until a later fraud event names that member (ledger.ts:265 has no reversed check). The Network emits feedback only in `finalize`, with the attendance, so this does not happen today.

### 6.6 Defects

D4, D11.

### 6.7 Quint notes

Merge with capital-fraud-review. Vars: `entries: Set[{id, member, amt, cps, basis}]`, `reversed`. Invariants R1 to R6. Use integers for amounts (thousandths) and fix multipliers at 1.

## 7. capital-fraud-review

Explicit. `FraudItem.status`: `review`, `confirmed`, `dismissed`, `expired` (network.ts:87-91). Stored in network state (`fraud`, `fraudSeq`; network.ts:4675, 4730). Not reachable in production: `flags` needs the reader.

### 7.1 Transitions

| From | Event | Guard | Effects | To | Line | Who |
|---|---|---|---|---|---|---|
| none | daily `queueFraudFlags` | flag from `detectGaming`; no member in `declinedIds`; no item with the same kind and members in review or decided in the last 14 days | item, deadline +14 days, log | review | network.ts:2808-2817 | cron (tick, 3296) |
| review | reviewer approves | decision valid; note if reason is other | status; log; `fraud_confirmed`; `review_completed` if the reviewer is a member | confirmed | 2831-2842 | staff |
| review | reviewer rejects | same | status; log; `review_completed` | dismissed | 2831-2842 | staff |
| review | reviewer edit or reroll | | refused | review | 2835 | |
| review | daily check | `now >= deadline` | status; log | expired | 2818 | cron |
| any | forget of any member in the flag | | item deleted from the list | none | 965 | member or staff |
| confirmed, dismissed, expired | decide | | `not_in_review` | same | 2833 | |

Cool-down: after a decision or expiry, the same set can queue again 14 days later if `detectGaming` still flags it. The simulated auto reviewer never decides fraud items (network.ts:1850-1851).

`detectGaming` is pure (detect.ts:23): input `ledger.all()` and `now`; output flags. Window 30 days. Kinds: `reciprocal_ring`, `staged_meetup`, `vouch_ring`.

### 7.2 Invariants

- F1 (detect.ts:2-3, PRD 39.2.6): a flag never changes NC. Only `fraud_confirmed`, from a human, does.
- F2: an item is decided once.
- F3: no message goes to any member (network.ts:2830).
- F4: a reviewer does not decide a case about themself (fixes-core item 29; not enforced).
- F5: `fraud_confirmed.members` holds only confirmed members (fixes-core item 29; not built, whole set only, capital-12).
- F6: confirmed clawback is settled: the same credits do not raise the same flag again (capital-m3).

Liveness: an item leaves `review` within 14 days (expiry). This needs the daily tick. There is no liveness for "gaming gets a decision": `expired` drops the item without any effect or alert.

### 7.3 Interactions

- The ledger reader reads `ledger.all()` in memory. The Network state is in Postgres. After a restart the item list comes back from state and the ledger from `capital_events`.
- Emission of `fraud_confirmed` is inside the staff action unit. It commits with the status.
- `member_removed`, `abuse_confirmed`: independent paths.
- `recentPenalty` in levers reads the fraud entry (90-day lock).

### 7.4 Concurrency and failure

- Decision and expiry run under the unit lock, so no race.
- Decision with the review deadline passing in the same tick: if the tick has not run, a late decision still works (`status` is still `review`). `decideFraud` does not read `deadline`. Harmless.
- Two flags with different kinds over the same members produce two items, and the second `fraud_confirmed` claws back nothing and adds no penalty inside 30 days. Safe by R5.

### 7.5 Defects

D11, D17, D18, D23.

### 7.6 Quint notes

Merge with capital-entry-reversal. Vars: `items`, `flagged: Set[Set[Member]]`, `reviewer`, `now` in days. Actions `queue`, `approve`, `reject`, `expire`, `forget`. Invariants F1, F2, F4, F5, F6. Bound: 3 members, 2 items, 30 days in steps of 7.

## 8. capital-rate-windows

Implicit: rolling windows derived from entries. No stored counters.

| Window | Size | Rule | Line |
|---|---|---|---|
| Pair decay | 30 days, or 90 for controlled credits | `pairDecay^k`; mean over counterparts, or min for controlled | ledger.ts:384, 404-405 |
| Category decay | 30 days | `1/(1+n/softN)` | 407 |
| Period cap | 30 days, 40 NC | `room = max(0, cap - inPeriod)` net of in-period clawbacks | 397-399, 408-409 |
| Forgiveness | 90 days | at most 1 forgiven | 369-370 |
| Fraud penalty | 30 days | once | 320-321 |
| Vouch value window | 30 days from join | | 168, 361 |
| Stake window | 90 days from join | | 198 |
| Cancel cutoff | 4 hours before start | | 228 |
| Vouch ties | 30 days | `tiesOf` | 344 |

Controlled: `help`, `needs_answered`, or attendance with `pairChosen` (ledger.ts:383, 452-457).

Invariants:

- W1: for every member and every t, the sum of positive credits with age below 30 days, net of in-window clawbacks, is at most 40, plus rounding below 0.001 per credit.
- W2: amount is at least 0 for a credit. Rounding to 3 places.
- W3: a clawback of an older credit adds no room (capital-2).
- W4: windows are half-open at the boundary: `age < period` counts, `age >= period` does not. The forgiveness test and the fraud test use `<` too. The value and stake tests use `>` for out, so day 30 exactly is in. Mixed on purpose? Not documented.

Clock: all ages use `ev.t`. A rejected out-of-order event is not counted. No wall clock in the ledger.

Defects: D15 (ties window). Order sensitivity (capital-19): at the cap, the order of same-t credits decides who gets the room. With one member it decides which category gets it.

Quint notes: abstract multipliers. Model the cap only, with integer credits and time in days. W1 needs a sum over a window; use a bounded list of 6 entries.

## 9. capital-lever-locks

Pure functions of one member's entries and the caller's `at` (levers.ts). State is derived.

| Lever | States | Line |
|---|---|---|
| Effort tier | T0 to T3 by all-time balance: 15, 45, 120 | 52-61 |
| Vouch capacity | Locked (0 for 90 days after abuse or fraud), or `clamp(0..5, 2 + min(3, good) - 2*lost)` | 67-78 |
| Organizing reach | Locked (4), or `min(16, 8 + 2*floor(sessions/3))` | 92-99 |

Transitions: a new entry moves the value at once. A lock ends only by time. No event needed (capital-18 fixed the old stuck lock).

Consumers: `canInvite` (network.ts:2650-2653) with a separate rolling 30-day count in `m.invites`; `withReach` (3241-3263); `effort` (2687). All are off in production, and the floors apply: 3 invites, reach 8, `FLOOR_EFFORT`.

Invariants:

- L1 (PRD 39.2.3): levers read one member's own entries. Never another member's.
- L2: no lever is an input to matching rank. `OVERLAY_ENGINE_KEYS = ["judge"]`.
- L3: a minor sits at the floor. `canInvite` has its own `!m.minor`.
- L4: top effort is capped at index 1.10. Tiers have diminishing returns.
- L5: locks end. For any `at >= penalty.t + 90 days`, the lock is off.

Notes:

- `lost` never expires (capital-14, not fixed): vouch capacity after one lost stake is at most 3 and after two is at most 1 for ever.
- `balance` never decays. Tier 3 once earned stays unless penalties take it away.
- `good` and `sessions` count entries of amount 0 (levers.ts:75, 96). A member at the period cap gets a lever bonus from a credit that paid nothing (D22).
- `cfg.levers.vouch.periodDays` is validated (config.ts:128) and never read (D21). The 30-day invite window in `canInvite` is a literal.
- `EFFORT_TABLE[...].engine` has no reader in the Network (capital-21). `effort` takes only `.network` (capital.ts:40).

Quint notes: low value alone. Model `vouchCapacity` with the vouch machine for one reachability check: after D2 is fixed, capacity can rise. Today it can only fall.

## 10. capital-service-persistence

Priority P1: this is the only part of the capital code that changes stored production data.

### 10.1 State

- Table `network.capital_events (app_id, id, type, member_id, t, event jsonb, primary key (app_id, id))` (migration 0007, lines 254-262). No sequence column. `select, insert, delete` for `network_service` (line 269). Row-level security per app.
- In-memory `NetworkRuntime.capital` (wiring and ledger), one per `(app, city)` (runtime.ts:118).
- `Unit.capital: CapitalEvent[]` (runtime.ts:60, 69).

Per-event states: Emitted, InMemory, Rejected-in-memory, InUnit, Stored, Forgotten.

### 10.2 Transitions

| From | Event | Guard | Effects | To | Line | Who |
|---|---|---|---|---|---|---|
| none | `onLedger(e)` | | `ledger.record` in a try; push to `unit.capital` always | InMemory or Rejected, and InUnit | runtime.ts:162, capital.ts:54-58 | Network |
| InUnit | unit write | not `u.forget` by `member` field | `insert ... on conflict (app_id, id) do nothing` | Stored | 504-507 | same transaction as state |
| InUnit | unit fails | | unit dropped; memory keeps the event | InMemory only | 69, load path | |
| Stored | forget of id | `member_id = id` or `position('"id"' in event::text) > 0` | delete | Forgotten | 537 | leave, delete, under-age decline |
| Stored | `start()` | ordered by `t, id` | `ledger.record`; a throw is swallowed | InMemory | 342-344 | process start |

### 10.3 Invariants

- S1: for a committed unit, every event it produced is stored, in the same transaction as state.
- S2: after restart, ledger state equals the state before restart (design claim, store.ts:1-3, ledger.ts:59-60). False (D1, D4, D7).
- S3: after forget, no stored event names the member (test at service-platform.test.ts:585 checks only `member_id`). Holds by the `position` clause. The jsonb form is an object, so the clause works (checked).
- S4: forgetting one member leaves other members' ledgers correct. False (D4).
- S5: a member's forget also removes them from the live ledger. False (D5).

### 10.4 Interactions

- Writes run inside `writeUnit` with messages, events and the outbound queue.
- Forget also scrubs `network.events`, messages, and more, in one transaction.
- `health()` reads `count(*)` and `rejected`.
- Migration order: the table is older than some data; state saved before it has no rows, which is fine.

### 10.5 Concurrency and failure

| Case | Result |
|---|---|
| Crash before commit | state, messages and events all roll back; memory is lost too. Replay matches. Safe. |
| Unit fails, process lives | memory is ahead of Postgres. The retry re-emits the same ids; `seen` skips them; `unit.capital` still gets them, so they are stored with the retry's t. Memory keeps the first t. Ids with `now` in the key (`safety_flag`, `state_changed`) are new ids, so memory has two (D6). |
| Duplicate delivery | stable ids; primary key; `do nothing`. |
| Two instances | each ledger sees only its own events. `load` refreshes state but not the ledger (serviceStore, runtime.ts:356 on; D8). |
| Clock goes back | live rejection, row stored; replay accepts it (D7). |
| Same t | replay order differs from live order (D1). |

### 10.6 Quint notes

This is the best target in this package. Vars: `pg: Set[Event]`, `mem: Ledger`, `unit: List[Event]`. Actions: `emit`, `commit`, `abort`, `forget(m)`, `restart`. Ledger abstraction: just the help machine, the plan machine for one member, and fraud. Property: `restart` preserves `balance(m)` for every m not forgotten. Every counterexample here is a verified defect, so the model should reproduce D1 and D4 in few steps. Bound: 3 members, 6 events, 2 restarts.

## 11. capital-jsonl-store

`JsonlCapitalStore` (store.ts:32-65). No caller outside the package. fixes-core item 24 asked for it or a Postgres store; the service uses its own table instead, and passes no `store`.

States of the file: Absent, Clean (ends with newline, every line valid), TornTail (no final newline), Corrupt (a bad line that is not the last).

| From | Event | Effects | To | Line |
|---|---|---|---|---|
| Absent | load | empty | Absent | 37 |
| TornTail | load | truncate to last newline | Clean | 39-43 |
| Clean | load | parse | Clean | 44-55 |
| Corrupt | load | throw | Corrupt | 48-53 |
| Clean | append | one line with sync append | Clean | 61-64 |
| Clean | crash in append | | TornTail | |
| Clean | partial write, process lives (ENOSPC, for example) | `appendFileSync` throws; the ledger does not change; no truncate | TornTail, with a live process | |
| TornTail | append | text is joined to the torn line | Corrupt | 61-64 |

Invariants: J1 lines before the tail are valid. J2 a torn tail was never applied. J3 load is idempotent. J4 the writer is single-process (not enforced).

Claim check: store.ts:29 says a line is on disk before the ledger changes. `appendFileSync` has no fsync, so the line is in the OS cache. After a power cut an event can be lost that memory-derived work relied on. Process crash is safe.

Defect: D16.

Quint notes: only worth it if this store goes into use. Three states, one action each.

## 12. capital-staff-read-audit

`entriesFor(viewer, member)` (ledger.ts:82-96), `staffReads` (52), `audit()` (111).

| From | Event | Guard | Effects | Line |
|---|---|---|---|---|
| | member reads own | `viewer.member === member` | entries; vouch `confirmedBy` hidden | 83-84, 93-95 |
| | member reads other | | throw | 84 |
| | staff read | no reason | throw | 86 |
| | staff read | reason | store first, then memory, then return | 87-90 |

Invariants: A1 (PRD 39.2.6): entries are visible only to the member and audited staff. A2: an unaudited staff read is impossible: if `appendRead` throws, no data is returned. A3: `all()` and `internalEntries` skip audit by design; they are internal (ledger.ts:102-108). A4: reads hide who the invitee met (capital-10).

`internalEntries` and `all` are public methods. The privacy rule depends on callers. Only `ledgerReader` calls them.

No production caller of `entriesFor` or `audit`. PRD 39.2.4 asks for a private history. `whatYouBuilt` has no caller either.

Read time: `t` is `lastT`, not a Clock read (D25).

Quint notes: not needed. A static review is enough.

## 13. capital-sim-review-loop

`packages/capital/experiments/world.ts`. Harness only.

State:

- `queue: CapitalEvent[]` (line 142), flushed by day and sorted by `(t, id)` (440-442).
- `reviewQ: {day, members}[]` (251), `reviewed: Map<key, day>` (252).
- Persona: `active`, `removed`, `gamingStopped`, `activateDay`, `removeDay` (cast), `vouchTimes`.

Flag life in the sim:

| From | Event | Guard | Effects | To | Line |
|---|---|---|---|---|---|
| none | daily detection | key not reviewed in the last 14 days | `reviewed`, `flagsRaised++`, push with day+2 | Queued | 446-453 |
| Queued | day reached | has a bad member, p 0.9 | `fraud_confirmed` on whole set or on bad members only | Confirmed | 454-466 |
| Queued | day reached | all honest, p 0.02 | whole set confirmed | ConfirmedFalse | 458 |
| Queued | day reached | else | nothing | Dropped | 460 |

Persona invitee: `invited → joined(day+2) → activated(day+3..7) → flagged → removed`. Removal emits `abuse_confirmed` and `member_removed` at the same t (349-350).

Divergence from the product:

| Topic | Simulator | Product |
|---|---|---|
| `value_received` | has `confirmedBy` and `verifiedBy` (240, 286, 366, 398) | neither (network.ts:2604) |
| Help value | sends `value_received` with the helper | no help value event |
| `age_updated` | never | never |
| Ghosting | only without confirming (218-219) | after silent confirm too |
| Flag key | members only (447) | kind and members (network.ts:2809) |
| Review time | 2 days, always decided | up to 14 days, then expiry |
| Reviewer decides per member | option | no |
| Ledger reader | live, in the same process | off |
| Restart and replay | never | `start()` |
| Forget | never | yes |

Small issues: flags raised on the last two days are never decided (`day + 2 >= days`), and they stay in `flagsRaised`. The sort is lexical on ids (`x99` after `x100`), which inverts same-t pairs when `seq` gains a digit; the only same-t pair that depends on order is abuse and removal, and with the same t the result is the same. The file's own rule on derived ids (lines 33-40) is not broken by `h${seq}`, since help ids do not feed `Keyed`.

Quint notes: do not model. Use it as a source of parameters.

## 14. capital-launch-gates

`run.ts`, `scripts/sim/capital.ts`.

- `launchGates` (run.ts:157-167): `pass = primaryFairness.ok && gaming.ok`.
- `attributable.ok` needs `seeds >= 32` and `lower >= -0.02` (run.ts:210-215).
- Gaming: every strategy `<= 0.25`. NaN compares false, so it fails closed (run.ts:152).
- `capitalBlock`: fairness is blocking unless `quick` (scripts/sim/capital.ts:16). With `quick`, seeds = 4 and `ok` is false, as a tracked gate.
- Health target: tracked only.

Status: the fairness gate is red and needs a founder decision (docs/mvp-gaps.md:44-60). Not a defect of state. Design doc section 2.9 still says PASS, with older thresholds (index 1.12, staged 3); the current numbers are in config.ts and levers.ts.

Quint notes: not useful.

## 15. Suspected defects

D13 and D24 are not used. Confidence: high means read in code and, where the table in 0.3 says so, reproduced on the real ledger. "Latent" means that nothing in production reads the result today.

### D1. Service replay order is not accepted order. Confidence: high. Latent for members; stored data is the input.

Where: runtime.ts:342 (`order by t, id`), network.ts:2802-2803, network.ts:2755-2756, ledger.ts:263-265, 279-281. The table has no sequence.

Trigger: one help round. `help_given:o` and `help_confirmed:o` are emitted at one t. Restart. `help_confirmed:o` sorts first, finds no record and is ignored. Then `help_given:o` opens a record that never resolves. Helper's balance 3 becomes 0. Same for `feedback_given:*` before `plan_attended:*`: every feedback credit is lost on restart.

Each restart changes every balance that had help or feedback, and the cap and decay results that follow. This breaks ledger.ts:59-60 ("A restart keeps balances, levers and audit"). Related: capital-19 (not fixed).

### D2. Vouch credit is unreachable in the product. Confidence: high.

Where: network.ts:2604, ledger.ts:179-181. AGENTS.md decision 11, fixes-core item 26 ("Without this, production vouch credit is zero").

Trigger: invitee activates, meets a member, says it was good. `value_received` has only `with`. `confirmed` is empty and `verified` is false. The event is dropped. So: no vouch credit, no capacity bonus (levers.ts:75), and no `vouch_ring` flag. The stake path is reachable. A voucher can lose 10 and never earn 10. This is the same for every invite.

### D3. `age_updated` is never emitted. Confidence: high. P0 in intent; latent in effect.

Where: no emit in network.ts (grep over `packages/network`, `packages/platform`, `scripts`), ledger.ts:151-156, network.ts:2690-2696, 715-720. AGENTS.md decision 11, fixes-core item 27.

Trigger: an adult at join, then a text shows 16 and `m.minor` is set. The ledger stays eligible. The member keeps accruing, and counts as counterpart and confirmer for others. Other way: a 17-year-old joined with `age: null` turns 18; the ledger stays ineligible for ever. The event stream in the database carries no correction.

### D4. Forget deletes events that belong to other members. Confidence: high.

Where: runtime.ts:537, `position('"id"' in event::text)`.

Trigger A: ring a, b, c. Fraud confirmed. b leaves. `fraud_confirmed` names b, so the row goes. After restart a's balance goes from -10 to +4.849: all clawbacks and the penalty are gone, for every ring member. Leaving is enough; a ring can undo a fraud decision on purpose.

Trigger B: voucher v leaves. Invitee's `member_joined` has `vouchedBy: v`, so the row goes. After restart the invitee is Unknown. All later events about them are ignored. Their balance is 0 and they are ineligible.

Trigger C: a's `plan_attended` names b as a counterpart. b leaves. After restart a's plan is open and the credit is gone.

This does change stored data today. The privacy need is real, so a fix must redact the id in place, not drop the row. Design choice for the owner.

### D5. The in-memory ledger has no forget. Confidence: high. Latent.

Where: no method in ledger.ts; the forget loop in `writeUnit` (runtime.ts:454 on) scrubs tables only.

Trigger: leave. `ledger.members`, `byMember`, `log` keep the id until restart. With a reader on, `detectGaming` reads `ledger.all()` and can queue a flag that names a forgotten member. Also memory and Postgres disagree until restart.

### D6. Memory changes before commit. Confidence: high. Latent.

Where: runtime.ts:162. `capital.onLedger(e)` runs in the unit. A failed unit (service-platform SVC-10 shows these happen) leaves the event in memory. Trigger: a trust change in a unit that fails; the retry has a new `now`, so `safety_flag:<id>:<to>:<now>` is a new id; memory has two events and Postgres has one. For ids without `now` the event stays in memory with the first t while Postgres has the retry's t.

### D7. Rejected events are stored and accepted on replay. Confidence: high. Partly latent.

Where: runtime.ts:162 (push is outside the try), runtime.ts:343 (empty catch), capital.ts:57. No `ledger_rejected` log exists (fixes-core item 23; grep finds none). Only a count reaches `/health`.

Trigger: clock steps back. Live ledger refuses the event and `lastT` holds. Row is stored. After restart, sorted by t, it is accepted. Live and replay differ. Note that `capital-3` says a harness should fail on any reject; the service has no such step.

### D8. The ledger is not refreshed at unit load. Confidence: medium. Latent.

Where: runtime.ts:118, 342 (`start` only), `serviceStore.load`. `health` shows a lock holder per network, so more than one instance is possible. If instance B handles a unit, instance A's ledger never sees those events. State is reloaded per unit; the ledger is not. With a reader on, levers differ per instance. I did not verify how many instances production runs.

### D9. `safety_flag` is permanent and `serious` is not read. Confidence: high on code; medium that it is wrong.

Where: ledger.ts:187-190, network.ts:1192, types.ts:43-44, trust.ts:70, 139.

Trigger: a "watch" trust change on an invitee (`serious: false`) that later returns to ok. There is no clearing event. Vouch credit is blocked for good. PRD 39.2.2 says "has no safety flags", so the literal rule holds. But types.ts:43 defines `serious`, and PRD 39.2.6 says vouch liability is for "serious confirmed violations" only.

### D10. `need_answered` burns its key when no credit is written. Confidence: high. Low impact.

Where: ledger.ts:299-301 against 292-293. Trigger: a minor answers a need; later is 18; a new event for the same need earns 0. `organized` in the same case earns 4. The two dedupes disagree. capital-6 fix.

### D11. No reversal for a wrong penalty or a wrong clawback. Confidence: high on absence.

Where: types.ts has no such event; ledger.ts:228-237, 308-324. Trigger: review confirms a whole flagged set with one honest member (capital-12: sim measures honest NC lost). No event restores credit, removes the fraud entry or lifts the 90-day lock. Same for a mistaken no-show: `resolved` is terminal. A human correction has no path. Missing transition, and capital-12 is still partly open.

### D12. A STOP or a silent confirm can cost NC. Confidence: high on code; product call needed.

Where: network.ts:2508, 2356-2365; ledger.ts:228-229, 236-237. capital-15 (open, "product call").

Trigger A: booked plan. 48 hours of silence set `confirmed`. Member texts STOP 3 hours before. `handleDrop` emits `plan_cancelled` since `m.optedOut`. Ledger: late cancellation, no-show path. The forgiven one takes the first; the second costs 3.

Trigger B: silent confirm, then the member says after the plan that they could not come: `plan_no_show` with cost, for a person who never said yes in words. AGENTS.md decision 11 says only `answer: "yes"` is consent. PRD 39.2.2 says "a no-show after confirming". Design says "Only follow-through on accepted commitments counts".

### D14. Open records never leave. Confidence: high. Low impact.

Where: `plans` and `helps` maps; network.ts `finalize` "Nothing known". No expiry and no memory limit. Trigger: a meeting with no answers. The record stays Accepted or Confirmed for ever. No effect on balance. Memory grows with plans × members for the life of the process, and replay cost grows.

### D15. `tiesOf` uses the short window for credits with a long window. Confidence: high. Low to medium.

Where: ledger.ts:344 against config.ts:30, ledger.ts:383-384. Trigger: voucher and friend exchange help on day 0; friend provides invitee value on day 40. `ties` misses the friend, though the pair decay and the ring rules treat help as a 90-day tie. The comment at 171-173 says "inside the pair window", which is not clear on which one.

### D16. JSONL: a partial write with a live process corrupts the file. Confidence: high. Latent (store unused).

Where: store.ts:39-43 fixes the tail only in `load`; store.ts:61-64 appends blind. Trigger: disk full during one append, space returns, next append joins the torn line. Next load throws, and `new CapitalLedger(..., {store})` cannot start until someone edits the file. Also store.ts:29 "on disk" is not true without fsync.

### D17. A reviewer can decide their own fraud item, and earns review credit. Confidence: high. Latent.

Where: network.ts:2831-2842. `decideFraud` compares nothing against `x.flag.members`. fixes-core item 29, capital-17 "partly fixed". Trigger: trained steward in a flagged ring rejects the item; `review_completed:<fraudId>:<reviewer>` is emitted.

### D18. Forget removes the whole fraud item. Confidence: high. Latent.

Where: network.ts:965. Trigger: one ring member leaves while the item is in review. The item goes for all. The 14-day dedupe (network.ts:2813) has nothing to compare with, so the next daily run can queue again, still naming the forgotten id because of D5, since only `declinedIds` are skipped (2811) and a leaver is not in that set.

### D19. Ids can collide for a second city of one app. Confidence: medium. Latent.

Where: primary key `(app_id, id)` in migration 0007 line 261; `on conflict do nothing` at runtime.ts:507; `fraud-${seq}` (network.ts:2814); `start()` reads a whole app, not a network (runtime.ts:342). `platform.networks` allows many cities per app. Today each app has one city. With two cities, `fraud-1` of the second city is silently dropped, and each runtime replays both cities' events.

### D20. The joined Network and ledger path has no gate. Confidence: high.

Where: scripts/sim.ts, scripts/sim/capital.ts; section 13 table. The gates in the capital block measure a stream that the product does not produce. D2 is the plainest case: the sim's 10 NC vouch credit does not exist in the product. So "gaming gate passes" does not speak for the product event stream.

### D21. Written but never read. Confidence: high. Cleanup.

- `levers.vouch.periodDays` (config.ts:54).
- `plan_attended.publicVenue` (always true from the Network, and the ledger ignores it).
- `plan_accepted.kind`.
- `PlanRec.accepted`.
- `safety_flag.serious` (D9).
- `member_removed` reasons `left`, `other` (validated, never emitted; so a leaver is not `removed` in the ledger).
- `EFFORT_TABLE.*.engine`.
- `CapitalPack` in engine/src/pack.ts:313-318 (names policy; the ledger does not read it).
- `whatYouBuilt`, `entriesFor`, `audit`, `isReversed`, `balance`: no product caller. PRD 39.2.4 expects the private history in the MVP.

### D22. Levers count zero-amount credits. Confidence: high. Low.

Where: levers.ts:75, 96. A vouch or session at the period cap has amount 0 and still raises capacity or reach. The detection needs them; the levers may not.

### D23. Detection reads members who are not eligible. Confidence: high. Low.

Where: capital.ts:41 uses `ledger.all()`, not filtered. A member later found to be a minor (after D3 is fixed) can be named in a flag to a staff reviewer, and `fraud_confirmed` skips them (ledger.ts:311). The honest counterpart is clawed back in the same case. Staff only, no member contact.

### D25. Audit time is not a read time. Confidence: high. Low.

Where: ledger.ts:87. `t: this.lastT`. A staff read in a quiet period is dated at the last event. Before any event it is -Infinity, which JSON stores as null. An audit trail should carry the Clock time. Comment at ledger.ts:110 calls it an audit trail.

### D26. Removed members still count as confirmers and recipients. Confidence: high. Low to medium.

Where: ledger.ts:175, 254-255, 283, 290, 298. All test `isEligible`, which does not read `removed`. Trigger: a member removed for scam, or a sock puppet, confirms help, or stands as an attendee for `organized`. The helper is credited. Comment at ledger.ts:253 says "Only eligible adult members". Member-removal is not part of that word, but ledger.ts:26 says the removed earn nothing, and a removed confirmer is the same gaming surface. The Network drops most such members first, so reach is narrow.

## 16. Open questions, not defects

- Does the Network move `meetingAt` after a booking? If so, the ledger's cutoff uses the old `startsAt`.
- `startsAt: o.meetingAt ?? now()` (network.ts:4083): a scheduled opportunity with no meeting time would make every cancel late. `finalize` returns early with no `meetingAt`. I did not find or rule out a path to that state.
- Per-app or shared ledger (capital-16, PRD Phase 5): open founder item (docs/mvp-gaps.md:324). The service has one ledger per app and city. Age and ban facts are person-level. A person who is confirmed as a gamer in one app starts clean in another.
- How to reconcile D4 with deletion: pseudonymize the id in other members' events, or keep tombstones.
- Should stake apply when a voucher never earned the credit? Today yes.

## 17. Suggested Quint order

1. `capital-persistence.qnt` (P1): sections 1, 5, 10, with a small plan and fraud part. Reproduces D1, D4, D7.
2. `capital-eligibility.qnt` (P0): section 2, with the Network's age view. Reproduces D3. Compose with the wider minors model from the network research.
3. `capital-fraud.qnt` (P1): sections 6 and 7. Checks D11, D17, D18, F1 to F6.
4. `capital-plan.qnt` (P1): section 4 with cutoff, silent confirm, and forgiveness. Records D12 as a decision.
5. `capital-vouch.qnt` (P1): section 3, with an emitter switch: product shape or simulator shape. Reproduces D2.
6. Optional: section 8 cap model.

Common abstraction: integer time in days, integer amounts, multipliers fixed at 1 except in the cap model, 3 members, and no detection maths (`flag` is a nondeterministic action). Keep the ledger as an event list plus a pure fold, so that "replay in another order" is one line.
