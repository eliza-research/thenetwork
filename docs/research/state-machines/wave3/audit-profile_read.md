# Audit: quint/profile_read.qnt coverage (2026-11-11)

Read: quint/profile_read.qnt (407 lines), quint/drift.json entry `profile_read` (no `drift` list), docs/formal-coverage.md rows 232-240/245/363,
docs/results/2026-11-09-quint-drift.md "profile_read" (verdict fixed_in_model), the code: packages/network/service/profile-read.ts,
profile-core.ts, profile-suggestion-review.ts, profile-suggestion-endpoint.ts, profile-suggestions.ts (all), service.ts route() 1084-1132,
inbound() 1155-1330, memberMessage/memberUnit 1420-1480, /internal/turn admission 2350-2381, platform/src/accounts.ts activeMembership 329-339,
platform/src/apps.ts keywordApp. No findings file exists for profile_read (only profile_learning.md).
Run: `bun run quint:check quint/profile_read.qnt` -> typecheck, test, safety, 10 witnesses ok (20 s).

## open_carveout

### C1 (P1) The drift ledger does not map the code that the model mirrors
quint/drift.json:352-357 maps profile_read only to profile-read.ts and profile-suggestion-review.ts. The model header (qnt:7-23) says
it mirrors profile-core.ts (readOnly, readDecision, sameOwner, suggestionOk, currentBatch), service.ts route()/memberUnit
(1092, 1443-1470), profile-suggestions.ts decide/view, profile-suggestion-endpoint.ts render. Their ledger rows do not name profile_read:
formal-coverage.md:232 (profile-core.ts: "see its shell"), :245 (service.ts), :239 (profile-suggestion-endpoint.ts -> profile_learning
only), :240 (profile-suggestions.ts -> profile_learning only), :363 (accounts.ts activeMembership). scripts/quint-drift.ts:26 builds the
file set only from rows that name the model. So a change to readDecision or currentBatch in profile-core.ts, or to the own check in
service.ts:1449-1456, never makes `bun run quint:drift` flag profile_read. In scope now (ledger + docs only): add profile_read to the
Quint column of those five rows (profile-core.ts: replace "see its shell" by "profile_read"), compare, `bun run quint:drift --stamp quint/profile_read.qnt`.

### C2 (P2) No known drift list, no knownOpen, no invariant kept out of safety
All 8 invariants are in `safety` (qnt:330-333). Nothing is carved out. But see E1: most invariants restate a guard, so "all in safety"
says little.

## model_error

### E1 (P1) The safety invariants restate guards or construction; most cannot fail
- inv_onlyOwnProfileShown (qnt:297): `profileOf` is set to `sender` by `answer` (qnt:162) whenever reply==RShow, so `profileOf == sender`
  is true by definition. The code shows `own.membership` (service.ts:1464), from activeMembership(rt.app, {e164, personId}) of the
  sender phone; the model should derive profileOf from the membership record of the unit's member, then check it equals the sender.
- inv_shownAppIsAskedApp (qnt:314): profileApp := route by construction (qnt:163).
- inv_renderOnlyCurrent, inv_decisionOnlyCurrentRevision, inv_noDecisionAfterExpiry (qnt:320-328): render/decide are guarded by
  currentBatch and revMatch (qnt:243, 263), and the log stores exactly those guard values (logOf, qnt:231). They fail only if a guard is
  deleted. They do not test the real property, which is the store recheck in a second transaction (see G1).
Proposal: split decide into parse (getPendingBatch + parseSuggestionReview, at time t1) and storeDecide (profile-suggestions.ts:263-322,
at t2, rechecks revision 277, expiry 273, owner via batch() 123-125); log the store's view. Add a mutation witness per invariant
(e.g. a `decideNoRecheck` action behind a flag) so each invariant is shown to be able to fail.

### E2 (P2) inv_otherProfileRefused is weaker than its rule
The rule says "a text that names another person's profile is refused". `own` is the syntactic flag ownSubject !== null
(profile-core.ts:46-55): any object that starts with "my ". "show my ex's profile" gives own=true, endsWithProfile=true,
appText "ex's", keywordApp undefined -> "ambiguous" (not refused). "show my friends profile" (no apostrophe) -> appText "friends" ->
keywordApp = friends -> readApp: shows the sender's own friends profile. No data leak (the content is always own.membership), but
the invariant only checks the flag, not the rule. Proposal: state the rule as "a reply shows only the sender's membership" (E1) and
document that `refused` is a syntactic outcome.

