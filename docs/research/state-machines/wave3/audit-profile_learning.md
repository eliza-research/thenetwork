# Audit: quint/profile_learning.qnt coverage (wave 3)

Read-only audit. Model lines are on branch `claude/quint-state-machines` (HEAD). Code lines are on
`claude/formal-main` (the newest code; the drift session moved the model's location comments to it). The
nine fix commits of the findings file (SD-170, 175, 240, 455, 458, 462, 463, 464, Q-profile_learning-1) are
on both branches. Abbreviations: PS profile-suggestions.ts, EP profile-suggestion-endpoint.ts, RV
profile-suggestion-review.ts, PF profile-review-factory.ts, CO cloud-profile-review-owner.ts, LC
learning-consent-context-endpoint.ts, SV service.ts, AC platform/src/accounts.ts, PG platform/src/pg-store.ts.

## 0. Status of the model on this branch

The drift review (docs/results/2026-11-09-quint-drift.md on claude/formal-main, section profile_learning,
verdict fixed_in_model, no open drift items) changed the model on claude/formal-main only. HEAD still has
these drifts: V2 receipt keyed by op (qnt:550, code keys by withdrawalId, PS:468-479), no one-command-per-
review-turn (`cmdUsed`), leaveMembership keeps V1 receipts (0052 trigger deletes them on 'removed'), and
leaveForget/deleteAll keep collect and V2 receipts (RT:592-595 and PG:369-371 reset action_receipts).
Merge the formal-main model; do not fix again here.

## 1. model_error (the model does something the code does not, or an invariant cannot fail)

1. INV-17 `inv_retryKeepsResult` is vacuous. In `retryLast` (qnt:441-446) `ok` and `stable` are the same
   expression, so `stable and not(ok)` is always false. The invariant cannot fail whatever the code does.
   The model also lets a retry succeed at any age. The code's retry runs `priorReview` -> `owned()` ->
   `authorizeOwner` -> CO, which refuses a parent turn 5 min or older (CO:52) and needs a live Cloud owner
   proof (CO:57-62). Fix: make `ok` model priorReview (needs `cmdFresh` with the parent age, a Cloud owner
   oracle, the turn row not scrubbed), keep `stable` as the rule's condition (owner exists, stored result
   current, retry inside the gateway retry window).
2. INV-7 `inv_noAcceptAfterExpiry` is vacuous. The accept branch is in the `else` of `nowN >= bt.expiresAt`
   (qnt:365), and it sets `acceptedAfterExpiry or nowN >= bt.expiresAt` (qnt:384), which is false there.
   The code's real guard is the re-check after the Cloud source calls: `checkAuthority(b)` at PS:290 and
   PS:305 (batch expiry against the fence clock). The atomic `decide` never lets time pass between the
   expiry check (PS:273) and the facet insert (PS:309), so that guard is never exercised.
3. INV-8 `inv_nothingSavedIsTrue` is vacuous. `collectBegin` gives a Gmail row `obs = nowN - 1` always
   (qnt:250-251), so `anyFuture` (qnt:294) is always false, and the render is in the same step as the commit.
   The real way the reply lies is a render after the commit at a later time (EP:111-113, section 4 D1).
4. INV-20 `inv_noConsentProofAfterStop` is vacuous: `consentContext` has the guard `not(ledgerStop)` (qnt:216)
   and then sets `consentProofWhileStopped or ledgerStop` (qnt:218). LC reads the ledger twice with an async
   sign between (LC:81, LC:91-94); a STOP after the second read still gets a proof. The useful property is
   on the effect (no source data after STOP, INV-6), which exists; drop INV-20 or split LC.
5. INV-16 `inv_oneSourceCallPerScope` holds by the guard of `collectSourceCall` (qnt:262 vs qnt:748). It is a
   restatement of the fix, not a check of it. The useful property is the SD-455 consequence: a batch of N
   rows with one scope commits inside one SRC_TTL.
