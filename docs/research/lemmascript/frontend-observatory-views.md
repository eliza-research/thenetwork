# LemmaScript survey: Observatory views

Hand-written by a research agent, at commit a0ed7bc. No code in the repository changed.

Scope: `packages/observatory/web/main.tsx`, `panels.tsx`, `drawer.tsx`, `ui.tsx`. Context: `docs/observatory.md`. I also read `web/store.ts`, `web/safe.ts`, `src/scrub.ts`, `src/shape.ts`, `src/appProfile.ts`, `src/health.ts`, `src/events.ts`, `src/sources/real.ts` and `src/server.ts`, because the views depend on them.

Trials: `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/observatory-views/` (first review) and `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-views/` (skeptic review: `obs.verify.ts`, `neg.verify.ts`, `ui-repro.ts`). All proofs used the throttled `lsc check --backend=dafny` wrapper, one run at a time.

A skeptic reviewed this report and corrected it. Section "Verification" lists the commands and the results.

## Summary

- All four files are React `.tsx`. No function here is verifiable in place. The pure decisions must move to a plain `.ts` file. The components stay unverified.
- 8 contracts went through the skeptic trial. All 8 proved. 4 negative runs (shipped shape or mutant, same contract) failed, as required. The contracts have force.
- 8 earlier candidates are rejected: their contracts restate the code, or a type check finds the same bug. See "Rejected candidates".
- 15 bugs remain. 12 are reproduced, 11 of those on the shipped components in a DOM harness. 3 are unverified. B9 is refuted and removed.
- The worst finding is two bugs on the same path. The photo gallery stays after the rule refuses it (B1). An older read can restore an old rule on the screen (B14).
- Sensitive data: the real gate is on the server. Phones, ratings, hidden truth and member text do not depend on these views. The exception is the photo gallery (B1), where the client keeps data that the rule no longer allows.
- These proofs say nothing about NaN, fractions, or what React renders. They cover the decision only. The bugs with the most force (B1, B4, B13, B14) are in React state and timing. Proofs of a decision do not cover that part. The DOM harness did.

## 1. Inventory

Verdicts: **VIP** verify-in-place. **EXT** extract-then-verify. **NA** not applicable, with the reason.

No row is VIP. A verified function must be in a `.ts` module, and these files mix JSX, hooks and the store singleton in every function.

### main.tsx

| Location | Function | Purpose | Verdict |
|---|---|---|---|
| main.tsx:20-21 | `SPEEDS`, `CATEGORIES` | Static option lists | NA: data |
| main.tsx:24 | `escape` | Esc clears one layer | EXT possible. Rejected: the contract restates a 4-branch `if` chain |
| main.tsx:32 | `App` | Root layout, global keys | EXT for the key table only; rest NA: effects, DOM. Page and `hidden` gate at lines 55-56 can be a small predicate |
| main.tsx:78 | `banner` | Environment banner text | EXT possible, low value. Regex must become `startsWith` or `extern` |
| main.tsx:88 | `TopBar` | Top bar, transport, role label | NA: JSX. Its gate is `canStep`, `canSim` |
| main.tsx:140 | `searchHits` | Member, area, id hits, 5+3+3 | EXT: bound on hits is simple; iterates Maps through the store, needs arrays as input. Low value |
| main.tsx:164 | `Search` | Search box, conversation search | NA: async, state. See B13 |
| main.tsx:228 | `HelpPopover` | Help and key map | NA: static JSX |
| main.tsx:269 | `FilterBar` | Filter controls and dimming | EXT: the `dim` tab choice. See B4 |
| main.tsx:309 | `FocusChip` | Focus label, back, clear | NA: JSX |
| main.tsx:325 | `GraphStage` | Map or graph choice | NA: trivial |
| main.tsx:330 | `MapStage` | Mounts Leaflet | NA: DOM |
| main.tsx:340 | `GraphCanvas` | Mounts canvas, tooltip | NA: DOM |
| main.tsx:365 | `Legend` | Layers, truth lens switch | NA: async `control`. Server gates the lens |
| main.tsx:400 | `Peek` | Oracle peek result type | NA: type |
| main.tsx:401 | `ProposeTray` | Game intro tray | EXT: `canPropose`. Proved |
| main.tsx:450 | `Prompts` | Play-as reply card | NA: game UI. Quick-reply table is data |
| main.tsx:477 | `AuthPrompt` | Token entry | NA: DOM form |
| main.tsx:488 | `Toast` | Timed toast | NA: `Date.now`, timer |

### panels.tsx

