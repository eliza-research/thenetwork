# LemmaScript survey: Observatory client state and data

Hand-written by a research agent, at commit a0ed7bc, then corrected by a skeptic pass. No repository code changed. Section 6 lists the checks and every change.

Slice: `packages/observatory/web/store.ts`, `safe.ts`, `graph.ts`, `map.ts`, `index.html`, `styles.css`.
Context read: `docs/observatory.md`, `docs/admin-console.md`, `packages/observatory/src/{store,server,staff,types,projector}.ts`, and the callers in `web/main.tsx`, `web/drawer.tsx`, `web/panels.tsx`.

Evidence kept outside the repository, in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/observatory-state/`:

- `run.ts` and `token.ts` run `store.copy.ts` against fake browser globals. `store.copy.ts` is `web/store.ts` with its imports stubbed by `sed`. The class body is the same. Scenario names S1 to S16 below come from `run.ts`.
- `t*.ts` are the first LemmaScript trials. Tool: `lsc check --backend=dafny`, through the throttled wrapper.

Evidence of the skeptic pass is in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-state/`: `bugs2.ts` and `map.run.ts` are new runs, S17 to S23. `a*.ts` are the final trials.

Limit of the model: LemmaScript models `number` as a mathematical integer. These proofs do not cover NaN or fractions. They do not cover timing. A proof covers one pure step, not the browser event order.

## Result in short

- The important logic is the sync protocol: load, delta, reconnect and app switch. All of it is in class methods with `await`, so LemmaScript cannot check it in place.
- The branch decisions extract into small pure steps. A fold over any event list then proves an invariant for any delivery order.
- The strongest result: one delta contract rejects both the shipped logic and the first proposed fix, and the corrected form proves. The first fix dropped same-version deltas, and those are normal traffic. It would have frozen the game panel and the clock (S17).
- 7 candidates remain: 6 pairs where the shipped logic fails and the fixed form proves, and 1 role check that proves as it stands. 6 candidates were rejected, 1 was merged, and candidate 11 stays not run.
- 19 bugs are reproduced. 5 can misreport to an operator: B1, B3, B4, B18, B19. B2 can too, but it needs a rare lag.

## 1. Files and functions

Verdicts: **VIP** = verify in place. **ETV** = extract, then verify. **N/A** = not applicable, with the reason.

### 1.1 `packages/observatory/web/safe.ts`

| Location | Purpose | Verdict |
|---|---|---|
| `safe.ts:8` `textNode` | Builds a span with `textContent` | N/A: DOM. The XSS safety depends on `textContent`, which the subset does not model. |
| `safe.ts:15` `memberTooltipText` | Tooltip text with under-18 and trust markers | VIP. Proved with `endsWith` (`t1b`), but the contract restates the ternary. Candidate 13 was rejected. |

### 1.2 `packages/observatory/web/store.ts`

