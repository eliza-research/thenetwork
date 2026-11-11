# Observatory client: staff-action state (gap report)

Scope: `packages/observatory/web/admin.tsx`, `panels.tsx`, `drawer.tsx`, `main.tsx`.
These four files were not read in the first pass. `observatory.md` covers `web/store.ts` only (machines 2.26 client-sync and 2.27 client-decide-guard).

This report is hand-written. I read the four files in full, and also `web/store.ts`, `web/ui.tsx` and `test/held-photo-ui.test.tsx` in full. I read only the relevant parts of `src/server.ts`, `src/sources/{real,service,source}.ts`, `packages/network/src/network.ts`, `packages/network/service/{service,relay-endpoint}.ts` and `packages/capital/src/ledger.ts`. I ran no application code. One small check ran in Node (GC8).

## 1. Correction to the task brief

The brief names a "panels.tsx hold form (reason, minutes)". No such form exists. `panels.tsx` has no hold action. The reason and minutes form is the **PII reveal form**, `RevealControl` (panels.tsx:535-553). Hold exists only on a report row (admin.tsx:260). Section 2.5 describes the reveal form.

## 2. Machine list

| # | id | Kind | Priority | Where the state lives |
|---|----|------|----------|----------------------|
| 2.1 | held-row-photo-review | implicit | P0 | `HeldRow` useState and `active` ref, admin.tsx:131-181 |
| 2.2 | console-fetch-scope | implicit | P0 | `useFetch` state `d`, `n`, admin.tsx:11-22 |
| 2.3 | case-row-actions | implicit (explicit status from server) | P0 | `CaseRow`, admin.tsx:183-229 |
| 2.4 | report-row-actions | implicit (explicit status from server) | P0 | `ReportRow`, admin.tsx:232-277 |
| 2.5 | reveal-form | implicit | P0 | `RevealControl`, panels.tsx:535-553; `store.reveals` |
| 2.6 | slop-photo-panel | implicit | P0 | `SlopPanel`, panels.tsx:576-604 |
| 2.7 | use-live-detail | implicit | P1 | `useLive`, panels.tsx:43-57 |
| 2.8 | auth-prompt | implicit | P0 | `store.authNeeded`, `authEpoch`, `AuthPrompt`, main.tsx:477-486 |
| 2.9 | matching-switch-confirm | implicit | P1 | `Config.confirm`, admin.tsx:381-392 |
| 2.10 | conversation-search | implicit | P1 | `Search.conv`, main.tsx:164-225 |
| 2.11 | lab-form | implicit | P2 | `Lab`, admin.tsx:467-517 |
| 2.12 | audit-query | implicit | P2 | `AuditLog`, admin.tsx:427-459 |
| 2.13 | drawer-tab | implicit | P2 | `store.ui.drawer`, `drawerOpen`, drawer.tsx:35-77 |
| 2.14 | game-controls | implicit | P2 | `ProposeTray`, `Prompts`, `Game`, transport |
| 2.15 | run-compare | implicit | P2 | `Engine.sel`, `cmp`, drawer.tsx:213-244 |

Only local UI state with no action path is left out: feed segment (`Feed.seg`), request segment (`Requests.seg`), timeline paging (`TimelineList.n`), legend, tooltips, `Toast` and `Disclosure`. `Disclosure` matters in one way: a closed disclosure unmounts its children (ui.tsx:97), so closing it clears `SlopPanel` state.

Trigger names below: **staff** is a click or key. **poll** is a client timer. **ws** is a socket message. **server** is the console backend. **service** is the Network service.

## 2.1 held-row-photo-review (P0)

**Purpose.** One row in the "Held relay" queue where `x.queue === "relay" && x.kind === "photo"` (admin.tsx:134). A person must view the one photo the sender selected before release. Text rows and leak rows use a smaller path through the same component.

**Local state.**

| Name | Type | Line | Meaning |
|------|------|------|---------|
| `reason` | string | 132 | Typed reason. Not cleared on an identity change. |
| `busy` | boolean | 133 | Decision in flight. |
| `identity` | JSON string | 135 | `[mode, app, x.id, createdAt, me.id, me.grants, me.roles, authEpoch, authNeeded]`. |
| `active` | ref | 135 | The identity of the last render. `""` after unmount. |
| `preview` | object URL | 136 | The blob URL. |
| `previewIdentity` | string | 136 | The identity the blob was loaded under. |
| `previewError` | string | 136 | Alert text. |
| `loading` | boolean | 136 | Load in flight. |
| `loaded` | boolean | 136 | The `<img>` fired `load`. |
| `reviewed` | boolean | 136 | The staff member ticked the box. |

Derived: `currentPreview = !!preview && previewIdentity === identity && !authNeeded` (line 145). `ok = reason.trim().length >= 5 && !busy` (line 154).

**States** (product of the fields that matter):

`Idle` (no preview), `Loading`, `Failed` (error text, no preview), `Fetched` (blob, image not yet painted), `Painted` (`loaded`), `Attested` (`loaded && reviewed`), `Deciding`, `Gone` (row unmounted).

