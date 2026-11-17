import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";
import { interruptionSampleBuckets } from "../../core/src/generated/interruptionFeedback.ts";

export interface InterruptionSurvey { opportunityId: string; answeredAt: number; sentAt?: number }
export const interruptionFeedbackPrefix = "interruption-feedback:";

function surveyHash(app: string, memberId: string, opportunityId: string): string {
  return sha256(stableStringify([app, memberId, opportunityId]));
}

export function interruptionSampleBucket(app: string, memberId: string, opportunityId: string): number {
  return Number.parseInt(surveyHash(app, memberId, opportunityId).slice(0, 8), 16) % interruptionSampleBuckets;
}

export function interruptionFeedbackCode(app: string, memberId: string, opportunityId: string): string {
  return [...surveyHash(app, memberId, opportunityId).slice(8, 24)].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join("");
}

export function interruptionFeedbackKey(app: string, memberId: string, opportunityId: string): string {
  return `${interruptionFeedbackPrefix}${interruptionFeedbackCode(app, memberId, opportunityId)}:${memberId}`;
}

export function interruptionFeedbackAnswer(line: string): { worthwhile: boolean; code: string } | undefined {
  const match = /^WORTH (YES|NO) ([a-p]{16})[.!]?$/i.exec(line.trim().replace(/\s+/g, " "));
  if (match) return { worthwhile: match[1]!.toLowerCase() === "yes", code: match[2]!.toLowerCase() };
}
