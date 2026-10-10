// What an app's engine pack adds to the ConsentNetwork (founder decision 5; the slop, peon and friends
// wiring lives in packages/network/service/packs.ts). The Network keeps every core rule: review
// first, consent first, the leak guard on every text, minors never in a pack's input, blocks,
// STOP and the caps. A hook only supplies app data and app words at fixed points:
//   engineInput   app fields for the pack (slop: verification and zip presence)
//   onboarding    the app's onboarding loop: tags from each answer and the next question or read-back
//                 (slop: the engine's extractSlopProfile -> slopOnboardTags -> readBack / nextQuestion)
//   timeOptions   the first member's time options (slop: the date plan's slots)
//   probe         the anonymous probe text (slop: a date, an age band and a distance band)
//   venue         the meeting place after everyone said yes (slop: a public place near the midpoint)
//   booked        the booked-plan reveal (slop: share-my-date and the check-in)
//   checkIn       the question after the meeting (slop: how it went, and how to report)
//   postings      peon: job posts by text (read back, saved on the manager's yes; jobs.ts)
// Every hook is optional. Without hooks (The Network) nothing changes.
import type { Category, Facet, MemberId } from "@thenetwork/core";
import type { EngineInput } from "@thenetwork/engine";

/** A profile tag the app learned from a member's words. It is kept in the Network's state and goes to the engine as a facet. */
export interface AppTag { tag: string; kind: Facet["kind"]; scope: Facet["scope"]; at: number }

/**
 * An app's onboarding conversation. Its state is plain JSON the Network keeps on the member
 * (MemberState.onboarding) and passes back on every call; the Network never reads inside it.
 */
export interface AppOnboarding {
  /**
   * Read one message from the member. `reasons`: the questions it answers ([] for any other message).
   * Returns the new state, the profile tags learned, and the tag prefixes whose older tags they replace.
   */
  read(state: unknown, body: string, reasons: readonly string[], ctx: { now: number; age?: number }): { state: unknown; tags: AppTag[]; replaces: string[] };
  /** The one next message (a read-back to confirm, or one question); undefined when nothing is left. `skip`: questions not to repeat right away. */
  next(state: unknown, ctx: { age?: number; skip?: readonly string[] }): { reason: string; text: string } | undefined;
  /** The state after questions were sent (the re-ask cap). */
  asked(state: unknown, reasons: readonly string[], ctx: { age?: number }): unknown;
}

/** What a hook sees of one opportunity. */
export interface HookOpp {
  id: string; category: Category; participants: readonly MemberId[]; first?: MemberId;
  /** Slot starts each member picked. */
  picks?: Readonly<Record<MemberId, readonly number[]>>;
  meetingAt?: number;
  /** peon: the job seat the engine proposed (`job:<posting>`) and the hiring manager who answers for it (jobs.ts). */
  seat?: { id: MemberId; manager: MemberId; title?: string };
}

/** A public meeting place. Never a home. */
export interface HookVenue { id: string; name: string; neighborhood: string; lat: number; lng: number }

export interface AppHooks {
  /** The pack's input, from the Network's own (minors are already removed). Pure. */
  engineInput?(input: EngineInput): EngineInput;
  /** The app's onboarding loop; undefined: the Network's own interview and each engine ask's own text. */
  onboarding?: AppOnboarding;
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
  /** peon: hiring managers post, update and close jobs by text in a handled turn, read back and confirmed (jobs.ts). */
  postings?: boolean;
}