**Transitions.**

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| Idle, Failed, Fetched, Painted, Attested | Load or Reload | staff | `store.can("safety")`, `ok`, `!loading`, `!x.textHidden` | clear loaded, reviewed, error, preview; `store.heldPhoto(x.id, reason)` | Loading | admin.tsx:139-141,165 |
| Loading | response, identity same, blob ok | server | MIME is jpeg, png or webp, size > 0 | `setPreviewIdentity`, `createObjectURL` | Fetched | admin.tsx:143; store.ts:467 |
| Loading | response, failure | server | | set error | Failed | admin.tsx:143; store.ts:465-468 |
| Loading | response, identity differs or unmounted | server | `active.current !== identity` | drop the blob, no URL made | same as reset | admin.tsx:142 |
| Fetched | `<img>` load | browser | | `loaded = true` | Painted | admin.tsx:166 |
| Fetched, Painted | `<img>` error | browser | | clear loaded, reviewed, preview; set error | Failed | admin.tsx:166 |
| Painted | tick box | staff | `loaded`, `!busy` | `reviewed = true` | Attested | admin.tsx:168 |
| Attested | untick | staff | | `reviewed = false` | Painted | admin.tsx:168 |
| any | edit reason | staff | | `reviewed = false`; preview stays | Painted if it was Attested | admin.tsx:173 |
| any | identity change | server, ws, auth | effect on `[identity]` | clear all but `reason` and `busy`; `active.current = identity` | Idle | admin.tsx:137 |
| Attested | Release | staff | `ok`, `!x.textHidden`, `currentPreview && loaded && reviewed` (twice: button and `act`) | `store.heldDecision(queue, id, "release", reason, true)` | Deciding | admin.tsx:147-149,174 |
| any but Deciding | Reject | staff | `ok` | `heldDecision(queue, id, "reject", reason, attested)` | Deciding | admin.tsx:149,175 |
| Deciding | ok | server | | toast, clear reason, `onDone` (list reload) | Gone after reload | admin.tsx:151 |
| Deciding | refused | server | | toast; state stays | previous | admin.tsx:152 |
| any | unmount | React | | `active.current = ""`; revoke URL | Gone | admin.tsx:137-138 |

**Object URL.** `useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview])` (line 138). Every change of `preview` revokes the old value, and unmount revokes the last one. A late blob after unmount is never turned into a URL (line 142). I found no leak path.

**Attestation.** The last argument of `heldDecision` is `photo && currentPreview && loaded && reviewed` (line 149). `store.heldDecision` includes `photoReviewed` only when it is true (store.ts:470). The server refuses a release with no `photoReviewed === true` or with no live preview for `(staff, mode, app, item)` (server.ts `POST /api/held`, `photo_preview_required`). It decides `photo` by `queue === "relay" && id.startsWith("pri_")`. The client decides by `kind === "photo"`. The service list gives both together for selected photos (service.ts:2288-2291). The attestation does not appear in the audit row: the row has only `{phase, queue}` and the reason. The service proof token is the real binding.

**Text rows.** Release needs `ok && !x.textHidden`. A row with `x.text === undefined` and no `textHidden` shows "No text." and Release stays enabled (admin.tsx:170,174). The service re-checks at release, so this is a note, not a defect.

**Invariants.**

- HR1: a release request with `photoReviewed` implies the image painted under the present identity, and a box was ticked after the last reason edit.
- HR2: Reject is available in every state with `ok`, including a failed preview. Test: held-photo-ui.test.tsx. (H4 in observatory.md.)
- HR3: no blob survives an identity change on screen. `currentPreview` is false at render time, before the effect runs.
- HR4: a row with `textHidden` can only be rejected (AGENTS age policy).
- HR5: each decision has a reason of 5 or more characters (client, server and service).

**Interactions.** `store.heldPhoto` audits a read (server `read_relay_photo`). The server preview map is `photoPreviews` (observatory.md 2.9). The list comes from `HeldTexts` through `useFetch` (2.2). `identity` reads the auth state (2.8).

**Concurrency and failure.**

- Double press: `busy` and `loading` disable the buttons. React flushes discrete events at once.
- Stale closure: `store.notify` is delayed by 30 ms (store.ts:264), so a click can run an `act` closure from before a token or app change. The request then carries the new token or app. The server preview key has the staff id and app, so a release is refused. Safe.
- Two tabs of one staff member: the second load deletes the first preview (server.ts). A failed second load leaves the first tab with no server preview, and its release gets 409. Safe; the toast says to load again.
- Preview TTL: the server holds a preview for at most 5 minutes, and the client does not know `until`. After expiry Release stays enabled and gets a 409 with a clear message. Reload is the exit.
- Crash in flight: nothing is local.
- A poll that fails unmounts the row (GC7).

**Defects.** GC7, GC8.

**Quint notes.** Merge with the observatory.md 2.9 preview machine. Variables: `identity`, `blob: Option[identity]`, `painted`, `ticked`, `reason`, `serverPreview: Map[(staff, app, item), until]`, `now`. Actions: `load`, `paint`, `tick`, `editReason`, `changeIdentity`, `release`, `reject`, `expire`. Check HR1 and HR3. Bound: 2 staff, 2 apps, 1 item.

## 2.2 console-fetch-scope (P0)

**Purpose.** `useFetch(load, key, everyMs)` is the data source for every safety and config panel. The action buttons read from its result. That makes the key part of the safety model: **a row can act only as well as its data matches the shown scope.**

**State.** `d: {data?, status, error?}`, `n: reload counter`. `live` flag per effect run.

**States.** `Loading` (`status === undefined`), `Data`, `Error` (no `data`), `Stale` (key changed, old `d` still in place, new request in flight).

| From | Event | By | Effect | To | Evidence |
|------|-------|----|--------|----|----------|
| any | mount | React | `load()` | Loading | admin.tsx:14-17 |
| any | key or `n` change | render or `reload` | old `live = false`; `load()`; **`d` is not cleared** | Stale | admin.tsx:14-20 |
| any | timer | poll | `load()` | same | admin.tsx:18 |
| any | response, `live` | server | `setD(x)`, which **replaces** `d` | Data or Error | admin.tsx:16 |

`store.fetch` never rejects (store.ts:297-306), so each response reaches `setD`. An error response therefore removes the data.

**Keys.**

