// GENERATED from spec/mcpProfileSubmission.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Recover an agent profile submission without sending it again / Only the first claim can invoke intake for the exact profile and grant (spec/mcpProfileSubmission.md) */
export type ProfileClaim = "ProfileClaimRefused" | "ProfileClaimStart" | "ProfileClaimAccepted" | "ProfileClaimPending";
/** Story: Recover an agent profile submission without sending it again / The Network keeps no copy of the agent's profile text (spec/mcpProfileSubmission.md) */
export type InboundBody = "InboundBodyAgentProfile" | "InboundBodyFeedback" | "InboundBodyText";


/** Story: Recover an agent profile submission without sending it again / Only the first claim can invoke intake for the exact profile and grant (spec/mcpProfileSubmission.md) */
//@ pure
export function decideProfileClaim(liveGrant: boolean, storedClaim: boolean, accepted: boolean): ProfileClaim {
  return !liveGrant ? "ProfileClaimRefused" : (!storedClaim ? "ProfileClaimStart" : (accepted ? "ProfileClaimAccepted" : "ProfileClaimPending"));
}

/** Story: Recover an agent profile submission without sending it again / Only the first claim can invoke intake for the exact profile and grant (spec/mcpProfileSubmission.md) */
//@ pure
export function lawExistingClaimCannotSendAgain(liveGrant: boolean, accepted: boolean): boolean {
  //@ ensures \result === true
  return decideProfileClaim(liveGrant, true, accepted) !== "ProfileClaimStart";
}

/** Story: Recover an agent profile submission without sending it again / Only the first claim can invoke intake for the exact profile and grant (spec/mcpProfileSubmission.md) */
//@ pure
export function lawEndedProfileGrantCannotSend(storedClaim: boolean, accepted: boolean): boolean {
  //@ ensures \result === true
  return decideProfileClaim(false, storedClaim, accepted) === "ProfileClaimRefused";
}

/** Story: Recover an agent profile submission without sending it again / A retry returns confirmed acceptance or holds an unresolved intake (spec/mcpProfileSubmission.md) */
//@ pure
export function profileSubmissionAccepted(claim: ProfileClaim, intakeAccepted: boolean, receiptStored: boolean): boolean {
  return claim === "ProfileClaimAccepted" || (claim === "ProfileClaimStart" && intakeAccepted && receiptStored);
}

/** Story: Recover an agent profile submission without sending it again / A retry returns confirmed acceptance or holds an unresolved intake (spec/mcpProfileSubmission.md) */
//@ pure
export function lawUnresolvedProfileNeverReportsAcceptance(intakeAccepted: boolean, receiptStored: boolean): boolean {
  //@ ensures \result === true
  return !profileSubmissionAccepted("ProfileClaimPending", intakeAccepted, receiptStored);
}

/** Story: Recover an agent profile submission without sending it again / A retry returns confirmed acceptance or holds an unresolved intake (spec/mcpProfileSubmission.md) */
//@ pure
export function lawIntakeMustRecordReceipt(intakeAccepted: boolean): boolean {
  //@ ensures \result === true
  return !profileSubmissionAccepted("ProfileClaimStart", intakeAccepted, false);
}

/** Story: Recover an agent profile submission without sending it again / The Network keeps no copy of the agent's profile text (spec/mcpProfileSubmission.md) */
//@ pure
export function inboundBody(source: string, feedbackAnswer: boolean): InboundBody {
  return source !== "thread" ? "InboundBodyAgentProfile" : (feedbackAnswer ? "InboundBodyFeedback" : "InboundBodyText");
}

/** Story: Recover an agent profile submission without sending it again / The Network keeps no copy of the agent's profile text (spec/mcpProfileSubmission.md) */
//@ pure
export function lawAgentProfileTextNotKept(source: string, feedbackAnswer: boolean): boolean {
  //@ ensures \result === true
  return !(source !== "thread") || inboundBody(source, feedbackAnswer) === "InboundBodyAgentProfile";
}

/** Story: Recover an agent profile submission without sending it again / The Network keeps no copy of the agent's profile text (spec/mcpProfileSubmission.md) */
//@ pure
export function lawFeedbackAnswerTextNotKept(feedbackAnswer: boolean): boolean {
  //@ ensures \result === true
  return !feedbackAnswer || inboundBody("thread", feedbackAnswer) === "InboundBodyFeedback";
}

/** Story: Recover an agent profile submission without sending it again / The Network keeps no copy of the agent's profile text (spec/mcpProfileSubmission.md) */
//@ pure
export function lawThreadTextKept(feedbackAnswer: boolean): boolean {
  //@ ensures \result === true
  return !(!feedbackAnswer) || inboundBody("thread", feedbackAnswer) === "InboundBodyText";
}
