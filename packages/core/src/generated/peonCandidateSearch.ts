// GENERATED from spec/peonCandidateSearch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
export const peonSearchRoles: string[] = ["software_engineer", "data_analyst", "accountant", "registered_nurse", "customer_support", "sales_rep", "warehouse_logistics"];
/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
export const peonSearchSkills: string[] = ["javascript", "python", "system_design", "sql", "cloud", "testing", "statistics", "excel", "tableau", "machine_learning", "gaap", "reconciliation", "tax", "quickbooks", "audit", "patient_care", "medication_admin", "ehr", "triage", "iv_therapy", "care_planning", "communication", "crm", "ticketing", "deescalation", "troubleshooting", "prospecting", "negotiation", "closing", "account_management", "inventory", "shipping", "safety_compliance", "forklift", "scheduling", "cdl_driving"];
/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
export const peonSearchAreas: string[] = ["manhattan", "brooklyn", "queens", "bronx", "jersey_city", "san_francisco", "oakland", "east_bay", "peninsula", "south_bay"];
/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
export const peonSearchModes: string[] = ["remote", "hybrid", "onsite"];
/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
export const peonSearchDraftMs: number = 900000;
/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
export const peonSearchHorizonDays: number = 90;

/** Story: Tell Peon what work to look for / Only the current adult Peon member can manage this search (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchOwner(appName: string, signedDirect: boolean, liveAccount: boolean, adult: boolean, workAllowed: boolean): boolean {
  return appName === "peon" && signedDirect && liveAccount && adult && workAllowed;
}

/** Story: Tell Peon what work to look for / Only the current adult Peon member can manage this search (spec/peonCandidateSearch.md) */
//@ pure
export function lawPeonSearchRequiresCurrentAdult(liveAccount: boolean, adult: boolean, workAllowed: boolean): boolean {
  //@ ensures \result === true
  return !peonSearchOwner("peon", true, liveAccount, adult, workAllowed) || (liveAccount && adult && workAllowed);
}

/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchTermsAllowed(roleKnown: boolean, level: number, floorCents: number, hasMode: boolean, needsArea: boolean, hasArea: boolean): boolean {
  return roleKnown && level >= 1 && level <= 5 && floorCents >= 0 && floorCents <= 99900000 && hasMode && (!needsArea || hasArea);
}

/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchSkillAllowed(skillKnown: boolean, level: number): boolean {
  return skillKnown && level >= 0 && level <= 5;
}

/** Story: Tell Peon what work to look for / Use the local hiring catalogue and the stated work terms (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchStartAllowed(weeks: number): boolean {
  return weeks >= 0 && weeks <= 52;
}

/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchTurnCurrent(received: number, at: number): boolean {
  return received >= 0 && received <= at && exact_peonCandidateSearch(at - received) < peonSearchDraftMs;
}

/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
//@ pure
export function peonSearchConfirmable(sameReference: boolean, staged: number, received: number, at: number): boolean {
  return sameReference && staged >= 0 && staged <= received && received <= at && exact_peonCandidateSearch(at - staged) < peonSearchDraftMs;
}

/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
//@ pure
export function lawOldPeonSearchReferenceCannotSave(staged: number, received: number, at: number): boolean {
  //@ ensures \result === true
  return !peonSearchConfirmable(false, staged, received, at);
}

/** Story: Tell Peon what work to look for / Read back the whole draft and accept only its exact confirmation (spec/peonCandidateSearch.md) */
//@ pure
export function lawExpiredPeonSearchCannotSave(staged: number, received: number): boolean {
  //@ ensures \result === true
  return !peonSearchConfirmable(true, staged, received, exact_peonCandidateSearch(staged + peonSearchDraftMs));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_peonCandidateSearch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
