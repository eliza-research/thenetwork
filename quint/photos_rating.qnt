// quint-check: max-steps=40 max-samples=10000 verify-steps=6
//
// Photos and the Clef rating of one slop.date member (module plan: docs/research/2026-11-07-state-machines.md
// section 6.13). Machines: photo-object, photo-consent, clef-rating, slop-probe-photo.
//
// The model follows the code on branch wave2/photos_rating (after the fixes 4d3258d, fb126c6, 1a48ff7, 4fe59a5):
//   packages/platform/src/photos.ts          PhotoService (PH): upload, show, hide, deleteFor, end, sweep, rate
//   packages/network/service/service.ts      SV: purge (sweep, reconcileAges), the hooks (onForget, ageLowered),
//                                            verifiedAdult, dropRatings, writeRating, verify, ban, inbound photos
//   packages/network/service/photoIntake.ts  PI: photos by text and the YES PHOTOS / NO PHOTOS answer
//   packages/platform/src/accounts.ts        A: recordAge, leave, deleteAll
//   packages/network/service/packs.ts        PK: the probe text hook (SLOP_PROBE_PHOTOS)
//
// Scope: 1 person, 1 app (slop), 3 upload request ids, a photo limit of 2 (the code has 6: the race does
// not depend on the value), 1 crash. Every `await` between two writes is one action. Each request runs in
// memory: a crash ends every request in flight. The service purge (SV:596-610) is the only recovery: it
// sweeps photo rows a crash left hidden (PH:631-636) and runs the age hook again (SV:866-876).
// A row with deleted_at set ("hidden") is not a photo: no read sees it (PH:350-353).
// The rater (Clef) is an oracle: it returns a score, a refusal (null) or an error.
// deleteFor ends its rows (rating, bytes, row) in one action; a crash inside it leaves hidden rows that the
// sweep ends, the same end state.
//
// OPEN DRIFT (2026-11-09 review; not modelled): onForget (SV:830-839) skips deleteFor for a banned person
// (8e96df9, SD-275, SD-256, SD-178: the safety team keeps the photos). leaveHide and delHide here always
// hide every row, and noPhotoAfterForget, noPhotoForForgottenMember and photoOnlyForAdult (deleted) have
// no ban exception. The rules need a founder decision before the model follows the code.
module photos_rating {

  // ---------------------------------------------------------------- constants
  pure val UPLOADS: Set[int] = Set(1, 2, 3)
  /** PHOTO_MAX_PER_PERSON (PH:99 is 6; 2 here). */
  pure val MAX_PHOTOS: int = 2
  /** PHOTO_CONSENT.version (PH:106): a constant of the build. */
  pure val CONSENT: str = "2026-10-08"
  pure val HEADERS: Set[str] = Set(CONSENT, "old", "")
  pure val ADULT_AGE: int = 25
  pure val MINOR_AGE: int = 15
  /** The photo_consent pending row is read for one day (PI:120); one tick is half a day. */
  pure val DAY: int = 2
  pure val MAX_TICK: int = 4
  pure val MAX_CRASHES: int = 1
  /**
   * The probe hook (PK:245-258) as the code calls the engine: probePhotoRefs({ age, photoConsent: SLOP_PROBE_PHOTOS,
   * photoIds: [] }, { age }), then slopProbeMessage(..., photos).text. The flag is a build constant (PK:47, false
   * now); the model lets it be either value (st.probeFlag), because the hook must stay honest when it is turned on.
   * PROBE_HOOK_IDS is the literal photoIds: [] the hook passes; PROBE_HOOK_KEEPS_PHOTOS is false because the hook
   * returns only .text, so no photo id goes out with the probe.
   */
  def probeHookIds(s: State): Set[int] = Set()
  pure val PROBE_HOOK_KEEPS_PHOTOS: bool = false
  /** engine plan.ts:84-87 probePhotoRefs: adults both sides, photo consent, not held, opaque ids, at most PROBE_PHOTO_MAX (1). */
  pure def probePhotoRefs(subjectAge: int, consent: bool, held: bool, ids: Set[int], recipientAge: int): Set[int] =
    if (subjectAge < 18 or recipientAge < 18 or not(consent) or held or ids == Set()) Set()
    else Set(ids.fold(0, (m, x) => if (x > m) x else m))
  /** engine copy.ts:56-62 slopProbeMessage: the photo line is in the text exactly when a photo id goes with it. */
  pure def probeTextClaims(refs: Set[int]): bool = refs != Set()
  /**
   * The facet the rating is stored as: SV writeRating (service.ts:1888-1890) inserts privacy_scope 'agent_private',
   * provenance 'inferred', source 'photo_rater', status 'confirmed', kind from appearanceFacet ("appearance").
   */
  type Facet = { kind: str, scope: str, provenance: str, source: str, status: str }
  pure val RATING_FACET: Facet = { kind: "appearance", scope: "agent_private", provenance: "inferred", source: "photo_rater", status: "confirmed" }
  /** Other facets of the member: a private fact the member said (export shows it), a staff check (export hides it). */
  pure val OTHER_FACETS: Set[Facet] = Set(
    { kind: "fact", scope: "agent_private", provenance: "said", source: "text", status: "confirmed" },
    { kind: "fact", scope: "agent_private", provenance: "vouched", source: "staff", status: "confirmed" },
    { kind: "interest", scope: "matchable", provenance: "said", source: "web_join", status: "confirmed" })
  /** SV exportMember (service.ts:941-942): privacy_scope <> 'agent_private' or (confirmed and (said or gmail or calendar)). */
  pure def exportShows(f: Facet): bool =
    f.scope != "agent_private" or (f.status == "confirmed" and (f.provenance == "said" or Set("gmail", "google_calendar").contains(f.source)))
  /** Membership states that may be rated (PH:535-544) or send photos (PI:32). */
  pure val LIVE: Set[str] = Set("active", "paused", "onboarding")
  /** What any route, export or console can show about photos (member list, staff links; SV exportMember excludes agent_private). */
  pure val MEMBER_LIST_FIELDS: Set[str] = Set("id", "createdAt", "bytes", "contentType")
  pure val STAFF_LINK_FIELDS: Set[str] = Set("id", "url", "expiresAt")
  /** The sagas whose deleteFor hides rows and then ends them (PH:613-618). */
  pure val SAGAS: Set[str] = Set("age", "verify", "leave", "del")

