// quint-check: max-steps=40 max-samples=10000 verify-steps=10
//
// Photos and the Clef rating of one slop.date member (module plan: docs/research/2026-11-07-state-machines.md
// section 6.13). Machines: photo-object, photo-consent, clef-rating, slop-probe-photo.
//
// The model follows the code as it is at ad67275:
//   packages/platform/src/photos.ts          PhotoService (PH): upload, rate, remove, deleteFor, staffLinks
//   packages/network/service/service.ts      SV: the hooks (onForget, ageLowered), verifiedAdult, dropRatings,
//                                            writeRating, verify, ban, the inbound photo path
//   packages/network/service/photoIntake.ts  PI: photos by text and the YES PHOTOS / NO PHOTOS answer
//   packages/platform/src/accounts.ts        A: recordAge, leave, deleteAll
//   packages/network/service/packs.ts        PK: the probe text hook (SLOP_PROBE_PHOTOS)
//
// Scope: 1 person, 1 app (slop), 3 upload request ids, a photo limit of 2 (the code has 6: the race does
// not depend on the value), 1 crash. Every `await` between two writes is one action. Each request runs in
// memory: a crash ends every request in flight and nothing retries it (no sweep, no job).
// The rater (Clef) is an oracle: it returns a score, a refusal (null) or an error.
module photos_rating {

  // ---------------------------------------------------------------- constants
  pure val UPLOADS: Set[int] = Set(1, 2, 3)
  /** PHOTO_MAX_PER_PERSON (PH:91 is 6; 2 here). */
  pure val MAX_PHOTOS: int = 2
  /** PHOTO_CONSENT.version (PH:96): a constant of the build. */
  pure val CONSENT: str = "2026-10-08"
  pure val HEADERS: Set[str] = Set(CONSENT, "old", "")
  pure val ADULT_AGE: int = 25
  pure val MINOR_AGE: int = 15
  /** The photo_consent pending row is read for one day (PI:118); one tick is half a day. */
  pure val DAY: int = 2
  pure val MAX_TICK: int = 4
  pure val MAX_CRASHES: int = 1
  /** SLOP_PROBE_PHOTOS (PK:47) is false; the hook passes photoIds: [] (PK:257) and returns only .text (PK:258). */
  pure val PROBE_PHOTOS: bool = false
  pure val PROBE_IDS_WIRED: bool = false
  /** Membership states that may be rated (PH:406) or send photos (PI:31). */
  pure val LIVE: Set[str] = Set("active", "paused", "onboarding")
  /** What any route, export or console can show about photos (PH:548, PH:579, SV:834 excludes agent_private). */
  pure val MEMBER_LIST_FIELDS: Set[str] = Set("id", "createdAt", "bytes", "contentType")
  pure val STAFF_LINK_FIELDS: Set[str] = Set("id", "url", "expiresAt")
  pure val EXPORT_FIELDS: Set[str] = Set("facets_not_agent_private")

