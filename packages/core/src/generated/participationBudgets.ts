// GENERATED from spec/participationBudgets.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Set how often Eliza can offer opportunities / A member's state sets the default initial invite cap (spec/participationBudgets.md) */
export interface OutreachBudget { limit: number; periodDays: number }

/** Story: Receive separately budgeted plans and check-ins / Each separate lane has its own weekly cap (spec/participationBudgets.md) */
export const planInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 };
/** Story: Receive separately budgeted plans and check-ins / Each separate lane has its own weekly cap (spec/participationBudgets.md) */
export const availabilityCheckInBudget: OutreachBudget = { limit: 1, periodDays: 7 };
/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
export const minorInitialInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 };

/** Story: Set how often Eliza can offer opportunities / A member's state sets the default initial invite cap (spec/participationBudgets.md) */
//@ pure
export function initialInviteBudget(participation: string): OutreachBudget {
  return participation === "open" ? ({ limit: 4, periodDays: 7 } as OutreachBudget) : (participation === "quiet" ? ({ limit: 1, periodDays: 30 } as OutreachBudget) : (participation === "paused" ? ({ limit: 0, periodDays: 7 } as OutreachBudget) : ({ limit: 2, periodDays: 7 } as OutreachBudget)));
}

/** Story: Set how often Eliza can offer opportunities / The general unsolicited state lane excludes Receiving and Paused (spec/participationBudgets.md) */
//@ pure
export function unsolicitedStateBudget(participation: string): OutreachBudget {
  return participation === "receiving" ? ({ limit: 0, periodDays: 7 } as OutreachBudget) : initialInviteBudget(participation);
}

/** Story: Set how often Eliza can offer opportunities / The general unsolicited state lane excludes Receiving and Paused (spec/participationBudgets.md) */
//@ pure
export function lawNoGeneralUnsolicitedBudgetForReceivingOrPaused(participation: string): boolean {
  //@ ensures \result === true
  return !(participation === "receiving" || participation === "paused") || unsolicitedStateBudget(participation).limit === 0;
}

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
//@ pure
export function stricterInviteBudget(first: OutreachBudget, second: OutreachBudget): OutreachBudget {
  return exact_participationBudgets(first.limit * second.periodDays) < exact_participationBudgets(second.limit * first.periodDays) ? first : second;
}

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
//@ pure
export function minorInviteBudget(participation: string): OutreachBudget {
  return stricterInviteBudget(minorInitialInviteBudget, initialInviteBudget(participation));
}

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
//@ pure
export function lawMinorKeepsQuietBudget(participation: string): boolean {
  //@ ensures \result === true
  return !(participation === "quiet") || equal_participationBudgets(minorInviteBudget(participation), ({ limit: 1, periodDays: 30 } as OutreachBudget));
}

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
//@ pure
export function lawPausedMinorGetsNoInvites(participation: string): boolean {
  //@ ensures \result === true
  return !(participation === "paused") || minorInviteBudget(participation).limit === 0;
}

/** Story: Set how often Eliza can offer opportunities / A minor's solo offers have a smaller default cap (spec/participationBudgets.md) */
//@ pure
export function lawMinorNeverAboveOneInvite(participation: string): boolean {
  //@ ensures \result === true
  return minorInviteBudget(participation).limit <= 1;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_participationBudgets(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_participationBudgets(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_participationBudgets((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
