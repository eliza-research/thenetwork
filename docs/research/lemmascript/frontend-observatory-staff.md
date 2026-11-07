# LemmaScript research: Observatory staff workflows

Hand-written by a research agent, at commit a0ed7bc. Read-only study: no code in the repository changed.

Slice: `packages/observatory/web/admin.tsx`, `review.tsx`, `apps.tsx`, `ops.tsx`, `network.tsx`. Context read: `web/store.ts`, `web/ui.tsx`, `web/drawer.tsx`, `src/server.ts`, `src/staff.ts`, `src/apps.ts`, `packages/network/src/network.ts`, `docs/admin-console.md`, `packages/observatory/test/staff.test.ts`.

## Summary

A skeptic pass corrected this report. The section "Verification" says what changed and why.

- Section 4 lists 17 bugs and 1 unverified item. Each row says how it was checked. Bugs 1, 2, 3 and 16 can send a human-review decision to an item the reviewer did not look at.
- The review rule "an expired proposal is never sent late" fails in a short window. `ConsentNetwork.decide()` accepts an approve after the deadline if no tick ran. A probe went out (bug 4). The service ticks every 60 s, so the normal window is about one minute. It is longer only if ticks fail or stop.
- The server keeps the safety rules for minors, role checks and photo release. No bug here lets a minor be matched. Release of a held text about a minor is also refused or blocked on the server (G3 was closed). The risk is a wrong human decision, not a bypass of a server guard.
- The slice has no bulk action and no optimistic update. A decision changes the page only after the server answers. Grep for "bulk" and "optimistic" in `web/` found nothing.
- No file in the slice can be annotated in place in a useful way. Each `.tsx` function reads the `store` singleton, renders JSX or calls `await`. The pure decisions are small and extract cleanly into one module.
- Six candidates survive: `keyStep`, `approveBlock`, `reportOffer`, `flip`, `can` and `reviewStatus`. Each proved. For each one, a model of today's code or a mutant failed under the same contract. Six other candidates were rejected as trivial, as a copy of the code, or as work that a type does better.

Evidence files (not in the repository):

- `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-observatory-staff/ui-repro.tsx`: the real components in happy-dom with a stubbed `fetch`. Scenario names S1-S12 below refer to this file.
- `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-observatory-staff/late-approve.ts`: the real `ConsentNetwork` in the repo's `Mini` world, with no model calls.
- `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-observatory-staff/*.verify.ts`: the first `lsc` trials.
- `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-staff/`: the skeptic pass. `ui-recheck.tsx`, `ui-recheck2.tsx` and `ui-recheck3.tsx` hold scenarios S5b and S12b-S19. `late-approve.ts` is the extended late-approve run. `*.verify.ts` are the final contracts and the models that must fail.

Limits of the evidence: happy-dom has no real keyboard activation and no real key repeat. S3 sends `repeat: true` events by hand. S7 shows `preventDefault` on the keydown; that a browser then skips the click is browser behaviour, not something this run saw. No model was called, and no real service, database or browser was used.

## 1. Inventory

Verdict words: **in-place** (annotate where it is), **extract** (move the pure part out, then verify), **n/a** (not applicable, with the reason).

Shared reasons for n/a: **JSX** is a React component with no decision of its own. **Fetch** is real `await` or network I/O. **Data** is a constant table.

### web/review.tsx

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| review.tsx:13 | `reviewerName` | Name of the reviewer of record | n/a: display only; reads `store.me`; uses a regex |
| review.tsx:15 | `reasonLabel` | Label of a reason code | n/a: lookup and display |
| review.tsx:17 | `reasonOf` | Reads `[code] note` from a note | n/a: regex is the logic |
| review.tsx:23 | `reviewLine` | Text for the review state | extract: `reviewStatus` (candidate 6; bug 17) |
| review.tsx:42 | `historyBetween` | Earlier items with the same people | n/a: `.sort()` and `store.opps`; no property worth the proof |
| review.tsx:48 | `wantsOf` | A request's text belongs to the requester | in-place possible after `originOf` becomes a parameter; low value |
| review.tsx:53 | `swappable` | Who a re-roll can swap | n/a: rejected as a candidate; see item 18 |
| review.tsx:69 | `useReviewCtl` | Hook with mode, note, drafts, error | extract: the state belongs in a reducer (candidate 1) |
| review.tsx:81 | `approveBlock` | Why approve is refused | extract: candidate 2 |
| review.tsx:90 | `editsOf` | Edits that differ from the texts | n/a: rejected as a candidate; the stale-draft rule is in candidate 1 |
| review.tsx:99 | `act` | Sends a decision | n/a: real `await`; its target and edits come from candidate 1 |
| review.tsx:109 | `ReviewActions` | Buttons and edit form | n/a: JSX; enable rule is candidate 2 |
| review.tsx:117 | `toggle` (in `ReviewActions`) | Button mode switch | extract: same reducer as candidate 1 |
| review.tsx:123 | `reject` (in `ReviewActions`) | Reject, "other" needs a note | extract: same reducer |
| review.tsx:127 | `approve` (in `ReviewActions`) | Approve if not blocked | extract: same reducer |
| review.tsx:129 | `reroll` (in `ReviewActions`) | Swap out one person | n/a: thin wrapper over `act` |
| review.tsx:180 | `ReviewQueue` | Queue, selection, keyboard | extract: the keyboard is the main candidate |
| review.tsx:190 | `sel` (in `ReviewQueue`) | Derived selection | extract: `rebind` must run when this value changes |
| review.tsx:193 | `select` (in `ReviewQueue`) | Move selection, reset controller | extract: same |
| review.tsx:199 | `next` (in `ReviewQueue`) | The item after a decision | n/a: `nextSel` was rejected; it does not reach bug 3 |
| review.tsx:200 | `afterDecision` (in `ReviewQueue`) | Moves on after a decision | n/a: closure; bug 3 is here |
| review.tsx:206 | `onKey` (in `ReviewQueue`) | Keyboard handler | extract: candidate 1 |
| review.tsx:291 | `countDecisions` | Counts by decision | extract only if the counts become a gate; low value |
| review.tsx:300 | `ReviewCard` | One card | n/a: JSX |
| review.tsx:363 | `isBusyElsewhere` | "busy" badge | n/a: a hint only; the Network decides busy |
| review.tsx:369 | `VenueLink` | Venue link | n/a: JSX |