| Location | Function | Purpose | Verdict |
|---|---|---|---|
| panels.tsx:15-25 | `SCOPE_TONE`, `STATUS_TONE`, `REVEALED`, `SAID_YES`, `MET`, `STUCK_MS`, `REQUEST_WAIT_MS` | Tables and limits | EXT as enums and predicates, with `yesCounts` |
| panels.tsx:26 | `plural` | Count with noun | NA: text only |
| panels.tsx:27 | `stateLabel` | State label | NA: text only |
| panels.tsx:29 | `Inspector` | Routes on focus kind | NA: three-way JSX switch |
| panels.tsx:43 | `RELOAD_GAP_MS` | Reload gap | NA: data |
| panels.tsx:44 | `useLive` | Audited detail reload, 3 s gap | NA: hook and timing. See B14. `reloadDelay` is rejected: it restates `max(0, gap - elapsed)` |
| panels.tsx:59 | `memberKey` | Reload key | NA: string key over Maps; a proof says little |
| panels.tsx:65 | `forbidden` | 403 test | NA: trivial |
| panels.tsx:68 | `Overview` | Alerts and KPIs | EXT: alert choice is mostly data. See `alertTab` |
| panels.tsx:111 | `alertGo` | Alert to drawer tab | EXT possible. Rejected: only one target is role-gated. See B2 |
| panels.tsx:122 | `AlertLink` | Alert button | NA: JSX |
| panels.tsx:127 | `KpiGrid` | Six KPIs | EXT: `yesCounts`. Proved. See B5, B15 |
| panels.tsx:168 | `NeedsAttention` | At most 5 rows, no repeats | EXT: possible (M). Three loops over filtered lists; needs arrays and a `seen` set |
| panels.tsx:194 | `NeighborhoodPanel` | Area panel | NA: JSX. Sort comparator is `b - a` on a fractional score, outside the int model |
| panels.tsx:222 | `MemberPanel` | Member 360 | NA: JSX, hooks. Gates at lines 303 and 311 are one-line conjunctions |
| panels.tsx:323 | `GodMenu` | World actions | NA: game UI |
| panels.tsx:344 | `Profile` | Profile lines | NA: display of server data |
| panels.tsx:357 | `Facts` | Facets by kind | NA: display; the score filter is on the server. Prove `memberFacets` in the server slice |
| panels.tsx:377 | `Connections` | Edge label and grouping | EXT: edge label is pure. Low value |
| panels.tsx:398 | `OppList` | Opportunity rows, cap 60 | NA: JSX |
| panels.tsx:424 | `eventIcon` | Icon per event type | NA: cosmetic |
| panels.tsx:445 | `GuardMark` | Leak check mark | NA: JSX |
| panels.tsx:421 | `TimelineItem` | Timeline row type | NA: type |
| panels.tsx:452 | `TimelineList` | Sort, last n, Show earlier | EXT possible. Rejected: `timelineWindow` restates `max(0, len - n)` |
| panels.tsx:481 | `MemberTimelineView` | Timeline items, waiting list | NA: mapping |
| panels.tsx:496 | `TimeChips` | Offered times | NA: JSX |
| panels.tsx:511 | `BookedPlanView` | Per-member opt-out state | EXT: `planView`. Proved |
| panels.tsx:535 | `RevealControl` | PII reveal lifecycle | EXT possible. Rejected: it restates the gate, and `revealFor` on the server is the real gate |
| panels.tsx:557 | `AppSection` | Per-app panel loader | NA: async. `has` is trivial |
| panels.tsx:570 | `PHOTO_TEXT` | Rule text | NA: data |
| panels.tsx:576 | `SlopPanel` | Prefs and photo gate | EXT: `photoView`. Proved. See B1 |
| panels.tsx:606 | `SlopPrefsView` | Prefs rows | NA: display of server data |
| panels.tsx:617 | `PeonPanel` | Roles, introductions | NA: display; proxy tags removed on the server |
| panels.tsx:635 | `Truth` | Hidden truth | NA: display. Gated at line 311 and by the server |
| panels.tsx:660 | `OpportunityPanel` | Opportunity detail | NA: JSX. The merge at line 666 is a field rule; `showActions` at line 670 is a conjunction |

### drawer.tsx

| Location | Function | Purpose | Verdict |
|---|---|---|---|
| drawer.tsx:17 | `TAB_LABEL` | Labels | NA: data |
| drawer.tsx:21 | `APPLIES` | Filters per tab | EXT: `originNonInterference`. Proved. See B3 |
| drawer.tsx:33 | `filterApplies` | Table lookup | EXT with `APPLIES` |
| drawer.tsx:35 | `Drawer` | Tab visibility and fallback | EXT: `tabVisible`, `effectiveTab`. Proved |
| drawer.tsx:81-83 | `PEOPLE`, `SAFETY`, `SYSTEM` | Feed segments | No proof needed. `Record<FeedKind, Seg>` makes `tsc` find B2. `segOf` is rejected |
| drawer.tsx:86 | `Linked` | Names to links in feed text | NA: dynamic regex. `safe.ts` keeps text out of HTML sinks |
| drawer.tsx:101 | `Feed` | Segments, filter, last 150 | NA: JSX and state. See B2 |
| drawer.tsx:136 | `Ladder` | Consent ladder | EXT: `rate`. Proved in clamped statement form |
| drawer.tsx:167 | `Pipeline` | Kanban | NA: JSX. `Math.min` over an empty list is guarded at line 186 |
| drawer.tsx:198 | `OppCard` | Card | NA: DOM effect |
| drawer.tsx:210 | `count` | Tally by key | EXT: possible; `reduce` is outside the list of supported methods. Rewrite as a loop. Low value |
| drawer.tsx:213 | `Engine` | Run list, compare pick | Rejected: `pickRun` is small, has no bug, and the proof failed. Low value |
| drawer.tsx:245 | `RunDetail` | Funnel, generators, fairness | NA: display. `Math.max(1, f.generated)` guards the division |
| drawer.tsx:313 | `SAFETY_FEED` | Safety event kinds | EXT with `segOf`. See B2 |
| drawer.tsx:314 | `Safety` | Safety tiles and events | NA: JSX. `holdCell` is rejected. See B3, B5, B8 |
| drawer.tsx:368 | `Metrics` | Rates and counts | EXT: `rate`. See B6, B7. `weeks` is fractional, so that part is outside the int model |
| drawer.tsx:419 | `Game` | Scoreboard, reset | NA: game UI |

