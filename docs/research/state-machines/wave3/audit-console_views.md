# Audit: quint/console_views.qnt coverage

Hand-written, 2026-11-11. Read-only audit. Branch claude/quint-state-machines.

Inputs read: quint/console_views.qnt (566 lines, all), its quint/drift.json entry (files only, no
drift list), docs/formal-coverage.md rows 347-362, docs/results/2026-11-09-quint-drift.md
"console_views", docs/research/lemmascript/frontend-observatory-views.md (journeys J1-J11, bugs
B1-B16), docs/results/2026-11-08-lemmascript-frontend.md. Code read in full:
packages/observatory/web/logic/views.ts, panels.tsx, main.tsx (Search, ProposeTray, AuthPrompt),
drawer.tsx (Drawer, tabCaps, shownTab), apps.tsx, ui.tsx (dur, Disclosure), and the store.ts parts
that drive them (notify, api, fetch, setToken, load, applyFull, can, setApp, setMode, togglePick).

Check run: `bun run quint:check quint/console_views.qnt`: typecheck, test, safety and 10 witnesses
ok (33 s). `bun run quint:drift` does not list console_views.

Probe (scratch copy, not in the repo): `hasData implies shown.epoch == epoch` is VIOLATED at seed 7
(15 steps). After a dependency change, the data from the old epoch stays on screen until a new read
lands. This is what the code does (panels.tsx:54 does not clear `d`), and no invariant states a rule
for it. See finding G4 and D2.

## 1. Model errors (the model does something that the code does not do)

E1. Fetch errors are modeled as "an answer that never comes" (header line 41, action `readLost`).
The code does not do that. `store.fetch` (store.ts:323-332) catches every error and returns a
`Fetched` with `status` 0, 401 or 403 and no `data`. The `.then` at panels.tsx:49 then runs
`readLand`: the failed read closes every older ticket, and `setD(x)` puts a no-data value on the
screen. MemberPanel then shows the error (panels.tsx:307), and AppSection and SlopPanel unmount
(photos go). In the model, `hasData` can go false only through `authChange`, and a lost read never
moves `gate.closed`. Only `load()` rejections (none on these paths) match `readLost`. Adding a
"landed with no data" answer cannot break an invariant (it only hides more), but witnesses and
`lastLand` change. Fix: add `readFail` = `readLand` + `hasData' = false` + photos reset; keep
`readLost` only for a hung fetch.

