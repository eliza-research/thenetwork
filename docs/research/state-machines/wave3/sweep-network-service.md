# Wave 3 sweep: packages/network/service (state machines no Quint model covers)

Hand-written, 2026-11-11. Read-only. Branch claude/quint-state-machines. Line numbers are at the current HEAD (4061b99).
I read every endpoint, the tick loops (serve.ts, deploy/backend/backend.ts), the runtime deliver path, the staff routes,
the shared-action routes and the in-memory registries. I compared each with the 29 models in quint/ and the catalog
(docs/research/2026-11-07-state-machines.md section 2). I did not run a model (no model was changed).

Most of the service is covered (signed turn, consent ledger, outbound queue, cloud deliver, turn receipt, relay desk,
photo relay item, ban and erasure sagas, holds, minor clear, verify, bias cadence, notify projection, profile learning).
The findings below are the parts that no model has, or that a model has as one atomic step while the code has several
awaits.

## Suspected defects

### D1 (P1) liftHold reads the "*" person hold outside its transaction: a concurrent cross-app hold is deleted
- Code: packages/network/service/service.ts:1797-1814 (`everyApp` read at 1800, role check 1801, tx 1803-1811, unit 1812).
- The read of `platform.person_holds ... app_id='*'` is a plain select before `sql.begin`; the tx then deletes
  `app_id in (<this app>, '*')` without reading the row again.
