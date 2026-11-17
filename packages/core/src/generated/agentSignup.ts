// GENERATED from spec/agentSignup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type SharedPart as brandIdentity_SharedPart, type LogoMark as brandIdentity_LogoMark, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct } from "./brandIdentity.ts";

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export type SkillKind = "NativeConnectorSkill" | "PeonSkill";
/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export type AgeBand = "AgeNotStated" | "Under13" | "Teen" | "Adult";
/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export type Transport = "TransportUndecided" | "NativeConnectorHandoff" | "ConnectorHandoff" | "MessagesHandoff" | "NoTransport";
/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export type SignupPhase = "CheckingCapability" | "Unsupported" | "ReadingApp" | "WrongApp" | "Drafting" | "BelowJoinAge" | "AwaitingApproval" | "Declined" | "ReadyForHandoff" | "HandedOff" | "CheckingStatus" | "ExistingMember" | "NeedsInvite" | "InvitationUnavailable" | "OnReview" | "MessagesStopped" | "SaveUnconfirmed" | "ReadyToSubmit" | "ConfirmingProfile" | "ProfileNotSent" | "Saved" | "HandedToMessages";
/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export interface AgentSignup { phase: SignupPhase; transport: Transport; age: AgeBand; inviteOnly: boolean; approved: boolean; minorNotified: boolean; handoffs: number; browserEnrolled: boolean; inviteAccepted: boolean; submits: number }
/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
export type Approval = "ApproveExact" | "AskChanges" | "DeclineSignup";
/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
export type BrowserResult = "BrowserNewOpen" | "BrowserNewInvited" | "BrowserExisting" | "BrowserWaiting" | "BrowserWrongApp" | "BrowserBelowAge" | "BrowserNeedsInvite" | "BrowserInvalidInvite" | "BrowserHeld" | "BrowserRefused" | "BrowserChanged";
/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
export type SiteStatus = "SiteNotJoined" | "SiteInvited" | "SiteOnboarding" | "SiteActive" | "SiteStopped" | "SiteOnHold";
/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
export type SignupReport = "ReportWorking" | "ReportSaved" | "ReportSaveUnconfirmed" | "ReportAlreadyMember" | "ReportUnderAge" | "ReportInviteNeeded" | "ReportInviteUnavailable" | "ReportOnHold" | "ReportStopped" | "ReportUnsupported" | "ReportNotSaved" | "ReportDeclined" | "ReportOtherApp" | "ReportSendTheText";