### ui.tsx

| Location | Function | Purpose | Verdict |
|---|---|---|---|
| ui.tsx:8-9 | `tf`, `fmt` | Cached `Intl` format | NA: `Intl` |
| ui.tsx:14-17 | `localTime`, `localDate`, `shortDate`, `stamp` | NYC time text | NA: `Intl`, out of model |
| ui.tsx:18 | `pct` | Percent text | NA: `toFixed`, floats |
| ui.tsx:19 | `num` | Number text | NA: `toLocaleString` |
| ui.tsx:20 | `humanize` | Lower case, no underscores | NA: regex; no property worth a proof |
| ui.tsx:21 | `sentence` | Capitalize | NA: text only |
| ui.tsx:23 | `ago` | "3h ago" | EXT with `dur`; it already clamps to 0 |
| ui.tsx:25 | `dur` | Compact duration | EXT: `durParts`. Proved. Text format is not proved |
| ui.tsx:31 | `useOutsideClose` | Close popover | NA: DOM |
| ui.tsx:40 | `Badge` | Badge | NA: JSX |
| ui.tsx:45 | `Kpi` | KPI tile | NA: JSX |
| ui.tsx:54 | `MemberLink` | Name link | NA: JSX. Falls back to the opaque id |
| ui.tsx:60 | `OppLink` | Opportunity link | NA: JSX |
| ui.tsx:64 | `AreaLink` | Area link | NA: JSX |
| ui.tsx:68 | `oppDot` | Color dot | NA: JSX |
| ui.tsx:71 | `Countdown` | Deadline tone | EXT: possible; tone is 3 thresholds. Low value |
| ui.tsx:78 | `WallLeft` | Reveal time left | EXT: possible; needs `Math.ceil` on an int ratio. Low value |
| ui.tsx:86 | `Disclosure` | Saved open state | NA: `localStorage`, DOM |
| ui.tsx:105 | `StatusLine` | Drops empty parts | NA: `ReactNode` |
| ui.tsx:112 | `Bars` | Sorted bars, width | EXT: width only. Low value. No caller passes `max`, `format` or `onClick`, so the props are dead code |
| ui.tsx:131 | `COMPONENT_SIGN` | Sign table | NA: data |
| ui.tsx:135 | `Components` | Score bars | NA: JSX. See B12 |
| ui.tsx:151 | `Lorenz` | SVG path | NA: floats, SVG. `n = 0` does not occur: see "Refuted" |
| ui.tsx:164 | `Section` | Section frame | NA: JSX |

## 2. Staff journeys as state machines

### J1. Drawer tab

- States: `want` (`ui.drawer`), `shown` (`effectiveTab(want, caps)`), `open`.
- Transitions: click tab, alert link, KPI link, saved preference at load, and a capability change (queue empties, role changes, mode changes).
- Invariant: `tabVisible(shown, caps)`. Config and Lab need analyst. Game needs a simulated world. Every control that depends on the tab reads `shown`, not `want`. Current code breaks the last clause (B4).

### J2. Esc ladder

- States: subset of {popover, query, picks, focus}.
- Transition: one Esc removes the highest present layer.
- Invariant: the number of layers falls by exactly 1. At most 4 presses reach the empty state. Proved.

### J3. Focus

- States: none, member(id), opportunity(id), neighborhood(id), plus a history of at most 20.
- Transitions: `focus`, `focus({replace})`, `back`, `clearFocus`, `popstate`, `applyFull`.
- Invariants: a focus that does not exist is cleared at full load. The URL hash holds a kind and an id only. History has no entry equal to the prior focus. This logic lives in `store.ts` (other slice).

### J4. PII reveal

- States: hidden, button, form, active(until), expired.
- Transitions: click Reveal, submit a reason of 5 or more characters, wall clock passes `until`, click End, role lost.
- Invariants: active needs the safety role in a real world without global PII. Active needs `until > now`. On leaving active the view loads again, because `grant?.until` is a `useLive` dependency. Each server read decides again with `revealFor`.

### J5. slop photos

- States: hide, form, loading, gallery.
- Transitions: rule from `/api/member/:id/app`, submit reason, response, panel closes.
- Invariant wanted: gallery only while the rule is `reason_required` and the viewer holds the safety role. Current code keeps the gallery after the rule changes (B1), and it does not read the role on that line.

### J6. Truth lens (game only)

