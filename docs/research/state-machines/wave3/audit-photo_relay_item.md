# Audit: quint/photo_relay_item.qnt

Read: quint/photo_relay_item.qnt (318 lines), quint/drift.json (entry photo_relay_item: no "drift" list),
docs/formal-coverage.md:379-380 (and :303 for 0037), docs/results/2026-11-09-quint-drift.md:256-265,
docs/research/quint-findings/relay.md (photo rows), SD-320/321/374/375/385 in docs/research/2026-11-07-state-machines.md,
packages/platform/src/photo-relay.ts (all 277 lines), photo-relay-core.ts (all 142 lines),
migration 0037_photo_relay.sql, and the callers: service.ts:395-445, 2412-2456, 2595-2622, 2735-2780;
relay-endpoint.ts:225-262; runtime.ts:292-301; network/src/relay.ts:189-200, 369-385.
No separate findings file exists for this model (docs/research/quint-findings/ has none); relay.md covers the photo item inside relay.qnt.

## Mutation probes (copies in scratchpad/wave3/probe-pri/, `quint run --invariant safety --max-steps 16 --max-samples 4000`)
base: safety holds, witness_noFetch violated (fetch is reached).
| mutant | change | safety |
|---|---|---|
| m1 | fetch without current(pri) | no violation |
| m2 | issue without current(pri) | no violation |
| m3 | claim without current(pri) | no violation |
| m4 | review safe with cur = true | no violation |
| m5 | photoSelectGate without noticeVersion == policyVersion | no violation |
| m6 | m1+m2+m3+m4 (no current() anywhere) | no violation |
| m7 | revoke is a no-op | no violation |
| m8 | unsafe review of an approved item changes nothing | no violation |
| m9 | photoFetchable without state == "approved" | no violation (masked by current) |
| m10 | photoMayIssue without the intent binding | no violation |
| m11 | photoDeliveryDeadline recomputes on every issue | no violation |

So `safety` protects only: consent flag at select, a safe review before approved, the edge set, deadline <= item expiry,
fetch before the deadline, and one action id. STOP/block/match end, policy change, photo deletion, sender revoke,
unsafe revoke, the intent binding and the fixed deadline have no invariant.

## model_error
1. P1 No invariant needs the item to be current at fetch (m1, m2, m3, m6). photo_relay_item.qnt:183 current(pri) can be deleted and every check passes. The rule (CLAUDE.md founder 9, STOP, blocks; photo-relay.ts:229) is not encoded. Proposal: ghost `fetchedNotCurrent = g.fetchedNotCurrent or not(pair) or pri.noticeVersion != policyVersion or pri.state == "revoked"` written in fetch; invariant `fetchOnlyWhileCurrent`. Same for issue and claim (`issuedNotCurrent`, `claimedNotCurrent`).
2. P1 Sender revoke and an unsafe review are not protected (m7, m8). Proposal: ghost `revokedEver` (set in revoke and when review yields "revoked"/"rejected"), invariants `revokeFinal = not(g.revokedEver) or pri.state == "revoked" or pri.state == "rejected"` and `noFetchAfterRevoke`. Add a trace: select, safe, claim, issue, revoke, fetch(...).fail().
3. P1 fetchOnlyWithConsent is weaker than its rule ("consent to the notice that is in force", qnt:232-236). It reads only pri.consent, which selectPhoto can set only to true (qnt:122 gate), so it fails only if photoSelectGate drops `consent`. It never reads the notice version at fetch; m5 plus m1 passes. Proposal: record `pri.noticeVersion == policyVersion` at fetch in the ghost.
4. P2 The core ensures of photoMayIssue (`hasIntent ==> boundIntent === intent`) and photoDeliveryDeadline (`hasDeliveryExp ==> result === deliveryExpiresAt`, "the same intent can never extend it", photo-relay.ts:210-211) have no Quint invariant (m10, m11), against AGENTS.md "same invariant name at both levels". Proposal: ghosts `intentChanged`, `deadlineChanged` in issue; invariants `oneIntent`, `deadlineFixed`.
5. P2 fetchInTime and fetchOnlyApprovedReviewed are implied by the guard of the same action (photoFetchable requires now < exp <= expiresAt, qnt:93-96; current excludes revoked/rejected and claim needs approved, so m9 passes). They are regression guards on the defs, not on the flow.
6. P2 review guards `now < pri.expiresAt` (qnt:135) before calling photoReviewNext with `now >= pri.expiresAt` (qnt:132), so the core's `expired` input is always false: the "second expiry check after the awaits" (photo-relay.ts:151 vs 155) is a dead branch. Proposal: split review into reviewStart / reviewCommit with a tick allowed between (the awaits of authorizeReviewer and current, photo-relay.ts:150,153).
7. P2 The fetch nondet values other than pri.deliveryExpiresAt (qnt:223) are never enabled because fetch also guards `exp == pri.deliveryExpiresAt` (qnt:182). The "forged or old link" branch tests nothing, and the guard masks the equality inside photoFetchable.
8. P2 ACTIONS = {act1, act2} (qnt:37). The code has one action id per item, `photo-selection:${itemId}`, in both callers (relay-endpoint.ts:250, service.ts:2773), so the act2 branch and secondActionRefusedTest (qnt:311) describe a path the code cannot take; oneAction holds by naming. Two different flows (member RELAY and staff release) can both claim with the same id; the desk's idempotency on itemId (relay.ts:191, 369-375) is what stops a second send, and that is outside this model.

