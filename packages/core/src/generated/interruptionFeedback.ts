// GENERATED from spec/interruptionFeedback.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
export const interruptionAskUntilMs: number = exact_interruptionFeedback(72 * 3600000);
/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
export const interruptionAnswerMs: number = exact_interruptionFeedback(48 * 3600000);
/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
export const interruptionSampleBuckets: number = 10;
/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
export const interruptionAskWaitMs: number = exact_interruptionFeedback(24 * 3600000);

/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
//@ pure
export function interruptionFeedbackSample(sampleBucket: number, acceptedDelivery: boolean, directReply: boolean, pendingSurvey: boolean): boolean {
  return sampleBucket === 0 && acceptedDelivery && directReply && !pendingSurvey;
}

/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
//@ pure
export function interruptionFeedbackAskDue(ageMs: number, eligible: boolean, openQuestion: boolean): boolean {
  return ageMs >= interruptionAskWaitMs && ageMs < interruptionAskUntilMs && eligible && !openQuestion;
}

/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
//@ pure
export function interruptionFeedbackUsesFollowupSlot(survey: boolean, timingFollowup: boolean): boolean {
  return survey && timingFollowup;
}

/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
//@ pure
export function lawSurveyNeedsDelivery(sampleBucket: number, directReply: boolean, pendingSurvey: boolean): boolean {
  //@ ensures \result === true
  return !interruptionFeedbackSample(sampleBucket, false, directReply, pendingSurvey);
}

/** Story: Tell the Network whether an invitation was worth a text / Sample a confirmed invitation after its own answer (spec/interruptionFeedback.md) */
//@ pure
export function lawSurveyUsesOnlyAnAvailableFollowupSlot(survey: boolean, timingFollowup: boolean): boolean {
  //@ ensures \result === true
  return !interruptionFeedbackUsesFollowupSlot(survey, timingFollowup) || timingFollowup;
}

/** Story: Tell the Network whether an invitation was worth a text / A direct answer measures the interruption once (spec/interruptionFeedback.md) */
//@ pure
export function interruptionFeedbackCurrent(ageMs: number, eligible: boolean): boolean {
  return eligible && ageMs >= 0 && ageMs < interruptionAnswerMs;
}

/** Story: Tell the Network whether an invitation was worth a text / A direct answer measures the interruption once (spec/interruptionFeedback.md) */
//@ pure
export function interruptionFeedbackReply(direct: boolean, exactCode: boolean, surveyCurrent: boolean, reachedMember: boolean): boolean {
  return direct && exactCode && surveyCurrent && reachedMember;
}

/** Story: Tell the Network whether an invitation was worth a text / A direct answer measures the interruption once (spec/interruptionFeedback.md) */
//@ pure
export function lawSurveyReplyNeedsExactCode(direct: boolean, surveyCurrent: boolean, reachedMember: boolean): boolean {
  //@ ensures \result === true
  return !interruptionFeedbackReply(direct, false, surveyCurrent, reachedMember);
}

/** Story: Tell the Network whether an invitation was worth a text / A direct answer measures the interruption once (spec/interruptionFeedback.md) */
//@ pure
export function lawSurveyReplyNeedsDelivery(direct: boolean, exactCode: boolean, surveyCurrent: boolean): boolean {
  //@ ensures \result === true
  return !interruptionFeedbackReply(direct, exactCode, surveyCurrent, false);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_interruptionFeedback(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