- States: off, on.
- Transitions: Legend switch through `control({type:"lens"})`, then `store.load()`.
- Invariants: server sends `truth` only to that staff member. `Truth` needs `s.truth && d.truth`. The oracle section has no client gate. It relies on `stripOracle` (`src/shape.ts:20`) and `src/sources/game.ts:504`.

### J7. Audited detail load (`useLive`)

- States: empty, loading, fresh, waiting(timer).
- Transitions: dependency change loads now. Key change sets a timer of `max(0, 3000 - elapsed)`. A stale generation is ignored.
- Invariant: key changes do not cause more than one audited read per 3 s. A response from an old generation never reaches the screen.
- This invariant is too weak. A key change does not bump the generation, so two reads can share one generation. The read that ends last wins, not the read that started last (B14).

### J8. Conversation search

- States: typing, searching(q), results(q), error(q).
- Transitions: Shift+Enter, row click, query edit, response, back.
- Invariant wanted: a response for `q1` does not show under `q2`, and Enter does not open a hit of `q1`. See B13.

### J9. Booked plan, per member

- States: called_off, not_told, open, confirmed.
- Transitions: told, member says they cannot, window closes at `min(told + optOutHours, at)`.
- Invariants: cancellation wins. Confirmed needs told and a closed window. Open needs `now < at`. Proved.

### J10. Propose tray (game)

- States: picks 0 to 6, form, submitted.
- Transitions: pick, remove, clear, peek, propose.
- Invariant: propose is enabled only if no pick is a minor (age unknown counts as minor) and sparks remain. Proved for the decision, in a form that also refuses an unknown member. The server re-checks.

### J11. Alert to destination

- States: alert key, destination tab.
- Invariant: each key leads to a tab that this viewer can see. This holds, but only `config` is role-gated, so it is close to trivial.
- Invariant wanted: the tab shows the event that caused the alert. `guard_blocked` breaks this (B2).

## 3. Ranked candidates

All code below is an extracted copy, not shipped code. To ship, put it in a new plain `.ts` module (for example `web/logic.verify.ts`). The components then import it. The repo accepts this only as part of a reproduced bug fix (CONTRIBUTING section 3), so items 1 and 2 are the natural first steps. Full source: `obs.verify.ts`.

| # | Function | Effort | Trial | Bug it catches |
|---|---|---|---|---|
| 1 | `photoView` (panels.tsx:592-601) | S | proved; shipped shape failed | B1 |
| 2 | `originNonInterference` (drawer.tsx:21-33, store.ts:699) | M | proved; shipped shape failed | B3 and the class of filter bugs |
| 3 | `planView` (panels.tsx:518-526) | S | proved; mutant failed | None today. It guards a mutant |
| 4 | `yesCounts` (panels.tsx:140-142) | M | proved; mutant failed | None today. It guards table drift |
| 5 | `rate` (drawer.tsx:142) | S | proved in clamped form | Rate above 100% |
| 6 | `effectiveTab` (drawer.tsx:39-44) | S | proved | B4 only if `FilterBar` reads it |
| 7 | `durParts` (ui.tsx:25) | S | proved | None today |
| 8 | `canPropose` (main.tsx:411, 435) | S | proved | None today. Server re-checks |

### 1. `photoView`

```ts
export function photoView(rule: Photos, canSafety: boolean, loaded: boolean): PhotoView {
  //@ verify
  //@ ensures \result === "gallery" ==> rule === "reason_required" && canSafety && loaded
  //@ ensures \result === "form" ==> rule === "reason_required" && canSafety && !loaded
  //@ ensures rule === "reason_required" && canSafety ==> \result !== "hide"
```

If violated: staff see photos of a member who is now under 18 or of unknown age, or staff without the role see them. Founder rule: adults only.
Correction: the first review did not require `canSafety` for the gallery, so its contract allowed a shipped defect. The third clause is new. It stops a body that always returns `"hide"`.
Blockers: the value `"none"` clashes with Dafny `Option.None`. Use `"hide"`. The proof covers the render choice. B14 can still feed it an old `rule`.

### 2. `originNonInterference`

```ts
export function originNonInterference(t: Tab, f: string, inRange: boolean, memberOk: boolean, o: string | undefined): boolean {
  //@ verify
  //@ ensures !originApplies(t) ==> feedPasses(t, f, inRange, memberOk, o) === feedPasses(t, "all", inRange, memberOk, o)
  //@ ensures originApplies(t) && f !== "all" && o === undefined ==> !feedPasses(t, f, inRange, memberOk, o)
```

If violated: a filter that the bar marks "Does not apply" still hides data. Staff read an empty safety list.
Correction: this replaces `originPasses`. That contract took `applies` as a parameter, so it could not connect to the tab table. This one is a relation between two calls, and `originApplies` is the `APPLIES` table. It is the best contract in this slice, because it says something that the code does not say.
Blockers: `matchFeed` needs a tab argument. The other filter keys need the same clause. I proved `origin` only.

### 3. `planView`

