import { initial, step, validSignupConfirmation, type PhoneHandoff, type SignupConfirmation } from "../../core/src/generated/agentPhoneHandoff.ts";

export const offerHandoff = (approved: boolean): PhoneHandoff => step(initial, { type: "offerSignupHandoff", approved });

export const confirmHandoff = (offered: PhoneHandoff, confirmation: SignupConfirmation): PhoneHandoff =>
  step(offered, { type: "confirmSignupPhone", confirmation });

export const enrolledHandoff: PhoneHandoff = confirmHandoff(offerHandoff(true), validSignupConfirmation);

export const grantHandoff = (appMatches: boolean, ownerMatches: boolean, writeScopeLive: boolean): PhoneHandoff =>
  step(enrolledHandoff, { type: "recordSignupGrant", appMatches, ownerMatches, writeScopeLive });