## model_gap
1. P1 Human review needs a preview: the staff release refuses without a photoReviewToken from reviewBytes (service.ts:2756, 2772; proof service.ts:2415-2422; reviewBytes photo-relay.ts:170-177 needs photoHeld). PhotoRelayService.review itself does not check it. The model's review("safe") has no preview precondition, so the "a human saw the bytes" part of the review rule rests on an unmodelled caller. Adding a `previewedBy`/token-until state could show that a token taken while the item was pending remains valid after the state changed (the proof does not bind the state). No invariant break found by reading: reviewAuthorized and claim recheck the state.
2. P1 The staff release is two transactions: review safe commits (service.ts:2761) before unitOfWork with claimForAction (2766-2776). A crash or a desk hold between leaves approved+unclaimed; approvedForParty (photo-relay.ts:185-190) then lets a member RELAY send it later without staff. Not in this model (relay.qnt covers part, SD-320/321). Adding it does not break the current invariants (it was reviewed safe) but would break a "staff release sends" property if one existed.
3. P2 reviewAuthorized (photo-relay.ts:163-168), approved (191-193), approvedForParty (185-190, "exactly one eligible item"), held (180-184), item (179) are not actions. approvedForParty returns nothing with 2+ eligible items in one thread: liveness only (model has one item).
4. P2 enabled (photos.enabled, policy absent, photo-relay.ts:103) and policyNotice equality (105, 109) are merged into policyVersion. With `enabled` false an unsafe review is refused (150): staff cannot reject, only the sender can revoke. No safety break (current fails).
5. P2 Photo row deletion: photo_id `on delete cascade` (0037:20) deletes the item row; `locked` then gets undefined. The model has no "row gone" state and treats photo loss as `pair` false, which pairResumes can undo; a deleted or re-uploaded (other sha256) photo never comes back. Over-approximation; no break.
6. P2 The outbound row and its admission (runtime.ts:294-301), resolveRelayPhoto's 'sending' row check and svc id as intent (service.ts:2440-2455), and the FETCH_TTL upper bound on exp before the lock (photo-relay.ts:224) are not modelled here (relay.qnt has photoOk). Leaving them out over-approximates; safe.
7. P2 Awaits inside the lock: delivery checks exp, then signature, current (authorize + relayPhoto), relayBytes, then exp again (photo-relay.ts:224-231); issueDelivery saves the deadline then may refuse (215-216). Time does not pass inside one model action. The code rechecks, so no break, but the model cannot show it.
8. P2 select replay and conflict (requestHash, photo-relay.ts:128-139; store.create 43-63): select is single-shot in the model (qnt:121). The replay returns "expired" or the saved state without re-checking consent; harmless because no new item is made.
9. P2 No liveness and no terminal expiry: an expired item stays pending/approved for ever (no transition, SD-321 refuted as off in production); a claimed item whose deadline passed can never be issued again (photoDeliveryDeadline keeps the old deadline, issue needs exp > now). Add a temporal property or a witness that shows the stuck state.
10. P2 Retries: the outbound queue retry with a new svc id is refused by photoMayIssue (one intent). The model has INTENTS but no retry actor.

## open_carveout
1. P1 quint/drift.json:281-286 maps only photo_relay_item.qnt and photo-relay.ts. The model copies every def of photo-relay-core.ts, but a change to the core does not flag this model (formal-coverage.md:379 says "see its shell"). Fix now, in scope: add photo-relay-core.ts (and the callers service.ts, relay-endpoint.ts, runtime.ts if this model claims their guards) to the files map and stamp.
2. P2 No known drift list; the 2026-11-09 drift review (quint-drift.md:256-265) fixed pairResumes and documented authorizeReviewer and the issueDelivery checks as outside. Still outside: authorizeReviewer, descriptor/recipient checks, signature, bytes. Can stay outside as oracles.
3. P2 formal-coverage.md:303 marks 0037_photo_relay.sql N/A, but its CHECKs are a second line for model invariants: delivery_expires_at <= expires_at (deadlineInItem), approved needs review_id/reviewer (approvedWasReviewed), unique(action_id), unique(delivery_intent), intent and deadline null together. Fix: name them in the model header as the SQL backstop.
4. P2 Not verified with Apalache (no verify-steps line, qnt:2; CI does not run --verify). Random simulation only.

## suspected_defect
1. P2 (relates to SD-321, refuted only because the path is off in production) Unbounded stale scans: PgPhotoRelayStore.list (photo-relay.ts:67-69) returns every pending/approved row of the app ever made, as expiry is not a state. held() (180-184) runs current() for each row, which opens an authorize transaction (service.ts:420-431) and a relayPhoto read; approvedForParty (185-190) loads all rows on every member photo RELAY. Trigger: policy on, N selections over time, each expired unreviewed; every GET /staff/relay/held then does N authorize transactions. Fix: filter `expires_at > now()` in list, or a terminal expiry state.
No new safety defect found: each state change rechecks current() and the state under the row lock, and the signature binds action, intent and exp.