| Panel | Key | App in key | Poll | Action buttons |
|-------|-----|-----------|------|----------------|
| HeldTexts (admin.tsx:113) | mode, app, queue | yes | 30 s | release, reject |
| SafetyCases (admin.tsx:60) | mode, trust.hold, trust.watch, stats.blocks | **no** | 10 s | lift, close, hold, ban, dismiss, clear minor |
| Config (admin.tsx:380) | mode, matchingEnabled, review.mode | **no** | none | matching switch |
| AuditLog (admin.tsx:431) | actor, target | **no** | none | none |
| BiasMonitor (admin.tsx:34) | mode | **no** | 60 s | none |
| Lab (admin.tsx:469) | "lab" | no (global) | 0 or 3 s | start run |
| RunDiffView (admin.tsx:568) | a, b | ids are per run | none | none |

None of the keys has `authEpoch` or the staff id.

**Invariants.**

- FS1: a row with an action button shows data of the app that `withApp` will send (store.ts:282). **Fails** for SafetyCases (GC1).
- FS2: a failed read does not destroy unsent staff input. **Fails** (GC7).
- FS3: a stale response never overwrites a newer key. Holds, by `live`. Two polls under one key can land out of order. The effect is a 10 s lag.

**Quint notes.** Model with 2.3 and 2.4 as one machine (see the end of 2.4).

## 2.3 case-row-actions (P0)

**Server status.** `ObsSafetyCase.status`: `open`, `held`, `lifted`, `closed`. `level` is the live trust level. Network writes: network.ts:1210-1214 (`caseEvent`), 1244-1251 (`liftHold`), 1254-1269 (`closeCase`).

**Local state.** `open` (row expanded), `note`, `busy`. Row key is `c.id`.

**Client states.** `Collapsed`, `Expanded`, `Busy`.

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| Collapsed, Expanded | head click | staff | | toggle | other | admin.tsx:198 |
| Expanded | Lift hold | staff | `canAct`, `can("safety")`, not closed, `level === "hold" or status === "held"`, `!busy` | `safetyAction({lift, memberId, note?})` | Busy | admin.tsx:217-220 |
| Expanded | Close case | staff | `canAct`, `can("safety")`, not closed, `!busy` | `safetyAction({close, caseId, note?})` | Busy | admin.tsx:217,221 |
| Busy | ok | server | | toast, clear note, reload | Expanded | admin.tsx:192 |
| Busy | refused | server | | toast; note stays | Expanded | admin.tsx:193 |

**Server effect that the label does not show.** `closeCase` on a member whose trust level is `hold` emits `abuse_confirmed` and `member_removed` with reason `serious_abuse` (network.ts:1261-1268). The capital ledger marks the member removed and can take the voucher's stake (ledger.ts:192-198). The UI calls this "Close case" with one click and an optional note.

**Case ids.** `sc${++this.caseSeq}` (network.ts:1211). There is no `sid()` prefix. Reports (`rp`), requests (`rq`) and opportunities use `sid()` (network.ts:891), which adds the app id. `caseSeq` is per Network instance, so **`sc1` exists in each app**. The fallback view uses `ev-<memberId>` ids, which the Network refuses as `unknown_case` (real.ts:738).

**Invariants.**

- CR1: a close request names a case that the staff member saw, for the person they saw.
- CR2: a held member always has a staff exit in the console. **Fails** after close (GC2).
- CR3: an action with lasting effect on a member has a logged reason. **Fails** for close and lift (GC2, GC12).
- CR4 (F1 in observatory.md): a held person stays held until a person lifts it.

**Failure analysis.** Audit runs before and after on the server. A service timeout gives `service_unavailable`, the row stays, and a retry of close gets `already_closed`. Close is safe to repeat for the same case. Double press: `busy`. Lift then close: a `lifted` case can still be closed. A new event moves `lifted` back to `open` (network.ts:1212).

**Defects.** GC1, GC2, GC12.

## 2.4 report-row-actions (P0)

**Server status.** `SafetyReport.status`: `open`, `held`, `banned`, `dismissed`. Staff transitions are in observatory.md 2.16.

**Local state.** `open`, `note`, `busy`. `ok = note.trim().length >= 5 && !busy` (admin.tsx:243). Row key `r.id`.

**Props.** `canBan` and `canAct` come from `SafetyInfo`. Real mode: both are `!!this.service` (real.ts:756). Game mode: `canAct = !!n`, `canBan = false` (game.ts:558-560). Neither depends on the staff role.

**Button table.** All rows also need `store.can("safety")` and `r.status === "open"`.

| Button | Extra guard | Request | Success toast | Line |
|--------|-------------|---------|---------------|------|
| Hold | `canBan`, `ok` | `{hold, memberId, note, reportId}` | "Person held on every app" | 260 |
| Ban phone | `canBan`, `ok` | `{ban, by: phone, ...}` | "Banned by phone" | 261 |
| Ban person | `canBan`, `ok` | `{ban, by: person, ...}` | "Banned by person" | 262 |
| Dismiss | `canBan`, `ok` | `{dismiss, reportId, note}` | "Report dismissed" | 263 |
| Clear minor signal | `kind === "minor"`, `canAct`, `ok` | `{clear_minor, memberId, note}` | "Minor signal cleared on every app" | 269-270 |

A `minor` report shows both rows. The note field is shared with the first row. When `canBan` is false the second row has its own input (line 268). The two inputs are never on screen at the same time.

**Client states.** `Collapsed`, `Expanded`, `Ready` (`ok`), `Busy`. There is no state for a report past `open`: all action rows vanish.

**Server scope, by staff grant.**