```ts
export function planView(off: boolean, told: number | undefined, hours: number, at: number, now: number): PlanView {
  //@ verify
  //@ requires hours >= 0
  //@ ensures off ==> \result === "called_off"
  //@ ensures \result === "confirmed" ==> !off && told !== undefined
  //@ ensures \result === "open" ==> !off && told !== undefined && now < at
  //@ ensures told !== undefined && !off && now >= at ==> \result === "confirmed"
  //@ ensures told !== undefined && !off && now >= told + hours * 3600000 ==> \result === "confirmed"
```

If violated: staff read "confirmed" for a member who was not told, or who cancelled, or read "open" after the meeting.
The negative run removes the `Math.min` with `at`. Dafny rejects it.
Blockers: an optional in a spec narrows only in the premise of `==>`.

### 4. `yesCounts`

```ts
export function yesCounts(opps: PS[][]): Yes {
  //@ verify
  //@ ensures 0 <= \result.yes && \result.yes <= \result.revealed && \result.revealed <= opps.length
```

If violated: Everyone-yes shows more than 100%. Target is 85%.
Correction: the first review nested the yes filter inside the revealed filter, so the bound held by construction. Shipped code has that nesting too, so it cannot show this bug today. The trial now counts the two groups independently, so the proof depends on `saidYes(s) ==> isRevealed(s)`. That is the table fact (`SAID_YES` within `REVEALED`). The negative run adds a yes status to one table only, and Dafny rejects it.
Blockers: `Set` constants become predicates. `every` on an empty list is true; the caller excludes that with `participants.some(...)`.

### 5. `rate`

```ts
export function rate(a: number, b: number): number | undefined {
  //@ verify
  //@ requires a >= 0 && b >= 0
  //@ ensures b === 0 ==> \result === undefined
  //@ ensures b > 0 ==> \result !== undefined
  //@ ensures \result !== undefined ==> 0 <= \result && \result <= 100
  if (b === 0) return undefined;
  if (a >= b) return 100;
  const p = Math.floor((a * 100) / b);
  //@ assert a * 100 < b * 100
  return p;
}
```

If violated: a rate shows above 100%, or NaN.
Correction: the first review timed out on this. The clamp removes the need for `a <= b`, and the `const` plus `assert` makes `lsc` emit a method. It proved in the normal time limit. Shipped `rate` has no clamp, and `a <= b` is not guaranteed for pairs from two sources (`meetingsHeld` and `scheduled`). I did not find a failing case.

### 6. `effectiveTab`

```ts
export function effectiveTab(want: Tab, c: TabCaps): Tab {
  //@ verify
  //@ ensures tabVisible(\result, c)
  //@ ensures tabVisible(want, c) ==> \result === want
  //@ ensures !tabVisible(want, c) ==> \result === "feed"
```

If violated: a saved `obs.ui.v1` opens a tab that the role cannot use.
Limit: the proof does not fix B4. B4 is that one caller does not use this function. The value of the extraction is one source of truth, not the proof.

### 7. `durParts`

```ts
export function durParts(ms: number): Parts {
  //@ verify
  //@ requires ms >= 0
  //@ ensures \result.d * 1440 + \result.h * 60 + \result.m === Math.floor(ms / 60000)
  //@ ensures 0 <= \result.h && \result.h < 24 && 0 <= \result.m && \result.m < 60 && \result.d >= 0
```

If violated: review deadlines and opt-out windows show a wrong time.
Limit: the text assembly is not covered. `requires ms >= 0` puts the duty on callers (B10).

### 8. `canPropose`

```ts
export function canPropose(picks: string[], minor: Map<string, boolean>, hasGame: boolean, sparks: number, over: boolean): boolean {
  //@ verify
  //@ ensures \result ==> hasGame && sparks > 0 && !over
  //@ ensures \result ==> forall(i: nat, i < picks.length ==> minor.has(picks[i]) && !minor.get(picks[i]))
```

If violated: the game UI offers an intro with a minor. The server still refuses it.
Correction: the first review used a list of known minors, so a member missing from the list counted as safe. This form fails closed. Shipped `s.members.get(id)?.minor` fails open for a missing member, but `applyFull` removes such picks, so this is not a bug today. Game only.

### Rejected candidates

| Function | Why rejected |
|---|---|
| `holdCell` | Its `ensures` lines restate its one ternary. The fix for B5 is a server signal |
| `reloadDelay` | Restates `max(0, gap - (now - last))`. It says nothing about B14, the real `useLive` defect |
| `timelineWindow` | Restates `max(0, len - n)` |
| `revealView` | Restates a UI hint. `revealFor` in `src/server.ts` is the gate |
| `segOf` | The `ensures` is a copy of the case list. `Record<FeedKind, Seg>` makes `tsc` find B2 with no proof |
| `alertTab` | Only `config` is role-gated, so the contract is close to trivial. It does not see B2 |
| `escapeStep` | Restates a 4-branch `if` chain |
| `pickRun` | No bug, low value, and distinctness still fails to prove |

### Subset traps found