### web/admin.tsx

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| admin.tsx:11 | `useFetch` | Load and poll | n/a: hook with fetch; bug 13 is in the keys its callers pass |
| admin.tsx:23 | `Err` | Error line | n/a: JSX |
| admin.tsx:27 | `BIAS_METRICS` | Columns | n/a: Data |
| admin.tsx:32 | `BiasMonitor` | Weekly bias view | n/a: JSX; the ratio rule is the engine's |
| admin.tsx:58 | `SafetyCases` | Safety tab | n/a: JSX with Fetch; filters are simple |
| admin.tsx:104 | `HELD_QUEUES` | Queue names | n/a: Data |
| admin.tsx:110 | `HeldTexts` | Held text queues | n/a: JSX with Fetch |
| admin.tsx:131 | `HeldRow` | One held text | n/a: `canRelease` and `canReject` were rejected as copies of one expression |
| admin.tsx:139 | `loadPhoto` (in `HeldRow`) | Loads the selected photo | n/a: real `await` and DOM blob |
| admin.tsx:146 | `act` (in `HeldRow`) | Release or reject | extract: guard only; the send is Fetch |
| admin.tsx:183 | `CaseRow` | One safety case | extract: lift and close rules (gap G1) |
| admin.tsx:187 | `act` (in `CaseRow`) | Lift or close | n/a: real `await` |
| admin.tsx:232 | `ReportRow` | One post-date report | extract: `reportOffer` (candidate 3) |
| admin.tsx:237 | `act` (in `ReportRow`) | Hold, ban, dismiss, clear | n/a: real `await` |
| admin.tsx:281 | `OUTCOME_TONE` | Colours | n/a: Data |
| admin.tsx:283 | `Requests` | Member requests | n/a: a typed `Record` covers bug 12; `segOf` was rejected |
| admin.tsx:287 | `isOpen` (in `Requests`) | Open outcomes | n/a: two comparisons |
| admin.tsx:334 | `fmtMetric` | Format by unit | n/a: `toFixed` and `toLocaleString` are not in the subset |
| admin.tsx:338 | `Scorecard` | PRD 28.2 table | n/a: JSX; `met` comes from the server |
| admin.tsx:356 | `Growth` | Growth table | n/a: JSX |
| admin.tsx:378 | `Config` | Matching switch, settings | extract: `flip` (candidate 4) |
| admin.tsx:387 | `flip` (in `Config`) | Two-press switch | extract: candidate 4 |
| admin.tsx:427 | `AuditLog` | Audit table | n/a: JSX with Fetch |
| admin.tsx:460 | `auditCode` | Audit suffix | n/a: display only |
| admin.tsx:466 | `ARMS` | Lab arms | n/a: Data |
| admin.tsx:467 | `Lab` | Lab form and list | n/a: simulation only; the server validates (`validateLab`) |
| admin.tsx:480 | `start` (in `Lab`) | Starts a run | n/a: real `await` |
| admin.tsx:519 | `secs` | Short duration | n/a: `Math.round` is not in the subset; display only |
| admin.tsx:520 | `LabResults` | Result table | n/a: JSX |
| admin.tsx:521 | `zero` (in `LabResults`) | Colour of a must-be-0 count | in-place possible; three branches, low value |
| admin.tsx:545 | `fmtN` | Number format | n/a: `toFixed`; display only |
| admin.tsx:546 | `DiffTable` | Run diff table | n/a: JSX |
| admin.tsx:562 | `TopList` | Top configurations | n/a: JSX |
| admin.tsx:567 | `RunDiffView` | Two runs | n/a: JSX with Fetch |

