// GENERATED from spec/agentSignup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type SharedPart as brandIdentity_SharedPart, type LogoMark as brandIdentity_LogoMark, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, partTokens as brandIdentity_partTokens, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct, lawPartsTakeTheBrandTokens as brandIdentity_lawPartsTakeTheBrandTokens } from "./brandIdentity.ts";

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export type SkillKind = "DirectHttpsSkill" | "BrowserConnectorSkill";
/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export type AgeBand = "AgeNotStated" | "Under13" | "Teen" | "Adult";
/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export type Transport = "TransportUndecided" | "InAgentCode" | "ConnectorHandoff" | "MessagesHandoff" | "NoTransport";
/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export type SignupPhase = "CheckingCapability" | "Unsupported" | "ReadingApp" | "WrongApp" | "Drafting" | "BelowJoinAge" | "AwaitingApproval" | "Declined" | "CheckingSession" | "CheckingAuthMode" | "SignInUnavailable" | "AwaitingNumber" | "CodeNotSent" | "SecurityCheckBlocked" | "AwaitingCode" | "CodeRejected" | "ReadingAccount" | "ReadyToJoin" | "NeedsInvite" | "InvitationUnavailable" | "OnReview" | "JoinFailed" | "ExistingMember" | "ReadingBack" | "Saved" | "SavedDiffers" | "SaveUnconfirmed" | "HandedOff" | "ReadyToSubmit" | "ConfirmingProfile" | "ProfileNotSent" | "MessagesStopped" | "HandedToMessages";
/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export interface AgentSignup { phase: SignupPhase; transport: Transport; age: AgeBand; inviteOnly: boolean; useInvitation: boolean; approved: boolean; minorNotified: boolean; codeStarts: number; codeChecks: number; joins: number; submits: number }
/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
export type Approval = "ApproveExact" | "AskChanges" | "DeclineSignup";
/** Story: Join an app without leaving my agent / The agent requests the code at most once per attempt (spec/agentSignup.md) */
export type CodeStart = "CodeSent" | "CodeRefused" | "SecurityCheckRequired";
/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
export type AccountFact = "OtherAppAccount" | "MemberAccount" | "JoinableAccount" | "InviteRequired" | "HeldForReview";
/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
export interface InvitationEvidence { forwarded: boolean; sameApp: boolean; approved: boolean }
/** Story: Join an app without leaving my agent / The agent joins once, with the approved profile and the current consent (spec/agentSignup.md) */
export type JoinResult = "JoinCreated" | "JoinBelowAge" | "JoinNeedsInvite" | "JoinInvalidInvitation" | "JoinHeld" | "JoinNotSaved";
/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
export type SiteStatus = "SiteNotJoined" | "SiteInvited" | "SiteOnboarding" | "SiteActive" | "SiteStopped" | "SiteOnHold";
/** Story: Join an app without leaving my agent / The agent asks for the number and the code only in the in-agent transport after approval (spec/agentSignup.md) */
export type AgentAsk = "AskNothing" | "AskProfileFacts" | "AskApproval" | "AskNumber" | "AskCode" | "AskToFinishOnSite" | "AskToSendText";
/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
export type SignupReport = "ReportWorking" | "ReportSaved" | "ReportSaveDiffers" | "ReportSaveUnconfirmed" | "ReportAlreadyMember" | "ReportUnderAge" | "ReportInviteNeeded" | "ReportInviteUnavailable" | "ReportOnHold" | "ReportStopped" | "ReportUnsupported" | "ReportCodeProblem" | "ReportNotSaved" | "ReportDeclined" | "ReportOtherApp" | "ReportSendTheText";

