// GENERATED from spec/connectedAssistants.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
export type BrowserGrantVisibility = "ShowBrowserGrant" | "HideBrowserGrant" | "RetryBrowserGrantList";
/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
export type LoadReply = "LoadedSignedOut" | "LoadedUnavailable" | "LoadedList";
/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
export type ConsentsView = "Loading" | "SignInFirstView" | "RetryLaterView" | "NotAllowedView" | "ListView" | "EmptyView" | "ConfirmingRemoval";
/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
export interface ConsentsPage { view: ConsentsView; grants: number; signedIn: boolean; notice: boolean }
/** Story: See which assistants can use my account / A grant card names the assistant as its claim and shows its date and scopes (spec/connectedAssistants.md) */
export type AssistantLabel = "NamedByItself" | "UnnamedAssistant";
/** Story: See which assistants can use my account / A grant card names the assistant as its claim and shows its date and scopes (spec/connectedAssistants.md) */
export interface GrantCard { assistant: AssistantLabel; claimNote: boolean; allowedDate: boolean; scopeList: boolean; removeButton: boolean }
/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
export interface ConsentsOffers { removeAccess: boolean; confirmRemove: boolean; keepAccess: boolean; retryLink: boolean }
/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
export interface PageChrome { brandMark: boolean; legalLinks: boolean }
/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
export type RemoveReply = "Removed" | "NothingRemoved" | "RemoveSignedOut" | "RemoveUnavailable" | "RemoveRefused" | "RemovedListUnavailable";

