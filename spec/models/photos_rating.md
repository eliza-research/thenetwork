# Photo storage and private ratings

## Story: Photo storage and private ratings

An adult slop.date member needs their photos and private scores managed under their age and consent state.

### Safety rules and reachability

Check photo limits, adult eligibility, erasure, private scores, the DELETE PHOTOS text command, and that a probe never carries a photo. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Production uses the generated [photo eligibility and limits](../photoPolicy.md), [storage and removal transitions](../photoRetention.md), and [rating attempt transitions](../photoRating.md).

Imported from `quint/photos_rating.qnt` at `30d950e`. Compared again with the code of branch `vibestack-matching` on 2026-11-22. See [model index](README.md) for scope, commands and the known defects.

```quint
// quint-check: max-steps=40 max-samples=10000 verify-steps=6
//
// Photos and the Clef rating of one slop.date member. Machines: photo-object, photo-consent, clef-rating,
// slop-probe-text, delete-photos-command.
//
// The model follows the code of branch vibestack-matching (compared 2026-11-22). Code locations are names:
//   packages/platform/src/photos.ts            PhotoService: upload, rate, ratingRefusal, ratingSelectionRefusal,
//                                              remove, deleteFor, erasePhoto, finishPhotoChange, staffLinks, view,
//                                              holdAllowed, ratingAllowed, sweep; PgPhotoStore reserve, confirm, hide
//   packages/network/service/photoSweep.ts     sweepPhotos (run by NetworkService.purge each tick)
//   packages/platform/src/photo-upload-link.ts PhotoUploadLinks.redeem (the link page and its consent box)
//   packages/network/service/service.ts        NetworkService: hooks().onForget, ageLowered, verifiedAdult,
//                                              dropRatings, writeRating, verify, the staff ban, exportMember
//   packages/network/service/photoIntake.ts    PhotoIntake: photosIn, consentAnswer (YES PHOTOS / NO PHOTOS),
//                                              deleteRequest (DELETE PHOTOS; service.ts skips it for a banned sender)
//   packages/platform/src/accounts.ts          Accounts: recordAge, leave, deleteAll
//   packages/network/service/packs.ts          the slop probe text hook (text only, never a photo)
// The generated decisions (photoRetention, photoRating, photoPolicy) order the steps; this model keeps the
// whole sequence with the crash and the races between requests.
//
// Scope: 1 person, 1 app (slop), 3 upload request ids, a photo limit of 2 (the code has 6: the race does
// not depend on the value), 1 crash. Every `await` between two writes is one action. Each request runs in
// memory: a crash ends every request in flight. The retention tick (purge: sweepPhotos and PhotoService.sweep)
// finishes what a crash or a race left: `sweep` is one pass of it, merged into one step. Its fifteen-minute
// wait (unfinishedPhotoDue) is modelled as "the request that owns the change has ended": a reserved row is
// swept only when no upload of it is in flight, and a hidden row only when no eraser holds it. A later age
// statement runs the age hook again (Accounts.recordAge "Reconcile on retry"; ageRetry here). A staff retry
// of a ban resumes it (banResume).
// The rater (Clef) is an oracle: it returns a score, a refusal (null) or an error. One rate() runs at a
// time here; in the code two can overlap, and writeRating's version-bound discard keeps the newer one.
//
// The state rules (photoOnlyForAdult, photoNotKeptAfterFailedAgeCheck, noPhotoAfterForget,
// noPhotoForForgottenMember, bytesMatchRow, noRatingForMinor, ratingOnlyForEligible) are checked in every
// quiescent state (no request in flight) of a trace with no crash, except while raceResidue is set: an upload
// that reserved its row after the photo erasure of a leave or of delete everything and before that request
// forgot the member (the membership is live until then, so the reservation passes). Those two exceptions,
// a crash and that window, are eventual: the next retention tick repairs them. sweepRepairs checks that in
// every quiescent state, with or without a crash or the window, one sweep pass (sweepResult) leaves a state
// where every state rule holds. witness_sweepNeeded shows that such quiescent states are reachable, so
// sweepRepairs is not vacuous. countLimit, bytesAlwaysHaveARow and storedRowHasBytes hold in every state.
//
// CODE DEFECTS FOUND BY THIS MODEL (spec/models/README.md), all fixed on 2026-11-21:
//   PR-D1 the upload wrote its row with no recheck and no lock against deleteFor. Now uploadReserve checks
//         ratingRefusal again and inserts a reserved row under the person lock, deleteFor hides the reserved
//         rows too, and a confirm that finds its row hidden discards the bytes (uploadRow, uploadDiscard).
//         A reserve between a leave's deleteFor and its forgetMembership still passes (the membership is live
//         until then); the sweep erases that photo (photoHoldAllowed).
//   PR-D2 the count was read without a lock. Now uploadReserve counts the reserved and stored rows under the lock.
//   PR-D3 the bytes came before the row and nothing swept. Now the row is reserved before the bytes, a removal
//         hides the row, then deletes the bytes, the rating and the row, and the sweep finishes either.
//   PR-D4 a failed staff age check kept the photos. Now verify erases them (verifyList) before dropRatings.
//   PR-D5 a crash after noteAge kept a minor's photos and rating. Now the sweep erases photos and drops a
//         rating that photoHoldAllowed and ratingHoldAllowed no longer allow.
//   PR-D6 FIXED 2026-11-18. YES PHOTOS (consentAnswer) and the upload link (redeem) wrote back the whole
//         membership they read; both now write the consent by one guarded statement (writePhotoConsent).
//         linkWrite and consentYesWrite model that; leaveSticks and banSticks hold with no exception.
// The one exception left, ratingLeft, is not a defect of this flow: a crash in a staff ban after its
// commit keeps the rating until the staff retry (banResume) drops it.
//
// OUTSIDE THE MODEL
//   ageLowered's first branch: a confirmed age under 13 (confirmedUnderage) runs finishUnderageCleanup
//   (beginUnderageCleanup, deleteFor, dropRatings, erase listeners, forget and forgetMembership per app). The
//   model has one minor age (15), so only the 13-17 branch is here.
//   DELETE PHOTOS runs deleteFor(person) with no app: it hides the rows of every app of the person. The model
//   has one app, so it hides the rows of slop. personFor refuses a deleted person, so the command then is a
//   normal message (deletePhotosCmd changes nothing).
//   PhotoService.upload runs mayTake once at its start; textPhoto and the link read stand for that check (the
//   photosIn and redeem holder checks run just before it, with no write between), so they merge into one step.
module photos_rating {

  // ---------------------------------------------------------------- constants
  pure val UPLOADS: Set[int] = Set(1, 2, 3)
  /** uploadMaxPerPerson (spec/photoPolicy.md is 6; 2 here). */
  pure val MAX_PHOTOS: int = 2
  /** PHOTO_CONSENT.version (photos.ts): a constant of the build. */
  pure val CONSENT: str = "2026-11-23"
  pure val HEADERS: Set[str] = Set(CONSENT, "old", "")
  pure val ADULT_AGE: int = 25
  pure val MINOR_AGE: int = 15
  /** The photo_consent pending row is read for one day (PhotoIntake.consentAnswer); one tick is half a day. */
  pure val DAY: int = 2
  pure val MAX_TICK: int = 4
  pure val MAX_CRASHES: int = 1
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
  /** The callers of erasePhoto: the member's remove, and deleteFor in the age hook, a leave, delete everything, the staff age check and DELETE PHOTOS. */
  pure val ERASERS: Set[str] = Set("rm", "age", "leave", "del", "verify", "cmd")

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
    rows: Set[int],         // platform.photos rows that are stored and not hidden (stored_at set, deleted_at null)
    reserved: Set[int],     // rows reserved by an upload (stored_at null, deleted_at null)
    hidden: Set[int],       // stored rows that a removal hid (deleted_at set) until bytes, rating and row are gone
    abandoned: Set[int],    // reserved rows that a removal hid: the upload or the sweep erases them
    uplHeader: int -> str,  // the consent version the upload request carried (upload consentVersion)
    // clef-rating
    rating: bool,           // facet <member>:appearance
    ratingFrom: Set[int],   // the photos the stored score was made from
    rateDue: bool,          // an upload or a member remove awaits its rate() call (finishPhotoChange)
    ratePc: str,            // idle | checked | read | returned | passed | written | dropping
    rateIds: Set[int],      // the selected photos whose bytes were read
    rateSelection: Set[int],// the selected rows (the model fits every row in one selection)
    // requests in flight
    upl: int -> str,        // idle | checked | counted | reserved | bytes | discard   (upload)
    used: Set[int],         // request ids already spent
    // erasePhoto runs per caller: deleteFor hides the rows first (erTodo), then each row: bytes, dropRatings, row
    erTodo: str -> Set[int],
    erCur: str -> int,
    erPc: str -> str,       // idle | bytesGone | ratingGone
    rmPhase: str,           // idle | erasing                         (remove; then rate again)
    ageSaga: str,           // idle | committed | erasing | dropped   (recordAge noteAge, ageLowered)
    verifySaga: str,        // idle | committed | erasing             (verify fail; deleteFor, then dropRatings for the app)
    banSaga: str,           // idle | banned | dropped                (the staff ban)
    leaveSaga: str,         // idle | consent | erasing | netGone     (Accounts.leave, onForget)
    leaveSrc: str, // text (the sender's own turn) | staff (privacy-staff.ts, api.ts POST /api/me/delete)
    delSaga: str,           // idle | floor | erasing | netGone       (Accounts.deleteAll, onForget)
    delSrc: str,            // text | staff
    cmdSaga: str,           // idle | erasing                         (DELETE PHOTOS: deleteRequest, deleteFor)
    cmdTargets: Set[int],   // ghost: the rows and reservations that the command hid
    cmdIgnored: bool,       // ghost: a banned or deleted person's command changed nothing
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
    // probe text
    probeSent: bool,
    probeAttached: bool,
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
    swept: bool,            // the last sweep changed something
    raceResidue: bool,      // ghost: an upload reserved inside the leave or delete-everything window, and a photo is left
    // ghost: the rating a crash in a staff ban left until the staff retry (see the header)
    ratingLeft: bool,
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
    s.banSaga == "idle", s.leaveSaga == "idle", s.delSaga == "idle", s.caPc == "idle", s.lrPc == "idle", s.cmdSaga == "idle",
    ERASERS.forall(e => not(erasing(s, e))),
  }
  /** A step that drops the rating (dropRatings, forget, discard) also ends the residue that the flags name. */
  def noRating(s: State): State =
    { ...s, rating: false, ratingFrom: Set(), ratingLeft: false }
  /** PhotoService.holdAllowed: photoHoldAllowed (spec/photoRetention.md) with the app's own check (verifiedAdult). */
  def holdOk(s: State): bool = adultNow(s)
  /** PhotoService.ratingAllowed: ratingHoldAllowed. */
  def ratingHoldOk(s: State): bool = holdOk(s) and s.rows != Set()
  def sweepDue(s: State): bool = or {
    s.hidden != Set(), s.abandoned != Set(), s.reserved != Set(),
    s.rows != Set() and not(holdOk(s)), s.rating and not(ratingHoldOk(s)),
  }
  def settled(s: State): bool = quiescent(s) and not(sweepDue(s))
  /** The states where the state rules must already hold: quiescent, no crash, and not inside the leave window residue. */
  def checked(s: State): bool = quiescent(s) and s.crashes == 0 and not(s.raceResidue)
  /** deleteFor's hide: one transaction under the person lock; reserved rows are left to their upload. */
  def hideAll(s: State, e: str): State =
    { ...s, erTodo: s.erTodo.set(e, s.rows), hidden: s.hidden.union(s.rows), rows: Set(),
            abandoned: s.abandoned.union(s.reserved), reserved: Set() }

  // ---------------------------------------------------------------- init
  action init: bool = st' = {
    age: ADULT_AGE, netAge: ADULT_AGE, ageFail: false, banned: false, banDone: false, deleted: false, membership: "active", netMember: true,
    profileConsent: false,
    objects: Set(), rows: Set(), reserved: Set(), hidden: Set(), abandoned: Set(), uplHeader: UPLOADS.mapBy(u => ""),
    rating: false, ratingFrom: Set(), rateDue: false, ratePc: "idle", rateIds: Set(), rateSelection: Set(),
    upl: UPLOADS.mapBy(u => "idle"), used: Set(),
    erTodo: ERASERS.mapBy(e => Set()), erCur: ERASERS.mapBy(e => 0), erPc: ERASERS.mapBy(e => "idle"),
    rmPhase: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", leaveSrc: "text",
    delSaga: "idle", delSrc: "text", cmdSaga: "idle", cmdTargets: Set(), cmdIgnored: false,
    lrPc: "idle", lrU: 0, lrSnap: "", lrWrite: false,
    pending: false, pendingAt: 0, caPc: "idle", caSnap: "", yesGiven: false,
    probeSent: false, probeAttached: false, exportedRated: false,
    shown: Set(), usedInMatching: false, hadPhotos: false, leftDone: false, textStored: false, linkStored: false,
    turnPhotoDropped: false, countRefused: false, ageRetried: false,
    swept: false, raceResidue: false, ratingLeft: false,
    rowBeforeBytes: false, now: 0, crashes: 0, last: "init",
  }

  // ---------------------------------------------------------------- photo-object: upload (PhotoService.upload)
  /** beginUpload (app, consent header), then checkUploader (mayTake: one read of the current state). */
  action uploadStart(u: int, header: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)),
    if (header == CONSENT and mayTakeNow(st))
      st' = { ...st, upl: st.upl.set(u, "checked"), used: st.used.union(Set(u)), uplHeader: st.uplHeader.set(u, header), last: "uploadStart" }
    else
      st' = { ...st, last: "uploadRefused" },
  }
  /** checkSlots: meta.list(personId) and photoSlotsFull: an early answer only (uploadReserve counts again). */
  action uploadCount(u: int): bool = all {
    st.upl.get(u) == "checked",
    if (st.rows.size() >= MAX_PHOTOS) st' = { ...st, upl: st.upl.set(u, "idle"), countRefused: true, last: "uploadTooMany" }
    else st' = { ...st, upl: st.upl.set(u, "counted"), last: "uploadCount" },
  }
  /**
   * reserveRow: PgPhotoStore.reserve under the person row lock: ratingRefusal again, the reserved and stored
   * rows counted, and the row inserted as reserved.
   */
  action uploadReserve(u: int): bool = all {
    st.upl.get(u) == "counted",
    if (not(ratingOk(st, Set()))) st' = { ...st, upl: st.upl.set(u, "idle"), last: "uploadReserveRefused" }
    else if (st.rows.union(st.reserved).size() >= MAX_PHOTOS) st' = { ...st, upl: st.upl.set(u, "idle"), countRefused: true, last: "uploadReserveFull" }
    else st' = { ...st, upl: st.upl.set(u, "reserved"), reserved: st.reserved.union(Set(u)),
                 raceResidue: st.raceResidue or st.leaveSaga == "erasing" or st.delSaga == "erasing", last: "uploadReserve" },
  }
  /** storage.put of the stripped bytes under the row's random key (recordUploadBytes). */
  action uploadBytes(u: int): bool = all {
    st.upl.get(u) == "reserved",
    st' = { ...st, upl: st.upl.set(u, "bytes"), objects: st.objects.union(Set(u)), last: "uploadBytes" },
  }
  /** recordUploadRow: PgPhotoStore.confirm takes the same person lock as signup and rechecks eligibility before publishing a reservation. */
  action uploadRow(u: int): bool = all {
    st.upl.get(u) == "bytes",
    if (st.reserved.contains(u) and ratingOk(st, Set()))
      st' = { ...st, upl: st.upl.set(u, "idle"), reserved: st.reserved.exclude(Set(u)), rows: st.rows.union(Set(u)), rateDue: true,
              hadPhotos: true, rowBeforeBytes: st.rowBeforeBytes or not(st.objects.contains(u)), last: "uploadRow" }
    else st' = { ...st, upl: st.upl.set(u, "discard"), last: "uploadHidden" },
  }
  /** recordUploadDiscard: the row was hidden meanwhile; the upload deletes its bytes, then its row. */
  action uploadDiscard(u: int): bool = all {
    st.upl.get(u) == "discard",
    st' = { ...st, upl: st.upl.set(u, "idle"), objects: st.objects.exclude(Set(u)), reserved: st.reserved.exclude(Set(u)), abandoned: st.abandoned.exclude(Set(u)), last: "uploadDiscard" },
  }

  // ---------------------------------------------------------------- erasePhoto (hidden row: bytes, dropRatings, row)
  /** storage.delete for the next hidden row (recordRemovedBytes). */
  action eraseBytes(e: str, p: int): bool = all {
    st.erPc.get(e) == "idle", st.erTodo.get(e).contains(p),
    st' = { ...st, objects: st.objects.exclude(Set(p)), erTodo: st.erTodo.set(e, st.erTodo.get(e).exclude(Set(p))),
            erCur: st.erCur.set(e, p), erPc: st.erPc.set(e, "bytesGone"), last: "eraseBytes" },
  }
  /** onRemoved: dropRatings for the app (recordRatingClear). */
  action eraseDrop(e: str): bool = all {
    st.erPc.get(e) == "bytesGone",
    st' = { ...noRating(st), erPc: st.erPc.set(e, "ratingGone"), last: "eraseDrop" },
  }
  /** meta.delete of the hidden row (recordRemovedRow). */
  action eraseRow(e: str): bool = all {
    st.erPc.get(e) == "ratingGone",
    st' = { ...st, hidden: st.hidden.exclude(Set(st.erCur.get(e))), erPc: st.erPc.set(e, "idle"), erCur: st.erCur.set(e, 0), last: "eraseRow" },
  }

  // ---------------------------------------------------------------- the member deletes one photo (PhotoService.remove)
  action removeStart(p: int): bool = all {
    st.rmPhase == "idle", st.rows.contains(p),
    st' = { ...st, rmPhase: "erasing", rows: st.rows.exclude(Set(p)), hidden: st.hidden.union(Set(p)), erTodo: st.erTodo.set("rm", Set(p)), last: "removeStart" },
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
  /** The newest rows (ratingRows), storage.get for each, then supplyPhotos: a row without bytes ends the run, then ratingSelectionRefusal. */
  action rateRead: bool = all {
    st.ratePc == "checked",
    val ids = st.rows.intersect(st.objects)
    if (ids == Set() or ids != st.rows or not(ratingOk(st, ids))) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoPhotos" }
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
                                         ratingLeft: false, last: "rateWrite" }
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
  /** ageLowered: photos.deleteFor(person) hides every row of the person. */
  action ageList: bool = all {
    st.ageSaga == "committed",
    st' = { ...hideAll(st, "age"), ageSaga: "erasing", last: "ageList" },
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
    st' = { ...st, verifySaga: "committed", ageFail: true, last: "verifyFail" },
  }
  /** photos.deleteFor(person, app) hides every row of the app. */
  action verifyList: bool = all {
    st.verifySaga == "committed",
    st' = { ...hideAll(st, "verify"), verifySaga: "erasing", last: "verifyList" },
  }
  /** dropRatings(person, app) after deleteFor. */
  action verifyDrop: bool = all {
    st.verifySaga == "erasing", not(erasing(st, "verify")),
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
  // turn. src "staff": the same Accounts.leave from packages/network/service/privacy-staff.ts (the
  // replay of a recorded help@ leave request) or packages/platform/src/api.ts "POST /api/me/delete" with
  // scope "app" is its own request and takes no lock against consentAnswer, so it can overlap a YES PHOTOS turn.
  // A photo upload by link is its own HTTP request and can overlap either.
  /** beginAppLeave: the opted_out consent event; the membership stays live until forgetMembership. */
  action leaveConsent(src: str): bool = all {
    st.leaveSaga == "idle", st.delSaga == "idle", src == "staff" or (st.caPc == "idle" and st.cmdSaga == "idle"), st.membership != "removed",
    st' = { ...st, leaveSaga: "consent", leaveSrc: src, last: "leaveConsent" },
  }
  /** onForget: photos.deleteFor(person, app) first: it hides the rows. */
  action leaveList: bool = all {
    st.leaveSaga == "consent",
    st' = { ...hideAll(st, "leave"), leaveSaga: "erasing", last: "leaveList" },
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
   * packages/network/service/privacy-staff.ts (help@ erasure) and its replay, or
   * packages/platform/src/api.ts "POST /api/me/delete" with scope "all".
   */
  action delFloor(src: str): bool = all {
    st.delSaga == "idle", st.leaveSaga == "idle", src == "staff" or (st.caPc == "idle" and st.cmdSaga == "idle"), not(st.deleted),
    st' = { ...st, delSaga: "floor", delSrc: src, last: "delFloor" },
  }
  action delList: bool = all {
    st.delSaga == "floor",
    st' = { ...hideAll(st, "del"), delSaga: "erasing", last: "delList" },
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
    s.caPc == "idle" and s.cmdSaga == "idle" and not(s.leaveSaga != "idle" and s.leaveSrc == "text") and not(s.delSaga != "idle" and s.delSrc == "text")
  /**
   * A text with an attachment. path "turn": the Eliza gateway turn carries no attachment, so photosIn never
   * runs (SD-097). path "webhook": PhotoIntake.photosIn on the shared and Slop lines: a live member, mayTake, the
   * stored consent, then upload. path "otherAppWebhook": another app's dedicated line leaves Slop state as it was.
   */
  action textPhoto(u: int, path: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)), senderFree(st),
    if (path == "turn") st' = { ...st, turnPhotoDropped: true, last: "turnPhotoDropped" }
    else if (path == "otherAppWebhook") st' = { ...st, last: "otherAppPhotoIgnored" }
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

  // ---------------------------------------------------------------- DELETE PHOTOS by text (deleteRequest)
  /**
   * A turn of the sender. service.ts runs deleteRequest only for a sender who is not banned, and personFor
   * refuses a deleted person: then nothing changes. Otherwise deleteFor(person) hides every row of the
   * person and its reservations under the person lock (hideAll), then erases each hidden row: bytes,
   * dropRatings, row.
   */
  action deletePhotosCmd: bool = all {
    senderFree(st), st.cmdSaga == "idle",
    if (st.banned or st.deleted) st' = { ...st, cmdIgnored: true, last: "deletePhotosIgnored" }
    else st' = { ...hideAll(st, "cmd"), cmdSaga: "erasing", cmdTargets: st.rows.union(st.reserved), cmdIgnored: false, last: "deletePhotosCmd" },
  }
  /** The reply after deleteFor returns ("I deleted your photos" or "You have no photos with me"). */
  action deletePhotosDone: bool = all {
    st.cmdSaga == "erasing", not(erasing(st, "cmd")),
    st' = { ...st, cmdSaga: "idle", last: "deletePhotosDone" },
  }

  // ---------------------------------------------------------------- the slop probe (packs.ts): text only
  action probe(recipientAge: int): bool = all {
    not(st.probeSent), st.rating,
    st' = { ...st, probeSent: true, probeAttached: false, last: "probe" },
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

  // ---------------------------------------------------------------- the retention tick (sweepPhotos, PhotoService.sweep)
  def eraserHolds(s: State, p: int): bool = ERASERS.exists(e => s.erTodo.get(e).contains(p) or (s.erPc.get(e) != "idle" and s.erCur.get(e) == p))
  /**
   * One pass: the due unfinished rows (a reserved or hidden row whose request has ended) lose their bytes and
   * their row, a hidden stored row also its rating, and a new rate() is asked; then the holders that
   * photoHoldAllowed refuses are erased by deleteFor (hide, bytes, rating, row), and a rating that
   * ratingHoldAllowed refuses is dropped.
   */
  def sweepResult(s: State): State = {
    val doneReserved = s.reserved.union(s.abandoned).filter(u => s.upl.get(u) == "idle")
    val doneHidden = s.hidden.filter(p => not(eraserHolds(s, p)))
    val s1 = { ...s, objects: s.objects.exclude(doneReserved.union(doneHidden)), reserved: s.reserved.exclude(doneReserved),
               abandoned: s.abandoned.exclude(doneReserved), hidden: s.hidden.exclude(doneHidden),
               rateDue: s.rateDue or doneHidden != Set() }
    val s2 = if (doneHidden != Set()) noRating(s1) else s1
    val unheld = s2.rows.union(s2.reserved) != Set() and not(holdOk(s2))
    val s3 = if (unheld) { ...noRating(s2), objects: s2.objects.exclude(s2.rows), rows: Set(),
                           abandoned: s2.abandoned.union(s2.reserved), reserved: Set() } else s2
    val s4 = if (s3.rating and not(ratingHoldOk(s3))) noRating(s3) else s3
    { ...s4, swept: s4 != { ...s, rateDue: s4.rateDue },
             raceResidue: s4.raceResidue and s4.rows.union(s4.reserved).union(s4.objects) != Set(), last: "sweep" }
  }
  action sweep: bool = st' = sweepResult(st)

  // ---------------------------------------------------------------- environment
  action tick: bool = all { st.now < MAX_TICK, st' = { ...st, now: st.now + 1, last: "tick" } }
  /** A process crash ends every request in memory; committed rows, objects and facets stay. */
  action crash: bool = all {
    st.crashes < MAX_CRASHES, not(quiescent(st)),
    st' = { ...st, crashes: st.crashes + 1, upl: UPLOADS.mapBy(u => "idle"), rateDue: false, ratePc: "idle", rateIds: Set(),
            erTodo: ERASERS.mapBy(e => Set()), erCur: ERASERS.mapBy(e => 0), erPc: ERASERS.mapBy(e => "idle"),
            rmPhase: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle", caPc: "idle", cmdSaga: "idle",
            lrPc: "idle", lrU: 0,
            ratingLeft: st.ratingLeft or (st.rating and st.banSaga == "banned"),
            last: "crash" },
  }

  action step = {
    nondet u = UPLOADS.oneOf()
    nondet h = HEADERS.oneOf()
    nondet e = ERASERS.oneOf()
    nondet path = Set("turn", "webhook", "otherAppWebhook").oneOf()
    nondet box = Set(true, false).oneOf()
    nondet score = Set(true, false).oneOf()
    nondet focus = Set(true, false).oneOf()
    nondet src = Set("text", "staff").oneOf()
    // Weights for the random walk only (each action stays in the full `any` below): in half of the steps
    // a request in flight goes on, and a stored rating is read (probe, export, matching).
    if (focus and UPLOADS.exists(x => st.upl.get(x) != "idle")) {
      nondet uf = UPLOADS.filter(x => st.upl.get(x) != "idle").oneOf()
      any { uploadCount(uf), uploadReserve(uf), uploadBytes(uf), uploadRow(uf), uploadDiscard(uf) }
    }
    else if (focus and ERASERS.exists(x => erasing(st, x))) {
      nondet ef = ERASERS.filter(x => erasing(st, x)).oneOf()
      nondet pf = UPLOADS.oneOf()
      any { eraseBytes(ef, pf), eraseDrop(ef), eraseRow(ef) }
    }
    else if (focus and (st.ratePc != "idle" or st.rateDue))
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop }
    else if (focus and (st.caPc != "idle" or st.lrPc != "idle"))
      any { consentYesCheck, consentYesWrite, linkWrite, banCommit, banDrop, banRestrict, leaveConsent("staff"), delFloor("staff") }
    else if (focus and st.rating) any { probe(ADULT_AGE), probe(MINOR_AGE), exportMember, matchRead }
    else any {
      any { uploadStart(u, h), uploadCount(u), uploadReserve(u), uploadBytes(u), uploadRow(u), uploadDiscard(u) },
      any { removeStart(u), removeDone, eraseBytes(e, u), eraseDrop(e), eraseRow(e), sweep },
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop },
      any { ageList, ageDropRatings, ageMembers, verifyList, verifyDrop, banDrop, banRestrict,
            leaveList, leaveNetForget, leaveForgetMembership, delList, delNetForget, delStore },
      any { textPhoto(u, path), linkRead(u, box), linkWrite, consentYesRead, consentYesCheck, consentYesWrite, consentNo,
            deletePhotosCmd, deletePhotosDone },
      any { probe(ADULT_AGE), probe(MINOR_AGE), memberList, staffLinks, exportMember, matchRead },
      any { tick, crash, ageRetry, banResume, any { ageCommit, verifyFail, banCommit, leaveConsent(src), delFloor(src) } },
    }
  }

  // ---------------------------------------------------------------- invariants
  // The state rules are checked in the `checked` states; sweepRepairs checks one sweep pass from every quiescent state.
  /** Rule: photos are for adults only; a person whose lowest age drops under 18 loses them all (decision 9). */
  def photoOnlyForAdultIn(rows: Set[int], s: State): bool = rows != Set() implies (s.age >= 18 and not(s.deleted))
  val photoOnlyForAdult: bool = checked(st) implies photoOnlyForAdultIn(st.rows, st)
  /** Rule: no photo stays after a failed staff age check (decision 9; the app's own check is part of "adult"). */
  def photoNotKeptAfterFailedAgeCheckIn(rows: Set[int], s: State): bool = rows != Set() implies not(s.ageFail)
  val photoNotKeptAfterFailedAgeCheck: bool = checked(st) implies photoNotKeptAfterFailedAgeCheckIn(st.rows, st)
  /** Rule: leaving the app or deleting everything deletes every photo and its bytes. */
  def noPhotoAfterForgetIn(rows: Set[int], objects: Set[int], s: State): bool =
    (s.membership == "removed" or s.deleted) implies (rows == Set() and objects == Set())
  val noPhotoAfterForget: bool = checked(st) implies noPhotoAfterForgetIn(st.rows, st.objects, st)
  /** Rule: a person whom the Network forgot (leave, delete everything) has no photo. */
  def noPhotoForForgottenMemberIn(rows: Set[int], objects: Set[int], s: State): bool =
    not(s.netMember) implies (rows == Set() and objects == Set())
  val noPhotoForForgottenMember: bool = checked(st) implies noPhotoForForgottenMemberIn(st.rows, st.objects, st)
  /** Rule: at most uploadMaxPerPerson reserved or stored photos, in every state (uploadReserve counts under the lock). */
  val countLimit: bool = st.rows.union(st.reserved).size() <= MAX_PHOTOS
  /** Rule: no bytes without a row, in every state: bytes are written after the reservation and the row is deleted after the bytes. */
  val bytesAlwaysHaveARow: bool = st.objects.subseteq(st.rows.union(st.reserved).union(st.hidden).union(st.abandoned))
  /** Rule: a stored photo always has its bytes, in every state (the row is hidden before its bytes go). */
  val storedRowHasBytes: bool = st.rows.subseteq(st.objects)
  /** Rule: bytes and row live and die together once the sweep has nothing left. */
  def bytesMatchRowIn(s: State): bool = s.objects == s.rows
  val bytesMatchRow: bool = checked(st) implies bytesMatchRowIn(st)
  /** stepRowWriteRequiresBytes (spec/photoRetention.md) across the whole flow: a row is stored only after its bytes. */
  val rowWriteRequiresBytes: bool = not(st.rowBeforeBytes)
  /** Rule: no rating for a minor (decision 13; "Adults only, scores never shown"). */
  def noRatingForMinorIn(s: State): bool = s.rating implies (s.age >= 18 and not(s.deleted))
  val noRatingForMinor: bool = checked(st) implies noRatingForMinorIn(st)
  /**
   * Rule: a rating only for a verified adult with a live membership who is not banned, from photos that still
   * exist (ratingRefusal; verify; the ban; the sweep). The ban residue (ratingLeft) ends at the staff retry.
   */
  def ratingOnlyForEligibleIn(s: State): bool =
    s.rating implies (not(s.ageFail) and not(s.banned) and LIVE.contains(s.membership) and s.ratingFrom.subseteq(s.rows))
  val ratingOnlyForEligible: bool = checked(st) implies ratingOnlyForEligibleIn(st)
  val ratingOnlyForEligible_exceptKnown: bool = not(st.ratingLeft) implies ratingOnlyForEligible
  /** Every state rule, in one state. */
  def stateRulesIn(s: State): bool = and {
    photoOnlyForAdultIn(s.rows, s), photoNotKeptAfterFailedAgeCheckIn(s.rows, s), noPhotoAfterForgetIn(s.rows, s.objects, s),
    noPhotoForForgottenMemberIn(s.rows, s.objects, s), bytesMatchRowIn(s), noRatingForMinorIn(s),
    not(s.ratingLeft) implies ratingOnlyForEligibleIn(s),
  }
  /** Rule: the retention tick repairs every quiescent state, also after a crash or inside the leave window. */
  val sweepRepairs: bool = quiescent(st) implies stateRulesIn(sweepResult(st))
  /** Rule: scores are never shown to anyone (decisions 9 and 13). The export runs the code's own filter. */
  val scoresNeverShown: bool = not(st.shown.contains("score"))
  /** Rule: a photo is stored only from an upload that carried the current consent version (beginUpload). */
  val rowHasConsent: bool = st.rows.forall(p => st.uplHeader.get(p) == CONSENT)
  /** Rule: a photo by text or by link is taken only after an explicit YES PHOTOS or the link page box. */
  val textPhotoNeedsConsent: bool = st.textStored implies st.yesGiven
  /** Rule: a probe never carries a photo (policies, relay and safety: probes omit names and photos). */
  val probeCarriesNoPhoto: bool = not(st.probeAttached)
  /**
   * Rule: DELETE PHOTOS erases every stored photo that it hid, with its bytes and the rating made from it, before
   * it answers. A reservation that it hid is abandoned: the upload's own confirm discards its bytes later
   * (uploadDiscard), so only those bytes can remain at the answer. A photo uploaded after the command is a new photo.
   */
  val deletePhotosErasesAll: bool =
    st.last == "deletePhotosDone" implies (st.cmdTargets.intersect(st.rows.union(st.reserved).union(st.hidden)) == Set()
      and st.cmdTargets.intersect(st.ratingFrom) == Set()
      and st.cmdTargets.exclude(st.abandoned).intersect(st.objects) == Set())
  /**
   * Rule: leave stops the app and delete everything ends the account (decision 7, PRD 40.3; the help@ path of
   * the 2026-10-19 correction). A later write must not make the membership live again (held since the PR-D6 fix).
   */
  val leaveSticks: bool = st.leftDone implies not(LIVE.contains(st.membership))
  /** Rule: a ban stops the number on every app (founder 2026-10-09 decision 3; restrictBannedMemberships; held since the PR-D6 fix). */
  val banSticks: bool =
    st.banned and st.banSaga == "idle" and st.banDone and st.membership != "removed" implies st.membership == "restricted"

  val safety: bool = and {
    photoOnlyForAdult, noPhotoAfterForget, noPhotoForForgottenMember, photoNotKeptAfterFailedAgeCheck,
    countLimit, bytesAlwaysHaveARow, storedRowHasBytes, bytesMatchRow, rowWriteRequiresBytes,
    noRatingForMinor, ratingOnlyForEligible_exceptKnown, sweepRepairs,
    scoresNeverShown, rowHasConsent, textPhotoNeedsConsent, probeCarriesNoPhoto, deletePhotosErasesAll, leaveSticks, banSticks,
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
  val witness_deletePhotosClears: bool = not(st.last == "deletePhotosDone" and st.cmdTargets != Set() and st.rows == Set() and not(st.rating))
  val witness_bannedCommandIgnored: bool = not(st.cmdIgnored and st.banned and st.rows != Set())
  val witness_crash: bool = not(st.crashes > 0)
  val witness_countRefused: bool = not(st.countRefused)
  val witness_memberRemove: bool = not(st.last == "removeDone")
  val witness_ageRetried: bool = not(st.ageRetried)
  val witness_sweepFinishes: bool = not(st.swept and st.crashes > 0)
  val witness_uploadDiscarded: bool = not(st.last == "uploadDiscard")
  val witness_sweepNeeded: bool = not(quiescent(st) and not(stateRulesIn(st)))
  val witness_raceResidue: bool = not(st.raceResidue and quiescent(st))

  // ---------------------------------------------------------------- run tests (concrete traces)
  run adultUploadRatedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(matchRead)
      .expect(st.rating and st.rows == Set(1) and st.objects == Set(1) and st.usedInMatching and bytesMatchRow and safety)

  run staleHeaderTest =
    init.then(uploadStart(1, "old")).expect(st.upl.get(1) == "idle" and st.rows == Set())

  /** An age change after the write ends the attempt at the post-write check. */
  run lateRatingDroppedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite)
      .then(ageCommit).then(ageList).then(eraseBytes("age", 1)).then(eraseDrop("age")).then(eraseRow("age"))
      .then(ageDropRatings).then(ageMembers)
      .then(rateCheck3).then(rateDrop)
      .expect(not(st.rating) and st.rows == Set() and settled(st) and photoOnlyForAdult and safety)

  /** A completed age change refuses the write. */
  run rateWriteRefusedAfterAgeChangeTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2)
      .then(ageCommit).then(ageList).then(eraseBytes("age", 1)).then(eraseDrop("age")).then(eraseRow("age"))
      .then(ageDropRatings).then(ageMembers)
      .then(rateWrite)
      .expect(not(st.rating) and st.age < 18 and settled(st) and noRatingForMinor and safety)

  /** A newly uploaded photo supersedes an in-flight score even when the earlier photo still exists. */
  run changedPhotoSelectionTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead)
      .then(uploadStart(2, CONSENT)).then(uploadCount(2)).then(uploadReserve(2)).then(uploadBytes(2)).then(uploadRow(2))
      .then(rateReturn(true)).then(rateCheck2)
      .expect(not(st.rating) and st.rows == Set(1, 2) and st.rateDue and st.last == "rateDiscarded")

  /** The member deletes a photo: bytes, row, rating; then rate() runs again from what is left. */
  run memberRemoveTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(eraseBytes("rm", 1)).then(eraseDrop("rm")).then(eraseRow("rm")).then(removeDone)
      .then(rateStart).then(rateRead)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and settled(st) and bytesMatchRow and safety)

  /** Leave with no upload in flight deletes every photo and the rating. */
  run leaveClearsTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(leaveConsent("text")).then(leaveList).then(eraseBytes("leave", 1)).then(eraseDrop("leave")).then(eraseRow("leave"))
      .then(leaveNetForget).then(leaveForgetMembership).then(rateStart)
      .expect(st.membership == "removed" and st.rows == Set() and st.objects == Set() and settled(st)
              and noPhotoAfterForget and noPhotoForForgottenMember and safety)

  /** PR-D1 fixed: the age hook hides the reserved row of an upload in flight; its confirm discards the bytes. */
  run d1AgeHidesReservedUploadTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1))
      .then(ageCommit).then(ageList)
      .then(uploadRow(1)).then(uploadDiscard(1))
      .then(ageDropRatings).then(ageMembers)
      .expect(st.rows == Set() and st.objects == Set() and st.age < 18 and settled(st) and photoOnlyForAdult and safety)

  /** PR-D1 fixed: after the lower age commits, the reservation refuses the upload under the lock. */
  run d1ReserveAfterAgeRefusedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1))
      .then(ageCommit).then(uploadReserve(1))
      .expect(st.reserved == Set() and st.upl.get(1) == "idle" and st.last == "uploadReserveRefused")

  /** PR-D1 fixed: a link upload reserves between the leave's deleteFor and forgetMembership; the sweep erases it. */
  run d1LeaveWindowSweptTest =
    init
      .then(linkRead(1, true)).then(linkWrite).then(uploadCount(1))
      .then(leaveConsent("text")).then(leaveList)
      .then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(leaveNetForget).then(leaveForgetMembership).then(rateStart)
      .expect(st.membership == "removed" and st.rows == Set(1) and quiescent(st) and not(settled(st)) and safety)
      .then(sweep)
      .expect(st.rows == Set() and st.objects == Set() and settled(st) and noPhotoAfterForget and safety)

  /** PR-D2 fixed: two uploads pass the early count; the reservation under the lock refuses the second. */
  run d2CountRaceTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(uploadStart(2, CONSENT)).then(uploadStart(3, CONSENT)).then(uploadCount(2)).then(uploadCount(3))
      .then(uploadReserve(2)).then(uploadReserve(3))
      .expect(st.reserved == Set(2) and st.countRefused and st.last == "uploadReserveFull" and countLimit and safety)

  /** PR-D3 fixed: a crash after storage.put leaves a reserved row with its bytes; the sweep deletes both. */
  run d3CrashAfterBytesSweptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(crash)
      .then(delFloor("text")).then(delList).then(delNetForget).then(delStore)
      .expect(st.objects == Set(1) and st.abandoned == Set(1) and st.deleted and quiescent(st) and not(settled(st)) and bytesAlwaysHaveARow and safety)
      .then(sweep)
      .expect(st.objects == Set() and st.abandoned == Set() and settled(st) and bytesMatchRow and noPhotoAfterForget and safety)

  /** PR-D3 fixed: a crash after the bytes and before dropRatings leaves a hidden row; the sweep drops the rating. */
  run d3StaleRatingSweptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(eraseBytes("rm", 1)).then(crash)
      .expect(st.rating and st.hidden == Set(1) and st.rows == Set() and not(settled(st)) and safety)
      .then(sweep)
      .expect(not(st.rating) and st.hidden == Set() and settled(st) and ratingOnlyForEligible and safety)

  /** PR-D4 fixed: a failed staff age check erases the photos, then drops the rating. */
  run d4FailedAgeCheckErasesPhotosTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(verifyFail).then(verifyList).then(eraseBytes("verify", 1)).then(eraseDrop("verify")).then(eraseRow("verify")).then(verifyDrop)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and st.ageFail and settled(st)
              and photoNotKeptAfterFailedAgeCheck and safety)

  /** PR-D5 fixed: a crash after noteAge leaves a minor's photo and rating; the sweep erases both. */
  run d5CrashAfterAgeCommitSweptTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(ageCommit).then(crash)
      .expect(st.rows == Set(1) and st.rating and st.age < 18 and quiescent(st) and not(settled(st)) and safety)
      .then(sweep)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and settled(st) and photoOnlyForAdult and noRatingForMinor and safety)

  /** A crash after the ban commit keeps the rating; the staff retry resumes the ban and drops it. */
  run banCrashResumedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .expect(st.rating and st.banned and settled(st) and not(ratingOnlyForEligibleIn(st)) and st.ratingLeft and safety)
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
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(banCommit).then(crash)
      .expect(st.ratingLeft)
      .then(banResume).then(banDrop)
      .expect(not(st.ratingLeft) and not(st.rating))

  run probeHasNoPhotoTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(probe(ADULT_AGE))
      .expect(st.probeSent and not(st.probeAttached) and probeCarriesNoPhoto and safety)

  /** DELETE PHOTOS: the rows, their bytes and the rating go before the reply. */
  run deletePhotosCmdTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(deletePhotosCmd).then(eraseBytes("cmd", 1)).then(eraseDrop("cmd")).then(eraseRow("cmd")).then(deletePhotosDone)
      .expect(st.rows == Set() and st.objects == Set() and not(st.rating) and st.cmdTargets == Set(1) and settled(st)
              and deletePhotosErasesAll and safety)

  /** DELETE PHOTOS while an upload is in flight: its reserved row is hidden and its confirm discards the bytes. */
  run deletePhotosHidesReservedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1))
      .then(deletePhotosCmd).then(deletePhotosDone)
      .then(all { assert(st.abandoned == Set(1) and st.objects == Set(1) and deletePhotosErasesAll), uploadRow(1) })
      .then(uploadDiscard(1))
      .expect(st.rows == Set() and st.objects == Set() and st.abandoned == Set() and settled(st) and deletePhotosErasesAll and safety)

  /** A banned person's DELETE PHOTOS changes nothing: the photos stay for the safety team. */
  run bannedDeletePhotosIgnoredTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(banCommit).then(banDrop).then(banRestrict)
      .then(deletePhotosCmd)
      .expect(st.cmdIgnored and st.rows == Set(1) and st.objects == Set(1) and st.cmdSaga == "idle" and banSticks and safety)

  run exportHidesScoreTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadReserve(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(exportMember)
      .expect(st.rating and st.shown.contains("fact") and st.shown.contains("interest") and scoresNeverShown and safety)

  /** A photo by text after YES PHOTOS (webhook path); a link upload with the page box. */
  run textAndLinkPhotoTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck).then(consentYesWrite)
      .then(textPhoto(2, "webhook")).then(uploadCount(2)).then(uploadReserve(2)).then(uploadBytes(2)).then(uploadRow(2))
      .then(linkRead(3, false)).then(linkWrite).then(uploadCount(3)).then(uploadReserve(3)).then(uploadBytes(3)).then(uploadRow(3))
      .expect(st.rows == Set(2, 3) and rowHasConsent and textPhotoNeedsConsent and safety)

  /** A link without the stored consent and without the box takes nothing. */
  run linkNeedsConsentTest =
    init.then(linkRead(1, false)).fail()

  run sd097TurnPhotoDroppedTest =
    init.then(textPhoto(1, "turn")).expect(st.turnPhotoDropped and not(st.pending) and st.rows == Set())

  run otherAppPhotoIgnoredTest =
    init.then(textPhoto(1, "otherAppWebhook"))
      .expect(st.last == "otherAppPhotoIgnored" and not(st.pending))
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck).then(consentYesWrite)
      .then(textPhoto(2, "otherAppWebhook"))
      .expect(st.profileConsent and not(st.textStored) and st.used == Set() and st.rows == Set())
}
```