### web/apps.tsx

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| apps.tsx:10 | `AppSwitcher` | App tabs | extract: "show tabs" is a role rule; low value, the server checks |
| apps.tsx:26 | `AppPage` | Page selector | n/a: JSX |
| apps.tsx:36 | `MATCHING_TEXT` | Labels | n/a: Data |
| apps.tsx:38 | `AllApps` | Health of every app | n/a: JSX with Fetch; numbers come from the server |
| apps.tsx:79 | `PersonLookup` | Find a person | n/a: Fetch and regex |
| apps.tsx:84 | `find` (in `PersonLookup`) | Lookup | n/a: real `await` |
| apps.tsx:105 | `PersonView` | One person across apps | n/a: Fetch; bug 10 needs a request guard, not a proof |
| apps.tsx:146 | `AppPanel` | One app's panel, opened with a reason | extract: "reason at least 5 characters", shared with `canReject` |
| apps.tsx:151 | `read` (in `AppPanel`) | Reads the panel | n/a: real `await` |
| apps.tsx:184 | `CrossAppButton` | Opens the person view | n/a: JSX with Fetch |

### web/ops.tsx

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| ops.tsx:8 | `KINDS` | Cost columns | n/a: Data; matches `CostKind` in `network/service/cost.ts:33` |
| ops.tsx:9 | `usd` | Money format | n/a: `toFixed`; display only |
| ops.tsx:11 | `CostPanel` | Cost panel | n/a: JSX with Fetch |
| ops.tsx:31 | budget tone (inline) | bad at 100%, warn at 80% | extract possible; three branches, low value |

### web/network.tsx

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| network.tsx:7 | `Level` | Type | n/a: type |
| network.tsx:8 | `Levels` | Game-mode scenarios | n/a: JSX; simulation only; the server gates `reset` to admin |

### Helpers the slice depends on (web/store.ts, web/ui.tsx)

| Line | Function | Purpose | Verdict |
|---|---|---|---|
| store.ts:528 | `can` | Client role check | extract: candidate 5 |
| store.ts:536 | `isAdmin` | `can()` with no role | follows from candidate 5 |
| store.ts:538 | `canSim` | Game controls | matches `SIM` at `src/server.ts:142` |
| store.ts:784 | `canAct` | Actions are possible here | n/a: one line over `env` |
| store.ts:786 | `canReview` | `canAct` and reviewer | follows from candidate 5 |
| store.ts:764 | `reviewPending` | Queue order and filters | extract: only if the order becomes a rule |
| store.ts:794 | `decide` | One decision per item | n/a: real `await`; the in-flight rule is too small to prove |
| store.ts:325 | `load` fallback | Admin when `/api/me` fails | extract: bug 7 |
| ui.tsx:25 | `dur` | Duration | n/a: display; `minutesShown` was rejected as trivial |
| ui.tsx:71 | `Countdown` | SLA countdown | n/a: display; `countdownTone` was rejected as trivial |
| panels.tsx:668 | `showActions` | Second approve path, in the opportunity panel | n/a: one line over `canReview`. It uses `ReviewActions` with its own controller. `OpportunityPanel` has `key={f.id}` (panels.tsx:35), so bugs 1 and 3 do not apply. Bug 5 does. |
| main.tsx:36 | `onKey` (in `App`) | Global keys | n/a: DOM. Queue keys take priority in the capture phase. |
| drawer.tsx:61 | drawer body | Mounts the tab | n/a: JSX. The queue unmounts when the drawer closes, so its keys cannot act on an unseen card. |
| safe.ts:15 | `memberTooltipText` | Tooltip with "Under 18" | n/a: display; reads `minor` only |
| admin.tsx:360 | `row` (in `Growth`) | Table row | n/a: JSX |
| admin.tsx:571 | `head` (in `RunDiffView`) | Run title | n/a: JSX |

## 2. Journeys as state machines

### J1. One review item (reviewer)

| State | Meaning |
|---|---|
| Queued | `IN_REVIEW`, no decision, shown with a countdown |
| Selected | The card is open; the time-spent clock runs (`store.reviewOpen`) |
| Moded(m, id) | Reject, edit or re-roll is open **for item id** |
| Sending | `store.deciding` holds the id |
| Probing | Approved; contact can start |
| Closed | Rejected, invalidated or expired |

Transitions: Queued to Selected (`j`, `k`, click, focus, or the head of the list). Selected to Moded (`r`, `e`, `s`). Selected or Moded to Sending (`a`, a digit, a button). Sending to Probing (approve passes `reviewBlock` and `approvalCheck`). Sending to Closed (reject, or `approvalCheck` fails and sets `invalidated`). Queued to Closed (tick at or after the deadline). Reroll sends the item back to Queued with a new deadline. With no alternate it goes to Closed with no decision (bug 17).

Invariants:

- I1. A decision goes only to the item the reviewer chose or saw. **Fails** (bugs 1, 3, 16).
- I2. No decision from a repeated key. **Fails** (bug 2).
- I3. No approve for a minor, a declined person, an unknown person or while matching is off. Holds on the server (`reviewBlock`, network.ts:1941). The client check fails open for an unknown person (bug 9).
- I4. No approve at or after the deadline. **Fails** (bug 4).
- I5. A refusal is shown to the reviewer. **Fails** when the item also closes (bug 6).
- I6. An approve that follows an edit sends the edit, or the reviewer is told that it does not. **Fails** on the keyboard (bug 5). The button label changes from "Approve with edits" to "Approve", so the click path gives a weak notice (S5b).
- I7. A closed item never shows a countdown. **Fails** (bug 17).

