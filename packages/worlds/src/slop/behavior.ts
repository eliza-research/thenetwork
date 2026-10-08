// Persona behaviour for the slop harness: how a simulated member answers a probe and its time
// options, decides on the booked-plan reveal, shows up, gives feedback, asks the agent for dates,
// and how adversaries act (scam scripts, harassment, catfishing, ghosting). Every draw is seeded by
// (world seed, flow key, member), so a run is replayable. Probabilities come from the oracle.
import type { MemberId } from "@thenetwork/core";
import { Rng, hash32 } from "@thenetwork/sim/src/rng.ts";
import { ORACLE_PARAMS, type DateOutcome, type HarmKind, type ProbeContext, type SlopOracle } from "./oracle.ts";

export interface ProbeAnswer {
  replied: boolean; yes: boolean; yesProb: number;
  /** Offered slots the member picked (free ones). Empty + yes = "yes, but not those times". */
  picks: number[]; latencyMin: number;
}
export interface Feedback { replied: boolean; sentiment: "positive" | "neutral" | "negative"; wouldMeetAgain: boolean; rating: number }
export interface HarmEvent { kind: HarmKind; victim: MemberId; offender: MemberId; reported: boolean }

/** P(member asks the agent for a date in a given week) = appetite x ASK_RATE (ask priming). */
export const ASK_RATE = 0.35;
/** P(a member who said yes but had no free offered slot keeps going without a time). */
export const YES_WITHOUT_TIME = 0.6;
/** P(the victim reports a harm to the agent), by kind. A report puts the offender on a safety hold. */
export const REPORT_RATE: Record<HarmKind, number> = {
  offplatform_move: 0.3, money_ask: 0.6, financial_loss: 0.9, catfish_reveal: 0.7, harassment: 0.6, deception: 0.25, minor_contact: 0.3,
};
/** P(two people who both want a second date start seeing each other and pause the app). */
export const PAUSE_AFTER_SECOND = 0.5;

export class SlopBehavior {
  constructor(readonly oracle: SlopOracle, readonly seed: number | string) {}
  private r(...k: (string | number)[]) { return new Rng(hash32(this.seed, "behave", ...k)); }

  /** Inbound ask this week ("find me someone for this weekend"). */
  asksThisWeek(id: MemberId, week: number): boolean {
    const p = this.oracle.p(id);
    if (p.hidden.adversary === "romance_scammer" || p.hidden.adversary === "harasser") return this.r("ask", id, week).bool(0.6);
    return this.r("ask", id, week).bool(this.oracle.weekAppetite(p, week) * ASK_RATE);
  }

  /** Answers a question from the agent (orientation, age range, distance, basics) within the week: p = reply probability. */
  answersAsk(id: MemberId, week: number, field: string): boolean {
    return this.r("ask-answer", id, week, field).bool(this.oracle.p(id).hidden.replyProb);
  }

  /** Answer an anonymous probe with 2-3 time options. */
  answerProbe(id: MemberId, flowKey: string, c: ProbeContext, options: readonly number[]): ProbeAnswer {
    const p = this.oracle.p(id), r = this.r("probe", flowKey, id);
    const yesProb = this.oracle.probeYesProb(id, c);
    const latencyMin = Math.round(r.logNormal(p.hidden.latencyMedianMin, 1));
    if (!r.bool(p.hidden.replyProb)) return { replied: false, yes: false, yesProb, picks: [], latencyMin };
    if (!r.bool(yesProb)) return { replied: true, yes: false, yesProb, picks: [], latencyMin };
    // Adversaries "are free whenever"; everyone else picks the offered slots they are really free for.
    const picks = p.hidden.adversary ? [...options] : this.oracle.freeSlots(id, c.week, options);
    if (!picks.length && !r.bool(YES_WITHOUT_TIME)) return { replied: true, yes: false, yesProb, picks: [], latencyMin };
    return { replied: true, yes: true, yesProb, picks, latencyMin };
  }

