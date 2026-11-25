import { canCheckSiteStatus, checkSiteStatus, initial, step, type PhoneHandoff } from "../../core/src/generated/agentPhoneHandoff.ts";

export interface SignupConfirmation {
  sameApp: boolean;
  ownerVerified: boolean;
  eligibleEnrollment: boolean;
  requestLive: boolean;
}

export const offerHandoff = (approved: boolean): PhoneHandoff => {
  const decided = step(initial, { type: "decideApproval", decision: approved ? "ApproveExact" : "DeclineSignup" });
  return approved ? step(decided, { type: "offerHandoff", linkAvailable: true }) : decided;
};

export const confirmHandoff = (offered: PhoneHandoff, confirmation: SignupConfirmation): PhoneHandoff =>
  confirmation.sameApp && confirmation.ownerVerified && confirmation.eligibleEnrollment && confirmation.requestLive
    ? step(offered, { type: "observeBrowser" })
    : offered;

export const grantHandoff = (stored: PhoneHandoff, appMatches: boolean, ownerMatches: boolean, writeScopeLive: boolean): PhoneHandoff | undefined =>
  canCheckSiteStatus(stored) ? checkSiteStatus(stored, appMatches && ownerMatches && writeScopeLive) : undefined;