| Location | Purpose | Verdict |
|---|---|---|
| `store.ts:17-91`, `:123`, `:167-169` constants (`COLUMNS`, `STATE_GROUPS`, `GROUP_OF`, `OPEN`, `DEFAULT_FILTERS`, `UI_KEYS`, `REVIEW_SECONDS_CAP`, `REFUSED`) | Tables for states, filters, labels | ETV. Totality of `COLUMNS` over the state union is a data check. S13: every `OpportunityState` is in a column. |
| `store.ts:64` `originLabel` | Label lookup | N/A: regex replace, display only. |
| `store.ts:86` `stateGroupOf` | State to filter group | ETV. Rewrite as a `switch` on a string-literal union, then totality is checked and the `?? "open"` default goes away. Low value: S13 passes. |
| `store.ts:97` `nycDayStart` | Start of the NYC day | N/A: `Intl`, wall-clock arithmetic, time zone rules. It has bug B13. |
| `store.ts:101` `sameFocus` | Focus equality | VIP. Low value. |
| `store.ts:102` `focusKey` | Focus to cache key | VIP. Low value. |
| `store.ts:103` `isMemberActive` | Active member predicate | VIP after a record type for the three fields. Low value. |
| `store.ts:105` `originOf` | Opportunity origin | VIP. Low value. |
| `store.ts:107` `readJSON` | Reads local storage | N/A: storage, `JSON.parse`, try/catch. |
| `store.ts:110` `writeJSON` | Writes local storage | N/A: storage. |
| `store.ts:111` `pick` | Allow-list a stored value | VIP. Generic over `T extends string`; ensures the result is in `allowed` or is `d`. |
| `store.ts:113` `loadFilters` | Restores filters | ETV after the read. The `origin` field has no allow-list. |
| `store.ts:124` `loadUIPrefs` | Restores UI preferences | N/A: untyped JSON. Low value. |
| `store.ts:138` `hashParams` | Parses the hash | N/A: `URLSearchParams`. |
| `store.ts:139` `parseHash` | Hash to focus | ETV for the `m`, `o`, `n` priority only. Low value. |
| `store.ts:144` `parseApp` | Hash to app | ETV. Low value. |
| `store.ts:148` `parsePage` | Hash to page | ETV. Low value. |
| `store.ts:153` `hashOf` | Focus to hash | N/A: `encodeURIComponent`. |
| `store.ts:175` `initialToken` | Reads and removes the token from the URL | ETV for the choice of token. The URL work is N/A. It has bug B16. |
| `store.ts:254` `constructor` | Adds the popstate listener | N/A: DOM. |
| `store.ts:257` `subscribe` | Listener set | N/A: closure over mutable state. |
| `store.ts:258` `getTick` | Tick read for React | N/A: trivial. |
| `store.ts:259` `notify` | Timer-batched notify | N/A: timer. |
| `store.ts:267` `setUI` | Merges UI patch | N/A: class, storage. |
| `store.ts:272` `setFilters` | Merges filters | N/A: class, storage. |
| `store.ts:276` `resetFilters` | Resets filters | N/A: one call. |
| `store.ts:277` `filtersChanged` | Any filter away from default | ETV. Low value. |
| `store.ts:278` `toast` | Shows a toast | N/A: `Date.now`. |
| `store.ts:282` `withApp` | Adds `app=` once | N/A. The regex is correct and callers encode ids. Candidate 12 was rejected. |
| `store.ts:283` `api` | Fetch with auth headers | N/A: `await`, `fetch`. |
| `store.ts:295` `getJSON` | JSON read with no status check | N/A: `await`. Root of B6. |
| `store.ts:297` `fetch` | Fetch that keeps the status | N/A: `await`. |
| `store.ts:308` `setToken` | Replaces the token | ETV for the epoch rule. Low value. |
| `store.ts:318` `load` | Full state load with a delta buffer | ETV. Core of the slice. Candidate 3. Bugs B1, B3, B5, B6, B11, B17. |
| `store.ts:348` `applyFull` | Replaces state, prunes focus and picks | ETV for the pruning. The assignments are N/A. |
| `store.ts:361` `focusExists` | Focus target exists | ETV over maps. Low value. |
| `store.ts:368` `applyDelta` | Delta reducer | ETV. Candidates 1, 15. Bugs B2, B11, B18. |
| `store.ts:399` `connect` | Ticket, socket, reconnect | ETV for the close-code decision only. Bugs B7, B12. |
| `store.ts:429` `control` | Posts a command | N/A: `await`. |
| `store.ts:440` `setMode` | Switches mode | N/A: `await`. |
| `store.ts:452-486` thin API wrappers (`member`, `timeline`, `memberApp`, `photos`, `opportunity`, `safety`, `safetyAction`, `held`, `heldDecision`, `config`, `cost`, `bias`, `audit`, `search`, `runDiff`, `lab`, `appsHealth`, `findPerson`, `person`, `openPersonApp`) | One request each | N/A: `await`, no branch that matters. |
| `store.ts:462` `heldPhoto` | Loads a held photo and checks its type | ETV for the type allow-list. `blob` work is N/A. Low value. |
| `store.ts:490` `apps` | Apps this person may open | ETV. Note B5: with no `appInfo` the list is empty. |
| `store.ts:495` `appInfo` | Info for one app | VIP. Low value. |
| `store.ts:497` `reasons` | Review reason list | VIP. Low value. |
| `store.ts:502` `setApp` | Switches app | ETV for the state reset. Bugs B1, B9. |
| `store.ts:518` `openPerson`, `:519` `closePage`, `:520` `replaceHash` | Page and hash changes | N/A: `history`. |
| `store.ts:524` `labRun` | Lab request | N/A. |
| `store.ts:528` `can` | Client role check | ETV. Candidate 9. |
| `store.ts:533` `rolesHere` | Roles for the top bar | ETV. It shows `cross_app_safety` and a real-mode `engineer`, which `can` does not count. Display only. |
| `store.ts:536` `isAdmin`, `:538` `canSim`, `:539` `realOnly` | Role helpers | Covered by `can`. |
| `store.ts:540` `loadReveals` | Reads reveal grants | N/A: `await`. A failed read clears the list, which fails closed. |
| `store.ts:545` `revealFor` | Active grant | N/A: `Date.now`. ETV with `now` as a parameter. |
| `store.ts:547` `unreveal` | Ends a reveal | ETV. Candidate 4, model form. Bug B10. |
| `store.ts:552` `reveal` | Starts a reveal | N/A: `await`. |
| `store.ts:562` `focus`, `:577` `back`, `:585` `clearFocus`, `:591` `pushHash`, `:597` `onPopState` | Focus and history | ETV as one reducer over `{focus, stack}` is possible. Medium effort, low value. `onPopState` also reads `history`. |
| `store.ts:614` `flyTo` | Map fly-to or pending | N/A: renderer call. |
| `store.ts:620` `togglePick` | Picks, at most 6 | VIP after extraction to a function of `(picks, id)`. Ensures length at most 6. |
| `store.ts:627` `cached` | One-entry memo | N/A: mutable closure. |
| `store.ts:637` `busy` | Members in open opportunities | ETV over an opportunity array. Candidate 11. |
| `store.ts:646` `focusSet` | Members to keep bright | ETV. Ensures every pick and the focused member are in the set. |
| `store.ts:666-672` `now`, `borough`, `rangeStart`, `inRange`, `rangeLabel` | Range predicates | ETV. `rangeStart` depends on `nycDayStart`. |
| `store.ts:674` `inBorough`, `:675` `matchMemberFilter`, `:685` `matchMember` | Member filters | ETV. Part of candidate 8. |
| `store.ts:687` `matchOpp` | Opportunity filters | ETV. Candidate 8. |
| `store.ts:699` `matchFeed` | Feed filters | ETV. Candidate 8. Bugs B4, B19. |
| `store.ts:715` `focusOpp`, `:722` `focusFeed`, `:729` `focusRun` | Focus predicates | ETV. Medium value: with no focus they return true, which is the "hides nothing" property. |
| `store.ts:736` `focusName`, `:744` `nothing` | Empty-state text | N/A: display only. |
| `store.ts:750` `name`, `:751` `firstName`, `:753` `oppTitle` | Names | N/A: display only. `oppTitle` could be VIP with low value. |
| `store.ts:759` `reviewMode` | Review mode | VIP. Trivial. |
| `store.ts:764` `reviewPending` | Pending review queue | ETV for the filter step. `sort` with a comparator is not in the subset. Covered by candidate 8. |
| `store.ts:771` `reviewDecided` | Decided items | ETV as above. Bug B19. |
| `store.ts:777` `showReviewTab` | Review tab rule | ETV. Medium value: in real mode it must show when an item is in review. |
| `store.ts:782` `canWrite`, `:784` `canAct`, `:786` `canReview` | Capability rules | VIP after extraction. Low value. |
| `store.ts:787` `judge` | Stats getter | N/A: trivial. |
| `store.ts:789` `reviewOpen` | Starts a timer | N/A: `Date.now`. |
| `store.ts:794` `decide` | Sends a decision | N/A in practice. The decisions extract, but candidate 7 restates them. Bug B15 is a data fault. |
| `store.ts:816` `useStore` | React hook | N/A: React. |