| Action | safety@app | safety@* or admin@* | Evidence |
|--------|-----------|---------------------|----------|
| hold | **this app only** | every app | service.ts:1678-1685 |
| clear_minor | **this app only** | every app | service.ts:1697-1721 |
| ban | **refused**, `needs_safety_everywhere` | every app | service.ts ban |

`ServiceClient.act` returns `{ok: true}` and drops `apps` (packages/observatory/src/sources/service.ts, `act`). The client cannot tell the scope.

**Minor exits.** `clear_minor` has exactly one button in the whole web client (admin.tsx:270; a search of `packages/observatory/web` shows no other). It needs an open report of kind `minor`. `dismissReport` does not touch `m.minor`, `m.minorSignal` or `m.minorReported` (network.ts:1341-1350). Those flags keep the member out of matching (network.ts:3650,3710,3746,4503).

**Invariants.**

- RR1: a success message states the scope that the server applied. **Fails** (GC3).
- RR2: every open report has a staff exit (F3). Holds for `open`.
- RR3: a person with a wrong minor signal has a staff exit when the record says adult. **Fails** (GC4). The failure is on the safe side: the person stays out of matching.
- RR4: `clear_minor` never clears when any age says under 18. The Network enforces it (network.ts:1569-1573).

**Failure analysis.** On failure `onDone` is not called, so the row keeps its old status until the next 10 s poll. A hold that committed but timed out can be sent again: `holdMember` finds the report, leaves it `held`, and returns ok. A dismiss sent again gets `already_dismissed`. Both are safe.

**Defects.** GC1, GC3, GC4, GC10.

**Quint notes for 2.2, 2.3, 2.4 as one model `console-action-scope`.**

- Variables: `shownApp`, `dataApp`, `sendApp` (always `shownApp`), `cases: Map[app, Map[caseId, {member, status, held}]]`, `removed: Set[(app, member)]`, `staffScope: this_app | every_app`, `signal: Map[(app, member), Bool]`.
- Actions: `switchApp`, `poll` (sets `dataApp := shownApp`), `close(caseId)`, `lift`, `hold`, `dismiss`, `clearMinor`.
- Invariants: `close` implies `dataApp == sendApp`; `member_removed` implies a close request for that same person; a success message with "every app" implies the action touched each membership; `signal(p)` and adult record implies an enabled exit.
- Bounds: 2 apps, 2 cases with colliding ids, 2 members. The first invariant gives a counterexample in three steps.

## 2.5 reveal-form (P0)

**The form that the brief calls the hold form.** `RevealControl` (panels.tsx:535-553).

**Local state.** `open`, `reason`, `minutes` (default 15; options 5, 10, 15). **Store state.** `reveals: RevealGrant[]` with wall-clock `until`.

**States.** `Hidden` (not safety, or `hiddenTruth`, or `piiRevealed`), `Button`, `Form`, `Active`, `Expired` (grant in the list, `until` past).

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| Button | Reveal | staff | | `open = true` | Form | panels.tsx:543 |
| Form | Cancel or Escape | staff | | `open = false`; reason stays | Button | panels.tsx:547,550 |
| Form | submit | staff | `reason.trim().length >= 5` | `store.reveal`; server audits first | Active on ok, Form on refusal | panels.tsx:544; store.ts:552-558 |
| Active | End | staff | | `store.unreveal` | Button | panels.tsx:542; store.ts:547-551 |
| Active | time passes | clock | next render with `until <= Date.now()` | `revealFor` gives undefined | Button | store.ts:545 |

**Reload.** `grant?.until` is in the deps of each `useLive` (panels.tsx:227-228,562). A change refetches the detail. `WallLeft` ticks by itself and does not notify the store (ui.tsx:80-85). So the badge can read "expired" while the panel still shows revealed data. In real mode a store notify arrives on each poll (a `clock` message, server.ts:207-209; store.ts:424), so the delay has the length of one poll. With no socket, the delay lasts until the reconnect `load`. The server stops revealing at `until`, so only text already in the page stays. I do not count this as a defect.

**Invariants.** RV1: at most 15 minutes (server clamps). RV2: reason of 5 or more. RV3: the UI says "revealed" exactly when the server reveals. **Fails** (GC10).

**Failure analysis.** No `busy`: a double submit gives two audit rows and one grant (the map replaces it). `loadReveals` has no generation guard, so a late answer for app A can overwrite `reveals` after a switch to app B. Grants are checked against a member id, and each app has its own panel, so the effect is a wrong badge for a moment. Role loss: D03 in observatory.md. It also opens GC10, because DELETE needs safety.

**Quint notes.** Extend observatory.md 2.5. Add `clientGrant` next to server `reveals`, and an action `endFails`. Check `clientGrant == none` implies `serverGrant == none`.

## 2.6 slop-photo-panel (P0)

`SlopPanel` (panels.tsx:576-604). Local state: `reason`, `photos: MemberPhoto[] | null`, `error`.

**States.** `Refused text` (`p.photos` is `never_minor` or `needs_verification`), `AskReason`, `Shown(list)`, `ShownEmpty`, `Error`.

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| AskReason | submit | staff | `p.photos === "reason_required"`, `can("safety")`, not yet shown, reason ≥ 5 | `POST /api/member/:id/photos` | Shown, ShownEmpty, Error | panels.tsx:581-584,592-597 |
| Error | submit | staff | same | same | same | panels.tsx:596 |
| Shown | new `p` from reload | server | **no guard** | `photos` stays | Shown | panels.tsx:599-601 |
| Shown | close disclosure, focus change, unmount | staff | | state lost | Gone | ui.tsx:97; panels.tsx:34 |

The server path is correct: role, `photosAllowed`, audit, then the service requires an open report or case (server.ts `/api/member/:id/photos`; service.ts:1788-1810). Links last 5 minutes. An image already painted stays on screen after its link expires.