### E3 (P2) witness_noRejectAfterPreview does not force the order it names
qnt:351: `exists saved and revision > 2` is also reached by saved, saved (two rows) or saved then preview. Proposal: log a sequence
number and require a preview log before a saved log on the same batch.

### E4 (P2, harmless) Redundant guard
memberTexts guard `members.contains((memberOf, route))` (qnt:183) and ownOk `mem.contains((sender, route)) and memberOf == sender`
(qnt:152) overlap; ReadFacts are independent booleans the shell cannot all produce (e.g. endsWithProfile without namesProfile): an
over-approximation, safe.

## model_gap

### G1 (P1) The review is two transactions, not one atomic step
Code: reviewSuggestionMessage (profile-suggestion-review.ts:59-66) calls store.getPendingBatch (its own sql.begin,
profile-suggestions.ts:253-261), then parseSuggestionReview (currentBatch + token revision) outside any transaction, then store.decide
(a second sql.begin, 263-322). The endpoint calls d.now() several times (profile-suggestion-endpoint.ts:117, 123, 127). Concurrent
decides on one batch (two turns, or the Eliza RELAY retry with a different messageId) interleave between the two transactions.
The model's decide (qnt:250-270) checks and writes in one step. Also not modeled: several batches per owner (propose guard qnt:213
allows one), and the batch id in the token (parse checks match[2] === batch.id, review.ts:45; the endpoint takes batchId from the body).
Could break an invariant: yes if the store recheck were missing; with decide's `b.revision !== input.revision` (277) and the expiry
recheck (273) it holds. currentBatch's other conjuncts (count, distinct ids, row validity) are not rechecked in decide, but every
writer that changes rows bumps the revision (decide 297/318, disconnect 356, revoked cleanup 409, withdrawal 503) and the only status
change without a bump is expiry (view 162, expirePending 530), which decide's expiry check refuses. Model this to make that argument
checked.

### G2 (P2) Side B has no eligibility, STOP, ban, minor or source-consent check
decide requires `b.eligible` and `authorize` for an accept (profile-suggestions.ts:285-289) and member() (96-116) folds in
opted_out, age>=18 and lowest_age>=18, bans, suppression, phone hold and the consent ledger. A reject is allowed for an ineligible
member; getPendingBatch/preview render does not check eligibility at all (batch() 120-127 returns the row with `eligible`, view
ignores it). The model's decide allows an accept with no eligibility (more permissive, so no invariant can catch a missing check).
Proposal: add `eligible(person, app)` state (STOP, age lowered, ban), an invariant `inv_noAcceptWhenIneligible`, and decide whether
preview-after-STOP is allowed (D1). profile_learning.qnt has parts of this; the two models should agree on one definition.

### G3 (P2) The read path's own check is collapsed into two sets
Code own check = activeMembership (accounts.ts:329-339: phone not held and not stale (12-month recycled number), person matches,
not banned, canJoinApp(lowestAge), membership.state === "active" (not "onboarding" or "paused"), review === null, not suppressed,
consent ledger optedIn) AND own.membership.memberId === memberId AND the network projection's optedOut (service.ts:1449-1456).
memberId itself comes from the runtime address book rt.memberOf(ev.from) (service.ts:1194). The model has one `members` set and one
`optedOut` set, no START (optedOut only grows, qnt:197-202), no leave/removal/deletion, no onboarding state, no ban, no hold, no age.
These are three views (address book, platform membership, network projection) that can disagree (a stale address book after a
number moves to a new person). Adding them would not break an invariant today (each view is rechecked), but no invariant states
"banned / held / onboarding gets no profile". Proposal: one `canRead(person, app)` predicate with those facts, and
inv_bannedGetsNoProfile, inv_onboardingGetsNoProfile; a `recycle` action that moves a number to a new person while the address book
keeps the old member.