### 1.3 `packages/observatory/web/graph.ts`

| Location | Purpose | Verdict |
|---|---|---|
| `graph.ts:12-33` style tables | Colors | N/A: data. |
| `graph.ts:35` `hashHue` | FNV hash | N/A: `Math.imul`, `>>>`. |
| `graph.ts:36` `communityColor` | Color | N/A. |
| `graph.ts:38` `memberColor` | Color by lens | ETV for the branch order; fractions fall outside the integer model. Bug B14: this function has no trust rule. |
| `graph.ts:76` `constructor`, `:92` `destroy`, `:94` `resize` | Canvas lifecycle | N/A: DOM, d3-force. |
| `graph.ts:103` `syncGraph` | Rebuilds nodes and links | ETV for one rule only: `blocked` and `avoid` edges add no layout pull. Low value. |
| `graph.ts:134` `fit`, `:144` `focus`, `:156` `toWorld`, `:158` `pick` | View geometry | N/A: floats, `Math.hypot`. |
| `graph.ts:152` `visible` | Node shown rule | ETV. Shares candidate 8. |
| `graph.ts:170` `bind` | Pointer events | N/A: DOM. |
| `graph.ts:206` `takePulses` | Drains pulses | N/A: canvas state, mutation of the store array. |
| `graph.ts:218` `frame`, `:235` `draw`, `:342` `drawOpp` | Rendering | N/A: Canvas2D. |
| `graph.ts:374` `nodeRadius` | Radius | N/A: `Math.sqrt`, floats. |

### 1.4 `packages/observatory/web/map.ts`

| Location | Purpose | Verdict |
|---|---|---|
| `map.ts:32` `constructor`, `:49` `destroy` | Leaflet lifecycle | N/A: Leaflet, DOM. |
| `map.ts:51` `focus`, `:57` `flyTo`, `:59` `point` | Map moves | N/A: Leaflet. |
| `map.ts:64` `frame` | 4 Hz loop | N/A: `requestAnimationFrame`. |
| `map.ts:72` `followFocus` | Moves to the focus once | N/A: Leaflet. The "once" rule is ETV with low value. |
| `map.ts:92` `sync` | Marker, edge, opportunity and meeting layers | ETV for three parts: marker diff (candidate 14, bug B8), trust fill at `:120` (candidate 13), meeting grouping at `:156-160` (`upcoming <= n`). The rest is N/A: Leaflet. |

### 1.5 No logic

| File | Check | Verdict |
|---|---|---|
| `packages/observatory/web/index.html` | 17 lines: CSP, referrer policy, root element, one module script. No inline script. | N/A: no logic. Note: `connect-src` allows `ws:` and `wss:` for any host. `img-src` allows `https:` because of map tiles. |
| `packages/observatory/web/styles.css` | 411 lines. A search for `url(`, `expression` and `@import` found none. `content:` appears only for the two disclosure arrows at lines 301-302. | N/A: no logic. |

## 2. Staff journeys as state machines

### J1. Sync (load plus deltas)

States: `Empty`, `Loading(buffer)`, `Synced(V)`.

| From | Event | To | Note |
|---|---|---|---|
| Empty, Synced | `load()` | Loading | Buffer cleared |
| Loading | delta | Loading | Delta buffered |
| Loading | state at SV lands | Synced(SV) | Replays deltas |
| Synced(V) | delta V+1 | Synced(V+1) | Normal path |
| Synced(V) | delta above V+1, or `reset` | Loading | Gap |
| Synced(V) | delta at V | Synced(V) | Legal: `clock`, `game`, `network` only. Today its data fields apply too (B11) |
| Synced(V) | delta below V | **no rule** | Applied today (B2) |

Invariants wanted:

1. `version` never falls unless a full state replaces it.
2. A delta changes data only at V+1. A delta at V may change `clock`, `game` and `network` only.
3. Only the newest load can change state.
4. A feed item shows once. A state at V holds delta V, because `takeDelta` bumps the version before any later snapshot (`src/store.ts:161-162`). It can also hold part of delta V+1, because `snapshot` does not flush. So a version filter is not enough, and the merge must compare `seq`.

Today, 1 and 2 fail (B2), 3 fails (B1, B3), and 4 fails (B11, B18).

### J2. Socket

States: `Closed`, `Ticketing`, `Open`, `Stopped`.

| From | Event | To | Note |
|---|---|---|---|
| Closed, Open | `connect()` | Ticketing | Generation bumped, old socket closed |
| Ticketing | ticket | Open | |
| Ticketing | 401, 403 | Stopped | No retry |
| Ticketing | other failure | Closed | Retry in 3 s, **no load** (B7) |
| Open | close 4401, 4403 | Stopped | Toast, load |
| Open | other close | Closed | Retry in 1.5 s, with load |

Invariants wanted: `connected` is true only in `Open` (fails: B12). Each entry to `Open` after a drop is followed by a full load (fails: B7).

### J3. Sign-in and token

States: `Unknown`, `TokenRead`, `Signed(me)`, `NeedsToken`, `NoApps`.

Transitions: page load reads `#token=`; `/api/me` answers; a 401 goes to `NeedsToken`; `setToken` returns to `TokenRead`; empty `apps` goes to `NoApps`.

Invariants wanted: no failure of `/api/me` grants a role (fails: B5). No token stays in the address bar (fails only for a contrived URL: B16).

### J4. Review decision

States: `Pending`, `Opened(t0)`, `Deciding`, `Done`, `Refused`.