**Compare with HeldRow.** `HeldRow` ties its image to an identity. `SlopPanel` has no such tie. Line 599 tests only `photos`. It does not read `p.photos`, `p.adult`, `s.can("safety")`, or an identity.

**Invariants.** SP1: photos of a person with a minor signal or unknown age are never on screen (decision 9, AGENTS "Adults only"). **Fails** after load (GC5). SP2: each load has a typed reason and an audit row. Holds.

**Defects.** GC5.

**Quint notes.** Small: `shown`, `gate: ok | never_minor | needs_verification`, actions `load`, `ageSignal`, `reload`. Invariant `shown implies gate == ok`.

## 2.7 use-live-detail (P1)

`useLive(load, key, deps)` (panels.tsx:43-57). State: `d`, refs `last`, `prevKey`, `gen`, `timer`.

| Event | Effect | Evidence |
|-------|--------|----------|
| deps change | `gen++`, load now, old response dropped | panels.tsx:49 |
| key change | one trailing reload, at most every 3 s | panels.tsx:50-55 |
| unmount | `gen++`, clear timer | panels.tsx:49 |

The hook has no timer of its own, so an unchanged key means no reload. Consumers: `MemberPanel` (member, timeline), `AppSection`, `OpportunityPanel`. Deps hold `id`, `mode`, truth flag, reveal `until`, and app for `AppSection` only. They do not hold staff identity.

`.main` uses the `hidden` attribute (main.tsx:56), so the Inspector stays mounted on the "all apps" and person pages. `useLive` still reloads there, and each reload is an audited read. This adds audit rows only.

**Invariant.** UL1: data shaped for one staff member is not shown to another. **Fails** on a token change (GC6).

## 2.8 auth-prompt (P0)

**State.** `store.authNeeded`, `store.authEpoch`, `store.token`, `AuthPrompt.t`.

| From | Event | By | Effect | To | Evidence |
|------|-------|----|--------|----|----------|
| Authed | any API answer 401 | server | `authEpoch++`, `authNeeded = true`, throw `AuthError` | Prompt | store.ts:289-292 |
| Prompt | submit, non-empty | staff | `setToken`: `authEpoch++` if changed; `authNeeded = false`; `connect`, `load` | Authed or Prompt | main.tsx:480; store.ts:308-316 |
| Authed | `/api/me` differs from before | server | `authEpoch++` | Authed | store.ts:324 |
| Authed | ws close 4401 | server | toast, `load` | Prompt (from the 401) | store.ts:416 |

**Consumers of `authEpoch`.** Only `HeldRow` (admin.tsx:135). See GC6.

**Failure.** `api()` does not compare the token of the request with the current token. A request sent with the old token that answers 401 after `setToken` reopens the prompt (GC13).

**Quint notes.** Merge into the 2.1 model as the source of `identity` changes. Add to `client-sync`.

## 2.9 matching-switch-confirm (P1)

`Config.confirm` (admin.tsx:381-392). A two-step button.

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| Armed=no | click | staff | `canSwitch` | `confirm = true`, 4 s timer | Armed | admin.tsx:382,388 |
| Armed | click | staff | | `confirm = false`, `control({matching, on: !c.matchingEnabled})` | Sent | admin.tsx:389-390 |
| Armed | 4 s | timer | | `confirm = false` | Armed=no | admin.tsx:382 |
| Sent | ok | server | | toast, reload | Armed=no | admin.tsx:391 |

`canSwitch = c.canChange && s.isAdmin() && !locked` (line 386). `on` is an absolute value, so a second request is idempotent. "Locked" is checked again on the server (real.ts `matching_locked`; service `matching_not_allowed`). The key has `matchingEnabled`, so a change by a second admin refetches.

The switch has no `busy`, and `confirm` does not depend on the app (GC9).

## 2.10 conversation-search (P1)

`Search.conv: null | {q} | {q, hits} | {q, error}` (main.tsx:167). States: `Local` (null), `Searching`, `Results`, `Failed`.

| From | Event | By | Guard | Effect | To | Evidence |
|------|-------|----|-------|--------|----|----------|
| Local, Results, Failed | Shift+Enter or row | staff | `can("safety")`, q ≥ 2 | `store.search(q)`, an audited read | Searching | main.tsx:173-178,192 |
| Local | Enter, no local hit | staff | | same | Searching | main.tsx:195 |
| **Searching** | Enter | staff | `conv && !conv.hits` | **same, a second search** | Searching | main.tsx:192 |
| Searching | response | server | **none** | `setConv({q, hits or error})` | Results, Failed | main.tsx:177 |
| any | `q` changes | staff | `conv.q !== q` | `conv = null` | Local | main.tsx:168 |
| Results | Enter | staff | | open first hit, clear | Local | main.tsx:193 |

The rule "Enter when `!conv.hits`" is a retry after an error. It also fires while a search is in flight. See GC14.

## 2.11 lab-form (P2)

`arms`, `seeds`, `days`, `err`, `sel`, `poll` (admin.tsx:467-517). `poll` is 3000 when a run is `queued` or `running`, else 0 (line 477). `start` has no in-flight guard; a double submit makes two requests, and the server lab limits apply (observatory.md lab machine, D25). `seeds` goes through `Number` with no client check; the server validates. Server run states are in observatory.md.

## 2.12 audit-query (P2)

`actor`, `target` (typed), `q` (applied). Submit moves typed to applied, or reloads when equal (admin.tsx:434). `useFetch` key is `actor|target`: app and mode are not in it. The table stays on the prior app until the staff member presses Load (GC9 family). Each load is an audited read.

## 2.13 drawer-tab (P2)

