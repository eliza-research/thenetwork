// GENERATED from spec/connectorTools.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
export type Surface = "FullSurface" | "OpenAiSurface";
/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
export type ToolName = "AppInfoTool" | "StartSignupTool" | "PrepareSignupTool" | "CheckStatusTool" | "SubmitProfileTool" | "GetUpdatesTool";
/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
export type AppId = "Ntwrk" | "Slop" | "Peon" | "Friends";
/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
export type Scope = "NoScope" | "MembershipRead" | "ProfileWrite";
/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
export type MemberStatus = "NotJoined" | "Invited" | "Onboarding" | "Active" | "Stopped" | "OnHold";
/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
export type NextStep = "JoinOnSite" | "GetInvitation" | "AcceptInvitation" | "ReplyToLastText" | "AlreadySignedUp" | "TextStart" | "EmailSupport";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export type ConnectionPhase = "Unbound" | "Unavailable" | "Anonymous" | "Connected" | "Revoked";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export type ToolResult = "NoResult" | "PublicFacts" | "AppNotAvailable" | "SignInNeeded" | "StatusShown" | "ProfileAccepted" | "ProfileNotForStatus" | "DraftSaved" | "DraftRefused" | "UpdatesShown" | "TooManyToday";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export interface Connection { phase: ConnectionPhase; host: AppId; surface: Surface; hasWrite: boolean; status: MemberStatus; profileApproved: boolean; profileSent: boolean; sentToday: number; draftPrepared: boolean; tokenUnseen: boolean; otherUnseen: boolean; lastShown: number; lastResult: ToolResult }
/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
export interface UpdateRead { shown: number; tokenLeft: boolean; otherLeft: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "authorize"; withWrite: boolean }
  | { type: "callWithoutAccess"; tool: ToolName }
  | { type: "callPublicTool"; tool: ToolName; app: AppId }
  | { type: "connect"; host: AppId; surface: Surface }
  | { type: "callAfterOwnerChange" }
  | { type: "callCheckStatus" }
  | { type: "changeMemberStatus"; newStatus: MemberStatus }
  | { type: "startNewDay" }
  | { type: "approveProfile" }
  | { type: "callSubmitProfile"; accepted: boolean }
  | { type: "callPrepareSignup"; joinAgeAllowed: boolean }
  | { type: "receiveUpdate"; forReference: boolean }
  | { type: "callGetUpdates"; tokenGiven: boolean; tokenOwn: boolean };

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
export const profileDailyCap: number = 5;
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export const initial: Connection = { phase: "Unbound", host: "Ntwrk", surface: "FullSurface", hasWrite: false, status: "NotJoined", profileApproved: false, profileSent: false, sentToday: 0, draftPrepared: false, tokenUnseen: false, otherUnseen: false, lastShown: 0, lastResult: "NoResult" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Connection): boolean {
  return alwaysWriteNeedsConnection(current) && alwaysUnboundHasNoDraft(current) && alwaysOpenAiHidesSlop(current) && alwaysMemberResultsNeedConnection(current) && alwaysSentProfileWasApproved(current) && alwaysDailyProfileCap(current) && alwaysDraftOnlyOnFriendsOrNtwrk(current) && alwaysShownCountIsSmall(current);
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function appOffered(surface: Surface, app: AppId): boolean {
  return surface === "FullSurface" || app !== "Slop";
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function lawFullSurfaceOffersEveryApp(app: AppId): boolean {
  //@ ensures \result === true
  return appOffered("FullSurface", app);
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function hostServes(surface: Surface, host: AppId): boolean {
  return appOffered(surface, host);
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function toolListed(host: AppId, surface: Surface, tool: ToolName): boolean {
  return hostServes(surface, host) && (tool !== "PrepareSignupTool" || host === "Friends" || host === "Ntwrk");
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function lawOpenAiNeverOffersSlop(tool: ToolName): boolean {
  //@ ensures \result === true
  return !appOffered("OpenAiSurface", "Slop") && !toolListed("Slop", "OpenAiSurface", tool);
}

/** Story: Use my app's connector from my agent / Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date (spec/connectorTools.md) */
//@ pure
export function lawDraftOnlyOnFriendsAndNtwrk(host: AppId, surface: Surface): boolean {
  //@ ensures \result === true
  return !toolListed(host, surface, "PrepareSignupTool") || (host === "Friends" || host === "Ntwrk");
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function scopeFor(tool: ToolName): Scope {
  return tool === "AppInfoTool" || tool === "StartSignupTool" ? "NoScope" : (tool === "CheckStatusTool" || tool === "GetUpdatesTool" ? "MembershipRead" : "ProfileWrite");
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawPublicToolsNeedNoSignIn(tool: ToolName): boolean {
  //@ ensures \result === true
  return (scopeFor(tool) === "NoScope") === (tool === "AppInfoTool" || tool === "StartSignupTool");
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function grantCovers(tool: ToolName, hasRead: boolean, hasWrite: boolean): boolean {
  return scopeFor(tool) === "NoScope" || (scopeFor(tool) === "MembershipRead" && hasRead) || (scopeFor(tool) === "ProfileWrite" && hasWrite);
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawGrantCoversPublicTools(tool: ToolName, hasRead: boolean, hasWrite: boolean): boolean {
  //@ ensures \result === true
  return !(scopeFor(tool) === "NoScope") || grantCovers(tool, hasRead, hasWrite);
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function liveMember(status: MemberStatus): boolean {
  return status === "Active" || status === "Onboarding";
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function nextStepFor(status: MemberStatus, inviteOnly: boolean): NextStep {
  return status === "NotJoined" ? (inviteOnly ? "GetInvitation" : "JoinOnSite") : (status === "Invited" ? "AcceptInvitation" : (status === "Onboarding" ? "ReplyToLastText" : (status === "Active" ? "AlreadySignedUp" : (status === "Stopped" ? "TextStart" : "EmailSupport"))));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function toolAllowedFor(tool: ToolName, status: MemberStatus): boolean {
  return tool === "SubmitProfileTool" ? liveMember(status) : (tool === "PrepareSignupTool" ? status === "NotJoined" || status === "Invited" : true);
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawSubmitOnlyForLiveMembers(status: MemberStatus): boolean {
  //@ ensures \result === true
  return toolAllowedFor("SubmitProfileTool", status) === (status === "Active" || status === "Onboarding");
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawDraftOnlyBeforeJoining(status: MemberStatus): boolean {
  //@ ensures \result === true
  return toolAllowedFor("PrepareSignupTool", status) === (status === "NotJoined" || status === "Invited");
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawReadToolsServeEveryStatus(status: MemberStatus): boolean {
  //@ ensures \result === true
  return toolAllowedFor("AppInfoTool", status) && toolAllowedFor("StartSignupTool", status) && toolAllowedFor("CheckStatusTool", status) && toolAllowedFor("GetUpdatesTool", status);
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function bound(c: Connection): boolean {
  return c.phase === "Anonymous" || c.phase === "Connected" || c.phase === "Revoked";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canConnect(c: Connection): boolean {
  return c.phase === "Unbound";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canAuthorize(c: Connection): boolean {
  return c.phase === "Anonymous" || c.phase === "Revoked";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function authorize(c: Connection, withWrite: boolean): Connection {
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepNothingSentAtTheLimit(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepSubmitOnlyForLiveMember(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepReadingNeverAddsUnseen(c, "authorize", \result)
  return { ...c, phase: "Connected", hasWrite: withWrite, sentToday: 0, draftPrepared: false, lastResult: "NoResult" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function callWithoutAccess(c: Connection, tool: ToolName): Connection {
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepNothingSentAtTheLimit(c, "callWithoutAccess", \result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepSubmitOnlyForLiveMember(c, "callWithoutAccess", \result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepReadingNeverAddsUnseen(c, "callWithoutAccess", \result)
  return { ...c, lastResult: "SignInNeeded" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function alwaysWriteNeedsConnection(c: Connection): boolean {
  return !c.hasWrite || c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function alwaysUnboundHasNoDraft(c: Connection): boolean {
  return !(c.phase === "Unbound") || !c.draftPrepared;
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canCallPublicTool(c: Connection, tool: ToolName): boolean {
  return (c.phase === "Anonymous" || c.phase === "Connected") && scopeFor(tool) === "NoScope";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function callPublicTool(c: Connection, tool: ToolName, app: AppId): Connection {
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepNothingSentAtTheLimit(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepSubmitOnlyForLiveMember(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepReadingNeverAddsUnseen(c, "callPublicTool", \result)
  return { ...c, lastResult: appOffered(c.surface, app) ? "PublicFacts" : "AppNotAvailable" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function connect(c: Connection, host: AppId, surface: Surface): Connection {
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepNothingSentAtTheLimit(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepSubmitOnlyForLiveMember(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepReadingNeverAddsUnseen(c, "connect", \result)
  return { ...c, host: host, surface: surface, phase: hostServes(surface, host) ? "Anonymous" : "Unavailable" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function alwaysOpenAiHidesSlop(c: Connection): boolean {
  return !bound(c) || hostServes(c.surface, c.host);
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canCallWithoutAccess(c: Connection, tool: ToolName): boolean {
  return bound(c) && toolListed(c.host, c.surface, tool) && ((c.phase === "Anonymous" && scopeFor(tool) !== "NoScope") || c.phase === "Revoked" || (c.phase === "Connected" && scopeFor(tool) === "ProfileWrite" && !c.hasWrite));
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function canCallAfterOwnerChange(c: Connection): boolean {
  return c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function callAfterOwnerChange(c: Connection): Connection {
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepNothingSentAtTheLimit(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepSubmitOnlyForLiveMember(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepReadingNeverAddsUnseen(c, "callAfterOwnerChange", \result)
  return { ...c, phase: "Revoked", hasWrite: false, lastResult: "SignInNeeded" };
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function memberResult(r: ToolResult): boolean {
  return r === "StatusShown" || r === "ProfileAccepted" || r === "ProfileNotForStatus" || r === "DraftSaved" || r === "DraftRefused" || r === "UpdatesShown" || r === "TooManyToday";
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function alwaysMemberResultsNeedConnection(c: Connection): boolean {
  return !memberResult(c.lastResult) || c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / Check status shows only the person's own status in this one app (spec/connectorTools.md) */
//@ pure
export function canCallCheckStatus(c: Connection): boolean {
  return c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / Check status shows only the person's own status in this one app (spec/connectorTools.md) */
//@ pure
export function callCheckStatus(c: Connection): Connection {
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepNothingSentAtTheLimit(c, "callCheckStatus", \result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepSubmitOnlyForLiveMember(c, "callCheckStatus", \result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepReadingNeverAddsUnseen(c, "callCheckStatus", \result)
  return { ...c, lastResult: "StatusShown" };
}

/** Story: Use my app's connector from my agent / Check status shows only the person's own status in this one app (spec/connectorTools.md) */
//@ pure
export function changeMemberStatus(c: Connection, newStatus: MemberStatus): Connection {
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepNothingSentAtTheLimit(c, "changeMemberStatus", \result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepSubmitOnlyForLiveMember(c, "changeMemberStatus", \result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepReadingNeverAddsUnseen(c, "changeMemberStatus", \result)
  return { ...c, status: newStatus };
}

/** Story: Use my app's connector from my agent / Check status shows only the person's own status in this one app (spec/connectorTools.md) */
//@ pure
export function canChangeMemberStatus(c: Connection, newStatus: MemberStatus): boolean {
  return bound(c) && newStatus !== c.status;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function profileLimitReached(sentToday: number): boolean {
  return sentToday >= profileDailyCap;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function canCallSubmitProfile(c: Connection): boolean {
  return c.phase === "Connected" && c.hasWrite && c.profileApproved && !c.profileSent;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function canStartNewDay(c: Connection): boolean {
  return c.sentToday > 0;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function startNewDay(c: Connection): Connection {
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepNothingSentAtTheLimit(c, "startNewDay", \result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepSubmitOnlyForLiveMember(c, "startNewDay", \result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepReadingNeverAddsUnseen(c, "startNewDay", \result)
  return { ...c, sentToday: 0 };
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function alwaysSentProfileWasApproved(c: Connection): boolean {
  return !c.profileSent || c.profileApproved;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function alwaysDailyProfileCap(c: Connection): boolean {
  return c.sentToday >= 0 && c.sentToday <= profileDailyCap;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function stepNothingSentAtTheLimit(before: Connection, via: string, after: Connection): boolean {
  return !(before.sentToday >= profileDailyCap && (via === "callSubmitProfile" || via === "callPrepareSignup")) || (after.lastResult === "TooManyToday" && after.profileSent === before.profileSent && after.draftPrepared === before.draftPrepared && after.sentToday === before.sentToday);
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function canApproveProfile(c: Connection): boolean {
  return !c.profileApproved || c.profileSent;
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function approveProfile(c: Connection): Connection {
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepNothingSentAtTheLimit(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepSubmitOnlyForLiveMember(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepReadingNeverAddsUnseen(c, "approveProfile", \result)
  return { ...c, profileApproved: true, profileSent: false };
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function callSubmitProfile(c: Connection, accepted: boolean): Connection {
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepNothingSentAtTheLimit(c, "callSubmitProfile", \result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepSubmitOnlyForLiveMember(c, "callSubmitProfile", \result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepReadingNeverAddsUnseen(c, "callSubmitProfile", \result)
  return profileLimitReached(c.sentToday) ? ({ ...c, lastResult: "TooManyToday" } as Connection) : (liveMember(c.status) && accepted ? ({ ...c, sentToday: exact_connectorTools(c.sentToday + 1), profileSent: true, lastResult: "ProfileAccepted" } as Connection) : ({ ...c, sentToday: exact_connectorTools(c.sentToday + 1), lastResult: "ProfileNotForStatus" } as Connection));
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function stepSubmitOnlyForLiveMember(before: Connection, via: string, after: Connection): boolean {
  return !(after.profileSent && !before.profileSent) || (via === "callSubmitProfile" && liveMember(before.status) && before.phase === "Connected" && before.hasWrite && before.profileApproved);
}

/** Story: Use my app's connector from my agent / A Join draft holds only an approved first name and home city, once per grant (spec/connectorTools.md) */
//@ pure
export function canCallPrepareSignup(c: Connection): boolean {
  return c.phase === "Connected" && c.hasWrite && (c.host === "Friends" || c.host === "Ntwrk");
}

/** Story: Use my app's connector from my agent / A Join draft holds only an approved first name and home city, once per grant (spec/connectorTools.md) */
//@ pure
export function alwaysDraftOnlyOnFriendsOrNtwrk(c: Connection): boolean {
  return !c.draftPrepared || (c.host === "Friends" || c.host === "Ntwrk");
}

/** Story: Use my app's connector from my agent / A Join draft holds only an approved first name and home city, once per grant (spec/connectorTools.md) */
//@ pure
export function callPrepareSignup(c: Connection, joinAgeAllowed: boolean): Connection {
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepNothingSentAtTheLimit(c, "callPrepareSignup", \result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepSubmitOnlyForLiveMember(c, "callPrepareSignup", \result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepReadingNeverAddsUnseen(c, "callPrepareSignup", \result)
  return profileLimitReached(c.sentToday) ? ({ ...c, lastResult: "TooManyToday" } as Connection) : (joinAgeAllowed && toolAllowedFor("PrepareSignupTool", c.status) && !c.draftPrepared ? ({ ...c, sentToday: exact_connectorTools(c.sentToday + 1), draftPrepared: true, lastResult: "DraftSaved" } as Connection) : ({ ...c, sentToday: exact_connectorTools(c.sentToday + 1), lastResult: "DraftRefused" } as Connection));
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function readUpdates(tokenUnseen: boolean, otherUnseen: boolean, tokenGiven: boolean, tokenOwn: boolean): UpdateRead {
  return !tokenGiven ? ({ shown: exact_connectorTools((tokenUnseen ? 1 : 0) + (otherUnseen ? 1 : 0)), tokenLeft: false, otherLeft: false } as UpdateRead) : (tokenOwn ? ({ shown: tokenUnseen ? 1 : 0, tokenLeft: false, otherLeft: otherUnseen } as UpdateRead) : ({ shown: 0, tokenLeft: tokenUnseen, otherLeft: otherUnseen } as UpdateRead));
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function canCallGetUpdates(c: Connection): boolean {
  return c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function receiveUpdate(c: Connection, forReference: boolean): Connection {
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepNothingSentAtTheLimit(c, "receiveUpdate", \result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepSubmitOnlyForLiveMember(c, "receiveUpdate", \result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepReadingNeverAddsUnseen(c, "receiveUpdate", \result)
  return forReference ? ({ ...c, tokenUnseen: true } as Connection) : ({ ...c, otherUnseen: true } as Connection);
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function alwaysShownCountIsSmall(c: Connection): boolean {
  return c.lastShown >= 0 && c.lastShown <= 2;
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function stepReadingNeverAddsUnseen(before: Connection, via: string, after: Connection): boolean {
  return !(via === "callGetUpdates") || ((!after.tokenUnseen || before.tokenUnseen) && (!after.otherUnseen || before.otherUnseen));
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function callGetUpdates(c: Connection, tokenGiven: boolean, tokenOwn: boolean): Connection {
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysOpenAiHidesSlop(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepNothingSentAtTheLimit(c, "callGetUpdates", \result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepSubmitOnlyForLiveMember(c, "callGetUpdates", \result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepReadingNeverAddsUnseen(c, "callGetUpdates", \result)
  const local_0: UpdateRead = readUpdates(c.tokenUnseen, c.otherUnseen, tokenGiven, tokenOwn);
  return { ...c, tokenUnseen: local_0.tokenLeft, otherUnseen: local_0.otherLeft, lastShown: local_0.shown, lastResult: "UpdatesShown" };
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function canReceiveUpdate(c: Connection): boolean {
  return bound(c);
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function lawUntokenedReadMarksAllSeen(tokenUnseen: boolean, otherUnseen: boolean, tokenOwn: boolean): boolean {
  //@ ensures \result === true
  const local_1: UpdateRead = readUpdates(tokenUnseen, otherUnseen, false, tokenOwn);
  return !local_1.tokenLeft && !local_1.otherLeft;
}

/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
//@ pure
export function lawForeignReferenceShowsNothing(tokenUnseen: boolean, otherUnseen: boolean): boolean {
  //@ ensures \result === true
  const local_2: UpdateRead = readUpdates(tokenUnseen, otherUnseen, true, false);
  return local_2.shown === 0 && local_2.tokenLeft === tokenUnseen && local_2.otherLeft === otherUnseen;
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesProfileAccepted(c: Connection): boolean {
  return c.lastResult === "ProfileAccepted";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesProfileNotForStatus(c: Connection): boolean {
  return c.lastResult === "ProfileNotForStatus";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesTooManyToday(c: Connection): boolean {
  return c.lastResult === "TooManyToday";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesDraftSaved(c: Connection): boolean {
  return c.lastResult === "DraftSaved";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesDraftRefused(c: Connection): boolean {
  return c.lastResult === "DraftRefused";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesTwoUpdatesShown(c: Connection): boolean {
  return c.lastResult === "UpdatesShown" && c.lastShown === 2;
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesStatusShown(c: Connection): boolean {
  return c.lastResult === "StatusShown";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesSignInNeeded(c: Connection): boolean {
  return c.lastResult === "SignInNeeded";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesAppNotAvailable(c: Connection): boolean {
  return c.lastResult === "AppNotAvailable";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesHostUnavailable(c: Connection): boolean {
  return c.phase === "Unavailable";
}

/** Story: Use my app's connector from my agent / A connection can reach every tool result (spec/connectorTools.md) */
//@ pure
export function sometimesRevoked(c: Connection): boolean {
  return c.phase === "Revoked";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Connection, event: Event): boolean {
  if (event.type === "authorize") return canAuthorize(current);
  if (event.type === "callWithoutAccess") return canCallWithoutAccess(current, event.tool);
  if (event.type === "callPublicTool") return canCallPublicTool(current, event.tool);
  if (event.type === "connect") return canConnect(current);
  if (event.type === "callAfterOwnerChange") return canCallAfterOwnerChange(current);
  if (event.type === "callCheckStatus") return canCallCheckStatus(current);
  if (event.type === "changeMemberStatus") return canChangeMemberStatus(current, event.newStatus);
  if (event.type === "startNewDay") return canStartNewDay(current);
  if (event.type === "approveProfile") return canApproveProfile(current);
  if (event.type === "callSubmitProfile") return canCallSubmitProfile(current);
  if (event.type === "callPrepareSignup") return canCallPrepareSignup(current);
  if (event.type === "receiveUpdate") return canReceiveUpdate(current);
  if (event.type === "callGetUpdates") return canCallGetUpdates(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Connection, event: Event): Connection {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "authorize" && canAuthorize(current)) return authorize(current, event.withWrite);
  if (event.type === "callWithoutAccess" && canCallWithoutAccess(current, event.tool)) return callWithoutAccess(current, event.tool);
  if (event.type === "callPublicTool" && canCallPublicTool(current, event.tool)) return callPublicTool(current, event.tool, event.app);
  if (event.type === "connect" && canConnect(current)) return connect(current, event.host, event.surface);
  if (event.type === "callAfterOwnerChange" && canCallAfterOwnerChange(current)) return callAfterOwnerChange(current);
  if (event.type === "callCheckStatus" && canCallCheckStatus(current)) return callCheckStatus(current);
  if (event.type === "changeMemberStatus" && canChangeMemberStatus(current, event.newStatus)) return changeMemberStatus(current, event.newStatus);
  if (event.type === "startNewDay" && canStartNewDay(current)) return startNewDay(current);
  if (event.type === "approveProfile" && canApproveProfile(current)) return approveProfile(current);
  if (event.type === "callSubmitProfile" && canCallSubmitProfile(current)) return callSubmitProfile(current, event.accepted);
  if (event.type === "callPrepareSignup" && canCallPrepareSignup(current)) return callPrepareSignup(current, event.joinAgeAllowed);
  if (event.type === "receiveUpdate" && canReceiveUpdate(current)) return receiveUpdate(current, event.forReference);
  if (event.type === "callGetUpdates" && canCallGetUpdates(current)) return callGetUpdates(current, event.tokenGiven, event.tokenOwn);
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
  if (raw.type === "authorize" && typeof raw.withWrite === "boolean") return { type: "authorize", withWrite: raw.withWrite };
  if (raw.type === "callWithoutAccess" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool")) return { type: "callWithoutAccess", tool: raw.tool };
  if (raw.type === "callPublicTool" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool") && (raw.app === "Ntwrk" || raw.app === "Slop" || raw.app === "Peon" || raw.app === "Friends")) return { type: "callPublicTool", tool: raw.tool, app: raw.app };
  if (raw.type === "connect" && (raw.host === "Ntwrk" || raw.host === "Slop" || raw.host === "Peon" || raw.host === "Friends") && (raw.surface === "FullSurface" || raw.surface === "OpenAiSurface")) return { type: "connect", host: raw.host, surface: raw.surface };
  if (raw.type === "callAfterOwnerChange") return { type: "callAfterOwnerChange" };
  if (raw.type === "callCheckStatus") return { type: "callCheckStatus" };
  if (raw.type === "changeMemberStatus" && (raw.newStatus === "NotJoined" || raw.newStatus === "Invited" || raw.newStatus === "Onboarding" || raw.newStatus === "Active" || raw.newStatus === "Stopped" || raw.newStatus === "OnHold")) return { type: "changeMemberStatus", newStatus: raw.newStatus };
  if (raw.type === "startNewDay") return { type: "startNewDay" };
  if (raw.type === "approveProfile") return { type: "approveProfile" };
  if (raw.type === "callSubmitProfile" && typeof raw.accepted === "boolean") return { type: "callSubmitProfile", accepted: raw.accepted };
  if (raw.type === "callPrepareSignup" && typeof raw.joinAgeAllowed === "boolean") return { type: "callPrepareSignup", joinAgeAllowed: raw.joinAgeAllowed };
  if (raw.type === "receiveUpdate" && typeof raw.forReference === "boolean") return { type: "receiveUpdate", forReference: raw.forReference };
  if (raw.type === "callGetUpdates" && typeof raw.tokenGiven === "boolean" && typeof raw.tokenOwn === "boolean") return { type: "callGetUpdates", tokenGiven: raw.tokenGiven, tokenOwn: raw.tokenOwn };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Connection | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unbound" || raw.phase === "Unavailable" || raw.phase === "Anonymous" || raw.phase === "Connected" || raw.phase === "Revoked") && (raw.host === "Ntwrk" || raw.host === "Slop" || raw.host === "Peon" || raw.host === "Friends") && (raw.surface === "FullSurface" || raw.surface === "OpenAiSurface") && typeof raw.hasWrite === "boolean" && (raw.status === "NotJoined" || raw.status === "Invited" || raw.status === "Onboarding" || raw.status === "Active" || raw.status === "Stopped" || raw.status === "OnHold") && typeof raw.profileApproved === "boolean" && typeof raw.profileSent === "boolean" && Number.isSafeInteger(raw.sentToday) && typeof raw.draftPrepared === "boolean" && typeof raw.tokenUnseen === "boolean" && typeof raw.otherUnseen === "boolean" && Number.isSafeInteger(raw.lastShown) && (raw.lastResult === "NoResult" || raw.lastResult === "PublicFacts" || raw.lastResult === "AppNotAvailable" || raw.lastResult === "SignInNeeded" || raw.lastResult === "StatusShown" || raw.lastResult === "ProfileAccepted" || raw.lastResult === "ProfileNotForStatus" || raw.lastResult === "DraftSaved" || raw.lastResult === "DraftRefused" || raw.lastResult === "UpdatesShown" || raw.lastResult === "TooManyToday") && Object.keys(raw).length === 13)) return undefined;
  const parsed: Connection = ({ phase: raw.phase, host: raw.host, surface: raw.surface, hasWrite: raw.hasWrite, status: raw.status, profileApproved: raw.profileApproved, profileSent: raw.profileSent, sentToday: raw.sentToday, draftPrepared: raw.draftPrepared, tokenUnseen: raw.tokenUnseen, otherUnseen: raw.otherUnseen, lastShown: raw.lastShown, lastResult: raw.lastResult });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Connection {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_connectorTools(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
