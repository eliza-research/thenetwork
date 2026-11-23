// GENERATED from spec/profileSkillLearning.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Match me using skills I say I have / A sought, quoted or reported skill does not become the member's skill (spec/profileSkillLearning.md) */
//@ pure
export function profileSkillMayLearn(quoted: boolean, anotherPerson: boolean, sought: boolean, ownClaim: boolean): boolean {
  return !(quoted || anotherPerson) && (!sought || ownClaim);
}

/** Story: Match me using skills I say I have / A sought, quoted or reported skill does not become the member's skill (spec/profileSkillLearning.md) */
//@ pure
export function lawQuotedOrReportedSkillsDoNotBind(quoted: boolean, anotherPerson: boolean, sought: boolean, ownClaim: boolean): boolean {
  //@ ensures \result === true
  return !(quoted || anotherPerson) || !profileSkillMayLearn(quoted, anotherPerson, sought, ownClaim);
}

/** Story: Match me using skills I say I have / A sought, quoted or reported skill does not become the member's skill (spec/profileSkillLearning.md) */
//@ pure
export function lawSoughtSkillNeedsOwnClaim(ownClaim: boolean): boolean {
  //@ ensures \result === true
  return profileSkillMayLearn(false, false, true, ownClaim) === ownClaim;
}