`tab = tabs.includes(s.ui.drawer) ? s.ui.drawer : "feed"` (drawer.tsx:44). The stored choice stays; the shown tab falls back. Conditions: `review` needs `showReviewTab()`, `game` needs `canIntervene`, `lab` needs analyst and not real-only, `config` needs analyst, `requests` needs requests or a consent network (drawer.tsx:39-42).

`{s.ui.drawerOpen && <div>…}` (drawer.tsx:61) and `{tab === "safety" && <Safety />}` unmount the panels. That clears `HeldRow`, `CaseRow` and `ReportRow` state, including typed text. `Drawer` is absent when `page.kind !== "app"` (main.tsx:66). `SafetyCases` renders only with `s.can("safety")` (drawer.tsx:362). All failure paths here go to the safe side: state is lost, and nothing is sent.

In real mode the Review tab depends on the data: when the last item leaves `IN_REVIEW`, the tab falls to Feed and `ReviewQueue` unmounts (store.ts:777-781).

## 2.14 game-controls (P2, simulated worlds only)

- **Transport** (main.tsx:107-124, keys main.tsx:44-46): `play`, `pause`, `step`, `speed`, `refresh`, `shadow_run`. Guard `canStep && canSim()`. The server re-checks. `shadow_run` is single flight on the server (real.ts:858-862). Key `n` overlaps the review key `n`: the review listener runs in capture and calls `stopImmediatePropagation` (review.tsx:211,242), so this is not a defect.
- **Mode switch** (main.tsx:98-103): `store.setMode`, admin and not real-only.
- **ProposeTray** (main.tsx:401-448): `category`, `objective`, `why`, `peek`. Propose is disabled for any picked minor, by `s.members.get(id)?.minor` (main.tsx:411,435). The server decides in the end. Peek stays on screen after the picks change (GC15).
- **Prompts** (main.tsx:450-474): `text` is one state for a list of prompts (GC15).
- **Game** (drawer.tsx:419-479): `resetSeed`. `review_mode` and `reset` are admin only, with no confirm. These are simulated.
- **GodMenu** (panels.tsx:323-342): `go_silent`, `force_flake`, `opt_out`, through `store.ui.popover`.
- **Truth lens** (main.tsx:378-381): checkbox read from `s.truth`, `control({lens})`, then `load`.

No Quint model is needed for these except as test input to the simulator.

## 2.15 run-compare (P2)

`sel`, `cmp: string[] | null` (drawer.tsx:217-219). `pick` keeps the last two (line 223). `pair` needs both ids in `s.runs`. Read-only. No model needed.

## 3. Suspected defects

All were found by reading the code. None has been run. "Confirmed" means that I traced the full path through the code.

### GC1. A case row from one app closes a different person's case in another app. P0, CONFIRMED by reading.

Files: admin.tsx:60,65-68,189,221; store.ts:282,502-516; network.ts:891,1211.

Three facts combine:

1. The `SafetyCases` `useFetch` key has no app (admin.tsx:60), and `useFetch` keeps old data while a new key loads (admin.tsx:14-20). `setApp` does not remount `SafetyCases`.
2. The case row filter passes rows for unknown members: `!m || s.inBorough(m)` (admin.tsx:68). `setApp` empties `members`, so old rows stay.
3. `withApp` reads `this.app` when the request goes out (store.ts:282). Case ids have no app prefix, so `sc3` exists in both apps (network.ts:1211).

Trigger:

1. Safety staff with a grant on both apps opens the Safety tab on app A. Case `sc3` of member X is expanded.
2. Staff switch to app B. The list still shows A's data until the next poll answers (up to 10 s plus the request time). The key changes earlier only when B's hold, watch or block counts differ.
3. Staff press "Close case" on X's row.
4. The request is `POST /api/safety?app=B {close, caseId: "sc3"}`. The Network of B closes **its** `sc3`, which belongs to member Y.
5. If Y is on hold, this also emits `abuse_confirmed` and `member_removed` for Y (GC2).

The toast says "Case closed · X". The audit row says `sc3` on app B. A second effect: `key={c.id}` keeps the row mounted when B's `sc3` arrives, so `open` and the typed `note` move to Y's row.

Other actions in the same window are refused: `dismiss` and `hold` carry a `sid`-prefixed report id (`unknown_report`), `ban` and `clear_minor` use a member id that `personOfMember` looks up by app. `lift` with a member id of the other app gets `not_on_hold`, unless member ids are shared across apps. I did not establish that they differ, so I do not claim the lift case.

Test gap: `held-photo-ui.test.tsx` covers app change for `HeldRow` only.

### GC2. "Close case" on a held member is a one-click, irreversible, unlogged-reason removal, and it hides Lift. P0, CONFIRMED by reading.

Files: admin.tsx:195,217-221; network.ts:1254-1269; ledger.ts:192-198; server.ts `checkSafety` (`close` has an optional note).

Trigger: a case with `level === "hold"`. Staff press "Close case" with an empty note.

1. `closeCase` sets `closed`, then, because the member is held, emits `abuse_confirmed` and `member_removed` with `serious_abuse`. The ledger can take the voucher's stake.
2. `!closed` is now false (admin.tsx:217), so the Lift button is gone.
3. The trust hold stays. `liftHold` would accept the call, but no button sends it. `Safety` shows the member in "Watch and hold" with no action (drawer.tsx:340-347).

There is no confirm step, although the matching switch has one (admin.tsx:388). Hold needs a note of 5 or more characters and this does not. The label gives no sign that a close confirms abuse. This extends D10 in observatory.md, which does not list this path.

### GC3. Success text says "every app" when the server held or cleared one app. P0, CONFIRMED by reading.

Files: admin.tsx:260,270; service.ts:1678-1685,1697-1721.