| From | Event | To |
|---|---|---|
| Pending | card opened | Opened(t0) |
| Opened | decide | Deciding |
| Deciding | second press | Deciding, with `in_flight` and no send |
| Deciding | `ok` | Done, timer removed, toast |
| Deciding | refused code | Opened(t0) |
| Deciding | other failure | timer removed |

Invariants wanted: one request per item at a time (holds). The toast word matches the decision (holds). A refused action keeps its timer (fails for `mode_changed`: B15). An item shown as `IN_REVIEW` is `IN_REVIEW` on the server, up to sync delay (fails: B2, B3).

### J5. PII reveal

States: `None`, `Requesting`, `Active(until)`, `Ending`.

Invariants wanted: `Active` on screen if and only if the server holds the grant (fails after a failed DELETE: B10). `Active` ends at `until`: `revealFor` reads wall time, and the server keeps the matching wall-time check.

### J6. App, mode and page switch

States: `App(a, mode)`, `AllApps`, `Person(id)`.

Transitions: `setApp`, `setMode`, the socket `mode` message, `popstate`.

Invariants wanted: every panel shows data of the current `(app, mode)` only (fails: B1, B8, B9). A failed load does not leave the old app's numbers under the new app's name (fails: B9).

### J7. Filters

States: one `Filters` record per mode, kept in local storage.

Invariants wanted: default filters hide nothing that a tab promises. A filter marked "does not apply" has no effect on that tab (fails: B4, B19; proved for the fixed form in `a5_filter_fixed.ts`).

## 3. Ranked candidates

The skeptic pass changed this section. Numbers are the first numbers, so the references in section 1 still work. The order below is the new rank. Syntax was accepted by `lsc` for every trial that says proved or failed. Effort: S under 1 hour, M a day, L more.

A trial pair works this way: the same contract runs on the fixed form and on the shipped logic. A contract is kept only if the shipped logic fails it and the fixed form proves it. The exception is candidate 9, which holds for the shipped rule. All models are small. A proof covers the extracted step and any delivery order of events into that step. It does not cover the browser, the network or `await`.

### 1. `step` for deltas (extract from `store.ts:368-391`). Effort S. Rewritten.

The first form was **wrong and is withdrawn**. It dropped every delta with `dv <= version`. An unchanged-version delta is normal traffic. `takeDelta` keeps the version when nothing changed (`src/store.ts:162`), but `server.ts:207` still sends type `delta` if `d.game` or `d.network` is set. `game.ts:437` passes `game` on every push and `real.ts:240` sets `network` with no version bump. Run S17: the first form freezes `game` and `clock`. The fix needs five outcomes, not four.

```ts
export function step(s: St, e: Ev): St {
  //@ verify
  //@ requires s.oppV <= s.version
  //@ ensures \result.version >= s.version
  //@ ensures \result.oppV >= s.oppV
  //@ ensures \result.oppV <= \result.version
  //@ ensures e.version === s.version ==> \result.game === e.game
  //@ ensures e.version === s.version ==> \result.opp === s.opp
  //@ ensures e.version === s.version + 1 ==> \result.version === e.version
  if (e.version < s.version) return s;
  if (e.version === s.version) return { ...s, game: e.game };
  if (e.version > s.version + 1) return s;   // the caller reloads
  return { version: e.version, opp: e.hasOpp ? e.opp : s.opp, oppV: e.hasOpp ? e.version : s.oppV, game: e.game };
}
```

`run(s, es)` folds `step` over any list and proves the first three lines for the whole list. `game` stands for all non-structural fields: `clock`, `game`, `network`.

- If violated: an old delta rewinds an item (B2), a same-version delta adds its feed again (B11), or the game panel and the clock stop (S17).
- Trial: `a1_sync_fixed.ts` **proved**. `a1_sync_shipped.ts` **failed**, 4 errors. `a1_sync_report.ts` (the first form) **failed** the `game` line.

### 15. `appendNew` (extract from `store.ts:386`). Effort S. Rewritten, now rank 2.

```ts
export function appendNew(feed: Item[], items: Item[]): Item[] {
  //@ verify
  //@ requires forall(i: nat, forall(j: nat, i < j && j < feed.length ==> feed[i].seq < feed[j].seq))
  //@ requires forall(i: nat, forall(j: nat, i < j && j < items.length ==> items[i].seq < items[j].seq))
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.length ==> \result[i].seq < \result[j].seq))
  //@ ensures forall(j: nat, j < feed.length ==> \result[j] === feed[j])
  //@ ensures forall(k: nat, k < items.length && (feed.length === 0 || items[k].seq > feed[feed.length - 1].seq) ==> \result.includes(items[k]))
```

- If violated: an event shows twice in the Feed and Safety tabs (B11, B18), or a new event is lost. The last `ensures` is new. The first form did not have it, so a function that returned `feed` would pass.
- `requires` holds: `pushFeed` is the only writer of `Store.feed` and `seq` is `++feedSeq` (`src/store.ts:93-96`).
- Cap the result with `.slice(-400)` after the merge. The trial leaves the cap out.
- Risk: `seq` restarts when the server restarts. Then this merge hides new events until a full load. Fix B7 first.
- Trial: `a2_feed_fixed.ts` **proved**. `a2_feed_shipped.ts` **failed** the ordering line.

### 3. App and load reducer (extract from `store.ts:318-346`, `:502-516`). Effort M. Rewritten.

`finishLoad` alone only restated its `if`. The new contract is a state invariant over any list of events: switch, begin, land.

```ts
export function good(s: St): boolean {
  //@ verify
  return (s.dataApp === "" || s.dataApp === s.app) && (s.statsApp === "" || s.statsApp === s.app);
}
export function step(s: St, e: Ev): St {
  //@ verify
  //@ requires good(s)
  //@ ensures good(\result)
  //@ ensures e.kind === "land" && e.gen !== s.gen ==> \result.loading === s.loading
```

