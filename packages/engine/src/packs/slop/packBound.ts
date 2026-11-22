import {
  type DateGoal, datePackClassCap as classCapOf, datePackClassOf, datePackClassUnstatedMost, datePackPairBound,
} from "../../../../core/src/generated/datePackValue.ts";
import type { SlopPackOptions } from "./options.ts";
import type { SlopProfile } from "./profile.ts";
import { datePackAnswersOf, datePackCheapOf, datePackSeekerOf } from "./score.ts";

const GOALS: readonly DateGoal[] = ["DateGoalCasual", "DateGoalLongTerm", "DateGoalUnsure", "DateGoalUnstated"];
const UNSTATED_COUNTS = datePackClassUnstatedMost + 1;

export function datePackBound(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  return datePackPairBound(datePackSeekerOf(a, o), datePackAnswersOf(b), datePackCheapOf(a, b, o));
}

export function datePackClassKey(b: SlopProfile): number {
  const c = datePackClassOf(datePackAnswersOf(b));
  return GOALS.indexOf(c.goal) * UNSTATED_COUNTS + c.unstated;
}

export function datePackClassCap(a: SlopProfile, classKey: number, untouched: boolean, o: SlopPackOptions): number {
  const goal = GOALS[Math.floor(classKey / UNSTATED_COUNTS)];
  if (goal === undefined || !Number.isInteger(classKey) || classKey < 0) throw new RangeError(`not a Date pack class key: ${classKey}`);
  return classCapOf(datePackSeekerOf(a, o), { goal, unstated: classKey % UNSTATED_COUNTS }, untouched);
}