Trigger: staff with `safety@slop` only press Hold on a report. The button title says "Hold the person on every app until a review", and the toast says "Person held on every app". The service filters `members` to this app (`crossAppSafety(user) ? all.members : all.members.filter(x => x.rt === rt)`), so the person stays active on the other apps. The same happens for clear minor: the tooltip says "every app you may act on", but the toast says "Minor signal cleared on every app". The reply has no scope for hold, and `act` drops `apps` for clear minor, so the client cannot report it. The staff member has a false belief about a safety hold. Note that the service comment keeps the scope out of the audit row on purpose, for privacy of app membership; the client could still word the message by the staff grant, with no new data.

### GC4. A minor signal can become impossible to clear from the console. P1 (safe direction), CONFIRMED by reading.

Files: admin.tsx:266-272; network.ts:706-718,1341-1350,1550-1560,1565-1580; service.ts:1710.

`clear_minor` has one button, and it needs an open report of kind `minor`. There are three paths with no button:

1. **No report at all.** The member writes "I teach high school". `classify` sets `minorSignal`, and the network sets `m.minor` (network.ts:717-718). This is the example in the comment on `clearMinorSignal`. No report exists, and `CaseRow` has no clear button.
2. **Dismiss.** Staff press Dismiss on the minor report (admin.tsx:263). `dismissReport` leaves all the flags set. Its comment says "it no longer keeps the member out of matching", which is false for this kind. The clear button disappears.
3. **Hold.** Staff press Hold on the minor report. Status is `held`, and the button disappears. `clearMinor` on the server dismisses only `open` reports.

The API still accepts the action. The member stays out of matching, which is the correct failure direction for AGENTS, but an adult has no way back through the console.

### GC5. Loaded member photos stay on screen after the age gate closes. P0, CONFIRMED by reading.

Files: panels.tsx:579,592,599-601.

Trigger: a safety staff member loads photos for adult X with an open report. The panel stays open. X then writes an under-18 age, or another member reports X as a minor. `memberKey` changes on the message counter, `AppSection` reloads, and `p.photos` becomes `never_minor`. The grey text changes. `photos` state stays, and line 599 renders it anyway. A painted image stays after its 5-minute link ends. The same applies when the staff member loses the safety role, because line 599 does not read `s.can`. Exit: closing the disclosure or moving focus. Founder decision 9 and SP1 require adults only. The audited first read was lawful, so the harm is continued display, not a new read.

### GC6. Only HeldRow reacts to a credential change. P1, CONFIRMED by reading.

Files: store.ts:223; admin.tsx:135; panels.tsx:227-228,562,663.

