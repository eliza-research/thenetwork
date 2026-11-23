// GENERATED from spec/groupHost.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: A group that needs a host gets an eligible host / Use the same eligibility to choose and assign the host (spec/groupHost.md) */
//@ pure
export function groupHostEligible(designated: boolean, otherRole: boolean, roleAllowed: boolean): boolean {
  return designated && !otherRole && roleAllowed;
}

/** Story: A group that needs a host gets an eligible host / Use the same eligibility to choose and assign the host (spec/groupHost.md) */
//@ pure
export function lawAHostPassesCurrentRoleEligibility(designated: boolean, otherRole: boolean, roleAllowed: boolean): boolean {
  //@ ensures \result === true
  return !groupHostEligible(designated, otherRole, roleAllowed) || (roleAllowed && !otherRole);
}