  // ---------------------------------------------------------------- state
  type State = {
    // the person (platform.people) and their network-side facts
    age: int,               // people.lowest_age (A:286 noteAge keeps the least)
    ageFail: bool,          // facet <member>:verify:age with verify:age:fail (SV:1641-1645)
    banned: bool,           // platform.bans (SV:1747-1750)
    deleted: bool,          // people.deleted_at (delete everything)
    membership: str,        // platform.memberships.state: active | restricted | removed
    netMember: bool,        // network.members row live with an age (forget sets age null: runtime.ts:543)
    profileConsent: bool,   // memberships.profile.photoConsent == CONSENT (PI:124)
    // photo-object
    objects: Set[int],      // object storage keys (the upload id stands for the random key)
    rows: Set[int],         // platform.photos rows
    rowVersion: int -> str, // platform.photos.consent_version
    // clef-rating
    rating: bool,           // facet <member>:appearance (SV:1615)
    ratingFrom: Set[int],   // the photos the stored score was made from
    rateDue: bool,          // an upload or delete awaits its rate() call (PH:473, PH:557)
    ratePc: str,            // idle | checked | read | returned | passed | written | dropping
    rateIds: Set[int],
    // requests in flight
    upl: int -> str,        // idle | checked | counted | bytes   (PH:457-472)
    used: Set[int],         // request ids already spent (an id that reached the checks stands for one stored key)
    rmPc: str,              // idle | found | bytesGone | rowGone (PH:551-557)
    rmId: int,
    ageSaga: str,           // idle | committed | photosGone            (A:293, SV:776-779)
    verifySaga: str,        // idle | committed                         (SV:1635-1650)
    banSaga: str,           // idle | banned | dropped                  (SV:1747-1754)
    leaveSaga: str,         // idle | consent | photosGone | netGone    (A:421-429, SV:757-761)
    delSaga: str,           // idle | floor | photosGone | netGone      (A:432-443)
    // photo-consent by text
    pending: bool,          // pending_texts kind photo_consent (PI:90)
    pendingAt: int,
    caPc: str,              // idle | read | checked                    (PI:117-125)
    caSnap: str,            // the membership state read at PI:120
    yesGiven: bool,         // a YES PHOTOS answer was written (PI:124)
    // probe photo
    probeSent: bool,
    probeClaims: bool,      // the probe text says a photo is attached (slopProbeMessage)
    probeAttached: bool,    // a photo id goes out with the probe
    // observation
    shown: Set[str],
    usedInMatching: bool,
    hadPhotos: bool,
    leftDone: bool,
    textStored: bool,
    turnPhotoDropped: bool,
    now: int,
    crashes: int,
    last: str,
  }

  var st: State

  // ---------------------------------------------------------------- guards from the code
  /** PH:439-443 adult(): lowest age 18+, not deleted, and eligible (SV:1577-1590: live membership, member age 18+, no verify:age:fail). */
  def adultNow(s: State): bool =
    not(s.deleted) and s.age >= 18 and LIVE.contains(s.membership) and s.netMember and not(s.ageFail)
  /** PH:450-455 mayTake(): storage on, slop, not banned, adult. */
  def mayTakeNow(s: State): bool = not(s.banned) and adultNow(s)
  /** PH:482-489 ratingRefusal(): mayTake, a live membership, and every rated photo still there. */
  def ratingOk(s: State, ids: Set[int]): bool = mayTakeNow(s) and LIVE.contains(s.membership) and ids.subseteq(s.rows)

  def quiescent(s: State): bool = and {
    UPLOADS.forall(u => s.upl.get(u) == "idle"),
    s.ratePc == "idle", s.rmPc == "idle", s.ageSaga == "idle", s.verifySaga == "idle",
    s.banSaga == "idle", s.leaveSaga == "idle", s.delSaga == "idle", s.caPc == "idle",
  }

