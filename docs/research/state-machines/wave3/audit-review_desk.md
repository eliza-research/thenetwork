# Audit: quint/review_desk.qnt coverage (wave 3)

Read: quint/review_desk.qnt (697 lines), quint/drift.json `review_desk`, docs/formal-coverage.md rows 255/346/351/359,
quint/FRONTEND.md, docs/results/2026-11-09-quint-drift.md (review_desk section), docs/research/lemmascript/frontend-observatory-staff.md
(slice report bugs 1-18, gaps G1-G6). Code read in full: packages/observatory/web/logic/review.ts, packages/observatory/web/review.tsx;
read in part: web/store.ts (notify, focus, setApp, reviewPending, decide), web/admin.tsx (useFetch, AppConfig), web/panels.tsx
(Inspector, OpportunityPanel), web/drawer.tsx, observatory/src/sources/service.ts (act, review), observatory/src/sources/real.ts:400-404,
observatory/src/scrub.ts, network/src/network.ts:1955-2200 (decide, reviewBlock, editBlock, approvalCheck, reroll, submit), 3615-3622 (advance), 3861-3872 (reexplain), transitions.ts reviewLate/afterReview.

Probe runs (quint 0.33.1): `--invariant=approveMatchesSeenPeople --max-samples=3000 --max-steps=20 --seed=11`: no violation;
`--max-samples=20000 --max-steps=30 --seed=29`: violated (G6 still reachable). scripts/quint-check.ts runs only safety, tests and witnesses, so this known-defect invariant is not run by CI at all.

## Suspected defects (new)

### D1 (P1) Edit drafts survive a re-roll of the same item; an approve then sends the old texts as an edit
- review.tsx:83-89 (commit clears drafts only when boundId changes or draftsId is ""), :129-133 (drafts loaded once from o.explanations), :107-113 (editsOf compares drafts with the CURRENT o texts), :139/:142 (withEdits = ctl0.draftsId === selId).
- network.ts:2128-2160 reroll keeps the id and calls reexplain (network.ts:3861-3871), which rewrites o.explanations for EVERY participant, the one who stays included.
- Trigger: reviewer A chooses item X [p1,p2] and presses `e` (drafts = v1 texts; nothing typed). Reviewer B re-rolls X, p2 -> p4. The push arrives: X keeps its id, so A's controller stays bound with draftsId X. A presses `a`. withEdits is true; editsOf finds drafts[p1] (v1 text, written for the pair with p2) != new o.explanations[p1], so the page sends decision "edit" with explanations {p1: v1 text}. editBlock (network.ts:2084-2098) passes (the text passed the guard for p1 before). p1 is told the reason they fit p2 and is introduced to p4. Same after A's own re-roll when its answer is lost (service_timeout) but applied: act() does not settle, the drafts stay.
- Not the same as slice bug 1 (drafts to another id) or G6 (no version on the wire): a G6 fix that sends the version the page rendered would still pass, because the page rendered v2 with v1 drafts in the editor.
- Fix (in scope, reproduced-bug class): bind the controller to (id, review.rerolls) - e.g. boundId = `${id}#${rerolls}` in the queue and the panel, so rebind clears mode and drafts and sets chosen=false after any re-roll; or keep the base texts in the drafts and send only fields that differ from the base, refusing when o.participants changed. Add an e2e case: open editor, re-roll from a second staff session, approve, assert no `edit`.

### D2 (P2) Two review controllers on one item: edits typed in the opportunity panel are dropped by a queue key press (and the reverse)
- review.tsx:245 select() calls store.focus(opportunity) -> panels.tsx:32 Inspector mounts OpportunityPanel -> panels.tsx:681,704 renders `<ReviewActions o={o} />` with its own useReviewCtl (review.tsx:154), chosen at mount (review.tsx:75).
- Trigger: `j` to X in the queue. In the panel click Edit, rewrite p1's text, click outside the textarea. Press `a`: the window handler (review.tsx:281) uses the queue controller, which has no drafts, so a plain approve goes out and the panel's edit is lost. The panel button says "Approve with edits"; the queue card says "Approve". Breaks slice rule I6 ("an approve that follows an edit sends the edit, or the reviewer is told that it does not") across controllers. The slice report (frontend-observatory-staff.md:148) noted the panel path only for bug 5 within one controller.
- Fix: one controller per item in the store (or hide the panel ReviewActions while the queue shows the same item).

