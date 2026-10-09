// What an app's engine pack adds to the ConsentNetwork (founder decision 5; the slop, peon and friends
// wiring lives in packages/network/service/packs.ts). The Network keeps every core rule: review
// first, consent first, the leak guard on every text, minors never in a pack's input, blocks,
// STOP and the caps. A hook only supplies app data and app words at fixed points:
//   engineInput   app fields for the pack (slop: verification and zip presence)
//   askText       one message for every engine ask of one member (slop asks its hard fields together)
//   learn         profile tags from a member's answer (slop: orientation, age range, distance, zip)
//   timeOptions   the first member's time options (slop: the date plan's slots)
//   probe         the anonymous probe text (slop: a date, an age band and a distance band)
//   probePhoto    whose photo may ride on that probe (slop, SLOP_PROBE_PHOTO only; checked again at send time)
//   venue         the meeting place after everyone said yes (slop: a public place near the midpoint)
//   booked        the booked-plan reveal (slop: share-my-date and the check-in)
//   checkIn       the question after the meeting (slop: how it went, and how to report)
// Every hook is optional. Without hooks (The Network) nothing changes.
import type { Category, Facet, MemberId } from "@thenetwork/core";
import type { EngineInput } from "@thenetwork/engine";

/** A profile tag the app learned from a member's words. It is kept in the Network's state and goes to the engine as a facet. */
export interface AppTag { tag: string; kind: Facet["kind"]; scope: Facet["scope"]; at: number }

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
  learn?(body: string, reasons: readonly string[], ctx: { now: number }): { tags: AppTag[]; replaces: string[] };
  /** The first member's time options; undefined: the Network's own (attention.chooseTimeOptions). */
  timeOptions?(o: HookOpp, now: number, input: () => EngineInput): { start: number; end: number }[] | undefined;
  /** The probe text; undefined: the Network's own. */
  probe?(o: HookOpp, id: MemberId, ctx: { times?: string; when: string; input: () => EngineInput }): string | undefined;
  /**
   * The member whose approved photo may ride on this member's probe (slop: the other person, behind
   * SLOP_PROBE_PHOTO); undefined: text only. A reference, not a photo: the service checks both
   * people, the photo and the caption at send time.
   */
  probePhoto?(o: HookOpp, id: MemberId, ctx: { input: () => EngineInput }): MemberId | undefined;
  /** The meeting place; undefined: the Network's own (geo.ts meetingSpot). */
  venue?(o: HookOpp, input: () => EngineInput): HookVenue | undefined;
  /** The booked-plan reveal; undefined: the Network's own. */
  booked?(o: HookOpp, id: MemberId, ctx: { others: string[]; where: string; when: string }): string | undefined;
  /** The question after the meeting; undefined: the Network's own ("How did it go with ...?"). */
  checkIn?(o: HookOpp, id: MemberId, others: string): string | undefined;
  /** Answers to the check-in can file a report about the other person (slop: harassment, lying, a no-show, an unsafe date). */
  postDateReports?: boolean;
}