### J2. Held text (safety)

States: Listed, ReasonTyped (5 or more characters), PreviewLoaded (photo only), Acknowledged (photo only), Released, Rejected.

Invariants, which hold on reading, in the `canRelease` trial and in `held-photo-ui.test.tsx`:

- Release needs a reason, and for a photo a loaded current preview and an acknowledgment. The server checks it again at `src/server.ts:677`.
- A text about a minor or an unknown age is never shown and cannot be released from the page.
- Reject is always possible with a reason.

`textHidden` blocks Release in the page (admin.tsx:174), and `POST /api/held` (`src/server.ts:666`) does not check it. The rule still holds on the server. A leak-queue release is refused when the age is in doubt (`network/service/service.ts:2334`). A relay release runs `relayItem` again, a minor party gives the block family `minor`, and `rendered` stays empty (`engine/src/relay.ts:308`, `network/src/relay.ts:357-361`). By reading only; no run. One limit: service.ts:2334 applies only when the parked text has a `memberId`.

### J3. Post-date report (safety)

States: open, held, banned, dismissed. Backend transitions (`decideReports`, network.ts:1353): open to held, open to banned, **held to banned**, open to dismissed. Banned and dismissed are final.

Page transitions (admin.tsx:257, 266): only from `open`. The arrow held to banned exists in the backend and has no control in the page (bug 8). A hold also takes the report out of the default "Open" view.

Invariant: a report that is not final offers the actions that the backend allows. **Fails** for held.

### J4. Safety case

States: open, held, lifted, closed. Lift and close need `canAct` and the safety role. The note is optional in the page and on the server (`checkSafety`, src/server.ts:869-870). See gap G1.

### J5. Matching switch (admin)

States: Idle, Armed(4 s), Sent. Invariant: the confirm press sends the direction the first press asked for. **Fails** (bug 11, S9): the page stores only "armed", not the direction.

### J6. Cross-app person view

States: Closed, Summary(person), AppPanel(person, app, reason). Invariants: a panel opens only with a reason of 5 or more characters, and the audit row comes first. Holds. The summary on screen belongs to the id in the header. **Fails** (bug 10).

### J7. Staff session and role

States: Unknown (before `/api/me`), Known(grants), NoRole. Invariant: the page never shows more authority than the grants give. **Fails** (bug 7): a failed `/api/me` gives the page an admin identity. The server still refuses every call.

## 3. Ranked candidates