  // ---------------------------------------------------------------- state
  type State = {
    // the person (platform.people) and their network-side facts
    age: int,               // people.lowest_age (A:293 noteAge keeps the least)
    netAge: int,            // network.members.age (SV:854-858 lowers it; reconcileAges reads it)
    ageFail: bool,          // facet <member>:verify:age with verify:age:fail (SV:1907-1915)
    banned: bool,           // platform.bans
    deleted: bool,          // people.deleted_at (delete everything)
    membership: str,        // platform.memberships.state: active | restricted | removed
    netMember: bool,        // network.members row live with an age (forget sets age null: runtime.ts:617)
    profileConsent: bool,   // memberships.profile.photoConsent == CONSENT (PI:126)
    // photo-object
    objects: Set[int],      // object storage keys (the upload id stands for the random key)
    rows: Set[int],         // platform.photos rows with deleted_at null (the photos every read sees)
    hidden: Set[int],       // platform.photos rows with deleted_at set (an upload not shown yet, a delete not ended)
    rowVersion: int -> str, // platform.photos.consent_version
    uplHeader: int -> str,  // the consent version the upload request carried (PH:505 consentVersion; PI:101 passes the constant)
    // clef-rating
    rating: bool,           // facet <member>:appearance (SV:1879)
    ratingFrom: Set[int],   // the photos the stored score was made from
    rateDue: bool,          // an upload or delete awaits its rate() call (PH:525, PH:608)
    ratePc: str,            // idle | checked | read | returned | passed | written | dropping
    rateIds: Set[int],
    // requests in flight
    upl: int -> str,        // idle | checked | counted | put | bytes | refused | unbytes (PH:505-528)
    used: Set[int],         // request ids already spent
    rmPc: str,              // idle | hidden | dropped | bytesGone              (PH:604-610, end PH:621-625)
    rmId: int,
    ageSaga: str,           // idle | committed | hidden | ended | dropped      (A:296, SV:850-859)
    verifySaga: str,        // idle | committed | hidden | ended                (SV:1903-1921)
    banSaga: str,           // idle | banned | dropped                          (SV:2010-2042)
    leaveSaga: str,         // idle | consent | netGone | hidden | ended        (A:472-481, onForget SV:830-839)
    delSaga: str,           // idle | floor | netGone | hidden | ended          (A:484-497, onForget SV:830-839)
    sagaIds: str -> Set[int], // the rows each saga's deleteFor hid and still has to end
    // photo-consent by text
    pending: bool,          // pending_texts kind photo_consent (PI:92)
    pendingAt: int,
    caPc: str,              // idle | read | checked                            (PI:119-131)
    caSnap: str,            // the membership state read at PI:122
    yesGiven: bool,         // a YES PHOTOS answer was written (PI:126)
    // probe photo
    probeSent: bool,
    probeClaims: bool,      // the probe text says a photo is attached (slopProbeMessage)
    probeAttached: bool,    // a photo id goes out with the probe
    probeFlag: bool,        // SLOP_PROBE_PHOTOS (PK:47), a build constant: either value
    probeWithPhotos: bool,  // observation: a probe ran with the flag on, live photos and an adult recipient
    exportedRated: bool,    // observation: an export ran while a rating was stored
    // observation
    shown: Set[str],
    usedInMatching: bool,
    hadPhotos: bool,
    leftDone: bool,
    textStored: bool,
    turnPhotoDropped: bool,
    showRefused: bool,
    swept: bool,
    reconciled: bool,
    // crash residue that this branch does not fix (see the invariants)
    rateWriteCrash: bool,   // Q-photos_rating-2: a crash between onRating and check 3 after a change
    // A crash inside a staff or forget saga that nothing resumes (SD-005 / X8, Q-photos_rating-3). Each residue is
    // scoped to what the crash left: the photo ids a saga had still to delete, or the rating it had still to drop.
    // A rule leaves out only that residue; any other photo or rating is still checked.
    verifyLeft: Set[int],   // rows live when a crash ended the failed-age-check saga before its hideAll (SV:1915-1918)
    forgetLeft: Set[int],   // rows and bytes live when a crash ended a leave or delete-everything after the forget (SV:834-835)
    ratingLeft: bool,       // a rating live when a crash ended the ban or failed-age-check saga before its dropRatings
    now: int,
    crashes: int,
    last: str,
  }

  var st: State

  // ---------------------------------------------------------------- guards from the code
  /** PH:486-492 adult(): lowest age 18+, not deleted, and eligible (SV:1845-1858 verifiedAdult: live membership, member age 18+, no verify:age:fail). */
  def adultNow(s: State): bool =
    not(s.deleted) and s.age >= 18 and LIVE.contains(s.membership) and s.netMember and not(s.ageFail)
  /** PH:498-503 mayTake(): storage on, slop, not banned, adult. */
  def mayTakeNow(s: State): bool = not(s.banned) and adultNow(s)
  /** PH:535-544 ratingRefusal(): mayTake, a live membership, and every rated photo still there. */
  def ratingOk(s: State, ids: Set[int]): bool = mayTakeNow(s) and LIVE.contains(s.membership) and ids.subseteq(s.rows)

  def quiescent(s: State): bool = and {
    UPLOADS.forall(u => s.upl.get(u) == "idle"),
    s.ratePc == "idle", s.rmPc == "idle", s.ageSaga == "idle", s.verifySaga == "idle",
    s.banSaga == "idle", s.leaveSaga == "idle", s.delSaga == "idle", s.caPc == "idle",
  }
  /** Hidden rows that a request in flight still owns (an upload not shown or undone, a delete not ended). */
  def owned(s: State): Set[int] =
    UPLOADS.filter(u => Set("put", "bytes", "refused", "unbytes").contains(s.upl.get(u)))
      .union(if (s.rmPc != "idle") Set(s.rmId) else Set())
      .union(s.sagaIds.get("age")).union(s.sagaIds.get("verify")).union(s.sagaIds.get("leave")).union(s.sagaIds.get("del"))
  /**
   * PH:631-636 sweep(): rows hidden for PHOTO_PENDING_MS (1 hour). The model assumes that a request in
   * flight ends within that hour, so the sweep takes only the hidden rows that no request owns.
   */
  def abandoned(s: State): Set[int] = s.hidden.exclude(owned(s))
  /** SV:866-876 reconcileAges(): lowest age under 18 and a live photo, or a live member whose age is above it. */
  def reconcileDue(s: State): bool =
    not(s.deleted) and s.age < 18 and (s.rows != Set() or (s.netMember and s.netAge > s.age))
  /** No request in flight and nothing left for the service purge (used by the run tests and witnesses). */
  def settled(s: State): bool = quiescent(s) and abandoned(s) == Set() and not(reconcileDue(s))

  /** PH:621-625 end(r) for each row: onRemoved (dropRatings for the app), then the bytes, then the row. */
  def endRows(s: State, ids: Set[int]): State =
    { ...s, objects: s.objects.exclude(ids), hidden: s.hidden.exclude(ids),
      rating: if (ids == Set()) s.rating else false, ratingFrom: if (ids == Set()) s.ratingFrom else Set() }
  /** PH:435-443 hideAll under the person row lock: every live row becomes hidden; the saga keeps the ids. */
  def hideAll(s: State, saga: str): State =
    { ...s, rows: Set(), hidden: s.hidden.union(s.rows), sagaIds: s.sagaIds.set(saga, s.rows) }
  /** PH:631-636 sweep(): end every abandoned hidden row. */
  def sweepOnce(s: State): State = endRows(s, abandoned(s))
  /** The same at quiescence: no request owns a hidden row, so the sweep takes every hidden row. */
  def sweepQuiet(s: State): State = endRows(s, s.hidden)
  /** SV:850-859 ageLowered with every step done: deleteFor (hide, end), dropRatings, member ages. */
  def ageLoweredAll(s: State): State =
    val e = endRows(hideAll(s, "age"), s.rows)
    { ...e, sagaIds: s.sagaIds, rating: false, ratingFrom: Set(),
      netAge: if (s.membership != "removed" and s.age < s.netAge) s.age else s.netAge }
  /**
   * One pass of the service purge at quiescence (SV:606-607): the sweep, then reconcileAges. The rules are
   * checked on the state after this pass, so a recovery that does not cover a crash residue makes a rule fail.
   */
  def purged(s: State): State =
    val w = sweepQuiet(s)
    if (reconcileDue(w)) ageLoweredAll(w) else w