E2. The atomic render assumption (header lines 34-38) is false for this store. `store.notify()`
(store.ts:279-285) coalesces changes and renders after a 30 ms `setTimeout` (longer in a throttled
tab), not on the sync lane. The store fields change at once; the render and the SlopPanel effect come
later. Between them, a click and a fetch resolution are separate events:
 - ProposeTray `submit` (main.tsx:428-429) sends the `picks` of the last render and does not call
   `canPropose` again. A pick that the store just marked minor is sent. The game server refuses it
   (src/sources/game.ts:768-769), so no minor is introduced, but `canPropose_noMinor` ("a proposal
   never includes a minor") is stronger than the client. With a "notify pending" state, the
   invariant fails.
 - The gallery stays in the DOM up to 30 ms (or one throttled timer) after the store marks the
   person a minor. `photoNeverMinor` is evaluated on what would render, not on what is on screen.
Fix: model `notifyPending` (store changed, not rendered); restate `canPropose_noMinor` as "the tray
never enables a send for a pick that was a minor at the last render", and keep the server refusal
as the stated guard. Or make `submit` call `canPropose` on the live store (a code change).

E3. "Search uses the same three functions as useLive; this model has one read gate" (header lines
42-43). Search uses readStart/readLand/readCancel, but it cancels only on a query change or close
(main.tsx:170-171). It has no authEpoch branch and no mode or app cancel. The claim hides a real
defect (D1).

E4. One read gate stands for four. The photo rule does not come from the member detail read. It
comes from AppSection's own `useLive` (panels.tsx:568, `/api/member/:id/app`), which mounts only
after MemberPanel's `res` lands (panels.tsx:307, 313) and starts from a fresh `readNew()` on each
mount. Its deps are `[id, mode, app, grant?.until]` (no `!!s.truth`); MemberPanel's are
`[id, mode, !!s.truth, grant?.until]` (panels.tsx:231); the timeline has a third gate (232). The
header says "The rule comes from the last detail read that landed". The abstraction is sound for the
invariants (each gate is monotone and any of them unmounting hides photos), but it is not
documented, and a drift comparison cannot check the AppSection mount order.

E5. `readAnswer` lets the server answer one read more than once (`again`). A promise resolves once;
`.then` runs once (panels.tsx:49). Harmless over-approximation; document it or drop it.

E6. Invariants that cannot fail on shell drift. `photoNeverMinor`, `effectiveTabVisible`,
`readyOnlyInGame`, `yesCountsBound` and `readGateOk` are state-free restatements of the model's own
pure defs (`view` is `photoView(curGate)`, `shownTab` is `effectiveTab(want, caps)`, `ready` is
`canPropose(...)`, `gate.last <= MAX_TICKET` is a guard). They re-check the LemmaScript contracts
on the mirror. `canPropose_noMinor` compares `bad` and `known`, both built from the same `members`
in the same state, so it is the canPropose contract again. They would fail only if the mirror def
were wrong; a shell that stops calling the core (for example a gallery JSX test of `photos &&` only,
the B1 shape) is invisible because `view` is not computed from the shell. Only `photoTrail`,
`shownRise` and `readCancel_noLand` depend on the order of actions. Fix: model the rendered
condition separately from the core (`galleryRendered = view == Gallery and photos.loaded`, as at
panels.tsx:610) and the tray send separately from `ready` (E2).

E7. `photoTrail` restarts at the photo answer (`photoAnswer`, line 348-350: "A fresh load starts a
new trail"). So a request sent while allowed, then refused (minor flag), then allowed again, shows
the late answer. The code does the same (panels.tsx:592-594 has no ticket). It is allowed by the
rule, because the server checks at serve time (src/server.ts:545-549), but the invariant says nothing
about the request. Document it, or give photo requests a ticket like reads.

E8. The minor flag is `int -> bool`, so "known, age withheld" cannot be expressed. In the code,
`countsMember` drops `minor` and `trust` for the counts view (src/shape.ts:43-46,
privacy-core.ts:61). Then `!m || m.minor` (panels.tsx:589) is `undefined` (falsy: adult) and
`known` (main.tsx:426) maps the pick to `undefined`, which `canPropose` passes (`=== true` test,
views.ts:305). The fail-closed rule ("unknown counts as minor") is broken for a withheld field.
Reachable only while the client holds counts-shaped members and `can("safety")` or `canSim()` is
true: store.ts:359 sets `me` (new roles) before `/api/state` lands and `applyFull` replaces the
members (store.ts:368-373). The server rule still gates photos and proposals. Fix: model a third
value, and make the shell map `m.minor !== false` to minor.

## 2. Model gaps (code paths the model leaves out)

G1. Photo answer and AppSection unmount by a failed or 403 AppSection read (panels.tsx:569-570:
`!p || "none" in p` returns null). Only `authChange` unmounts in the model. Safe direction.

G2. The key-change timer (panels.tsx:55-60): a pending timer state, cleared by every dep change and
by unmount (cleanup at 54). The model starts the read at once. The timer `run` is the closure of the
render that set it (stale `load`), safe today because every value it captures is a dep. Safe.

G3. The 30 ms notify window (E2). Can break `canPropose_noMinor` and the on-screen form of
`photoNeverMinor`.

G4. Old data after a dependency change. `depChange` keeps `hasData`, as the code does: panels.tsx:54
clears `d` only for authEpoch (53). For the `grant?.until` dep (reveal ended or expired,
panels.tsx:229-232, 565-568) the revealed names and the member's own words stay on screen until the
new read lands, with no fetch timeout. No invariant covers it (probe above). Adding a "reveal ended"
dep with `hasData' = false` would match the authEpoch rule; see D2.

G5. Duplicate proposals. `propose` clears picks in the same step. The code clears picks only after
the server answers ok (main.tsx:430), and the button has no busy state (main.tsx:451). Two clicks
send two proposals with the same picks and spend two sparks (game.ts:772-774). See D3.

G6. Mode change from a full reload. `load()` sets `this.mode` from `/api/mode` (store.ts:360) without
`setMode`, so focus stays (applyFull keeps a focus that exists), `can("safety")` changes (role per
mode, store.ts:582-586) and `s.mode` is a dep, in one render. The model has `roleChange` and
`depChange` as separate steps; the merged step is reachable from them in either order, so no
invariant changes.

G7. apps.tsx is mapped to console_views in the ledger (drift.json) and in formal-coverage.md:347, but
the model has nothing of it: AllApps polling (apps.tsx:44-50), PersonView (107-148), AppPanel
reason gate (150-185), CrossAppButton (188-198). ui.tsx (row 362) contributes only `durParts`,
which the header puts outside the model. The mapping forces a restamp on every apps.tsx change with
nothing to compare. Either model the person view (with the authEpoch rule of D1) or map apps.tsx to
console_privacy only.

G8. Esc ladder (main.tsx:24-31, J2), focus history (J3) and the reveal form (J4) are not in this
model. J2 is proved in LemmaScript; J3 is store.ts (observatory_sync). J4 has no Quint model; its
ending is the G4 gap.

G9. `capsChange` covers role, mode and queue changes, and `store.ts:501` (mode real: game -> feed)
is a write to `want` that the model has as `pickTab`. `store.ts:769` reads `ui.drawer === "safety"`
(the saved tab, the B4 shape); it is correct only because `tabVisible("safety")` is always true. Not
modeled; would break `effectiveTabVisible`'s spirit if Safety ever gets a cap.

## 3. Open carve-outs

No invariant is kept out of `safety`, and drift.json has no drift list for this model. Open items:

C1. Slice bugs out of scope, still in the code: B5 (analysts read 0 holds: panels.tsx:152,
drawer.tsx:316-328 count `trust`, which countsMember drops), B6 (drawer.tsx:389 ignores the borough
filter), B12 (no ErrorBoundary in packages/observatory/web), B16 (main.tsx:36-43 Space on a focused
button toggles play). In scope only as a broken flow (AGENTS.md: no UI changes); B5 needs a server
signal ("withheld") and a case in packages/observatory/test. Not model items.

C2. The server gates are an environment (header line 39-40). The photo rule and the propose refusal
are modeled as free choices. They live in staff_console (photos) and the game source; no
cross-model link states that the client sends only what the server refuses safely.

## 4. Suspected defects (new)

D1 (P1). Conversation search results outlive a credential change. Search (main.tsx:165-190) keeps
`conv` and its in-flight read across `store.authEpoch`, mode and app changes. Trigger: safety staff A
types "ab", Shift+Enter; hits show. A's token is replaced (AuthPrompt `setToken`, store.ts:334-341,
authEpoch++), or a 401 shows the prompt and B (a reviewer without safety) signs in. `s.ui.query`
keeps "ab" (it is not cleared), and `.search-pop` renders whenever `conv` is set and q has 2 chars
(main.tsx:207; styles.css:70 has no focus rule). B sees A's safety-only, audited conversation hits.
Variant: the search is in flight when the token changes; `readLand` shows it (query unchanged) under
B. useLive clears its data on authEpoch for this reason (panels.tsx:51-53); Search does not. Fix:
`useEffect(() => closeConv(), [store.authEpoch, s.app, s.mode])`, plus a conversation-search
integration case in packages/observatory/test/conversation-search-ui.test.tsx that fails first. Model:
give Search its own gate with an `authChange` that closes it, and add the invariant "shown search
hits were read under the current authEpoch".
Same class, P2: apps.tsx PersonView (110-115, deps `[id]`) and AppPanel (`panel` state, 153-158)
keep the cross-app summary and opened app panels after a credential change to staff without
cross_app_safety.

D2 (P2). Revealed member data stays after the reveal ends, until a new read lands. Trigger: safety
reveals member X (15 min); the member panel shows names and X's own words. Click End
(`unreveal`, store.ts:614) or let it expire: `grant?.until` changes, panels.tsx:54 cancels and
starts a read, but `d` (and the timeline `tl`) still hold the revealed view. If the read is slow or
hangs (no fetch timeout), it stays. The research report called expiry "not a practical bug" because
of 500 ms pushes; that covers re-render, not this clear. Fix: treat a drop of `grant` like authEpoch
(clear `d`), and the invariant `hasData implies shown.epoch == epoch or not(revealEndedSince)`.

D3 (P2, game only). Double click on Propose sends two proposals. Trigger: game mode, 2 adult picks,
2 sparks; click Propose twice before the answer. `submit` (main.tsx:428-430) has no in-flight guard,
picks clear only on the answer, and the server takes a spark per call (game.ts:772-774). Two
opportunities with the same people enter review. Fix: a busy flag, or clear picks before the await.

D4 (P2). Client fail-open on a withheld `minor` field (E8). The server re-checks, so no minor is
contacted or shown; the client double check is weaker than its LemmaScript claim.