- If violated: one app's queue shows under another app's name (B1), old numbers stay (B9), or an older answer ends the buffer of a newer load (B3).
- Blockers: real `await` in `load`. `load` must take a generation at its start and pass each result through this step. The proof covers the gate, not the event order.
- Trial: `a3_load_fixed.ts` **proved**. `a3_load_shipped.ts` **failed**, 5 errors.

### 8. `visible` by tab (extract from `store.ts:699-712`, `:771-775`, `drawer.tsx:21`). Effort M. Rewritten.

The contract is non-interference: a filter that the bar marks "does not apply" cannot change the tab. `agree(tab, f, g)` says that `f` and `g` are equal on the keys of that tab.

```ts
export function nonInterference(tab: string, x: Item, f: Fil, g: Fil): boolean {
  //@ verify
  //@ requires agree(tab, f, g)
  //@ ensures \result
  return visible(tab, x, f) === visible(tab, x, g);
}
export function reviewHidesNothing(x: Item, r: number): boolean {
  //@ verify
  //@ ensures \result
  return visible("review", x, { range: r, borough: "all", members: "all", origin: "all" });
}
```

- If violated: a dimmed filter hides Safety events (B4) or decided reviews (B19). The second function takes the place of candidate 10: at default borough, members and origin, no range hides a review item.
- Blockers: the predicates read `this.members` and `this.opps`. The caller must resolve them into item fields. `APPLIES` must move into a place that both the store and the filter bar read.
- Trial: `a5_filter_fixed.ts` **proved** for feed, safety and review. `a5_filter_shipped.ts` **failed**.

### 14. `markersAfter` (extract from `map.ts:107-110`). Effort S. First trial.

```ts
export function markersAfter(have: string[], shown: string[]): string[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> shown.includes(\result[i]))
  //@ ensures forall(i: nat, i < shown.length ==> \result.includes(shown[i]))
```

- If violated: dots of another app or of the simulated world stay on the real map (B8).
- Trial: `a9_marker_fixed.ts` **proved**. `a9_marker_shipped.ts` **failed** the first `ensures`. That trial has no loop invariant, so the failure alone shows little. Run S23 is the concrete counterexample.

### 4. Reveal badge (extract from `store.ts:547-551`). Effort S. Rewritten.

The first contract restated the `if`. The new one links the client to a model of the server: over any run of DELETE answers, `s.server ==> s.badge`.

- If violated: the badge says a reveal ended while the server still serves the PII (B10).
- Limit: the server half is a hand-written model of `server.ts:580`. The proof says nothing if that route changes.
- Trial: `a6_reveal_fixed.ts` **proved**. `a6_reveal_shipped.ts` **failed**, 2 errors. Value is medium: the fix is one `if`.

### 9. `clientRoles` against `serverHolds` (`store.ts:529`, `src/staff.ts:180`). Effort S. Upgraded from failed.

```ts
export function clientRoles(grants: Grant[], app: string, real: boolean): string[] {
  //@ verify
  //@ ensures forall(r: string, \result.includes(r) === serverHolds(grants, app, real, r))
```

- If violated: the console shows controls that the server refuses, or hides controls the person may use. The server still enforces.
- Trial: `a8_can.ts` **proved** with a loop and `grants.slice(0, i)` in the invariant. The `filter`, `map`, `includes` chain failed in `t4`. So the store must use the loop form, or a lemma is needed.
- The better option stays: import one pure rule on both sides. Then the proof has nothing to compare.

### 11. `busyMembers` (`store.ts:637-643`). Not run.

No current bug. A nested `forall` contract only restates the loop. The real risk is a data check: `OPEN` omits states that the filter groups call open. `grep` over `packages` finds `SAFETY_HOLD`, `DISPUTED`, `SCHEDULING`, `IN_PROGRESS`, `NEEDS_REPLACEMENT` and `RESCHEDULE_REQUESTED` only in `packages/core/src/types.ts` and `web/store.ts`, so this is latent. When one of them gets a writer, `matchOpp` will apply the range filter to it and `busy` will skip it.

### Rejected

| No. | Name | Why |
|---|---|---|
| 2 | `laterDeltas` | The `ensures` repeats the `filter` lambda. Also `> sv` does not give the stated effect: S18 shows a duplicate with the fix in place. Candidate 15 covers the real property. Keep the one-character fix as part of B11. |
| 5 | `grantsFrom` | After the fix the code is `status === 200 ? grants : []` and the contract repeats it. Remove the fallback (B5). |
| 6 | `mergeOpps` | Proved in `t6`, but the three `ensures` repeat the two loops and no bug breaks them. `upsertOpp` and `removeOpp` keep the two sets disjoint (`src/store.ts:89-90`), so loop order has no effect. |
| 7 | `decisionWord`, `keepTimer` | Proved in `t7`, but they restate a ternary. `ReviewDecision` has only the four values (`src/types.ts:176`). B15 is a missing list entry, which no such contract catches. |
| 10 | `reviewFilter` | Merged into candidate 8. |
| 12 | `withApp` | Every caller encodes its ids, so `?app=` cannot come from data. No bug would break it. The regex is correct. |
| 13 | `markerFill`, `memberTooltipText` | Proved in `t7` and `t1b`, but the contract is the ternary again. B14 is a missing branch in another file. Sharing one function fixes it with no proof. |

## 4. Confirmed bugs

Status: **reproduced** means a run. All runs use a stubbed copy of the real source (see Verification). None of the bugs was found to be false, but B3 changed, and B2 and B5 are narrower than first stated. Ranked by harm.

### B1. A slow load for the old app overwrites the new app. Reproduced (S3).

`store.ts:318-346`, with `store.ts:333` and `:336`. `load` has no generation check.