6. INV-4/5/6 (`inv_minorNeverAdds`, `inv_bannedOrHeldNeverAdds`, `inv_noAddAfterStop`) hold because
   `collectCommit` reads `eligible` and inserts in one step (qnt:280). The code has a read-then-write window
   (PS:212 member() to the insert at PS:241-246, and PS:289 to PS:309 in decide). The findings file names this
   window. The invariants are as strong as that atomicity assumption.
7. `decide` is one action, so the Q-profile_learning-1 fix for decide (PS:289) is not checked. The findings
   file says "the model keeps decide atomic, so it shows only the collect case".
8. `sourceProof` (qnt:143) ignores the proof time rules. The code checks `proofWindowOk(issuedAt, expiresAt,
   now, 5000)` with Cloud `issuedAt` and Network `now` (profile-review-source.ts:68, proof-window.ts:10). Owner,
   V1, V2 and LC proofs do the same with 30 s. With SKEW = 2 and SRC_TTL = 2 in the model, a Network clock 2
   ticks ahead would make every source proof dead in the code, but not in the model.
9. `start` needs `leaveStage == "none"` (qnt:334). The code allows START between the leave consent event and
   the forget; then `leave` skips the forget (AC:478 `optedIn` check). The model cannot reach "leave consent,
   START, member stays".

## 2. model_gap (left out; would adding it break an invariant?)

1. Locks held during Cloud calls by decide, delete, priorReview, getPendingBatch, V1 and V2. `owned()` calls
   `authorizeOwner` (a Cloud round trip, CO:57, or the revoked/withdrawal resolver, SV:2476-2511) under the
   person and member locks (PS:86, PS:104). V1 and V2 call `owned()` up to three times (PS:373, 389, 429;
   447, 476, 515). Only `col.active` is `locked` (qnt:142). Adding these widens SD-112 (inv_stopNotBlockedByCloud
   fails in more traces; it is already open). It also changes when leaveForget, ageDrop and stopProjection can
   run.
2. Proof timers and the route window. Not modelled: owner proof 30 s (profile-review-owner.ts:55), V1/V2 proof
   30 s and the endpoint fences (DE:58, WE:55), LC proof min(30 s, parent, admitUntil) (LC:84), collection
   deadline 24 h (learning-collection-command.ts:68), admitUntil (PF:35, SV:2468). They only deny (fail closed).
   For V1/V2 a denial means the cleanup is not applied, so retain=false facts stay until Cloud retries; the
   SD-172 invariants are conditioned on v1Done/v2Done and would not show it.
3. Render after the commit as its own step with time between (EP:111-113). Adding it makes INV-8 fail (D1).
4. Delete everything is merged into one step. Code: AC:484-496 runs `onForget` per membership (one runtime
   transaction each) and then `store.deleteAll` (PG:355-397). A crash between them leaves memberships live,
   the person not deleted and the V1 connection receipts (Cloud user, org, chat, connection ids) in place,
   because runtime forget (RT:588-625) deletes batches but not receipts. INV-14 is conditioned on
   `membership == "deleted"`, so it would not fail; a rule "forgotten implies no receipts" would.
5. The inbound purge (SV:603 -> inbox.ts:249-252) scrubs action_receipts after 7 days, so the collect, decide
   and V2 receipts are not permanent as PS:217-218 says. Replay is still stopped by the 5 min parent and 24 h
   deadline. A new turn can reuse an erased batch UUID after 7 days (the PS:238 scan finds nothing); INV-3 per
   batch id would fail if the model let a later turn name an old id. Low.
6. The T1/T2 split of reviewSuggestionMessage (RV:61-65) and the preview action (EP:129-132): both write the
   expiry (PS:161-163). Modelled only as a stale-token choice. No invariant at risk.
7. Eligibility inputs folded into `banned`, `held`, `minor`: suppression (PS:99, no lock, like a ban), membership
   `review` (PS:97, locked), `account_status` (locked), the `onboarding` state (PS:97; `stopped()` pauses only
   'active', SV:896, the ledger read covers it), several phone identities (LC:72-73 refuses more than one).
