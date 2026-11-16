// GENERATED from spec/staffSignIn.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
export type SignInPhase = "Opening" | "Checking" | "AskingToken" | "AskingAccess" | "SignedIn" | "NoStaffRole" | "NeedsSecondFactor" | "SiteRefused" | "CheckFailed";
/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
export type SignInMethod = "NoCredential" | "TokenCredential" | "AccessCredential";
/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
export interface StaffSignIn { phase: SignInPhase; method: SignInMethod; tokenInAddress: boolean; secondFactor: boolean; roleCount: number }
/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
export type IdentityAnswer = "IdentityAccepted" | "SignInNeeded" | "IdentityWithoutRole" | "SiteNotAllowed" | "ServerUnreachable";
/** Story: Keep my session bound to my roles / Each sign-in phase has one view (spec/staffSignIn.md:150) */
export type SignInView = "ShowLoading" | "ShowTokenForm" | "ShowAccessLink" | "ShowConsole" | "ShowNoRole" | "ShowSecondFactorNeeded" | "ShowSiteRefused" | "ShowRetry";
/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
export type PlatformEnv = "EnvUnset" | "EnvUnknown" | "EnvDev" | "EnvStaging" | "EnvProduction";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openConsole"; tokenFound: boolean }
  | { type: "answerIdentity"; answer: IdentityAnswer; viaAccess: boolean; secondFactorShown: boolean; grants: number }
  | { type: "submitToken"; tokenChars: number }
  | { type: "signInAgain" }
  | { type: "retryCheck" }
  | { type: "endSession"; roleRemoved: boolean };

/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
export const initial: StaffSignIn = { phase: "Opening", method: "NoCredential", tokenInAddress: true, secondFactor: false, roleCount: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: StaffSignIn): boolean {
  return alwaysAddressHoldsNoTokenAfterOpening(current) && alwaysSignedInHoldsARole(current) && alwaysSignedInNamesItsMethod(current) && alwaysAccessSessionHasASecondFactor(current) && alwaysTokenFormOnlyForTokenServers(current) && alwaysAccessLinkOnlyForAccessServers(current);
}

/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
//@ pure
export function openConsole(signIn: StaffSignIn, tokenFound: boolean): StaffSignIn {
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "openConsole", \result)
  //@ ensures (inv(signIn) && canOpenConsole(signIn)) ==> stepEndedSessionHoldsNoRoles(signIn, "openConsole", \result)
  return { ...signIn, phase: "Checking", tokenInAddress: false, secondFactor: false, roleCount: 0, method: tokenFound ? "TokenCredential" : signIn.method };
}

/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
//@ pure
export function alwaysAddressHoldsNoTokenAfterOpening(signIn: StaffSignIn): boolean {
  return !(signIn.phase !== "Opening") || !signIn.tokenInAddress;
}

