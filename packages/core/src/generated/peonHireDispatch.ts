// GENERATED from spec/peonHireDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Stay in charge of a Peon job search / A closed application keeps its recorded answers (spec/peonHireDispatch.md) */
export type HireProbeHistory = "HireProbeUnrecorded" | "HireProbeAccepted" | "HireProbeDeclined";


/** Story: Stay in charge of a Peon job search / A review covers this candidate search and these posting terms (spec/peonHireDispatch.md) */
//@ pure
export function hireEvidenceCurrent(searchActive: boolean, sameSearch: boolean, samePosting: boolean, employerVerified: boolean, companyAllowed: boolean): boolean {
  return searchActive && sameSearch && samePosting && employerVerified && companyAllowed;
}

/** Story: Stay in charge of a Peon job search / A review covers this candidate search and these posting terms (spec/peonHireDispatch.md) */
//@ pure
export function lawHireWithdrawalBlocksContact(sameSearch: boolean, samePosting: boolean, employerVerified: boolean, companyAllowed: boolean): boolean {
  //@ ensures \result === true
  return !hireEvidenceCurrent(false, sameSearch, samePosting, employerVerified, companyAllowed);
}

/** Story: Stay in charge of a Peon job search / A review covers this candidate search and these posting terms (spec/peonHireDispatch.md) */
//@ pure
export function lawHireCompanyExclusionBlocksContact(searchActive: boolean, sameSearch: boolean, samePosting: boolean, employerVerified: boolean): boolean {
  //@ ensures \result === true
  return !hireEvidenceCurrent(searchActive, sameSearch, samePosting, employerVerified, false);
}

/** Story: Stay in charge of a Peon job search / An employer hears only after the candidate accepts (spec/peonHireDispatch.md) */
//@ pure
export function hireAnswerAllowed(direct: boolean, delivered: boolean, receivedAt: number, deliveredAt: number, at: number, deadline: number): boolean {
  return direct && delivered && receivedAt >= deliveredAt && receivedAt <= at && at < deadline;
}

/** Story: Stay in charge of a Peon job search / An employer hears only after the candidate accepts (spec/peonHireDispatch.md) */
//@ pure
export function hireContactAllowed(evidenceCurrent: boolean, reviewed: boolean, phaseCurrent: boolean, employerProbe: boolean, reveal: boolean, candidateYes: boolean, employerYes: boolean): boolean {
  return evidenceCurrent && reviewed && phaseCurrent && (!(employerProbe || reveal) || candidateYes) && (!reveal || employerYes);
}

/** Story: Stay in charge of a Peon job search / An employer hears only after the candidate accepts (spec/peonHireDispatch.md) */
//@ pure
export function lawEmployerCannotBeContactedFirst(evidenceCurrent: boolean, reviewed: boolean, phaseCurrent: boolean, employerYes: boolean): boolean {
  //@ ensures \result === true
  return !hireContactAllowed(evidenceCurrent, reviewed, phaseCurrent, true, false, false, employerYes);
}

/** Story: Stay in charge of a Peon job search / An employer hears only after the candidate accepts (spec/peonHireDispatch.md) */
//@ pure
export function lawHireAnswerRequiresDelivery(direct: boolean, receivedAt: number, deliveredAt: number, at: number, deadline: number): boolean {
  //@ ensures \result === true
  return !hireAnswerAllowed(direct, false, receivedAt, deliveredAt, at, deadline);
}

/** Story: Stay in charge of a Peon job search / A closed application keeps its recorded answers (spec/peonHireDispatch.md) */
//@ pure
export function hireProbeWasDeclined(existingDecline: boolean, recordedDecline: boolean): boolean {
  return existingDecline || recordedDecline;
}

/** Story: Stay in charge of a Peon job search / A closed application keeps its recorded answers (spec/peonHireDispatch.md) */
//@ pure
export function hireClosedProbeReply(answer: string): HireProbeHistory {
  return answer === "yes" ? "HireProbeAccepted" : (answer === "no" ? "HireProbeDeclined" : "HireProbeUnrecorded");
}

/** Story: Stay in charge of a Peon job search / A closed application keeps its recorded answers (spec/peonHireDispatch.md) */
//@ pure
export function lawUnrecordedHireReplyAddsNoAttribution(answer: string): boolean {
  //@ ensures \result === true
  return !(!(answer === "yes" || answer === "no")) || hireClosedProbeReply(answer) === "HireProbeUnrecorded";
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function managerQuestionMayOpen(postingOwnsSlot: boolean, otherProbeOwnsSlot: boolean, olderManagerProbeWaiting: boolean): boolean {
  return !(postingOwnsSlot || otherProbeOwnsSlot || olderManagerProbeWaiting);
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function managerQuestionDeliveryCurrent(managerProbe: boolean, sameOpportunity: boolean, sameDelivery: boolean): boolean {
  return !managerProbe || (sameOpportunity && sameDelivery);
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function managerQuestionDeadline(opportunityDeadline: number, originalStaged: boolean, originalStageAt: number, responseMs: number): number {
  const local_0 = exact_peonHireDispatch(originalStageAt + responseMs);
  return originalStaged && local_0 < opportunityDeadline ? local_0 : opportunityDeadline;
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function lawPostingOwnsManagerAnswer(otherProbeOwnsSlot: boolean, olderManagerProbeWaiting: boolean): boolean {
  //@ ensures \result === true
  return !managerQuestionMayOpen(true, otherProbeOwnsSlot, olderManagerProbeWaiting);
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function lawDisplacedManagerProbeCannotLeave(sameOpportunity: boolean): boolean {
  //@ ensures \result === true
  return !managerQuestionDeliveryCurrent(true, sameOpportunity, false);
}

/** Story: Stay in charge of a Peon job search / A manager answers one hiring question at a time (spec/peonHireDispatch.md) */
//@ pure
export function lawManagerQuestionKeepsDeadline(opportunityDeadline: number, originalStageAt: number, responseMs: number): boolean {
  //@ ensures \result === true
  return managerQuestionDeadline(opportunityDeadline, true, originalStageAt, responseMs) <= opportunityDeadline && managerQuestionDeadline(opportunityDeadline, true, originalStageAt, responseMs) <= exact_peonHireDispatch(originalStageAt + responseMs);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_peonHireDispatch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
