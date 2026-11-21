# Photo storage and private ratings

## Story: Photo storage and private ratings

An adult slop.date member needs their photos and private scores managed under their age and consent state.

### Safety rules and reachability

Check photo limits, adult eligibility, erasure, private scores, and consent for probe photos. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Production uses the generated [photo eligibility and limits](../photoPolicy.md), [storage and removal transitions](../photoRetention.md), and [rating attempt transitions](../photoRating.md).

Imported from `quint/photos_rating.qnt` at `30d950e`. Compared again with the code of branch `vibestack-matching` on 2026-11-18. See [model index](README.md) for scope, commands and the known defects.

```quint
// quint-check: max-steps=40 max-samples=10000 verify-steps=6
//
// Photos and the Clef rating of one slop.date member. Machines: photo-object, photo-consent, clef-rating,
// slop-probe-photo.
//
// The model follows the code of branch vibestack-matching (compared 2026-11-18). Code locations are names:
//   packages/platform/src/photos.ts            PhotoService: upload, rate, ratingRefusal, ratingSelectionRefusal,
//                                              remove, deleteFor, erasePhoto, finishPhotoChange, staffLinks, view
//   packages/platform/src/photo-upload-link.ts PhotoUploadLinks.redeem (the link page and its consent box)
//   packages/network/service/service.ts        NetworkService: hooks().onForget, ageLowered, verifiedAdult,
//                                              dropRatings, writeRating, verify, the staff ban, exportMember
//   packages/network/service/photoIntake.ts    PhotoIntake: photosIn, consentAnswer (YES PHOTOS / NO PHOTOS)
//   packages/platform/src/accounts.ts          Accounts: recordAge, leave, deleteAll
//   packages/network/service/packs.ts          the slop probe text hook (SLOP_PROBE_PHOTOS)
// The generated decisions (photoRetention, photoRating, photoPolicy) order the steps; this model keeps the
// whole sequence with the crash and the races between requests.
//
// Scope: 1 person, 1 app (slop), 3 upload request ids, a photo limit of 2 (the code has 6: the race does
// not depend on the value), 1 crash. Every `await` between two writes is one action. Each request runs in
// memory: a crash ends every request in flight. This branch has no automatic recovery: no sweep of photo
// rows or bytes, and no reconcile of ages in the purge. A later age statement runs the age hook again
// (Accounts.recordAge "Reconcile on retry"; ageRetry here). A staff retry of a ban resumes it (banResume).
// The rater (Clef) is an oracle: it returns a score, a refusal (null) or an error. One rate() runs at a
// time here; in the code two can overlap, and writeRating's version-bound discard keeps the newer one.
//
// KNOWN CODE DEFECTS (2026-11-18; see the run tests and spec/models/README.md). The full rules are kept
// below; `safety` holds each rule except the residue that a named defect leaves, and that residue is a ghost:
//   PR-D1 (SD-052 class) upload writes its row with no recheck and no lock against deleteFor (missedRows).
//   PR-D2 (SD-372 class) upload counts the rows without a lock, so two uploads pass the limit (overLimit).
//   PR-D3 (SD-176 class) bytes are stored before the row and erased before the row, and nothing sweeps
//         (orphanBytes, bytelessRows, ratingLeft for a crash between the row delete and dropRatings).
//   PR-D4 (SD-053 class) a failed staff age check drops the rating but keeps the photos.
//   PR-D5 (Q-photos_rating-1 class) a crash after noteAge and before the age hook ends keeps a minor's
//         photos until the person states an age again (ageLeftRows, ageRatingLeft).
//   PR-D6 (SD-017 class) FIXED 2026-11-18. YES PHOTOS (consentAnswer) and the upload link (redeem) wrote
//         back the whole membership they read (putMembership), so a ban, a leave or an erasure that landed
//         meanwhile was undone. Both now write the consent by one guarded statement (writePhotoConsent:
//         profile keys only, where the state is live): the write changes no state, and a membership that is
//         no longer live gets no consent and the link closes refused. linkWrite and consentYesWrite model
//         that; leaveSticks and banSticks hold with no exception. Covered by the e2e cases "a ban that commits
//         during a link use" and "during YES PHOTOS" (tests/e2e/photo-upload-link.e2e.test.ts).
//
// OUTSIDE THE MODEL
//   ageLowered's first branch: a confirmed age under 13 (confirmedUnderage) runs finishUnderageCleanup
//   (beginUnderageCleanup, deleteFor, dropRatings, erase listeners, forget and forgetMembership per app). The
//   model has one minor age (15), so only the 13-17 branch is here.
//   PhotoService.upload runs mayTake once at its start; textPhoto and the link read stand for that check (the
//   photosIn and redeem holder checks run just before it, with no write between), so they merge into one step.
module photos_rating {

  // ---------------------------------------------------------------- constants
  pure val UPLOADS: Set[int] = Set(1, 2, 3)
  /** uploadMaxPerPerson (spec/photoPolicy.md is 6; 2 here). */
  pure val MAX_PHOTOS: int = 2
  /** PHOTO_CONSENT.version (photos.ts): a constant of the build. */
  pure val CONSENT: str = "2026-10-08"
  pure val HEADERS: Set[str] = Set(CONSENT, "old", "")
  pure val ADULT_AGE: int = 25
  pure val MINOR_AGE: int = 15
  /** The photo_consent pending row is read for one day (PhotoIntake.consentAnswer); one tick is half a day. */
  pure val DAY: int = 2
  pure val MAX_TICK: int = 4
  pure val MAX_CRASHES: int = 1
  /**
   * The probe hook (packs.ts) as the code calls the engine: probePhotoRefs({ age, photoConsent: SLOP_PROBE_PHOTOS,
   * photoIds: [] }, { age }), then slopProbeMessage(..., photos).text. The flag is a build constant (false now);
   * the model lets it be either value (st.probeFlag), because the hook must stay honest when it is turned on.
   * probeHookIds is the literal photoIds: [] the hook passes; PROBE_HOOK_KEEPS_PHOTOS is false because the hook
   * returns only .text, so no photo id goes out with the probe.
   */
  def probeHookIds(s: State): Set[int] = Set()
  pure val PROBE_HOOK_KEEPS_PHOTOS: bool = false
  /** engine slop/plan.ts probePhotoRefs: adults both sides, photo consent, not held, opaque ids, at most PROBE_PHOTO_MAX (1). */
  pure def probePhotoRefs(subjectAge: int, consent: bool, held: bool, ids: Set[int], recipientAge: int): Set[int] =
    if (subjectAge < 18 or recipientAge < 18 or not(consent) or held or ids == Set()) Set()
    else Set(ids.fold(0, (m, x) => if (x > m) x else m))
  /** engine slop copy slopProbeMessage: the photo line is in the text exactly when a photo id goes with it. */
  pure def probeTextClaims(refs: Set[int]): bool = refs != Set()
  /**
   * The facet the rating is stored as: writeRating inserts privacy_scope 'agent_private', provenance 'inferred',
   * source 'photo_rater', status 'confirmed', and appearanceFacet's tags (the appearance prefix).
   */
  type Facet = { kind: str, scope: str, provenance: str, source: str, status: str, appearance: bool }
  pure val RATING_FACET: Facet = { kind: "appearance", scope: "agent_private", provenance: "inferred", source: "photo_rater", status: "confirmed", appearance: true }
  /** Other facets of the member: a private fact the member said (export shows it), a staff check (export hides it). */
  pure val OTHER_FACETS: Set[Facet] = Set(
    { kind: "fact", scope: "agent_private", provenance: "said", source: "text", status: "confirmed", appearance: false },
    { kind: "fact", scope: "agent_private", provenance: "vouched", source: "staff", status: "confirmed", appearance: false },
    { kind: "interest", scope: "matchable", provenance: "said", source: "web_join", status: "confirmed", appearance: false })
  /** memberExportFacetAllowed (spec/accountPrivacy.md), as exportMember calls it with the appearance tag test. */
  pure def exportShows(f: Facet): bool =
    not(f.appearance) and (f.scope != "agent_private"
      or (f.status == "confirmed" and (f.provenance == "said" or Set("gmail", "google_calendar").contains(f.source))))
  /** LIVE_MEMBERSHIP (photos.ts) and LIVE (photoIntake.ts). */
  pure val LIVE: Set[str] = Set("active", "paused", "onboarding")
  /** What any route, export or console can show about photos (PhotoService.list, staffLinks). */
  pure val MEMBER_LIST_FIELDS: Set[str] = Set("id", "createdAt", "bytes", "contentType")
  pure val STAFF_LINK_FIELDS: Set[str] = Set("id", "url", "expiresAt")
  /** The callers of erasePhoto: the member's remove, and deleteFor in the age hook, a leave and delete everything. */
  pure val ERASERS: Set[str] = Set("rm", "age", "leave", "del")

  // ---------------------------------------------------------------- state
  type State = {
    // the person (platform.people) and their network-side facts
    age: int,               // people.lowest_age (noteAge keeps the least)
    netAge: int,            // network.members.age (ageLowered lowers it)
    ageFail: bool,          // facet <member>:verify:age with verify:age:fail (NetworkService.verify)
    banned: bool,           // platform.bans
    banDone: bool,          // the ban's projection finished (staffBans projectedAt); a staff retry resumes it
    deleted: bool,          // people.deleted_at (delete everything)
    membership: str,        // platform.memberships.state: active | restricted | removed
    netMember: bool,        // network.members row live (forget ends it)
    profileConsent: bool,   // memberships.profile.photoConsent == CONSENT
    // photo-object
    objects: Set[int],      // object storage keys (the upload id stands for the random key)
    rows: Set[int],         // platform.photos rows (no row is ever hidden on this branch)
    uplHeader: int -> str,  // the consent version the upload request carried (upload consentVersion)
    // clef-rating
    rating: bool,           // facet <member>:appearance
    ratingFrom: Set[int],   // the photos the stored score was made from
    rateDue: bool,          // an upload or a member remove awaits its rate() call (finishPhotoChange)
    ratePc: str,            // idle | checked | read | returned | passed | written | dropping
    rateIds: Set[int],      // the selected photos whose bytes were read
    rateSelection: Set[int],// the selected rows (the model fits every row in one selection)
    // requests in flight
    upl: int -> str,        // idle | checked | counted | bytes   (upload)
    used: Set[int],         // request ids already spent
    // erasePhoto runs per caller: deleteFor lists the rows first (erTodo), then each row: bytes, row, dropRatings
    erTodo: str -> Set[int],
    erCur: str -> int,
    erPc: str -> str,       // idle | bytesGone | rowGone
    rmPhase: str,           // idle | erasing                         (remove; then rate again)
    ageSaga: str,           // idle | committed | erasing | dropped   (recordAge noteAge, ageLowered)
    verifySaga: str,        // idle | committed                       (verify fail; then dropRatings for the app)
    banSaga: str,           // idle | banned | dropped                (the staff ban)
    leaveSaga: str,         // idle | consent | erasing | netGone     (Accounts.leave, onForget)
    leaveSrc: str,          // text (the sender's own turn) | staff (privacy-staff.ts:221, api.ts POST /api/me/delete)
    delSaga: str,           // idle | floor | erasing | netGone       (Accounts.deleteAll, onForget)
    delSrc: str,            // text | staff
    // PhotoUploadLinks.redeem: one transaction; the membership is read, then written back with the consent
    lrPc: str,              // idle | read
    lrU: int,               // the upload id of the redeem in flight
    lrSnap: str,            // the membership state that redeem read
    lrWrite: bool,          // no stored consent at the read: the box consent is written by the guarded write
    // photo-consent by text
    pending: bool,          // pending_texts kind photo_consent
    pendingAt: int,
    caPc: str,              // idle | read | checked                 (consentAnswer)
    caSnap: str,            // the membership state that consentAnswer read
    yesGiven: bool,         // explicit consent recorded: YES PHOTOS or the link page box
    // probe photo
    probeSent: bool,
    probeClaims: bool,
    probeAttached: bool,
    probeFlag: bool,        // SLOP_PROBE_PHOTOS, a build constant: either value
    probeWithPhotos: bool,
    exportedRated: bool,
    // observation
    shown: Set[str],
    usedInMatching: bool,
    hadPhotos: bool,
    leftDone: bool,
    textStored: bool,       // a photo by text or by link started an upload
    linkStored: bool,
    turnPhotoDropped: bool,
    countRefused: bool,
    ageRetried: bool,
    // ghosts that name the residue of a known defect (see the header)
    missedRows: Set[int],   // PR-D1: rows written after a deleteFor listed, or for a person no longer eligible
    overLimit: Set[int],    // PR-D2: rows written when the limit was already full
    orphanBytes: Set[int],  // PR-D3: bytes a crash left with no row
    bytelessRows: Set[int], // PR-D3: rows a crash left with no bytes
    // The three rating flags name the residue rating only: each step that drops the rating (or a new write
    // under the lock that replaces it) clears them, so the exception never covers a later rating.
    ratingLeft: bool,       // PR-D3 and sagas: a rating live when a crash stopped the step that drops it
    ageLeftRows: Set[int],  // PR-D5: rows live when a crash stopped the age hook before deleteFor ended
    ageRatingLeft: bool,    // PR-D5: a rating live when a crash stopped the age hook before dropRatings
    rateWriteCrash: bool,   // a crash after a committed score write and before its post-write check
    failedCheckRows: Set[int], // PR-D4: rows live when a staff age check failed (verify keeps them)
    rowBeforeBytes: bool,   // a row written before its bytes (must stay false: stepRowWriteRequiresBytes)
    now: int,
    crashes: int,
    last: str,
  }

  var st: State

  // ---------------------------------------------------------------- guards from the code
  /** PhotoService.adult and verifiedAdult: lowest age 18+, not deleted, a live membership, a member, no failed age check. */
  def adultNow(s: State): bool =
    not(s.deleted) and s.age >= 18 and LIVE.contains(s.membership) and s.netMember and not(s.ageFail)
  /** PhotoService.mayTake: storage on, slop, not banned, adult. */
  def mayTakeNow(s: State): bool = not(s.banned) and adultNow(s)
  /** PhotoService.ratingRefusal: mayTake, a live membership and every named photo still there. */
  def ratingOk(s: State, ids: Set[int]): bool = mayTakeNow(s) and LIVE.contains(s.membership) and ids.subseteq(s.rows)
  /** PhotoService.ratingSelectionRefusal: ratingRefusal and ratingPhotoSelectionCurrent (the same rows). */
  def ratingSelectionOk(s: State): bool = ratingOk(s, s.rateIds) and s.rateSelection == s.rows and s.rows != Set()

  def erasing(s: State, e: str): bool = s.erPc.get(e) != "idle" or s.erTodo.get(e) != Set()
  def quiescent(s: State): bool = and {
    UPLOADS.forall(u => s.upl.get(u) == "idle"),
    s.ratePc == "idle", s.rmPhase == "idle", s.ageSaga == "idle", s.verifySaga == "idle",
    s.banSaga == "idle", s.leaveSaga == "idle", s.delSaga == "idle", s.caPc == "idle", s.lrPc == "idle",
    ERASERS.forall(e => not(erasing(s, e))),
  }
  /** A step that drops the rating (dropRatings, forget, discard) also ends the residue that the flags name. */
  def noRating(s: State): State =
    { ...s, rating: false, ratingFrom: Set(), ratingLeft: false, ageRatingLeft: false, rateWriteCrash: false }
  def settled(s: State): bool = quiescent(s)
  /** A deleteFor that has listed and not finished: a row written now is not in its list. */
  def listTaken(s: State): bool =
    Set("erasing", "dropped").contains(s.ageSaga) or Set("erasing", "netGone").contains(s.leaveSaga) or Set("erasing", "netGone").contains(s.delSaga)

  // ---------------------------------------------------------------- init
  action initWith(probeFlag: bool): bool = st' = {
    age: ADULT_AGE, netAge: ADULT_AGE, ageFail: false, banned: false, banDone: false, deleted: false, membership: "active", netMember: true,
    profileConsent: false,
    objects: Set(), rows: Set(), uplHeader: UPLOADS.mapBy(u => ""),
    rating: false, ratingFrom: Set(), rateDue: false, ratePc: "idle", rateIds: Set(), rateSelection: Set(),
    upl: UPLOADS.mapBy(u => "idle"), used: Set(),
    erTodo: ERASERS.mapBy(e => Set()), erCur: ERASERS.mapBy(e => 0), erPc: ERASERS.mapBy(e => "idle"),
    rmPhase: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", leaveSrc: "text",
    delSaga: "idle", delSrc: "text", lrPc: "idle", lrU: 0, lrSnap: "", lrWrite: false,
    pending: false, pendingAt: 0, caPc: "idle", caSnap: "", yesGiven: false,
    probeSent: false, probeClaims: false, probeAttached: false, probeFlag: probeFlag,
    probeWithPhotos: false, exportedRated: false,
    shown: Set(), usedInMatching: false, hadPhotos: false, leftDone: false, textStored: false, linkStored: false,
    turnPhotoDropped: false, countRefused: false, ageRetried: false,
    missedRows: Set(), overLimit: Set(), orphanBytes: Set(), bytelessRows: Set(), ratingLeft: false,
    ageLeftRows: Set(), ageRatingLeft: false, rateWriteCrash: false, failedCheckRows: Set(),
    rowBeforeBytes: false, now: 0, crashes: 0, last: "init",
  }
  action init = { nondet f = Set(true, false).oneOf() initWith(f) }

  // ---------------------------------------------------------------- photo-object: upload (PhotoService.upload)
  /** beginUpload (app, consent header), then checkUploader (mayTake: one read of the current state). */
  action uploadStart(u: int, header: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)),
    if (header == CONSENT and mayTakeNow(st))
      st' = { ...st, upl: st.upl.set(u, "checked"), used: st.used.union(Set(u)), uplHeader: st.uplHeader.set(u, header), last: "uploadStart" }
    else
      st' = { ...st, last: "uploadRefused" },
  }
  /** checkSlots: meta.list(personId) and photoSlotsFull, with no lock (PR-D2). */
  action uploadCount(u: int): bool = all {
    st.upl.get(u) == "checked",
    if (st.rows.size() >= MAX_PHOTOS) st' = { ...st, upl: st.upl.set(u, "idle"), countRefused: true, last: "uploadTooMany" }
    else st' = { ...st, upl: st.upl.set(u, "counted"), last: "uploadCount" },
  }
  /** storage.put of the stripped bytes under a new random key (recordUploadBytes). */
  action uploadBytes(u: int): bool = all {
    st.upl.get(u) == "counted",
    st' = { ...st, upl: st.upl.set(u, "bytes"), objects: st.objects.union(Set(u)), last: "uploadBytes" },
  }
  /**
   * meta.put: the row is live at once (recordUploadRow), then finishPhotoChange runs rate(). No lock, no
   * second mayTake and no second count (PR-D1, PR-D2): the ghosts record the rows that miss a deleteFor or
   * pass the limit.
   */
  action uploadRow(u: int): bool = all {
    st.upl.get(u) == "bytes",
    val missed = listTaken(st) or not(mayTakeNow(st))
    st' = { ...st, upl: st.upl.set(u, "idle"), rows: st.rows.union(Set(u)), rateDue: true, hadPhotos: true,
            missedRows: if (missed) st.missedRows.union(Set(u)) else st.missedRows,
            overLimit: if (st.rows.size() >= MAX_PHOTOS) st.overLimit.union(Set(u)) else st.overLimit,
            rowBeforeBytes: st.rowBeforeBytes or not(st.objects.contains(u)), last: "uploadRow" },
  }

  // ---------------------------------------------------------------- erasePhoto (bytes, row, dropRatings)
  /** storage.delete for the next listed row (recordRemovedBytes). */
  action eraseBytes(e: str, p: int): bool = all {
    st.erPc.get(e) == "idle", st.erTodo.get(e).contains(p),
    st' = { ...st, objects: st.objects.exclude(Set(p)), erTodo: st.erTodo.set(e, st.erTodo.get(e).exclude(Set(p))),
            erCur: st.erCur.set(e, p), erPc: st.erPc.set(e, "bytesGone"), last: "eraseBytes" },
  }
  /** meta.delete (recordRemovedRow). */
  action eraseRow(e: str): bool = all {
    st.erPc.get(e) == "bytesGone",
    st' = { ...st, rows: st.rows.exclude(Set(st.erCur.get(e))), erPc: st.erPc.set(e, "rowGone"), last: "eraseRow" },
  }
  /** onRemoved: dropRatings for the app (recordRatingClear). */
  action eraseDrop(e: str): bool = all {
    st.erPc.get(e) == "rowGone",
    st' = { ...noRating(st), erPc: st.erPc.set(e, "idle"), erCur: st.erCur.set(e, 0), last: "eraseDrop" },
  }

  // ---------------------------------------------------------------- the member deletes one photo (PhotoService.remove)
  action removeStart(p: int): bool = all {
    st.rmPhase == "idle", st.rows.contains(p),
    st' = { ...st, rmPhase: "erasing", erTodo: st.erTodo.set("rm", Set(p)), last: "removeStart" },
  }
  /** finishRerate: rate() again from what is left. */
  action removeDone: bool = all {
    st.rmPhase == "erasing", not(erasing(st, "rm")),
    st' = { ...st, rmPhase: "idle", rateDue: true, last: "removeDone" },
  }

  // ---------------------------------------------------------------- clef-rating: PhotoService.rate
  /** screenSubject: ratingRefusal (no photo ids) and the lowest age again. */
  action rateStart: bool = all {
    st.ratePc == "idle", st.rateDue,
    if (ratingOk(st, Set())) st' = { ...st, rateDue: false, ratePc: "checked", last: "rateStart" }
    else st' = { ...st, rateDue: false, last: "rateRefused" },
  }
  /** The newest rows (ratingRows), storage.get for each, then supplyPhotos: ratingSelectionRefusal. */
  action rateRead: bool = all {
    st.ratePc == "checked",
    val ids = st.rows.intersect(st.objects)
    if (ids == Set() or not(ratingOk(st, ids))) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoPhotos" }
    else st' = { ...st, ratePc: "read", rateIds: ids, rateSelection: st.rows, last: "rateRead" },
  }
  /** receiveScore: the rater call (oracle). A null score or an error (after withRetry) ends the run. */
  action rateReturn(score: bool): bool = all {
    st.ratePc == "read",
    if (score) st' = { ...st, ratePc: "returned", last: "rateScore" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoScore" },
  }
  /** checkReturnedScore: ratingSelectionRefusal after the rater returns. */
  action rateCheck2: bool = all {
    st.ratePc == "returned",
    if (ratingSelectionOk(st)) st' = { ...st, ratePc: "passed", last: "rateCheck2" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateDiscarded" },
  }
  /** recordScoreWrite: writeRating locks the person row and checks ratingSelectionRefusal in its transaction. */
  action rateWrite: bool = all {
    st.ratePc == "passed",
    if (ratingSelectionOk(st)) st' = { ...st, ratePc: "written", rating: true, ratingFrom: st.rateIds,
                                         ratingLeft: false, ageRatingLeft: false, rateWriteCrash: false, last: "rateWrite" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateWriteRefused" },
  }
  /** checkWrittenScore: the third ratingSelectionRefusal; a refusal discards the written version. */
  action rateCheck3: bool = all {
    st.ratePc == "written",
    if (ratingSelectionOk(st)) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateKept" }
    else st' = { ...st, ratePc: "dropping", last: "rateCheck3Refused" },
  }
  /** recordScoreRemoval: write.discard() (the exact tuple this attempt wrote). */
  action rateDrop: bool = all {
    st.ratePc == "dropping",
    st' = { ...noRating(st), ratePc: "idle", rateIds: Set(), last: "rateDrop" },
  }

  // ---------------------------------------------------------------- the age drops under 18 (recordAge, ageLowered)
  /** noteAge commits the lower age; the hook runs after it. */
  action ageCommit: bool = all {
    st.ageSaga == "idle", st.age >= 18, not(st.deleted),
    st' = { ...st, age: MINOR_AGE, ageSaga: "committed", last: "ageCommit" },
  }
  /** A later age statement (recordAge "Reconcile on retry", projectRecordedAge) runs the hook again. */
  action ageRetry: bool = all {
    st.ageSaga == "idle", st.age < 18, not(st.deleted),
    st' = { ...st, ageSaga: "committed", ageRetried: true, last: "ageRetry" },
  }
  /** ageLowered: photos.deleteFor(person) lists every row of the person. */
  action ageList: bool = all {
    st.ageSaga == "committed",
    st' = { ...st, ageSaga: "erasing", erTodo: st.erTodo.set("age", st.rows), last: "ageList" },
  }
  /** ageLowered: dropRatings(person) after deleteFor. */
  action ageDropRatings: bool = all {
    st.ageSaga == "erasing", not(erasing(st, "age")),
    st' = { ...noRating(st), ageSaga: "dropped", last: "ageDropRatings" },
  }
  /** ageLowered: each membership that is not removed: network.members.age = least(coalesce(age, a), a). */
  action ageMembers: bool = all {
    st.ageSaga == "dropped",
    st' = { ...st, ageSaga: "idle", netAge: if (st.membership != "removed" and st.age < st.netAge) st.age else st.netAge, last: "ageMembers" },
  }

  // ---------------------------------------------------------------- staff age check fails (NetworkService.verify)
  /** The verify:age:fail facet (a staff retry writes it again: on conflict do update). */
  action verifyFail: bool = all {
    st.verifySaga == "idle", st.netMember, st.membership != "removed",
    st' = { ...st, verifySaga: "committed", ageFail: true, failedCheckRows: st.failedCheckRows.union(st.rows), last: "verifyFail" },
  }
  /** dropRatings(person, app). No photo is deleted (PR-D4). */
  action verifyDrop: bool = all {
    st.verifySaga == "committed",
    st' = { ...noRating(st), verifySaga: "idle", last: "verifyDrop" },
  }

  // ---------------------------------------------------------------- ban (the staff ban in service.ts)
  action banCommit: bool = all {
    st.banSaga == "idle", not(st.banned), not(st.deleted),
    st' = { ...st, banSaga: "banned", banned: true, last: "banCommit" },
  }
  /** A staff retry resumes a ban whose projection did not finish (staffBans projectedAt null). */
  action banResume: bool = all {
    st.banSaga == "idle", st.banned, not(st.banDone),
    st' = { ...st, banSaga: "banned", last: "banResume" },
  }
  /** dropRatings(person). The photos stay for the safety team. */
  action banDrop: bool = all {
    st.banSaga == "banned",
    st' = { ...noRating(st), banSaga: "dropped", last: "banDrop" },
  }
  /** restrictBannedMemberships: each membership not removed or invited; then the network marks the member banned. */
  action banRestrict: bool = all {
    st.banSaga == "dropped",
    st' = { ...st, banSaga: "idle", banDone: true, membership: if (st.membership == "removed") "removed" else "restricted",
            last: "banRestrict" },
  }

  // ---------------------------------------------------------------- leave slop (Accounts.leave, onForget)
  // src "text": "leave slop.date" runs inside the sender's serialized turn, so it never overlaps a YES PHOTOS
  // turn. src "staff": the same Accounts.leave from packages/network/service/privacy-staff.ts:221 (the
  // replay of a recorded help@ leave request) or packages/platform/src/api.ts "POST /api/me/delete" with
  // scope "app" is its own request and takes no lock against consentAnswer, so it can overlap a YES PHOTOS turn.
  // A photo upload by link is its own HTTP request and can overlap either.
  /** beginAppLeave: the opted_out consent event; the membership stays live until forgetMembership. */
  action leaveConsent(src: str): bool = all {
    st.leaveSaga == "idle", st.delSaga == "idle", src == "staff" or st.caPc == "idle", st.membership != "removed",
    st' = { ...st, leaveSaga: "consent", leaveSrc: src, last: "leaveConsent" },
  }
  /** onForget: photos.deleteFor(person, app) first: it lists the rows. */
  action leaveList: bool = all {
    st.leaveSaga == "consent",
    st' = { ...st, leaveSaga: "erasing", erTodo: st.erTodo.set("leave", st.rows), last: "leaveList" },
  }
  /** onForget: forget (the network member and its facets, the rating included). */
  action leaveNetForget: bool = all {
    st.leaveSaga == "erasing", not(erasing(st, "leave")),
    st' = { ...noRating(st), leaveSaga: "netGone", netMember: false, last: "leaveNetForget" },
  }
  /** forgetMembership: state removed, profile cleared. It locks the people row, so it waits for a redeem in flight. */
  action leaveForgetMembership: bool = all {
    st.leaveSaga == "netGone", st.lrPc == "idle",
    st' = { ...st, leaveSaga: "idle", membership: "removed", profileConsent: false, leftDone: true,
            last: "leaveForgetMembership" },
  }

  // ---------------------------------------------------------------- delete everything (Accounts.deleteAll)
  /**
   * src "text": a turn of the sender. src "staff": Accounts.deleteAll from
   * packages/network/service/privacy-staff.ts:133 (help@ erasure) and :219 (its replay), or
   * packages/platform/src/api.ts "POST /api/me/delete" with scope "all".
   */
  action delFloor(src: str): bool = all {
    st.delSaga == "idle", st.leaveSaga == "idle", src == "staff" or st.caPc == "idle", not(st.deleted),
    st' = { ...st, delSaga: "floor", delSrc: src, last: "delFloor" },
  }
  action delList: bool = all {
    st.delSaga == "floor",
    st' = { ...st, delSaga: "erasing", erTodo: st.erTodo.set("del", st.rows), last: "delList" },
  }
  action delNetForget: bool = all {
    st.delSaga == "erasing", not(erasing(st, "del")),
    st' = { ...noRating(st), delSaga: "netGone", netMember: false, last: "delNetForget" },
  }
  /**
   * onEraseAccount, then store.deleteAll under the person lock (it waits for a redeem in flight): memberships
   * deleted (removed here), the pending texts deleted, people.deleted_at.
   */
  action delStore: bool = all {
    st.delSaga == "netGone", st.lrPc == "idle",
    st' = { ...st, delSaga: "idle", deleted: true, membership: "removed", profileConsent: false, pending: false, leftDone: true,
            last: "delStore" },
  }

  // ---------------------------------------------------------------- photo-consent and photos by text or link
  // One sender's turns run one at a time, so a text turn never overlaps a text leave or delete everything.
  // A staff leave or erasure is not a turn of the sender and does not wait for it.
  def senderFree(s: State): bool =
    s.caPc == "idle" and not(s.leaveSaga != "idle" and s.leaveSrc == "text") and not(s.delSaga != "idle" and s.delSrc == "text")
  /**
   * A text with an attachment. path "turn": the Eliza gateway turn carries no attachment, so photosIn never
   * runs (SD-097). path "webhook": PhotoIntake.photosIn: a live member, mayTake, the stored consent, then upload.
   */
  action textPhoto(u: int, path: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)), senderFree(st),
    if (path == "turn") st' = { ...st, turnPhotoDropped: true, last: "turnPhotoDropped" }
    else if (not(LIVE.contains(st.membership)) or not(mayTakeNow(st))) st' = { ...st, last: "textPhotoRefused" }
    else if (not(st.profileConsent))
      st' = { ...st, pending: true, pendingAt: st.now, last: "textPhotoAsk" }
    else st' = { ...st, used: st.used.union(Set(u)), upl: st.upl.set(u, "checked"), uplHeader: st.uplHeader.set(u, CONSENT), textStored: true, last: "textPhotoUpload" },
  }
  /**
   * PhotoUploadLinks.redeem, first half of its transaction: the people row lock, the holder check (mayTake, a
   * live membership), the consent (stored, or the page box), the link spent, and getMembership: a plain read
   * of the membership. The staff ban takes no person lock (restrictBannedMemberships is a bare UPDATE), so it
   * can commit between this read and the write; a leave or delete everything waits at its own lock.
   */
  action linkRead(u: int, box: bool): bool = all {
    st.lrPc == "idle", st.upl.get(u) == "idle", not(st.used.contains(u)),
    LIVE.contains(st.membership), mayTakeNow(st), st.profileConsent or box,
    st' = { ...st, used: st.used.union(Set(u)), lrPc: "read", lrU: u, lrSnap: st.membership, lrWrite: not(st.profileConsent),
            yesGiven: st.yesGiven or box, last: "linkRead" },
  }
  /**
   * redeem, second half: with no stored consent, writePhotoConsent sets the consent only while the membership
   * is live and never changes its state. A ban, a leave or an erasure since the read leaves no live row: the
   * write changes nothing and the link closes refused (no upload). With a stored consent nothing is written.
   */
  action linkWrite: bool = all {
    st.lrPc == "read",
    val u = st.lrU
    if (not(st.lrWrite) or LIVE.contains(st.membership))
      st' = { ...st, lrPc: "idle", lrU: 0, upl: st.upl.set(u, "checked"), uplHeader: st.uplHeader.set(u, CONSENT),
              profileConsent: true, textStored: true, linkStored: true, last: "linkWrite" }
    else st' = { ...st, lrPc: "idle", lrU: 0, last: "linkWriteRefused" },
  }
  /** consentAnswer: YES PHOTOS within a day of the ask; the pending row goes, then the membership is read. */
  action consentYesRead: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    if (LIVE.contains(st.membership)) st' = { ...st, pending: false, caPc: "read", caSnap: st.membership, last: "consentYesRead" }
    else st' = { ...st, pending: false, last: "consentYesNotMember" },
  }
  /** consentAnswer: mayTake. */
  action consentYesCheck: bool = all {
    st.caPc == "read",
    if (mayTakeNow(st)) st' = { ...st, caPc: "checked", last: "consentYesCheck" }
    else st' = { ...st, caPc: "idle", last: "consentYesRefused" },
  }
  /**
   * consentAnswer (recordConsent): writePhotoConsent sets the consent only while the membership is live and
   * never changes its state, so a ban, a staff leave or an erasure since the read stays as it is.
   */
  action consentYesWrite: bool = all {
    st.caPc == "checked",
    if (LIVE.contains(st.membership)) st' = { ...st, caPc: "idle", profileConsent: true, yesGiven: true, last: "consentYesWrite" }
    else st' = { ...st, caPc: "idle", last: "consentYesNotLive" },
  }
  /** NO PHOTOS only deletes the pending row; an earlier YES stays. */
  action consentNo: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    st' = { ...st, pending: false, last: "consentNo" },
  }

  // ---------------------------------------------------------------- slop-probe-photo (packs.ts)
  action probe(recipientAge: int): bool = all {
    not(st.probeSent), st.rating,
    val refs = probePhotoRefs(st.age, st.probeFlag, st.banned or not(LIVE.contains(st.membership)), probeHookIds(st), recipientAge)
    st' = { ...st, probeSent: true, probeClaims: probeTextClaims(refs),
            probeAttached: PROBE_HOOK_KEEPS_PHOTOS and refs != Set(),
            probeWithPhotos: st.probeFlag and st.rows != Set() and recipientAge >= 18 and adultNow(st), last: "probe" },
  }

  // ---------------------------------------------------------------- reads that show data
  action memberList: bool = all { not(st.shown.contains("contentType")), st' = { ...st, shown: st.shown.union(MEMBER_LIST_FIELDS), last: "memberList" } }
  /** PhotoService.staffLinks: PhotoService.adult again. */
  action staffLinks: bool = all {
    adultNow(st), not(st.shown.contains("url")),
    st' = { ...st, shown: st.shown.union(STAFF_LINK_FIELDS), last: "staffLinks" },
  }
  /** exportMember: the stored facets through memberExportFacetAllowed, and the photo list. */
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

  // ---------------------------------------------------------------- environment
  action tick: bool = all { st.now < MAX_TICK, st' = { ...st, now: st.now + 1, last: "tick" } }
  /** A process crash ends every request in memory; committed rows, objects and facets stay. */
  action crash: bool = all {
    st.crashes < MAX_CRASHES, not(quiescent(st)),
    val gone = ERASERS.filter(e => st.erPc.get(e) == "bytesGone").map(e => st.erCur.get(e))
    val rowGoneNoDrop = ERASERS.exists(e => st.erPc.get(e) == "rowGone")
    st' = { ...st, crashes: st.crashes + 1, upl: UPLOADS.mapBy(u => "idle"), rateDue: false, ratePc: "idle", rateIds: Set(),
            erTodo: ERASERS.mapBy(e => Set()), erCur: ERASERS.mapBy(e => 0), erPc: ERASERS.mapBy(e => "idle"),
            rmPhase: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle", caPc: "idle",
            lrPc: "idle", lrU: 0,
            orphanBytes: st.orphanBytes.union(UPLOADS.filter(u => st.upl.get(u) == "bytes")),
            bytelessRows: st.bytelessRows.union(gone),
            ratingLeft: st.ratingLeft or (st.rating and (rowGoneNoDrop or st.banSaga == "banned" or st.verifySaga == "committed")),
            ageLeftRows: st.ageLeftRows.union(if (Set("committed", "erasing").contains(st.ageSaga)) st.rows else Set()),
            ageRatingLeft: st.ageRatingLeft or (st.rating and Set("committed", "erasing").contains(st.ageSaga)),
            rateWriteCrash: st.rateWriteCrash or (Set("written", "dropping").contains(st.ratePc) and not(ratingSelectionOk(st))),
            last: "crash" },
  }

  action step = {
    nondet u = UPLOADS.oneOf()
    nondet h = HEADERS.oneOf()
    nondet e = ERASERS.oneOf()
    nondet path = Set("turn", "webhook").oneOf()
    nondet box = Set(true, false).oneOf()
    nondet score = Set(true, false).oneOf()
    nondet focus = Set(true, false).oneOf()
    nondet src = Set("text", "staff").oneOf()
    // Weights for the random walk only (each action stays in the full `any` below): in half of the steps
    // a request in flight goes on, and a stored rating is read (probe, export, matching).
    if (focus and UPLOADS.exists(x => st.upl.get(x) != "idle")) {
      nondet uf = UPLOADS.filter(x => st.upl.get(x) != "idle").oneOf()
      any { uploadCount(uf), uploadBytes(uf), uploadRow(uf) }
    }
    else if (focus and ERASERS.exists(x => erasing(st, x))) {
      nondet ef = ERASERS.filter(x => erasing(st, x)).oneOf()
      nondet pf = UPLOADS.oneOf()
      any { eraseBytes(ef, pf), eraseRow(ef), eraseDrop(ef) }
    }
    else if (focus and (st.ratePc != "idle" or st.rateDue))
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop }
    else if (focus and (st.caPc != "idle" or st.lrPc != "idle"))
      any { consentYesCheck, consentYesWrite, linkWrite, banCommit, banDrop, banRestrict, leaveConsent("staff"), delFloor("staff") }
    else if (focus and st.rating) any { probe(ADULT_AGE), probe(MINOR_AGE), exportMember, matchRead }
    else any {
      any { uploadStart(u, h), uploadCount(u), uploadBytes(u), uploadRow(u) },
      any { removeStart(u), removeDone, eraseBytes(e, u), eraseRow(e), eraseDrop(e) },
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop },
      any { ageList, ageDropRatings, ageMembers, verifyDrop, banDrop, banRestrict,
            leaveList, leaveNetForget, leaveForgetMembership, delList, delNetForget, delStore },
      any { textPhoto(u, path), linkRead(u, box), linkWrite, consentYesRead, consentYesCheck, consentYesWrite, consentNo },
      any { probe(ADULT_AGE), probe(MINOR_AGE), memberList, staffLinks, exportMember, matchRead },
      any { tick, crash, ageRetry, banResume, any { ageCommit, verifyFail, banCommit, leaveConsent(src), delFloor(src) } },
    }
  }

  // ---------------------------------------------------------------- invariants
  // The state rules are checked when no request is in flight (quiescent). Each full rule is a named val; the
  // `_exceptKnown` form leaves out only the residue that a named code defect leaves (see the header).
  /**
   * Rule: photos are for adults only, never for members aged 13-17; a person whose lowest age drops under 18
   * loses them all (AGENTS.md platform decision 9; photos.ts header). Fails on PR-D1 and PR-D5.
   */
  def photoOnlyForAdultIn(rows: Set[int], s: State): bool = rows != Set() implies (s.age >= 18 and not(s.deleted))
  val photoOnlyForAdult: bool = quiescent(st) implies photoOnlyForAdultIn(st.rows, st)
  val photoOnlyForAdult_exceptKnown: bool =
    quiescent(st) implies photoOnlyForAdultIn(st.rows.exclude(st.missedRows.union(st.ageLeftRows)), st)
  /** Rule: no photo stays after a failed staff age check (decision 9; the app's own check is part of "adult"). Fails on PR-D4. */
  def photoNotKeptAfterFailedAgeCheckIn(rows: Set[int], s: State): bool = rows != Set() implies not(s.ageFail)
  val photoNotKeptAfterFailedAgeCheck: bool = quiescent(st) implies photoNotKeptAfterFailedAgeCheckIn(st.rows, st)
  val photoNotKeptAfterFailedAgeCheck_exceptKnown: bool =
    quiescent(st) implies photoNotKeptAfterFailedAgeCheckIn(st.rows.exclude(st.failedCheckRows.union(st.missedRows)), st)
  /** Rule: leaving the app or deleting everything deletes every photo and its bytes. Fails on PR-D1 and PR-D3. */
  def noPhotoAfterForgetIn(rows: Set[int], objects: Set[int], s: State): bool =
    (s.membership == "removed" or s.deleted) implies (rows == Set() and objects == Set())
  val noPhotoAfterForget: bool = quiescent(st) implies noPhotoAfterForgetIn(st.rows, st.objects, st)
  val noPhotoAfterForget_exceptKnown: bool = quiescent(st) implies
    noPhotoAfterForgetIn(st.rows.exclude(st.missedRows), st.objects.exclude(st.missedRows.union(st.orphanBytes)), st)
  /** Rule: a person whom the Network forgot (leave, delete everything) has no photo. Fails on PR-D1 and PR-D3. */
  def noPhotoForForgottenMemberIn(rows: Set[int], objects: Set[int], s: State): bool =
    not(s.netMember) implies (rows == Set() and objects == Set())
  val noPhotoForForgottenMember: bool = quiescent(st) implies noPhotoForForgottenMemberIn(st.rows, st.objects, st)
  val noPhotoForForgottenMember_exceptKnown: bool = quiescent(st) implies
    noPhotoForForgottenMemberIn(st.rows.exclude(st.missedRows), st.objects.exclude(st.missedRows.union(st.orphanBytes)), st)
  /** Rule: at most uploadMaxPerPerson live photos, in every state. Fails on PR-D2. */
  val countLimit: bool = st.rows.size() <= MAX_PHOTOS
  val countLimit_exceptKnown: bool = st.rows.exclude(st.overLimit).size() <= MAX_PHOTOS
  /** Rule: bytes and row live and die together; no orphan bytes, no row without bytes. Fails on PR-D3. */
  val bytesMatchRow: bool = quiescent(st) implies st.objects == st.rows
  val bytesMatchRow_exceptKnown: bool = quiescent(st) implies st.objects.exclude(st.orphanBytes) == st.rows.exclude(st.bytelessRows)
  /** stepRowWriteRequiresBytes (spec/photoRetention.md) across the whole flow: a row is written only after its bytes. */
  val rowWriteRequiresBytes: bool = not(st.rowBeforeBytes)
  /**
   * Rule: no rating for a minor (decision 13; "Adults only, scores never shown"). writeRating checks the age
   * under the person lock, so only a crash residue can break it.
   */
  val noRatingForMinor: bool = quiescent(st) implies (st.rating implies (st.age >= 18 and not(st.deleted)))
  val noRatingForMinor_exceptKnown: bool = not(st.rateWriteCrash or st.ageRatingLeft) implies noRatingForMinor
  /**
   * Rule: a rating only for a verified adult with a live membership who is not banned, from photos that still
   * exist (ratingRefusal; verify; the ban). Fails after a crash before the step that drops it.
   */
  val ratingOnlyForEligible: bool = quiescent(st) implies
    (st.rating implies (not(st.ageFail) and not(st.banned) and LIVE.contains(st.membership) and st.ratingFrom.subseteq(st.rows)))
  val ratingOnlyForEligible_exceptKnown: bool =
    not(st.rateWriteCrash or st.ageRatingLeft or st.ratingLeft) implies ratingOnlyForEligible
  /** Rule: scores are never shown to anyone (decisions 9 and 13). The export runs the code's own filter. */
  val scoresNeverShown: bool = not(st.shown.contains("score"))
  /** Rule: a photo is stored only from an upload that carried the current consent version (beginUpload). */
  val rowHasConsent: bool = st.rows.forall(p => st.uplHeader.get(p) == CONSENT)
  /** Rule: a photo by text or by link is taken only after an explicit YES PHOTOS or the link page box. */
  val textPhotoNeedsConsent: bool = st.textStored implies st.yesGiven
  /** Rule: the probe says a photo is attached only when one goes with it (decision 9 relay; slopProbeMessage). */
  val probeClaimMatches: bool = st.probeClaims implies st.probeAttached
  /**
   * Rule: leave stops the app and delete everything ends the account (decision 7, PRD 40.3; the help@ path of
   * the 2026-10-19 correction). A later write must not make the membership live again (held since the PR-D6 fix).
   */
  val leaveSticks: bool = st.leftDone implies not(LIVE.contains(st.membership))
  /** Rule: a ban stops the number on every app (founder 2026-10-09 decision 3; restrictBannedMemberships; held since the PR-D6 fix). */
  val banSticks: bool =
    st.banned and st.banSaga == "idle" and st.banDone and st.membership != "removed" implies st.membership == "restricted"

  val safety: bool = and {
    photoOnlyForAdult_exceptKnown, noPhotoAfterForget_exceptKnown, noPhotoForForgottenMember_exceptKnown,
    countLimit_exceptKnown, bytesMatchRow_exceptKnown, rowWriteRequiresBytes,
    noRatingForMinor_exceptKnown, ratingOnlyForEligible_exceptKnown,
    scoresNeverShown, rowHasConsent, textPhotoNeedsConsent, probeClaimMatches, leaveSticks, banSticks,
    photoNotKeptAfterFailedAgeCheck_exceptKnown,
  }

  // ---------------------------------------------------------------- witnesses (each must be violated)
  val witness_ratedAndMatched: bool = not(st.usedInMatching)
  val witness_ageDropClears: bool = not(st.hadPhotos and st.age < 18 and settled(st) and st.rows == Set() and not(st.rating))
  val witness_leaveClears: bool = not(st.leftDone and st.hadPhotos and settled(st) and st.rows == Set())
  val witness_textPhotoStored: bool = not(st.textStored and not(st.linkStored) and st.rows != Set())
  val witness_linkPhotoStored: bool = not(st.linkStored and st.rows != Set())
  val witness_turnPhotoDropped: bool = not(st.turnPhotoDropped)
  val witness_banKeepsPhotos: bool = not(st.banned and st.banSaga == "idle" and st.rows != Set() and not(st.rating))
  val witness_probeSent: bool = not(st.probeSent)
  val witness_exportRated: bool = not(st.exportedRated)
  val witness_probeWithPhotos: bool = not(st.probeWithPhotos)
  val witness_crash: bool = not(st.crashes > 0)
  val witness_countRefused: bool = not(st.countRefused)
  val witness_memberRemove: bool = not(st.last == "removeDone")
  val witness_ageRetried: bool = not(st.ageRetried)

  // ---------------------------------------------------------------- run tests (concrete traces)
  run adultUploadRatedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(matchRead)
      .expect(st.rating and st.rows == Set(1) and st.objects == Set(1) and st.usedInMatching and bytesMatchRow and safety)

  run staleHeaderTest =
    init.then(uploadStart(1, "old")).expect(st.upl.get(1) == "idle" and st.rows == Set())

  /** An age change after the write ends the attempt at the post-write check. */
  run lateRatingDroppedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite)
      .then(ageCommit).then(ageList).then(eraseBytes("age", 1)).then(eraseRow("age")).then(eraseDrop("age"))
      .then(ageDropRatings).then(ageMembers)
      .then(rateCheck3).then(rateDrop)
      .expect(not(st.rating) and st.rows == Set() and settled(st) and photoOnlyForAdult and safety)

  /** A completed age change refuses the write. */
  run rateWriteRefusedAfterAgeChangeTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2)
      .then(ageCommit).then(ageList).then(eraseBytes("age", 1)).then(eraseRow("age")).then(eraseDrop("age"))
      .then(ageDropRatings).then(ageMembers)
      .then(rateWrite)
      .expect(not(st.rating) and st.age < 18 and settled(st) and noRatingForMinor and safety)

  /** A newly uploaded photo supersedes an in-flight score even when the earlier photo still exists. */
  run changedPhotoSelectionTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead)
      .then(uploadStart(2, CONSENT)).then(uploadCount(2)).then(uploadBytes(2)).then(uploadRow(2))
      .then(rateReturn(true)).then(rateCheck2)
      .expect(not(st.rating) and st.rows == Set(1, 2) and st.rateDue and st.last == "rateDiscarded")

  /** The member deletes a photo: bytes, row, rating; then rate() runs again from what is left. */
  run memberRemoveTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(eraseBytes("rm", 1)).then(eraseRow("rm")).then(eraseDrop("rm")).then(removeDone)
      .then(rateStart).then(rateRead)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and settled(st) and bytesMatchRow and safety)

  /** Leave with no upload in flight deletes every photo and the rating. */
  run leaveClearsTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(leaveConsent("text")).then(leaveList).then(eraseBytes("leave", 1)).then(eraseRow("leave")).then(eraseDrop("leave"))
      .then(leaveNetForget).then(leaveForgetMembership).then(rateStart)
      .expect(st.membership == "removed" and st.rows == Set() and st.objects == Set() and settled(st)
              and noPhotoAfterForget and noPhotoForForgottenMember and safety)

  /** PR-D1 (open): the row lands after the age hook listed the rows, so a minor keeps the photo. */
  run d1RowAfterAgeListKeptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1))
      .then(ageCommit).then(ageList)
      .then(uploadRow(1)).then(rateStart)
      .then(ageDropRatings).then(ageMembers)
      .expect(st.rows == Set(1) and st.age < 18 and settled(st) and not(photoOnlyForAdult) and st.missedRows == Set(1) and safety)

  /** PR-D1 (open): an upload by link lands while a text leave erases, so the removed member keeps the photo. */
  run d1RowDuringLeaveKeptTest =
    init
      .then(linkRead(1, true)).then(linkWrite).then(uploadCount(1)).then(uploadBytes(1))
      .then(leaveConsent("text")).then(leaveList)
      .then(uploadRow(1))
      .then(leaveNetForget).then(leaveForgetMembership).then(rateStart)
      .expect(st.membership == "removed" and st.rows == Set(1) and settled(st) and not(noPhotoAfterForget) and safety)

  /** PR-D2 (open): two uploads both pass the unlocked count; the person keeps more than the limit. */
  run d2CountRaceTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(uploadStart(2, CONSENT)).then(uploadStart(3, CONSENT)).then(uploadCount(2)).then(uploadCount(3))
      .then(uploadBytes(2)).then(uploadBytes(3)).then(uploadRow(2)).then(uploadRow(3))
      .expect(st.rows == Set(1, 2, 3) and not(countLimit) and st.overLimit == Set(3) and safety)

  /** PR-D3 (open): a crash after storage.put and before meta.put leaves bytes that nothing deletes. */
  run d3OrphanBytesTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(crash)
      .then(delFloor("text")).then(delList).then(delNetForget).then(delStore)
      .expect(st.objects == Set(1) and st.rows == Set() and st.deleted and settled(st)
              and not(bytesMatchRow) and not(noPhotoAfterForget) and safety)

  /** PR-D3 (open): a crash after the row delete and before dropRatings keeps a rating of a deleted photo. */
  run d3StaleRatingTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(eraseBytes("rm", 1)).then(eraseRow("rm")).then(crash)
      .expect(st.rating and st.rows == Set() and settled(st) and not(ratingOnlyForEligible) and st.ratingLeft and safety)

  /** PR-D4 (open): a failed staff age check drops the rating and keeps the photos. */
  run d4FailedAgeCheckKeepsPhotosTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(verifyFail).then(verifyDrop)
      .expect(st.rows == Set(1) and not(st.rating) and st.ageFail and settled(st) and not(photoNotKeptAfterFailedAgeCheck)
              and st.failedCheckRows == Set(1) and safety)

  /** PR-D5 (open): a crash after noteAge keeps a minor's photos until a later age statement runs the hook again. */
  run d5CrashAfterAgeCommitTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(ageCommit).then(crash)
      .expect(st.rows == Set(1) and st.age < 18 and settled(st) and not(photoOnlyForAdult) and st.ageLeftRows == Set(1) and safety)
      .then(ageRetry).then(ageList).then(eraseBytes("age", 1)).then(eraseRow("age")).then(eraseDrop("age"))
      .then(ageDropRatings).then(ageMembers)
      .expect(st.rows == Set() and st.netAge == MINOR_AGE and settled(st) and photoOnlyForAdult and safety)

  /** A crash after the ban commit keeps the rating; the staff retry resumes the ban and drops it. */
  run banCrashResumedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .expect(st.rating and st.banned and settled(st) and not(ratingOnlyForEligible) and st.ratingLeft and safety)
      .then(banResume).then(banDrop).then(banRestrict)
      .expect(not(st.rating) and not(st.ratingLeft) and st.membership == "restricted" and st.rows == Set(1)
              and ratingOnlyForEligible and banSticks and safety)

  /** PR-D6 fixed: a ban lands inside a YES PHOTOS turn; the guarded write keeps the membership restricted. */
  run d6ConsentWriteKeepsBanTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck)
      .then(banCommit).then(banDrop).then(banRestrict)
      .then(consentYesWrite)
      .expect(st.banned and st.membership == "restricted" and not(st.profileConsent) and banSticks and safety)

  /** PR-D6 fixed: a staff leave (help@) lands inside a YES PHOTOS turn; the membership stays removed. */
  run d6ConsentWriteKeepsLeaveTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck)
      .then(leaveConsent("staff")).then(leaveList).then(leaveNetForget).then(leaveForgetMembership)
      .then(consentYesWrite)
      .expect(st.membership == "removed" and st.leftDone and settled(st) and leaveSticks and safety)

  /** PR-D6 fixed: a staff erasure lands inside a YES PHOTOS turn; no new membership comes back. */
  run d6ConsentWriteKeepsEraseTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck)
      .then(delFloor("staff")).then(delList).then(delNetForget).then(delStore)
      .then(consentYesWrite)
      .expect(st.deleted and st.membership == "removed" and settled(st) and leaveSticks and safety)

  /** A text leave is a turn of the same sender: it cannot start while a YES PHOTOS turn runs. */
  run textLeaveWaitsForConsentTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead)
      .then(leaveConsent("text"))
      .fail()

  /** PR-D6 fixed: a ban commits between redeem's read and its consent write; the link closes refused, nothing is uploaded. */
  run d6LinkRedeemKeepsBanTest =
    init
      .then(linkRead(1, true))
      .then(banCommit).then(banDrop).then(banRestrict)
      .then(linkWrite)
      .expect(st.banned and st.membership == "restricted" and st.upl.get(1) == "idle" and not(st.linkStored) and banSticks and safety)

  /** A leave waits at forgetMembership for a redeem in flight (the person lock), so the link cannot undo it. */
  run linkRedeemBeforeLeaveTest =
    init
      .then(linkRead(1, true))
      .then(leaveConsent("text")).then(leaveList).then(leaveNetForget)
      .then(leaveForgetMembership)
      .fail()

  /** After a crash residue is dropped, the exception ends: a new eligible rating is checked by the full rule. */
  run residueEndsAfterDropTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .expect(st.ratingLeft)
      .then(banResume).then(banDrop)
      .expect(not(st.ratingLeft) and not(st.rating))

  run probeFlagOnTest =
    initWith(true)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(probe(ADULT_AGE))
      .expect(st.probeSent and not(st.probeClaims) and probeClaimMatches and safety)

  run exportHidesScoreTest =
    initWith(false)
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(exportMember)
      .expect(st.rating and st.shown.contains("fact") and st.shown.contains("interest") and scoresNeverShown and safety)

  /** A photo by text after YES PHOTOS (webhook path); a link upload with the page box. */
  run textAndLinkPhotoTest =
    initWith(false)
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck).then(consentYesWrite)
      .then(textPhoto(2, "webhook")).then(uploadCount(2)).then(uploadBytes(2)).then(uploadRow(2))
      .then(linkRead(3, false)).then(linkWrite).then(uploadCount(3)).then(uploadBytes(3)).then(uploadRow(3))
      .expect(st.rows == Set(2, 3) and rowHasConsent and textPhotoNeedsConsent and safety)

  /** A link without the stored consent and without the box takes nothing. */
  run linkNeedsConsentTest =
    init.then(linkRead(1, false)).fail()

  run sd097TurnPhotoDroppedTest =
    init.then(textPhoto(1, "turn")).expect(st.turnPhotoDropped and not(st.pending) and st.rows == Set())
}
```
