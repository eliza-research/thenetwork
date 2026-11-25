// GENERATED from spec/connectorTools.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
export type Surface = "FullSurface" | "OpenAiSurface";
/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
export type ToolName = "AppInfoTool" | "StartSignupTool" | "PrepareSignupTool" | "CheckStatusTool" | "ReadProfileTool" | "SubmitProfileTool" | "GetUpdatesTool" | "ListLookingForTool" | "PauseLookingForTool" | "ResumeLookingForTool" | "MyPhotosTool" | "PhotoRequestTool";
/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
export type AppId = "Ntwrk" | "Slop" | "Peon" | "Friends";
/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
export type Scope = "NoScope" | "MembershipRead" | "ProfileWrite" | "ProfileRead" | "PhotosUse";
/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
export type MemberStatus = "NotJoined" | "Invited" | "Onboarding" | "Active" | "Stopped" | "OnHold";
/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
export type NextStep = "JoinOnSite" | "GetInvitation" | "AcceptInvitation" | "ReplyToLastText" | "AlreadySignedUp" | "TextStart" | "EmailSupport";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export type ConnectionPhase = "Unbound" | "Unavailable" | "Anonymous" | "Connected" | "Revoked";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export type ToolResult = "NoResult" | "PublicFacts" | "AppNotAvailable" | "SignInNeeded" | "StatusShown" | "ProfileAccepted" | "ProfileNotForStatus" | "DraftSaved" | "DraftRefused" | "UpdatesShown" | "TooManyToday" | "SavedProfileShown" | "SavedProfileUnavailable" | "LookingForUnavailable" | "LookingForShown" | "LookingForChanged" | "LookingForUnchanged" | "PhotoListShown" | "PhotoRequestAnswered" | "PhotoToolUnavailable";
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export interface Connection { phase: ConnectionPhase; host: AppId; surface: Surface; hasWrite: boolean; hasProfileRead: boolean; hasPhotos: boolean; status: MemberStatus; profileApproved: boolean; profileSent: boolean; sentToday: number; draftPrepared: boolean; tokenUnseen: boolean; otherUnseen: boolean; lastShown: number; lastResult: ToolResult }
/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
export type GrantOwnerDecision = "GrantOwnerMatches" | "GrantOwnerChanged" | "GrantOwnerHeld" | "GrantOwnerUnavailable";
/** Story: Use my app's connector from my agent / Reading updates shows the person's own new updates and marks them seen (spec/connectorTools.md) */
export interface UpdateRead { shown: number; tokenLeft: boolean; otherLeft: boolean }
/** Story: Use my app's connector from my agent / A reader who cannot be matched never reads an update about another member (spec/connectorTools.md) */
export type ConnectorUpdateOutcome = "InboxUpdateShown" | "InboxUpdateRetired" | "InboxUpdateWithheld";
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export type ConnectorLimitKey = "AddressLimitKey" | "GrantLimitKey";
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export type RegisterBucket = "AssistantRegisterBucket" | "AddressRegisterBucket";