All contracts below use real `//@` syntax. "Proved" means `lsc check --backend=dafny` finished with no errors on the extracted function. It does not cover the React shell, and `number` is an integer in the model. Files are in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-staff/`.

A candidate stays here only if it passes two tests. The contract must say something other than the code. A model of today's code, or a mutant, must fail under the same contract.

### 1. `keyStep` and `rebind`: one keyboard and button reducer. Effort M.

```ts
export function keyStep(ctl0: Ctl, selId: string, k: Key, digit: number, repeat: boolean, blocked: boolean, canAct: boolean): Step {
  //@ verify
  //@ requires selId !== ""
  //@ ensures \result.cmd.tag === "approve" ==> \result.cmd.id === selId && ctl0.boundId === selId && canAct && !repeat && !blocked
  //@ ensures \result.cmd.tag === "approve" && ctl0.draftsId === selId ==> \result.cmd.withEdits
  //@ ensures \result.cmd.tag === "approve" && \result.cmd.withEdits ==> ctl0.draftsId === selId
  //@ ensures \result.cmd.tag === "reject" ==> \result.cmd.id === selId && ctl0.boundId === selId && ctl0.mode === "reject" && canAct && !repeat
  //@ ensures \result.ctl.boundId === selId
}
```

`boundId` is the item last chosen by `j`, `k` or a click. A selection that moved without a choice swallows the next key. The first version required only `cmd.id === selId`, which is true of today's code in that clause and misses bug 16. The second `ensures` now catches bug 5.

Breaks if violated: a decision goes to an item the reviewer did not choose (bugs 1, 2, 5, 16). It does not reach bug 3: that bug is a stale closure in the shell.
Trial: `keys.verify.ts` proved (5 verified, 0 errors). `keys-today.verify.ts` failed (1 verified, 5 errors).
Blockers: `ReviewMode` has the member `"none"`, and building that value fails (section 5). Workaround: rename it to `"idle"`. Key events, `store` and timers stay in the shell. The shell must clear `draftsId` when a reviewer discards an edit on purpose.

### 2. `approveBlock`, fail closed, with the deadline. Effort S.

```ts
export function approveBlock(canAct: boolean, ids: string[], people: Map<string, Person>, matchingOff: boolean, now: number, deadline: number): Block {
  //@ verify
  //@ ensures \result === "idle" ==> canAct && !matchingOff && now < deadline
  //@ ensures \result === "idle" ==> forall(k: nat, k < ids.length ==> people.has(ids[k]) && !people.get(ids[k]).minor && !people.get(ids[k]).declined)
}
```

Breaks if violated: the page offers an approval for a minor, for an unknown person or after the SLA (bugs 4 and 9, page side only).
Trial: `gate.verify.ts` proved (2 verified, 0 errors). `gate-today.verify.ts`, with `?.minor` and no deadline, failed (1 verified, 2 errors).
Blockers: `store` reads. Pass the members as a `Map` and the flags as arguments. The real fix for bug 4 is in `ConsentNetwork.reviewBlock`, outside this slice, and the same contract fits a pure extract of it.

### 3. `reportOffer` against the backend's table. Effort S.

```ts
export function reportOffer(status: Status, canBan: boolean, safety: boolean): Offer {
  //@ verify
  //@ ensures canBan && safety ==> \result.ban === backendBan(status) && \result.hold === backendHold(status) && \result.dismiss === backendDismiss(status)
  //@ ensures !(canBan && safety) ==> !\result.ban && !\result.hold && !\result.dismiss
}
```

`backendBan`, `backendHold` and `backendDismiss` copy the table of `decideReports` and `dismissReport`. The contract says that two tables agree. The earlier `reportNext` was dropped: its `ensures` lines repeated its `if` lines. `clear_minor` is outside this model.

Breaks if violated: a person on hold cannot be banned from the console (bug 8).
Trial: `report.verify.ts` proved (1 verified, 0 errors). `report-today.verify.ts` failed (0 verified, 1 error).
Limit: the proof is as good as the copy. Share the table with `packages/network` to remove that risk.

### 4. `flip`: the matching switch keeps the direction. Effort S.

```ts
export function flip(p: Pending, current: boolean): Flip {
  //@ verify
  //@ ensures \result.send ==> p.active && \result.on === p.target && \result.on !== current
  //@ ensures !p.active ==> !\result.send && \result.pending.active && \result.pending.target === !current
  //@ ensures p.active ==> !\result.pending.active
}
```

Breaks if violated: proactive matching turns on when an admin meant to turn it off (bug 11).
Trial: `flip.verify.ts` proved (1 verified, 0 errors). `flip-today.verify.ts` failed (0 verified, 1 error). The timer stays in the shell.

### 5. `can`: the client rule equals the server rule. Effort S.

```ts
export function can(grants: Grant[], app: string, real: boolean, want: Role): boolean {
  //@ verify
  //@ ensures \result <==> exists(k: nat, k < grants.length && serverKeeps(grants[k], app, real) && (grants[k].role === "admin" || grants[k].role === want))
  //@ ensures want === "cross_app_safety" && \result ==> exists(k: nat, k < grants.length && grants[k].role === "admin")
  //@ ensures real && want === "engineer" && \result ==> exists(k: nat, k < grants.length && grants[k].role === "admin")
}
```

`serverKeeps` copies `rolesFor` (staff.ts:180) with its early exits. `clientCounts`, used in the body, copies the filter of store.ts:529. The first version had only `==>`, so a function that returns `false` always passed it.

Breaks if violated: the page shows a control for a role the person does not hold, or hides one they hold. The server still refuses, so the value is low to medium.
Trial: `roles.verify.ts` proved (2 verified, 0 errors). `roles-mutant.verify.ts`, with the engineer filter removed, failed (1 verified, 1 error).
Limit: this covers the `grants` path. The fallback `?? this.me?.roles` at store.ts:529 skips the filter, and `rolesFor` does not. The live server always sends `grants` (`staffUser`, staff.ts:109), so the difference is not reachable today. The `me` fallback of bug 7 is a separate fix.

### 6. `reviewStatus`: "waiting" only while the item waits. Effort S.

```ts
export function reviewStatus(r: Review): Line {
  //@ verify
  //@ ensures \result === "waiting" ==> r.inReview && r.decision === "pending"
  //@ ensures \result === "approved" ==> r.decision === "approve" && !r.invalidated
  //@ ensures \result === "rejected" ==> r.decision === "reject"
  //@ ensures r.decision === "pending" && !r.inReview ==> \result === "closed_unsent"
}
```

The earlier contract said `"waiting" <==> r.decision === undefined`. It proved, and it wrote bug 17 into the specification. The earlier claim that "any unknown decision prints Rejected" is true only of the prover's `Option<string>` model. The type allows three values, so that case cannot occur.

Breaks if violated: a closed item shows a live countdown (bug 17).
Trial: `line.verify.ts` proved (1 verified, 0 errors). `line-today.verify.ts` failed (0 verified, 1 error). Pass `decision` as a plain union with a `"pending"` member: an optional union field becomes `Option<string>`.

### Rejected candidates

| Candidate | Why rejected | Trial |
|---|---|---|
| `canRelease`, `canReject` | The contract is the one boolean expression of admin.tsx:154 and 174, written again. | Proved (`prior/safety-rows.verify.ts`), no value |
| `mayApproveNow` | `\result <==> now < deadline` is the body. The rule moved into candidate 2. | Proved, no value |
| `reportNext` | Each `ensures` repeats an `if`. | Proved, no value |
| `editedIds` | It checks membership only. A `Map` keyed by participant cannot see a stale plan, and the server refuses blank text. | Proved, no value |
| `swappable` | The server refuses with `cannot_swap`. The contract also misses the seat manager rule (item 18). | Proved, no value |
| `nextSel` | It proves an index is in range. Bug 3 is a stale closure outside the model. | Proved, no value |
| `segOf` | `OUTCOME_TONE` shows the pattern: a `Record<ObsRequest["outcome"], ReqSeg>` makes `tsc` find bug 12 with no prover. | `segOf` no error; `shownSomewhereToday` failed |
| `countdownTone`, `minutesShown` | Three branches and one `Math.floor`. Each contract restates the body. | Proved, no value |

### Not worth proving

`usd`, `pct`, `num`, `fmtMetric`, `fmtN` and `secs` use `toFixed` or `toLocaleString`. The bugs in this slice are in event order and scope, which LemmaScript cannot see in the shell. Bugs 2, 3, 10 and 11 need a shell test as well as a proof. The tests policy allows an integration case; `packages/observatory/test/held-photo-ui.test.tsx` shows the pattern, and `ui-repro.tsx` can seed it. A harness warning: updates inside one `act()` scope are batched, so an intermediate render can be lost (see S13 in "Verification").

## 4. Confirmed bugs

Ranked by harm. "Ran" means reproduced on the real code, with a stubbed server unless the row says otherwise. "Read" means checked by reading only. Numbers are stable, so 16 and 17 sit where their harm puts them.

| # | Where | Input | Effect | How |
|---|---|---|---|---|
| 1 | review.tsx:190, 193-196, 100, 216-233 | Press `e` on A. A leaves the queue (expired, or another reviewer) or focus moves to B by a map or pipeline click. Press `a`. | B is approved with A's plan: `{"oppId":"B","decision":"edit","objective":"Plan A says private thing about A"}`. The same with `r`, then a digit: `{"oppId":"B","decision":"reject","reason":"tone"}`. The note follows too. `sel` is derived, and only `select()` resets the controller. The same with `s`, then a digit: `{"oppId":"B","decision":"reroll","swapOut":"m3"}`. The button says "Approve with edits", but a key press does not need the reviewer to read it. | Ran S1, S2, S2b, S18 |
| 16 | review.tsx:190, 218 | No mode open. The reviewer reads the first card, chosen by default. A new item with a sooner deadline arrives. Press `a`. | The new item N is approved, unread. `sel` falls back to `pending[0]`, and the list sorts by deadline. After `j`, `k` or a click, `selId` holds the card, so this applies to a card nobody chose. | Ran S16 |
| 2 | review.tsx:218, 207 | Hold `a`. The answer takes 20 ms. | One held key approved A, B, C and D. `store.decide` stops only a press while the same item is in flight; the handler does not read `e.repeat`. It breaks "a person reviews every proposal". | Ran S3 (repeat events sent by hand) |
| 3 | review.tsx:204, 209, 218 | Press `a` on A, then `j`, `j` to C. A's answer is late. Press `a`. | The card jumps from C to B and the second approve goes to B. `afterDecision` is taken from `live.current` at the first key press. | Ran S7b |
| 4 | network.ts:1941-1955 (`reviewBlock`), review.tsx:81 | Item past its deadline, no tick yet. `decide(id, "approve")`. | `{"ok":true}`, 30 minutes past the SLA. Log: `review_decision`, `send_deferred`, `probe_sent`. Breaks "an expired proposal is never sent late" (docs/admin-console.md 3.2). Only `advance()` on a tick checks the deadline. The page shows "Due now" and leaves Approve on. The 30 minutes is a clock jump in the test. The service ticks every 60 s (`TICK_MS`, serve.ts:107), so the normal window is about a minute, and longer only when ticks fail or stop. In the same run a second item, untouched, expired at the tick; so the approve won only because it came first. | Ran `late-approve.ts` on the real `ConsentNetwork` |
| 5 | review.tsx:100, 219 | Press `e`, rewrite a text, press `r`, press `a`. | `{"oppId":"A","decision":"approve"}` with no edit. The original text goes out. The same when the reviewer clicks Reject, then Approve; there the label changes from "Approve with edits" to "Approve". Also S4: a second `e` wipes the drafts with no warning; the Edit button toggles instead (review.tsx:119-121 against 221-224). | Ran S4, S5, S5b |
| 6 | review.tsx:104, 174, 101 | Approve fails on re-check (`held`, `busy_elsewhere`, `blocked_pair`), and the item closes. | Nothing on screen: alerts `[]`, toast `null`. `quiet` is `true`, and the error shows only on a card with that id, which has gone. The reviewer can believe that it was approved. Two limits. If the close reaches the page after the answer, the alert shows until the card goes. The feed gets a warning row, and the Decided tab says "stopped on re-check" (projector.ts:324-331). | Ran S6 (the stub closes the item first); limits read |
| 7 | store.ts:325 | `/api/me` fails on a `load()` while `/api/mode` succeeds. If `/api/mode` fails too, `load()` stops before this line. | A reviewer becomes `roles: ["admin"]` in the page; `isAdmin()` is true. The server refuses every call, so the effect is on the page only: it shows admin controls, and `store.me.id` changes to "token", so `reviewerName` no longer says "you". | Ran S8 |
| 8 | admin.tsx:257, 266, 70 | Press Hold on a report, then try to ban. | A held report shows no action: only the two member links. Backend allows held to banned (network.ts:1355). Clear minor signal is also out of reach. | Ran S10 |
| 17 | review.tsx:32, projector.ts:304-308 | A re-roll with no alternate. The item closes as `SKIPPED` with no decision. | The opportunity panel shows "Due in 11h · re-rolled 1×" on a closed item. `reviewLine` reads no decision as "still waiting". The Decided tab leaves the item out, as it filters on `decision`. Real mode reads the same fields (real.ts:688). | Ran S15 for the line; projector path read |
| 9 | review.tsx:83-84 | A participant id is not in `store.members`. | `?.minor` is `undefined`, so Approve stays on. The server refuses with `participant_minor` (network.ts:1951). No harm to a member; the page rule is weaker than the server rule. | Ran S17 |
| 10 | apps.tsx:108-111 | Open person A, then person B, and A's answer comes last. | Header "Person bbbbbbbb", text "Lowest age 15": the age of A on B's page. No guard in the effect, unlike `AllApps` and `useFetch`. Any AppPanel opened in that state is for A, and its audit row names A. | Ran S11 |
| 11 | admin.tsx:381, 387-391 | Admin presses "Turn off". Another admin turns it off within 4 s. Admin presses confirm. | `{"type":"matching","on":true}`: matching turns on. The label changes to "Confirm: turn on" under the cursor. | Ran S9 |
| 12 | admin.tsx:280, 287, 297, 301 | A request with outcome `booked`. | It is in no segment but All, and in no `open` or `fulfilled` count. The Network sets this outcome at network.ts:2442 and calls it "a meeting is set" (network.ts:394). | Ran S14: Open 0, Fulfilled 0, None 0, Answered 0, All 1 |

Further confirmed, smaller:

| # | Where | Input | Effect | How |
|---|---|---|---|---|
| 13 | admin.tsx:60, 34, 380, 431 | Switch the app with the drawer open. | The `useFetch` keys of Safety, Bias, Config and Audit have no app. With the real `setApp`, if both apps have the same switch value, the Config title says `friends` over ntwrk's history and settings. The on/off badge is still right, because the key holds that value, so `flip` cannot send a wrong value from this bug. With different values Config reloads. Safety corrects at its 10 s poll, Bias at 60 s. Config and Audit wait for another change. | Ran S12b for Config; read for the others |
| 14 | review.tsx:208, 240 | Enter on any focused button, with a card selected and the Review tab open. | The capture handler calls `preventDefault`, and focus moves to the opportunity. Keyboard users cannot press a button with Enter in this state. `a` also works when the help popover is open, as only inputs are excluded. | Ran S7 for `defaultPrevented`; browser effect inferred |
| 15 | ui.tsx:71, admin.tsx:204, 252 | Hover a countdown on a safety case. | The title says "Review deadline". The prop `what` is not passed. | Ran S19 for a case; read for a report |

Not run:

| # | Where | Input | Effect | How |
|---|---|---|---|---|
| 18 | review.tsx:53; admin.tsx:257-263 | A seat item on peon, or a ban by staff with `safety@<app>` only. | The page offers controls that the server always refuses. `swappable` omits the seat manager rule of `reroll` (network.ts:2013). `canBan` comes from the data source, not the role, and `ban` needs safety on every app (service.ts:1738). The refusal shows, so no decision is lost. | Read, unverified |

### Gaps that are not defects in code

- G1. Lift hold and Close case need no note and no second press (admin.tsx:219-221; `src/server.ts:869-870`). A hold protects members, and a report action needs 5 characters. The doc says "close a case with a decision". The audit row has no reason when the note is empty. A founder or maintainer must say if this is intended.
- G2. Ban phone and Ban person have no confirm step, but the matching switch has one. The button tooltip says that the number can never join again.
- G4. In real mode `Countdown` uses the store clock, which stops when the socket is down. A dot shows "Reconnecting". The time shown then runs high. It corrects on reconnect.
- G6. A decision sends `oppId` only, with no version. A re-roll keeps the id. If a second reviewer re-rolls an item, a first reviewer's approve in that short window goes to a person they did not see. Read only; no run. It also needs a server change, so the fix is outside this slice.
- G5. `docs/admin-console.md` says that fraud items show in the queue. No file in `packages/observatory/src/sources` or `projector.ts` names them. No claim is made here about how they display.

## 5. Subset notes for this slice

- A string-literal union with the member `"none"` compiles and proves when the code only compares with it. It fails when the code builds that value, for example `{ mode: "none" }`: `member 'None' does not exist in datatype 'Mode'`. `ReviewMode`, `ReqSeg` and `ObsRequest["outcome"]` all use this member.
- An optional union field (`decision?: "approve" | "reject" | "expired"`) is emitted as `Option<string>`. A plain union is an enum.
- A helper used in a spec or a call needs its own `//@ verify` once the file has any marked function.
- `.filter` and `.slice` results need a lemma for `parts.includes(...)`. A `for` loop with an invariant proved at once.
- After a contract change, delete the `.dfy` and `.dfy.gen` files. Otherwise `lsc` prints a warning about modified generated lines and exits with no result. A filter on "verifier finished" then shows nothing, which can look like success.
- `rebind` needed `requires selId !== ""`. The prover found the empty id; the shell must keep `sel` non-empty before it calls the reducer.