/** One variant per transition in the spec. */
export type Event =
  | { type: "load"; loaded: LoadReply; grants: number }
  | { type: "reloadPage" }
  | { type: "chooseRemoval" }
  | { type: "keepAccess" }
  | { type: "confirmRemoval"; removal: RemoveReply; grants: number };

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
export const removeConfirmationMs: number = 300000;
/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
export const noConsentsOffers: ConsentsOffers = { removeAccess: false, confirmRemove: false, keepAccess: false, retryLink: false };
/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
export const initial: ConsentsPage = { view: "Loading", grants: 0, signedIn: false, notice: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ConsentsPage): boolean {
  return alwaysGrantsShowOnlyWithSession(current) && alwaysListMatchesGrants(current) && alwaysNoticeOnlyForSignedInRemoval(current);
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function browserOwnsLiveGrant(sameApp: boolean, samePhone: boolean, samePerson: boolean, active: boolean, asOf: number, grantExpiresAt: number): boolean {
  return sameApp && samePhone && samePerson && active && asOf < grantExpiresAt;
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function lawAnEarlierPhoneOwnerHasNoGrant(sameApp: boolean, samePhone: boolean, active: boolean, asOf: number, grantExpiresAt: number): boolean {
  //@ ensures \result === true
  return !browserOwnsLiveGrant(sameApp, samePhone, false, active, asOf, grantExpiresAt);
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function browserGrantVisibility(ownedLiveGrant: boolean, authority: string): BrowserGrantVisibility {
  return !ownedLiveGrant || authority === "invalid" ? "HideBrowserGrant" : (authority === "valid" ? "ShowBrowserGrant" : "RetryBrowserGrantList");
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function canLoad(page: ConsentsPage, grants: number): boolean {
  return page.view === "Loading" && grants >= 0;
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function alwaysGrantsShowOnlyWithSession(page: ConsentsPage): boolean {
  return !(page.view === "ListView" || page.view === "EmptyView" || page.view === "ConfirmingRemoval") || page.signedIn;
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function alwaysListMatchesGrants(page: ConsentsPage): boolean {
  return page.grants >= 0 && (!(page.view === "ListView") || page.grants > 0) && (!(page.view === "EmptyView") || page.grants === 0) && (!(page.view === "ConfirmingRemoval") || page.grants > 0);
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function viewForGrants(grants: number): ConsentsView {
  return grants > 0 ? "ListView" : "EmptyView";
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function lawShownGrantHasCurrentAuthority(ownedLiveGrant: boolean, authority: string): boolean {
  //@ ensures \result === true
  return !(browserGrantVisibility(ownedLiveGrant, authority) === "ShowBrowserGrant") || (ownedLiveGrant && authority === "valid");
}

/** Story: See which assistants can use my account / The page lists live grants only for a signed-in session (spec/connectedAssistants.md) */
//@ pure
export function load(page: ConsentsPage, loaded: LoadReply, grants: number): ConsentsPage {
  //@ ensures (inv(page) && canLoad(page, grants)) ==> alwaysGrantsShowOnlyWithSession(\result)
  //@ ensures (inv(page) && canLoad(page, grants)) ==> alwaysListMatchesGrants(\result)
  //@ ensures (inv(page) && canLoad(page, grants)) ==> alwaysNoticeOnlyForSignedInRemoval(\result)
  //@ ensures (inv(page) && canLoad(page, grants)) ==> stepKeepAccessChangesNothing(page, "load", \result)
  //@ ensures (inv(page) && canLoad(page, grants)) ==> stepOnlyConfirmedRemovalChangesGrants(page, "load", \result)
  //@ ensures (inv(page) && canLoad(page, grants)) ==> stepNoticeFollowsConfirmedRemoval(page, "load", \result)
  return loaded === "LoadedSignedOut" ? ({ view: "SignInFirstView", grants: 0, signedIn: false, notice: false } as ConsentsPage) : (loaded === "LoadedUnavailable" ? ({ view: "RetryLaterView", grants: 0, signedIn: false, notice: false } as ConsentsPage) : ({ view: viewForGrants(grants), grants: grants, signedIn: true, notice: false } as ConsentsPage));
}

/** Story: See which assistants can use my account / A grant card names the assistant as its claim and shows its date and scopes (spec/connectedAssistants.md) */
//@ pure
export function grantCard(named: boolean): GrantCard {
  return { assistant: named ? "NamedByItself" : "UnnamedAssistant", claimNote: true, allowedDate: true, scopeList: true, removeButton: true };
}

/** Story: See which assistants can use my account / A grant card names the assistant as its claim and shows its date and scopes (spec/connectedAssistants.md) */
//@ pure
export function lawGrantCardShowsClaimDateAndScopes(named: boolean): boolean {
  //@ ensures \result === true
  const local_0: GrantCard = grantCard(named);
  return local_0.claimNote && local_0.allowedDate && local_0.scopeList && local_0.removeButton;
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function offersFor(view: ConsentsView): ConsentsOffers {
  return { removeAccess: view === "ListView", confirmRemove: view === "ConfirmingRemoval", keepAccess: view === "ConfirmingRemoval", retryLink: view === "RetryLaterView" };
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function chromeFor(view: ConsentsView): PageChrome {
  return { brandMark: view !== "Loading", legalLinks: view !== "Loading" };
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function reloadPage(page: ConsentsPage): ConsentsPage {
  //@ ensures (inv(page) && canReloadPage(page)) ==> alwaysGrantsShowOnlyWithSession(\result)
  //@ ensures (inv(page) && canReloadPage(page)) ==> alwaysListMatchesGrants(\result)
  //@ ensures (inv(page) && canReloadPage(page)) ==> alwaysNoticeOnlyForSignedInRemoval(\result)
  //@ ensures (inv(page) && canReloadPage(page)) ==> stepKeepAccessChangesNothing(page, "reloadPage", \result)
  //@ ensures (inv(page) && canReloadPage(page)) ==> stepOnlyConfirmedRemovalChangesGrants(page, "reloadPage", \result)
  //@ ensures (inv(page) && canReloadPage(page)) ==> stepNoticeFollowsConfirmedRemoval(page, "reloadPage", \result)
  return { ...page, view: "Loading", grants: 0, signedIn: false, notice: false };
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function lawSignedOutPageOffersNoControl(view: ConsentsView): boolean {
  //@ ensures \result === true
  return !(view === "SignInFirstView" || view === "NotAllowedView") || equal_connectedAssistants(offersFor(view), noConsentsOffers);
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function lawEveryPageShowsBrandAndLegalLinks(view: ConsentsView): boolean {
  //@ ensures \result === true
  return !(view !== "Loading") || (chromeFor(view).brandMark && chromeFor(view).legalLinks);
}

/** Story: See which assistants can use my account / A page without a session offers no sign-in control (spec/connectedAssistants.md) */
//@ pure
export function canReloadPage(page: ConsentsPage): boolean {
  return offersFor(page.view).retryLink;
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function canChooseRemoval(page: ConsentsPage): boolean {
  return page.view === "ListView" && page.grants > 0;
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function chooseRemoval(page: ConsentsPage): ConsentsPage {
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> alwaysGrantsShowOnlyWithSession(\result)
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> alwaysListMatchesGrants(\result)
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> alwaysNoticeOnlyForSignedInRemoval(\result)
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> stepKeepAccessChangesNothing(page, "chooseRemoval", \result)
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> stepOnlyConfirmedRemovalChangesGrants(page, "chooseRemoval", \result)
  //@ ensures (inv(page) && canChooseRemoval(page)) ==> stepNoticeFollowsConfirmedRemoval(page, "chooseRemoval", \result)
  return { ...page, view: "ConfirmingRemoval", notice: false };
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function canKeepAccess(page: ConsentsPage): boolean {
  return page.view === "ConfirmingRemoval";
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function keepAccess(page: ConsentsPage): ConsentsPage {
  //@ ensures (inv(page) && canKeepAccess(page)) ==> alwaysGrantsShowOnlyWithSession(\result)
  //@ ensures (inv(page) && canKeepAccess(page)) ==> alwaysListMatchesGrants(\result)
  //@ ensures (inv(page) && canKeepAccess(page)) ==> alwaysNoticeOnlyForSignedInRemoval(\result)
  //@ ensures (inv(page) && canKeepAccess(page)) ==> stepKeepAccessChangesNothing(page, "keepAccess", \result)
  //@ ensures (inv(page) && canKeepAccess(page)) ==> stepOnlyConfirmedRemovalChangesGrants(page, "keepAccess", \result)
  //@ ensures (inv(page) && canKeepAccess(page)) ==> stepNoticeFollowsConfirmedRemoval(page, "keepAccess", \result)
  return { ...page, view: "ListView" };
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function stepKeepAccessChangesNothing(before: ConsentsPage, via: string, after: ConsentsPage): boolean {
  return !(via === "keepAccess") || (after.view === "ListView" && after.grants === before.grants && after.signedIn === before.signedIn);
}

/** Story: Remove an assistant's access / Removal needs a confirmation (spec/connectedAssistants.md) */
//@ pure
export function stepOnlyConfirmedRemovalChangesGrants(before: ConsentsPage, via: string, after: ConsentsPage): boolean {
  return !(after.grants !== before.grants) || (via === "load" || via === "reloadPage" || (via === "confirmRemoval" && before.view === "ConfirmingRemoval"));
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function removalConfirmationEndsAt(issuedAt: number, grantExpiresAt: number): number {
  return exact_connectedAssistants(issuedAt + removeConfirmationMs) < grantExpiresAt ? exact_connectedAssistants(issuedAt + removeConfirmationMs) : grantExpiresAt;
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function browserRemovalProofMatches(currentVerified: boolean, exactBinding: boolean, exactDirectPredecessor: boolean): boolean {
  return currentVerified && (exactBinding || exactDirectPredecessor);
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function removalFormMayRevoke(ownedLiveGrant: boolean, exactBrowserConfirmation: boolean, asOf: number, confirmationEndsAt: number): boolean {
  return ownedLiveGrant && exactBrowserConfirmation && asOf < confirmationEndsAt;
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function lawConfirmationLastsAtMostFiveMinutes(ownedLiveGrant: boolean, issuedAt: number, grantExpiresAt: number, asOf: number): boolean {
  //@ ensures \result === true
  return !removalFormMayRevoke(ownedLiveGrant, true, asOf, removalConfirmationEndsAt(issuedAt, grantExpiresAt)) || (asOf < exact_connectedAssistants(issuedAt + removeConfirmationMs) && asOf < grantExpiresAt);
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function lawRemovalProofRequiresCurrentSession(exactBinding: boolean, exactDirectPredecessor: boolean): boolean {
  //@ ensures \result === true
  return !browserRemovalProofMatches(false, exactBinding, exactDirectPredecessor);
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function lawAnotherBrowserSessionCannotConfirm(currentVerified: boolean): boolean {
  //@ ensures \result === true
  return !browserRemovalProofMatches(currentVerified, false, false);
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function lawCannotRevokeWithoutConfirmation(ownedLiveGrant: boolean, asOf: number, confirmationEndsAt: number): boolean {
  //@ ensures \result === true
  return !removalFormMayRevoke(ownedLiveGrant, false, asOf, confirmationEndsAt);
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function removalListRetry(removal: string): RemoveReply {
  return removal === "Removed" ? "RemovedListUnavailable" : "RemoveUnavailable";
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function canConfirmRemoval(page: ConsentsPage, grants: number): boolean {
  return page.view === "ConfirmingRemoval" && grants >= 0;
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function alwaysNoticeOnlyForSignedInRemoval(page: ConsentsPage): boolean {
  return !page.notice || (page.signedIn && (page.view === "ListView" || page.view === "EmptyView" || page.view === "RetryLaterView"));
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function stepNoticeFollowsConfirmedRemoval(before: ConsentsPage, via: string, after: ConsentsPage): boolean {
  return !(after.notice && !before.notice) || (via === "confirmRemoval" && before.view === "ConfirmingRemoval");
}

/** Story: Remove an assistant's access / A confirmed removal shows its result (spec/connectedAssistants.md) */
//@ pure
export function confirmRemoval(page: ConsentsPage, removal: RemoveReply, grants: number): ConsentsPage {
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> alwaysGrantsShowOnlyWithSession(\result)
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> alwaysListMatchesGrants(\result)
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> alwaysNoticeOnlyForSignedInRemoval(\result)
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> stepKeepAccessChangesNothing(page, "confirmRemoval", \result)
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> stepOnlyConfirmedRemovalChangesGrants(page, "confirmRemoval", \result)
  //@ ensures (inv(page) && canConfirmRemoval(page, grants)) ==> stepNoticeFollowsConfirmedRemoval(page, "confirmRemoval", \result)
  return removal === "RemoveSignedOut" ? ({ view: "SignInFirstView", grants: 0, signedIn: false, notice: false } as ConsentsPage) : (removal === "RemoveUnavailable" ? ({ view: "RetryLaterView", grants: 0, signedIn: false, notice: false } as ConsentsPage) : (removal === "RemovedListUnavailable" ? ({ view: "RetryLaterView", grants: 0, signedIn: true, notice: true } as ConsentsPage) : (removal === "RemoveRefused" ? ({ view: "NotAllowedView", grants: 0, signedIn: false, notice: false } as ConsentsPage) : ({ view: viewForGrants(grants), grants: grants, signedIn: true, notice: removal === "Removed" } as ConsentsPage))));
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesAccessRemoved(page: ConsentsPage): boolean {
  return page.view === "ListView" && page.notice;
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesLastAccessRemoved(page: ConsentsPage): boolean {
  return page.view === "EmptyView" && page.notice;
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesSignInFirst(page: ConsentsPage): boolean {
  return page.view === "SignInFirstView";
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesRetryLater(page: ConsentsPage): boolean {
  return page.view === "RetryLaterView";
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesNotAllowed(page: ConsentsPage): boolean {
  return page.view === "NotAllowedView";
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesEmpty(page: ConsentsPage): boolean {
  return page.view === "EmptyView" && !page.notice;
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesListed(page: ConsentsPage): boolean {
  return page.view === "ListView";
}

/** Story: Remove an assistant's access / Each page and each outcome can occur (spec/connectedAssistants.md) */
//@ pure
export function sometimesConfirming(page: ConsentsPage): boolean {
  return page.view === "ConfirmingRemoval";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ConsentsPage, event: Event): boolean {
  if (event.type === "load") return canLoad(current, event.grants);
  if (event.type === "reloadPage") return canReloadPage(current);
  if (event.type === "chooseRemoval") return canChooseRemoval(current);
  if (event.type === "keepAccess") return canKeepAccess(current);
  if (event.type === "confirmRemoval") return canConfirmRemoval(current, event.grants);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ConsentsPage, event: Event): ConsentsPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "load") return canLoad(current, event.grants) ? load(current, event.loaded, event.grants) : current;
  if (event.type === "reloadPage") return canReloadPage(current) ? reloadPage(current) : current;
  if (event.type === "chooseRemoval") return canChooseRemoval(current) ? chooseRemoval(current) : current;
  if (event.type === "keepAccess") return canKeepAccess(current) ? keepAccess(current) : current;
  if (event.type === "confirmRemoval") return canConfirmRemoval(current, event.grants) ? confirmRemoval(current, event.removal, event.grants) : current;
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
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "load" && (raw.loaded === "LoadedSignedOut" || raw.loaded === "LoadedUnavailable" || raw.loaded === "LoadedList") && Number.isSafeInteger(raw.grants)) return { type: "load", loaded: raw.loaded, grants: raw.grants };
  if (raw.type === "reloadPage") return { type: "reloadPage" };
  if (raw.type === "chooseRemoval") return { type: "chooseRemoval" };
  if (raw.type === "keepAccess") return { type: "keepAccess" };
  if (raw.type === "confirmRemoval" && (raw.removal === "Removed" || raw.removal === "NothingRemoved" || raw.removal === "RemoveSignedOut" || raw.removal === "RemoveUnavailable" || raw.removal === "RemoveRefused" || raw.removal === "RemovedListUnavailable") && Number.isSafeInteger(raw.grants)) return { type: "confirmRemoval", removal: raw.removal, grants: raw.grants };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ConsentsPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.view === "Loading" || raw.view === "SignInFirstView" || raw.view === "RetryLaterView" || raw.view === "NotAllowedView" || raw.view === "ListView" || raw.view === "EmptyView" || raw.view === "ConfirmingRemoval") && Number.isSafeInteger(raw.grants) && typeof raw.signedIn === "boolean" && typeof raw.notice === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: ConsentsPage = ({ view: raw.view, grants: raw.grants, signedIn: raw.signedIn, notice: raw.notice });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ConsentsPage {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_connectedAssistants(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_connectedAssistants(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_connectedAssistants((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