- Trigger: person P has member x on slop and y on peon; a slop-only hold row (P, slop). S1 has safety@slop only.
  1. S1 POST /safety/lift x: personOfMember -> P; select '*' -> none; crossAppSafety not needed.
  2. S2 (safety@*) POST /safety/hold y: inserts (P,'*') (service.ts:1956-1957), holds y on peon and x on slop.
  3. S1 tx: everyApp is undefined, so no fan-out rows; the delete removes (P,'*').
  4. S1 unit lifts x on slop (also S2's new hold of x).
  Result: no person_holds row for P. A rejoin under a new member id, or a join on friends, is not held (the SD-021 and
  SD-022 protections that hold() writes first are gone). An app-limited staff member undid a cross-app safety hold
  (the `needs_safety_everywhere` refusal is bypassed).
- Model: safety_trust.qnt liftHold (575-598) is one atomic action that reads and writes `personHolds` together and has
  no staff role. Split it into `liftRead` (reads star, decides the role) and `liftTx` (writes rows), with the Network
  unit as a third step. An invariant "a '*' row written by a hold that no cross-app staff lifted is still present" (or
  the role rule "only cross-app staff remove a '*' row") finds the trace in about 4 steps.
- Fix shape: read the '*' row `for update` inside the tx and re-check the role there.

### D2 (P1) POST /internal/updates (canonical Pg path) gives a minor the inbox items that updatesFor withholds
- Code: service.ts:2203-2216 (Pg branch: `notifications.readUpdates(...)` directly) versus service.ts:672-691
  (`updatesFor`: returns [] when the person's lowest age is a minor; drops items of closed opportunities).
- packages/notify/src/scheduler.ts:236-248 readUpdates has no age check and no opportunity check. ageLowered
  (service.ts:850-858) deletes photos and ratings, but not notify.inbox_items.
- Trigger: member of ntwrk states 25; a probe or proposal is delivered (NOTIFY_TYPES, service.ts:223) and projected
  into notify.inbox_items (service.ts:647-668; the summary is the message text about another member). The member then
  states 16 (lowest_age 16). They text the line; the turn is `open` (a minor can talk to the agent for themselves). Eliza
  calls POST /internal/updates for that turn: the Pg branch returns the earlier intro text. updatesFor's comment
  ("a minor reads none of them, also items from before they stated their age") is not applied on this path. Items of
  a COMPLETED, CANCELLED or SKIPPED opportunity are also returned (the closed filter at 682-689 is missing).
- Model: notify_capital.qnt readUpdates (291) models one read path. Add the canonical path as a second reader and the
  invariant "no item reaches a person whose lowest age is a minor" (the minor flag exists in notify_capital `NetM`).
- Test that fails before a fix: an integration case in packages/network/test/shared-actions.integration.test.ts with
  an item recorded while adult, then a stated minor age, then /internal/updates.

### D3 (P2, staging route policy only) a route expiry inside the work transaction leaves the action receipt `processing`
- Code: service.ts:2196-2199 (`complete` calls `assertLockedRoute(b.networkAuthority)`), 2174-2181 (`lock` calls
  `assertLockedRoute(turn.network_authority)`), catch 2259-2264.
- The catch returns 403 for RouteAuthorityExpiredError before the update that marks the receipt `unresolved`. The claim
  transaction (2183-2195) already committed `processing`.
- Trigger: NETWORK_ROUTE_AUTHORITY_POLICY set; a set-state call claims at t < drainUntil; the work tx runs at
  t >= drainUntil. The receipt stays `processing`; every retry with the same key gets 409 action_unresolved, and the
  key counts against the 16-receipt cap of the turn.

### D4 (P2, peon local only) a staff edit of a posting reopens a posting that was closed after the edit read it
- Code: packages/network/service/postings.ts:127, 140, 143 (the "closed is final" check reads the stored posting
  outside the Network lock) and 156 (the unit); packages/network/src/network.ts:4965-4977 (applyPosting does not read
  the stored status; it only checks the owner and managerProblem).
- Trigger: admin A POST /postings {id: X, title...}; `stored(X)` reads active. Admin B POST /postings/X/close commits
  (or the manager closes X by text: postingTurn, in a unit). A's unit runs applyPosting(status active): onPosting ->
  savePosting upserts the intent with status active and new openings facets (postings.ts:27-37). X is open again,
  against the rule at postings.ts:142 and SD-114.
- Model: matching_engine.qnt staffSave (in the peon postings section, about line 491) reads and writes in one step.
  Split it into `staffSaveRead` and `staffSaveUnit`; the existing ghost `ph.reopened` then finds the trace.
- Fix shape: check `prev.status` inside the unit (applyPosting reads the stored posting under the lock).

## New machines (no model has their states and transitions)

### N1 (P1) shared-action receipt for set-state, signals and updates (part of M-125 `action-receipt`)
- Code: service.ts:2141-2264 (sharedAction). Key: `idempotencyKey` (set-state) or `<messageId>:signals|updates`;
  receipt id sha256([turnId, path, key]) in platform.inbound.action_receipts.
- States per receipt: absent -> processing (claim tx, 2183-2195) -> completed (with the work, 2196-2202 and 2235-2257)
  | unresolved (catch, 2259-2263). Replay: same request hash and completed -> stored response (set-state adds
  replayed:true); different hash -> 409 action_conflict; processing or unresolved -> 409 action_unresolved. Cap: 16
  receipts per turn, shared with relay (relay-endpoint.ts:200) and profile receipts (profile-suggestions.ts:236).
  Reset: a sealed or forgotten turn sets action_receipts '{}' (inbox.ts:250, runtime.ts:592, pg-store.ts:379).
- Rules: completed iff the effect committed (participation write and event, signal facets, seen marks); one effect per
  key; a key does not stay processing with no worker (liveness: there is no lease and no sweep, so a crash after the
  claim gives a permanent 409; the same open issue as SD-093 in relay.qnt `noStuckKey`); a set-state "paused" that ends
  unresolved is not silently lost (the gateway gets a non-retryable 409).
- Covered elsewhere: relay.qnt models only the relay endpoint's receipts; turn_consent.qnt proposeSignal (720) and
  staffHandle are atomic and have no receipt; profile_learning.qnt has only the profile receipt keys.
- Proposal: extend turn_consent.qnt (it already owns sharedAction and the participation window) with a receipt map per
  (turn, path), actions claim, work, complete, fail, crash, and the sealing reset. Value: high. It is a small finite
  machine with a crash point between two transactions, which is what Quint finds well; it also shows D3 and the 16-cap
  starvation across relay and set-state on one turn.

### N2 (P1) route authority admit and drain windows (M-106 `route-authority`): planned for turn_consent, not in it
- Code: route-authority.ts:1-34; service.ts:2137-2139, 2283-2291, 2318, 2390 (inbox admitUntil), 2439, 2464-2518;
  inbox.ts:94, 106-115; relay-endpoint.ts:151; profile-suggestion-endpoint.ts:73-107;
  learning-consent-context-endpoint.ts:32-84; main.ts (a policy forces dry-run sends); cloud-channel.ts (refuses
  delivery under a policy).
- States: legacy (no policy: an envelope with networkAuthority is refused); isolated-admit (now < admitUntil: a new
  TURN is admitted and stores network_authority); isolated-drain (admitUntil <= now < drainUntil: only follow-ups of a
  turn whose stored authority equals the policy: receipt, set-state, signals, updates replay); closed (now >= drainUntil:
  everything 403). Relay and Cloud delivery are always refused under a policy.
- turn_consent.qnt has no `authority`, `admitUntil` or `drainUntil` (grep), but its header claims M-106..M-111 and
  docs/formal-coverage.md:242 says "turn_consent (machine route-authority)". That coverage row is wrong.
- Rules: no new turn after admitUntil; no effect after drainUntil; a follow-up never runs on a turn of another
  authority; STOP sent after admitUntil gets route_admission_closed (403) and the backend records nothing: say whether
  the gateway's own STOP record covers this (staging only).
- Also: after admitUntil, Inbox.signed returns before its sweep (inbox.ts:94), so a turn whose worker died stays
  `processing` and its retries read `turn_busy` (retryable) until drainUntil.
- Proposal: add to turn_consent.qnt as a policy variable and a `now` comparison on each entry action. Value: medium;
  it is a three-window guard, but the coverage claim needs to become true.

### N3 (P1) staff photo-review proof handshake (preview token, then release)
- Code: service.ts:2414-2423 (photoReviewProof, validPhotoReview), 2606-2621 (GET relay/<pri_id>/photo: reviewBytes,
  token `until.hmac` with until = min(item.expiresAt, now + 5 min), bound to the reviewer and the item fields),
  2735-2795 (POST release: token check and reviewAuthorized, review(safe) in its own transaction when pending, then
  approved(), then a unit with relayRequest, then completeAction re-checks the token and reviewAuthorized and calls
  claimForAction inside the save).
- States per (item, reviewer): no token -> token issued (until) -> release requested -> reviewed safe (committed) ->
  unit sent | unit refused (the item stays approved and undelivered) | token expired.
- Rules: a photo goes out only if the same reviewer saw the current bytes, and the token is valid at commit;
  release after expiresAt never sends; a reject needs no token; an audit row exists before each effect.
- Covered elsewhere: photo_relay_item.qnt models review as one action and leaves "the reviewer authorization" outside;
  relay.qnt has the photo item inside the desk but no proof.
- Proposal: extend photo_relay_item.qnt with `staffPreview(reviewer)`, `staffRelease(reviewer)` split at the awaits
  (token check, review commit, approved read, unit, completeAction). Value: medium. The HMAC is an oracle; the value is
  the interleaving of a second reviewer, a revoke and expiry between the review commit and the unit.

## Model gaps (covered machines that miss part of this area)

### G1 (P1) safety_trust: liftHold is one step; the code is read, tx, unit (see D1). staffHold is also atomic for its
first person-hold insert and first unit (service.ts:1956-1962, compensating delete on refusal at 1958-1960 is not in
the model).

### G2 (P2) matching_engine: staffSave and staffClose read and write in one step (see D4).

### G3 (P2) notify_capital: only the updatesFor reader is modelled; the canonical /internal/updates reader
(service.ts:2207-2215) and its seen-marking inside the receipt transaction are not (see D2).

### G4 (P2) runtime_ops tickRound is atomic; serve.ts startTicks (serve.ts:129-150) starts `loop()` every 60 s with
`setInterval` and no guard on inboxTick, purge and notifyTick, so two rounds overlap when one takes over 60 s (the busy
set guards only the network ticks); `stop()` awaits only the newest round. deploy/backend/backend.ts:426-457 guards each
step by name, so the production backend is safe; main.ts (standalone service) is not. Under overlap, round 2's network
ticks can also run before round 1's inbox drain ends, so "waiting inbound first" (serve.ts:135) does not hold.

### G5 (P2) relay.qnt slaTick reads the desk as committed state. The code (service.ts:541-547) reads `rt.net.reviewQueue()`
and `rt.net.relayHeld()` from the replica's in-memory Network outside the lock, the same pattern SD-448 fixed for the bias
report with readState. A concurrent unit's uncommitted change can raise or skip an alert. Log only.

### G6 (P2) outbound_queue: the direct (non-enqueue) deliver path keeps failed sends in an in-memory `retry` list
(runtime.ts:651-688, 765). A restart loses it. In production every adapter enqueues (Blooio, Cloud); the dry-run adapter
(also forced by a route policy, main.ts) has no enqueue. outbound_queue.qnt models `direct` only for the Blooio adapter
flag. Low value unless a non-persisted live adapter returns.

## Open carve-out

### C1 (P2) M-184 `memory-registries` is left out of runtime_ops (quint-findings/runtime_ops.md:27). In this package:
`slaAlerted` (service.ts:322: per process, a restart or a second replica alerts again), `notifyTargets` (297: filled by
notifyRecipient in the same dispatch, so a miss drops the text with a log line at 721), `runtime.retry` and `committed`
(G6), the address book `addrToMember`/`memberToAddr` (runtime.ts:132-133, refreshed per unit, read outside a unit by
consentRefused and notifyRecipient), `Inbox.chains` (covered by turn_consent M-002), `relay-endpoint.ts:98` hook cache
and `cost.ts:97` rows (memory store only). None of them guards a safety rule on its own (each send re-checks consent and
the address inside the unit). No module is needed; G5 and G6 are the two that a model could use.