### G4 (P2) Paths before the member unit are not modeled
- service.ts:1092-1093: route() sends an explicit own app read to that app on the shared line even when the sender is not a member of
  it; then service.ts:1264 `if (!memberId && profileRead) return "handled"`: no reply, no join, no person. The model never makes a
  log for a non-member (guard qnt:183), so the rule at service.ts:1263 ("a read request is never an instruction to join, opt in or
  create a person") has no invariant. Proposal: a `nonMemberText` action and inv_readNeverJoins (members unchanged by a read).
- service.ts:1204-1207 STOP, 1213-1227 the held-number branch, 1271-1275 the banned branch run first; a read on a held or banned
  number gets HELP-only behaviour.
- service.ts:1303 stopHint: an opted-out reader gets the compliance "stopped" hint (once per 30 days) before memberMessage; the model
  calls this RSilent. Not a profile, so inv_optedOutGetsNoProfile is still true in spirit, but the model should name the reply.
- service.ts:1233-1234: a read skips photo consent and photo intake (`!profileRead`): on the legacy webhook a photo sent with
  "show my profile" is not taken. Signed turns carry mediaUrls: [] (service.ts:2364), so only the webhook path.
- service.ts:1425: a read does not count as a thread reply for notify. Not modeled.

### G5 (P2) Retries, crash points and concurrency on side A
memberUnit's duplicate check (service.ts:1434) and the signed turn's "Unresolved turn effects" throw (2365); the reply is collected,
then sent by the gateway; a STOP that commits between the own check and the gateway send is stopped only by the gateway send-time
fence (outside the repo). Model: reads is a set, no retry, no concurrent STOP. Adding a concurrent STOP between check and delivery
would break a delivery-time version of inv_optedOutGetsNoProfile unless the gateway fence is modeled (turn_consent.qnt owns it).

### G6 (P2) Other store actions on side B
Not modeled: deleteBatch (325-340), disconnect (343-359), applyRevokedConnection (362-434), applyOwnerWithdrawal (437-520),
expirePending (523-533), priorReview replay (142-158), the collect replay (220-235). Each bumps the revision (or deletes) so stale
tokens are refused. priorReview returns a stored "saved" result even after expiry or deletion (151-152); if the model logged a replay
as a decision, inv_noDecisionAfterExpiry would fail, but the replay applies nothing. Proposal: model replay as a separate log kind
that the invariants exclude, and a delete action (hasBatch false) so a token for a deleted batch is refused.

### G7 (P2) Copy-level outcomes
savedProfileText refuses a text over 1,600 characters (profile-read.ts:84); the ambiguous and refused copy; the "This line is for X"
copy. Outside the model by header (qnt:49); not safety.

## suspected_defect

### D1 (P2, PLAUSIBLE) A suggestion preview is rendered for a member who is no longer eligible
profile-suggestions.ts:253-261 getPendingBatch and profile-suggestion-endpoint.ts:129-132 (preview action) never check
`eligible` (opted out, age lowered under 18, banned, suppressed, held). The turn gate (service.ts:2373, numberAllowed) is applied once,
when the open turn is stored; the endpoint only reads the stored turn (endpoint.ts:74-76). Trigger: member M has a pending batch B
(slop). M sends a text, turn T1 is `open`. M then texts STOP (T2, committed, opted_out). Eliza, still acting on T1, calls
POST /internal/profile-suggestions/preview {messageId of T1, batchId B}. resolve() passes (T1 status done, outcome open; person and
member exist), getPendingBatch returns view(B), renderSuggestionReview returns the review text with the private suggestion values,
and the endpoint returns 200. The same happens after a stated age under 18 lowers p.lowest_age. The read path refuses the
same case (service.ts:1452-1456). Mitigation: the gateway send-time fence should stop the SMS after STOP; the data still crosses the
internal wire. Fix: in getPendingBatch (or the preview action) return null when `!b.eligible`, keep reject/delete allowed; add an
integration case in packages/network/test/profile-suggestions.integration.test.ts (STOP after the open turn, then preview -> denied).

### D2 (P2) A decide preview can return the batch with reviewText null
profile-suggestion-endpoint.ts:127 returns `{...result, reviewText: renderSuggestionReview(result.batch, owner, d.now())}` without
checking for null (the collect path at 111-113 and the preview path at 130-131 do check). Trigger: batch expiresAt = T. At T-1 ms
the member sends "edit <id>.1 1: new words". decide commits (fence now < T, checkAuthority passes, profile-suggestions.ts:300). The
endpoint then calls d.now() >= T: currentBatch is false, render returns null, and the endpoint answers 200
{kind:"preview", batch:{...suggestion values...}, reviewText:null}, which breaks the SuggestionReviewResponse type
(endpoint.ts:14-17, reviewText: string) and the rule "no text when currentBatch is false" (the batch object is still sent). The same
for a priorReview preview replay (117, 123-127). Fix: treat a null render as denied (403), as the other two paths do.

No defect found on side A: the shown content is always own.membership of the sender's phone (service.ts:1449-1464), and
readDecision's contracts (profile-core.ts:69-75) match the model's pure def.