  /**
   * Decision on the booked-plan reveal ("You're both in: meet Sam, Thu 7pm near the Mission. Reply
   * if you can't make it."). Silence = in. `statedOk`: the other person is inside this member's
   * stated filters; a matcher that guessed wrong gets a back-out with p = 0.9.
   */
  backsOut(a: MemberId, b: MemberId, flowKey: string, statedOk: boolean, photoNoiseSd?: number): boolean {
    const r = this.r("reveal", flowKey, a);
    if (!statedOk) return r.bool(0.9);
    // Photo already seen in the probe: only the part of the impression the photo did not show is
    // still a surprise at the reveal (1 - rho^2 of it, rho = corr(photo impression, attraction)).
    const left = photoNoiseSd === undefined ? 1 : 1 - 1 / (1 + photoNoiseSd ** 2);
    return r.bool(this.oracle.backoutProb(this.oracle.p(a), this.oracle.p(b)) * left);
  }

  /** The relay classifier sees an adversary's scripted message (scam or hostile) and flags it. */
  relayDetects(offender: MemberId, flowKey: string, recall: number): boolean {
    return this.r("relay", flowKey, offender).bool(recall);
  }
  /** False positive of the relay classifier on an honest member's messages in one revealed flow. */
  relayFalsePositive(id: MemberId, flowKey: string, rate: number): boolean {
    return this.r("relay-fp", flowKey, id).bool(rate);
  }
  /** A member asked "would you consider people up to 25 mi?" agrees (when they answer). */
  agreesToWiden(id: MemberId, week: number, p: number): boolean {
    return this.r("widen", id, week).bool(p);
  }

  /** Shows up to the booked date. `free`: really free at that slot. */
  attends(id: MemberId, flowKey: string, free: boolean): boolean {
    return this.r("show", flowKey, id).bool(this.oracle.showProb(this.oracle.p(id), free));
  }

  /** Post-date feedback ("how was it? want to see them again?"). Ghosters do not answer. */
  feedback(id: MemberId, flowKey: string, o: DateOutcome, side: "a" | "b"): Feedback {
    const p = this.oracle.p(id), r = this.r("feedback", flowKey, id);
    const e = side === "a" ? o.ea : o.eb, want = side === "a" ? o.wantsSecondA : o.wantsSecondB;
    const replied = r.bool(p.hidden.replyProb * 0.9);
    const truthful = r.bool(p.hidden.honesty);
    const wouldMeetAgain = truthful ? want : !want;
    const rating = Math.max(1, Math.min(5, Math.round(1 + 4 * e + r.normal(0, 0.5))));
    return { replied, wouldMeetAgain, rating, sentiment: rating >= 4 ? "positive" : rating <= 2 ? "negative" : "neutral" };
  }

  /** Second date: both want it, then logistics. */
  secondDate(flowKey: string, o: DateOutcome): boolean {
    return o.bothWantSecond && this.r("second", flowKey).bool(ORACLE_PARAMS.secondLogistics);
  }
  /** After a second date the pair may start seeing each other and pause. */
  pausesAfterSecond(id: MemberId, flowKey: string): boolean { return this.r("pause", flowKey, id).bool(PAUSE_AFTER_SECOND); }

  /**
   * Adversary scripts at a stage. Reveal: a scammer moves the chat off-platform and asks for money
   * (some victims pay), a harasser sends unwanted messages; contact with a hidden minor is a harm by
   * itself. Date: a catfish does not match their photos, a not-single member's partner situation
   * comes out. Ghosting is modelled by replyProb and flakiness, not here.
   */
  harms(a: MemberId, b: MemberId, flowKey: string, stage: "reveal" | "date"): HarmEvent[] {
    const out: HarmEvent[] = [];
    for (const h of this.oracle.harms(a, b)) {
      if (h.when !== stage) continue;
      const r = this.r("harm", flowKey, h.kind, h.victim);
      if (!r.bool(h.prob)) continue;
      out.push({ kind: h.kind, victim: h.victim, offender: h.offender, reported: r.bool(REPORT_RATE[h.kind]) });
    }
    return out;
  }
}