### D3 (P2) The queue's mount default is a "chosen" card, so the first `a` after opening the Review tab approves a card nobody chose
- review.tsx:75 `chosen: initial !== ""`, :233 useReviewCtl(sel?.id). logic/review.ts:11-13 lists the choices (j, k, click, focus link, move after a decision); the mount default is not one.
- Trigger: items 1 and 2 waiting, drawer on Feed. Click the Review tab: ReviewQueue mounts with sel = pending[0] = 1, chosen = true. Press `a`: approve 1 is sent. The same card, reached because the selection moved by itself, needs two presses (bug 16 rule). The model hides this: init starts with an empty queue (review_desk.qnt:315), and remount sets the ghost `choice: init` (:507), so the mount default counts as a choice.
- Fix: useReviewCtl(initial) with chosen = (initial came from a focus link), else false.

### D4 (P2) A late answer chooses the auto-selected card, also after an app switch
- review.tsx:248-254 afterDecision: when the decided item has left `pending` (i < 0) it selects `sel`, the card the queue moved to by itself, and choose() marks it chosen. moveOnAfter allows it because that card is unchosen (logic/review.ts:151-157). The drawer queue is not keyed by app (drawer.tsx:56); store.setApp clears focus (store.ts:557-570).
- Trigger: in app A choose X, press `a`. Switch to app B before the answer. B loads; the queue rebinds to B's head card Y (chosen=false). X's answer arrives ok: afterDecision -> select(Y) -> chosen, focus Y. The next `a` approves Y in app B, a card the reviewer never chose. Same-app variant: X leaves (push) before its answer; the queue auto-selects Y; the answer chooses Y.
- Fix: afterDecision moves only when the controller is still bound to the decided id (drop the `!ctl.chosen` arm) or when the queue's app equals the app of the request; key the queue by app.

### D5 (P2, medium confidence) Edits round-trip the PII scrubber
- real.ts:402-403 scrubs objective and explanations for the console (reveal is off outside local dev, real.ts:177); review.tsx:132 loads the drafts from those masked texts; editsOf sends the whole masked string for every changed field.
- Trigger: an objective or explanation contains a pattern the console masks (street_address, url, spelled phone run, `insta: x` handle; scrub.ts:19-33). The reviewer fixes one word in that field and approves: the member receives "[address]"/"[link]" in place of the real text.
- Fix: send edits as diffs against unmasked text, or refuse an edit of a field that holds a mask label (editBlock: refuse `[address]` etc.).

### Known, still open (not new): item 18 of the slice report - page swappable (review.tsx:56) omits the seat-manager rule of network.ts:2131; REFUSED (store.ts:180) lacks "review_expired", so a refused late decision drops the review timer (B15 class).

## Model errors (the model does something the code does not)

1. Render assumption is false (review_desk.qnt:44-46): store.notify defers every render by a 30 ms setTimeout (store.ts:279-284), not a sync-lane flush. Pushes change the store at once; the queue renders up to 30 ms later; the key handler reads `live.current` from the last render (review.tsx:257-258, 270) and approveBlock reads the fresh store (review.tsx:102). The model merges push and render (`pushItem` calls render, :366-369). Effect: G6 also happens with no second reviewer delay - the DOM shows the old people while the store already holds the new ones. The G6 fix must take the version from the rendered `o`, not store.opps. Model fix: a `dirty` flag and a separate `renderStep` action; keys read `br` (last render), blockedOf reads `mirror`.
2. Drafts abstraction too strong (:47-49, :168, :276): "editsOf gives edits only when the drafts changed". Code compares with the current server text (review.tsx:107-113), so a server change makes unchanged drafts count as edits (D1). approveCarriesOwnDrafts (:603-605) and draftsBoundToItem (:596-599) bind drafts to the item id only, not the version. Model fix: Drafts = {from, ver, changed}; send "edit" when changed or ver != mirror version; add `editMatchesSeenVersion: r.kind=="edit" implies r.draftsBefore.ver == r.version` (it will be violated today).
3. Mount default counted as a choice (:499-508 `choice: init`; init :315 has an empty queue, so the first mount with items is never explored). firstPressOnlyChoosesTest (:641-643) passes only because items arrive after mount. Hides D3.
4. otherReviewerOf (:355-363) skips reviewBlock: it approves or re-rolls at or past the deadline, with matching off or with a minor. The code refuses all of these for every reviewer (network.ts:2059-2077). An item past its deadline can be revived by a model re-roll (deadline now+3), a state the code cannot reach. And serverApproveBeforeDeadline (:584-586) / approveMatchesSeenPeople (:610-612) filter `approvedVersion >= 0`, so they check only this page's approvals: the invariant is weaker than "an expired proposal is never sent late" for every approval. Fix: route otherReviewer through the same `accept` guard and drop the filter.
5. decisionOnlyToChosenItem's `r.id == r.sel` (:560) cannot fail: doPress is always called with o = b.sel (:440, :470). The other two conjuncts restate keyStep's proved ensures. It does not see the panel path (D2), whose requests have no queue `sel`.
6. Page and server share one PEOPLE map (:86-89, :373-374): no state where the server knows an age or a decline the page does not (network.ts:2071-2076 reads the snapshot age). Safe direction, but the model cannot show page/server disagreement (bug 9 class).
7. serverApplyReq approves whenever `accept` (:392-401). The code writes decision "approve" and then can invalidate and close with ok:false (approvalCheck: busy, held, opted out, blocked pair, gateReason; network.ts:2034-2046, 2109-2120). Not modelled: the "approve recorded but invalidated" state and its answer.
8. swaps = parts.length (:268); code swaps = swappable(o) (review.tsx:56) without the requester, and the server also drops the seat manager (network.ts:2131).
9. Header says "random run finds it" for approveMatchesSeenPeople with the standard bounds; at seed 11, 3000 samples, 20 steps it does not (20000/30 at seed 29 does).