Input: `load()` for ntwrk stays in flight. The staff member picks slop. The slop load lands. The ntwrk state then lands.
Result: `s.app` is `slop`, `s.opps` holds `ntwrk-opp`. Expected `slop-opp`.
Effect: the slop review queue shows ntwrk items. A decision on one goes out with `app=slop`. The server answer to that was not run.

### B18. A delta adds a feed item that the state already holds. Reproduced (S18). New.

`src/sources/real.ts:247` and `game.ts:423` call `snapshot()` with no flush. A snapshot at V can hold items that `takeDelta` has not sent. They come in delta V+1.

Input, with the real `src/store.ts`: `pushFeed`, then `snapshot` at version 1, then `takeDelta` at version 2 with the same item.
Result: feed seqs `[1, 2, 2]`, with the shipped code and also with the B2 and B11 fixes. Expected `[1, 2]`.
Effect: a safety event shows twice on an ordinary load. The window is one push interval (500 ms in real mode). Invariant 4 in J1 was too weak: a state at V holds delta V and can also hold part of delta V+1. Upserts are safe to repeat. Feed items are not.

### B2. An old delta rewinds an item and the version. Reproduced (S2), reachability narrow.

`store.ts:372`. Only a gap is checked, so `d.version < this.version` passes.

Input: state at version 10 with `o1` in `INVITING`. Delta 8 with `o1` in `IN_REVIEW` then arrives.
Result: `["IN_REVIEW", 8]`. Expected `["INVITING", 10]`.
Reachability: every delta that arrives while a load runs is buffered and filtered. So this needs a socket that lags the HTTP read by at least one push interval, and that delivers after the load lands. That is rare. The next delta shows a gap and reloads. The fix must keep same-version deltas (candidate 1).

### B3. An older load ends the buffer of a newer load. Reproduced (S20). Corrected.

`store.ts:343` clears `loadingState` and `buffered` with no owner, so any finished load ends the buffering of every other load.

The first report gave a final `["IN_REVIEW", 9]` from S10. **That number was a fault in the harness.** S10 answered the third state read with the promise of the second. With true answers (S19), delta 10 makes a third load, and the result depends on order: in order gives `["INVITING", 10]`, and the third read first gives `["IN_REVIEW", 9]`.

The defect needs no gap. Input for S20: two loads overlap, as after `connect(); load()` plus a gap, or `setMode` plus the socket `mode` message. A lands at 5. Delta 6 moves `o1` to `INVITING` and is applied, because A cleared the flag. B, read before delta 6, lands at 5.
Result: `["IN_REVIEW", 5]`. Expected `["INVITING", 6]`.
Effect: a moved item shows as waiting for review until the next delta, which then shows a gap. This is the harm that `docs/admin-console.md:87` says is fixed.

### B4. The origin filter hides Safety events, and the tab says it does not apply. Reproduced (S15).

`store.ts:707-710`, with `drawer.tsx:26` and `drawer.tsx:322`.

Input: origin filter `engine`, Safety tab, a `block` event with no `opportunityId`.
Result: `matchFeed` is false. The filter bar dims Origin and says "Does not apply to Safety" (`main.tsx:274`).
Effect: `block`, `opt_out`, `adversarial`, `invariant` and `trust` events disappear from the Safety tab.

Related, same run: with a borough filter, an `invariant` event with no members is also hidden (`store.ts:704`, `projector.ts:236`). The Safety tab does say that borough applies, so this one is a design question.

### B19. The Range filter cuts the Decided list, and the tab says it does not apply. Reproduced (S22). New.

`store.ts:773` reads `inRange`, but `APPLIES.review` has no `range` (`drawer.tsx:22`), so the bar dims Range on the Review tab.

Input: range 7d, one decision 25 days old, Review tab, Decided view.
Result: 0 items. With range All: 1 item.
Effect: a reviewer who audits old decisions sees an empty list, and the bar says that Range has no effect. The comment at `store.ts:770` says "in the range", so the code is deliberate and the table is wrong. Fix one of the two.

### B6. An error body from `/api/state` wipes half the state. Reproduced (S4, S21). Effect widened.

`store.ts:295` has no status check. `store.ts:349` assigns before `store.ts:351` throws.

Input: a good state, then `/api/state` answers 500 with `{"error":...}` (`server.ts:258`).
Result: `env`, `runs` and `network` are undefined, members stay, and the toast shows a raw `TypeError` text.
Effect, new in S21: `canAct()` and `canReview()` go from true to false, so review, safety and matching buttons vanish. They stay off after the next delta, because a delta carries `env` only when it changed. `drawer.tsx:216` reads `s.runs.filter` with no guard and the web code has no error boundary, so the Runs tab would throw during render. That render was not run.

### B7. A reconnect through the ticket retry skips the full load. Reproduced (S9).

`store.ts:405` calls `connect()` only. `store.ts:417` calls `connect()` and `load()`.

Input: the socket drops, the server is down for about 2 s, so the 1.5 s retry and its load fail. The 3 s ticket retry then succeeds.
Result: 0 state reads after the outage, 2 sockets.
Effect: the console is live with stale data until a delta exposes a gap. After a server restart the version and `seq` restart too, so no gap shows. Today those deltas still apply. **With candidates 1 and 15 they would all be dropped, so fix B7 first.**

### B5. A failed `/api/me` paints an admin, then a blank page. Reproduced (S5), narrower.

`store.ts:325`. The fallback covers any failure, not only an older server. `/api/me` exists on every current server (`server.ts:439`).

Input: `/api/me` fails for a reviewer while `/api/mode` succeeds.
Result: `me.id` is `token`, `isAdmin()` is true, `apps()` is empty for all three failures.
Reachability: the two requests run in `Promise.all`. A network error or a non-JSON 502 on both rejects at `/api/mode`, and `me` is not set. So this needs a failure on `/api/me` alone. A 403 can hit both, but only from the host or origin check (`server.ts:322-331`). Then `mode` also becomes undefined.
Effect: `can()` passes every check. `apps()` is empty, so `main.tsx:56` hides the main area. The server still refuses each action.