  // ---------------------------------------------------------------- init
  action initWith(probeFlag: bool): bool = st' = {
    age: ADULT_AGE, netAge: ADULT_AGE, ageFail: false, banned: false, deleted: false, membership: "active", netMember: true,
    profileConsent: false,
    objects: Set(), rows: Set(), hidden: Set(), rowVersion: UPLOADS.mapBy(u => ""), uplHeader: UPLOADS.mapBy(u => ""),
    rating: false, ratingFrom: Set(), rateDue: false, ratePc: "idle", rateIds: Set(),
    upl: UPLOADS.mapBy(u => "idle"), used: Set(), rmPc: "idle", rmId: 0,
    ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle",
    sagaIds: SAGAS.mapBy(k => Set()),
    pending: false, pendingAt: 0, caPc: "idle", caSnap: "", yesGiven: false,
    probeSent: false, probeClaims: false, probeAttached: false, probeFlag: probeFlag,
    probeWithPhotos: false, exportedRated: false,
    shown: Set(), usedInMatching: false, hadPhotos: false, leftDone: false, textStored: false, turnPhotoDropped: false,
    showRefused: false, swept: false, reconciled: false, rateWriteCrash: false,
    verifyLeft: Set(), forgetLeft: Set(), ratingLeft: false,
    now: 0, crashes: 0, last: "init",
  }
  action init = { nondet f = Set(true, false).oneOf() initWith(f) }

  // ---------------------------------------------------------------- photo-object: upload (PH:505-528)
  /** PH:506-510: storage, app, the consent header, then mayTake (one read of the current state). */
  action uploadStart(u: int, header: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)),
    if (header == CONSENT and mayTakeNow(st))
      st' = { ...st, upl: st.upl.set(u, "checked"), used: st.used.union(Set(u)), uplHeader: st.uplHeader.set(u, header), last: "uploadStart" }
    else
      st' = { ...st, last: "uploadRefused" },
  }
  /** PH:514: an early count read (live rows). The limit is checked again in show. */
  action uploadCount(u: int): bool = all {
    st.upl.get(u) == "checked",
    if (st.rows.size() >= MAX_PHOTOS) st' = { ...st, upl: st.upl.set(u, "idle"), last: "uploadTooMany" }
    else st' = { ...st, upl: st.upl.set(u, "counted"), last: "uploadCount" },
  }
  /** PH:521 meta.put: the row is inserted hidden (deleted_at = created_at) before the bytes. */
  action uploadPut(u: int): bool = all {
    st.upl.get(u) == "counted",
    // The row stores the version the request carried (PH:519 consentVersion), not a constant of the model.
    st' = { ...st, upl: st.upl.set(u, "put"), hidden: st.hidden.union(Set(u)), rowVersion: st.rowVersion.set(u, st.uplHeader.get(u)), last: "uploadPut" },
  }
  /** PH:522: storage.put of the stripped bytes under a new random key. */
  action uploadBytes(u: int): bool = all {
    st.upl.get(u) == "put",
    st' = { ...st, upl: st.upl.set(u, "bytes"), objects: st.objects.union(Set(u)), last: "uploadBytes" },
  }
  /**
   * PH:524 meta.show (PH:413-423): one transaction that locks the person row, runs mayTake again, counts the
   * live rows and shows the row. Then rate() (PH:526). SD-052, SD-372.
   */
  action uploadShow(u: int): bool = all {
    st.upl.get(u) == "bytes",
    if (mayTakeNow(st) and st.rows.size() < MAX_PHOTOS and st.hidden.contains(u))
      st' = { ...st, upl: st.upl.set(u, "idle"), rows: st.rows.union(Set(u)), hidden: st.hidden.exclude(Set(u)),
              rateDue: true, hadPhotos: true, last: "uploadShow" }
    else st' = { ...st, upl: st.upl.set(u, "refused"), showRefused: true, last: "uploadShowRefused" },
  }
  /** PH:525: a refused upload removes its bytes (storage.delete), then its hidden row (meta.delete): two awaits. */
  action uploadUndo(u: int): bool = all {
    st.upl.get(u) == "refused",
    st' = { ...st, upl: st.upl.set(u, "unbytes"), objects: st.objects.exclude(Set(u)), last: "uploadUndo" },
  }
  action uploadUndoRow(u: int): bool = all {
    st.upl.get(u) == "unbytes",
    st' = { ...st, upl: st.upl.set(u, "idle"), hidden: st.hidden.exclude(Set(u)), last: "uploadUndoRow" },
  }

  // ---------------------------------------------------------------- photo-object: member delete (PH:604-610)
  /** PH:605 meta.hide: the row is hidden first (one statement). */
  action removeStart(p: int): bool = all {
    st.rmPc == "idle", st.rows.contains(p),
    st' = { ...st, rmPc: "hidden", rmId: p, rows: st.rows.exclude(Set(p)), hidden: st.hidden.union(Set(p)), last: "removeStart" },
  }
  /** PH:622 end: onRemoved (SV:397 dropRatings for the app). */
  action removeDrop: bool = all {
    st.rmPc == "hidden",
    st' = { ...st, rmPc: "dropped", rating: false, ratingFrom: Set(), last: "removeDrop" },
  }
  /** PH:623 end: storage.delete. */
  action removeBytes: bool = all {
    st.rmPc == "dropped",
    st' = { ...st, rmPc: "bytesGone", objects: st.objects.exclude(Set(st.rmId)), last: "removeBytes" },
  }
  /** PH:624 end: meta.delete; then rate() again (PH:608). */
  action removeRow: bool = all {
    st.rmPc == "bytesGone",
    st' = { ...st, rmPc: "idle", hidden: st.hidden.exclude(Set(st.rmId)), rateDue: true, last: "removeRow" },
  }

  // ---------------------------------------------------------------- clef-rating: rate() (PH:553-580)
  /** PH:556: the first ratingRefusal (no photo ids). */
  action rateStart: bool = all {
    st.ratePc == "idle", st.rateDue,
    if (ratingOk(st, Set())) st' = { ...st, rateDue: false, ratePc: "checked", last: "rateStart" }
    else st' = { ...st, rateDue: false, last: "rateRefused" },
  }
  /** PH:560-562: the newest live rows, then storage.get for each (a row whose bytes are gone is skipped). */
  action rateRead: bool = all {
    st.ratePc == "checked",
    val ids = st.rows.intersect(st.objects)
    if (ids == Set()) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoPhotos" }
    else st' = { ...st, ratePc: "read", rateIds: ids, last: "rateRead" },
  }
  /** PH:564-565: the rater call (oracle). A null score or an error (after withRetry) ends the run. */
  action rateReturn(score: bool): bool = all {
    st.ratePc == "read",
    if (score) st' = { ...st, ratePc: "returned", last: "rateScore" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoScore" },
  }
  /** PH:567-571: the second ratingRefusal with the photo ids. */
  action rateCheck2: bool = all {
    st.ratePc == "returned",
    if (ratingOk(st, st.rateIds)) st' = { ...st, ratePc: "passed", last: "rateCheck2" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateDiscarded" },
  }
  /** PH:572 onRating = SV:1879 writeRating: writes when a membership row exists (any state). */
  action rateWrite: bool = all {
    st.ratePc == "passed",
    st' = { ...st, ratePc: "written", rating: true, ratingFrom: st.rateIds, last: "rateWrite" },
  }
  /** PH:573-578: the third ratingRefusal; a refusal drops the rating (onRemoved). */
  action rateCheck3: bool = all {
    st.ratePc == "written",
    if (ratingOk(st, st.rateIds)) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateKept" }
    else st' = { ...st, ratePc: "dropping", last: "rateCheck3Refused" },
  }
  action rateDrop: bool = all {
    st.ratePc == "dropping",
    st' = { ...st, ratePc: "idle", rateIds: Set(), rating: false, ratingFrom: Set(), last: "rateDrop" },
  }

  // ---------------------------------------------------------------- the age drops under 18 (A:285-298, SV:850-859)
  /** A:293 noteAge commits the lower age; the hook runs after it (A:296). */
  action ageCommit: bool = all {
    st.ageSaga == "idle", st.age >= 18, not(st.deleted),
    st' = { ...st, age: MINOR_AGE, ageSaga: "committed", last: "ageCommit" },
  }
  /** SV:853 photos.deleteFor(person): hideAll under the person lock (every app). */
  action ageHide: bool = all {
    st.ageSaga == "committed",
    st' = { ...hideAll(st, "age"), ageSaga: "hidden", last: "ageHide" },
  }
  /** deleteFor: end each hidden row (rating, bytes, row). */
  action ageEnd: bool = all {
    st.ageSaga == "hidden",
    st' = { ...endRows(st, st.sagaIds.get("age")), ageSaga: "ended", sagaIds: st.sagaIds.set("age", Set()), last: "ageEnd" },
  }
  /** SV:853 dropRatings(person). */
  action ageDropRatings: bool = all {
    st.ageSaga == "ended",
    st' = { ...st, ageSaga: "dropped", rating: false, ratingFrom: Set(), last: "ageDropRatings" },
  }
  /** SV:854-858: each membership that is not removed: network.members.age = least(coalesce(age, a), a). */
  action ageMembers: bool = all {
    st.ageSaga == "dropped",
    st' = { ...st, ageSaga: "idle", netAge: if (st.membership != "removed" and st.age < st.netAge) st.age else st.netAge, last: "ageMembers" },
  }

  // ---------------------------------------------------------------- staff age check fails (SV:1903-1921)
  /** SV:1907-1915: the verify:age:fail facet (a staff retry writes it again: on conflict do update). */
  action verifyFail: bool = all {
    st.verifySaga == "idle", st.netMember, st.membership != "removed",
    st' = { ...st, verifySaga: "committed", ageFail: true, last: "verifyFail" },
  }
  /** SV:1918 photos.deleteFor(person, app): hideAll. SD-053. */
  action verifyHide: bool = all {
    st.verifySaga == "committed",
    st' = { ...hideAll(st, "verify"), verifySaga: "hidden", last: "verifyHide" },
  }
  action verifyEnd: bool = all {
    st.verifySaga == "hidden",
    st' = { ...endRows(st, st.sagaIds.get("verify")), verifySaga: "ended", sagaIds: st.sagaIds.set("verify", Set()), last: "verifyEnd" },
  }
  /** SV:1918 dropRatings(person, app). */
  action verifyDrop: bool = all {
    st.verifySaga == "ended",
    st' = { ...st, verifySaga: "idle", rating: false, ratingFrom: Set(), last: "verifyDrop" },
  }

  // ---------------------------------------------------------------- ban (SV:2010-2042)
  action banCommit: bool = all {
    st.banSaga == "idle", not(st.banned), not(st.deleted),
    st' = { ...st, banSaga: "banned", banned: true, last: "banCommit" },
  }
  /** SV:2030 dropRatings(person). The photos stay for the safety team. */
  action banDrop: bool = all {
    st.banSaga == "banned",
    st' = { ...st, banSaga: "dropped", rating: false, ratingFrom: Set(), last: "banDrop" },
  }
  /** SV:2031 putMembership(restricted) for each membership that is not removed. */
  action banRestrict: bool = all {
    st.banSaga == "dropped",
    st' = { ...st, banSaga: "idle", membership: if (st.membership == "removed") "removed" else "restricted", last: "banRestrict" },
  }

  // ---------------------------------------------------------------- leave slop (A:472-481; onForget SV:830-839)
  // A text leave runs inside the sender's serialized turn (inbox.ts), so it never overlaps a YES PHOTOS turn.
  action leaveConsent: bool = all {
    st.leaveSaga == "idle", st.delSaga == "idle", st.caPc == "idle", st.membership != "removed",
    st' = { ...st, leaveSaga: "consent", last: "leaveConsent" },
  }
  /** SV:834 forget first: the unit deletes the member's facets (the rating) and sets age null (runtime.ts:587-621). */
  action leaveNetForget: bool = all {
    st.leaveSaga == "consent",
    st' = { ...st, leaveSaga: "netGone", netMember: false, rating: false, ratingFrom: Set(), last: "leaveNetForget" },
  }
  /** SV:835 photos.deleteFor(person, app) after the forget: hideAll. SD-052. */
  action leaveHide: bool = all {
    st.leaveSaga == "netGone",
    st' = { ...hideAll(st, "leave"), leaveSaga: "hidden", last: "leaveHide" },
  }
  action leaveEnd: bool = all {
    st.leaveSaga == "hidden",
    st' = { ...endRows(st, st.sagaIds.get("leave")), leaveSaga: "ended", sagaIds: st.sagaIds.set("leave", Set()), last: "leaveEnd" },
  }
  /** A:480 forgetMembership: state removed, profile cleared (pg-store.ts:344-353). */
  action leaveForgetMembership: bool = all {
    st.leaveSaga == "ended",
    st' = { ...st, leaveSaga: "idle", membership: "removed", profileConsent: false, leftDone: true, last: "leaveForgetMembership" },
  }

  // ---------------------------------------------------------------- delete everything (A:484-497)
  action delFloor: bool = all {
    st.delSaga == "idle", st.leaveSaga == "idle", st.caPc == "idle", not(st.deleted),
    st' = { ...st, delSaga: "floor", last: "delFloor" },
  }
  action delNetForget: bool = all {
    st.delSaga == "floor",
    st' = { ...st, delSaga: "netGone", netMember: false, rating: false, ratingFrom: Set(), last: "delNetForget" },
  }
  action delHide: bool = all {
    st.delSaga == "netGone",
    st' = { ...hideAll(st, "del"), delSaga: "hidden", last: "delHide" },
  }
  action delEnd: bool = all {
    st.delSaga == "hidden",
    st' = { ...endRows(st, st.sagaIds.get("del")), delSaga: "ended", sagaIds: st.sagaIds.set("del", Set()), last: "delEnd" },
  }
  /** pg-store.ts:355-386: memberships removed, people.deleted_at and lowest_age null. */
  action delStore: bool = all {
    st.delSaga == "ended",
    st' = { ...st, delSaga: "idle", deleted: true, membership: "removed", profileConsent: false, leftDone: true, last: "delStore" },
  }

  // ---------------------------------------------------------------- photo-consent and photos by text (PI, SV:1230-1239)
  /**
   * A text with an attachment. path "turn": the production signed turn (SV:2359) passes mediaUrls: [], so
   * photosIn never runs (SD-097, skipped: needs upstream contract change). path "webhook": the direct
   * inbound path runs photosIn.
   */
  // One sender's turns run one at a time (inbox.ts), so a text turn never overlaps a text leave or
  // delete everything (leaveConsent and delFloor wait for caPc idle; these wait for the sagas).
  def senderFree(s: State): bool = s.caPc == "idle" and s.leaveSaga == "idle" and s.delSaga == "idle"
  action textPhoto(u: int, path: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)), senderFree(st),
    if (path == "turn") st' = { ...st, turnPhotoDropped: true, last: "turnPhotoDropped" }
    else if (not(LIVE.contains(st.membership)) or not(mayTakeNow(st))) st' = { ...st, last: "textPhotoRefused" }
    else if (not(st.profileConsent))
      st' = { ...st, pending: true, pendingAt: st.now, last: "textPhotoAsk" }
    // PI:101 upload() with the constant version: the same steps as the web (PH:505-528).
    else st' = { ...st, used: st.used.union(Set(u)), upl: st.upl.set(u, "checked"), uplHeader: st.uplHeader.set(u, CONSENT), textStored: true, last: "textPhotoUpload" },
  }
  /** PI:116-122: YES PHOTOS within a day of the ask; the pending row goes, then the membership is read. */
  action consentYesRead: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    if (LIVE.contains(st.membership)) st' = { ...st, pending: false, caPc: "read", caSnap: st.membership, last: "consentYesRead" }
    else st' = { ...st, pending: false, last: "consentYesNotMember" },
  }
  /** PI:124: mayTake. */
  action consentYesCheck: bool = all {
    st.caPc == "read",
    if (mayTakeNow(st)) st' = { ...st, caPc: "checked", last: "consentYesCheck" }
    else st' = { ...st, caPc: "idle", last: "consentYesRefused" },
  }
  /**
   * PI:126 updateMembership(person, slop, [state read at PI:122], {profile}) (pg-store.ts:131-135): the
   * profile is written only while the membership state is still the one read; it never changes the state.
   * A ban, a leave or a STOP since the read makes it write nothing (SD-017, fixed 709be0b).
   */
  action consentYesWrite: bool = all {
    st.caPc == "checked",
    if (st.membership == st.caSnap)
      st' = { ...st, caPc: "idle", profileConsent: true, yesGiven: true, last: "consentYesWrite" }
    else st' = { ...st, caPc: "idle", last: "consentYesStale" },
  }
  /** PI:121,133: NO PHOTOS only deletes the pending row; an earlier YES stays. */
  action consentNo: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    st' = { ...st, pending: false, last: "consentNo" },
  }

  // ---------------------------------------------------------------- slop-probe-photo (PK:245-258)
  /** recipientAge: the other member's age (the matching gate makes it 18+; the engine rule checks it again). */
  action probe(recipientAge: int): bool = all {
    not(st.probeSent), st.rating,
    val refs = probePhotoRefs(st.age, st.probeFlag, st.banned or not(LIVE.contains(st.membership)), probeHookIds(st), recipientAge)
    // slopProbeMessage adds the photo line when refs is not empty; the hook returns only .text (PK:258).
    st' = { ...st, probeSent: true, probeClaims: probeTextClaims(refs),
            probeAttached: PROBE_HOOK_KEEPS_PHOTOS and refs != Set(),
            probeWithPhotos: st.probeFlag and st.rows != Set() and recipientAge >= 18 and adultNow(st), last: "probe" },
  }

  // ---------------------------------------------------------------- reads that show data
  action memberList: bool = all { not(st.shown.contains("contentType")), st' = { ...st, shown: st.shown.union(MEMBER_LIST_FIELDS), last: "memberList" } }
  action staffLinks: bool = all {
    adultNow(st), not(st.shown.contains("url")),
    st' = { ...st, shown: st.shown.union(STAFF_LINK_FIELDS), last: "staffLinks" },
  }
  /**
   * SV exportMember: the member's facets through the export filter (exportShows), and the photo list. The facets are
   * the stored ones: the rating facet when a rating exists (as writeRating writes it), and the member's other facets.
   */
  def facetsOf(s: State): Set[Facet] = OTHER_FACETS.union(if (s.rating) Set(RATING_FACET) else Set())
  action exportMember: bool = all {
    val out = facetsOf(st).filter(f => exportShows(f))
    val outFields = out.map(f => if (f.kind == "appearance") "score" else f.kind).union(MEMBER_LIST_FIELDS)
    st' = { ...st, shown: st.shown.union(outFields), exportedRated: st.exportedRated or st.rating, last: "exportMember" },
  }
  /** The slop pack reads the appearance facet from the snapshot in matching only. */
  action matchRead: bool = all {
    not(st.usedInMatching), st.rating, LIVE.contains(st.membership), st.netMember, not(st.banned),
    st' = { ...st, usedInMatching: true, last: "matchRead" },
  }

  // ---------------------------------------------------------------- the service purge (SV:596-610)
  /** SV:606 photos.sweep() (PH:631-636): each abandoned hidden row: rating, bytes, row. SD-176. */
  action purgeSweep: bool = all {
    abandoned(st) != Set(),
    st' = { ...endRows(st, abandoned(st)), swept: true, last: "purgeSweep" },
  }
  /** SV:607 reconcileAges() runs ageLowered again (SV:866-876). The hook is idempotent; one slot here. Q-photos_rating-1. */
  action purgeAges: bool = all {
    st.ageSaga == "idle", reconcileDue(st),
    st' = { ...st, ageSaga: "committed", reconciled: true, last: "purgeAges" },
  }

  // ---------------------------------------------------------------- environment
  action tick: bool = all { st.now < MAX_TICK, st' = { ...st, now: st.now + 1, last: "tick" } }
  /** A process crash ends every request in memory; committed rows and objects stay. */
  action crash: bool = all {
    st.crashes < MAX_CRASHES, not(quiescent(st)),
    st' = { ...st, crashes: st.crashes + 1, upl: UPLOADS.mapBy(u => "idle"), rateDue: false, ratePc: "idle", rateIds: Set(),
            rmPc: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle",
            sagaIds: SAGAS.mapBy(k => Set()), caPc: "idle",
            rateWriteCrash: st.rateWriteCrash or (Set("written", "dropping").contains(st.ratePc) and not(ratingOk(st, st.rateIds))),
            verifyLeft: st.verifyLeft.union(if (st.verifySaga == "committed") st.rows else Set()),
            forgetLeft: st.forgetLeft.union(if (st.leaveSaga == "netGone" or st.delSaga == "netGone") st.rows.union(st.objects) else Set()),
            ratingLeft: st.ratingLeft or (st.rating and (st.banSaga != "idle" or st.verifySaga != "idle")),
            last: "crash" },
  }

  // The step groups the actions so that the random simulation reaches deep paths: each group is one
  // branch, so the life events (age, failed age check, ban, leave, delete everything, crash) that end
  // most paths do not crowd out the upload and rating steps. Apalache explores every branch the same.
  action step = {
    nondet u = UPLOADS.oneOf()
    nondet h = HEADERS.oneOf()
    nondet path = Set("turn", "webhook").oneOf()
    nondet score = Set(true, false).oneOf()
    nondet focus = Set(true, false).oneOf()
    // Weights for the random walk only (each action stays in the full `any` below, so the reachable states do not
    // change): in half of the steps an upload or a rating in flight goes on, and a stored rating is read (probe,
    // export, matching). Without this, a probe or an export of a rated member is too rare for 10000 samples.
    if (focus and UPLOADS.exists(x => st.upl.get(x) != "idle")) {
      nondet uf = UPLOADS.filter(x => st.upl.get(x) != "idle").oneOf()
      any { uploadCount(uf), uploadPut(uf), uploadBytes(uf), uploadShow(uf), uploadUndo(uf), uploadUndoRow(uf) }
    }
    else if (focus and (st.ratePc != "idle" or st.rateDue))
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop }
    else if (focus and st.rating) any { probe(ADULT_AGE), probe(MINOR_AGE), exportMember, matchRead }
    else any {
      any { uploadStart(u, h), uploadCount(u), uploadPut(u), uploadBytes(u), uploadShow(u), uploadUndo(u), uploadUndoRow(u) },
      any { removeStart(u), removeDrop, removeBytes, removeRow },
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop },
      any { ageHide, ageEnd, ageDropRatings, ageMembers, verifyHide, verifyEnd, verifyDrop, banDrop, banRestrict,
            leaveNetForget, leaveHide, leaveEnd, leaveForgetMembership, delNetForget, delHide, delEnd, delStore },
      any { textPhoto(u, path), consentYesRead, consentYesCheck, consentYesWrite, consentNo },
      any { probe(ADULT_AGE), probe(MINOR_AGE), memberList, staffLinks, exportMember, matchRead },
      any { purgeSweep, purgeAges },
      any { tick, crash, any { ageCommit, verifyFail, banCommit, leaveConsent, delFloor } },
    }
  }

  // ---------------------------------------------------------------- invariants
  // The state rules below are checked when no request is in flight, on the state after one pass of the
  // service purge (`purged`): the purge is the only recovery the code has for a crash.
  /**
   * Rule: photos are for adults only, never for members aged 13-17; a person whose lowest age drops
   * under 18 loses them all (AGENTS.md platform decision 9, founder 2026-10-08; PH header).
   * SD-052 (fixed 4d3258d), Q-photos_rating-1 (fixed 4fe59a5).
   */
  def photoOnlyForAdultIn(s: State): bool = s.rows != Set() implies (s.age >= 18 and not(s.deleted))
  val photoOnlyForAdult: bool = quiescent(st) implies photoOnlyForAdultIn(purged(st))
  /**
   * Rule: the app's own adult check is part of "adult" (PH:486-492: no failed staff age check); photos are
   * for adults only (decision 9). No photo stays after a failed age check. SD-053 (fixed fb126c6).
   * Full rule; a crash between the facet commit and deleteFor (SV:1915-1918) still keeps the photos until
   * staff record the failed check again (SD-005 class X8: a saga with no resume). In safety only without such a crash.
   */
  def photoNotKeptAfterFailedAgeCheckIn(s: State): bool = s.rows != Set() implies not(s.ageFail)
  val photoNotKeptAfterFailedAgeCheck: bool = quiescent(st) implies photoNotKeptAfterFailedAgeCheckIn(purged(st))
  /** The same rule for every photo except the ones a crash of the failed-age-check saga left (st.verifyLeft). */
  val photoNotKeptAfterFailedAgeCheck_noSagaCrash: bool =
    quiescent(st) implies { val p = purged(st) photoNotKeptAfterFailedAgeCheckIn({ ...p, rows: p.rows.exclude(st.verifyLeft) }) }
  /** Rule: leaving the app or deleting everything deletes every photo (PH header, SV:830-839). SD-052 (fixed 4d3258d). */
  def noPhotoAfterForgetIn(s: State): bool =
    (s.membership == "removed" or s.deleted) implies (s.rows == Set() and s.objects == Set())
  val noPhotoAfterForget: bool = quiescent(st) implies noPhotoAfterForgetIn(purged(st))
  /**
   * Rule: a person whom the Network forgot (leave, delete everything) has no photo (PH header, SV:830-839).
   * Full rule; Q-photos_rating-3 (found on this branch, not fixed): onForget now forgets the member before
   * deleteFor (4d3258d), so a crash between them keeps the photos with a live platform membership until
   * the person leaves again. In safety only without such a crash.
   */
  def noPhotoForForgottenMemberIn(s: State): bool = not(s.netMember) implies (s.rows == Set() and s.objects == Set())
  val noPhotoForForgottenMember: bool = quiescent(st) implies noPhotoForForgottenMemberIn(purged(st))
  /** The same rule for every photo except the rows and bytes a crash of a leave or delete-everything left (st.forgetLeft). */
  val noPhotoForForgottenMember_noSagaCrash: bool =
    quiescent(st) implies { val p = purged(st)
      noPhotoForForgottenMemberIn({ ...p, rows: p.rows.exclude(st.forgetLeft), objects: p.objects.exclude(st.forgetLeft) }) }
  /** Rule: at most PHOTO_MAX_PER_PERSON live photos (PH:99). Checked in every state. SD-372 (fixed 4d3258d). */
  val countLimit: bool = st.rows.size() <= MAX_PHOTOS
  /** Rule: bytes and row live and die together; no orphan bytes, no hidden row left (PH:350-353). SD-176 (fixed 1a48ff7). */
  def bytesMatchRowIn(s: State): bool = s.objects == s.rows and s.hidden == Set()
  val bytesMatchRow: bool = quiescent(st) implies bytesMatchRowIn(purged(st))
  /**
   * Rule: no rating for a minor (decision 13; AGENTS "Adults only, scores never shown"). Q-photos_rating-1 (fixed 4fe59a5).
   * Full rule; Q-photos_rating-2 (not fixed): the age saga can end between check 2 and onRating, and a
   * crash before check 3 (PH:572-573) keeps the new score with no photo and a lowered member age, so the
   * purge does not see it. In safety only without that crash.
   */
  def noRatingForMinorIn(s: State): bool = s.rating implies (s.age >= 18 and not(s.deleted))
  val noRatingForMinor: bool = quiescent(st) implies noRatingForMinorIn(purged(st))
  val noRatingForMinor_noRateWriteCrash: bool = not(st.rateWriteCrash) implies noRatingForMinor
  /**
   * Rule: a rating only for a verified adult with a live membership who is not banned, from photos that
   * still exist (PH:535-544; SV:1918 failed age check; SV:2030 ban). SD-176 (stale rating from a deleted photo, fixed 1a48ff7).
   * Full rule; it still fails on SD-005 (a crash between the ban commit and dropRatings, identity_sagas
   * module), on a crash in the other staff and forget sagas (X8), and on Q-photos_rating-2. In safety only without those crashes.
   */
  def ratingOnlyForEligibleIn(s: State): bool =
    s.rating implies (not(s.ageFail) and not(s.banned) and LIVE.contains(s.membership) and s.ratingFrom.subseteq(s.rows))
  val ratingOnlyForEligible: bool = quiescent(st) implies ratingOnlyForEligibleIn(purged(st))
  val ratingOnlyForEligible_noResidueCrash: bool = not(st.rateWriteCrash or (st.ratingLeft and st.rating)) implies ratingOnlyForEligible
  /**
   * Rule: scores are never shown to anyone (AGENTS decision 9 and 13). The reads take the stored facets through the
   * code's own filters (exportShows on the rating facet as writeRating stores it), so a change to either one shows
   * "score" and fails the rule (findings file).
   */
  val scoresNeverShown: bool = not(st.shown.contains("score"))
  /**
   * Rule: a photo is stored only with the photo consent of the current version (PH:508). The row's version is the one
   * the request carried (uploadPut copies st.uplHeader), so the rule fails when the header check is skipped. It covers
   * hidden rows too (they are stored).
   */
  val rowHasConsent: bool = st.rows.union(st.hidden).forall(p => st.rowVersion.get(p) == CONSENT)
  /** Rule: a photo by text is taken only after an explicit YES PHOTOS (PI:10-15). */
  val textPhotoNeedsConsent: bool = st.textStored implies st.yesGiven
  /**
   * Rule: the probe says a photo is attached only when one goes with it (decision 9 relay; slopProbeMessage). SD-230.
   * The probe runs the engine rule and the copy on the hook's real input (the literal photoIds: [] and the flag either
   * way). If the hook passed photo ids and still returned only .text, the rule fails (findings file).
   */
  val probeClaimMatches: bool = st.probeClaims implies st.probeAttached
  /** Rule: leave stops the app (AGENTS decision 7, PRD 40.3). A later write must not make the membership live again. */
  val leaveSticks: bool = st.leftDone implies not(LIVE.contains(st.membership))
  /**
   * Rule: a ban stops the number on every app (founder 2026-10-09 decision 3; SV:2031 restricted).
   * SD-017 (fixed 709be0b): the YES PHOTOS write (PI:126) is conditional on the state it read, so it no
   * longer restores "active" after a ban. Run test sd017ConsentWriteKeepsBanTest.
   */
  val banSticks: bool =
    st.banned and st.banSaga == "idle" and st.membership != "removed" and st.crashes == 0 implies st.membership == "restricted"
  val leaveAndBanStick: bool = leaveSticks and banSticks

  val safety: bool = and {
    photoOnlyForAdult, photoNotKeptAfterFailedAgeCheck_noSagaCrash, noPhotoAfterForget, noPhotoForForgottenMember_noSagaCrash,
    countLimit, bytesMatchRow, noRatingForMinor_noRateWriteCrash, ratingOnlyForEligible_noResidueCrash,
    scoresNeverShown, rowHasConsent, textPhotoNeedsConsent, probeClaimMatches, leaveAndBanStick,
  }

  // ---------------------------------------------------------------- witnesses (each must be violated)
  /** An adult uploads, is rated and the rating is used in matching. */
  val witness_ratedAndMatched: bool = not(st.usedInMatching)
  /** An age drop under 18 clears every photo and the rating. */
  val witness_ageDropClears: bool = not(st.hadPhotos and st.age < 18 and settled(st) and st.rows == Set() and not(st.rating))
  /** Leave completes with the photos gone. */
  val witness_leaveClears: bool = not(st.leftDone and st.hadPhotos and settled(st) and st.rows == Set())
  /** A photo by text is stored after YES PHOTOS (webhook path). */
  val witness_textPhotoStored: bool = not(st.textStored and st.rows != Set())
  /** A photo by signed turn is dropped (SD-097 is reachable as written). */
  val witness_turnPhotoDropped: bool = not(st.turnPhotoDropped)
  /** A ban keeps the photos and drops the rating. */
  val witness_banKeepsPhotos: bool = not(st.banned and st.banSaga == "idle" and st.rows != Set() and not(st.rating))
  /** A probe goes out. */
  val witness_probeSent: bool = not(st.probeSent)
  /** The export runs on a rated member (the filter sees the rating facet). */
  val witness_exportRated: bool = not(st.exportedRated)
  /** A probe runs with the flag on, live photos and an adult recipient (the hook input that could carry a photo). */
  val witness_probeWithPhotos: bool = not(st.probeWithPhotos)
  /** A crash happens. */
  val witness_crash: bool = not(st.crashes > 0)
  /** The second check in show refuses an upload (an age drop, a leave, a failed check or the limit in flight). */
  val witness_showRefused: bool = not(st.showRefused)
  /** The purge sweeps a row a crash left hidden. */
  val witness_swept: bool = not(st.swept)
  /** The purge runs the age hook again. */
  val witness_reconciled: bool = not(st.reconciled)

  // ---------------------------------------------------------------- run tests (concrete traces)
  /** Happy path: an adult web upload, a score, the rating kept and used in matching. */
  run adultUploadRatedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(matchRead)
      .expect(st.rating and st.rows == Set(1) and st.objects == Set(1) and st.hidden == Set() and st.usedInMatching and safety)

  /** A stale consent header is refused (PH:508): nothing is stored. */
  run staleHeaderTest =
    init.then(uploadStart(1, "old")).expect(st.upl.get(1) == "idle" and st.rows == Set())

  /** The rater runs while the age drops: check 3 drops the score (PH:573-578). */
  run lateRatingDroppedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2)
      .then(ageCommit).then(ageHide).then(ageEnd).then(ageDropRatings).then(ageMembers)
      .then(rateWrite).then(rateCheck3).then(rateDrop)
      .expect(not(st.rating) and st.rows == Set() and settled(st) and safety)

  /** SD-052 fixed: the upload passes mayTake, the age drops, then show checks again and refuses; the bytes go. */
  run sd052UploadRefusedAfterAgeDropTest =
    init
      .then(uploadStart(1, CONSENT))
      .then(ageCommit).then(ageHide).then(ageEnd).then(ageDropRatings).then(ageMembers)
      .then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1)).then(uploadUndo(1)).then(uploadUndoRow(1))
      .expect(st.rows == Set() and st.objects == Set() and st.hidden == Set() and st.age < 18 and settled(st) and safety)

  /** SD-052 fixed: the same with leave; the forget comes first, so show refuses (no member). */
  run sd052UploadRefusedAfterLeaveTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1))
      .then(leaveConsent).then(leaveNetForget).then(leaveHide).then(leaveEnd).then(leaveForgetMembership)
      .then(uploadBytes(1)).then(uploadShow(1)).then(uploadUndo(1)).then(uploadUndoRow(1))
      .expect(st.membership == "removed" and st.rows == Set() and st.objects == Set() and settled(st) and safety)

  /** SD-052 fixed: show lands first (under the person lock), then the leave's hideAll takes the row. */
  run sd052ShowBeforeLeaveHideTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1))
      .then(leaveConsent).then(uploadShow(1)).then(leaveNetForget).then(leaveHide).then(leaveEnd).then(leaveForgetMembership)
      .then(rateStart)
      .expect(st.rows == Set() and st.objects == Set() and settled(st) and safety)

  /** SD-053 fixed: a failed staff age check deletes the photos and the rating. */
  run sd053FailedAgeCheckDeletesPhotosTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(verifyFail).then(verifyHide).then(verifyEnd).then(verifyDrop)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and st.ageFail and settled(st) and safety)

  /** SD-372 fixed: two uploads pass the early count; show counts under the lock and refuses the second. */
  run sd372CountRaceRefusedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(uploadStart(2, CONSENT)).then(uploadStart(3, CONSENT)).then(uploadCount(2)).then(uploadCount(3))
      .then(uploadPut(2)).then(uploadPut(3)).then(uploadBytes(2)).then(uploadBytes(3))
      .then(uploadShow(2)).then(uploadShow(3)).then(uploadUndo(3)).then(uploadUndoRow(3))
      .then(rateStart).then(rateRead).then(rateReturn(false))
      .expect(st.rows == Set(1, 2) and st.objects == Set(1, 2) and st.showRefused and countLimit and settled(st) and safety)

  /** SD-176 fixed: a crash after storage.put leaves a hidden row; the purge sweep removes the bytes and the row. */
  run sd176OrphanBytesSweptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(crash)
      .then(all { not(settled(st)), purgeSweep })
      .expect(st.objects == Set() and st.rows == Set() and st.hidden == Set() and settled(st) and safety)

  /** SD-176 fixed: a crash while a photo is deleted: the row is hidden first, so the sweep drops the rating. */
  run sd176StaleRatingSweptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(crash)
      .then(all { st.rating and not(settled(st)), purgeSweep })
      .expect(not(st.rating) and st.rows == Set() and st.objects == Set() and settled(st) and safety)

  /** Q-photos_rating-1 fixed: a crash after noteAge commits; the purge runs the hook again. */
  run q1CrashAfterAgeCommitReconciledTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(ageCommit).then(crash)
      .then(all { reconcileDue(st), purgeAges }).then(ageHide).then(ageEnd).then(ageDropRatings).then(ageMembers)
      .expect(st.age < 18 and st.netAge < 18 and st.rows == Set() and st.objects == Set() and not(st.rating) and settled(st) and safety)

  /** Q-photos_rating-1 fixed: a crash after the photos go but before the member ages: the member age makes the purge run it again. */
  run q1CrashBeforeMemberAgesReconciledTest =
    init
      .then(ageCommit).then(ageHide).then(ageEnd).then(ageDropRatings).then(crash)
      .then(all { reconcileDue(st), purgeAges }).then(ageHide).then(ageEnd).then(ageDropRatings).then(ageMembers)
      .expect(st.netAge == MINOR_AGE and settled(st) and safety)

  /** Q-photos_rating-2 (not fixed): the age saga ends between check 2 and onRating, then a crash before check 3. */
  run q2RateWriteCrashTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2)
      .then(ageCommit).then(ageHide).then(ageEnd).then(ageDropRatings).then(ageMembers)
      .then(rateWrite).then(crash)
      .expect(st.rating and st.age < 18 and settled(st) and not(noRatingForMinor) and st.rateWriteCrash and safety)

  /** Q-photos_rating-3 (not fixed): a crash after the leave's forget and before deleteFor keeps the photos. */
  run q3LeaveCrashAfterForgetTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(false))
      .then(leaveConsent).then(leaveNetForget).then(crash)
      .expect(st.rows == Set(1) and not(st.netMember) and st.membership == "active" and settled(st)
              and not(noPhotoForForgottenMember) and st.forgetLeft == Set(1) and safety)

  /** SD-005 (identity_sagas, not fixed): a crash after the ban commit keeps the rating of a banned person. */
  run sd005BanCrashKeepsRatingTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .expect(st.rating and st.banned and settled(st) and not(ratingOnlyForEligible) and st.ratingLeft and safety)

  /**
   * A crash residue switches off only its own part. A crash in the ban saga (SD-005) leaves a rating; then a failed
   * staff age check runs to the end: the photo rules are checked in full (no photo is left out), and they hold.
   */
  run banCrashThenFailedAgeCheckTest =
    initWith(false)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .then(verifyFail).then(verifyHide).then(verifyEnd).then(verifyDrop)
      .expect(st.ratingLeft and st.verifyLeft == Set() and st.forgetLeft == Set() and st.ageFail and settled(st)
              and photoNotKeptAfterFailedAgeCheck and noPhotoForForgottenMember and ratingOnlyForEligible and safety)
  /** A crash in the failed-age-check saga leaves photo 1; then the person leaves: the forget rule is checked in full. */
  run verifyCrashThenLeaveTest =
    initWith(false)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(verifyFail).then(crash)
      .expect(st.verifyLeft == Set(1) and settled(st) and not(photoNotKeptAfterFailedAgeCheck) and safety)
      .then(leaveConsent).then(leaveNetForget).then(leaveHide).then(leaveEnd).then(leaveForgetMembership)
      .expect(st.forgetLeft == Set() and settled(st) and noPhotoForForgottenMember and noPhotoAfterForget
              and photoNotKeptAfterFailedAgeCheck and safety)
  /** The probe on the hook's real input, with the flag on: the hook passes no photo ids, so the text claims none. */
  run probeFlagOnTest =
    initWith(true)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(probe(ADULT_AGE))
      .expect(st.probeSent and not(st.probeClaims) and probeClaimMatches and safety)
  /** The export shows the member's private said fact and never the rating facet. */
  run exportHidesScoreTest =
    initWith(false)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadPut(1)).then(uploadBytes(1)).then(uploadShow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(exportMember)
      .expect(st.rating and st.shown.contains("fact") and st.shown.contains("interest") and scoresNeverShown and safety)
  /** A web upload with an old consent header stores nothing; a text photo stores the constant version (PI:101). */
  run textPhotoVersionTest =
    initWith(false)
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck).then(consentYesWrite)
      .then(textPhoto(2, "webhook")).then(uploadCount(2)).then(uploadPut(2)).then(uploadBytes(2)).then(uploadShow(2))
      .expect(st.rows == Set(2) and st.rowVersion.get(2) == CONSENT and rowHasConsent and safety)

  /** SD-017 (fixed 709be0b): YES PHOTOS reads the membership, a ban restricts it, then the conditional write changes nothing. */
  run sd017ConsentWriteKeepsBanTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck)
      .then(banCommit).then(banDrop).then(banRestrict)
      .then(consentYesWrite)
      .expect(st.banned and st.membership == "restricted" and not(st.yesGiven) and not(st.profileConsent) and banSticks and safety)

  /** SD-097 (skipped: needs upstream contract change): a photo in a signed turn never reaches photosIn. */
  run sd097TurnPhotoDroppedTest =
    init.then(textPhoto(1, "turn")).expect(st.turnPhotoDropped and not(st.pending) and st.rows == Set())
}
