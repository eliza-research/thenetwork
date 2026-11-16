import { DAY } from "./clock.ts";
import { classifyStandingIntent } from "./generated/standingIntent.ts";
import type { Intent } from "./types.ts";

type IntentTiming = Pick<Intent, "status" | "createdAt" | "horizonDays">;

export function standingIntentDeadline(intent: Pick<IntentTiming, "createdAt" | "horizonDays">): number {
  return intent.createdAt + intent.horizonDays * DAY;
}

export function standingIntentPhaseAt(intent: IntentTiming, now: number) {
  return classifyStandingIntent(intent.status, standingIntentDeadline(intent), now);
}

export function standingIntentLive(intent: IntentTiming, now: number): boolean {
  return standingIntentPhaseAt(intent, now) === "IntentLive";
}