### B8. The map keeps markers from the previous app or mode. Reproduced (S23). First run.

`map.ts:107-110`: the loop walks `store.members` only, so a marker whose member left the store is never removed. `main.tsx:331-337` builds `MapView` once, and no parent uses a `key`, so a switch does not rebuild it. The tooltip at `map.ts:114` falls back to the captured `m`.

`map.ts:146`: `oppVersion` holds neither app nor mode. Two quiet apps at the same version, filters and focus keep the old layers. This second part was not run.

Input: real `sync()` with a fake Leaflet. Member `ntwrk-a`, then the maps cleared as `setApp` does, then member `slop-b`.
Result: markers `["ntwrk-a", "slop-b"]`, with no `remove` call. Expected `["slop-b"]`.
Effect: ntwrk dots stay on the slop map, and simulated dots stay on the real map, until a view toggle.

### B9. A failed load after an app switch keeps the old app's numbers. Reproduced (S16).

`store.ts:510` clears members, edges, opportunities and feed, but not `stats`, `network`, `requests`, `runs`, `game` or `truth`.

Input: ntwrk with 7 queued, then `setApp("slop")`, and `/api/state` answers 502.
Result: `[7, 1, 42]`: queued count, requests and stats from ntwrk, under slop. The drawer tab count reads `network.review.queued` (`drawer.tsx:54`). A toast does say that the load failed.

### B10. Ending a reveal clears the badge even when it failed. Reproduced (S6).

`store.ts:547-551` ignores the response and swallows a thrown fetch.

Input: `DELETE /api/reveal` fails with a network error, or answers 500.
Result: 0 local grants in both cases. Expected 1.
Effect: the UI says the reveal ended. The server can still serve that member's PII until `until`, at most 15 minutes. No `reveal_revoke` row exists. The next load restores the badge through `loadReveals`.

### B11. A delta at the state's own version is applied twice. Reproduced (S1).

`store.ts:337` uses `>=`. `src/store.ts:162` bumps the version before `takeDelta` builds the delta, so a state at V already holds delta V.

Input: delta 5 with feed item 7 arrives during a load, and the state at version 5 holds item 7.
Result: feed `[7, 7]`.
Effect: a duplicate event in the Feed and Safety tabs on an ordinary reload. The same fault happens if delta V arrives just after the load lands.

### B12. The live indicator stays on after the socket is closed. Reproduced (S8).

`store.ts:400-401` bumps the generation first, so `store.ts:413` ignores the close of the old socket. `connected` is set false only there.

Input: an open socket, then `connect()` gets a 403 for its ticket.
Result: `connected` is true, the socket is closed, and no new socket exists.
Effect: `main.tsx:105` does not show the "Reconnecting" dot.

### B13. "Today" is wrong on daylight-saving days. Reproduced (S7).

`store.ts:97-100` subtracts wall-clock hours as elapsed time.

| Time | Result | Expected |
|---|---|---|
| 2026-11-01 12:00 EST | `05:00Z` | `04:00Z`: the first hour of the day is hidden |
| 2026-03-08 12:00 EDT | `04:00Z` | `05:00Z`: one hour of the previous day shows |
| 2026-06-01 12:00 EDT | `04:00Z` | `04:00Z` |

### B14. The graph view hides the watch flag. Reproduced (S23). First run.

The map colors `watch` and `hold` (`map.ts:120`) and its tooltip shows both (`safe.ts:16`). The graph's `memberColor` (`graph.ts:38`) reads no trust field, and `graph.ts` holds no other read of it. The graph tooltip shows `hold` only (`main.tsx:358`).

Input: `memberColor` for a `hold` member and an `ok` member, lenses community, state and activity.
Result: the same color for all three lenses.
Effect: a `watch` member has no visual sign. A `hold` member shows only on hover.

### B15. Some refusals drop the review timer. Reproduced (S12), list corrected.

`store.ts:169` omits `mode_changed`, and `store.ts:804` then drops the timer. `server.ts:370` answers 409 before anything runs.

The first report also named `read_only`, `not_available` and `matching_locked`. They do not belong here: on the review path the codes come from `src/sources/service.ts:92-103`. There, `service_auth`, `service_missing` and `service_error` are "the service did not act", and they are also absent from the list. `service_unavailable` is unknown, so dropping the timer is correct for it. Only `mode_changed` was run.

Input: open a card, then decide, and the server answers `mode_changed`.
Result: timer dropped. Effect: the review-time training label is lost on the retry.

### B16. An empty fragment token leaves a query token in the address bar. Reproduced (`token.ts`).

`store.ts:180`: `h.get("token")` returns `""` for `#token=`, and `??` does not fall through.

Input: `http://x.test/?token=abc#token=`.
Result: no `replaceState`, the token stays in the URL. `#token=abc&m=1` and `?token=abc` both work. Contrived, so low.

### B17. The no-apps path leaves the load flag on. Reproduced (S14).

`store.ts:331` returns inside `try`, past the resets at `store.ts:343`.

Input: a load with an empty `apps` list.
Result: `loadingState` is true and a later delta is buffered, with no limit. After a role loss the socket closes with 4403, so few deltas should arrive. Low.

### Checked and not a bug

| Claim | Result |
|---|---|
| A clock-only tick makes a false gap | Refuted. `takeDelta` bumps only on change. Correction to the first report: such a tick is not always a `clock` message. It is a `delta` when `game` or `network` is set. Its version equals the client's, so no gap shows. |
| The toast can say "Approved" for a rejection | Refuted. `ReviewDecision` has four values and the chain covers them. |
| A state has no pipeline column | Refuted. S13: all 24 states are in `COLUMNS`. |
| Client role check differs from the server | Refuted while `grants` is set. Candidate 9 proved it for the loop form. |
| `SAFETY_HOLD` shows as closed | Latent only. See candidate 11. |
| `reviewPending` sort breaks on two items with no deadline | Refuted. `Infinity - Infinity` is `NaN`, and `sort` reads `NaN` as 0. |
| `reveal` could store a refused grant | Refuted. `POST /api/reveal` answers 200 only with a grant (`server.ts:558-578`). |
| `styles.css` or `index.html` holds logic | Refuted. See 1.5. Checked again with `grep`. |

