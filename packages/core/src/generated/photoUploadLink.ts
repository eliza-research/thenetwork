// GENERATED from spec/photoUploadLink.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { uploadMaxBytes as photoPolicy_uploadMaxBytes, uploadMaxPerPerson as photoPolicy_uploadMaxPerPerson, ratingMaxPhotos as photoPolicy_ratingMaxPhotos, ratingMaxBytes as photoPolicy_ratingMaxBytes, photoMaxPerMessage as photoPolicy_photoMaxPerMessage, photoSubjectAllowed as photoPolicy_photoSubjectAllowed, photoSlotsFull as photoPolicy_photoSlotsFull, lawRatingRequiresAdult as photoPolicy_lawRatingRequiresAdult } from "./photoPolicy.ts";

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export interface UploadLinkHolder { takesPhotos: boolean; adult: boolean; banned: boolean; held: boolean; liveMember: boolean }
/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export type UploadLinkPhase = "UploadLinkNone" | "UploadLinkOpen" | "UploadLinkSpent" | "UploadLinkRefused";
/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export interface PhotoUploadLink { phase: UploadLinkPhase; issuedAt: number; expiresAt: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "issueUploadLink"; holder: UploadLinkHolder; at: number }
  | { type: "redeemUploadLink"; holder: UploadLinkHolder; sameApp: boolean; at: number };

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export const photoUploadLinksPerDay: number = 6;
/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export const photoUploadLinkTtlMs: number = 900000;
/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export const allowedUploadHolder: UploadLinkHolder = { takesPhotos: true, adult: true, banned: false, held: false, liveMember: true };
/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
export const initial: PhotoUploadLink = { phase: "UploadLinkNone", issuedAt: 0, expiresAt: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoUploadLink): boolean {
  return alwaysIssuedLinkLastsFifteenMinutes(current);
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function uploadLinkHolderAllowed(holder: UploadLinkHolder): boolean {
  return holder.takesPhotos && holder.adult && !holder.banned && !holder.held && holder.liveMember;
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function uploadLinkDailyLimitReached(issuedToday: number): boolean {
  return issuedToday >= photoUploadLinksPerDay;
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function canIssueUploadLink(link: PhotoUploadLink): boolean {
  return link.phase === "UploadLinkNone";
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function issueUploadLink(link: PhotoUploadLink, holder: UploadLinkHolder, at: number): PhotoUploadLink {
  //@ ensures (inv(link) && canIssueUploadLink(link)) ==> alwaysIssuedLinkLastsFifteenMinutes(\result)
  //@ ensures (inv(link) && canIssueUploadLink(link)) ==> stepClosedLinkStaysClosed(link, \result)
  return uploadLinkHolderAllowed(holder) ? ({ phase: "UploadLinkOpen", issuedAt: at, expiresAt: exact_photoUploadLink(at + photoUploadLinkTtlMs) } as PhotoUploadLink) : ({ ...link, phase: "UploadLinkRefused" } as PhotoUploadLink);
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function alwaysIssuedLinkLastsFifteenMinutes(link: PhotoUploadLink): boolean {
  return !(link.phase === "UploadLinkOpen" || link.phase === "UploadLinkSpent") || link.expiresAt === exact_photoUploadLink(link.issuedAt + photoUploadLinkTtlMs);
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function sometimesLinkOpen(link: PhotoUploadLink): boolean {
  return link.phase === "UploadLinkOpen";
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function sometimesLinkRefused(link: PhotoUploadLink): boolean {
  return link.phase === "UploadLinkRefused";
}

/** Story: Add my photos with a private one-time link / A link is issued only to an adult live member of a photo app who is not banned or held (spec/photoUploadLink.md) */
//@ pure
export function lawMinorGetsNoLink(holder: UploadLinkHolder, at: number): boolean {
  //@ ensures \result === true
  return !(!holder.adult) || issueUploadLink(initial, holder, at).phase === "UploadLinkRefused";
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function uploadLinkUsable(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: boolean, at: number): boolean {
  return link.phase === "UploadLinkOpen" && at < link.expiresAt && sameApp && uploadLinkHolderAllowed(holder);
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function canRedeemUploadLink(link: PhotoUploadLink): boolean {
  return link.phase === "UploadLinkOpen";
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function stepClosedLinkStaysClosed(before: PhotoUploadLink, after: PhotoUploadLink): boolean {
  return !(before.phase === "UploadLinkSpent" || before.phase === "UploadLinkRefused") || after.phase === before.phase;
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function sometimesLinkSpent(link: PhotoUploadLink): boolean {
  return link.phase === "UploadLinkSpent";
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function redeemUploadLink(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: boolean, at: number): PhotoUploadLink {
  //@ ensures (inv(link) && canRedeemUploadLink(link)) ==> alwaysIssuedLinkLastsFifteenMinutes(\result)
  //@ ensures (inv(link) && canRedeemUploadLink(link)) ==> stepClosedLinkStaysClosed(link, \result)
  return { ...link, phase: uploadLinkUsable(link, holder, sameApp, at) ? "UploadLinkSpent" : "UploadLinkRefused" };
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function lawMinorNeverUploads(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: boolean, at: number): boolean {
  //@ ensures \result === true
  return !(!holder.adult) || !uploadLinkUsable(link, holder, sameApp, at);
}

/** Story: Add my photos with a private one-time link / A link uploads once, before it expires, on its own app, for a holder who is still eligible (spec/photoUploadLink.md) */
//@ pure
export function lawExpiredLinkNeverUploads(holder: UploadLinkHolder, sameApp: boolean, at: number): boolean {
  //@ ensures \result === true
  const local_0: PhotoUploadLink = issueUploadLink(initial, holder, at);
  return redeemUploadLink(local_0, holder, sameApp, exact_photoUploadLink(at + photoUploadLinkTtlMs)).phase !== "UploadLinkSpent";
}

/** Story: Add my photos with a private one-time link / A status check says whether a link can still upload, and does not use it (spec/photoUploadLink.md) */
//@ pure
export function lawOpenStatusMeansTheUseUploads(holder: UploadLinkHolder, sameApp: boolean, at: number): boolean {
  //@ ensures \result === true
  const local_1: PhotoUploadLink = issueUploadLink(initial, holder, at);
  return !uploadLinkUsable(local_1, holder, sameApp, at) || redeemUploadLink(local_1, holder, sameApp, at).phase === "UploadLinkSpent";
}

/** Story: Add my photos with a private one-time link / A status check says whether a link can still upload, and does not use it (spec/photoUploadLink.md) */
//@ pure
export function lawClosedStatusMeansTheUseStoresNothing(holder: UploadLinkHolder, sameApp: boolean, at: number): boolean {
  //@ ensures \result === true
  const local_2: PhotoUploadLink = issueUploadLink(initial, holder, at);
  return !(!uploadLinkUsable(local_2, holder, sameApp, at)) || redeemUploadLink(local_2, holder, sameApp, at).phase !== "UploadLinkSpent";
}

/** Story: Add my photos with a private one-time link / One link use carries one to four photos of at most four MiB each and eight MiB in all (spec/photoUploadLink.md) */
//@ pure
export function uploadLinkBatchAllowed(count: number, largestBytes: number, totalBytes: number): boolean {
  return count >= 1 && count <= photoPolicy_ratingMaxPhotos && largestBytes >= 1 && largestBytes <= photoPolicy_ratingMaxBytes && totalBytes >= largestBytes && totalBytes <= photoPolicy_uploadMaxBytes;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoUploadLink, event: Event): boolean {
  if (event.type === "issueUploadLink") return canIssueUploadLink(current);
  if (event.type === "redeemUploadLink") return canRedeemUploadLink(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoUploadLink, event: Event): PhotoUploadLink {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "issueUploadLink") return canIssueUploadLink(current) ? issueUploadLink(current, event.holder, event.at) : current;
  if (event.type === "redeemUploadLink") return canRedeemUploadLink(current) ? redeemUploadLink(current, event.holder, event.sameApp, event.at) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  const is_UploadLinkHolder = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.takesPhotos === "boolean" && typeof v.adult === "boolean" && typeof v.banned === "boolean" && typeof v.held === "boolean" && typeof v.liveMember === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "issueUploadLink" && is_UploadLinkHolder(raw.holder) && Number.isSafeInteger(raw.at)) return { type: "issueUploadLink", holder: ({ takesPhotos: raw.holder.takesPhotos, adult: raw.holder.adult, banned: raw.holder.banned, held: raw.holder.held, liveMember: raw.holder.liveMember }), at: raw.at };
  if (raw.type === "redeemUploadLink" && is_UploadLinkHolder(raw.holder) && typeof raw.sameApp === "boolean" && Number.isSafeInteger(raw.at)) return { type: "redeemUploadLink", holder: ({ takesPhotos: raw.holder.takesPhotos, adult: raw.holder.adult, banned: raw.holder.banned, held: raw.holder.held, liveMember: raw.holder.liveMember }), sameApp: raw.sameApp, at: raw.at };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoUploadLink | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "UploadLinkNone" || raw.phase === "UploadLinkOpen" || raw.phase === "UploadLinkSpent" || raw.phase === "UploadLinkRefused") && Number.isSafeInteger(raw.issuedAt) && Number.isSafeInteger(raw.expiresAt) && Object.keys(raw).length === 3)) return undefined;
  const parsed: PhotoUploadLink = ({ phase: raw.phase, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoUploadLink {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photoUploadLink(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