1. Once one function has `//@ verify`, helpers without it vanish. The result is `unresolved identifier`.
2. A string-union value and a local with one name clash in Dafny (`review`).
3. The value `"none"` clashes with `Option.None`.
4. `arr.slice(-n)` is not modelled.
5. `a / b` in a function with an optional return type does not type-check. Use `Math.floor`.
6. `x !== undefined && x === y` in a return expression does not narrow.
7. An optional in `ensures` narrows only in the premise of `==>`. `b > 0 ==> \result !== undefined && 0 <= \result` is a type error.
8. `if (map.get(k))` on `Map<string, boolean>` is a type error. Write `=== true`.
9. After an `lsc` failure, delete the `.dfy` and `.dfy.gen` files. If you do not, `lsc` prints "modifications to generated lines", stops, and does not run Dafny. This looks like success.
10. Out of model here: `Intl`, `toFixed`, `toLocaleString`, regex (`banner`, `Linked`, `humanize`), `reduce`, `Date.now`, iteration over the store Maps, all hooks.

## 4. Bugs

Severity is my judgment. "DOM" means the shipped `main.tsx` ran in happy-dom with a stub HTTP layer (`ui-repro.ts`), and the output below is from that run. "Run" means I ran a copy of the shipped logic. "Read" means I traced the code by hand. I did not open the live console or a real browser.

| # | Severity | Status | Evidence |
|---|---|---|---|
| B1 | Medium | Reproduced | DOM |
| B14 | Medium | Reproduced | DOM (new) |
| B2 | Medium | Reproduced | DOM |
| B3 | Medium | Reproduced | DOM |
| B5 | Medium | Reproduced | DOM |
| B13 | Low | Reproduced | DOM (was unverified) |
| B4 | Low | Reproduced | DOM |
| B6 | Low | Reproduced | DOM |
| B8 | Low | Reproduced | DOM |
| B15 | Low | Reproduced | DOM (new) |
| B7 | Low | Reproduced | DOM |
| B11 | Low | Reproduced (outside slice) | Run |
| B12 | Medium | Unverified | Crash path shown; production input not shown |
| B10 | Low | Unverified | Run for output; caller path not shown |
| B16 | Low | Unverified | Read (new) |

Severity changes: B1 falls from High to Medium, because the viewer had a valid reason and role seconds before, the server refuses a new read, and the image stays only until the panel closes. B11 falls from Medium to Low, because one hour on one filter on two days a year is a small effect.

**B1. Photos stay on screen after the rule refuses them. panels.tsx:599.**
The form at line 592 checks `p.photos === "reason_required"`. The gallery at line 599 checks only local state `photos`. `SlopPanel` has no key on the rule, so the state survives new props. Line 599 does not read the role either, so a lost role has the same result (read only).
Input: an adult member, safety staff opens photos, then the member states an age of 16. Output:

```
B1 before: imgs 1
B1 after rule change: line: Under 18 or age unknown: never matched · age not verified | imgs still in DOM: 1
```

Limit: the server refuses a new read. The image already loaded stays.

**B14. An older detail read can replace a newer one. panels.tsx:48-54. New.**
`useLive` bumps `gen` only when a dependency changes. A key change starts a timer, and `run` then reads the same `gen`. If the first read takes longer than the gap, both reads are valid, and the one that ends last wins.
Input: the `/api/member/:id/app` read at load takes 3.8 s. The member turns under 18 at 0.1 s. The second read at 3 s returns `never_minor`. Output:

```
B14 t=3.4s (newer read done): Under 18 or age unknown: never matched · age not verified
B14 t=4.2s (older read landed): Adult · age verified | form: true
```

The panel again says "Adult" and offers the photo form for a minor, until the next key change. The server refuses the photos. The same hook loads member and opportunity detail, so stale review state can show the same way. The slow read is a test input. I did not measure live latency.

**B2. Leak guard and config events are in no feed segment. drawer.tsx:81-83, 313.**
`guard` and `config` are in `FeedKind` (`src/types.ts:181`) but not in `PEOPLE`, `SAFETY` or `SYSTEM`. `SAFETY_FEED` also omits `guard`. The `guard_blocked` health alert leads to the Safety tab (`alertGo` default branch), and the event is not there. For a viewer without the safety role, output:

```
B2 seg All [ "opt out", "config", "guard" ]
B2 seg People []
B2 seg Safety [ "opt out" ]
B2 seg System []
B2 safety tab events: [ "opt out" ]
```

**B3. The origin filter empties Safety events, and the bar says it does not apply. drawer.tsx:26, 322; store.ts:707-710.**
`APPLIES.safety` has no `origin`. Line 322 calls `s.matchFeed(x)`, which applies origin. An item with no `opportunityId` then fails.
Input: reviewer role, `filters.origin = "engine"`, one `opt_out` item. Output: `safety events: []`, and the Origin control has the title "Does not apply to Safety".

**B5. Analysts read a false zero for holds and watches. panels.tsx:148, 163; drawer.tsx:330-331.**
`countsMember` (`src/shape.ts:29`) removes `trust` for the analyst view (`viewClass` "counts"). The views still count `m.trust === "hold"`. Input: analyst, 2 members on hold, 1 on watch, passed through the shipped `countsMember`. Output: "Safety holds" 0, "on watch" 0, "on hold" 0. The filters "Hold", "Watch" and "Under 18" also give nothing (read). The privacy shaping is correct. The display should say the value is withheld.

