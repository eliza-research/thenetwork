// What an app's engine pack adds to the ConsentNetwork (founder decision 5; the slop, peon and friends
// wiring lives in packages/network/service/packs.ts). The Network keeps every core rule: review
// first, consent first, the leak guard on every text, minors never in a pack's input, blocks,
// STOP and the caps. A hook only supplies app data and app words at fixed points:
//   engineInput   app fields for the pack (slop: verification and zip presence)
//   askText       one message for every engine ask of one member (slop asks its hard fields together)
//   learn         profile tags from a member's answer (slop: orientation, age range, distance, zip)
//   timeOptions   the first member's time options (slop: the date plan's slots)
//   probe         the anonymous probe text (slop: a date, an age band and a distance band)
//   venue         the meeting place after everyone said yes (slop: a public place near the midpoint)
//   booked        the booked-plan reveal (slop: share-my-date and the check-in)
//   checkIn       the question after the meeting (slop: how it went, and how to report)
//   onboarding    the app's own onboarding questions and read-back (slop: a dating conversation that
//                 collects the hard fields, even while matching is off)
// Every hook is optional. Without hooks (The Network) nothing changes.
import type { Category, Facet, MemberId } from "@thenetwork/core";
import type { EngineInput } from "@thenetwork/engine";
import type { SlopFields } from "./extract.ts";

/**
 * A profile tag the app learned from a member's words. It is kept in the Network's state and goes to the engine as a facet.
 * `provenance` "llm": only the LLM reader read it (the offline parser found nothing for that field).
 */
export interface AppTag { tag: string; kind: Facet["kind"]; scope: Facet["scope"]; at: number; provenance?: "llm" }

/** What a hook sees of one opportunity. */
export interface HookOpp {
  id: string; category: Category; participants: readonly MemberId[]; first?: MemberId;
  /** Slot starts each member picked. */
  picks?: Readonly<Record<MemberId, readonly number[]>>;
  meetingAt?: number;
}

/** A public meeting place. Never a home. */
export interface HookVenue { id: string; name: string; neighborhood: string; lat: number; lng: number }

export interface AppHooks {
  /** The pack's input, from the Network's own (minors are already removed). Pure. */
  engineInput?(input: EngineInput): EngineInput;
  /** One question for all the asks of one member, in the engine's order; undefined: each ask's own text, one at a time. */
  askText?(reasons: readonly string[]): string | undefined;
  /**
   * Tags learned from a member's message. `reasons`: the asks it answers ([] for any other message).
   * `replaces`: tag prefixes whose older tags the new ones replace ("romance:seeks:").
   */
  learn?(body: string, reasons: readonly string[], ctx: { now: number; age?: number }): { tags: AppTag[]; replaces: string[] };
  /**
   * Tags from what the LLM reader read (extract.ts Understood.slop), for fields the offline parser
   * found nothing for in the same message (`parsed`: the tags `learn` returned). Tagged provenance "llm".
   */
  learnUnderstood?(u: SlopFields, parsed: readonly AppTag[], ctx: { now: number }): { tags: AppTag[]; replaces: string[] };
  /** The first member's time options; undefined: the Network's own (attention.chooseTimeOptions). */
  timeOptions?(o: HookOpp, now: number, input: () => EngineInput): { start: number; end: number }[] | undefined;
  /** The probe text; undefined: the Network's own. */
  probe?(o: HookOpp, id: MemberId, ctx: { times?: string; when: string; input: () => EngineInput }): string | undefined;
  /** The meeting place; undefined: the Network's own (geo.ts meetingSpot). */
  venue?(o: HookOpp, input: () => EngineInput): HookVenue | undefined;
  /** The booked-plan reveal; undefined: the Network's own. */
  booked?(o: HookOpp, id: MemberId, ctx: { others: string[]; where: string; when: string }): string | undefined;
  /** The question after the meeting; undefined: the Network's own ("How did it go with ...?"). */
  checkIn?(o: HookOpp, id: MemberId, others: string): string | undefined;
  /** Answers to the check-in can file a report about the other person (slop: harassment, lying, a no-show, an unsafe date). */
  postDateReports?: boolean;
  /** The app's own onboarding for adults; undefined: the Network's three questions. */
  onboarding?: AppOnboarding;
}

/** What onboarding knows about one member: their app tags, the neighborhood, their lowest age, and each step's asks and answers. */
export interface OnboardingState {
  tags: readonly string[]; area?: string; age?: number;
  asked: Readonly<Record<string, number>>; answered: readonly string[];
}

/** One onboarding question. `reasons`: the ask reasons its bare answer is read with (AppHooks.learn). */
export interface OnboardingStep { id: string; text: string; reasons: readonly string[] }

/**
 * An app's onboarding (PRD F4): its questions in order, skipping what is already known, then one
 * read-back of what was learned with a chance to correct it. Every text is the app's own words; the
 * Network sends them with the usual checks (STOP on first contact, quiet hours for the one nudge).
 */
export interface AppOnboarding {
  /** First contact for an adult: who the agent is (an AI), what it remembers and how to see or delete it, STOP, then `question`. */
  welcome(first: string, question: string, inviter?: string): string;
  /** After an adult answered "how old are you?": what it remembers, then `question`. */
  afterAge(question: string): string;
  /** The next question, or undefined when every question is known or was asked enough. Pure. */
  next(s: OnboardingState): OnboardingStep | undefined;
  /** What was learned in plain words (never scores, ratings or safety tags), ending in one question: anything wrong? */
  readBack(s: OnboardingState): string;
  /** The reasons a correction to the read-back is read with. */
  readBackReasons: readonly string[];
  /** The reasons a whole profile (from the member's own AI assistant) is read with. */
  profileReasons: readonly string[];
  /** The member said something is wrong, but nothing could be read from it. */
  fixAsk: string;
  /** The last message of onboarding; `photos`: add the one photo ask (adults only, once). */
  done(photos: boolean): string;
  /** The one nudge to a member silent for a day in the middle of onboarding (`step`: the open question, or "readback"). */
  resume(step: string | undefined): string;
}
