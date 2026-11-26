// Generated from spec/publicEventCatalog.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/publicEventCatalog.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
export const publicEventHorizonDays = 14;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export const publicEventFreshDays = 2;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export const publicEventScanMaxBytes = exact_publicEventCatalog(exact_publicEventCatalog(8 * 1024) * 1024);
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export const publicEventScanRowLimit = 5000;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export const publicEventRefreshMs = 86400000;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export const publicEventRetryMs = 3600000;
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
//@ pure
export function publicEventWindowUsable(asOf, startsAt, endsAt) {
    return startsAt > asOf && startsAt <= exact_publicEventCatalog(asOf + exact_publicEventCatalog(publicEventHorizonDays * 86400000)) && endsAt > startsAt;
}
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
//@ pure
export function publicEventAllowed(officialLink, publicPlace, online, youth, asOf, startsAt, endsAt) {
    return officialLink && publicPlace && !online && !youth && publicEventWindowUsable(asOf, startsAt, endsAt);
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventScanResponseAllowed(responseStatus, rangeMarked, redirected) {
    return responseStatus === 200 && !rangeMarked && !redirected;
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventScanComplete(bytesRead, rowsRead, allRowsRecognizable) {
    return 0 < bytesRead && bytesRead <= publicEventScanMaxBytes && 0 <= rowsRead && rowsRead < publicEventScanRowLimit && allRowsRecognizable;
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function lawPartialEventScanCannotPublish(redirected) {
    //@ ensures \result === true
    return !publicEventScanResponseAllowed(206, false, redirected) && !publicEventScanResponseAllowed(200, true, redirected);
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventPublicationNewer(seen, checkedAt, incomingAt) {
    return !seen || incomingAt > checkedAt;
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventCatalogFresh(checkedAt, asOf) {
    return checkedAt <= asOf && exact_publicEventCatalog(checkedAt + exact_publicEventCatalog(publicEventFreshDays * 86400000)) > asOf;
}
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function lawCatalogExpiresAtLimit(checkedAt) {
    //@ ensures \result === true
    return !publicEventCatalogFresh(checkedAt, exact_publicEventCatalog(checkedAt + exact_publicEventCatalog(publicEventFreshDays * 86400000)));
}
/** Story: Find a current public event / A source id identifies a single normalized listing in each scan (spec/publicEventCatalog.md) */
//@ pure
export function publicEventDuplicateAllowed(previousPresent, sameListing) {
    return !previousPresent || sameListing;
}
/** Story: Find a current public event / A source id identifies a single normalized listing in each scan (spec/publicEventCatalog.md) */
//@ pure
export function lawConflictingPublicEventRowsCannotPublish(sameListing) {
    //@ ensures \result === true
    return !(!sameListing) || !publicEventDuplicateAllowed(true, sameListing);
}
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
//@ pure
export function publicEventRevisionMatches(bound, available) {
    return bound !== "" && bound === available;
}
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
//@ pure
export function publicEventMemberAllowsMatch(adult, minimumAgeMet, categoryAllowed, eventFormatAllowed) {
    return adult && minimumAgeMet && categoryAllowed && eventFormatAllowed;
}
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
//@ pure
export function lawEventMinimumAgeAppliesToAdults(categoryAllowed, eventFormatAllowed) {
    //@ ensures \result === true
    return !publicEventMemberAllowsMatch(true, false, categoryAllowed, eventFormatAllowed);
}
/** Story: Find a current public event / A queued event contact still needs the reviewed listing at final claim (spec/publicEventCatalog.md) */
//@ pure
export function publicEventClaimAllowed(sameListing, exactContact, participantsEligible) {
    return sameListing && exactContact && participantsEligible;
}
/** Story: Find a current public event / A queued event contact still needs the reviewed listing at final claim (spec/publicEventCatalog.md) */
//@ pure
export function lawMovedPublicEventCannotAuthorizeClaim(exactContact, participantsEligible) {
    //@ ensures \result === true
    return !publicEventClaimAllowed(false, exactContact, participantsEligible);
}
/** Story: Find a current public event / A closed event opportunity without contact does not use a matching slot (spec/publicEventCatalog.md) */
//@ pure
export function closedPublicEventIsUnsent(bound, closed, contacted) {
    return bound && closed && !contacted;
}
/** Story: Find a current public event / The send guard allows the exact official link in a booked confirmation (spec/publicEventCatalog.md) */
//@ pure
export function publicBookedEventLinkAllowed(booked, consenting, exactFinalLine) {
    return booked && consenting && exactFinalLine;
}
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
//@ pure
export function publicEventRefreshDue(published, checkedAt, attempted, attemptedAt, asOf) {
    return (!published || exact_publicEventCatalog(asOf - checkedAt) >= publicEventRefreshMs) && (!attempted || exact_publicEventCatalog(asOf - attemptedAt) >= publicEventRetryMs);
}
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
//@ pure
export function lawRefreshDueBeforeCatalogExpires(checkedAt) {
    //@ ensures \result === true
    return publicEventRefreshDue(true, checkedAt, false, 0, exact_publicEventCatalog(checkedAt + publicEventRefreshMs)) && publicEventCatalogFresh(checkedAt, exact_publicEventCatalog(checkedAt + publicEventRefreshMs));
}
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
//@ pure
export function lawRecentAttemptWaits(published, checkedAt, attemptedAt) {
    //@ ensures \result === true
    return !publicEventRefreshDue(published, checkedAt, true, attemptedAt, exact_publicEventCatalog(exact_publicEventCatalog(attemptedAt + publicEventRetryMs) - 1));
}
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_publicEventCatalog(n) {
    if (!Number.isSafeInteger(n))
        throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
    return n;
}