## 5. Order of work, if this goes further

1. Fix B7 first. Candidates 1 and 15 are unsafe until each reconnect does a full load, because version and `seq` restart with the server.
2. Fix B3 and B1 with candidate 3. One load owns the buffer.
3. Fix B2, B11 and B18 with candidates 1 and 15, and `>` in the replay filter. Do not use the first form of candidate 1.
4. Fix B4 and B19 by moving the filter table into the predicate (candidate 8).
5. Add integration cases, not unit tests (`docs/tests-policy.md`). Each bug fix needs a case that fails before the fix. `run.ts` and `bugs2.ts` show the fake browser set-up that those cases need.

## 6. Verification

Skeptic pass, at a0ed7bc. No repository code changed. Machine load stayed low: one `lsc` at a time through the throttled wrapper, no `bun run sim`, no suite.

All paths are under `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/obs-state/`.

### Completeness

`git ls-files packages/observatory/web` gives the six slice files, plus `admin`, `apps`, `drawer`, `main`, `network`, `ops`, `panels`, `review` and `ui` (`.tsx`), which belong to other slices. No slice file was missed. Items that the first table missed were added: `getTick`, `GROUP_OF`, `REFUSED`, `REVIEW_SECONDS_CAP`, `UI_KEYS`. `APPLIES` in `drawer.tsx:21` is outside the slice but it is the data of candidate 8 and B19. `packages/observatory/test/` holds no test of this reducer logic. Only `held-photo-ui.test.tsx` imports `web/store.ts`.

### Runs

`store.copy.ts` is `web/store.ts` with imports stubbed. `diff` against the source shows only the import lines. `store.fixB2.ts` adds the first form of candidate 1 and `>` in the replay filter. `map.copy.ts` and `graph.copy.ts` are the source with imports stubbed. S17 and S18 use the real `packages/observatory/src/store.ts`.

| Command | Outcome |
|---|---|
| `bun run.ts` | S1 to S16 repeat. All first results match. S10 is rejected as a harness fault. |
| `bun token.ts '<url>'`, three URLs | B16 repeats. |
| `bun bugs2.ts` | S17 `[1,1,true]`; shipped `[2,2000]`; first candidate 1 `[1,1000]`. S18 `[1,2,2]` for both. S19 in order `INVITING,10`; third first `IN_REVIEW,9`. S20 `IN_REVIEW,5`. S21 `[true,true,true]` to `[false,false,true]`. S22 `0` then `1`. |
| `bun map.run.ts` | S23 markers `["ntwrk-a","slop-b"]`, removed `[false,false]`. Graph color equal for hold and ok on three lenses. |

### Trials

Command: `lsc check --backend=dafny <file>`, through the throttled wrapper. Result lines are Dafny's own.

| File | Outcome | Last line |
|---|---|---|
| `a1_sync_fixed.ts` | proved | `3 verified, 0 errors` |
| `a1_sync_shipped.ts` | failed, as wanted | `1 verified, 4 errors` |
| `a1_sync_report.ts` | failed: the first candidate 1 | `2 verified, 1 error` |
| `a2_feed_fixed.ts` | proved | `2 verified, 0 errors` |
| `a2_feed_shipped.ts` | failed, as wanted | `2 verified, 1 error` |
| `a3_load_fixed.ts` | proved | `3 verified, 0 errors` |
| `a3_load_shipped.ts` | failed, as wanted | `1 verified, 5 errors` |
| `a5_filter_fixed.ts` | proved | `3 verified, 0 errors` |
| `a5_filter_shipped.ts` | failed, as wanted | `1 verified, 1 error` |
| `a6_reveal_fixed.ts` | proved | `3 verified, 0 errors` |
| `a6_reveal_shipped.ts` | failed, as wanted | `1 verified, 2 errors` |
| `a8_can.ts` | proved | `1 verified, 0 errors` |
| `a9_marker_fixed.ts` | proved | `2 verified, 0 errors` |
| `a9_marker_shipped.ts` | failed, with no invariant, so S23 is the evidence | `1 verified, 1 error` |

First attempts: `a2_feed_fixed` failed on an `exists` invariant, and `.includes` fixed it. `a3` and `a5` failed to resolve helpers with no `//@ verify`. `a6` with arrays failed on `filter` membership, so the model became one member with two booleans.

### What changed from the first report

| Item | Change |
|---|---|
| Candidate 1 | Withdrawn and rewritten. `t2` and `t3` proved a wrong target: `apply` only at V+1 forbids legal same-version deltas. |
| Candidate 2 | Rejected. Its fix does not stop duplicates (B18). |
| Candidates 5, 6, 7, 12, 13 | Rejected as restating the code. |
| Candidates 3, 4, 8, 15 | Contracts rewritten so that the shipped logic fails them. |
| Candidate 9 | Failed before, proved now in loop form. |
| Candidate 14 | Not run before, proved now. |
| J1 invariants 2 and 4 | Corrected in section 2. |
| B3 | Its result was a harness fault. Replaced by S20. |
| B2, B5 | Reachability narrowed. |
| B6 | Effect widened by S21. |
| B8, B14 | Moved from reading to a run. |
| B15 | Code list corrected. |
| B18, B19 | New. |
| Count | 19 bugs, all reproduced, except the second part of B8 and the render in B6. |

Limits: all runs use fake globals, not a browser. No real LLM, Postgres or server process was used. Reachability notes for B2, B3 and B18 come from reading the send paths and were not measured.
