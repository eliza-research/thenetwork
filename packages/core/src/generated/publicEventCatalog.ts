// GENERATED from spec/publicEventCatalog.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
export const publicEventHorizonDays: number = 14;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export const publicEventFreshDays: number = 2;

/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
//@ pure
export function publicEventWindowUsable(asOf: number, startsAt: number, endsAt: number): boolean {
  return startsAt > asOf && startsAt <= exact_publicEventCatalog(asOf + exact_publicEventCatalog(publicEventHorizonDays * 86400000)) && endsAt > startsAt;
}

/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
//@ pure
export function publicEventAllowed(officialLink: boolean, publicPlace: boolean, online: boolean, youth: boolean, asOf: number, startsAt: number, endsAt: number): boolean {
  return officialLink && publicPlace && !online && !youth && publicEventWindowUsable(asOf, startsAt, endsAt);
}

/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventPublicationNewer(seen: boolean, checkedAt: number, incomingAt: number): boolean {
  return !seen || incomingAt > checkedAt;
}

/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function publicEventCatalogFresh(checkedAt: number, asOf: number): boolean {
  return checkedAt <= asOf && exact_publicEventCatalog(checkedAt + exact_publicEventCatalog(publicEventFreshDays * 86400000)) > asOf;
}

/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
//@ pure
export function lawCatalogExpiresAtLimit(checkedAt: number): boolean {
  //@ ensures \result === true
  return !publicEventCatalogFresh(checkedAt, exact_publicEventCatalog(checkedAt + exact_publicEventCatalog(publicEventFreshDays * 86400000)));
}

/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
//@ pure
export function publicEventRevisionMatches(bound: string, available: string): boolean {
  return bound !== "" && bound === available;
}

/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
//@ pure
export function publicEventMemberAllowsMatch(adult: boolean, categoryAllowed: boolean, eventFormatAllowed: boolean): boolean {
  return adult && categoryAllowed && eventFormatAllowed;
}

/** Story: Find a current public event / A closed event opportunity without contact does not use a matching slot (spec/publicEventCatalog.md) */
//@ pure
export function closedPublicEventIsUnsent(bound: boolean, closed: boolean, contacted: boolean): boolean {
  return bound && closed && !contacted;
}

/** Story: Find a current public event / The send guard allows the exact official link in a booked confirmation (spec/publicEventCatalog.md) */
//@ pure
export function publicBookedEventLinkAllowed(booked: boolean, consenting: boolean, exactFinalLine: boolean): boolean {
  return booked && consenting && exactFinalLine;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_publicEventCatalog(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
