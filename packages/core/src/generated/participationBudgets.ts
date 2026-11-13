// GENERATED from spec/participationBudgets.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Set how often Eliza can offer opportunities / A member's state sets the default initial invite cap (spec/participationBudgets.md:7) */
export interface OutreachBudget { limit: number; periodDays: number }

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md:34) */
export const minorInitialInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 };
/** Story: Receive separately budgeted plans and check-ins / Each separate lane has its own weekly cap (spec/participationBudgets.md:46) */
export const planInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 };
/** Story: Receive separately budgeted plans and check-ins / Each separate lane has its own weekly cap (spec/participationBudgets.md:46) */
export const availabilityCheckInBudget: OutreachBudget = { limit: 1, periodDays: 7 };

/** Story: Set how often Eliza can offer opportunities / A member's state sets the default initial invite cap (spec/participationBudgets.md:7) */
//@ pure
export function initialInviteBudget(participation: string): OutreachBudget {
  return participation === "open" ? ({ limit: 4, periodDays: 7 } as OutreachBudget) : (participation === "quiet" ? ({ limit: 1, periodDays: 30 } as OutreachBudget) : (participation === "paused" ? ({ limit: 0, periodDays: 7 } as OutreachBudget) : ({ limit: 2, periodDays: 7 } as OutreachBudget)));
}

/** Story: Set how often Eliza can offer opportunities / The general unsolicited state lane excludes Receiving and Paused (spec/participationBudgets.md:21) */
//@ pure
export function unsolicitedStateBudget(participation: string): OutreachBudget {
  return participation === "receiving" ? ({ limit: 0, periodDays: 7 } as OutreachBudget) : initialInviteBudget(participation);
}

/** Story: Set how often Eliza can offer opportunities / The general unsolicited state lane excludes Receiving and Paused (spec/participationBudgets.md:21) */
//@ pure
export function lawNoGeneralUnsolicitedBudgetForReceivingOrPaused(participation: string): boolean {
  //@ ensures \result === true
  return !(participation === "receiving" || participation === "paused") || unsolicitedStateBudget(participation).limit === 0;
}