## Verification

Skeptic pass on the same commit, a0ed7bc. All commands ran from `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-staff/`, or from `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-observatory-staff/` for the first two. No model was called. No real service, database or browser was used, and `bun run sim` and the test suites did not run. `lsc` means the throttled wrapper `scratchpad/bin/lsc`, one run at a time.

### Completeness

`git ls-files packages/observatory/web` gives 15 files. A script compared each named function in the five slice files with this report. It found `head`, `row` and `reports` (local names); the first two were added to the inventory, and the third is a filter inside `SafetyCases`. Reading the callers added `panels.tsx:668`, `main.tsx:36`, `drawer.tsx:61` and `safe.ts:15`.

The drawer and the opportunity panel were checked for the class of bug 1. Neither has it: the drawer unmounts the queue, and `OpportunityPanel` has a key per item.

### Bugs

| Command | Outcome |
|---|---|
| `bun run ui-repro.tsx` | S1-S12 gave the results claimed for bugs 1, 2, 3, 5, 6, 7, 8, 10, 11, 14 |
| `bun run late-approve.ts` (first and extended) | `decide result {"ok":true}` 30 min after the deadline. `probe_sent` for `nw-1-1`. `review_expired` was for the other item, `nw-1-2`, at the tick |
| `bun run ui-recheck.tsx` | S12b, S14, S15, S16, S17, S18: bugs 13 (narrowed), 12, 17, 16, 9, and the re-roll form of bug 1 |
| `bun run ui-recheck2.tsx` | S13b and S5b |
| `bun run ui-recheck3.tsx` | S19: title `Review deadline ...` on a safety case |