  // ---------------------------------------------------------------- init
  action init = st' = {
    age: ADULT_AGE, ageFail: false, banned: false, deleted: false, membership: "active", netMember: true, profileConsent: false,
    objects: Set(), rows: Set(), rowVersion: UPLOADS.mapBy(u => ""),
    rating: false, ratingFrom: Set(), rateDue: false, ratePc: "idle", rateIds: Set(),
    upl: UPLOADS.mapBy(u => "idle"), used: Set(), rmPc: "idle", rmId: 0,
    ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle",
    pending: false, pendingAt: 0, caPc: "idle", caSnap: "", yesGiven: false,
    probeSent: false, probeClaims: false, probeAttached: false,
    shown: Set(), usedInMatching: false, hadPhotos: false, leftDone: false, textStored: false, turnPhotoDropped: false,
    now: 0, crashes: 0, last: "init",
  }

  // ---------------------------------------------------------------- photo-object: upload (PH:457-475)
  /** PH:458-462: storage, app, the consent header, then mayTake (one read of the current state). */
  action uploadStart(u: int, header: str): bool = all {
    st.upl.get(u) == "idle", not(st.used.contains(u)),
    if (header == CONSENT and mayTakeNow(st))
      st' = { ...st, upl: st.upl.set(u, "checked"), used: st.used.union(Set(u)), last: "uploadStart" }
    else
      st' = { ...st, last: "uploadRefused" },
  }
  /** PH:466: the count check is its own read (meta.list over every app); no lock is held after it. */
  action uploadCount(u: int): bool = all {
    st.upl.get(u) == "checked",
    if (st.rows.size() >= MAX_PHOTOS) st' = { ...st, upl: st.upl.set(u, "idle"), last: "uploadTooMany" }
    else st' = { ...st, upl: st.upl.set(u, "counted"), last: "uploadCount" },
  }
  /** PH:471: storage.put of the stripped bytes under a new random key. */
  action uploadBytes(u: int): bool = all {
    st.upl.get(u) == "counted",
    st' = { ...st, upl: st.upl.set(u, "bytes"), objects: st.objects.union(Set(u)), last: "uploadBytes" },
  }
  /** PH:472-473: meta.put of the row, then rate(). No check runs between PH:462 and this write. */
  action uploadRow(u: int): bool = all {
    st.upl.get(u) == "bytes",
    st' = { ...st, upl: st.upl.set(u, "idle"), rows: st.rows.union(Set(u)), rowVersion: st.rowVersion.set(u, CONSENT),
            rateDue: true, hadPhotos: true, last: "uploadRow" },
  }

  // ---------------------------------------------------------------- photo-object: member delete (PH:551-557)
  action removeStart(p: int): bool = all {
    st.rmPc == "idle", st.rows.contains(p),
    st' = { ...st, rmPc: "found", rmId: p, last: "removeStart" },
  }
  action removeBytes: bool = all {
    st.rmPc == "found",
    st' = { ...st, rmPc: "bytesGone", objects: st.objects.exclude(Set(st.rmId)), last: "removeBytes" },
  }
  action removeRow: bool = all {
    st.rmPc == "bytesGone",
    st' = { ...st, rmPc: "rowGone", rows: st.rows.exclude(Set(st.rmId)), last: "removeRow" },
  }
  /** PH:556-557: onRemoved (SV:391 dropRatings for the app), then rate() again. */
  action removeDrop: bool = all {
    st.rmPc == "rowGone",
    st' = { ...st, rmPc: "idle", rating: false, ratingFrom: Set(), rateDue: true, last: "removeDrop" },
  }

  // ---------------------------------------------------------------- clef-rating: rate() (PH:500-527)
  /** PH:501-504: the first ratingRefusal (no photo ids). */
  action rateStart: bool = all {
    st.ratePc == "idle", st.rateDue,
    if (ratingOk(st, Set())) st' = { ...st, rateDue: false, ratePc: "checked", last: "rateStart" }
    else st' = { ...st, rateDue: false, last: "rateRefused" },
  }
  /** PH:507-510: the newest rows, then storage.get for each (a row whose bytes are gone is skipped). */
  action rateRead: bool = all {
    st.ratePc == "checked",
    val ids = st.rows.intersect(st.objects)
    if (ids == Set()) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoPhotos" }
    else st' = { ...st, ratePc: "read", rateIds: ids, last: "rateRead" },
  }
  /** PH:511-512: the rater call (oracle). A null score or an error (after withRetry) ends the run. */
  action rateReturn(score: bool): bool = all {
    st.ratePc == "read",
    if (score) st' = { ...st, ratePc: "returned", last: "rateScore" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateNoScore" },
  }
  /** PH:514-518: the second ratingRefusal with the photo ids. */
  action rateCheck2: bool = all {
    st.ratePc == "returned",
    if (ratingOk(st, st.rateIds)) st' = { ...st, ratePc: "passed", last: "rateCheck2" }
    else st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateDiscarded" },
  }
  /** PH:519 onRating = SV:1611 writeRating: writes when a membership row exists (any state). */
  action rateWrite: bool = all {
    st.ratePc == "passed",
    st' = { ...st, ratePc: "written", rating: true, ratingFrom: st.rateIds, last: "rateWrite" },
  }
  /** PH:520-525: the third ratingRefusal; a refusal drops the rating (onRemoved). */
  action rateCheck3: bool = all {
    st.ratePc == "written",
    if (ratingOk(st, st.rateIds)) st' = { ...st, ratePc: "idle", rateIds: Set(), last: "rateKept" }
    else st' = { ...st, ratePc: "dropping", last: "rateCheck3Refused" },
  }
  action rateDrop: bool = all {
    st.ratePc == "dropping",
    st' = { ...st, ratePc: "idle", rateIds: Set(), rating: false, ratingFrom: Set(), last: "rateDrop" },
  }

  // ---------------------------------------------------------------- the age drops under 18 (A:282-294, SV:776-779)
  /** A:292 noteAge commits the lower age; the hook runs after it (A:293). */
  action ageCommit: bool = all {
    st.ageSaga == "idle", st.age >= 18, not(st.deleted),
    st' = { ...st, age: MINOR_AGE, ageSaga: "committed", last: "ageCommit" },
  }
  /** SV:779 photos.deleteFor(person): lists the rows now, deletes bytes, row, then onRemoved per row (PH:562-566). */
  action ageDeleteFor: bool = all {
    st.ageSaga == "committed",
    st' = { ...st, ageSaga: "photosGone", objects: st.objects.exclude(st.rows), rows: Set(),
            rating: if (st.rows == Set()) st.rating else false, ratingFrom: if (st.rows == Set()) st.ratingFrom else Set(), last: "ageDeleteFor" },
  }
  /** SV:779 dropRatings(person); then SV:780-784 lowers the member ages (no effect on this model's guards). */
  action ageDropRatings: bool = all {
    st.ageSaga == "photosGone",
    st' = { ...st, ageSaga: "idle", rating: false, ratingFrom: Set(), last: "ageDropRatings" },
  }

  // ---------------------------------------------------------------- staff age check fails (SV:1635-1650)
  action verifyFail: bool = all {
    st.verifySaga == "idle", not(st.ageFail), st.netMember, st.membership != "removed",
    st' = { ...st, verifySaga: "committed", ageFail: true, last: "verifyFail" },
  }
  /** SV:1650: dropRatings(person, app). Nothing deletes the photos. */
  action verifyDrop: bool = all {
    st.verifySaga == "committed",
    st' = { ...st, verifySaga: "idle", rating: false, ratingFrom: Set(), last: "verifyDrop" },
  }

  // ---------------------------------------------------------------- ban (SV:1734-1762)
  action banCommit: bool = all {
    st.banSaga == "idle", not(st.banned), not(st.deleted),
    st' = { ...st, banSaga: "banned", banned: true, last: "banCommit" },
  }
  /** SV:1753 dropRatings(person). The photos stay for the safety team (SV:1752). */
  action banDrop: bool = all {
    st.banSaga == "banned",
    st' = { ...st, banSaga: "dropped", rating: false, ratingFrom: Set(), last: "banDrop" },
  }
  /** SV:1754 putMembership(restricted) for each membership that is not removed. */
  action banRestrict: bool = all {
    st.banSaga == "dropped",
    st' = { ...st, banSaga: "idle", membership: if (st.membership == "removed") "removed" else "restricted", last: "banRestrict" },
  }

  // ---------------------------------------------------------------- leave slop (A:421-429; onForget SV:757-761)
  // A text leave runs inside the sender's serialized turn (inbox.ts), so it never overlaps a YES PHOTOS turn.
  action leaveConsent: bool = all {
    st.leaveSaga == "idle", st.delSaga == "idle", st.caPc == "idle", st.membership != "removed",
    st' = { ...st, leaveSaga: "consent", last: "leaveConsent" },
  }
  action leaveDeleteFor: bool = all {
    st.leaveSaga == "consent",
    st' = { ...st, leaveSaga: "photosGone", objects: st.objects.exclude(st.rows), rows: Set(),
            rating: if (st.rows == Set()) st.rating else false, ratingFrom: if (st.rows == Set()) st.ratingFrom else Set(), last: "leaveDeleteFor" },
  }
  /** SV:761 forget: the unit deletes the member's facets (the rating) and sets age null (runtime.ts:537-543). */
  action leaveNetForget: bool = all {
    st.leaveSaga == "photosGone",
    st' = { ...st, leaveSaga: "netGone", netMember: false, rating: false, ratingFrom: Set(), last: "leaveNetForget" },
  }
  /** A:428 forgetMembership: state removed, profile cleared (pg-store.ts:296). */
  action leaveForgetMembership: bool = all {
    st.leaveSaga == "netGone",
    st' = { ...st, leaveSaga: "idle", membership: "removed", profileConsent: false, leftDone: true, last: "leaveForgetMembership" },
  }

  // ---------------------------------------------------------------- delete everything (A:432-443)
  action delFloor: bool = all {
    st.delSaga == "idle", st.leaveSaga == "idle", st.caPc == "idle", not(st.deleted),
    st' = { ...st, delSaga: "floor", last: "delFloor" },
  }
  action delDeleteFor: bool = all {
    st.delSaga == "floor",
    st' = { ...st, delSaga: "photosGone", objects: st.objects.exclude(st.rows), rows: Set(),
            rating: if (st.rows == Set()) st.rating else false, ratingFrom: if (st.rows == Set()) st.ratingFrom else Set(), last: "delDeleteFor" },
  }
  action delNetForget: bool = all {
    st.delSaga == "photosGone",
    st' = { ...st, delSaga: "netGone", netMember: false, rating: false, ratingFrom: Set(), last: "delNetForget" },
  }
  /** pg-store.ts:306-319: memberships removed, people.deleted_at and lowest_age null. */
  action delStore: bool = all {
    st.delSaga == "netGone",
    st' = { ...st, delSaga: "idle", deleted: true, membership: "removed", profileConsent: false, leftDone: true, last: "delStore" },
  }

  // ---------------------------------------------------------------- photo-consent and photos by text (PI, SV:1067-1076)
  /**
   * A text with an attachment. path "turn": the production signed turn (SV:2069) passes mediaUrls: [], so
   * photosIn never runs (SD-097). path "webhook": the direct inbound path (SV:1071-1074) runs photosIn.
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
    // PI:99 upload() with the constant version: the same checks as the web (PH:458-462).
    else st' = { ...st, used: st.used.union(Set(u)), upl: st.upl.set(u, "checked"), textStored: true, last: "textPhotoUpload" },
  }
  /** PI:112-120: YES PHOTOS within a day of the ask; the pending row goes, then the membership is read. */
  action consentYesRead: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    if (LIVE.contains(st.membership)) st' = { ...st, pending: false, caPc: "read", caSnap: st.membership, last: "consentYesRead" }
    else st' = { ...st, pending: false, last: "consentYesNotMember" },
  }
  /** PI:122: mayTake. */
  action consentYesCheck: bool = all {
    st.caPc == "read",
    if (mayTakeNow(st)) st' = { ...st, caPc: "checked", last: "consentYesCheck" }
    else st' = { ...st, caPc: "idle", last: "consentYesRefused" },
  }
  /** PI:124 putMembership({...who.m, profile}): the whole row from the read at PI:120 (pg-store.ts:124-129). */
  action consentYesWrite: bool = all {
    st.caPc == "checked",
    st' = { ...st, caPc: "idle", membership: st.caSnap, profileConsent: true, yesGiven: true, last: "consentYesWrite" },
  }
  /** PI:130: NO PHOTOS only deletes the pending row; an earlier YES stays. */
  action consentNo: bool = all {
    senderFree(st), st.pending, st.now - st.pendingAt <= DAY,
    st' = { ...st, pending: false, last: "consentNo" },
  }

  // ---------------------------------------------------------------- slop-probe-photo (PK:245-258)
  action probe: bool = all {
    not(st.probeSent), st.rating,
    val ids = if (PROBE_IDS_WIRED) st.rows else Set()
    val refs = if (PROBE_PHOTOS and adultNow(st)) ids else Set()
    // slopProbeMessage adds the photo line when refs is not empty; the hook returns only .text (PK:258).
    st' = { ...st, probeSent: true, probeClaims: refs != Set(), probeAttached: false, last: "probe" },
  }

  // ---------------------------------------------------------------- reads that show data
  action memberList: bool = all { not(st.shown.contains("contentType")), st' = { ...st, shown: st.shown.union(MEMBER_LIST_FIELDS), last: "memberList" } }
  action staffLinks: bool = all {
    adultNow(st), not(st.shown.contains("url")),
    st' = { ...st, shown: st.shown.union(STAFF_LINK_FIELDS), last: "staffLinks" },
  }
  action exportMember: bool = all { not(st.shown.contains("facets_not_agent_private")), st' = { ...st, shown: st.shown.union(EXPORT_FIELDS), last: "exportMember" } }
  /** The slop pack reads the appearance facet from the snapshot in matching only (SV:1608-1609). */
  action matchRead: bool = all {
    not(st.usedInMatching), st.rating, LIVE.contains(st.membership), st.netMember, not(st.banned),
    st' = { ...st, usedInMatching: true, last: "matchRead" },
  }

  // ---------------------------------------------------------------- environment
  action tick: bool = all { st.now < MAX_TICK, st' = { ...st, now: st.now + 1, last: "tick" } }
  /** A process crash ends every request in memory; committed rows and objects stay; nothing retries. */
  action crash: bool = all {
    st.crashes < MAX_CRASHES, not(quiescent(st)),
    st' = { ...st, crashes: st.crashes + 1, upl: UPLOADS.mapBy(u => "idle"), rateDue: false, ratePc: "idle", rateIds: Set(),
            rmPc: "idle", ageSaga: "idle", verifySaga: "idle", banSaga: "idle", leaveSaga: "idle", delSaga: "idle",
            caPc: "idle", last: "crash" },
  }

  // The step groups the actions so that the random simulation reaches deep paths: each group is one
  // branch, so the life events (age, failed age check, ban, leave, delete everything, crash) that end
  // most paths do not crowd out the upload and rating steps. Apalache explores every branch the same.
  action step = {
    nondet u = UPLOADS.oneOf()
    nondet h = HEADERS.oneOf()
    nondet path = Set("turn", "webhook").oneOf()
    nondet score = Set(true, false).oneOf()
    any {
      any { uploadStart(u, h), uploadCount(u), uploadBytes(u), uploadRow(u) },
      any { removeStart(u), removeBytes, removeRow, removeDrop },
      any { rateStart, rateRead, rateReturn(score), rateCheck2, rateWrite, rateCheck3, rateDrop },
      any { ageDeleteFor, ageDropRatings, verifyDrop, banDrop, banRestrict,
            leaveDeleteFor, leaveNetForget, leaveForgetMembership, delDeleteFor, delNetForget, delStore },
      any { textPhoto(u, path), consentYesRead, consentYesCheck, consentYesWrite, consentNo },
      any { probe, memberList, staffLinks, exportMember, matchRead },
      any { tick, crash, any { ageCommit, verifyFail, banCommit, leaveConsent, delFloor } },
    }
  }

  // ---------------------------------------------------------------- invariants
  /**
   * Rule: photos are for adults only, never for members aged 13-17; a person whose lowest age drops
   * under 18 loses them all (AGENTS.md platform decision 9, founder 2026-10-08; PH:1-3, PH:31-33).
   * At quiescence no photo row exists for a person under 18. SD-052, Q-photos_rating-1.
   */
  val photoOnlyForAdult: bool = quiescent(st) and st.rows != Set() implies (st.age >= 18 and not(st.deleted))
  /**
   * Rule: the app's own adult check is part of "adult" (PH:9-10, PH:438: no failed staff age check);
   * photos are for adults only (decision 9). At quiescence no photo stays after a failed age check. SD-053.
   */
  val photoNotKeptAfterFailedAgeCheck: bool = quiescent(st) and st.rows != Set() implies not(st.ageFail)
  /** Rule: leaving the app or deleting everything deletes every photo (PH:32, SV:759). SD-052. */
  val noPhotoAfterForget: bool =
    quiescent(st) and (st.membership == "removed" or st.deleted) implies (st.rows == Set() and st.objects == Set())
  /** Rule: at most PHOTO_MAX_PER_PERSON photos (PH:12, PH:91). SD-372. */
  val countLimit: bool = st.rows.size() <= MAX_PHOTOS
  /** Rule: bytes and row live and die together; a deleted photo's row is removed, the bytes first (PH:386). SD-176. */
  val bytesMatchRow: bool = quiescent(st) implies st.objects == st.rows
  /** Rule: no rating for a minor (decision 13; PH:24-27; AGENTS "Adults only, scores never shown"). Q-photos_rating-1. */
  val noRatingForMinor: bool = quiescent(st) and st.rating implies (st.age >= 18 and not(st.deleted))
  /**
   * Rule: a rating only for a verified adult with a live membership who is not banned, from photos that
   * still exist (PH:24-27, PH:31; SV:1650 failed age check; SV:1752 ban). SD-176, SD-005 (ban crash), Q-photos_rating-1.
   */
  val ratingOnlyForEligible: bool =
    quiescent(st) and st.rating implies
      (not(st.ageFail) and not(st.banned) and LIVE.contains(st.membership) and st.ratingFrom.subseteq(st.rows))
  /** Rule: scores are never shown to anyone (AGENTS decision 9 and 13; PH:29-30). */
  val scoresNeverShown: bool = not(st.shown.contains("score"))
  /** Rule: a photo is stored only with the photo consent of the current version (PH:8, PH:460). */
  val rowHasConsent: bool = st.rows.forall(p => st.rowVersion.get(p) == CONSENT)
  /** Rule: a photo by text is taken only after an explicit YES PHOTOS (PI:10-15). */
  val textPhotoNeedsConsent: bool = st.textStored implies st.yesGiven
  /** Rule: the probe says a photo is attached only when one goes with it (decision 9 relay; slopProbeMessage). SD-230. */
  val probeClaimMatches: bool = st.probeClaims implies st.probeAttached
  /**
   * Rule: leave stops the app (AGENTS decision 7, PRD 40.3) and a ban stops the number on every app
   * (founder 2026-10-09 decision 3; SV:1754 restricted). A later write must not make the membership live again. SD-017.
   */
  val leaveAndBanStick: bool =
    (st.leftDone implies not(LIVE.contains(st.membership))) and
    (st.banned and st.banSaga == "idle" and st.membership != "removed" and st.crashes == 0 implies st.membership == "restricted")

  val safety: bool = and {
    photoOnlyForAdult, photoNotKeptAfterFailedAgeCheck, noPhotoAfterForget, countLimit, bytesMatchRow,
    noRatingForMinor, ratingOnlyForEligible, scoresNeverShown, rowHasConsent, textPhotoNeedsConsent,
    probeClaimMatches, leaveAndBanStick,
  }

  // ---------------------------------------------------------------- witnesses (each must be violated)
  /** An adult uploads, is rated and the rating is used in matching. */
  val witness_ratedAndMatched: bool = not(st.usedInMatching)
  /** An age drop under 18 clears every photo and the rating. */
  val witness_ageDropClears: bool = not(st.hadPhotos and st.age < 18 and quiescent(st) and st.rows == Set() and not(st.rating))
  /** Leave completes with the photos gone. */
  val witness_leaveClears: bool = not(st.leftDone and st.hadPhotos and quiescent(st) and st.rows == Set())
  /** A photo by text is stored after YES PHOTOS (webhook path). */
  val witness_textPhotoStored: bool = not(st.textStored and st.rows != Set())
  /** A photo by signed turn is dropped (SD-097 is reachable as written). */
  val witness_turnPhotoDropped: bool = not(st.turnPhotoDropped)
  /** A ban keeps the photos and drops the rating. */
  val witness_banKeepsPhotos: bool = not(st.banned and st.banSaga == "idle" and st.rows != Set() and not(st.rating))
  /** A probe goes out. */
  val witness_probeSent: bool = not(st.probeSent)
  /** A crash happens. */
  val witness_crash: bool = not(st.crashes > 0)

  // ---------------------------------------------------------------- run tests (concrete traces)
  /** Happy path: an adult web upload, a score, the rating kept and used in matching. */
  run adultUploadRatedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(matchRead)
      .expect(st.rating and st.rows == Set(1) and st.objects == Set(1) and st.usedInMatching and safety)

  /** A stale consent header is refused (PH:460): nothing is stored. */
  run staleHeaderTest =
    init.then(uploadStart(1, "old")).expect(st.upl.get(1) == "idle" and st.rows == Set())

  /** The rater runs while the age drops: check 3 drops the score (PH:520-525). */
  run lateRatingDroppedTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2)
      .then(ageCommit).then(ageDeleteFor).then(ageDropRatings)
      .then(rateWrite).then(rateCheck3).then(rateDrop)
      .expect(not(st.rating) and st.rows == Set() and safety)

  /** SD-052: the upload passes mayTake, the age drops and the hook finds no row, then the row is written. */
  run sd052UploadSurvivesAgeDropTest =
    init
      .then(uploadStart(1, CONSENT))
      .then(ageCommit).then(ageDeleteFor).then(ageDropRatings)
      .then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart)
      .expect(st.rows == Set(1) and st.age < 18 and quiescent(st) and not(photoOnlyForAdult))

  /** SD-052: the same with leave. */
  run sd052UploadSurvivesLeaveTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1))
      .then(leaveConsent).then(leaveDeleteFor).then(leaveNetForget).then(leaveForgetMembership)
      .then(uploadBytes(1)).then(uploadRow(1)).then(rateStart)
      .expect(st.membership == "removed" and st.rows == Set(1) and not(noPhotoAfterForget))

  /** SD-053: a failed staff age check drops the rating and keeps the photos. */
  run sd053FailedAgeCheckKeepsPhotosTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1)).then(rateStart)
      .then(rateRead).then(rateReturn(false))
      .then(verifyFail).then(verifyDrop)
      .expect(st.rows == Set(1) and st.ageFail and not(photoNotKeptAfterFailedAgeCheck))

  /** SD-372: two uploads read the count before either writes. */
  run sd372CountRaceTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(uploadStart(2, CONSENT)).then(uploadStart(3, CONSENT)).then(uploadCount(2)).then(uploadCount(3))
      .then(uploadBytes(2)).then(uploadRow(2)).then(uploadBytes(3)).then(uploadRow(3))
      .expect(st.rows.size() == 3 and not(countLimit))

  /** SD-176: a crash between storage.put and meta.put leaves bytes with no row. */
  run sd176OrphanBytesTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(crash)
      .expect(st.objects == Set(1) and st.rows == Set() and not(bytesMatchRow))

  /** SD-176: a crash between meta.delete and onRemoved keeps a rating from a deleted photo. */
  run sd176StaleRatingTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(removeStart(1)).then(removeBytes).then(removeRow).then(crash)
      .expect(st.rating and st.rows == Set() and not(ratingOnlyForEligible))

  /** Q-photos_rating-1: a crash after noteAge commits and before the hook keeps photos and rating of a minor. */
  run q1CrashAfterAgeCommitTest =
    init
      .then(uploadStart(1, CONSENT)).then(uploadCount(1)).then(uploadBytes(1)).then(uploadRow(1))
      .then(rateStart).then(rateRead).then(rateReturn(true)).then(rateCheck2).then(rateWrite).then(rateCheck3)
      .then(ageCommit).then(crash)
      .expect(st.age < 18 and st.rows == Set(1) and st.rating and not(photoOnlyForAdult) and not(noRatingForMinor))

  /** SD-017: YES PHOTOS reads the membership, a ban restricts it, then the whole-row write makes it active again. */
  run sd017ConsentWriteUndoesBanTest =
    init
      .then(textPhoto(1, "webhook")).then(consentYesRead).then(consentYesCheck)
      .then(banCommit).then(banDrop).then(banRestrict)
      .then(consentYesWrite)
      .expect(st.banned and st.membership == "active" and not(leaveAndBanStick))

  /** SD-097: a photo in a signed turn never reaches photosIn. */
  run sd097TurnPhotoDroppedTest =
    init.then(textPhoto(1, "turn")).expect(st.turnPhotoDropped and not(st.pending) and st.rows == Set())
}