## Model gaps (code the model leaves out)

| Gap | Code | Could it break an invariant? |
|---|---|---|
| Second controller in OpportunityPanel | panels.tsx:681,704; review.tsx:153-169 | Yes: approveCarriesOwnDrafts in the reviewer's sense (D2); decisionOnlyToReviewerChoice is not checked on that path at all |
| App switch with the queue mounted | store.ts:557-570; drawer.tsx:56 | Yes: decisionOnlyToReviewerChoice would need an app-aware ghost (D4) |
| Item version on the controller (re-roll of the bound item) | review.tsx:83-89, 237 | Yes (D1) |
| Deferred render (30 ms) | store.ts:279-284 | Yes: G6 widening; approveMatchesSeenPeople after a fix |
| Filters and member/neighborhood focus narrow `pending` | store.ts:823-829 | No new break; same as an item leaving, but feeds D4 |
| Read-only / no reviewer role (CAN_ACT is a constant) | review.tsx:163, 276; store.ts:843-845 | No; approveBlock "read_only" branch unexercised |
| Server refusals: note_required, nothing_to_edit, edit_leak, not_a_participant, cannot_swap, approvalCheck invalidation | network.ts:2013, 2062, 2084-2098, 2034-2046, 2132 | No for current invariants; needed for an I5 "refusal shown" invariant (bug 6) |
| Auto review mode approves the whole queue | network.ts:1958-1963, 2159 | No (covered by otherReviewer if that is fixed per error 4) |
| Decided view, popover, Enter, n, x keys | review.tsx:267-271, 287-289 | No |
| secondsSpent timer, REFUSED list | store.ts:848-866 | No (data only; B15) |
| Matching switch: matchingLocked/canChange, duplicate send after confirm (no in-flight guard), app-switch remount of AppConfig | admin.tsx:412-430 | No: confirmSendsAskedDirection still holds |
| PII scrubbing of texts loaded into drafts | real.ts:402-403 | Yes for a "edit equals reviewer's words" rule (D5) |

## Open carve-outs

1. approveMatchesSeenPeople (G6), drift.json review_desk.drift[0]: still violated. It is fixable now in scope: the "wire change" is in-repo only (observatory ControlCommand `review` in observatory/src/types.ts:635, service.ts:110-114 body, network service /review route, ConsentNetwork.decide opts), not the Eliza mirror contract. Send `rerolls` (already on ReviewInfo, types.ts:171; real.ts:725) as the seen version; reviewBlock refuses "review_changed" when o.review.rerolls?.length differs; take the version from the rendered `o` (error 1). Then move the invariant into safety. Until then add a `run` test that replays the violation, because quint:check never runs this invariant.
2. Drift ledger file set (drift.json review_desk.files) omits code the model claims to model: web/store.ts (decide, deciding, reviewPending, notify), web/panels.tsx (second ReviewActions), web/drawer.tsx (mount/unmount), network/src/transitions.ts (reviewLate), observatory/src/sources/service.ts (timeout = `lost`), observatory/src/sources/real.ts (explanations, rerolls). Their formal-coverage rows (lines 261, 339, 348, 358, 361) do not name review_desk. Changes there do not mark the model stale. Fix: add the files and rows.
3. quint/FRONTEND.md:37 still lists serverApproveBeforeDeadline as an expected violation ("reviewBlock has no deadline check"); it is fixed (network.ts:2067) and in safety. Also :46 "Backend models ... not written yet" is stale. Doc fix now.
4. Slice bugs left out by the header (:51): bug 6 (refusal hidden when the item closes) looks fixed in code (review.tsx:123-124, 158-162) but has no model invariant; bug 14 (Enter on a focused button) looks fixed (review.tsx:269). Both could get a small invariant; not urgent.
5. Item 18 (seat manager offered for swap) is unfixed: page has no seat data (ObsOpportunity has no seat). Fix: project a `swappable` list from the server.
