// GENERATED from spec/peonHireDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



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
