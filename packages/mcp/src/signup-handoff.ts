import { canRecordSignupGrant, initial, recordSignupGrant, step, type PhoneHandoff, type SignupConfirmation } from "../../core/src/generated/agentPhoneHandoff.ts";

export const offerHandoff = (approved: boolean): PhoneHandoff => step(initial, { type: "offerSignupHandoff", approved });

export const confirmHandoff = (offered: PhoneHandoff, confirmation: SignupConfirmation): PhoneHandoff =>
  step(offered, { type: "confirmSignupPhone", confirmation });

export const grantHandoff = (stored: PhoneHandoff, appMatches: boolean, ownerMatches: boolean, writeScopeLive: boolean): PhoneHandoff | undefined =>
  canRecordSignupGrant(stored) ? recordSignupGrant(stored, appMatches, ownerMatches, writeScopeLive) : undefined;