/** One variant per transition in the spec. */
export type Event =
  | { type: "authorize"; withWrite: boolean; withProfileRead: boolean; withPhotos: boolean }
  | { type: "callWithoutAccess"; tool: ToolName }
  | { type: "callPublicTool"; tool: ToolName; app: AppId; appRegistered: boolean }
  | { type: "connect"; host: AppId; surface: Surface; openAiEnabled: boolean }
  | { type: "callAfterOwnerChange" }
  | { type: "callCheckStatus" }
  | { type: "changeMemberStatus"; newStatus: MemberStatus }
  | { type: "callReadProfile"; currentMembership: boolean; safeFields: boolean }
  | { type: "callLookingForTool"; tool: ToolName; currentMembership: boolean; changed: boolean }
  | { type: "callPhotoTool"; tool: ToolName; currentMembership: boolean; adultMember: boolean }
  | { type: "approveProfile" }
  | { type: "startNewDay" }
  | { type: "callSubmitProfile"; accepted: boolean }
  | { type: "callPrepareSignup"; joinAgeAllowed: boolean }
  | { type: "receiveUpdate"; forReference: boolean }
  | { type: "callGetUpdates"; tokenGiven: boolean; tokenOwn: boolean };

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
export const profileDailyCap: number = 5;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorAnonymousPerAddressMinute: number = 600;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorRequestsPerGrantMinute: number = 120;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorAddressCeilingMinute: number = 6000;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorTokenPerGrantMinute: number = 30;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorTokenAddressCeilingMinute: number = 600;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorRegisterPerAddressHour: number = 20;
/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
export const connectorAssistantRegisterPerAddressHour: number = 1000;
/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
export const initial: Connection = { phase: "Unbound", host: "Ntwrk", surface: "FullSurface", hasWrite: false, hasProfileRead: false, hasPhotos: false, status: "NotJoined", profileApproved: false, profileSent: false, sentToday: 0, draftPrepared: false, tokenUnseen: false, otherUnseen: false, lastShown: 0, lastResult: "NoResult" };
/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
export const hubHost: AppId = "Ntwrk";

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Connection): boolean {
  return alwaysWriteNeedsConnection(current) && alwaysUnboundHasNoDraft(current) && alwaysPhotosNeedConnection(current) && alwaysBoundHostIsServed(current) && alwaysMemberResultsNeedConnection(current) && alwaysSentProfileWasApproved(current) && alwaysDailyProfileCap(current) && alwaysDraftOnlyOnFriendsOrNtwrk(current) && alwaysShownCountIsSmall(current);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function appOffered(surface: Surface, app: AppId): boolean {
  return (surface === "FullSurface" || surface === "OpenAiSurface") && (app === "Ntwrk" || app === "Slop" || app === "Peon" || app === "Friends");
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function photoTool(tool: ToolName): boolean {
  return tool === "MyPhotosTool" || tool === "PhotoRequestTool";
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function hostServes(surface: Surface, host: AppId): boolean {
  return appOffered(surface, host);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function appListed(surface: Surface, host: AppId, app: AppId): boolean {
  return appOffered(surface, app) && (surface === "FullSurface" || app !== "Slop" || host === "Slop");
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawFullSurfaceOffersEveryApp(app: AppId): boolean {
  //@ ensures \result === true
  return appOffered("FullSurface", app);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function configuredHostServes(surface: Surface, host: AppId, openAiEnabled: boolean): boolean {
  return hostServes(surface, host) && (surface !== "OpenAiSurface" || openAiEnabled);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function toolListed(host: AppId, surface: Surface, tool: ToolName): boolean {
  return hostServes(surface, host) && (tool !== "PrepareSignupTool" || host === "Friends" || host === "Ntwrk") && (!photoTool(tool) || (host === "Slop" && surface === "FullSurface"));
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawOpenAiListsSlopOnlyAtItsOwnEndpoint(host: AppId): boolean {
  //@ ensures \result === true
  return appListed("OpenAiSurface", host, "Slop") === (host === "Slop");
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawFullSurfaceListsEveryApp(host: AppId, app: AppId): boolean {
  //@ ensures \result === true
  return appListed("FullSurface", host, app);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawConfiguredOptOutBlocksOpenAiHost(host: AppId): boolean {
  //@ ensures \result === true
  return !configuredHostServes("OpenAiSurface", host, false);
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawPhotoToolsOnlyOnSlop(host: AppId, surface: Surface, tool: ToolName): boolean {
  //@ ensures \result === true
  return !(photoTool(tool) && toolListed(host, surface, tool)) || (host === "Slop" && surface === "FullSurface");
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawDraftOnlyOnFriendsAndNtwrk(host: AppId, surface: Surface): boolean {
  //@ ensures \result === true
  return !toolListed(host, surface, "PrepareSignupTool") || (host === "Friends" || host === "Ntwrk");
}

/** Story: Use my app's connector from my agent / Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date (spec/connectorTools.md) */
//@ pure
export function lawOpenAiOffersEveryApp(app: AppId): boolean {
  //@ ensures \result === true
  return appOffered("OpenAiSurface", app) && hostServes("OpenAiSurface", app) && toolListed(app, "OpenAiSurface", "AppInfoTool");
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function grantServesApp(grantApp: AppId, requestApp: AppId): boolean {
  return grantApp === requestApp;
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function lawGrantNeverCrossesApps(grantApp: AppId, requestApp: AppId): boolean {
  //@ ensures \result === true
  return !(grantApp !== requestApp) || !grantServesApp(grantApp, requestApp);
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function hostBindsApp(host: AppId, app: AppId): boolean {
  return host === app || host === hubHost;
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function siteOffersOpenAi(site: AppId, app: AppId): boolean {
  return hostBindsApp(site, app) && (site === hubHost || app !== "Slop");
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function lawHubServesEveryApp(app: AppId): boolean {
  //@ ensures \result === true
  return hostBindsApp(hubHost, app);
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function lawAppSiteServesOnlyItsApp(host: AppId, app: AppId): boolean {
  //@ ensures \result === true
  return !(host !== hubHost) || hostBindsApp(host, app) === (host === app);
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function lawHubOffersOpenAiForEveryApp(app: AppId): boolean {
  //@ ensures \result === true
  return siteOffersOpenAi(hubHost, app);
}

/** Story: Use my app's connector from my agent / The ntwrk.party host serves every app at its own path, and a grant covers only its own app (spec/connectorTools.md) */
//@ pure
export function lawSlopSiteKeepsNoOpenAiSurface(app: AppId): boolean {
  //@ ensures \result === true
  return !siteOffersOpenAi("Slop", app);
}

/** Story: Use my app's connector from my agent / The member tools name the site where the person signs in (spec/connectorTools.md) */
//@ pure
export function signInSite(site: AppId, app: AppId): AppId {
  return site === hubHost ? hubHost : app;
}

/** Story: Use my app's connector from my agent / The member tools name the site where the person signs in (spec/connectorTools.md) */
//@ pure
export function lawHubPathsSignInOnTheHub(app: AppId): boolean {
  //@ ensures \result === true
  return signInSite(hubHost, app) === hubHost;
}

/** Story: Use my app's connector from my agent / The member tools name the site where the person signs in (spec/connectorTools.md) */
//@ pure
export function lawAppSiteSignsInOnItself(app: AppId): boolean {
  //@ ensures \result === true
  return signInSite(app, app) === app;
}

/** Story: Use my app's connector from my agent / The member tools name the site where the person signs in (spec/connectorTools.md) */
//@ pure
export function lawSignInSiteServesTheApp(site: AppId, app: AppId): boolean {
  //@ ensures \result === true
  return !hostBindsApp(site, app) || (signInSite(site, app) === site && hostBindsApp(signInSite(site, app), app));
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function scopeFor(tool: ToolName): Scope {
  return tool === "AppInfoTool" || tool === "StartSignupTool" ? "NoScope" : (tool === "CheckStatusTool" || tool === "GetUpdatesTool" ? "MembershipRead" : (tool === "ReadProfileTool" || tool === "ListLookingForTool" ? "ProfileRead" : (photoTool(tool) ? "PhotosUse" : "ProfileWrite")));
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawPublicToolsNeedNoSignIn(tool: ToolName): boolean {
  //@ ensures \result === true
  return (scopeFor(tool) === "NoScope") === (tool === "AppInfoTool" || tool === "StartSignupTool");
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function grantCovers(tool: ToolName, hasRead: boolean, hasWrite: boolean, hasProfileRead: boolean, hasPhotos: boolean): boolean {
  return scopeFor(tool) === "NoScope" || (scopeFor(tool) === "MembershipRead" && hasRead) || (scopeFor(tool) === "ProfileWrite" && hasWrite) || (scopeFor(tool) === "ProfileRead" && hasProfileRead) || (scopeFor(tool) === "PhotosUse" && hasPhotos);
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawLookingForChangesNeedWrite(tool: ToolName): boolean {
  //@ ensures \result === true
  return !(tool === "PauseLookingForTool" || tool === "ResumeLookingForTool") || scopeFor(tool) === "ProfileWrite";
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawGrantCoversPublicTools(tool: ToolName, hasRead: boolean, hasWrite: boolean, hasProfileRead: boolean, hasPhotos: boolean): boolean {
  //@ ensures \result === true
  return !(scopeFor(tool) === "NoScope") || grantCovers(tool, hasRead, hasWrite, hasProfileRead, hasPhotos);
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawProfileReadScopeIsSeparate(hasRead: boolean, hasWrite: boolean, hasPhotos: boolean): boolean {
  //@ ensures \result === true
  return !grantCovers("ReadProfileTool", hasRead, hasWrite, false, hasPhotos) && !grantCovers("ListLookingForTool", hasRead, hasWrite, false, hasPhotos);
}

/** Story: Use my app's connector from my agent / Public tools need no sign-in, and member tools need the person's own grant (spec/connectorTools.md) */
//@ pure
export function lawPhotoScopeIsSeparate(tool: ToolName, hasRead: boolean, hasWrite: boolean, hasProfileRead: boolean, hasPhotos: boolean): boolean {
  //@ ensures \result === true
  return (!photoTool(tool) || !grantCovers(tool, hasRead, hasWrite, hasProfileRead, false)) && (!(!photoTool(tool)) || grantCovers(tool, hasRead, hasWrite, hasProfileRead, hasPhotos) === grantCovers(tool, hasRead, hasWrite, hasProfileRead, false));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function liveMember(status: MemberStatus): boolean {
  return status === "Active" || status === "Onboarding";
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function connectorMembershipStatus(storedStatus: string, reviewRequired: boolean, optedOut: boolean): MemberStatus {
  return reviewRequired || storedStatus === "restricted" ? "OnHold" : (storedStatus === "paused" ? "Stopped" : (storedStatus === "active" ? (optedOut ? "Stopped" : "Active") : (storedStatus === "onboarding" ? (optedOut ? "Stopped" : "Onboarding") : (storedStatus === "invited" ? "Invited" : "NotJoined"))));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function nextStepFor(status: MemberStatus, inviteOnly: boolean): NextStep {
  return status === "NotJoined" ? (inviteOnly ? "GetInvitation" : "JoinOnSite") : (status === "Invited" ? "AcceptInvitation" : (status === "Onboarding" ? "ReplyToLastText" : (status === "Active" ? "AlreadySignedUp" : (status === "Stopped" ? "TextStart" : "EmailSupport"))));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawStoppedMembershipCannotSubmitProfile(storedStatus: string, reviewRequired: boolean): boolean {
  //@ ensures \result === true
  return !liveMember(connectorMembershipStatus(storedStatus, reviewRequired, true));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function toolAllowedFor(tool: ToolName, status: MemberStatus): boolean {
  return tool === "SubmitProfileTool" ? liveMember(status) : (tool === "ReadProfileTool" || tool === "ListLookingForTool" || tool === "PauseLookingForTool" || tool === "ResumeLookingForTool" || photoTool(tool) ? status === "Active" : (tool === "PrepareSignupTool" ? status === "NotJoined" || status === "Invited" : true));
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawPhotoToolsOnlyForActiveMembers(status: MemberStatus): boolean {
  //@ ensures \result === true
  return !(toolAllowedFor("MyPhotosTool", status) || toolAllowedFor("PhotoRequestTool", status)) || status === "Active";
}

/** Story: Use my app's connector from my agent / The member status decides which member tool can act (spec/connectorTools.md) */
//@ pure
export function lawReadToolsServeEveryStatus(status: MemberStatus): boolean {
  //@ ensures \result === true
  return toolAllowedFor("AppInfoTool", status) && toolAllowedFor("StartSignupTool", status) && toolAllowedFor("CheckStatusTool", status) && toolAllowedFor("GetUpdatesTool", status);
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
export function lawLookingForOnlyForActiveMembers(status: MemberStatus): boolean {
  //@ ensures \result === true
  return !(toolAllowedFor("ListLookingForTool", status) || toolAllowedFor("PauseLookingForTool", status) || toolAllowedFor("ResumeLookingForTool", status)) || status === "Active";
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
export function authorize(c: Connection, withWrite: boolean, withProfileRead: boolean, withPhotos: boolean): Connection {
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepSavedProfileNeedsReadAuthority(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepLookingForListNeedsRead(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepNothingSentAtTheLimit(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepSubmitOnlyForLiveMember(c, "authorize", \result)
  //@ ensures (inv(c) && canAuthorize(c)) ==> stepReadingNeverAddsUnseen(c, "authorize", \result)
  return { ...c, phase: "Connected", hasWrite: withWrite, hasProfileRead: withProfileRead, hasPhotos: withPhotos, sentToday: 0, draftPrepared: false, lastResult: "NoResult" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function callWithoutAccess(c: Connection, tool: ToolName): Connection {
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepSavedProfileNeedsReadAuthority(c, "callWithoutAccess", \result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callWithoutAccess", \result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepLookingForListNeedsRead(c, "callWithoutAccess", \result)
  //@ ensures (inv(c) && canCallWithoutAccess(c, tool)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callWithoutAccess", \result)
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
export function alwaysPhotosNeedConnection(c: Connection): boolean {
  return !c.hasPhotos || c.phase === "Connected";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canCallPublicTool(c: Connection, tool: ToolName): boolean {
  return (c.phase === "Anonymous" || c.phase === "Connected") && scopeFor(tool) === "NoScope";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function callPublicTool(c: Connection, tool: ToolName, app: AppId, appRegistered: boolean): Connection {
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepSavedProfileNeedsReadAuthority(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepLookingForListNeedsRead(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepNothingSentAtTheLimit(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepSubmitOnlyForLiveMember(c, "callPublicTool", \result)
  //@ ensures (inv(c) && canCallPublicTool(c, tool)) ==> stepReadingNeverAddsUnseen(c, "callPublicTool", \result)
  return { ...c, lastResult: appRegistered && appListed(c.surface, c.host, app) ? "PublicFacts" : "AppNotAvailable" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function alwaysBoundHostIsServed(c: Connection): boolean {
  return !bound(c) || hostServes(c.surface, c.host);
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function connect(c: Connection, host: AppId, surface: Surface, openAiEnabled: boolean): Connection {
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepSavedProfileNeedsReadAuthority(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepLookingForListNeedsRead(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepNothingSentAtTheLimit(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepSubmitOnlyForLiveMember(c, "connect", \result)
  //@ ensures (inv(c) && canConnect(c)) ==> stepReadingNeverAddsUnseen(c, "connect", \result)
  return { ...c, host: host, surface: surface, phase: configuredHostServes(surface, host, openAiEnabled) ? "Anonymous" : "Unavailable" };
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function lawUnregisteredAppIsNotAvailable(c: Connection, tool: ToolName, app: AppId): boolean {
  //@ ensures \result === true
  return callPublicTool(c, tool, app, false).lastResult === "AppNotAvailable";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function lawOpenAiPluginServerNeverNamesSlop(c: Connection, tool: ToolName): boolean {
  //@ ensures \result === true
  return !(c.surface === "OpenAiSurface" && c.host !== "Slop") || callPublicTool(c, tool, "Slop", true).lastResult === "AppNotAvailable";
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function canCallWithoutAccess(c: Connection, tool: ToolName): boolean {
  return bound(c) && toolListed(c.host, c.surface, tool) && ((c.phase === "Anonymous" && scopeFor(tool) !== "NoScope") || c.phase === "Revoked" || (c.phase === "Connected" && !grantCovers(tool, true, c.hasWrite, c.hasProfileRead, c.hasPhotos)));
}

/** Story: Use my app's connector from my agent / A connection binds to one host on one surface, and the person connects it in the browser (spec/connectorTools.md) */
//@ pure
export function lawDisabledOpenAiHostIsUnavailable(c: Connection, host: AppId): boolean {
  //@ ensures \result === true
  return connect(c, host, "OpenAiSurface", false).phase === "Unavailable";
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function decideGrantOwner(available: boolean, held: boolean, samePerson: boolean): GrantOwnerDecision {
  return !available ? "GrantOwnerUnavailable" : (held ? "GrantOwnerHeld" : (samePerson ? "GrantOwnerMatches" : "GrantOwnerChanged"));
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
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepLookingForListNeedsRead(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepNothingSentAtTheLimit(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepSubmitOnlyForLiveMember(c, "callAfterOwnerChange", \result)
  //@ ensures (inv(c) && canCallAfterOwnerChange(c)) ==> stepReadingNeverAddsUnseen(c, "callAfterOwnerChange", \result)
  return { ...c, phase: "Revoked", hasWrite: false, hasProfileRead: false, hasPhotos: false, lastResult: "SignInNeeded" };
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function memberResult(r: ToolResult): boolean {
  return r === "StatusShown" || r === "ProfileAccepted" || r === "ProfileNotForStatus" || r === "DraftSaved" || r === "DraftRefused" || r === "UpdatesShown" || r === "TooManyToday" || r === "SavedProfileShown" || r === "SavedProfileUnavailable" || r === "LookingForUnavailable" || r === "LookingForShown" || r === "LookingForChanged" || r === "LookingForUnchanged" || r === "PhotoListShown" || r === "PhotoRequestAnswered" || r === "PhotoToolUnavailable";
}

/** Story: Use my app's connector from my agent / A grant that no longer belongs to the phone's person ends the connection (spec/connectorTools.md) */
//@ pure
export function lawOnlyObservedOwnerChangeEndsGrant(available: boolean, held: boolean, samePerson: boolean): boolean {
  //@ ensures \result === true
  return (decideGrantOwner(available, held, samePerson) === "GrantOwnerChanged") === (available && !held && !samePerson);
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
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callCheckStatus", \result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callCheckStatus", \result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepLookingForListNeedsRead(c, "callCheckStatus", \result)
  //@ ensures (inv(c) && canCallCheckStatus(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callCheckStatus", \result)
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
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepSavedProfileNeedsReadAuthority(c, "changeMemberStatus", \result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepLookingForChangeNeedsWriteAndActive(c, "changeMemberStatus", \result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepLookingForListNeedsRead(c, "changeMemberStatus", \result)
  //@ ensures (inv(c) && canChangeMemberStatus(c, newStatus)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "changeMemberStatus", \result)
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

/** Story: Use my app's connector from my agent / Read saved profile fields only for this app's active member (spec/connectorTools.md) */
//@ pure
export function canCallReadProfile(c: Connection): boolean {
  return c.phase === "Connected" && c.hasProfileRead;
}

/** Story: Use my app's connector from my agent / Read saved profile fields only for this app's active member (spec/connectorTools.md) */
//@ pure
export function stepSavedProfileNeedsReadAuthority(before: Connection, via: string, after: Connection): boolean {
  return !(after.lastResult === "SavedProfileShown" && before.lastResult !== "SavedProfileShown") || (via === "callReadProfile" && before.phase === "Connected" && before.hasProfileRead && before.status === "Active");
}

/** Story: Use my app's connector from my agent / Read saved profile fields only for this app's active member (spec/connectorTools.md) */
//@ pure
export function sometimesSavedProfileShown(c: Connection): boolean {
  return c.lastResult === "SavedProfileShown";
}

/** Story: Use my app's connector from my agent / Read saved profile fields only for this app's active member (spec/connectorTools.md) */
//@ pure
export function callReadProfile(c: Connection, currentMembership: boolean, safeFields: boolean): Connection {
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepLookingForListNeedsRead(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepNothingSentAtTheLimit(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepSubmitOnlyForLiveMember(c, "callReadProfile", \result)
  //@ ensures (inv(c) && canCallReadProfile(c)) ==> stepReadingNeverAddsUnseen(c, "callReadProfile", \result)
  return { ...c, lastResult: toolAllowedFor("ReadProfileTool", c.status) && currentMembership && safeFields ? "SavedProfileShown" : "SavedProfileUnavailable" };
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function lookingForTool(tool: ToolName): boolean {
  return tool === "ListLookingForTool" || tool === "PauseLookingForTool" || tool === "ResumeLookingForTool";
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function stepLookingForChangeNeedsWriteAndActive(before: Connection, via: string, after: Connection): boolean {
  return !(after.lastResult === "LookingForChanged" && before.lastResult !== "LookingForChanged") || (via === "callLookingForTool" && before.phase === "Connected" && before.hasWrite && before.status === "Active");
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function stepLookingForListNeedsRead(before: Connection, via: string, after: Connection): boolean {
  return !(after.lastResult === "LookingForShown" && before.lastResult !== "LookingForShown") || (via === "callLookingForTool" && before.phase === "Connected" && before.hasProfileRead && before.status === "Active");
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function sometimesLookingForShown(c: Connection): boolean {
  return c.lastResult === "LookingForShown";
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function sometimesLookingForChanged(c: Connection): boolean {
  return c.lastResult === "LookingForChanged";
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function sometimesLookingForUnchanged(c: Connection): boolean {
  return c.lastResult === "LookingForUnchanged";
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function sometimesLookingForUnavailable(c: Connection): boolean {
  return c.lastResult === "LookingForUnavailable";
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function canCallLookingForTool(c: Connection, tool: ToolName): boolean {
  return c.phase === "Connected" && lookingForTool(tool) && (tool === "ListLookingForTool" ? c.hasProfileRead : c.hasWrite);
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function callLookingForTool(c: Connection, tool: ToolName, currentMembership: boolean, changed: boolean): Connection {
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepSavedProfileNeedsReadAuthority(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepLookingForListNeedsRead(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepNothingSentAtTheLimit(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepSubmitOnlyForLiveMember(c, "callLookingForTool", \result)
  //@ ensures (inv(c) && canCallLookingForTool(c, tool)) ==> stepReadingNeverAddsUnseen(c, "callLookingForTool", \result)
  return { ...c, lastResult: !toolAllowedFor(tool, c.status) || !currentMembership ? "LookingForUnavailable" : (tool === "ListLookingForTool" ? "LookingForShown" : (changed ? "LookingForChanged" : "LookingForUnchanged")) };
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function resultShowsLookingFor(hasProfileRead: boolean): boolean {
  return grantCovers("ListLookingForTool", false, false, hasProfileRead, false);
}

/** Story: Use my app's connector from my agent / The agent can list the person's standing things and pause or resume one, but never close one (spec/connectorTools.md) */
//@ pure
export function lawLookingForResultNeedsProfileRead(hasProfileRead: boolean): boolean {
  //@ ensures \result === true
  return resultShowsLookingFor(hasProfileRead) === hasProfileRead;
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function stepPhotoToolNeedsPhotosScopeAndActive(before: Connection, via: string, after: Connection): boolean {
  return !((after.lastResult === "PhotoListShown" || after.lastResult === "PhotoRequestAnswered") && after.lastResult !== before.lastResult) || (via === "callPhotoTool" && before.phase === "Connected" && before.hasPhotos && before.status === "Active" && before.host === "Slop");
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function sometimesPhotoListShown(c: Connection): boolean {
  return c.lastResult === "PhotoListShown";
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function sometimesPhotoRequestAnswered(c: Connection): boolean {
  return c.lastResult === "PhotoRequestAnswered";
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function sometimesPhotoToolUnavailable(c: Connection): boolean {
  return c.lastResult === "PhotoToolUnavailable";
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function callPhotoTool(c: Connection, tool: ToolName, currentMembership: boolean, adultMember: boolean): Connection {
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepSavedProfileNeedsReadAuthority(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepLookingForListNeedsRead(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepNothingSentAtTheLimit(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepSubmitOnlyForLiveMember(c, "callPhotoTool", \result)
  //@ ensures (inv(c) && canCallPhotoTool(c, tool)) ==> stepReadingNeverAddsUnseen(c, "callPhotoTool", \result)
  return { ...c, lastResult: !toolAllowedFor(tool, c.status) || !currentMembership || !adultMember ? "PhotoToolUnavailable" : (tool === "MyPhotosTool" ? "PhotoListShown" : "PhotoRequestAnswered") };
}

/** Story: Use my app's connector from my agent / The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send (spec/connectorTools.md) */
//@ pure
export function canCallPhotoTool(c: Connection, tool: ToolName): boolean {
  return c.phase === "Connected" && photoTool(tool) && c.hasPhotos && toolListed(c.host, c.surface, tool);
}

/** Story: Use my app's connector from my agent / The agent sends an approved profile once, only for a live member, within the daily limit (spec/connectorTools.md) */
//@ pure
export function profileLimitReached(sentToday: number): boolean {
  return sentToday >= profileDailyCap;
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
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepSavedProfileNeedsReadAuthority(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepLookingForListNeedsRead(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepNothingSentAtTheLimit(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepSubmitOnlyForLiveMember(c, "approveProfile", \result)
  //@ ensures (inv(c) && canApproveProfile(c)) ==> stepReadingNeverAddsUnseen(c, "approveProfile", \result)
  return { ...c, profileApproved: true, profileSent: false };
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
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepSavedProfileNeedsReadAuthority(c, "startNewDay", \result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "startNewDay", \result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepLookingForListNeedsRead(c, "startNewDay", \result)
  //@ ensures (inv(c) && canStartNewDay(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "startNewDay", \result)
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
export function callSubmitProfile(c: Connection, accepted: boolean): Connection {
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysWriteNeedsConnection(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysUnboundHasNoDraft(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callSubmitProfile", \result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callSubmitProfile", \result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepLookingForListNeedsRead(c, "callSubmitProfile", \result)
  //@ ensures (inv(c) && canCallSubmitProfile(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callSubmitProfile", \result)
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
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callPrepareSignup", \result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callPrepareSignup", \result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepLookingForListNeedsRead(c, "callPrepareSignup", \result)
  //@ ensures (inv(c) && canCallPrepareSignup(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callPrepareSignup", \result)
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
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepSavedProfileNeedsReadAuthority(c, "receiveUpdate", \result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "receiveUpdate", \result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepLookingForListNeedsRead(c, "receiveUpdate", \result)
  //@ ensures (inv(c) && canReceiveUpdate(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "receiveUpdate", \result)
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
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysPhotosNeedConnection(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysBoundHostIsServed(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysMemberResultsNeedConnection(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysSentProfileWasApproved(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysDailyProfileCap(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysDraftOnlyOnFriendsOrNtwrk(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> alwaysShownCountIsSmall(\result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepSavedProfileNeedsReadAuthority(c, "callGetUpdates", \result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepLookingForChangeNeedsWriteAndActive(c, "callGetUpdates", \result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepLookingForListNeedsRead(c, "callGetUpdates", \result)
  //@ ensures (inv(c) && canCallGetUpdates(c)) ==> stepPhotoToolNeedsPhotosScopeAndActive(c, "callGetUpdates", \result)
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

/** Story: Use my app's connector from my agent / A reader who cannot be matched never reads an update about another member (spec/connectorTools.md) */
//@ pure
export function connectorUpdateOutcome(stillCurrent: boolean, readerAgeAllowed: boolean, aboutAnotherMember: boolean, passesLeakGate: boolean): ConnectorUpdateOutcome {
  return !stillCurrent || (aboutAnotherMember && !readerAgeAllowed) ? "InboxUpdateRetired" : (!passesLeakGate ? "InboxUpdateWithheld" : "InboxUpdateShown");
}

/** Story: Use my app's connector from my agent / A reader who cannot be matched never reads an update about another member (spec/connectorTools.md) */
//@ pure
export function lawUnmatchableReaderNeverReadsAboutAnotherMember(stillCurrent: boolean, passesLeakGate: boolean): boolean {
  //@ ensures \result === true
  return connectorUpdateOutcome(stillCurrent, false, true, passesLeakGate) === "InboxUpdateRetired";
}

/** Story: Use my app's connector from my agent / A reader who cannot be matched never reads an update about another member (spec/connectorTools.md) */
//@ pure
export function lawOwnUpdateReadableAtEveryAge(readerAgeAllowed: boolean): boolean {
  //@ ensures \result === true
  return connectorUpdateOutcome(true, readerAgeAllowed, false, true) === "InboxUpdateShown";
}

/** Story: Use my app's connector from my agent / A reader who cannot be matched never reads an update about another member (spec/connectorTools.md) */
//@ pure
export function lawShownUpdateIsCurrentSafeAndAllowed(stillCurrent: boolean, readerAgeAllowed: boolean, aboutAnotherMember: boolean, passesLeakGate: boolean): boolean {
  //@ ensures \result === true
  return !(connectorUpdateOutcome(stillCurrent, readerAgeAllowed, aboutAnotherMember, passesLeakGate) === "InboxUpdateShown") || (stillCurrent && passesLeakGate && (readerAgeAllowed || !aboutAnotherMember));
}

/** Story: Use my app's connector from my agent / A withheld update stays unseen (spec/connectorTools.md) */
//@ pure
export function connectorUpdateMarkedSeen(updateOutcome: ConnectorUpdateOutcome): boolean {
  return updateOutcome !== "InboxUpdateWithheld";
}

/** Story: Use my app's connector from my agent / A withheld update stays unseen (spec/connectorTools.md) */
//@ pure
export function lawAllowedUpdateFailingGateStaysUnseen(readerAgeAllowed: boolean, aboutAnotherMember: boolean): boolean {
  //@ ensures \result === true
  return !(readerAgeAllowed || !aboutAnotherMember) || !connectorUpdateMarkedSeen(connectorUpdateOutcome(true, readerAgeAllowed, aboutAnotherMember, false));
}

/** Story: Use my app's connector from my agent / A withheld update stays unseen (spec/connectorTools.md) */
//@ pure
export function lawRetiredUpdateIsMarkedSeen(readerAgeAllowed: boolean, aboutAnotherMember: boolean, passesLeakGate: boolean): boolean {
  //@ ensures \result === true
  return connectorUpdateMarkedSeen(connectorUpdateOutcome(false, readerAgeAllowed, aboutAnotherMember, passesLeakGate));
}

/** Story: Use my app's connector from my agent / A withheld update stays unseen (spec/connectorTools.md) */
//@ pure
export function lawFailedGateIsNeverShown(stillCurrent: boolean, readerAgeAllowed: boolean, aboutAnotherMember: boolean): boolean {
  //@ ensures \result === true
  return connectorUpdateOutcome(stillCurrent, readerAgeAllowed, aboutAnotherMember, false) !== "InboxUpdateShown";
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function connectorLimitKey(grantVerified: boolean): ConnectorLimitKey {
  return grantVerified ? "GrantLimitKey" : "AddressLimitKey";
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function connectorRegisterBucket(assistantRedirect: boolean): RegisterBucket {
  return assistantRedirect ? "AssistantRegisterBucket" : "AddressRegisterBucket";
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function connectorRegisterLimit(bucket: RegisterBucket): number {
  return bucket === "AssistantRegisterBucket" ? connectorAssistantRegisterPerAddressHour : connectorRegisterPerAddressHour;
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function lawAssistantBucketOnlyForAssistantRedirects(assistantRedirect: boolean): boolean {
  //@ ensures \result === true
  return (connectorRegisterBucket(assistantRedirect) === "AssistantRegisterBucket") === assistantRedirect;
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function lawVerifiedRequestsCountPerGrant(grantVerified: boolean): boolean {
  //@ ensures \result === true
  return (connectorLimitKey(grantVerified) === "GrantLimitKey") === grantVerified;
}

/** Story: Use my app's connector from my agent / Request limits count each person's grant, and the client address has only a coarse ceiling (spec/connectorTools.md) */
//@ pure
export function lawAddressCeilingAboveEachPersonLimit(assistantRedirect: boolean): boolean {
  //@ ensures \result === true
  return connectorAddressCeilingMinute >= connectorRequestsPerGrantMinute && connectorAddressCeilingMinute >= connectorAnonymousPerAddressMinute && connectorTokenAddressCeilingMinute >= connectorTokenPerGrantMinute && connectorRegisterLimit(connectorRegisterBucket(assistantRedirect)) >= connectorRegisterPerAddressHour;
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
  if (event.type === "callReadProfile") return canCallReadProfile(current);
  if (event.type === "callLookingForTool") return canCallLookingForTool(current, event.tool);
  if (event.type === "callPhotoTool") return canCallPhotoTool(current, event.tool);
  if (event.type === "approveProfile") return canApproveProfile(current);
  if (event.type === "startNewDay") return canStartNewDay(current);
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
  if (event.type === "authorize") return canAuthorize(current) ? authorize(current, event.withWrite, event.withProfileRead, event.withPhotos) : current;
  if (event.type === "callWithoutAccess") return canCallWithoutAccess(current, event.tool) ? callWithoutAccess(current, event.tool) : current;
  if (event.type === "callPublicTool") return canCallPublicTool(current, event.tool) ? callPublicTool(current, event.tool, event.app, event.appRegistered) : current;
  if (event.type === "connect") return canConnect(current) ? connect(current, event.host, event.surface, event.openAiEnabled) : current;
  if (event.type === "callAfterOwnerChange") return canCallAfterOwnerChange(current) ? callAfterOwnerChange(current) : current;
  if (event.type === "callCheckStatus") return canCallCheckStatus(current) ? callCheckStatus(current) : current;
  if (event.type === "changeMemberStatus") return canChangeMemberStatus(current, event.newStatus) ? changeMemberStatus(current, event.newStatus) : current;
  if (event.type === "callReadProfile") return canCallReadProfile(current) ? callReadProfile(current, event.currentMembership, event.safeFields) : current;
  if (event.type === "callLookingForTool") return canCallLookingForTool(current, event.tool) ? callLookingForTool(current, event.tool, event.currentMembership, event.changed) : current;
  if (event.type === "callPhotoTool") return canCallPhotoTool(current, event.tool) ? callPhotoTool(current, event.tool, event.currentMembership, event.adultMember) : current;
  if (event.type === "approveProfile") return canApproveProfile(current) ? approveProfile(current) : current;
  if (event.type === "startNewDay") return canStartNewDay(current) ? startNewDay(current) : current;
  if (event.type === "callSubmitProfile") return canCallSubmitProfile(current) ? callSubmitProfile(current, event.accepted) : current;
  if (event.type === "callPrepareSignup") return canCallPrepareSignup(current) ? callPrepareSignup(current, event.joinAgeAllowed) : current;
  if (event.type === "receiveUpdate") return canReceiveUpdate(current) ? receiveUpdate(current, event.forReference) : current;
  if (event.type === "callGetUpdates") return canCallGetUpdates(current) ? callGetUpdates(current, event.tokenGiven, event.tokenOwn) : current;
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
  if (raw.type === "authorize" && typeof raw.withWrite === "boolean" && typeof raw.withProfileRead === "boolean" && typeof raw.withPhotos === "boolean") return { type: "authorize", withWrite: raw.withWrite, withProfileRead: raw.withProfileRead, withPhotos: raw.withPhotos };
  if (raw.type === "callWithoutAccess" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "ReadProfileTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool" || raw.tool === "ListLookingForTool" || raw.tool === "PauseLookingForTool" || raw.tool === "ResumeLookingForTool" || raw.tool === "MyPhotosTool" || raw.tool === "PhotoRequestTool")) return { type: "callWithoutAccess", tool: raw.tool };
  if (raw.type === "callPublicTool" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "ReadProfileTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool" || raw.tool === "ListLookingForTool" || raw.tool === "PauseLookingForTool" || raw.tool === "ResumeLookingForTool" || raw.tool === "MyPhotosTool" || raw.tool === "PhotoRequestTool") && (raw.app === "Ntwrk" || raw.app === "Slop" || raw.app === "Peon" || raw.app === "Friends") && typeof raw.appRegistered === "boolean") return { type: "callPublicTool", tool: raw.tool, app: raw.app, appRegistered: raw.appRegistered };
  if (raw.type === "connect" && (raw.host === "Ntwrk" || raw.host === "Slop" || raw.host === "Peon" || raw.host === "Friends") && (raw.surface === "FullSurface" || raw.surface === "OpenAiSurface") && typeof raw.openAiEnabled === "boolean") return { type: "connect", host: raw.host, surface: raw.surface, openAiEnabled: raw.openAiEnabled };
  if (raw.type === "callAfterOwnerChange") return { type: "callAfterOwnerChange" };
  if (raw.type === "callCheckStatus") return { type: "callCheckStatus" };
  if (raw.type === "changeMemberStatus" && (raw.newStatus === "NotJoined" || raw.newStatus === "Invited" || raw.newStatus === "Onboarding" || raw.newStatus === "Active" || raw.newStatus === "Stopped" || raw.newStatus === "OnHold")) return { type: "changeMemberStatus", newStatus: raw.newStatus };
  if (raw.type === "callReadProfile" && typeof raw.currentMembership === "boolean" && typeof raw.safeFields === "boolean") return { type: "callReadProfile", currentMembership: raw.currentMembership, safeFields: raw.safeFields };
  if (raw.type === "callLookingForTool" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "ReadProfileTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool" || raw.tool === "ListLookingForTool" || raw.tool === "PauseLookingForTool" || raw.tool === "ResumeLookingForTool" || raw.tool === "MyPhotosTool" || raw.tool === "PhotoRequestTool") && typeof raw.currentMembership === "boolean" && typeof raw.changed === "boolean") return { type: "callLookingForTool", tool: raw.tool, currentMembership: raw.currentMembership, changed: raw.changed };
  if (raw.type === "callPhotoTool" && (raw.tool === "AppInfoTool" || raw.tool === "StartSignupTool" || raw.tool === "PrepareSignupTool" || raw.tool === "CheckStatusTool" || raw.tool === "ReadProfileTool" || raw.tool === "SubmitProfileTool" || raw.tool === "GetUpdatesTool" || raw.tool === "ListLookingForTool" || raw.tool === "PauseLookingForTool" || raw.tool === "ResumeLookingForTool" || raw.tool === "MyPhotosTool" || raw.tool === "PhotoRequestTool") && typeof raw.currentMembership === "boolean" && typeof raw.adultMember === "boolean") return { type: "callPhotoTool", tool: raw.tool, currentMembership: raw.currentMembership, adultMember: raw.adultMember };
  if (raw.type === "approveProfile") return { type: "approveProfile" };
  if (raw.type === "startNewDay") return { type: "startNewDay" };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unbound" || raw.phase === "Unavailable" || raw.phase === "Anonymous" || raw.phase === "Connected" || raw.phase === "Revoked") && (raw.host === "Ntwrk" || raw.host === "Slop" || raw.host === "Peon" || raw.host === "Friends") && (raw.surface === "FullSurface" || raw.surface === "OpenAiSurface") && typeof raw.hasWrite === "boolean" && typeof raw.hasProfileRead === "boolean" && typeof raw.hasPhotos === "boolean" && (raw.status === "NotJoined" || raw.status === "Invited" || raw.status === "Onboarding" || raw.status === "Active" || raw.status === "Stopped" || raw.status === "OnHold") && typeof raw.profileApproved === "boolean" && typeof raw.profileSent === "boolean" && Number.isSafeInteger(raw.sentToday) && typeof raw.draftPrepared === "boolean" && typeof raw.tokenUnseen === "boolean" && typeof raw.otherUnseen === "boolean" && Number.isSafeInteger(raw.lastShown) && (raw.lastResult === "NoResult" || raw.lastResult === "PublicFacts" || raw.lastResult === "AppNotAvailable" || raw.lastResult === "SignInNeeded" || raw.lastResult === "StatusShown" || raw.lastResult === "ProfileAccepted" || raw.lastResult === "ProfileNotForStatus" || raw.lastResult === "DraftSaved" || raw.lastResult === "DraftRefused" || raw.lastResult === "UpdatesShown" || raw.lastResult === "TooManyToday" || raw.lastResult === "SavedProfileShown" || raw.lastResult === "SavedProfileUnavailable" || raw.lastResult === "LookingForUnavailable" || raw.lastResult === "LookingForShown" || raw.lastResult === "LookingForChanged" || raw.lastResult === "LookingForUnchanged" || raw.lastResult === "PhotoListShown" || raw.lastResult === "PhotoRequestAnswered" || raw.lastResult === "PhotoToolUnavailable") && Object.keys(raw).length === 15)) return undefined;
  const parsed: Connection = ({ phase: raw.phase, host: raw.host, surface: raw.surface, hasWrite: raw.hasWrite, hasProfileRead: raw.hasProfileRead, hasPhotos: raw.hasPhotos, status: raw.status, profileApproved: raw.profileApproved, profileSent: raw.profileSent, sentToday: raw.sentToday, draftPrepared: raw.draftPrepared, tokenUnseen: raw.tokenUnseen, otherUnseen: raw.otherUnseen, lastShown: raw.lastShown, lastResult: raw.lastResult });
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