/** Story: Sign in as myself / The console takes a token out of the address before it calls the server (spec/staffSignIn.md:9) */
//@ pure
export function canOpenConsole(signIn: StaffSignIn): boolean {
  return signIn.phase === "Opening";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function phaseForAnswer(answer: IdentityAnswer, viaAccess: boolean, secondFactorShown: boolean, grants: number): SignInPhase {
  return answer === "IdentityAccepted" ? (grants <= 0 ? "NoStaffRole" : (viaAccess && !secondFactorShown ? "NeedsSecondFactor" : "SignedIn")) : (answer === "SignInNeeded" ? (viaAccess ? "AskingAccess" : "AskingToken") : (answer === "IdentityWithoutRole" ? "NoStaffRole" : (answer === "SiteNotAllowed" ? "SiteRefused" : "CheckFailed")));
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function methodForAnswer(answer: IdentityAnswer, viaAccess: boolean, method: SignInMethod): SignInMethod {
  return answer === "IdentityAccepted" || answer === "SignInNeeded" || answer === "IdentityWithoutRole" ? (viaAccess ? "AccessCredential" : "TokenCredential") : method;
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function canAnswerIdentity(signIn: StaffSignIn, grants: number): boolean {
  return signIn.phase === "Checking" && grants >= 0;
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function alwaysSignedInHoldsARole(signIn: StaffSignIn): boolean {
  return !(signIn.phase === "SignedIn") || signIn.roleCount > 0;
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function alwaysSignedInNamesItsMethod(signIn: StaffSignIn): boolean {
  return !(signIn.phase === "SignedIn" || signIn.phase === "NoStaffRole" || signIn.phase === "NeedsSecondFactor") || signIn.method !== "NoCredential";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function alwaysAccessSessionHasASecondFactor(signIn: StaffSignIn): boolean {
  return !(signIn.phase === "SignedIn" && signIn.method === "AccessCredential") || signIn.secondFactor;
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function alwaysTokenFormOnlyForTokenServers(signIn: StaffSignIn): boolean {
  return !(signIn.phase === "AskingToken") || signIn.method === "TokenCredential";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function alwaysAccessLinkOnlyForAccessServers(signIn: StaffSignIn): boolean {
  return !(signIn.phase === "AskingAccess" || signIn.phase === "NeedsSecondFactor") || signIn.method === "AccessCredential";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function stepSignInFollowsAnAcceptedAnswer(before: StaffSignIn, via: string, after: StaffSignIn): boolean {
  return !(after.phase === "SignedIn" && before.phase !== "SignedIn") || (via === "answerIdentity" && before.phase === "Checking");
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function sometimesSignedInWithAToken(signIn: StaffSignIn): boolean {
  return signIn.phase === "SignedIn" && signIn.method === "TokenCredential";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function sometimesSignedInWithAccess(signIn: StaffSignIn): boolean {
  return signIn.phase === "SignedIn" && signIn.method === "AccessCredential";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function sometimesNoStaffRole(signIn: StaffSignIn): boolean {
  return signIn.phase === "NoStaffRole";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function sometimesNeedsSecondFactor(signIn: StaffSignIn): boolean {
  return signIn.phase === "NeedsSecondFactor";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function sometimesSiteRefused(signIn: StaffSignIn): boolean {
  return signIn.phase === "SiteRefused";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function answerIdentity(signIn: StaffSignIn, answer: IdentityAnswer, viaAccess: boolean, secondFactorShown: boolean, grants: number): StaffSignIn {
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "answerIdentity", \result)
  //@ ensures (inv(signIn) && canAnswerIdentity(signIn, grants)) ==> stepEndedSessionHoldsNoRoles(signIn, "answerIdentity", \result)
  const local_0 = answer === "IdentityAccepted";
  return { ...signIn, phase: phaseForAnswer(answer, viaAccess, secondFactorShown, grants), method: methodForAnswer(answer, viaAccess, signIn.method), secondFactor: local_0 && viaAccess && secondFactorShown, roleCount: local_0 ? grants : 0 };
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function lawAccessServerNeverAsksForAToken(answer: IdentityAnswer, secondFactorShown: boolean, grants: number): boolean {
  //@ ensures \result === true
  return phaseForAnswer(answer, true, secondFactorShown, grants) !== "AskingToken";
}

/** Story: Sign in as myself / The server answer decides the sign-in phase (spec/staffSignIn.md:30) */
//@ pure
export function lawAccessNeedsTheSecondFactor(grants: number): boolean {
  //@ ensures \result === true
  return phaseForAnswer("IdentityAccepted", true, false, grants) !== "SignedIn";
}

/** Story: Sign in as myself / The token form accepts a pasted token and checks it again (spec/staffSignIn.md:90) */
//@ pure
export function canSubmitToken(signIn: StaffSignIn, tokenChars: number): boolean {
  return tokenChars > 0 && (signIn.phase === "AskingToken" || (signIn.phase === "NoStaffRole" && signIn.method === "TokenCredential"));
}

/** Story: Sign in as myself / The token form accepts a pasted token and checks it again (spec/staffSignIn.md:90) */
//@ pure
export function submitToken(signIn: StaffSignIn, tokenChars: number): StaffSignIn {
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "submitToken", \result)
  //@ ensures (inv(signIn) && canSubmitToken(signIn, tokenChars)) ==> stepEndedSessionHoldsNoRoles(signIn, "submitToken", \result)
  return { ...signIn, phase: "Checking", method: "TokenCredential", secondFactor: false, roleCount: 0 };
}

/** Story: Sign in as myself / The token form accepts a pasted token and checks it again (spec/staffSignIn.md:90) */
//@ pure
export function sometimesAsksForAToken(signIn: StaffSignIn): boolean {
  return signIn.phase === "AskingToken";
}

/** Story: Sign in as myself / A single sign-on viewer signs in again through Cloudflare Access (spec/staffSignIn.md:104) */
//@ pure
export function canSignInAgain(signIn: StaffSignIn): boolean {
  return signIn.phase === "AskingAccess" || signIn.phase === "NeedsSecondFactor" || (signIn.phase === "NoStaffRole" && signIn.method === "AccessCredential");
}

/** Story: Sign in as myself / A single sign-on viewer signs in again through Cloudflare Access (spec/staffSignIn.md:104) */
//@ pure
export function signInAgain(signIn: StaffSignIn): StaffSignIn {
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "signInAgain", \result)
  //@ ensures (inv(signIn) && canSignInAgain(signIn)) ==> stepEndedSessionHoldsNoRoles(signIn, "signInAgain", \result)
  return { ...signIn, phase: "Opening", secondFactor: false, roleCount: 0 };
}

/** Story: Sign in as myself / A single sign-on viewer signs in again through Cloudflare Access (spec/staffSignIn.md:104) */
//@ pure
export function sometimesAsksForAccess(signIn: StaffSignIn): boolean {
  return signIn.phase === "AskingAccess";
}

/** Story: Sign in as myself / A failed check can be tried again (spec/staffSignIn.md:119) */
//@ pure
export function canRetryCheck(signIn: StaffSignIn): boolean {
  return signIn.phase === "CheckFailed";
}

/** Story: Sign in as myself / A failed check can be tried again (spec/staffSignIn.md:119) */
//@ pure
export function retryCheck(signIn: StaffSignIn): StaffSignIn {
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "retryCheck", \result)
  //@ ensures (inv(signIn) && canRetryCheck(signIn)) ==> stepEndedSessionHoldsNoRoles(signIn, "retryCheck", \result)
  return { ...signIn, phase: "Checking" };
}

/** Story: Sign in as myself / A failed check can be tried again (spec/staffSignIn.md:119) */
//@ pure
export function sometimesCheckFailed(signIn: StaffSignIn): boolean {
  return signIn.phase === "CheckFailed";
}

/** Story: Keep my session bound to my roles / An expired sign-in or a changed role ends the signed-in phase (spec/staffSignIn.md:135) */
//@ pure
export function canEndSession(signIn: StaffSignIn): boolean {
  return signIn.phase === "SignedIn";
}

/** Story: Keep my session bound to my roles / An expired sign-in or a changed role ends the signed-in phase (spec/staffSignIn.md:135) */
//@ pure
export function endSession(signIn: StaffSignIn, roleRemoved: boolean): StaffSignIn {
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysAddressHoldsNoTokenAfterOpening(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysSignedInHoldsARole(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysSignedInNamesItsMethod(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysAccessSessionHasASecondFactor(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysTokenFormOnlyForTokenServers(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> alwaysAccessLinkOnlyForAccessServers(\result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> stepSignInFollowsAnAcceptedAnswer(signIn, "endSession", \result)
  //@ ensures (inv(signIn) && canEndSession(signIn)) ==> stepEndedSessionHoldsNoRoles(signIn, "endSession", \result)
  return { ...signIn, secondFactor: false, roleCount: 0, phase: roleRemoved ? "Checking" : (signIn.method === "AccessCredential" ? "AskingAccess" : "AskingToken") };
}

/** Story: Keep my session bound to my roles / An expired sign-in or a changed role ends the signed-in phase (spec/staffSignIn.md:135) */
//@ pure
export function stepEndedSessionHoldsNoRoles(before: StaffSignIn, via: string, after: StaffSignIn): boolean {
  return !(via === "endSession") || (after.roleCount === 0 && after.phase !== "SignedIn" && after.method === before.method);
}

/** Story: Keep my session bound to my roles / Each sign-in phase has one view (spec/staffSignIn.md:150) */
//@ pure
export function signInView(phase: SignInPhase): SignInView {
  return phase === "SignedIn" ? "ShowConsole" : (phase === "AskingToken" ? "ShowTokenForm" : (phase === "AskingAccess" ? "ShowAccessLink" : (phase === "NoStaffRole" ? "ShowNoRole" : (phase === "NeedsSecondFactor" ? "ShowSecondFactorNeeded" : (phase === "SiteRefused" ? "ShowSiteRefused" : (phase === "CheckFailed" ? "ShowRetry" : "ShowLoading"))))));
}

/** Story: Keep my session bound to my roles / Each sign-in phase has one view (spec/staffSignIn.md:150) */
//@ pure
export function lawConsoleShowsOnlyWhenSignedIn(phase: SignInPhase): boolean {
  //@ ensures \result === true
  return (signInView(phase) === "ShowConsole") === (phase === "SignedIn");
}

/** Story: Keep my session bound to my roles / Each sign-in phase has one view (spec/staffSignIn.md:150) */
//@ pure
export function lawTokenFormOnlyWhenAskingForAToken(phase: SignInPhase): boolean {
  //@ ensures \result === true
  return (signInView(phase) === "ShowTokenForm") === (phase === "AskingToken");
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function tokensAccepted(accessOn: boolean): boolean {
  return !accessOn;
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function startRefused(realOnlyServer: boolean, remoteDatabase: boolean, platformEnv: PlatformEnv, accessOn: boolean): boolean {
  return !realOnlyServer && !remoteDatabase ? false : (platformEnv === "EnvUnset" || platformEnv === "EnvUnknown" ? true : (accessOn ? false : (platformEnv !== "EnvDev" ? true : remoteDatabase)));
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function lawDeployedRealDataUsesAccess(remoteDatabase: boolean, platformEnv: PlatformEnv, accessOn: boolean): boolean {
  //@ ensures \result === true
  return !(platformEnv !== "EnvDev" && !startRefused(true, remoteDatabase, platformEnv, accessOn)) || accessOn;
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function lawRemoteDataUsesAccess(realOnlyServer: boolean, platformEnv: PlatformEnv, accessOn: boolean): boolean {
  //@ ensures \result === true
  return !(!startRefused(realOnlyServer, true, platformEnv, accessOn)) || accessOn;
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function lawRealDataNeedsAKnownEnvironment(remoteDatabase: boolean, accessOn: boolean): boolean {
  //@ ensures \result === true
  return startRefused(true, remoteDatabase, "EnvUnset", accessOn) && startRefused(true, remoteDatabase, "EnvUnknown", accessOn);
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function lawStartedRealDataTakesNoTokenOffThisMachine(realOnlyServer: boolean, platformEnv: PlatformEnv, accessOn: boolean): boolean {
  //@ ensures \result === true
  return !(!startRefused(realOnlyServer, true, platformEnv, accessOn)) || !tokensAccepted(accessOn);
}

/** Story: Start a console that holds real data only behind single sign-on / Real data outside a local development setup needs Cloudflare Access (spec/staffSignIn.md:176) */
//@ pure
export function lawLocalSimulationNeedsNothing(platformEnv: PlatformEnv, accessOn: boolean): boolean {
  //@ ensures \result === true
  return !startRefused(false, false, platformEnv, accessOn);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: StaffSignIn, event: Event): boolean {
  if (event.type === "openConsole") return canOpenConsole(current);
  if (event.type === "answerIdentity") return canAnswerIdentity(current, event.grants);
  if (event.type === "submitToken") return canSubmitToken(current, event.tokenChars);
  if (event.type === "signInAgain") return canSignInAgain(current);
  if (event.type === "retryCheck") return canRetryCheck(current);
  if (event.type === "endSession") return canEndSession(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: StaffSignIn, event: Event): StaffSignIn {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openConsole" && canOpenConsole(current)) return openConsole(current, event.tokenFound);
  if (event.type === "answerIdentity" && canAnswerIdentity(current, event.grants)) return answerIdentity(current, event.answer, event.viaAccess, event.secondFactorShown, event.grants);
  if (event.type === "submitToken" && canSubmitToken(current, event.tokenChars)) return submitToken(current, event.tokenChars);
  if (event.type === "signInAgain" && canSignInAgain(current)) return signInAgain(current);
  if (event.type === "retryCheck" && canRetryCheck(current)) return retryCheck(current);
  if (event.type === "endSession" && canEndSession(current)) return endSession(current, event.roleRemoved);
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
  if (raw.type === "openConsole" && typeof raw.tokenFound === "boolean") return { type: "openConsole", tokenFound: raw.tokenFound };
  if (raw.type === "answerIdentity" && (raw.answer === "IdentityAccepted" || raw.answer === "SignInNeeded" || raw.answer === "IdentityWithoutRole" || raw.answer === "SiteNotAllowed" || raw.answer === "ServerUnreachable") && typeof raw.viaAccess === "boolean" && typeof raw.secondFactorShown === "boolean" && Number.isSafeInteger(raw.grants)) return { type: "answerIdentity", answer: raw.answer, viaAccess: raw.viaAccess, secondFactorShown: raw.secondFactorShown, grants: raw.grants };
  if (raw.type === "submitToken" && Number.isSafeInteger(raw.tokenChars)) return { type: "submitToken", tokenChars: raw.tokenChars };
  if (raw.type === "signInAgain") return { type: "signInAgain" };
  if (raw.type === "retryCheck") return { type: "retryCheck" };
  if (raw.type === "endSession" && typeof raw.roleRemoved === "boolean") return { type: "endSession", roleRemoved: raw.roleRemoved };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): StaffSignIn | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Opening" || raw.phase === "Checking" || raw.phase === "AskingToken" || raw.phase === "AskingAccess" || raw.phase === "SignedIn" || raw.phase === "NoStaffRole" || raw.phase === "NeedsSecondFactor" || raw.phase === "SiteRefused" || raw.phase === "CheckFailed") && (raw.method === "NoCredential" || raw.method === "TokenCredential" || raw.method === "AccessCredential") && typeof raw.tokenInAddress === "boolean" && typeof raw.secondFactor === "boolean" && Number.isSafeInteger(raw.roleCount) && Object.keys(raw).length === 5)) return undefined;
  const parsed: StaffSignIn = ({ phase: raw.phase, method: raw.method, tokenInAddress: raw.tokenInAddress, secondFactor: raw.secondFactor, roleCount: raw.roleCount });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): StaffSignIn {
  //@ ensures inv(\result)
  return initial;
}