/** One variant per transition in the spec. */
export type Event =
  | { type: "readAppFacts"; appMatches: boolean; inviteMode: boolean }
  | { type: "chooseTransport"; skillKind: SkillKind; connectorTools: boolean }
  | { type: "decideApproval"; decision: Approval }
  | { type: "draftProfile"; statedAge: AgeBand }
  | { type: "offerHandoff"; linkAvailable: boolean }
  | { type: "observeBrowser"; result: BrowserResult; appWriteGrant: boolean }
  | { type: "checkSiteStatus"; siteApp: boolean; siteStatus: SiteStatus }
  | { type: "submitProfile"; accepted: boolean }
  | { type: "confirmProfile"; stillLive: boolean };

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
export const initial: AgentSignup = { phase: "CheckingCapability", transport: "TransportUndecided", age: "AgeNotStated", inviteOnly: false, approved: false, minorNotified: false, handoffs: 0, browserEnrolled: false, inviteAccepted: false, submits: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AgentSignup): boolean {
  return alwaysTransportFixedAfterChoice(current) && alwaysNoTransportStops(current) && alwaysUnderThirteenStops(current) && alwaysMinorToldMatchingIsAdult(current) && alwaysApprovedProfileHasJoinAge(current) && alwaysNothingSentBeforeApproval(current) && alwaysTextHandoffIsApproved(current) && alwaysNoApprovalBeforeDecision(current) && alwaysNativeEnrollmentKeepsInvitationGate(current) && alwaysOneApprovedNativeHandoff(current) && alwaysBrowserStepFollowsHandoff(current) && alwaysOneAuthorizedSubmission(current) && alwaysSavedNeedsConfirmedSave(current) && alwaysExistingMemberKeepsProfile(current) && alwaysNothingSubmittedBeforeSubmit(current);
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function skillKindFor(app: brandIdentity_AppKey): SkillKind {
  return app === "Peon" ? "PeonSkill" : "NativeConnectorSkill";
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function transportFor(skillKind: SkillKind, connectorTools: boolean): Transport {
  return skillKind === "PeonSkill" ? (connectorTools ? "ConnectorHandoff" : "MessagesHandoff") : (connectorTools ? "NativeConnectorHandoff" : "NoTransport");
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function canChooseTransport(s: AgentSignup): boolean {
  return s.phase === "CheckingCapability";
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function alwaysTransportFixedAfterChoice(s: AgentSignup): boolean {
  return (s.phase === "CheckingCapability") === (s.transport === "TransportUndecided");
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function canReadAppFacts(s: AgentSignup): boolean {
  return s.phase === "ReadingApp" && s.transport === "NativeConnectorHandoff";
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function readAppFacts(s: AgentSignup, appMatches: boolean, inviteMode: boolean): AgentSignup {
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> stepSavedFollowsConfirmation(s, "readAppFacts", \result)
  //@ ensures (inv(s) && canReadAppFacts(s)) ==> stepFinishedStaysFinished(s, "readAppFacts", \result)
  return { ...s, inviteOnly: inviteMode, phase: appMatches ? "Drafting" : "WrongApp" };
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function lawNativeSkillRequiresItsConnector(connectorTools: boolean): boolean {
  //@ ensures \result === true
  return (transportFor("NativeConnectorSkill", connectorTools) === "NativeConnectorHandoff") === connectorTools;
}

/** Story: Join through my agent and confirm my own phone / The selected app determines the available transport (spec/agentSignup.md) */
//@ pure
export function chooseTransport(s: AgentSignup, skillKind: SkillKind, connectorTools: boolean): AgentSignup {
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> stepSavedFollowsConfirmation(s, "chooseTransport", \result)
  //@ ensures (inv(s) && canChooseTransport(s)) ==> stepFinishedStaysFinished(s, "chooseTransport", \result)
  const local_0: Transport = transportFor(skillKind, connectorTools);
  return { ...s, transport: local_0, phase: local_0 === "NoTransport" ? "Unsupported" : (local_0 === "NativeConnectorHandoff" ? "ReadingApp" : "Drafting") };
}

/** Story: Join through my agent and confirm my own phone / A client without a transport stops (spec/agentSignup.md) */
//@ pure
export function alwaysNoTransportStops(s: AgentSignup): boolean {
  return !(s.transport === "NoTransport") || s.phase === "Unsupported";
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function lowerBand(a: AgeBand, b: AgeBand): AgeBand {
  return a === "AgeNotStated" ? b : (b === "AgeNotStated" ? a : (a === "Under13" || b === "Under13" ? "Under13" : (a === "Teen" || b === "Teen" ? "Teen" : "Adult")));
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function canDraftProfile(s: AgentSignup, statedAge: AgeBand): boolean {
  return s.phase === "Drafting" && statedAge !== "AgeNotStated";
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function canDecideApproval(s: AgentSignup): boolean {
  return s.phase === "AwaitingApproval";
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function decideApproval(s: AgentSignup, decision: Approval): AgentSignup {
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> stepSavedFollowsConfirmation(s, "decideApproval", \result)
  //@ ensures (inv(s) && canDecideApproval(s)) ==> stepFinishedStaysFinished(s, "decideApproval", \result)
  return decision === "ApproveExact" ? ({ ...s, approved: true, phase: s.transport === "NativeConnectorHandoff" ? "ReadyForHandoff" : (s.transport === "ConnectorHandoff" ? "HandedOff" : "HandedToMessages") } as AgentSignup) : (decision === "AskChanges" ? ({ ...s, phase: "Drafting" } as AgentSignup) : ({ ...s, phase: "Declined" } as AgentSignup));
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function alwaysUnderThirteenStops(s: AgentSignup): boolean {
  return !(s.age === "Under13") || s.phase === "BelowJoinAge";
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function alwaysMinorToldMatchingIsAdult(s: AgentSignup): boolean {
  return !(s.age === "Teen") || s.minorNotified;
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function alwaysApprovedProfileHasJoinAge(s: AgentSignup): boolean {
  return !(s.approved || s.phase === "AwaitingApproval") || (s.age === "Teen" || s.age === "Adult");
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function alwaysNothingSentBeforeApproval(s: AgentSignup): boolean {
  return !(!s.approved) || (s.handoffs === 0 && s.submits === 0);
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function alwaysTextHandoffIsApproved(s: AgentSignup): boolean {
  return !(s.phase === "HandedToMessages") || (s.approved && s.transport === "MessagesHandoff");
}

/** Story: Join through my agent and confirm my own phone / The person approves the exact draft and current text consent (spec/agentSignup.md) */
//@ pure
export function draftProfile(s: AgentSignup, statedAge: AgeBand): AgentSignup {
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> stepSavedFollowsConfirmation(s, "draftProfile", \result)
  //@ ensures (inv(s) && canDraftProfile(s, statedAge)) ==> stepFinishedStaysFinished(s, "draftProfile", \result)
  const local_1: AgeBand = lowerBand(s.age, statedAge);
  return { ...s, age: local_1, minorNotified: local_1 === "Teen", phase: local_1 === "Under13" ? "BelowJoinAge" : "AwaitingApproval" };
}

/** Story: Join through my agent and confirm my own phone / Nothing is approved before the person decides (spec/agentSignup.md) */
//@ pure
export function alwaysNoApprovalBeforeDecision(s: AgentSignup): boolean {
  return !(s.phase === "CheckingCapability" || s.phase === "ReadingApp" || s.phase === "Drafting" || s.phase === "AwaitingApproval") || !s.approved;
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function canOfferHandoff(s: AgentSignup): boolean {
  return s.phase === "ReadyForHandoff" && s.approved && s.transport === "NativeConnectorHandoff" && s.handoffs === 0;
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function offerHandoff(s: AgentSignup, linkAvailable: boolean): AgentSignup {
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> stepSavedFollowsConfirmation(s, "offerHandoff", \result)
  //@ ensures (inv(s) && canOfferHandoff(s)) ==> stepFinishedStaysFinished(s, "offerHandoff", \result)
  return linkAvailable ? ({ ...s, phase: "HandedOff", handoffs: 1 } as AgentSignup) : ({ ...s, phase: "Unsupported" } as AgentSignup);
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function canObserveBrowser(s: AgentSignup, result: BrowserResult): boolean {
  return s.phase === "HandedOff" && s.transport === "NativeConnectorHandoff" && (result !== "BrowserNewOpen" || !s.inviteOnly);
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function alwaysNativeEnrollmentKeepsInvitationGate(s: AgentSignup): boolean {
  return !(s.browserEnrolled && s.inviteOnly) || s.inviteAccepted;
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function alwaysOneApprovedNativeHandoff(s: AgentSignup): boolean {
  return s.handoffs >= 0 && s.handoffs <= 1 && (!(s.handoffs > 0) || (s.approved && s.transport === "NativeConnectorHandoff"));
}

/** Story: Join through my agent and confirm my own phone / The app's browser confirms the owner, enrolls if eligible and asks separately for connector access (spec/agentSignup.md) */
//@ pure
export function observeBrowser(s: AgentSignup, result: BrowserResult, appWriteGrant: boolean): AgentSignup {
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> stepSavedFollowsConfirmation(s, "observeBrowser", \result)
  //@ ensures (inv(s) && canObserveBrowser(s, result)) ==> stepFinishedStaysFinished(s, "observeBrowser", \result)
  const local_2 = result === "BrowserNewOpen" || result === "BrowserNewInvited";
  return { ...s, browserEnrolled: local_2, inviteAccepted: result === "BrowserNewInvited", phase: result === "BrowserWaiting" ? "HandedOff" : (result === "BrowserWrongApp" ? "WrongApp" : (result === "BrowserBelowAge" ? "BelowJoinAge" : (result === "BrowserNeedsInvite" ? "NeedsInvite" : (result === "BrowserInvalidInvite" ? "InvitationUnavailable" : (result === "BrowserHeld" ? "OnReview" : (result === "BrowserRefused" ? "Declined" : (result === "BrowserChanged" || !appWriteGrant ? "SaveUnconfirmed" : "CheckingStatus"))))))) };
}

/** Story: Join through my agent and confirm my own phone / A native browser result follows the one handoff (spec/agentSignup.md) */
//@ pure
export function alwaysBrowserStepFollowsHandoff(s: AgentSignup): boolean {
  return !(s.browserEnrolled || (s.transport === "NativeConnectorHandoff" && s.phase === "HandedOff")) || (s.transport === "NativeConnectorHandoff" && s.handoffs === 1);
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function checkSiteStatus(s: AgentSignup, siteApp: boolean, siteStatus: SiteStatus): AgentSignup {
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> stepSavedFollowsConfirmation(s, "checkSiteStatus", \result)
  //@ ensures (inv(s) && canCheckSiteStatus(s)) ==> stepFinishedStaysFinished(s, "checkSiteStatus", \result)
  return { ...s, phase: !siteApp ? "WrongApp" : (siteStatus === "SiteStopped" ? "MessagesStopped" : (siteStatus === "SiteOnHold" ? "OnReview" : (siteStatus === "SiteOnboarding" || siteStatus === "SiteActive" ? (s.transport === "NativeConnectorHandoff" && !s.browserEnrolled ? "ExistingMember" : "ReadyToSubmit") : (s.transport === "ConnectorHandoff" ? "HandedOff" : "SaveUnconfirmed")))) };
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function canSubmitProfile(s: AgentSignup): boolean {
  return s.phase === "ReadyToSubmit" && s.approved && s.submits === 0 && (s.transport === "ConnectorHandoff" || (s.transport === "NativeConnectorHandoff" && s.browserEnrolled));
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function submitProfile(s: AgentSignup, accepted: boolean): AgentSignup {
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> stepSavedFollowsConfirmation(s, "submitProfile", \result)
  //@ ensures (inv(s) && canSubmitProfile(s)) ==> stepFinishedStaysFinished(s, "submitProfile", \result)
  return { ...s, submits: exact_agentSignup(s.submits + 1), phase: accepted ? "ConfirmingProfile" : "ProfileNotSent" };
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function canConfirmProfile(s: AgentSignup): boolean {
  return s.phase === "ConfirmingProfile" && s.submits === 1;
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function confirmProfile(s: AgentSignup, stillLive: boolean): AgentSignup {
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysTransportFixedAfterChoice(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNoTransportStops(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysUnderThirteenStops(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysMinorToldMatchingIsAdult(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysApprovedProfileHasJoinAge(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNothingSentBeforeApproval(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysTextHandoffIsApproved(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNoApprovalBeforeDecision(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNativeEnrollmentKeepsInvitationGate(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysOneApprovedNativeHandoff(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysBrowserStepFollowsHandoff(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysOneAuthorizedSubmission(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysSavedNeedsConfirmedSave(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysExistingMemberKeepsProfile(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> alwaysNothingSubmittedBeforeSubmit(\result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> stepSavedFollowsConfirmation(s, "confirmProfile", \result)
  //@ ensures (inv(s) && canConfirmProfile(s)) ==> stepFinishedStaysFinished(s, "confirmProfile", \result)
  return { ...s, phase: stillLive ? "Saved" : "SaveUnconfirmed" };
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function alwaysOneAuthorizedSubmission(s: AgentSignup): boolean {
  return s.submits >= 0 && s.submits <= 1 && (!(s.submits > 0) || (s.approved && (s.transport === "ConnectorHandoff" || (s.handoffs === 1 && s.browserEnrolled && s.transport === "NativeConnectorHandoff"))));
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function alwaysSavedNeedsConfirmedSave(s: AgentSignup): boolean {
  return !(s.phase === "Saved") || (s.approved && s.submits === 1);
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function alwaysExistingMemberKeepsProfile(s: AgentSignup): boolean {
  return !(s.phase === "ExistingMember") || (!s.browserEnrolled && s.submits === 0);
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function stepSavedFollowsConfirmation(before: AgentSignup, via: string, after: AgentSignup): boolean {
  return !(after.phase === "Saved" && before.phase !== "Saved") || via === "confirmProfile";
}

/** Story: Join through my agent and confirm my own phone / The connector submits once and reports saved only after the exact durable result (spec/agentSignup.md) */
//@ pure
export function canCheckSiteStatus(s: AgentSignup): boolean {
  return (s.phase === "CheckingStatus" && s.transport === "NativeConnectorHandoff") || (s.phase === "HandedOff" && s.transport === "ConnectorHandoff");
}

/** Story: Join through my agent and confirm my own phone / No profile is sent before the status check allows it (spec/agentSignup.md) */
//@ pure
export function alwaysNothingSubmittedBeforeSubmit(s: AgentSignup): boolean {
  return !(s.phase === "ReadyForHandoff" || s.phase === "HandedOff" || s.phase === "CheckingStatus" || s.phase === "ReadyToSubmit") || s.submits === 0;
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function reportFor(phase: SignupPhase): SignupReport {
  return phase === "Saved" ? "ReportSaved" : (phase === "SaveUnconfirmed" ? "ReportSaveUnconfirmed" : (phase === "HandedToMessages" ? "ReportSendTheText" : (phase === "ExistingMember" ? "ReportAlreadyMember" : (phase === "BelowJoinAge" ? "ReportUnderAge" : (phase === "NeedsInvite" ? "ReportInviteNeeded" : (phase === "InvitationUnavailable" ? "ReportInviteUnavailable" : (phase === "OnReview" ? "ReportOnHold" : (phase === "MessagesStopped" ? "ReportStopped" : (phase === "Unsupported" ? "ReportUnsupported" : (phase === "ProfileNotSent" ? "ReportNotSaved" : (phase === "Declined" ? "ReportDeclined" : (phase === "WrongApp" ? "ReportOtherApp" : "ReportWorking"))))))))))));
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function endReportFor(transport: Transport): SignupReport {
  return transport === "NativeConnectorHandoff" || transport === "ConnectorHandoff" ? "ReportSaved" : (transport === "MessagesHandoff" ? "ReportSendTheText" : "ReportUnsupported");
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesSavedThroughNativeConnector(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "NativeConnectorHandoff" && !s.inviteOnly;
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesSavedWithBrowserInvitation(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "NativeConnectorHandoff" && s.inviteOnly && s.inviteAccepted;
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesSavedThroughPeonConnector(s: AgentSignup): boolean {
  return s.phase === "Saved" && s.transport === "ConnectorHandoff";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesHandedToMessages(s: AgentSignup): boolean {
  return s.phase === "HandedToMessages";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesExistingMember(s: AgentSignup): boolean {
  return s.phase === "ExistingMember";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesUnconfirmed(s: AgentSignup): boolean {
  return s.phase === "SaveUnconfirmed";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesNeedsInvite(s: AgentSignup): boolean {
  return s.phase === "NeedsInvite";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesInvitationUnavailable(s: AgentSignup): boolean {
  return s.phase === "InvitationUnavailable";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesOnReview(s: AgentSignup): boolean {
  return s.phase === "OnReview";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesBelowJoinAge(s: AgentSignup): boolean {
  return s.phase === "BelowJoinAge";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesTeenApproved(s: AgentSignup): boolean {
  return s.age === "Teen" && s.approved;
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesUnsupported(s: AgentSignup): boolean {
  return s.phase === "Unsupported";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesDeclined(s: AgentSignup): boolean {
  return s.phase === "Declined";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesWrongApp(s: AgentSignup): boolean {
  return s.phase === "WrongApp";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesProfileNotSent(s: AgentSignup): boolean {
  return s.phase === "ProfileNotSent";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function sometimesMessagesStopped(s: AgentSignup): boolean {
  return s.phase === "MessagesStopped";
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function lawOnlySavedReportsSuccess(phase: SignupPhase): boolean {
  //@ ensures \result === true
  return (reportFor(phase) === "ReportSaved") === (phase === "Saved");
}

/** Story: Join through my agent and confirm my own phone / Each skill ends with a truthful report (spec/agentSignup.md) */
//@ pure
export function stepFinishedStaysFinished(before: AgentSignup, via: string, after: AgentSignup): boolean {
  return !(reportFor(before.phase) !== "ReportWorking") || equal_agentSignup(after, before);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AgentSignup, event: Event): boolean {
  if (event.type === "readAppFacts") return canReadAppFacts(current);
  if (event.type === "chooseTransport") return canChooseTransport(current);
  if (event.type === "decideApproval") return canDecideApproval(current);
  if (event.type === "draftProfile") return canDraftProfile(current, event.statedAge);
  if (event.type === "offerHandoff") return canOfferHandoff(current);
  if (event.type === "observeBrowser") return canObserveBrowser(current, event.result);
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
  if (event.type === "readAppFacts") return canReadAppFacts(current) ? readAppFacts(current, event.appMatches, event.inviteMode) : current;
  if (event.type === "chooseTransport") return canChooseTransport(current) ? chooseTransport(current, event.skillKind, event.connectorTools) : current;
  if (event.type === "decideApproval") return canDecideApproval(current) ? decideApproval(current, event.decision) : current;
  if (event.type === "draftProfile") return canDraftProfile(current, event.statedAge) ? draftProfile(current, event.statedAge) : current;
  if (event.type === "offerHandoff") return canOfferHandoff(current) ? offerHandoff(current, event.linkAvailable) : current;
  if (event.type === "observeBrowser") return canObserveBrowser(current, event.result) ? observeBrowser(current, event.result, event.appWriteGrant) : current;
  if (event.type === "checkSiteStatus") return canCheckSiteStatus(current) ? checkSiteStatus(current, event.siteApp, event.siteStatus) : current;
  if (event.type === "submitProfile") return canSubmitProfile(current) ? submitProfile(current, event.accepted) : current;
  if (event.type === "confirmProfile") return canConfirmProfile(current) ? confirmProfile(current, event.stillLive) : current;
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
  if (raw.type === "readAppFacts" && typeof raw.appMatches === "boolean" && typeof raw.inviteMode === "boolean") return { type: "readAppFacts", appMatches: raw.appMatches, inviteMode: raw.inviteMode };
  if (raw.type === "chooseTransport" && (raw.skillKind === "NativeConnectorSkill" || raw.skillKind === "PeonSkill") && typeof raw.connectorTools === "boolean") return { type: "chooseTransport", skillKind: raw.skillKind, connectorTools: raw.connectorTools };
  if (raw.type === "decideApproval" && (raw.decision === "ApproveExact" || raw.decision === "AskChanges" || raw.decision === "DeclineSignup")) return { type: "decideApproval", decision: raw.decision };
  if (raw.type === "draftProfile" && (raw.statedAge === "AgeNotStated" || raw.statedAge === "Under13" || raw.statedAge === "Teen" || raw.statedAge === "Adult")) return { type: "draftProfile", statedAge: raw.statedAge };
  if (raw.type === "offerHandoff" && typeof raw.linkAvailable === "boolean") return { type: "offerHandoff", linkAvailable: raw.linkAvailable };
  if (raw.type === "observeBrowser" && (raw.result === "BrowserNewOpen" || raw.result === "BrowserNewInvited" || raw.result === "BrowserExisting" || raw.result === "BrowserWaiting" || raw.result === "BrowserWrongApp" || raw.result === "BrowserBelowAge" || raw.result === "BrowserNeedsInvite" || raw.result === "BrowserInvalidInvite" || raw.result === "BrowserHeld" || raw.result === "BrowserRefused" || raw.result === "BrowserChanged") && typeof raw.appWriteGrant === "boolean") return { type: "observeBrowser", result: raw.result, appWriteGrant: raw.appWriteGrant };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingCapability" || raw.phase === "Unsupported" || raw.phase === "ReadingApp" || raw.phase === "WrongApp" || raw.phase === "Drafting" || raw.phase === "BelowJoinAge" || raw.phase === "AwaitingApproval" || raw.phase === "Declined" || raw.phase === "ReadyForHandoff" || raw.phase === "HandedOff" || raw.phase === "CheckingStatus" || raw.phase === "ExistingMember" || raw.phase === "NeedsInvite" || raw.phase === "InvitationUnavailable" || raw.phase === "OnReview" || raw.phase === "MessagesStopped" || raw.phase === "SaveUnconfirmed" || raw.phase === "ReadyToSubmit" || raw.phase === "ConfirmingProfile" || raw.phase === "ProfileNotSent" || raw.phase === "Saved" || raw.phase === "HandedToMessages") && (raw.transport === "TransportUndecided" || raw.transport === "NativeConnectorHandoff" || raw.transport === "ConnectorHandoff" || raw.transport === "MessagesHandoff" || raw.transport === "NoTransport") && (raw.age === "AgeNotStated" || raw.age === "Under13" || raw.age === "Teen" || raw.age === "Adult") && typeof raw.inviteOnly === "boolean" && typeof raw.approved === "boolean" && typeof raw.minorNotified === "boolean" && Number.isSafeInteger(raw.handoffs) && typeof raw.browserEnrolled === "boolean" && typeof raw.inviteAccepted === "boolean" && Number.isSafeInteger(raw.submits) && Object.keys(raw).length === 10)) return undefined;
  const parsed: AgentSignup = ({ phase: raw.phase, transport: raw.transport, age: raw.age, inviteOnly: raw.inviteOnly, approved: raw.approved, minorNotified: raw.minorNotified, handoffs: raw.handoffs, browserEnrolled: raw.browserEnrolled, inviteAccepted: raw.inviteAccepted, submits: raw.submits });
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