Corrections:

- **Refuted: "AppPanel rows keep a stale `panel`" (bug 10, second claim).** S13 first agreed with the claim, with `store.openPerson(B)` and the answer in one `act()` scope. React batched `setP(null)` with the answer, so the unmount never rendered. S13b closes the scope first, as a browser would render it, and the panel goes (`panel: null`). The sentence was removed. Bug 10's main claim stands.
- **Refuted: gap G3.** Reading the service and engine paths shows that both queues refuse or block. It was removed from the gaps. J2 records the path. This is by reading, not by a run.
- **Narrowed: bug 13.** S12 set `store.app` by hand. S12b uses the real `setApp`. The stale data is real, but only history and settings, and the badge stays right.
- **Narrowed: bug 4.** The 30 minutes is a test clock jump. See the row.
- **Narrowed: bugs 5, 6 and 7.** Each row now gives its limits.
- **Narrowed: subset note on `"none"`.** A comparison is fine. Only building the value fails (`none.verify.ts` proved, `none2.verify.ts` failed to resolve).
- **Added: bugs 16 and 17, item 18, gap G6, and the `s` form of bug 1.**
- **Still inferred: bug 14.** The run shows `preventDefault` on the keydown. It does not show the browser skipping the click.

### Contracts

The first report's count stands: 19 functions, 17 proved, 2 failed as expected. All six first files ran again in `prior/`: `review-gate` 7 verified, `review-edit` 6, `roles-status` 9, `safety-rows` 11, `request-seg` 1 verified 1 error, `review-current` 1 verified 5 errors. A proof count says nothing about value, so each contract was judged again.

| Command: `lsc check --backend=dafny <file>` | Output |
|---|---|
| `keys.verify.ts` | 5 verified, 0 errors |
| `keys-today.verify.ts` | 1 verified, 5 errors |
| `gate.verify.ts` | 2 verified, 0 errors |
| `gate-today.verify.ts` | 1 verified, 2 errors |
| `report.verify.ts` | 1 verified, 0 errors |
| `report-today.verify.ts` | 0 verified, 1 error |
| `flip.verify.ts` | 1 verified, 0 errors |
| `flip-today.verify.ts` | 0 verified, 1 error |
| `roles.verify.ts` | 2 verified, 0 errors |
| `roles-mutant.verify.ts` | 1 verified, 1 error |
| `line.verify.ts` | 1 verified, 0 errors |
| `line-today.verify.ts` | 0 verified, 1 error |
| `none.verify.ts` | 1 verified, 0 errors |
| `none2.verify.ts` | resolution error: `member 'None' does not exist in datatype 'Mode'` |

The `-today` files are hand models of today's code, not the code itself. A proof covers an extract that does not exist in the repository yet. No repository code changed.