`authEpoch` has one consumer. After `setToken` for a different staff member, `MemberPanel`, `OpportunityPanel`, `AppSection` and `SlopPanel` keep the data of the first person, because no dep changes unless a reveal was active. `useLive` has no timer. A server view shaped for a safety role (member's own words, photos) is then on screen for a staff member with a lesser role, until a member key changes. The test comment in `held-photo-ui.test.tsx` states the intent: "A real credential change must clear private bytes". Trigger needs one tab shared by two people, after a 401.

### GC7. One failed poll destroys staff input. P2, CONFIRMED by reading.

Files: admin.tsx:16,62-63,122-126.

A failed `GET /api/safety` replaces `d` with an error, `info` becomes undefined, and `SafetyCases` returns `<Err>`. That unmounts `HeldTexts` and every row. Typed reasons, typed notes, a loaded photo, and the tick are gone. The next poll, 10 s later, mounts empty rows. `GET /api/held` failing has the same effect on held rows alone (502 from a service hiccup). No wrong action can result. With a flapping service a photo review cannot complete: load, look and tick must fit between failures.

### GC8. A reason with a non-Latin-1 character cannot load a photo, and the error is wrong. P2, CONFIRMED (Node check of the Fetch rule).

Files: store.ts:464,468; admin.tsx:141,173; server.ts `/api/held/:id/photo`.

`heldPhoto` puts the reason in the header `x-network-reason`. Header values must be byte strings. `new Headers({a: "it’s"})` throws `TypeError: Cannot convert argument to a ByteString because the character at index 2 has a value of 8217` in Node. Browsers apply the same rule. The `catch {}` in `heldPhoto` turns this into "The selected photo could not load. Try again or reject it." A retry fails in the same way. So a curly apostrophe, a dash from text substitution, an emoji or any non-Latin script blocks Release. A reason above 500 characters fails in the same silent way (server returns 400; the client maps every non-ok to the same text). The input has no `maxLength`. The same reason works for Reject, since that goes in a JSON body. `store.photos` uses a JSON body and has no such limit at the console. The test uses an ASCII reason.

### GC9. Config, audit and bias panels keep the prior app, and the armed switch carries over. P1, CONFIRMED by reading.

Files: admin.tsx:34,380-392,431.

Trigger for the switch: an admin on app A, with Config open, presses "Turn off" (armed). Within 4 s the admin switches to app B, whose matching is off. Config is not remounted, so `confirm` stays true. The key changes, `c` refetches, and the button reads "Confirm: turn on". One click turns on matching for B. Before the refetch lands, `flip` sends `!c.matchingEnabled` from A's data to B. The two-step guard was given for a different app. For a staff member, the history table, `reviewMode`, settings, and audit table stay on the old app under a title that names the new app, if the key values are equal. In the audit case the panel stays stale with no timer.

### GC10. "End" on a reveal looks successful when it failed. P1, CONFIRMED by reading.

Files: panels.tsx:542; store.ts:547-551; server.ts `/api/reveal` DELETE.

`unreveal` ignores the response. It also catches thrown errors. It always removes the grant from local state. Cases where the server keeps the grant: a 403 after the role was lost (D03), a 409 `mode_changed`, a network error, a 401. The badge disappears, the panel reloads because `grant?.until` changed, and the server still returns revealed text, up to the 15-minute limit, with no "Revealed" badge. No `reveal_revoke` row exists. The staff member believes the reveal ended. The next `load()` calls `loadReveals` and restores the badge.

### GC11. Ban buttons show for staff who can never use them. P2, CONFIRMED by reading.

Files: admin.tsx:257,261-262; service.ts ban; real.ts:756.

`canBan` is `!!this.service`, and the client gate is `store.can("safety")` for this app. Staff with `safety@slop` see both Ban buttons and get "refused: needs safety everywhere" (no entry in `SAFETY_ERRORS`). This is a guard on one side of the wire with a different rule on the other. Fails closed. The refusal is audited.

### GC12. Lifting a hold needs no reason. P2 (design), CONFIRMED by reading.

Files: admin.tsx:189,219-220; server.ts `checkSafety`; network.ts:1244.

Hold, ban, dismiss, clear minor and every held decision need 5 or more characters. Lift accepts an empty note, and the placeholder says only "Decision note". A hold exists to protect other members; its removal has the same weight and no reason in the log. The audit row has no `reason` in that case. Medium confidence that this is unintended: the Network comment says "only a person can", and does not discuss a reason.

### GC13. A late 401 from the old token reopens the prompt. P2, PLAUSIBLE.

Files: store.ts:283-292,308-316.

`api()` reads the token when it sends and sets `authNeeded` on any 401. After `setToken` a poll in flight with the old token answers 401. `authNeeded` becomes true although the new token is good. The prompt returns, and `HeldRow` state resets. Fail closed. Needs a request in flight across the swap.

### GC14. Enter during a conversation search sends another audited search, and a late answer pins an old query. P2, CONFIRMED by reading.

Files: main.tsx:168,177,192.

Each Enter while `conv && !conv.hits` runs `runConv`. Each is an audited read. `runConv` has no generation check. If the query text changes while a search is in flight, the effect sets `conv = null`, then the late answer sets `conv = {q: old, hits}`. The effect does not run again, since `q` did not change. The pane shows the old results until "back", and Enter opens the first old hit.

### GC15. Game forms keep state across a change of subject. P2, CONFIRMED by reading. Simulated worlds only.

Files: main.tsx:406,414,437,453-457.

`peek` clears only on submit or Clear, not on `togglePick`, so an oracle result for one group stays beside a different group. `Prompts` is not keyed by prompt, so text typed for member A stays in the box when the world resolves A's prompt and shows B's, and Send replies as B. `Propose` has no in-flight guard.

### GC16. The banner says "read-only" while staff actions are live. P2, CONFIRMED by reading.

Files: main.tsx:85; real.ts:191.

`banner` appends "· read-only" for each real environment with no check of `capabilities.staffActions`. With a service, `readOnly: true` and `staffActions: true` hold together, and the Ban, Close and Release buttons act on production. The database connection is read-only, but the banner reads as a statement about the whole console, and that is wrong here.

## 4. Checked, not defects

- Object URL lifetime in `HeldRow`: revoked on every change and on unmount; a late blob after unmount makes no URL.
- `HeldRow` hooks and all other components in scope: hooks stay above early returns.
- A stale `act` closure in the 30 ms notify delay: the server preview key refuses it (2.1).
- Key `n` in review versus transport: handled in capture.
- `shadow_run` double press: single flight on the server.
- Matching lock: enforced at the server and the service.
- Double press on case, report, held and review buttons: `busy` or `deciding`.
- A held photo of a person now in doubt: the service re-checks (observatory.md 2.9).
- `Countdown` uses the store clock, and `WallLeft` uses wall time. Both match their subject.
- Report id, request id and opportunity id collisions across apps: `sid()` prefixes them. Only case ids lack the prefix (GC1).

## 5. Open questions

- A photo with `kind: "photo"` that the rules hold would enter `relayHeld()` under its `pri_` id (relay-endpoint.ts:238-240), and the service list also adds selected photos (service.ts:2288-2291). If both exist for one id, `HeldTexts` has two rows with one React key. I did not establish whether the relay desk can hold such an item.
- Whether member ids can be equal across apps. This decides whether `lift` belongs in GC1.
- `reports` filter in `SafetyCases` ignores the borough filter, while `cases` applies it (admin.tsx:68,70). A persisted borough filter (`obs.filters.v1`) can hide an urgent case from the Cases list; the title count hides it too. The filter bar shows that a filter is on. I did not rate this.
- Rows above 80 cases, 80 reports and 100 held items have no paging (admin.tsx:76,86,123). They appear as earlier rows clear.

## 6. Recommended Quint order

1. `console-action-scope` (2.2, 2.3, 2.4): finds GC1, GC2, GC3 and GC4. P0.
2. `held-photo-review` (2.1, with observatory.md 2.9 and 2.8 here): checks HR1 to HR5. P0.
3. `reveal-sync` (2.5, with observatory.md 2.5): finds GC10. P0.
4. `member-photo-display` (2.6): finds GC5. P0, small.
5. `matching-confirm` (2.9): finds GC9. P1, small.

The other machines need no model. They are good material for e2e cases in `tests/e2e`, under docs/tests-policy.md.

## 7. Link to earlier reports

- Extends D10 (console dead ends) with GC2 and GC4.
- Extends D03 (reveal survives a role change) with GC10.
- The `held-text-decision` client paragraph in observatory.md 2.9 stays correct. Section 2.1 here gives the full table.
- `client-sync` (2.26) and `client-decide-guard` (2.27) are not changed by this report.