**B13. A late search response shows under a new query, and Enter opens it. main.tsx:173-178, 193.**
`runConv` writes `setConv({ q, ... })` after the `await`, with no check that `q` is current. The effect at line 168 runs only when `q` changes, so it clears the pending row and then does not run again. Output:

```
B13 input: abc | after late reply: [ "Conversations · “ab” · 1 back" ] [ "hit for ab" ]
B13 Enter with q=abc focuses: {"kind":"member","id":"m1"}
```

The first review said this does not mislead much because the heading names `ab`. That is true for reading. It is not true for Enter, which opens a member from the old query.

**B4. The filter bar dims for the wrong tab. main.tsx:273.**
`FilterBar` reads `s.ui.drawer`. `Drawer` shows `tab`, the fallback (drawer.tsx:44).
Input: real mode, `ui.drawer = "review"`, no `IN_REVIEW` item. Output: `active tab: [ "Feed" ]`, and two controls have the title "Does not apply to Review". One is Range, which does apply to Feed.

**B6. "members who met someone" ignores the borough filter. drawer.tsx:392.**
`APPLIES.metrics` lists `borough`. Line 392 counts all `s.members`. Line 383 on the same tab uses `s.inBorough(m)`.
Input: `filters.borough = "Queens"`, only a Harlem member has meetings. Output: the tile shows 1.
Wider than reported: the `st.*` tiles on this tab are citywide totals, and they ignore range and borough too. `APPLIES.metrics` is true only for the lower charts.

**B8. Clicking one Safety tile zeroes the other. drawer.tsx:318, 330-331.**
Both tiles count from `members`, which already has the members filter. Output: `2 on watch, 1 on hold` becomes `2 on watch, 0 on hold` after the watch filter. This can be intent (a filtered view), but the tile has no filter mark.

**B15. The Meetings tile ignores the origin filter. panels.tsx:143. New.**
`proposals`, `revealed` and `inReview` use `originOk`. `met` does not.
Input: `filters.origin = "engine"`, one completed opportunity of origin `request`. Output: Everyone-yes "Of 0", Meetings 1. A click on the tile opens a pipeline that applies the origin filter, so the count and the list do not match.

**B7. No data shows as 0%. drawer.tsx:379, 390, 393.**
The ladder at line 142 and the enjoyment tile at line 391 show "–". The other tiles use `pct(... : 0)`. Output with no data: invite yes rate `0%`, show rate `0%`, mean enjoyment `–`. A change here is a copy change unless a flow is broken (CONTRIBUTING section 3).

**B11. "Today" is wrong on both DST days. store.ts:97 (outside this slice; every panel uses it through `rangeStart`).**
`nycDayStart` subtracts wall-clock hours as if they were elapsed hours. Run output:

```
2026-03-08 12:00 PM NYC -> 3/7/26, 11:00 PM   (one hour too early)
2026-11-01 12:00 PM NYC -> 11/1/26, 1:00 AM   (one hour too late)
```

**B12. One bad value blanks the console. All files; for example ui.tsx:143.**
There is no `ErrorBoundary` in `packages/observatory/web`. `c[k].toFixed(2)` throws on a missing key. `fmt().format(NaN)` throws `RangeError: date value is not finite` (run). `format(undefined)` does not throw. The harness showed the crash path: a stub with no `env.label`, then a stub with no `pending` in the timeline, each emptied the whole root. Those were stub faults, not production data.
Unverified: `components` writers send a full `ScoreComponents` or `ZERO`. I did not find a row with a missing key.

**B10. Negative durations can show. ui.tsx:25, panels.tsx:284.**
`dur(-1)` returns `"-1m"`. Line 286 in the same panel clamps with `Math.max(0, ...)`. Line 284 does not. A delta sets `clock` before the opportunities, so a normal update does not cause this. The remaining paths are a detail response newer than the last clock, or skew between the service host and the Observatory host. A clock message arrives every 500 ms, so it is a short flicker.
Unverified: I did not produce this in the harness.

**B16. Space on a focused button can start the simulation instead. main.tsx:39-44. New.**
The global handler skips `input, textarea, select`, not `button`. With `canStep`, Space calls `preventDefault()` and toggles play. A keyboard user on a focused button in sim mode cannot press it with Space. Live console: `canStep` is false, so it has no effect.
Unverified: happy-dom does not model button activation. I did not test a real browser.

### Refuted

