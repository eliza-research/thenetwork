# Suggestions from connected sources

## Story: Suggestions from connected sources

A member needs to approve suggested facts before they become part of their profile.

### Safety rules and reachability

Check collection scope, review and acceptance, expiry, STOP, and erasure. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

[Source collection and cleanup](../profileSuggestionSource.md) drives
intake, replay, disconnect, and owner withdrawal decisions.
[Suggestion review](../profileSuggestionReview.md) drives the member's
selection and review actions on the pending facts.

Imported from `quint/profile_learning.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=32 max-samples=4000 verify-steps=4
// -*- mode: Bluespec; -*-
//
// Profile learning: Google source suggestions from collection to erasure.
// Plan: docs/research/2026-11-07-state-machines.md section 6.12. Machines: suggestion-item,
// suggestion-batch, collection-claim, connection-cleanup-v1, owner-withdrawal-v2, accepted-source-fact,
// journey-parent-turn, learning-context-proof, cloud-proof-chain, review-proofs, connector-profile-journey.
// Source reports: docs/research/state-machines/gap-connector-journey.md, platform-consent.md section 7.
//
// State of the code: compared with the code on branch vibestack-matching on 2026-11-18, after the fixes
// made that day for SD-175 (collect and accept read the consent ledger: consent-ledger-read.ts
// personLedgerOptedOut in PS memberRow), Q-profile_learning-1 (PS propose and decide read memberRow again
// after the Cloud calls; spec/profileSuggestionSource.md sourceUseAllowed), SD-455 (one authorize call per
// distinct source and connection), SD-240 (PS propose and RV batchReview share
// spec/profileSuggestionReview.md observedTimeAllowed: a Calendar start can be in the future, a Gmail
// time cannot), SD-458 (PS keepReview stores the decide or delete result on the review turn under
// "profile-review:<batch>"; EP calls PS priorReview first; spec storedReviewReplays), SD-463 (RT forget
// deletes profile_suggestion_batches) and SD-464 (SV passes reviewEnabled to LC, which answers 503
// identity_unavailable when review is off). SD-170 is fixed by migration 0053. Each of these
// invariants is in `safety`; the tests are in packages/network/test/profile-suggestions.integration.test.ts.
// Compared again on 2026-11-21 after the fixes of SD-112 (the Cloud calls of collect and accept run
// before the person and member row locks; the commit reads eligibility and the stored turn again under
// the locks and refuses a batch whose connection a later-cut cleanup already cleaned: PS cleanedSinceGrant),
// SD-172 (each row keeps source_authorized_at, the Cloud time of its source proof; V1 and V2 select rows
// by that time against the Cloud revokedAt or cutoffAt), SD-242 (V2 no longer compares the Network turn
// time with the Cloud cutoff) and SD-376 (PS applyRetention deletes finished rows and empty batches by
// spec/platformRetention.md). Every invariant is in `safety`; there is no open defect.
// The `PS:nnn`-style line numbers below come from claude/formal-main and are stale on this branch.
// Find the code by function name: PS owned/memberRow/batch/propose/priorReview/decide/deleteBatch/
// applyRevokedConnection/applyOwnerWithdrawal/applyRetention, RV batchReview, EP
// profileSuggestionEndpoint, LC learningConsentContextEndpoint, PF profileReviewFactory, RT forget
// (runtime.ts), SV fetch and stop/stopped.
//
// Code (abbreviations as in gap-connector-journey.md):
//   PS = packages/network/service/profile-suggestions.ts
//   EP = packages/network/service/profile-suggestion-endpoint.ts
//   RV = packages/network/service/profile-suggestion-review.ts
//   DE = packages/network/service/profile-suggestion-disconnect-endpoint.ts
//   WE = packages/network/service/profile-suggestion-withdrawal-endpoint.ts
//   LC = packages/network/service/learning-consent-context-endpoint.ts
//   PF = packages/network/service/profile-review-factory.ts
//   SV = packages/network/service/service.ts
//   AC = packages/platform/src/accounts.ts, PG = packages/platform/src/pg-store.ts
//   RT = packages/network/service/runtime.ts (forget)
//   0039, 0040, 0053 = packages/observatory/db/migrations/0039_profile_suggestions.sql, 0040_...receipts.sql,
//   0053_membership_derived_erasure.sql (forget_profile_suggestions also removes the V1 receipts)
//   ProfileSuggestions.disconnect (PS:343-359) has no caller in production code; it is not modeled.
//
// Scope and abstraction.
// - One person, one app, one chat. Two batches (one collect turn each), two items per batch, two Google
//   connections. Text is the flag `hasValue`; ids are small ints.
// - Two clocks: nowN (Network Clock) and nowC (Cloud clock), |nowN - nowC| <= SKEW (svc-auth 60 s skew).
// - One SQL transaction is one action. `collect` (PS.propose) is split at its awaits on Cloud: the
//   transaction reads the owner without row locks in collectBegin, makes one source-proof call per
//   distinct (source, connection) (PS propose, PF:75-95) in collectSourceCall, then takes the
//   person/member locks, reads member eligibility again (PS lockedMember) and inserts in collectCommit.
//   No row lock is held across a Cloud call, so no action waits on an open collect.
// - Oracles: Cloud owner proof (always true for the real owner), Cloud source proof (true iff the
//   connection is active and Cloud holds learning consent), Cloud consent writes, Google revocation.
// - The gateway is a nondeterministic retrier: a reply can be lost and the same request sent again.
// - One review turn carries one command (EP:84 the request text must equal the stored turn body; the
//   delete text is "delete <batch>"). The store keys its result on that turn (PS:271, PS:332), so a turn
//   applies at most one decide or delete: `cmdUsed`.
// - Delete everything (AC:484-496) runs the runtime forget of each live membership (RT:588-625) and then
//   the store delete (PG:355-397). The model merges them into one step, deleteAll.
// - Upstream assumptions (not in this repository): Cloud issues the revoked proof only for a revoked
//   connection; Cloud records the withdrawal event after the member's withdrawal turn; Cloud times of its
//   own events are ordered, so a source proof issued after a revocation or withdrawal event carries a
//   later Cloud time than that event (reconnect and consentContext are guarded with nowC > the event).

module profile_learning {

  // ------------------------------------------------------------------ bounds and constants
  pure val BATCHES = Set(1, 2)
  pure val ITEMS = Set(1, 2, 3, 4)
  pure val CONNS = Set(1, 2)
  pure val NONCES = Set(1, 2)
  pure def batchOf(i: int): int = if (i <= 2) 1 else 2
  pure def itemsOf(b: int): Set[int] = ITEMS.filter(i => batchOf(i) == b)
  // Time is an integer tick. The scales are symbolic: only the order of the thresholds matters.
  pure val SKEW = 2           // signed-call skew bound (svc-auth.ts SVC_MAX_SKEW_S, 60 s)
  pure val MAXT = 12          // time bound for the model
  pure val PARENT = 4         // a parent turn is usable for 5 min (cloud-profile-review-owner.ts MAX_PARENT_AGE_MS)
  pure val SRC_TTL = 2        // a source proof lives at most 5 s (core/src/svc/profile-review-source.ts parseProfileReviewSourceProof)
  pure val RETENTION = 2      // platformKeepMs (spec/platformRetention.md), counted from the batch expiry
  // Pending lifetime: the proposal's expiresAt, chosen as 2 or 4 ticks after created_at (collectBegin).
  pure val INF = 100
  pure def imin(a: int, b: int): int = if (a < b) a else b

  // Item status: the SQL check in 0039:35, plus "none" (no row yet) and "gone" (row deleted).
  pure val TERMINAL = Set("rejected", "expired", "withdrawn")

  // authAt: the Cloud clock time of the source proof that collected the row (source_authorized_at).
  type Item = { status: str, conn: int, cal: bool, obs: int, hasValue: bool, fact: bool, authAt: int }
  type Batch = { exists: bool, createdAt: int, expiresAt: int, rev: int, retain: bool }
  type Plan = { conn: int, cal: bool, obs: int, authAt: int }
  type Collect = { active: bool, b: int, at: int, calls: int, until: int, ttl: int, retain: bool }
  // kind: "none" | "saved" | "preview" (decide) | "deleted" (delete). rev: the batch revision after the commit.
  // receipt: the stored result "profile-review:<b>" on the review turn (PS keepReview), written in the same
  // transaction as the commit and removed when forget or delete everything resets action_receipts.
  type Req = { kind: str, b: int, rev: int, committed: bool, lost: bool, receipt: bool }

  pure val NOITEM: Item = { status: "none", conn: 1, cal: false, obs: 0, hasValue: false, fact: false, authAt: -1 }
  pure val NOBATCH: Batch = { exists: false, createdAt: -1, expiresAt: -1, rev: 0, retain: false }
  pure val NOCOL: Collect = { active: false, b: 1, at: -1, calls: 0, until: INF, ttl: 0, retain: false }
  pure val NOREQ: Req = { kind: "none", b: 1, rev: 0, committed: false, lost: false, receipt: false }

  // ------------------------------------------------------------------ state
  var nowN: int
  var nowC: int
  var reviewEnabled: bool              // a route policy with the Cloud origin and turn secret (profileReviewFromEnv)
  // Member and person facts. ledgerStop is the canonical consent ledger (platform.consent_events);
  // projOut is the projection that stopped() writes (n.opted_out, membership paused).
  var ledgerStop: bool
  var projOut: bool
  var banned: bool
  var held: bool
  var minor: bool
  var membership: str                  // "active" | "paused" | "removed" | "deleted"
  var forgotten: bool                  // runtime forget ran: network.members.person_id is null
  var leaveStage: str                  // "none" | "consent" | "forgot" | "done"
  var sealed: bool                     // inbound turns sealed (forget or delete everything)
  // Cloud (upstream) state.
  var learningConsent: bool
  var conn: int -> str                 // "active" | "revoked"
  var revokedAt: int -> int            // Cloud clock time of the last revocation, -1 if none
  // Turns and proofs.
  var turnAt: int -> int               // arrival (Network clock) of the collect turn for batch b, -1 if none
  var cmdAt: int                       // arrival of the last review command turn, -1 if none
  var cmdUsed: bool                    // that turn already applied its decide or delete (PS:271, PS:332)
  var consentProofs: Set[int]          // batches with a signed learning-consent-context proof (LC)
  // Store.
  var batch: int -> Batch
  var row: int -> Item
  var facts: Set[int]                  // network.facets rows "source-suggestion:<item>"
  var collectReceipt: Set[int]         // inbound.action_receipts["profile-collect:<b>"]
  var col: Collect                     // the propose transaction in flight
  var plan: int -> Plan                // the proposal of the in-flight collect
  var v1Receipts: int -> (int, str, int) // profile_suggestion_connection_receipts: nonce -> (conn, op, revoked_at)
  var wTurnAt: int                     // V2: arrival of the member's withdrawal turn, -1 if none
  var wConn: int
  var wCutoff: int                     // V2: Cloud event time (proof.cutoffAt), -1 if none
  var v2Receipts: Set[str]             // inbound.action_receipts["profile-withdrawal-v2:<id>"]: the op of the one receipt
  var lastReq: Req                     // the last decide or delete request, for gateway retry
  // Ghost state (observations of the history; the code does not hold these).
  var created: int -> int              // inserts per batch id
  var beforeRevoke: int -> Set[int]    // items whose source proof came before (real time) the revocation of c
  var v1Done: Set[(int, str)]          // V1 mutations applied for the current revocation of c
  var wBefore: Set[int]                // items whose source proof came before (real time) the withdrawal event
  var v2Done: Set[str]
  var addedAfterStop: bool             // source data added after the STOP ledger said opted_out
  var addedBannedOrHeld: bool          // source data added while banned or on hold
  var addedMinor: bool                 // source data added while a minor
  var acceptedAfterExpiry: bool
  var saidNothingSaved: Set[int]       // collect replied "Nothing new was saved" for batch b (EP:113)
  var touchedAfterCutoff: bool         // V1/V2 changed a row of a batch created after the cutoff event
  var retryDeniedAfterCommit: bool     // a retried decide/delete was denied after its first try committed
  var consentProofWhileStopped: bool
  var everAccepted: bool
  var everDeleted: bool
  var replayed: bool
  var everPurged: bool

  // ------------------------------------------------------------------ derived predicates
  // owned() finds a row (PS:83-91): the membership is not removed, the person is not deleted, and the
  // member row still joins the person (forget sets person_id null).
  val ownedExists = (membership == "active" or membership == "paused") and not(forgotten)
  // PS memberRow().eligible: the projection, and the canonical consent ledger (personLedgerOptedOut, fix of
  // SD-175: a STOP or a
  // leave consent event makes the member ineligible before the projection changes).
  val eligible = membership == "active" and not(projOut) and not(ledgerStop) and not(minor) and not(banned)
    and not(held) and not(forgotten)
  // activeMembership at turn time (SV:2372-2390, AC:329-338): the ledger, ban, hold, state. 13+ passes.
  val turnOpen = membership == "active" and not(ledgerStop) and not(banned) and not(held) and not(forgotten)
  def sourceProof(c: int): bool = conn.get(c) == "active" and learningConsent
  def proposedOf(b: int): Set[int] = itemsOf(b).filter(i => row.get(i).status == "proposed")
  // RV batchReview (spec/profileSuggestionReview.md checkBatch, checkItems, observedTimeAllowed): not
  // expired, at least one pending row, every pending Gmail row observed <= now.
  // A Calendar event start can be in the future (fix of SD-240).
  def renderable(b: int): bool = batch.get(b).exists and nowN < batch.get(b).expiresAt
    and proposedOf(b) != Set() and proposedOf(b).forall(i => row.get(i).cal or row.get(i).obs <= nowN)
  // PS propose: one Cloud source check per distinct (source, connection) of the proposal (fix of SD-455).
  def scopesOf(b: int): Set[(bool, int)] = itemsOf(b).map(i => (plan.get(i).cal, plan.get(i).conn))
  // Ghost: the items whose source proof was issued, saved or still in the open collect.
  val authorizedItems = ITEMS.filter(i => (row.get(i).authAt >= 0 and row.get(i).status != "gone")
    or (col.active and batchOf(i) == col.b and plan.get(i).authAt >= 0))
  def itemConn(i: int): int = if (row.get(i).authAt >= 0) row.get(i).conn else plan.get(i).conn
  val cmdFresh = cmdAt >= 0 and nowN - cmdAt < PARENT and not(sealed)

  // ------------------------------------------------------------------ init
  action initWith(re: bool): bool = all {
    nowN' = 0, nowC' = 0, reviewEnabled' = re,
    ledgerStop' = false, projOut' = false, banned' = false, held' = false, minor' = false,
    membership' = "active", forgotten' = false, leaveStage' = "none", sealed' = false,
    learningConsent' = false, conn' = CONNS.mapBy(c => "active"), revokedAt' = CONNS.mapBy(c => -1),
    turnAt' = BATCHES.mapBy(b => -1), cmdAt' = -1, cmdUsed' = false, consentProofs' = Set(),
    batch' = BATCHES.mapBy(b => NOBATCH), row' = ITEMS.mapBy(i => NOITEM), facts' = Set(),
    collectReceipt' = Set(), col' = NOCOL, plan' = ITEMS.mapBy(i => { conn: 1, cal: false, obs: 0, authAt: -1 }),
    v1Receipts' = Map(), wTurnAt' = -1, wConn' = 1, wCutoff' = -1, v2Receipts' = Set(), lastReq' = NOREQ,
    created' = BATCHES.mapBy(b => 0), beforeRevoke' = CONNS.mapBy(c => Set()), v1Done' = Set(),
    wBefore' = Set(), v2Done' = Set(),
    addedAfterStop' = false, addedBannedOrHeld' = false, addedMinor' = false, acceptedAfterExpiry' = false,
    saidNothingSaved' = Set(), touchedAfterCutoff' = false, retryDeniedAfterCommit' = false,
    consentProofWhileStopped' = false, everPurged' = false,
    everAccepted' = false, everDeleted' = false, replayed' = false,
  }
  action init = { nondet re = Set(true, false).oneOf() initWith(re) }

  // Frame helpers: each action names what it changes; `keep*` leaves the rest.
  action keepMember = all { ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, held' = held,
    minor' = minor, membership' = membership, forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed }
  action keepCloud = all { learningConsent' = learningConsent, conn' = conn, revokedAt' = revokedAt }
  action keepTurns = all { turnAt' = turnAt, cmdAt' = cmdAt, cmdUsed' = cmdUsed, consentProofs' = consentProofs,
    wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff }
  action keepStore = all { batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
    col' = col, plan' = plan, v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq }
  action keepGhost = all { created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done,
    wBefore' = wBefore, v2Done' = v2Done, addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld,
    addedMinor' = addedMinor, acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, retryDeniedAfterCommit' = retryDeniedAfterCommit,
    consentProofWhileStopped' = consentProofWhileStopped,
    everAccepted' = everAccepted, everDeleted' = everDeleted, replayed' = replayed, everPurged' = everPurged }
  action keepClock = all { nowN' = nowN, nowC' = nowC, reviewEnabled' = reviewEnabled }

  // ------------------------------------------------------------------ clocks
  // Both clocks move together; tickN and tickC move one clock alone (skew, bounded by SKEW).
  action tick = all { nowN < MAXT, nowC < MAXT, nowN' = nowN + 1, nowC' = nowC + 1,
    reviewEnabled' = reviewEnabled, keepMember, keepCloud, keepTurns, keepStore, keepGhost }
  action tickN = all { nowN < MAXT, nowN + 1 - nowC <= SKEW, nowN' = nowN + 1, nowC' = nowC,
    reviewEnabled' = reviewEnabled, keepMember, keepCloud, keepTurns, keepStore, keepGhost }
  // Three ticks of both clocks in one step: the same states as tick three times, so that the sampler
  // reaches the retention window within its step bound.
  action tickBy3 = all { nowN + 3 <= MAXT, nowC + 3 <= MAXT, nowN' = nowN + 3, nowC' = nowC + 3,
    reviewEnabled' = reviewEnabled, keepMember, keepCloud, keepTurns, keepStore, keepGhost }
  action tickC = all { nowC < MAXT, nowC + 1 - nowN <= SKEW, nowC' = nowC + 1, nowN' = nowN,
    reviewEnabled' = reviewEnabled, keepMember, keepCloud, keepTurns, keepStore, keepGhost }

  // ------------------------------------------------------------------ member turns (SV:2372-2390)
  // "collect <uuid> <scope>" as an open turn. One batch id per turn.
  action memberCollectCmd(b: int): bool = all {
    turnOpen, turnAt.get(b) == -1, turnAt' = turnAt.set(b, nowN),
    cmdAt' = cmdAt, cmdUsed' = cmdUsed, consentProofs' = consentProofs, wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff,
    keepClock, keepMember, keepCloud, keepStore, keepGhost }
  // "preview|accept|edit|reject|delete <uuid>..." as an open turn.
  action memberReviewCmd = all {
    turnOpen, cmdAt' = nowN, cmdUsed' = false,
    turnAt' = turnAt, consentProofs' = consentProofs, wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff,
    keepClock, keepMember, keepCloud, keepStore, keepGhost }

  // ------------------------------------------------------------------ learning consent context (LC)
  // LC:13-98 reads the ledger twice and the projection, signs a proof, writes nothing. SV fetch answers
  // 503 identity_unavailable when profile review is off (fix of SD-464). Cloud then writes learning consent.
  action consentContext(b: int): bool = all {
    reviewEnabled,
    // LC:43 and LC:52 take `for share` on the person and member rows. A collect holds them only inside
    // its commit, which is one step here, so the consent context never waits on a Cloud call.
    // Upstream assumption: a grant after a Cloud withdrawal event carries a later Cloud time.
    turnAt.get(b) >= 0, nowN - turnAt.get(b) < PARENT, not(sealed), wCutoff < nowC,
    eligible, not(ledgerStop),
    consentProofs' = consentProofs.union(Set(b)), learningConsent' = true,
    consentProofWhileStopped' = (consentProofWhileStopped or ledgerStop),
    turnAt' = turnAt, cmdAt' = cmdAt, cmdUsed' = cmdUsed, wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff,
    conn' = conn, revokedAt' = revokedAt,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done,
    wBefore' = wBefore, v2Done' = v2Done, addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld,
    addedMinor' = addedMinor, acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, retryDeniedAfterCommit' = retryDeniedAfterCommit,
    everAccepted' = everAccepted, everDeleted' = everDeleted, replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepStore }
  // Cloud clears learning consent (upstream, any time).
  action cloudClearConsent = all { learningConsent, learningConsent' = false, conn' = conn, revokedAt' = revokedAt,
    keepClock, keepMember, keepTurns, keepStore, keepGhost }

  // ------------------------------------------------------------------ collect (EP:72-113, PS.propose)
  // T2 begins without row locks (fix of SD-112): the Cloud owner proof, an unlocked eligibility read and
  // an unlocked read of the stored turn. created_at is the `now` captured before the transaction (EP:109).
  action collectBegin(b: int): bool = all {
    reviewEnabled, not(col.active),
    turnAt.get(b) >= 0, nowN - turnAt.get(b) < PARENT, not(sealed),
    ownedExists, eligible,
    nondet c1 = CONNS.oneOf()
    nondet c2 = CONNS.oneOf()
    nondet cal1 = Set(true, false).oneOf()
    nondet cal2 = Set(true, false).oneOf()
    // PS:182-183: observed inside the window; Gmail never in the future; a Calendar start may be.
    nondet fut1 = Set(true, false).oneOf()
    nondet fut2 = Set(true, false).oneOf()
    nondet ttl = Set(2, 4).oneOf()
    nondet retain = Set(true, false).oneOf()
    val i1 = 2 * b - 1
    val i2 = 2 * b
    all {
      plan' = plan.set(i1, { conn: c1, cal: cal1, obs: if (cal1 and fut1) nowN + 2 else nowN - 1, authAt: -1 })
                  .set(i2, { conn: c2, cal: cal2, obs: if (cal2 and fut2) nowN + 2 else nowN - 1, authAt: -1 }),
      col' = { active: true, b: b, at: nowN, calls: 0, until: INF, ttl: ttl, retain: retain },
    },
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }

  // One Cloud source-proof round trip per distinct (source, connection), with no row lock held (SD-455 and
  // SD-112 fixes). With two different scopes the calls check item 1 and then item 2; with one scope only
  // item 1. PF:92: sourceUntil = min(sourceUntil, proof.expiresAt). The proof's issuedAt (Cloud clock) is
  // kept for every item of that scope. A false answer returns null: rollback.
  action collectSourceCall = all {
    col.active, col.calls < scopesOf(col.b).size(),
    val i = 2 * col.b - 1 + col.calls
    val scope = (plan.get(i).cal, plan.get(i).conn)
    if (sourceProof(plan.get(i).conn))
      all {
        col' = col.with("calls", col.calls + 1).with("until", imin(col.until, nowN + SRC_TTL)),
        plan' = ITEMS.mapBy(j => if (batchOf(j) == col.b and (plan.get(j).cal, plan.get(j).conn) == scope)
                                   plan.get(j).with("authAt", nowC) else plan.get(j)),
      }
    else
      all { col' = NOCOL, plan' = plan },
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }

  // The rest of T2: it takes the person and member locks, reads eligibility again after the last Cloud
  // call (fix of Q-profile_learning-1 and, with the ledger, SD-175), reads the stored turn again under
  // `for update of i`, and refuses the batch when a committed disconnect, delete or withdrawal of one of
  // its connections has a Cloud cutoff at or after that connection's source proof (PS cleanedSinceGrant;
  // with the locks released during the calls, such a cleanup can commit before this step). Then
  // checkAuthority, receipt lookup and replay, insert, view, checkAuthority, COMMIT. Then render after
  // commit (EP:111-113): a null render answers "Nothing new was saved".
  action collectCommit = all {
    col.active, col.calls == scopesOf(col.b).size(),
    val b = col.b
    val fresh = nowN < col.until and nowN < col.at + col.ttl
    val cleanedSince = itemsOf(b).exists(i =>
      v1Receipts.keys().exists(n => v1Receipts.get(n)._1 == plan.get(i).conn and v1Receipts.get(n)._2 != "readback"
        and v1Receipts.get(n)._3 >= plan.get(i).authAt)
      or (v2Receipts != Set() and wConn == plan.get(i).conn and wCutoff >= plan.get(i).authAt))
    if (not(fresh) or not(eligible) or sealed or cleanedSince)
      // member() is not eligible: null, rollback. checkAuthority throws: rollback, 503.
      all { col' = NOCOL, batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
            created' = created, addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld,
            addedMinor' = addedMinor, saidNothingSaved' = saidNothingSaved, replayed' = replayed }
    else if (b.in(collectReceipt))
      // PS:221-235: replay returns the stored preview only if the batch is intact; never inserts.
      all { col' = NOCOL, batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
            created' = created, addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld,
            addedMinor' = addedMinor, saidNothingSaved' = saidNothingSaved, replayed' = true }
    else
      val newItems = itemsOf(b).mapBy(i => { status: "proposed", conn: plan.get(i).conn, cal: plan.get(i).cal,
                                             obs: plan.get(i).obs, hasValue: true, fact: false, authAt: plan.get(i).authAt })
      // RV batchReview fails only for a future Gmail row; PS propose refuses one with the same rule
      // (observedTimeAllowed), so a saved batch always renders (fix of SD-240).
      val anyFuture = itemsOf(b).exists(i => plan.get(i).obs > nowN and not(plan.get(i).cal))
      all {
        col' = NOCOL,
        batch' = batch.set(b, { exists: true, createdAt: col.at, expiresAt: col.at + col.ttl, rev: 1, retain: col.retain }),
        row' = ITEMS.mapBy(i => if (batchOf(i) == b) newItems.get(i) else row.get(i)),
        facts' = facts,
        collectReceipt' = collectReceipt.union(Set(b)),
        created' = created.set(b, created.get(b) + 1),
        addedAfterStop' = (addedAfterStop or ledgerStop),
        addedBannedOrHeld' = (addedBannedOrHeld or banned or held),
        addedMinor' = (addedMinor or minor),
        saidNothingSaved' = if (anyFuture) saidNothingSaved.union(Set(b)) else saidNothingSaved,
        replayed' = replayed,
      },
    plan' = plan, v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore, v2Done' = v2Done,
    acceptedAfterExpiry' = acceptedAfterExpiry, touchedAfterCutoff' = touchedAfterCutoff,
    retryDeniedAfterCommit' = retryDeniedAfterCommit, consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted, everPurged' = everPurged,
    keepClock, keepMember, keepCloud, keepTurns }

  // The process stops, or a Cloud call times out (PT: one attempt, 3 s): the transaction rolls back.
  action collectCrash = all { col.active, col' = NOCOL,
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }

  // ------------------------------------------------------------------ STOP, START, ban, hold, age
  // The STOP consent event is a separate insert with no person lock (AC addConsent).
  action stopLedger = all { not(ledgerStop), ledgerStop' = true,
    projOut' = projOut, banned' = banned, held' = held, minor' = minor, membership' = membership,
    forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // stopped() (SV:893-906) writes the membership and member rows. No transaction holds those locks
  // across a Cloud call (fix of SD-112), so the projection never waits on Cloud.
  action stopProjection = all { ledgerStop, not(projOut), ownedExists,
    projOut' = true, membership' = if (membership == "active") "paused" else membership,
    ledgerStop' = ledgerStop, banned' = banned, held' = held, minor' = minor,
    forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // START on the line opts back in (ledger, then projection; one step here).
  action start = all { ledgerStop, membership == "paused" or membership == "active", leaveStage == "none",
    ledgerStop' = false, projOut' = false, membership' = "active",
    banned' = banned, held' = held, minor' = minor, forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // A ban inserts into platform.bans (PG:189-200). A ban that names the person first reads the person row
  // `for share` (it waits for a running collect); a ban by phone only takes no lock. The action has no lock
  // guard, so it covers both.
  action ban = all { not(banned), banned' = true,
    ledgerStop' = ledgerStop, projOut' = projOut, held' = held, minor' = minor, membership' = membership,
    forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // A hold is an update of platform.phone_identities (PG:77-78): not locked by owned().
  action hold = all { not(held), held' = true,
    ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, minor' = minor, membership' = membership,
    forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // An age drop updates platform.people.lowest_age and network.members.age (locked only inside a commit).
  action ageDrop = all { not(minor), minor' = true,
    ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, held' = held, membership' = membership,
    forgotten' = forgotten, leaveStage' = leaveStage, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }

  // ------------------------------------------------------------------ review (EP decide/delete, RV, PS)
  // reviewSuggestionMessage: getPendingBatch + parse (T1), then decide (T2). The token revision comes
  // from T1; a stale token is a nondeterministic choice. Source proof per accept or edit (PS:285-287).
  // An accept reads member() again after the Cloud calls (fix of Q-profile_learning-1); one action here,
  // so `eligible` is read at the commit. A committed decide stores its result on the review turn
  // (fix of SD-458): "saved" for accept or reject, "preview" with the new revision for an edit.
  action decide(b: int, i: int, act: str, stale: bool, lost: bool): bool = all {
    reviewEnabled, cmdFresh, not(cmdUsed), ownedExists, batchOf(i) == b,
    batch.get(b).exists,
    val bt = batch.get(b)
    val rev = if (stale) bt.rev - 1 else bt.rev
    if (nowN >= bt.expiresAt)
      // PS decide: expire pending rows, deny. The expiry write commits, also when the batch expired during the
      // Cloud source calls (spec/profileSuggestionReview.md, fix of IPP-3: the code threw and rolled back).
      all {
        row' = ITEMS.mapBy(j => if (batchOf(j) == b and row.get(j).status == "proposed")
                                   row.get(j).with("status", "expired").with("hasValue", false)
                                 else row.get(j)),
        batch' = batch, facts' = facts, lastReq' = lastReq, cmdUsed' = cmdUsed,
        acceptedAfterExpiry' = acceptedAfterExpiry, everAccepted' = everAccepted,
        addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
      }
    else all {
      cmdUsed' = true,
      // RV:40-45, RV:59-66: no render means no decision (SD-240); the revision must match (PS:277).
      renderable(b), rev == bt.rev, row.get(i).status == "proposed",
      if (act == "accept") all {
        eligible, sourceProof(row.get(i).conn),
        row' = row.set(i, row.get(i).with("status", "accepted").with("hasValue", false).with("fact", true)),
        facts' = facts.union(Set(i)),
        batch' = batch.set(b, bt.with("rev", bt.rev + 1)),
        lastReq' = { kind: "saved", b: b, rev: bt.rev + 1, committed: true, lost: lost, receipt: true },
        acceptedAfterExpiry' = (acceptedAfterExpiry or nowN >= bt.expiresAt),
        everAccepted' = true,
        addedAfterStop' = (addedAfterStop or ledgerStop),
        addedBannedOrHeld' = (addedBannedOrHeld or banned or held),
        addedMinor' = (addedMinor or minor),
      } else if (act == "edit") all {
        // An edit or scope change is a new preview (PS:291-302).
        eligible, sourceProof(row.get(i).conn),
        row' = row, facts' = facts,
        batch' = batch.set(b, bt.with("rev", bt.rev + 1)),
        lastReq' = { kind: "preview", b: b, rev: bt.rev + 1, committed: true, lost: lost, receipt: true },
        acceptedAfterExpiry' = acceptedAfterExpiry, everAccepted' = everAccepted,
        addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
      } else all {
        // reject needs ownership only (PS:313-315).
        row' = row.set(i, row.get(i).with("status", "rejected").with("hasValue", false)),
        facts' = facts,
        batch' = batch.set(b, bt.with("rev", bt.rev + 1)),
        lastReq' = { kind: "saved", b: b, rev: bt.rev + 1, committed: true, lost: lost, receipt: true },
        acceptedAfterExpiry' = acceptedAfterExpiry, everAccepted' = everAccepted,
        addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
      },
    },
    collectReceipt' = collectReceipt, col' = col, plan' = plan, v1Receipts' = v1Receipts, v2Receipts' = v2Receipts,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore, v2Done' = v2Done,
    saidNothingSaved' = saidNothingSaved, touchedAfterCutoff' = touchedAfterCutoff,
    retryDeniedAfterCommit' = retryDeniedAfterCommit, consentProofWhileStopped' = consentProofWhileStopped, everDeleted' = everDeleted, replayed' = replayed, everPurged' = everPurged,
    turnAt' = turnAt, cmdAt' = cmdAt, consentProofs' = consentProofs, wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff,
    keepClock, keepMember, keepCloud }

  // "delete <uuid>" (PS deleteBatch): the batch row goes; the 0039 trigger deletes linked facts; rows cascade.
  // The result "deleted" is stored on the review turn (fix of SD-458).
  action deleteBatch(b: int, lost: bool): bool = all {
    reviewEnabled, cmdFresh, not(cmdUsed), ownedExists, batch.get(b).exists,
    all {
      cmdUsed' = true,
      batch' = batch.set(b, NOBATCH),
      row' = ITEMS.mapBy(i => if (batchOf(i) == b) NOITEM.with("status", "gone") else row.get(i)),
      facts' = facts.exclude(itemsOf(b)),
      lastReq' = { kind: "deleted", b: b, rev: batch.get(b).rev, committed: true, lost: lost, receipt: true },
      everDeleted' = true,
    },
    collectReceipt' = collectReceipt, col' = col, plan' = plan, v1Receipts' = v1Receipts, v2Receipts' = v2Receipts,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore, v2Done' = v2Done,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, retryDeniedAfterCommit' = retryDeniedAfterCommit,
    consentProofWhileStopped' = consentProofWhileStopped,
    everAccepted' = everAccepted, replayed' = replayed, everPurged' = everPurged,
    turnAt' = turnAt, cmdAt' = cmdAt, consentProofs' = consentProofs, wTurnAt' = wTurnAt, wConn' = wConn, wCutoff' = wCutoff,
    keepClock, keepMember, keepCloud }

  // The gateway sends the same signed request again after a lost reply. EP calls PS priorReview first
  // (fix of SD-458): owned() must find the member and the review turn must still hold the stored result
  // (PS replayReview, spec/profileSuggestionReview.md storedReviewReplays); the stored "saved" or "deleted"
  // result comes back as it is; a stored "preview" comes back only while the batch keeps that revision and
  // has not expired (an older preview is stale, and a denial is correct). The replay reads only the
  // receipt, so `ok` needs it, while `stable` says whether the first result is still current (IPP-5).
  action retryLast = all {
    lastReq.lost,
    val bt = batch.get(lastReq.b)
    val previewCurrent = bt.exists and bt.rev == lastReq.rev and nowN < bt.expiresAt
    val ok = lastReq.receipt and ownedExists and (lastReq.kind != "preview" or previewCurrent)
    // A denial is a defect only when the owner still exists and the stored result is still current.
    val stable = ownedExists and (lastReq.kind != "preview" or previewCurrent)
    all {
      retryDeniedAfterCommit' = (retryDeniedAfterCommit or (lastReq.committed and stable and not(ok))),
      lastReq' = lastReq.with("lost", false),
    },
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt, col' = col, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore, v2Done' = v2Done,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted,
    replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepCloud, keepTurns }

  // PS applyRetention, first statement (SV purge): proposed rows of expired batches lose their text.
  // `for update skip locked` on batch rows: it never waits on the person lock of a running collect.
  action expireTick = all {
    ITEMS.exists(i => row.get(i).status == "proposed" and nowN >= batch.get(batchOf(i)).expiresAt),
    row' = ITEMS.mapBy(i => if (row.get(i).status == "proposed" and nowN >= batch.get(batchOf(i)).expiresAt)
                               row.get(i).with("status", "expired").with("hasValue", false)
                             else row.get(i)),
    batch' = batch, facts' = facts, collectReceipt' = collectReceipt, col' = col, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }

  // PS applyRetention, then (spec/platformRetention.md suggestionPastRetention, batchPastRetention; fix of
  // SD-376): a rejected, expired or withdrawn row of a batch that expired strictly before the cutoff
  // (now - RETENTION) is deleted, and a batch with no row left past the same cutoff is deleted.
  action retentionTick = all {
    val cutoff = nowN - RETENTION
    // An accepted row whose fact is gone is finished too (spec/platformRetention.md suggestionFinished, IPP-4).
    def purge(i: int): bool = (row.get(i).status.in(TERMINAL) or (row.get(i).status == "accepted" and not(i.in(facts))))
      and batch.get(batchOf(i)).exists and batch.get(batchOf(i)).expiresAt < cutoff
    val left = ITEMS.mapBy(i => if (purge(i)) NOITEM.with("status", "gone") else row.get(i))
    def empty(b: int): bool = batch.get(b).exists and batch.get(b).expiresAt < cutoff
      and itemsOf(b).forall(i => left.get(i).status == "gone" or left.get(i).status == "none")
    all {
      ITEMS.exists(i => purge(i)) or BATCHES.exists(b => empty(b)),
      row' = left,
      batch' = BATCHES.mapBy(b => if (empty(b)) NOBATCH else batch.get(b)),
      everPurged' = true,
    },
    facts' = facts, collectReceipt' = collectReceipt, col' = col, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore, v2Done' = v2Done,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, retryDeniedAfterCommit' = retryDeniedAfterCommit,
    consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted,
    replayed' = replayed,
    keepClock, keepMember, keepCloud, keepTurns }

  // ------------------------------------------------------------------ Google revocation and V1 (DE, PS:362-434)
  action revoke(c: int): bool = all {
    conn.get(c) == "active",
    conn' = conn.set(c, "revoked"), revokedAt' = revokedAt.set(c, nowC), learningConsent' = learningConsent,
    beforeRevoke' = beforeRevoke.set(c, authorizedItems.filter(i => itemConn(i) == c)),
    v1Done' = v1Done.filter(x => x._1 != c),
    created' = created, wBefore' = wBefore, v2Done' = v2Done, addedAfterStop' = addedAfterStop,
    addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor, acceptedAfterExpiry' = acceptedAfterExpiry,
    saidNothingSaved' = saidNothingSaved, touchedAfterCutoff' = touchedAfterCutoff,
    retryDeniedAfterCommit' = retryDeniedAfterCommit, consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted,
    replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepTurns, keepStore }
  // Upstream assumption: a reconnect is a later Cloud event, so its source proofs carry a later Cloud time.
  action reconnect(c: int): bool = all {
    conn.get(c) == "revoked", nowC > revokedAt.get(c), conn' = conn.set(c, "active"), revokedAt' = revokedAt, learningConsent' = learningConsent,
    keepClock, keepMember, keepTurns, keepStore, keepGhost }

  // One V1 transaction. The proof says connectionState "revoked" with revokedAt on the Cloud clock.
  // Rows are selected by source_authorized_at <= revokedAt, both on the Cloud clock (fix of SD-172), with
  // cleanupCoversGrant (spec/profileSuggestionSource.md); the collectCommit check uses the same rule.
  action v1(c: int, op: str, nonce: int): bool = all {
    reviewEnabled, conn.get(c) == "revoked", revokedAt.get(c) >= 0, ownedExists,
    val cut = revokedAt.get(c)
    if (v1Receipts.keys().contains(nonce))
      // Replay: same identity returns stored counts; any other identity is null (PS:377-391). No mutation.
      all { batch' = batch, row' = row, facts' = facts, v1Receipts' = v1Receipts,
            v1Done' = v1Done, touchedAfterCutoff' = touchedAfterCutoff }
    else
      def hit(i: int): bool = batch.get(batchOf(i)).exists and row.get(i).authAt <= cut and row.get(i).conn == c
        and row.get(i).status != "gone"
        and row.get(i).status != "none" and op != "readback"
        and not(op == "disconnect" and row.get(i).status == "accepted" and batch.get(batchOf(i)).retain)
      val hits = ITEMS.filter(i => hit(i))
      all {
        row' = ITEMS.mapBy(i => if (not(hit(i))) row.get(i)
                                 else if (op == "delete") NOITEM.with("status", "gone")
                                 else row.get(i).with("status", "withdrawn").with("hasValue", false).with("fact", false)
                                        ),
        facts' = facts.exclude(hits),
        batch' = BATCHES.mapBy(b => if (hits.exists(i => batchOf(i) == b)) batch.get(b).with("rev", batch.get(b).rev + 1)
                                    else batch.get(b)),
        v1Receipts' = v1Receipts.put(nonce, (c, op, cut)),
        v1Done' = v1Done.union(Set((c, op))),
        touchedAfterCutoff' = (touchedAfterCutoff or hits.exists(i => not(i.in(beforeRevoke.get(c))))),
      },
    collectReceipt' = collectReceipt, col' = col, plan' = plan, v2Receipts' = v2Receipts, lastReq' = lastReq,
    created' = created, beforeRevoke' = beforeRevoke, wBefore' = wBefore, v2Done' = v2Done,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    retryDeniedAfterCommit' = retryDeniedAfterCommit, consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted,
    replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepCloud, keepTurns }

  // ------------------------------------------------------------------ owner withdrawal V2 (WE, PS:437-520)
  // "stop learning from <connection>" as an open turn (arrived_at on the Network clock).
  action withdrawCmd(c: int): bool = all {
    turnOpen, wTurnAt == -1, wTurnAt' = nowN, wConn' = c,
    turnAt' = turnAt, cmdAt' = cmdAt, cmdUsed' = cmdUsed, consentProofs' = consentProofs, wCutoff' = wCutoff,
    keepClock, keepMember, keepCloud, keepStore, keepGhost }
  // Cloud records its canonical withdrawal event after the turn (upstream assumption); cutoffAt is Cloud time.
  action cloudWithdrawEvent = all {
    wTurnAt >= 0, wCutoff == -1, wCutoff' = nowC, learningConsent' = false,
    wBefore' = authorizedItems,
    turnAt' = turnAt, cmdAt' = cmdAt, cmdUsed' = cmdUsed, consentProofs' = consentProofs, wTurnAt' = wTurnAt, wConn' = wConn,
    conn' = conn, revokedAt' = revokedAt,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, v2Done' = v2Done,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    touchedAfterCutoff' = touchedAfterCutoff, retryDeniedAfterCommit' = retryDeniedAfterCommit,
    consentProofWhileStopped' = consentProofWhileStopped,
    everAccepted' = everAccepted, everDeleted' = everDeleted, replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepStore }

  action v2(op: str): bool = all {
    reviewEnabled, wCutoff >= 0, not(sealed), ownedExists,
    // The stored turn is bound by channel, message and command hash; its Network arrival time is not
    // compared with the Cloud cutoff (fix of SD-242).
    // PS:468-479: the receipt key is the withdrawal id, and its identity holds the operation and the
    // request hash. After one withdraw or delete of this withdrawal, every other request returns the
    // stored counts or null: no second mutation, also not with the other operation.
    if (v2Receipts != Set())
      all { batch' = batch, row' = row, facts' = facts, v2Receipts' = v2Receipts, v2Done' = v2Done,
            touchedAfterCutoff' = touchedAfterCutoff }
    else
      // Rows are selected by source_authorized_at <= cutoffAt, both on the Cloud clock (fix of SD-172),
      // with cleanupCoversGrant.
      def hit(i: int): bool = batch.get(batchOf(i)).exists and row.get(i).authAt <= wCutoff and row.get(i).conn == wConn
        and (if (op == "withdraw") row.get(i).status == "proposed" else row.get(i).status != "gone" and row.get(i).status != "none")
      val hits = ITEMS.filter(i => hit(i))
      all {
        row' = ITEMS.mapBy(i => if (not(hit(i))) row.get(i)
                                 else if (op == "delete") NOITEM.with("status", "gone")
                                 else row.get(i).with("status", "withdrawn").with("hasValue", false)),
        facts' = if (op == "delete") facts.exclude(hits) else facts,
        batch' = BATCHES.mapBy(b => if (hits.exists(i => batchOf(i) == b)) batch.get(b).with("rev", batch.get(b).rev + 1)
                                    else batch.get(b)),
        v2Receipts' = v2Receipts.union(Set(op)),
        v2Done' = v2Done.union(Set(op)),
        touchedAfterCutoff' = (touchedAfterCutoff or hits.exists(i => not(i.in(wBefore)))),
      },
    collectReceipt' = collectReceipt, col' = col, plan' = plan, v1Receipts' = v1Receipts, lastReq' = lastReq,
    created' = created, beforeRevoke' = beforeRevoke, v1Done' = v1Done, wBefore' = wBefore,
    addedAfterStop' = addedAfterStop, addedBannedOrHeld' = addedBannedOrHeld, addedMinor' = addedMinor,
    acceptedAfterExpiry' = acceptedAfterExpiry, saidNothingSaved' = saidNothingSaved,
    retryDeniedAfterCommit' = retryDeniedAfterCommit,
    consentProofWhileStopped' = consentProofWhileStopped, everAccepted' = everAccepted, everDeleted' = everDeleted,
    replayed' = replayed, everPurged' = everPurged,
    keepClock, keepMember, keepCloud, keepTurns }

  // ------------------------------------------------------------------ leave and delete everything
  // AC.leave (AC:472-481): consent event, then onForget (runtime forget: facets and, since the fix of
  // SD-463, profile suggestion batches deleted, person_id null, turns sealed), then forgetMembership
  // (state removed; the 0039 trigger deletes what is left). Three separate transactions; a crash can stop
  // the run between them, but the batches are already gone after the forget.
  action leaveConsent = all { leaveStage == "none", membership == "active" or membership == "paused",
    leaveStage' = "consent", ledgerStop' = true,
    projOut' = projOut, banned' = banned, held' = held, minor' = minor, membership' = membership,
    forgotten' = forgotten, sealed' = sealed,
    keepClock, keepCloud, keepTurns, keepStore, keepGhost }
  // The forget unit updates network.members (person_id null): it waits for the `for update of n` lock.
  action leaveForget = all { leaveStage == "consent",
    leaveStage' = "forgot", forgotten' = true, sealed' = true,
    facts' = Set(),
    // RT forget: delete from platform.profile_suggestion_batches (rows cascade). RT:592-595 resets the
    // member's inbound turns (action_receipts '{}'): the collect, review and V2 receipts go.
    batch' = BATCHES.mapBy(b => NOBATCH),
    row' = ITEMS.mapBy(i => if (row.get(i).status == "none") NOITEM else NOITEM.with("status", "gone")),
    ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, held' = held, minor' = minor, membership' = membership,
    collectReceipt' = Set(), col' = col, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = Set(), lastReq' = lastReq.with("receipt", false),
    keepClock, keepCloud, keepTurns, keepGhost }
  action leaveMembership = all { leaveStage == "forgot",
    leaveStage' = "done", membership' = "removed",
    // 0053 trigger on state 'removed': the batches and the V1 connection cleanup receipts go.
    batch' = BATCHES.mapBy(b => NOBATCH),
    row' = ITEMS.mapBy(i => if (row.get(i).status == "none") NOITEM else NOITEM.with("status", "gone")),
    facts' = Set(),
    ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, held' = held, minor' = minor,
    forgotten' = forgotten, sealed' = sealed,
    collectReceipt' = collectReceipt, col' = col, plan' = plan,
    v1Receipts' = Map(), v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepCloud, keepTurns, keepGhost }
  // Delete everything (PG:355-397): one transaction under the person lock. Memberships are deleted, turns
  // sealed. The membership delete trigger (0053, fix of SD-170) removes the batches and the V1 connection
  // cleanup receipts of the person and app.
  action deleteAll = all { membership != "deleted",
    membership' = "deleted", forgotten' = true, sealed' = true, leaveStage' = leaveStage,
    batch' = BATCHES.mapBy(b => NOBATCH),
    row' = ITEMS.mapBy(i => if (row.get(i).status == "none") NOITEM else NOITEM.with("status", "gone")),
    facts' = Set(),
    ledgerStop' = ledgerStop, projOut' = projOut, banned' = banned, held' = held, minor' = minor,
    // PG:369-371 resets the person's inbound turns (action_receipts '{}'): the collect, review and V2 receipts go.
    collectReceipt' = Set(), col' = col, plan' = plan,
    v1Receipts' = Map(), v2Receipts' = Set(), lastReq' = lastReq.with("receipt", false),
    keepClock, keepCloud, keepTurns, keepGhost }

  // ------------------------------------------------------------------ step
  // Pick a pending row; accept is the most common command; a stale token is the rarer case.
  action review = all { ITEMS.exists(j => row.get(j).status == "proposed"),
    nondet i = ITEMS.filter(j => row.get(j).status == "proposed").oneOf()
    nondet k = 1.to(4).oneOf()
    nondet s = 1.to(4).oneOf()
    nondet lost = Set(true, false).oneOf()
    decide(batchOf(i), i, if (k <= 2) "accept" else if (k == 3) "edit" else "reject", s == 1, lost) }
  // The member journey and the follow-up steps of each machine.
  action journey = any {
    nondet b = BATCHES.oneOf()
    nondet lost = Set(true, false).oneOf()
    any { memberCollectCmd(b), consentContext(b), collectBegin(b), deleteBatch(b, lost) },
    // A second collect on a turn that already committed (a gateway replay); repeated for the sampler only.
    all { collectReceipt != Set(), nondet b = collectReceipt.oneOf() collectBegin(b) },
    memberReviewCmd, collectSourceCall, collectCommit, stopProjection, start,
    review,
    retryLast, expireTick, retentionTick,
    nondet c = CONNS.oneOf() any { reconnect(c), withdrawCmd(c) },
    nondet c = CONNS.oneOf()
    nondet op = Set("disconnect", "delete", "readback").oneOf()
    nondet n = NONCES.oneOf()
    v1(c, op, n),
    cloudWithdrawEvent,
    nondet op = Set("withdraw", "delete").oneOf() v2(op),
    leaveForget, leaveMembership,
  }
  // Events from other actors that interrupt the journey and that it can recover from: Cloud, the gateway,
  // crashes, STOP (START undoes it), revocation (reconnect undoes it).
  action disturb = any {
    cloudClearConsent, collectCrash, stopLedger,
    nondet c = CONNS.oneOf() revoke(c),
  }
  // Events that end the journey for this person: ban, hold, age drop, leave, delete everything.
  action terminal = any { ban, hold, ageDrop, leaveConsent, deleteAll }
  action time = any { tick, tick, tickN, tickC, tickBy3 }
  // The in-flight collect transaction: its next Cloud call or its commit.
  action inflight = any { collectSourceCall, collectCommit }
  // The same transitions as `any { time, journey, disturb, terminal }` (inflight, memberReviewCmd,
  // review, expireTick, retentionTick and stopProjection are part of journey; stopLedger of disturb).
  // The repeated branches only change how often the random simulator picks each group: clock and
  // journey steps often, and an open collect transaction usually runs on, so that long journeys are
  // sampled. Apalache and the set of reachable states do not depend on these weights.
  action step =
    if (col.active) any { inflight, inflight, inflight, inflight, inflight, inflight, time, journey, disturb, terminal,
                          stopLedger, stopProjection }
    else any { time, time, journey, journey, journey, journey, journey, journey, memberReviewCmd, review, review,
               disturb, disturb, terminal, time, expireTick, retentionTick, retentionTick }

  // ------------------------------------------------------------------ invariants
  // INV-1. SQL check 0039:38: a proposed row has text; every other row has none.
  val inv_textOnlyWhenProposed = ITEMS.forall(i =>
    (row.get(i).status == "proposed") == row.get(i).hasValue)

  // INV-2. AF-1 (gap-connector-journey 7.2), PS:70 "only accepted values enter the canonical facet table":
  // a source fact exists only for an accepted row.
  val inv_factOnlyFromAccept = facts.forall(i => row.get(i).status == "accepted")

  // INV-3. collection-claim, PS:217-218 "replay cannot recreate erased private suggestions":
  // one batch per collect turn, at most one insert per batch id.
  val inv_oneBatchPerTurn = BATCHES.forall(b => created.get(b) <= 1)

  // INV-4. AGENTS.md age policy and founder decision 1: minors (13-17) never add source data (J-13).
  val inv_minorNeverAdds = not(addedMinor)

  // INV-5. AGENTS.md founder decision 3 (bans) and the eligibility rule in PS member(): a banned or held
  // person adds no source data. The check must hold when the data commits. (Q-profile_learning-1, fixed)
  val inv_bannedOrHeldNeverAdds = not(addedBannedOrHeld)

  // INV-6. PRD 40.3 (STOP stops every app) and the code comment LC:70 "STOP is canonical even when a
  // delayed projection has not reached the member row yet": no source data after the ledger says STOP
  // (J-14). (SD-175, fixed)
  val inv_noAddAfterStop = not(addedAfterStop)

  // INV-7. noEffectAfterExpiry: RV copy "Pending review expires <t>", PS:273: no accept after expiry.
  val inv_noAcceptAfterExpiry = not(acceptedAfterExpiry)

  // INV-8. EP:113 reply "Nothing new was saved" must be true (J-10). (SD-240, fixed)
  val inv_nothingSavedIsTrue = saidNothingSaved.forall(b => not(batch.get(b).exists))

  // INV-9. DE:24 and WE:21 comments: "Never affect batches created AFTER proof.revokedAt / cutoffAt,
  // including reconnect/replay." Real-time order, not clock values: a cleanup changes only rows whose
  // source proof came before the Cloud event. (SD-172, fixed: both sides of the comparison are Cloud time.)
  val inv_cutoffRespected = not(touchedAfterCutoff)

  // INV-10. retainFalseGone: RV:31 copy "If Google is disconnected: remove these accepted facts" and DE:22
  // "disconnect honors retention": after V1 disconnect, no retain=false fact whose source proof came
  // before the revocation stays (J-4). (SD-172, fixed)
  val inv_retainFalseGone = v1Done.forall(x => x._2 != "disconnect" or ITEMS.forall(i =>
    (i.in(beforeRevoke.get(x._1)) and row.get(i).conn == x._1 and batch.get(batchOf(i)).exists
      and not(batch.get(batchOf(i)).retain)) implies not(i.in(facts))))

  // INV-11. DE:22-23, WE:19-20 "delete removes all connection-linked suggestions/facts regardless of
  // retention" (J-5), for V1 and V2 delete. (SD-172, fixed)
  val inv_deleteErases =
    v1Done.forall(x => x._2 != "delete" or ITEMS.forall(i =>
      (i.in(beforeRevoke.get(x._1)) and row.get(i).conn == x._1)
        implies (not(i.in(facts)) and not(row.get(i).hasValue))))
    and (v2Done.contains("delete") implies ITEMS.forall(i =>
      (i.in(wBefore) and row.get(i).conn == wConn) implies (not(i.in(facts)) and not(row.get(i).hasValue))))

  // INV-12. WE:13-14 "proof of durable canonical owner withdrawal command/event": a withdrawal that Cloud
  // recorded after the member's turn is not refused for clock reasons. (SD-242, fixed: v2 has no guard
  // that compares the Network turn time with the Cloud cutoff; v2SkewTest shows it applies.)

  // INV-13. 0039:60 comment "The existing app leave/delete path cannot retain these new private records"
  // (J-6): once the member is forgotten, no batch stays. (SD-463, fixed)
  val inv_leaveErases = forgotten implies BATCHES.forall(b => not(batch.get(b).exists))

  // INV-14. AC:483 comment "Delete everything: ... keep a tombstone and the suppression hash" and PRD
  // section 30 member deletion: Cloud identity rows (user, org, chat, connection) do not stay. (SD-170, fixed)
  // The 0053 trigger also removes them on a leave (state 'removed').
  val inv_deleteAllErasesIdentity = (membership == "deleted" or membership == "removed") implies v1Receipts.keys() == Set()

  // INV-15. AGENTS.md "/internal/turn ... respond within 8 s" and PRD 40.3: the STOP projection does not
  // wait on a Cloud round trip. (SD-112, fixed: no action holds the person or member row lock across a
  // Cloud call; witness_stopProjectedDuringCollect shows the projection runs while a collect is open.)

  // INV-16. The 5 s source proof (core/src/svc/profile-review-source.ts parseProfileReviewSourceProof) and PF:92 min(): one Cloud source call per
  // distinct (source, connection) in one transaction, else the earliest proof bounds the whole batch.
  // (SD-455, fixed)
  val inv_oneSourceCallPerScope = col.active implies col.calls <= scopesOf(col.b).size()

  // INV-17. AGENTS.md service contract "idempotent on x-ntwrk-svc-id": a retried request that committed
  // returns its first result, not a denial, while the owner exists and a stored preview is still current.
  // (SD-458, fixed)
  val inv_retryKeepsResult = not(retryDeniedAfterCommit)

  // INV-18. PF:99 "no flag or incomplete real scope means no automatically granted access": no learning
  // consent proof while profile review is off. (SD-464, fixed)
  val inv_consentNeedsReview = consentProofs != Set() implies reviewEnabled

  // INV-19. PRD 33 "data retention schedule" and spec/platformRetention.md "Finished profile suggestions
  // leave after the platform cutoff": retention never removes the batch of a saved fact, so a later
  // disconnect or delete still finds it. (SD-376, fixed: retentionTick; retentionTest shows the purge.)
  val inv_factKeepsItsBatch = facts.forall(i => batch.get(batchOf(i)).exists)

  // INV-20. noProofAfterStop: LC:75-94 reads the ledger twice; no consent proof after STOP.
  val inv_noConsentProofAfterStop = not(consentProofWhileStopped)

  // Every invariant that the fixed code must keep.
  val safety = and {
    inv_textOnlyWhenProposed, inv_factOnlyFromAccept, inv_oneBatchPerTurn, inv_minorNeverAdds,
    inv_bannedOrHeldNeverAdds, inv_noAddAfterStop, inv_noAcceptAfterExpiry, inv_nothingSavedIsTrue,
    inv_leaveErases, inv_deleteAllErasesIdentity, inv_oneSourceCallPerScope,
    inv_retryKeepsResult, inv_consentNeedsReview, inv_noConsentProofAfterStop,
    inv_cutoffRespected, inv_retainFalseGone, inv_deleteErases, inv_factKeepsItsBatch,
  }

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_batchCommitted = not(BATCHES.exists(b => batch.get(b).exists))
  val witness_factAccepted = not(everAccepted)
  val witness_batchDeleted = not(everDeleted)
  val witness_collectReplayed = not(replayed)
  val witness_v1Applied = not(v1Done != Set())
  val witness_v2Applied = not(v2Done != Set())
  val witness_leaveDone = not(membership == "removed")
  val witness_stopProjected = not(projOut)
  val witness_stopProjectedDuringCollect = not(col.active and ledgerStop and projOut)
  val witness_finishedRowsPurged = not(everPurged)

  // ------------------------------------------------------------------ run tests (concrete traces)
  action skip = all { keepClock, keepMember, keepCloud, keepTurns, keepStore, keepGhost }

  // Begin a collect with a fixed plan: item 1 (conn c1, Calendar if cal1, in the future if future), item 2
  // (conn c2, Calendar if cal2, in the past), ttl 4.
  action collectPlan(b: int, c1: int, cal1: bool, c2: int, cal2: bool, future: bool, retain: bool): bool = all {
    reviewEnabled, not(col.active), turnAt.get(b) >= 0, nowN - turnAt.get(b) < PARENT, not(sealed), ownedExists, eligible,
    plan' = plan.set(2 * b - 1, { conn: c1, cal: cal1, obs: if (cal1 and future) nowN + 2 else nowN - 1, authAt: -1 })
                .set(2 * b, { conn: c2, cal: cal2, obs: nowN - 1, authAt: -1 }),
    col' = { active: true, b: b, at: nowN, calls: 0, until: INF, ttl: 4, retain: retain },
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts, lastReq' = lastReq,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }
  // Two scopes on connection c: a Calendar row (item 1) and a Gmail row (item 2): two source calls.
  action collectFixed(b: int, c: int, future: bool, retain: bool): bool = collectPlan(b, c, true, c, false, future, retain)

  // Collect, accept, delete: the happy path of profile-suggestions.integration.test.ts.
  run collectAcceptDeleteTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .expect(batch.get(1).exists and row.get(1).status == "proposed" and saidNothingSaved == Set())
      .then(memberReviewCmd).then(decide(1, 1, "accept", false, false))
      .expect(facts == Set(1) and batch.get(1).rev == 2)
      .then(memberReviewCmd).then(deleteBatch(1, false))
      .expect(not(batch.get(1).exists) and facts == Set() and safety)

  // A second collect with the same turn is a replay and inserts nothing.
  run collectReplayTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .expect(replayed and created.get(1) == 1 and inv_oneBatchPerTurn)

  // SD-455 (fixed): two Gmail rows on one connection are one scope: one source call, then the commit.
  // A second call is not enabled.
  run oneSourceCallTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectPlan(1, 2, false, 2, false, false, false)).then(collectSourceCall)
      .expect(col.calls == 1 and inv_oneSourceCallPerScope)
      .then(collectCommit)
      .expect(batch.get(1).exists and safety)

  // SD-455 (fixed): the same scope cannot make a second call.
  run noSecondSourceCallTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectPlan(1, 2, false, 2, false, false, false)).then(collectSourceCall).then(collectSourceCall)
      .fail()

  // SD-240 (fixed): a future Calendar row: the batch commits, renders, and the member can reject the row.
  run futureCalendarTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, true, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .expect(batch.get(1).exists and renderable(1) and row.get(1).obs > nowN and inv_nothingSavedIsTrue)
      .then(memberReviewCmd).then(decide(1, 1, "reject", false, false))
      .expect(row.get(1).status == "rejected" and safety)

  // SD-175 (fixed): STOP reaches the ledger after the consent proof; the projection has not run. A new
  // collect cannot begin.
  run stopLedgerBlocksBeginTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1)).then(stopLedger)
      .then(collectFixed(1, 1, false, false))
      .fail()

  // SD-175 and Q-profile_learning-1 (fixed): STOP reaches the ledger during the Cloud calls. The member()
  // read after the last call sees it: rollback, no batch.
  run stopLedgerDuringCollectTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(stopLedger).then(collectSourceCall)
      .then(collectCommit)
      .expect(not(col.active) and not(batch.get(1).exists) and not(projOut) and safety)

  // Q-profile_learning-1 (fixed): a ban during the Cloud source calls: no batch.
  run banDuringCollectTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(ban).then(collectSourceCall)
      .then(collectCommit)
      .expect(not(batch.get(1).exists) and created.get(1) == 0 and safety)

  // Q-profile_learning-1 (fixed): a hold after the collect: accept is denied, reject is allowed.
  run holdBlocksAcceptTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd).then(hold)
      .then(decide(1, 1, "accept", false, false))
      .fail()

  // SD-175 in decide (fixed): STOP reaches the ledger after the collect; the projection has not run. PS
  // memberRow reads the ledger, so an accept is denied (decide also sets addedAfterStop on an accept).
  run stopLedgerBlocksAcceptTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd).then(stopLedger)
      .then(decide(1, 1, "accept", false, false))
      .fail()

  // SD-112 (fixed): STOP during the Cloud calls: the projection runs while the collect is open, and the
  // commit then sees the STOP: no batch.
  run stopDuringCollectTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(stopLedger).then(stopProjection)
      .expect(col.active and projOut)
      .then(collectSourceCall).then(collectCommit)
      .expect(not(batch.get(1).exists) and safety)

  // SD-112 (fixed): a V1 delete commits between the source calls and the commit: the commit refuses the
  // batch, so the revoked data does not come back.
  run cleanupDuringCollectTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall)
      .then(revoke(1)).then(v1(1, "delete", 1)).then(collectCommit)
      .expect(not(batch.get(1).exists) and inv_deleteErases and safety)

  // SD-458 (fixed): accept commits, the reply is lost, the gateway retries: the stored result comes back.
  run decideRetryTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd)
      .then(decide(1, 1, "accept", false, true))
      .then(retryLast)
      .expect(inv_retryKeepsResult and facts == Set(1) and batch.get(1).rev == 2 and safety)

  // SD-458 (fixed): an edit, then a delete, each with a lost reply: both retries get the stored result.
  run editDeleteRetryTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd)
      .then(decide(1, 1, "edit", false, true)).then(retryLast)
      .expect(inv_retryKeepsResult and batch.get(1).rev == 2)
      .then(memberReviewCmd).then(deleteBatch(1, true)).then(retryLast)
      .expect(inv_retryKeepsResult and not(batch.get(1).exists) and safety)

  // IPP-5: the retry invariant can fail. A commit whose review receipt is gone while the owner stays makes
  // the retry deny a current result; this run removes the receipt by hand to show the check is live.
  action dropReviewReceipt = all { lastReq.receipt, lastReq' = lastReq.with("receipt", false),
    batch' = batch, row' = row, facts' = facts, collectReceipt' = collectReceipt, col' = col, plan' = plan,
    v1Receipts' = v1Receipts, v2Receipts' = v2Receipts,
    keepClock, keepMember, keepCloud, keepTurns, keepGhost }
  run retryWithoutReceiptTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd)
      .then(decide(1, 1, "accept", false, true))
      .then(dropReviewReceipt).then(retryLast)
      .expect(retryDeniedAfterCommit and not(inv_retryKeepsResult))

  // One review turn applies one command (PS:271, PS:332): a delete on the turn of the accept is refused.
  run oneCommandPerTurnTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd).then(decide(1, 1, "accept", false, false))
      .then(deleteBatch(1, false))
      .fail()

  // SD-463 (fixed): leave stops after onForget: no batch stays.
  run leaveCrashTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(leaveConsent).then(leaveForget)
      .expect(not(batch.get(1).exists) and not(ownedExists) and membership == "active" and safety)

  // SD-170 (fixed): delete everything after a V1 cleanup removes the receipt.
  run deleteAllReceiptTest =
    initWith(true)
      .then(revoke(1)).then(v1(1, "readback", 1))
      .expect(v1Receipts.keys() == Set(1))
      .then(deleteAll)
      .expect(v1Receipts.keys() == Set() and safety)

  // SD-464 (fixed): with review off the consent context signs nothing.
  run consentWithoutReviewTest =
    initWith(false)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .fail()

  // SD-172 (fixed): the Network clock runs ahead; V1 disconnect still removes the retain=false fact of a
  // row whose source proof came before the revocation.
  run cutoffSkewTest =
    initWith(true)
      .then(tickN).then(tickN).then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd).then(decide(1, 1, "accept", false, false))
      .then(revoke(1)).then(v1(1, "disconnect", 1))
      .expect(not(1.in(facts)) and inv_retainFalseGone and safety)

  // SD-172 (fixed): V1 delete with the Network clock ahead erases the pending text.
  run deleteSkewTest =
    initWith(true)
      .then(tickN).then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(revoke(1)).then(v1(1, "delete", 1))
      .expect(not(row.get(1).hasValue) and inv_deleteErases and safety)

  // SD-172 (fixed): V2 withdraw does not touch a batch whose source proof came after the withdrawal event.
  run v2AfterCutoffTest =
    initWith(true)
      .then(withdrawCmd(1)).then(cloudWithdrawEvent).then(tick)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(v2("withdraw"))
      .expect(row.get(1).status == "proposed" and inv_cutoffRespected and safety)

  // SD-242 (fixed): Cloud records the withdrawal one tick behind the Network turn time: V2 applies.
  run v2SkewTest =
    initWith(true)
      .then(tickN).then(withdrawCmd(1)).then(cloudWithdrawEvent).then(v2("delete"))
      .expect(v2Done.contains("delete") and safety)

  // SD-376 (fixed): an expired row and its empty batch go after RETENTION; an accepted row stays.
  run retentionTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(tick).then(tick).then(tick).then(tick).then(expireTick)
      .expect(row.get(1).status == "expired")
      .then(tick).then(tick).then(tick).then(retentionTick)
      .expect(row.get(1).status == "gone" and not(batch.get(1).exists) and safety)

  // SD-376 (fixed): retention keeps the batch of an accepted fact.
  run retentionKeepsFactTest =
    initWith(true)
      .then(memberCollectCmd(1)).then(consentContext(1))
      .then(collectFixed(1, 1, false, false)).then(collectSourceCall).then(collectSourceCall).then(collectCommit)
      .then(memberReviewCmd).then(decide(1, 1, "accept", false, false))
      .then(tick).then(tick).then(tick).then(tick).then(expireTick)
      .then(tick).then(tick).then(tick).then(retentionTick)
      .expect(row.get(2).status == "gone" and batch.get(1).exists and facts == Set(1) and safety)
}
```
