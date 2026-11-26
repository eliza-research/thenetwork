// GENERATED from spec/encounterFollowup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
export const maxFollowupDailyCap: number = 3;
/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
export const maxFollowupReminders: number = 2;
/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
export const workIntroFollowupHour: number = 10;
/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
export const followupQuietEndHour: number = 9;
/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
export const followupQuietStartHour: number = 20;
/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
export const followupEveningCutoffHour: number = 16;

/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
//@ pure
export function followupIsNextDay(endLocalHour: number): boolean {
  return endLocalHour > followupEveningCutoffHour;
}

/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
//@ pure
export function computeFollowupLocalHour(endLocalHour: number, isWorkIntro: boolean): number {
  return isWorkIntro ? workIntroFollowupHour : (followupIsNextDay(endLocalHour) ? followupQuietEndHour : (exact_encounterFollowup(endLocalHour + 2) < followupQuietEndHour ? followupQuietEndHour : exact_encounterFollowup(endLocalHour + 2)));
}

/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
//@ pure
export function lawEveningEncounterDefersToNextMorning(endLocalHour: number): boolean {
  //@ ensures \result === true
  return !(endLocalHour > followupEveningCutoffHour) || (followupIsNextDay(endLocalHour) && computeFollowupLocalHour(endLocalHour, false) === followupQuietEndHour);
}

/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
//@ pure
export function lawWorkIntroFollowsUpAtTen(endLocalHour: number): boolean {
  //@ ensures \result === true
  return computeFollowupLocalHour(endLocalHour, true) === workIntroFollowupHour;
}

/** Story: Schedule follow-ups outside quiet hours / Daytime encounters follow up two hours later and evening encounters wait until morning (spec/encounterFollowup.md) */
//@ pure
export function lawFollowupHourOutsideQuietHours(endLocalHour: number, isWorkIntro: boolean): boolean {
  //@ ensures \result === true
  const local_0 = computeFollowupLocalHour(endLocalHour, isWorkIntro);
  return local_0 >= followupQuietEndHour && local_0 < followupQuietStartHour;
}

/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
//@ pure
export function canSendFollowup(optedOut: boolean, isQuietHours: boolean, dailyProactiveCount: number, dailyCap: number, remindersSent: number, maxReminders: number): boolean {
  const local_1 = dailyCap > maxFollowupDailyCap ? maxFollowupDailyCap : dailyCap;
  const local_2 = maxReminders > maxFollowupReminders ? maxFollowupReminders : maxReminders;
  return !optedOut && !isQuietHours && dailyProactiveCount >= 0 && dailyProactiveCount < local_1 && remindersSent >= 0 && remindersSent < local_2;
}

/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
//@ pure
export function lawOptedOutNeverGetsFollowup(isQuietHours: boolean, dailyProactiveCount: number, dailyCap: number, remindersSent: number, maxReminders: number): boolean {
  //@ ensures \result === true
  return !canSendFollowup(true, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders);
}

/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
//@ pure
export function lawQuietHoursNeverSendsFollowup(optedOut: boolean, dailyProactiveCount: number, dailyCap: number, remindersSent: number, maxReminders: number): boolean {
  //@ ensures \result === true
  return !canSendFollowup(optedOut, true, dailyProactiveCount, dailyCap, remindersSent, maxReminders);
}

/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
//@ pure
export function lawDailyCapNeverExceedsThree(optedOut: boolean, isQuietHours: boolean, dailyProactiveCount: number, dailyCap: number, remindersSent: number, maxReminders: number): boolean {
  //@ ensures \result === true
  return !canSendFollowup(optedOut, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders) || (dailyProactiveCount < maxFollowupDailyCap && dailyProactiveCount < dailyCap);
}

/** Story: Enforce opt-out, quiet hours, and message caps before sending / Follow-up dispatch enforces opt-out, quiet hours, daily cap of 3, and reminder cap of 2 (spec/encounterFollowup.md) */
//@ pure
export function lawRemindersNeverExceedTwo(optedOut: boolean, isQuietHours: boolean, dailyProactiveCount: number, dailyCap: number, remindersSent: number, maxReminders: number): boolean {
  //@ ensures \result === true
  return !canSendFollowup(optedOut, isQuietHours, dailyProactiveCount, dailyCap, remindersSent, maxReminders) || (remindersSent < maxFollowupReminders && remindersSent < maxReminders);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_encounterFollowup(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