8. Concurrent identical retries (two in-flight copies of one decide). Serialized by the person lock in
   priorReview (PS:145 -> PS:86). Not modelled; no invariant at risk.
9. Plan invariants that the model does not have: `proposedNotEvidence` (snapshot.ts:16-17 keeps
   `source-suggestion:%` facts out of matcher input; a ghost "matcher input" set would make it checkable) and
   `ownedBindsMember` (SD-174; the schema blocks two member rows).

## 3. open_carveout

| Item | In scope now? | How |
|---|---|---|
| SD-112, inv_stopNotBlockedByCloud | yes, as a STOP/security fix (PRD 40.3, 8 s turn budget); feature is off in production | Key the factory's proof entry by a request context, not by `tx` (PF:32, PF:67-73); do the owner and source calls before `sql.begin`; then one short locked transaction re-reads `member()`, checks `now < min(ownerUntil, sourceUntil)`, and writes. Must be done before closing the small read-then-write window below, because locking ban/hold/STOP on the person row would make STOP wait on Cloud. |
| SD-172 (inv_cutoffRespected, inv_retainFalseGone, inv_deleteErases) | yes, without a wire change | Store the earliest source proof `issuedAt` (Cloud clock) on the batch (new migration, next free number) and have V1/V2 compare it with `revokedAt` / `cutoffAt` (PS:395, 418, 486, 511). Same clock on both sides. `SuggestionAuthorization` is internal, not in the mirror. |
| SD-242, inv_v2NotDeniedBySkew | needs maintainer scope (register says refuted) | The proof already binds channel, messageId and commandSha256; replace `arrived_at > cutoffAt` (PS:459) with `arrived_at > cutoffAt + SVC_MAX_SKEW`. |
| SD-376, inv_terminalRowsPurged | no: founder retention window | - |
| SD-459 | no: intended deferral | - |
| Read-then-write window in collectCommit/decide (findings "remaining small window") | after SD-112 | Make the insert conditional on the eligibility predicate in one statement, or take the person lock in ban-by-phone, hold, suppression and addConsent once Cloud calls are out of the lock. |
| Not reproduced or refuted: SD-171, 173, 174, 241, 243, 386, 456, 457, 460, 461, 465 | no | No module state; register refuted them. |

## 4. suspected_defect (new)

D1. Collect reply "Nothing new was saved" after a committed batch (expiry between commit and render).
PS:213 and PS:248 check `expires_at > fence.now()` inside the transaction; EP:111 renders after the commit
with a new `d.now()`, and `currentBatch` needs `now < expiresAt` (profile-core.ts:166). Trigger: Cloud sends a
proposal with `expiresAt` about 1 s after now (allowed: the source proof needs only
`pendingExpiresAt > now`, PF:91); the commit passes; the render runs at or after `expiresAt`; EP:113 answers
"I couldn't collect those suggestions. Nothing new was saved." The batch and its pending source text stay
until the next purge tick (SV:599). Same reply defect as SD-240, other cause. Fix: render inside the
transaction, or answer from the commit result.

D2. Proof windows compare Cloud `issuedAt` with the Network clock without skew. `proofWindowOk` needs
`issuedAt <= now` (proof-window.ts:10) where `now` is the Network time after the response
(profile-review-proof-transport.ts:31-35). Used for owner (profile-review-owner.ts:55), source (:68), V1
(profile-review-disconnect.ts:54) and V2 (profile-review-withdrawal.ts:49) proofs, and again in the V1/V2
fences (DE:58 `now >= proof.issuedAt`). Trigger: Cloud clock 2 s ahead of the Network clock, round trip
200 ms: every proof has `issuedAt > now` and is refused. Collect and accept are refused (fail closed), and
every V1 disconnect/delete and V2 withdraw/delete cleanup is refused with `cleanup_denied`, so retain=false
facts and pending Google text stay. A Network clock more than 5 s ahead refuses every source proof. The
svc-auth envelope allows 60 s. Same clock-authority family as SD-172, different site.