- **B9. Search by member id fails for a mixed-case id: refuted, removed.** Live ids are `${app}_${randomUUID()}` (`service.ts:1443`). Sim ids are `m0001` or `nyc-g1-0001`. All are lower case. `q` is lower-cased, and the comparison succeeds.
- **Appearance ratings reach the screen: no.** `memberFacets` removes them in `src/sources/real.ts:617`, `src/sources/game.ts:475` and again at `server.ts:488`. `Facts` shows only what arrives. No view reads a score.
- **Phones reach the screen: no.** `channel_identities` is never read. Free text goes through `scrubText` on the server.
- **Hidden truth without the lens: no.** `Truth` needs both flags. `stripOracle` covers `/api/state`, and `src/sources/game.ts:504` covers details. The unsafe verdict shows on purpose.
- **Event tooltip dumps a raw payload (panels.tsx:469): no.** `describe` keeps named scalars only.
- **Revealed text stays after expiry: not a practical bug.** The real source pushes every 500 ms (`real.ts:220`), so `MemberPanel` renders again and reloads. It can stay while the socket is down.
- **`Lorenz` divides by zero: no.** Engine `lorenz()` always returns 10 points.
- **`Bars` divides by zero: no.** `m >= 1`, and no caller passes `max`.
- **Removed client alerts (panels.tsx:86): no.** `healthAlerts` emits invariant, canary, and minor alerts (`health.ts:75-77`).
- **`weeks` in Metrics: no.** It has a floor of 1/7, and `clock.start` is the first join.
- **Key `n` in the review queue also steps the sim: no.** `review.tsx:242` listens in the capture phase and `handled()` calls `stopImmediatePropagation`.
- **`Linked` with an empty name: no.** `displayName` gives "Unnamed member".

## 5. Recommendation

1. Fix B14 and B1 first, together. Fixing only B1 leaves B14 able to feed `photoView` an old rule. For B14, bump `gen` in `run`.
2. Then fix B2, B3 and B5. B2 needs one exhaustive `Record<FeedKind, Seg>` and no proof. B3 is where a contract has the most value.
3. Each fix needs an integration or e2e case that fails first (docs/tests-policy.md). `packages/observatory/test/held-photo-ui.test.tsx` is a working pattern. `ui-repro.ts` has the scenarios.
4. Do not verify the components. Keep the verified file small: `photoView`, `originNonInterference`, `planView`, `yesCounts`, `rate`. Do not add the rejected candidates.
5. LemmaScript is a weak fit for this slice. The worst bugs here are about state and timing, which the subset cannot express. The stronger privacy targets are on the server: `isScoreFacet`, `memberFacets`, `stripOracle`, `countsMember`, `revealFor`. Prove those in the server slice. The client gates are hints.

## Verification

Generated output is quoted. The rest is hand-written. Commit a0ed7bc. Directory: `{SP}/obs-views/`, where `{SP}` is `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials`. `lsc` below is the throttled wrapper. Dafny used its default 30 s limit per item. No LLM calls. No `bun run sim`, no test suites, no builds.

Completeness: `git ls-files packages/observatory | grep -E 'web/|\.tsx$'`, then a grep of every top-level declaration in the four files against this report. It found 4 missing: `Peek`, `RELOAD_GAP_MS`, `TimelineItem`, `tf`. All are NA and now in section 1. The other files in `web/` (`admin`, `apps`, `network`, `ops`, `review`, `graph`, `map`, `store`, `safe`) are outside this slice.

| Command | Outcome |
|---|---|
| `lsc check --backend=dafny obs.verify.ts` | `Dafny program verifier finished with 17 verified, 0 errors` |
| `lsc check --backend=dafny neg.verify.ts` | `finished with 1 verified, 5 errors`. Rejected as required: `photoViewShipped`, `originNI`, `planNoMin`, `yesOne` (one of them on two paths) |
| `lsc check --backend=dafny reviewer-views.verify.ts` (copy of first review) | `finished with 20 verified, 1 error`. The error is `pickRun` distinctness, as the first review said |
| `lsc check --backend=dafny reviewer-more.verify.ts` (copy of first review) | `finished with 9 verified, 0 errors, 1 time out`. The time-out is `rate_ensures`, as the first review said |
| `cd packages/observatory && bun run {SP}/obs-views/ui-repro.ts` | Output quoted in section 4 for B1 to B8, B13, B14, B15 |
| `bun run {SP}/obs-views/fmt.ts` | `RangeError: date value is not finite in DateTimeFormat format()` for NaN |
| `bun run {SP}/observatory-views/run.ts` (first review, re-run) | B11 output and `dur(-1)` output, same as section 4 |

Limits of the DOM harness: happy-dom, not a browser. `map.ts` is a stub. HTTP and the WebSocket are stubs, and the JSON shapes are hand-made from `src/types.ts`. Roles are set through a stub `/api/me`. `countsMember` in B5 is the shipped function. The harness proves client behaviour for the given input. It does not prove how often that input occurs.
Limits of the proofs: each contract is on an extracted copy. Nothing ties the copy to the shipped code until the code imports it. `number` is an integer in the model, so NaN and fractions are not covered.

Corrections to the first review:

- Removed: B9 (refuted). Added: B14, B15, B16.
- B13 changed from unverified to reproduced, and it is stronger than first stated.
- B1 and B11 severity reduced. B6 is wider than first stated.
- Rejected 8 candidates as restatements or as low value.
- Tightened `photoView`, `canPropose`, `yesCounts`, `planView`. Replaced `originPasses`. Proved `rate`, which had timed out.
- The negative trials now use one contract with the shipped shape. The earlier `dimTab` and `safetyEventPasses` contracts were close to tautologies.
- The `useLive` invariant in J7 was too weak (B14).