/** One variant per transition in the spec. */
export type Event =
  | { type: "chooseTransport"; skillKind: SkillKind; httpsSession: boolean; connectorTools: boolean }
  | { type: "readAppFacts"; appMatches: boolean; inviteMode: boolean }
  | { type: "draftProfile"; statedAge: AgeBand }
  | { type: "decideApproval"; decision: Approval }
  | { type: "checkSession"; sessionLive: boolean }
  | { type: "readAuthMode"; codeMode: boolean }
  | { type: "startCode"; codeStart: CodeStart }
  | { type: "checkCode"; verified: boolean }
  | { type: "requestNewCode" }
  | { type: "readAccount"; account: AccountFact; invitation: InvitationEvidence }
  | { type: "joinApp"; joinResult: JoinResult; invitationSubmitted: boolean }
  | { type: "readBack"; readBackMatches: boolean }
  | { type: "checkSiteStatus"; siteApp: boolean; siteStatus: SiteStatus }
  | { type: "submitProfile"; accepted: boolean }
  | { type: "confirmProfile"; stillLive: boolean };

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
export const initial: AgentSignup = { phase: "CheckingCapability", transport: "TransportUndecided", age: "AgeNotStated", inviteOnly: false, useInvitation: false, approved: false, minorNotified: false, codeStarts: 0, codeChecks: 0, joins: 0, submits: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AgentSignup): boolean {
  return alwaysTransportFixedAfterChoice(current) && alwaysNoCredentialsWithoutTransport(current) && alwaysAppFactsOnlyInAgent(current) && alwaysUnderThirteenStops(current) && alwaysMinorToldMatchingIsAdult(current) && alwaysApprovedProfileHasJoinAge(current) && alwaysNoApprovalBeforeDraftApproved(current) && alwaysNothingSentBeforeApproval(current) && alwaysTextHandoffIsApproved(current) && alwaysCodePathIsApprovedInAgent(current) && alwaysOneCodePerAttempt(current) && alwaysInviteGateOnlyForInviteApps(current) && alwaysJoinAndSubmitAtMostOnce(current) && alwaysConnectorPathIsApproved(current) && alwaysCredentialsAskedOnlyAfterApproval(current) && alwaysSavedNeedsConfirmedSave(current);
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function transportFor(skillKind: SkillKind, httpsSession: boolean, connectorTools: boolean): Transport {
  return skillKind === "DirectHttpsSkill" ? (httpsSession ? "InAgentCode" : "NoTransport") : (connectorTools ? "ConnectorHandoff" : "MessagesHandoff");
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function skillKindFor(app: brandIdentity_AppKey): SkillKind {
  return app === "Peon" ? "BrowserConnectorSkill" : "DirectHttpsSkill";
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function canChooseTransport(s: AgentSignup): boolean {
  return s.phase === "CheckingCapability";
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function alwaysTransportFixedAfterChoice(s: AgentSignup): boolean {
  return (s.phase === "CheckingCapability") === (s.transport === "TransportUndecided") && (s.phase === "Unsupported") === (s.transport === "NoTransport");
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function alwaysNoCredentialsWithoutTransport(s: AgentSignup): boolean {
  return !(s.transport === "NoTransport" || s.transport === "TransportUndecided") || (s.codeStarts === 0 && s.codeChecks === 0 && s.joins === 0 && s.submits === 0);
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function lawOnlyPeonSkillUsesTheConnector(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return (skillKindFor(app) === "BrowserConnectorSkill") === (app === "Peon");
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function chooseTransport(s: AgentSignup, skillKind: SkillKind, httpsSession: boolean, connectorTools: boolean): AgentSignup {
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> stepSavedFollowsConfirmation(s, "chooseTransport", \result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> stepFinishedStaysFinished(s, "chooseTransport", \result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> stepRetryOnlyAfterCodeProblem(s, "chooseTransport", \result)
  const local_0: Transport = transportFor(skillKind, httpsSession, connectorTools);
  return { ...s, transport: local_0, phase: local_0 === "NoTransport" ? "Unsupported" : (local_0 === "InAgentCode" ? "ReadingApp" : "Drafting") };
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function lawDirectSkillNeverFallsBack(httpsSession: boolean, connectorTools: boolean): boolean {
  //@ ensures \result === true
  const local_1: Transport = transportFor("DirectHttpsSkill", httpsSession, connectorTools);
  return local_1 === "InAgentCode" || local_1 === "NoTransport";
}

/** Story: Join an app without leaving my agent / The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials (spec/agentSignup.md) */
//@ pure
export function lawConnectorSkillNeverUsesCodeInAgent(httpsSession: boolean, connectorTools: boolean): boolean {
  //@ ensures \result === true
  const local_2: Transport = transportFor("BrowserConnectorSkill", httpsSession, connectorTools);
  return local_2 === "ConnectorHandoff" || local_2 === "MessagesHandoff";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, the agent reads the app's own facts before it drafts and stops when they name another app (spec/agentSignup.md) */
//@ pure
export function canReadAppFacts(s: AgentSignup): boolean {
  return s.phase === "ReadingApp" && s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, the agent reads the app's own facts before it drafts and stops when they name another app (spec/agentSignup.md) */
//@ pure
export function alwaysAppFactsOnlyInAgent(s: AgentSignup): boolean {
  return !(s.phase === "ReadingApp" || s.inviteOnly) || s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, the agent reads the app's own facts before it drafts and stops when they name another app (spec/agentSignup.md) */
//@ pure
export function readAppFacts(s: AgentSignup, appMatches: boolean, inviteMode: boolean): AgentSignup {
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> stepSavedFollowsConfirmation(s, "readAppFacts", \result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> stepFinishedStaysFinished(s, "readAppFacts", \result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> stepRetryOnlyAfterCodeProblem(s, "readAppFacts", \result)
  return { ...s, inviteOnly: inviteMode, phase: appMatches ? "Drafting" : "WrongApp" };
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function lowerBand(a: AgeBand, b: AgeBand): AgeBand {
  return a === "AgeNotStated" ? b : (b === "AgeNotStated" ? a : (a === "Under13" || b === "Under13" ? "Under13" : (a === "Teen" || b === "Teen" ? "Teen" : "Adult")));
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function canDraftProfile(s: AgentSignup, statedAge: AgeBand): boolean {
  return s.phase === "Drafting" && statedAge !== "AgeNotStated";
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function alwaysUnderThirteenStops(s: AgentSignup): boolean {
  return !(s.age === "Under13") || s.phase === "BelowJoinAge";
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function alwaysMinorToldMatchingIsAdult(s: AgentSignup): boolean {
  return !(s.age === "Teen") || s.minorNotified;
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function alwaysApprovedProfileHasJoinAge(s: AgentSignup): boolean {
  return !(s.approved || s.phase === "AwaitingApproval") || (s.age === "Teen" || s.age === "Adult");
}

/** Story: Join an app without leaving my agent / A stated age under 13 stops the flow, and a minor is told that matching is for adults (spec/agentSignup.md) */
//@ pure
export function draftProfile(s: AgentSignup, statedAge: AgeBand): AgentSignup {
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> stepSavedFollowsConfirmation(s, "draftProfile", \result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> stepFinishedStaysFinished(s, "draftProfile", \result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> stepRetryOnlyAfterCodeProblem(s, "draftProfile", \result)
  const local_3: AgeBand = lowerBand(s.age, statedAge);
  return { ...s, age: local_3, minorNotified: local_3 === "Teen", phase: local_3 === "Under13" ? "BelowJoinAge" : "AwaitingApproval" };
}

/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
//@ pure
export function canDecideApproval(s: AgentSignup): boolean {
  return s.phase === "AwaitingApproval";
}

/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
//@ pure
export function decideApproval(s: AgentSignup, decision: Approval): AgentSignup {
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> stepSavedFollowsConfirmation(s, "decideApproval", \result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> stepFinishedStaysFinished(s, "decideApproval", \result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> stepRetryOnlyAfterCodeProblem(s, "decideApproval", \result)
  return decision === "ApproveExact" ? ({ ...s, approved: true, phase: s.transport === "InAgentCode" ? "CheckingSession" : (s.transport === "ConnectorHandoff" ? "HandedOff" : "HandedToMessages") } as AgentSignup) : (decision === "AskChanges" ? ({ ...s, phase: "Drafting" } as AgentSignup) : ({ ...s, phase: "Declined" } as AgentSignup));
}

/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
//@ pure
export function alwaysNoApprovalBeforeDraftApproved(s: AgentSignup): boolean {
  return !(s.phase === "CheckingCapability" || s.phase === "Unsupported" || s.phase === "ReadingApp" || s.phase === "Drafting" || s.phase === "AwaitingApproval" || s.phase === "Declined") || !s.approved;
}

/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
//@ pure
export function alwaysNothingSentBeforeApproval(s: AgentSignup): boolean {
  return !(!s.approved) || (s.codeStarts === 0 && s.codeChecks === 0 && s.joins === 0 && s.submits === 0);
}

/** Story: Join an app without leaving my agent / Nothing leaves the conversation without explicit approval of the exact profile and text consent (spec/agentSignup.md) */
//@ pure
export function alwaysTextHandoffIsApproved(s: AgentSignup): boolean {
  return !(s.phase === "HandedToMessages") || (s.approved && s.transport === "MessagesHandoff");
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function inCodePath(phase: SignupPhase): boolean {
  return phase === "CheckingSession" || phase === "CheckingAuthMode" || phase === "AwaitingNumber" || phase === "AwaitingCode" || phase === "CodeRejected" || phase === "CodeNotSent" || phase === "ReadingAccount" || phase === "ReadyToJoin" || phase === "ReadingBack";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function canCheckSession(s: AgentSignup): boolean {
  return s.phase === "CheckingSession" && s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function checkSession(s: AgentSignup, sessionLive: boolean): AgentSignup {
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> stepSavedFollowsConfirmation(s, "checkSession", \result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> stepFinishedStaysFinished(s, "checkSession", \result)
  //@ ensures (inv(s) && canCheckSession(s)) ==> stepRetryOnlyAfterCodeProblem(s, "checkSession", \result)
  return { ...s, phase: sessionLive ? "ReadingAccount" : "CheckingAuthMode" };
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function canReadAuthMode(s: AgentSignup): boolean {
  return s.phase === "CheckingAuthMode" && s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function readAuthMode(s: AgentSignup, codeMode: boolean): AgentSignup {
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> stepSavedFollowsConfirmation(s, "readAuthMode", \result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> stepFinishedStaysFinished(s, "readAuthMode", \result)
  //@ ensures (inv(s) && canReadAuthMode(s)) ==> stepRetryOnlyAfterCodeProblem(s, "readAuthMode", \result)
  return { ...s, phase: codeMode ? "AwaitingNumber" : "SignInUnavailable" };
}

/** Story: Join an app without leaving my agent / In the in-agent transport, a live session is reused and only the code sign-in mode continues (spec/agentSignup.md) */
//@ pure
export function alwaysCodePathIsApprovedInAgent(s: AgentSignup): boolean {
  return !inCodePath(s.phase) || (s.approved && s.transport === "InAgentCode");
}

/** Story: Join an app without leaving my agent / The agent requests the code at most once per attempt (spec/agentSignup.md) */
//@ pure
export function startCode(s: AgentSignup, codeStart: CodeStart): AgentSignup {
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canStartCode(s)) ==> stepSavedFollowsConfirmation(s, "startCode", \result)
  //@ ensures (inv(s) && canStartCode(s)) ==> stepFinishedStaysFinished(s, "startCode", \result)
  //@ ensures (inv(s) && canStartCode(s)) ==> stepRetryOnlyAfterCodeProblem(s, "startCode", \result)
  return { ...s, codeStarts: exact_agentSignup(s.codeStarts + 1), phase: codeStart === "CodeSent" ? "AwaitingCode" : (codeStart === "CodeRefused" ? "CodeNotSent" : "SecurityCheckBlocked") };
}

/** Story: Join an app without leaving my agent / The agent requests the code at most once per attempt (spec/agentSignup.md) */
//@ pure
export function alwaysOneCodePerAttempt(s: AgentSignup): boolean {
  return s.codeStarts >= 0 && s.codeStarts <= 1 && s.codeChecks >= 0 && s.codeChecks <= s.codeStarts;
}

/** Story: Join an app without leaving my agent / The agent requests the code at most once per attempt (spec/agentSignup.md) */
//@ pure
export function canStartCode(s: AgentSignup): boolean {
  return s.phase === "AwaitingNumber" && s.transport === "InAgentCode" && s.approved && s.codeStarts === 0;
}

/** Story: Join an app without leaving my agent / The agent checks only the code that the person supplies, once, and only the person starts a new attempt (spec/agentSignup.md) */
//@ pure
export function canCheckCode(s: AgentSignup): boolean {
  return s.phase === "AwaitingCode" && s.transport === "InAgentCode" && s.codeStarts === 1 && s.codeChecks === 0;
}

/** Story: Join an app without leaving my agent / The agent checks only the code that the person supplies, once, and only the person starts a new attempt (spec/agentSignup.md) */
//@ pure
export function checkCode(s: AgentSignup, verified: boolean): AgentSignup {
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> stepSavedFollowsConfirmation(s, "checkCode", \result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> stepFinishedStaysFinished(s, "checkCode", \result)
  //@ ensures (inv(s) && canCheckCode(s)) ==> stepRetryOnlyAfterCodeProblem(s, "checkCode", \result)
  return { ...s, codeChecks: exact_agentSignup(s.codeChecks + 1), phase: verified ? "ReadingAccount" : "CodeRejected" };
}

/** Story: Join an app without leaving my agent / The agent checks only the code that the person supplies, once, and only the person starts a new attempt (spec/agentSignup.md) */
//@ pure
export function canRequestNewCode(s: AgentSignup): boolean {
  return (s.phase === "CodeRejected" || s.phase === "CodeNotSent") && s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / The agent checks only the code that the person supplies, once, and only the person starts a new attempt (spec/agentSignup.md) */
//@ pure
export function requestNewCode(s: AgentSignup): AgentSignup {
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> stepSavedFollowsConfirmation(s, "requestNewCode", \result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> stepFinishedStaysFinished(s, "requestNewCode", \result)
  //@ ensures (inv(s) && canRequestNewCode(s)) ==> stepRetryOnlyAfterCodeProblem(s, "requestNewCode", \result)
  return { ...s, codeStarts: 0, codeChecks: 0, phase: "AwaitingNumber" };
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function approvedAppInvitation(invitation: InvitationEvidence): boolean {
  return invitation.forwarded && invitation.sameApp && invitation.approved;
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function canReadAccount(s: AgentSignup, account: AccountFact): boolean {
  return s.phase === "ReadingAccount" && s.transport === "InAgentCode" && (account !== "InviteRequired" || s.inviteOnly);
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function alwaysInviteGateOnlyForInviteApps(s: AgentSignup): boolean {
  return !(s.phase === "NeedsInvite") || s.inviteOnly;
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function readAccount(s: AgentSignup, account: AccountFact, invitation: InvitationEvidence): AgentSignup {
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> stepSavedFollowsConfirmation(s, "readAccount", \result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> stepFinishedStaysFinished(s, "readAccount", \result)
  //@ ensures (inv(s) && canReadAccount(s, account)) ==> stepRetryOnlyAfterCodeProblem(s, "readAccount", \result)
  const local_4 = approvedAppInvitation(invitation);
  return { ...s, useInvitation: local_4 && (account === "JoinableAccount" || account === "InviteRequired"), phase: account === "OtherAppAccount" ? "WrongApp" : (account === "MemberAccount" ? "ExistingMember" : (account === "HeldForReview" ? "OnReview" : (account === "InviteRequired" && !local_4 ? "NeedsInvite" : "ReadyToJoin"))) };
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function lawInviteGateRequiresApprovedSameAppEvidence(s: AgentSignup, invitation: InvitationEvidence): boolean {
  //@ ensures \result === true
  return (readAccount(s, "InviteRequired", invitation).phase === "ReadyToJoin") === approvedAppInvitation(invitation);
}

/** Story: Join an app without leaving my agent / The account's state decides whether the agent may join (spec/agentSignup.md) */
//@ pure
export function lawOnlyApprovedSameAppEvidenceUsesInvitation(s: AgentSignup, account: AccountFact, invitation: InvitationEvidence): boolean {
  //@ ensures \result === true
  return !readAccount(s, account, invitation).useInvitation || (approvedAppInvitation(invitation) && (account === "JoinableAccount" || account === "InviteRequired"));
}

/** Story: Join an app without leaving my agent / The agent joins once, with the approved profile and the current consent (spec/agentSignup.md) */
//@ pure
export function canJoinApp(s: AgentSignup, joinResult: JoinResult, invitationSubmitted: boolean): boolean {
  return s.phase === "ReadyToJoin" && s.transport === "InAgentCode" && s.approved && s.joins === 0 && invitationSubmitted === s.useInvitation && (joinResult !== "JoinNeedsInvite" || s.inviteOnly) && (joinResult !== "JoinInvalidInvitation" || invitationSubmitted);
}

/** Story: Join an app without leaving my agent / The agent joins once, with the approved profile and the current consent (spec/agentSignup.md) */
//@ pure
export function joinApp(s: AgentSignup, joinResult: JoinResult, invitationSubmitted: boolean): AgentSignup {
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> stepSavedFollowsConfirmation(s, "joinApp", \result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> stepFinishedStaysFinished(s, "joinApp", \result)
  //@ ensures (inv(s) && canJoinApp(s, joinResult, invitationSubmitted)) ==> stepRetryOnlyAfterCodeProblem(s, "joinApp", \result)
  return { ...s, joins: exact_agentSignup(s.joins + 1), phase: joinResult === "JoinCreated" ? "ReadingBack" : (joinResult === "JoinBelowAge" ? "BelowJoinAge" : (joinResult === "JoinNeedsInvite" ? "NeedsInvite" : (joinResult === "JoinInvalidInvitation" ? "InvitationUnavailable" : (joinResult === "JoinHeld" ? "OnReview" : "JoinFailed")))) };
}

/** Story: Join an app without leaving my agent / The agent joins once, with the approved profile and the current consent (spec/agentSignup.md) */
//@ pure
export function alwaysJoinAndSubmitAtMostOnce(s: AgentSignup): boolean {
  return s.joins >= 0 && s.joins <= 1 && s.submits >= 0 && s.submits <= 1 && (!(s.transport === "InAgentCode") || s.submits === 0) && (!(s.transport === "ConnectorHandoff") || (s.codeStarts === 0 && s.codeChecks === 0 && s.joins === 0)) && (!(s.transport === "MessagesHandoff") || (s.codeStarts === 0 && s.codeChecks === 0 && s.joins === 0 && s.submits === 0));
}

/** Story: Join an app without leaving my agent / In-agent success is reported only after the read-back matches the approved profile (spec/agentSignup.md) */
//@ pure
export function canReadBack(s: AgentSignup): boolean {
  return s.phase === "ReadingBack" && s.transport === "InAgentCode" && s.joins === 1;
}

/** Story: Join an app without leaving my agent / In-agent success is reported only after the read-back matches the approved profile (spec/agentSignup.md) */
//@ pure
export function readBack(s: AgentSignup, readBackMatches: boolean): AgentSignup {
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canReadBack(s)) ==> stepSavedFollowsConfirmation(s, "readBack", \result)
  //@ ensures (inv(s) && canReadBack(s)) ==> stepFinishedStaysFinished(s, "readBack", \result)
  //@ ensures (inv(s) && canReadBack(s)) ==> stepRetryOnlyAfterCodeProblem(s, "readBack", \result)
  return { ...s, phase: readBackMatches ? "Saved" : "SavedDiffers" };
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function inConnectorPath(phase: SignupPhase): boolean {
  return phase === "HandedOff" || phase === "ReadyToSubmit" || phase === "ConfirmingProfile";
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function canCheckSiteStatus(s: AgentSignup): boolean {
  return s.phase === "HandedOff" && s.transport === "ConnectorHandoff";
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function checkSiteStatus(s: AgentSignup, siteApp: boolean, siteStatus: SiteStatus): AgentSignup {
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> stepSavedFollowsConfirmation(s, "checkSiteStatus", \result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> stepFinishedStaysFinished(s, "checkSiteStatus", \result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> stepRetryOnlyAfterCodeProblem(s, "checkSiteStatus", \result)
  return { ...s, phase: !siteApp ? "WrongApp" : (siteStatus === "SiteOnboarding" || siteStatus === "SiteActive" ? "ReadyToSubmit" : (siteStatus === "SiteStopped" ? "MessagesStopped" : (siteStatus === "SiteOnHold" ? "OnReview" : "HandedOff"))) };
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function canSubmitProfile(s: AgentSignup): boolean {
  return s.phase === "ReadyToSubmit" && s.transport === "ConnectorHandoff" && s.approved && s.submits === 0;
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function submitProfile(s: AgentSignup, accepted: boolean): AgentSignup {
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> stepSavedFollowsConfirmation(s, "submitProfile", \result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> stepFinishedStaysFinished(s, "submitProfile", \result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> stepRetryOnlyAfterCodeProblem(s, "submitProfile", \result)
  return { ...s, submits: exact_agentSignup(s.submits + 1), phase: accepted ? "ConfirmingProfile" : "ProfileNotSent" };
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function canConfirmProfile(s: AgentSignup): boolean {
  return s.phase === "ConfirmingProfile" && s.transport === "ConnectorHandoff" && s.submits === 1;
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function confirmProfile(s: AgentSignup, stillLive: boolean): AgentSignup {
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNoCredentialsWithoutTransport(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysAppFactsOnlyInAgent(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNoApprovalBeforeDraftApproved(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysCodePathIsApprovedInAgent(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysOneCodePerAttempt(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysInviteGateOnlyForInviteApps(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysJoinAndSubmitAtMostOnce(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysConnectorPathIsApproved(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysCredentialsAskedOnlyAfterApproval(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> stepSavedFollowsConfirmation(s, "confirmProfile", \result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> stepFinishedStaysFinished(s, "confirmProfile", \result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> stepRetryOnlyAfterCodeProblem(s, "confirmProfile", \result)
  return { ...s, phase: stillLive ? "Saved" : "SaveUnconfirmed" };
}

/** Story: Join an app without leaving my agent / In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once (spec/agentSignup.md) */
//@ pure
export function alwaysConnectorPathIsApproved(s: AgentSignup): boolean {
  return !inConnectorPath(s.phase) || (s.approved && s.transport === "ConnectorHandoff");
}

/** Story: Join an app without leaving my agent / The agent asks for the number and the code only in the in-agent transport after approval (spec/agentSignup.md) */
//@ pure
export function askFor(phase: SignupPhase): AgentAsk {
  return phase === "Drafting" ? "AskProfileFacts" : (phase === "AwaitingApproval" ? "AskApproval" : (phase === "AwaitingNumber" ? "AskNumber" : (phase === "AwaitingCode" ? "AskCode" : (phase === "HandedOff" ? "AskToFinishOnSite" : (phase === "HandedToMessages" ? "AskToSendText" : "AskNothing")))));
}

/** Story: Join an app without leaving my agent / The agent asks for the number and the code only in the in-agent transport after approval (spec/agentSignup.md) */
//@ pure
export function alwaysCredentialsAskedOnlyAfterApproval(s: AgentSignup): boolean {
  return !(askFor(s.phase) === "AskNumber" || askFor(s.phase) === "AskCode") || (s.approved && s.transport === "InAgentCode");
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function reportFor(phase: SignupPhase): SignupReport {
  return phase === "Saved" ? "ReportSaved" : (phase === "SavedDiffers" ? "ReportSaveDiffers" : (phase === "SaveUnconfirmed" ? "ReportSaveUnconfirmed" : (phase === "HandedToMessages" ? "ReportSendTheText" : (phase === "ExistingMember" ? "ReportAlreadyMember" : (phase === "BelowJoinAge" ? "ReportUnderAge" : (phase === "NeedsInvite" ? "ReportInviteNeeded" : (phase === "InvitationUnavailable" ? "ReportInviteUnavailable" : (phase === "OnReview" ? "ReportOnHold" : (phase === "MessagesStopped" ? "ReportStopped" : (phase === "Unsupported" || phase === "SignInUnavailable" || phase === "SecurityCheckBlocked" ? "ReportUnsupported" : (phase === "CodeNotSent" || phase === "CodeRejected" ? "ReportCodeProblem" : (phase === "JoinFailed" || phase === "ProfileNotSent" ? "ReportNotSaved" : (phase === "Declined" ? "ReportDeclined" : (phase === "WrongApp" ? "ReportOtherApp" : "ReportWorking"))))))))))))));
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function endReportFor(transport: Transport): SignupReport {
  return transport === "InAgentCode" || transport === "ConnectorHandoff" ? "ReportSaved" : (transport === "MessagesHandoff" ? "ReportSendTheText" : "ReportUnsupported");
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function alwaysSavedNeedsConfirmedSave(s: AgentSignup): boolean {
  return !(s.phase === "Saved") || (s.approved && (s.joins === 1 || s.submits === 1));
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function stepSavedFollowsConfirmation(before: AgentSignup, via: string, after: AgentSignup): boolean {
  return !(after.phase === "Saved" && before.phase !== "Saved") || (via === "readBack" || via === "confirmProfile");
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function retryable(phase: SignupPhase): boolean {
  return phase === "CodeRejected" || phase === "CodeNotSent";
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function finished(phase: SignupPhase): boolean {
  return reportFor(phase) !== "ReportWorking";
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function lawOnlyConfirmedTransportsEndSaved(transport: Transport): boolean {
  //@ ensures \result === true
  return (endReportFor(transport) === "ReportSaved") === (transport === "InAgentCode" || transport === "ConnectorHandoff");
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function lawOnlySavedReportsSuccess(phase: SignupPhase): boolean {
  //@ ensures \result === true
  return (reportFor(phase) === "ReportSaved") === (phase === "Saved");
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function stepFinishedStaysFinished(before: AgentSignup, via: string, after: AgentSignup): boolean {
  return !(finished(before.phase) && !retryable(before.phase)) || equal_agentSignup(after, before);
}

/** Story: Join an app without leaving my agent / The agent reports the true result, and only a confirmed save is reported as saved (spec/agentSignup.md) */
//@ pure
export function stepRetryOnlyAfterCodeProblem(before: AgentSignup, via: string, after: AgentSignup): boolean {
  return !(finished(before.phase) && after.phase !== before.phase) || (retryable(before.phase) && via === "requestNewCode");
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedInAgent(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "InAgentCode";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedThroughConnector(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "ConnectorHandoff";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedDiffers(s: AgentSignup): boolean {
  return s.phase === "SavedDiffers";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSaveUnconfirmed(s: AgentSignup): boolean {
  return s.phase === "SaveUnconfirmed";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesHandedToMessages(s: AgentSignup): boolean {
  return s.phase === "HandedToMessages";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedWithCode(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "InAgentCode" && s.codeChecks === 1;
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedWithSession(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "InAgentCode" && s.codeStarts === 0;
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesExistingMember(s: AgentSignup): boolean {
  return s.phase === "ExistingMember";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesNeedsInvite(s: AgentSignup): boolean {
  return s.phase === "NeedsInvite";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSavedWithForwardedInvite(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.inviteOnly && s.useInvitation;
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesForwardedInviteUnavailable(s: AgentSignup): boolean {
  return s.phase === "InvitationUnavailable";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesOnReview(s: AgentSignup): boolean {
  return s.phase === "OnReview";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesBelowJoinAge(s: AgentSignup): boolean {
  return s.phase === "BelowJoinAge";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesTeenApproved(s: AgentSignup): boolean {
  return s.age === "Teen" && s.approved;
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesUnsupported(s: AgentSignup): boolean {
  return s.phase === "Unsupported";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSignInUnavailable(s: AgentSignup): boolean {
  return s.phase === "SignInUnavailable";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesSecurityCheckBlocked(s: AgentSignup): boolean {
  return s.phase === "SecurityCheckBlocked";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesCodeRejected(s: AgentSignup): boolean {
  return s.phase === "CodeRejected";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesCodeNotSent(s: AgentSignup): boolean {
  return s.phase === "CodeNotSent";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesDeclined(s: AgentSignup): boolean {
  return s.phase === "Declined";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesWrongApp(s: AgentSignup): boolean {
  return s.phase === "WrongApp";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesJoinFailed(s: AgentSignup): boolean {
  return s.phase === "JoinFailed";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesProfileNotSent(s: AgentSignup): boolean {
  return s.phase === "ProfileNotSent";
}

/** Story: Join an app without leaving my agent / A signup can save a profile, hand it to Messages, or stop at a truthful result (spec/agentSignup.md) */
//@ pure
export function sometimesMessagesStopped(s: AgentSignup): boolean {
  return s.phase === "MessagesStopped";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AgentSignup, event: Event): boolean {
  if (event.type === "chooseTransport") return canChooseTransport(current);
  if (event.type === "readAppFacts") return canReadAppFacts(current);
  if (event.type === "draftProfile") return canDraftProfile(current, event.statedAge);
  if (event.type === "decideApproval") return canDecideApproval(current);
  if (event.type === "checkSession") return canCheckSession(current);
  if (event.type === "readAuthMode") return canReadAuthMode(current);
  if (event.type === "startCode") return canStartCode(current);
  if (event.type === "checkCode") return canCheckCode(current);
  if (event.type === "requestNewCode") return canRequestNewCode(current);
  if (event.type === "readAccount") return canReadAccount(current, event.account);
  if (event.type === "joinApp") return canJoinApp(current, event.joinResult, event.invitationSubmitted);
  if (event.type === "readBack") return canReadBack(current);
  if (event.type === "checkSiteStatus") return canCheckSiteStatus(current);
  if (event.type === "submitProfile") return canSubmitProfile(current);
  if (event.type === "confirmProfile") return canConfirmProfile(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AgentSignup, event: Event): AgentSignup {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "chooseTransport" && canChooseTransport(current)) return chooseTransport(current, event.skillKind, event.httpsSession, event.connectorTools);
  if (event.type === "readAppFacts" && canReadAppFacts(current)) return readAppFacts(current, event.appMatches, event.inviteMode);
  if (event.type === "draftProfile" && canDraftProfile(current, event.statedAge)) return draftProfile(current, event.statedAge);
  if (event.type === "decideApproval" && canDecideApproval(current)) return decideApproval(current, event.decision);
  if (event.type === "checkSession" && canCheckSession(current)) return checkSession(current, event.sessionLive);
  if (event.type === "readAuthMode" && canReadAuthMode(current)) return readAuthMode(current, event.codeMode);
  if (event.type === "startCode" && canStartCode(current)) return startCode(current, event.codeStart);
  if (event.type === "checkCode" && canCheckCode(current)) return checkCode(current, event.verified);
  if (event.type === "requestNewCode" && canRequestNewCode(current)) return requestNewCode(current);
  if (event.type === "readAccount" && canReadAccount(current, event.account)) return readAccount(current, event.account, event.invitation);
  if (event.type === "joinApp" && canJoinApp(current, event.joinResult, event.invitationSubmitted)) return joinApp(current, event.joinResult, event.invitationSubmitted);
  if (event.type === "readBack" && canReadBack(current)) return readBack(current, event.readBackMatches);
  if (event.type === "checkSiteStatus" && canCheckSiteStatus(current)) return checkSiteStatus(current, event.siteApp, event.siteStatus);
  if (event.type === "submitProfile" && canSubmitProfile(current)) return submitProfile(current, event.accepted);
  if (event.type === "confirmProfile" && canConfirmProfile(current)) return confirmProfile(current, event.stillLive);
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
  const is_InvitationEvidence = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.forwarded === "boolean" && typeof v.sameApp === "boolean" && typeof v.approved === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "chooseTransport" && (raw.skillKind === "DirectHttpsSkill" || raw.skillKind === "BrowserConnectorSkill") && typeof raw.httpsSession === "boolean" && typeof raw.connectorTools === "boolean") return { type: "chooseTransport", skillKind: raw.skillKind, httpsSession: raw.httpsSession, connectorTools: raw.connectorTools };
  if (raw.type === "readAppFacts" && typeof raw.appMatches === "boolean" && typeof raw.inviteMode === "boolean") return { type: "readAppFacts", appMatches: raw.appMatches, inviteMode: raw.inviteMode };
  if (raw.type === "draftProfile" && (raw.statedAge === "AgeNotStated" || raw.statedAge === "Under13" || raw.statedAge === "Teen" || raw.statedAge === "Adult")) return { type: "draftProfile", statedAge: raw.statedAge };
  if (raw.type === "decideApproval" && (raw.decision === "ApproveExact" || raw.decision === "AskChanges" || raw.decision === "DeclineSignup")) return { type: "decideApproval", decision: raw.decision };
  if (raw.type === "checkSession" && typeof raw.sessionLive === "boolean") return { type: "checkSession", sessionLive: raw.sessionLive };
  if (raw.type === "readAuthMode" && typeof raw.codeMode === "boolean") return { type: "readAuthMode", codeMode: raw.codeMode };
  if (raw.type === "startCode" && (raw.codeStart === "CodeSent" || raw.codeStart === "CodeRefused" || raw.codeStart === "SecurityCheckRequired")) return { type: "startCode", codeStart: raw.codeStart };
  if (raw.type === "checkCode" && typeof raw.verified === "boolean") return { type: "checkCode", verified: raw.verified };
  if (raw.type === "requestNewCode") return { type: "requestNewCode" };
  if (raw.type === "readAccount" && (raw.account === "OtherAppAccount" || raw.account === "MemberAccount" || raw.account === "JoinableAccount" || raw.account === "InviteRequired" || raw.account === "HeldForReview") && is_InvitationEvidence(raw.invitation)) return { type: "readAccount", account: raw.account, invitation: ({ forwarded: raw.invitation.forwarded, sameApp: raw.invitation.sameApp, approved: raw.invitation.approved }) };
  if (raw.type === "joinApp" && (raw.joinResult === "JoinCreated" || raw.joinResult === "JoinBelowAge" || raw.joinResult === "JoinNeedsInvite" || raw.joinResult === "JoinInvalidInvitation" || raw.joinResult === "JoinHeld" || raw.joinResult === "JoinNotSaved") && typeof raw.invitationSubmitted === "boolean") return { type: "joinApp", joinResult: raw.joinResult, invitationSubmitted: raw.invitationSubmitted };
  if (raw.type === "readBack" && typeof raw.readBackMatches === "boolean") return { type: "readBack", readBackMatches: raw.readBackMatches };
  if (raw.type === "checkSiteStatus" && typeof raw.siteApp === "boolean" && (raw.siteStatus === "SiteNotJoined" || raw.siteStatus === "SiteInvited" || raw.siteStatus === "SiteOnboarding" || raw.siteStatus === "SiteActive" || raw.siteStatus === "SiteStopped" || raw.siteStatus === "SiteOnHold")) return { type: "checkSiteStatus", siteApp: raw.siteApp, siteStatus: raw.siteStatus };
  if (raw.type === "submitProfile" && typeof raw.accepted === "boolean") return { type: "submitProfile", accepted: raw.accepted };
  if (raw.type === "confirmProfile" && typeof raw.stillLive === "boolean") return { type: "confirmProfile", stillLive: raw.stillLive };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AgentSignup | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingCapability" || raw.phase === "Unsupported" || raw.phase === "ReadingApp" || raw.phase === "WrongApp" || raw.phase === "Drafting" || raw.phase === "BelowJoinAge" || raw.phase === "AwaitingApproval" || raw.phase === "Declined" || raw.phase === "CheckingSession" || raw.phase === "CheckingAuthMode" || raw.phase === "SignInUnavailable" || raw.phase === "AwaitingNumber" || raw.phase === "CodeNotSent" || raw.phase === "SecurityCheckBlocked" || raw.phase === "AwaitingCode" || raw.phase === "CodeRejected" || raw.phase === "ReadingAccount" || raw.phase === "ReadyToJoin" || raw.phase === "NeedsInvite" || raw.phase === "InvitationUnavailable" || raw.phase === "OnReview" || raw.phase === "JoinFailed" || raw.phase === "ExistingMember" || raw.phase === "ReadingBack" || raw.phase === "Saved" || raw.phase === "SavedDiffers" || raw.phase === "SaveUnconfirmed" || raw.phase === "HandedOff" || raw.phase === "ReadyToSubmit" || raw.phase === "ConfirmingProfile" || raw.phase === "ProfileNotSent" || raw.phase === "MessagesStopped" || raw.phase === "HandedToMessages") && (raw.transport === "TransportUndecided" || raw.transport === "InAgentCode" || raw.transport === "ConnectorHandoff" || raw.transport === "MessagesHandoff" || raw.transport === "NoTransport") && (raw.age === "AgeNotStated" || raw.age === "Under13" || raw.age === "Teen" || raw.age === "Adult") && typeof raw.inviteOnly === "boolean" && typeof raw.useInvitation === "boolean" && typeof raw.approved === "boolean" && typeof raw.minorNotified === "boolean" && Number.isSafeInteger(raw.codeStarts) && Number.isSafeInteger(raw.codeChecks) && Number.isSafeInteger(raw.joins) && Number.isSafeInteger(raw.submits) && Object.keys(raw).length === 11)) return undefined;
  const parsed: AgentSignup = ({ phase: raw.phase, transport: raw.transport, age: raw.age, inviteOnly: raw.inviteOnly, useInvitation: raw.useInvitation, approved: raw.approved, minorNotified: raw.minorNotified, codeStarts: raw.codeStarts, codeChecks: raw.codeChecks, joins: raw.joins, submits: raw.submits });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AgentSignup {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_agentSignup(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_agentSignup(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_agentSignup((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
