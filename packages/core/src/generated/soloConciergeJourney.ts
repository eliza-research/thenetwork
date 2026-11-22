// GENERATED from spec/soloConciergeJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { maxSoloEventOptions as soloConcierge_maxSoloEventOptions, soloReplyHasRoom as soloConcierge_soloReplyHasRoom, soloEventPrecedes as soloConcierge_soloEventPrecedes, soloReplyReplayAllowed as soloConcierge_soloReplyReplayAllowed, soloEventCityAllowed as soloConcierge_soloEventCityAllowed, soloEventEligible as soloConcierge_soloEventEligible, lawTripAwayPreventsLocalSuggestion as soloConcierge_lawTripAwayPreventsLocalSuggestion, lawSoloReplyHoldsAtMostThree as soloConcierge_lawSoloReplyHoldsAtMostThree, lawChangedSoloReplyCannotReplay as soloConcierge_lawChangedSoloReplyCannotReplay, soloEventAgeAllowed as soloConcierge_soloEventAgeAllowed, lawYoungSoloListingsNeedAllAges as soloConcierge_lawYoungSoloListingsNeedAllAges } from "./soloConcierge.ts";
import { type HalfAgeEvidence as memberAge_HalfAgeEvidence } from "./memberAge.ts";

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type Audience = "AdultMember" | "YoungerMember";
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type PublicListing = "NatureWalk" | "ArtTour" | "HistoryTour";
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type PublishedCatalog = "NoPublishedEvents" | "FullCatalog" | "ReducedCatalog";
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type ConciergeReplay = "NoReplay" | "ReplayedAnswer" | "RefusedStaleAnswer";
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type CollectedAnswer =
  | { tag: "NoAnswer" }
  | { tag: "Answered"; listings: PublicListing[] };
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export type ConciergeEffect =
  | { tag: "Recommendations"; listings: PublicListing[] }
  | { tag: "NoFittingEvent" }
  | { tag: "ReplayObserved"; result: ConciergeReplay };
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export interface SoloConciergeJourney { catalog: PublishedCatalog; adultAnswer: CollectedAnswer; youngerAnswer: CollectedAnswer; lastReplay: ConciergeReplay; requests: number; opportunities: number }
/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export interface ConciergeStep { state: SoloConciergeJourney; out: ConciergeEffect[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "publishCatalog"; catalog: PublishedCatalog }
  | { type: "askForIdeas"; who: Audience }
  | { type: "retryIdeas"; who: Audience };

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
export const initial: SoloConciergeJourney = { catalog: "NoPublishedEvents", adultAnswer: ({ tag: "NoAnswer" } as CollectedAnswer), youngerAnswer: ({ tag: "NoAnswer" } as CollectedAnswer), lastReplay: "NoReplay", requests: 0, opportunities: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SoloConciergeJourney): boolean {
  return alwaysSoloDoesNotRecruit(current) && alwaysTheYoungerMemberOnlyReceivesAllAges(current);
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function eligibleListings(catalog: PublishedCatalog, who: Audience): PublicListing[] {
  return catalog === "NoPublishedEvents" ? ([] as PublicListing[]) : (who === "YoungerMember" ? (["NatureWalk"] as PublicListing[]) : (catalog === "FullCatalog" ? (["NatureWalk", "ArtTour", "HistoryTour"] as PublicListing[]) : (["NatureWalk", "HistoryTour"] as PublicListing[])));
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function hasAnswer(a: CollectedAnswer): boolean {
  return a.tag === "NoAnswer" ? false : true;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function answerListsAre(a: CollectedAnswer, listings: PublicListing[]): boolean {
  return a.tag === "Answered" ? equal_soloConciergeJourney(a.listings, listings) : false;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function answerFor(s: SoloConciergeJourney, who: Audience): CollectedAnswer {
  return who === "AdultMember" ? s.adultAnswer : s.youngerAnswer;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function canPublishCatalog(s: SoloConciergeJourney, catalog: PublishedCatalog): boolean {
  return true;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function canAskForIdeas(s: SoloConciergeJourney, who: Audience): boolean {
  return true;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function alwaysSoloDoesNotRecruit(s: SoloConciergeJourney): boolean {
  return s.requests === 0 && s.opportunities === 0;
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function alwaysTheYoungerMemberOnlyReceivesAllAges(s: SoloConciergeJourney): boolean {
  return !hasAnswer(s.youngerAnswer) || answerListsAre(s.youngerAnswer, ([] as PublicListing[])) || answerListsAre(s.youngerAnswer, (["NatureWalk"] as PublicListing[]));
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function sometimesRecommendsThreeEventsToTheAdult(s: SoloConciergeJourney): boolean {
  return answerListsAre(s.adultAnswer, (["NatureWalk", "ArtTour", "HistoryTour"] as PublicListing[]));
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function sometimesRecommendsAnAllAgesEvent(s: SoloConciergeJourney): boolean {
  return answerListsAre(s.youngerAnswer, (["NatureWalk"] as PublicListing[]));
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function sometimesReportsNoFittingEvents(s: SoloConciergeJourney): boolean {
  return answerListsAre(s.adultAnswer, ([] as PublicListing[]));
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function publishCatalog(s: SoloConciergeJourney, catalog: PublishedCatalog): ConciergeStep {
  //@ ensures (inv(s) && canPublishCatalog(s, catalog)) ==> alwaysSoloDoesNotRecruit(\result.state)
  //@ ensures (inv(s) && canPublishCatalog(s, catalog)) ==> alwaysTheYoungerMemberOnlyReceivesAllAges(\result.state)
  return { state: ({ ...s, catalog: catalog } as SoloConciergeJourney), out: ([] as ConciergeEffect[]) };
}

/** Story: Get current public ideas without involving other members / Rank public events and collect the result for the requesting member (spec/soloConciergeJourney.md) */
//@ pure
export function askForIdeas(s: SoloConciergeJourney, who: Audience): ConciergeStep {
  //@ ensures (inv(s) && canAskForIdeas(s, who)) ==> alwaysSoloDoesNotRecruit(\result.state)
  //@ ensures (inv(s) && canAskForIdeas(s, who)) ==> alwaysTheYoungerMemberOnlyReceivesAllAges(\result.state)
  const local_0 = eligibleListings(s.catalog, who);
  const local_1: CollectedAnswer = ({ tag: "Answered", listings: local_0 } as CollectedAnswer);
  return { state: who === "AdultMember" ? ({ ...s, adultAnswer: local_1 } as SoloConciergeJourney) : ({ ...s, youngerAnswer: local_1 } as SoloConciergeJourney), out: ([local_0.length === 0 ? ({ tag: "NoFittingEvent" } as ConciergeEffect) : ({ tag: "Recommendations", listings: local_0 } as ConciergeEffect)] as ConciergeEffect[]) };
}

/** Story: Get current public ideas without involving other members / An exact retry must still have the same answer (spec/soloConciergeJourney.md) */
//@ pure
export function sometimesReplaysACurrentAnswer(s: SoloConciergeJourney): boolean {
  return s.lastReplay === "ReplayedAnswer";
}

/** Story: Get current public ideas without involving other members / An exact retry must still have the same answer (spec/soloConciergeJourney.md) */
//@ pure
export function sometimesRefusesAStaleAnswer(s: SoloConciergeJourney): boolean {
  return s.lastReplay === "RefusedStaleAnswer";
}

/** Story: Get current public ideas without involving other members / An exact retry must still have the same answer (spec/soloConciergeJourney.md) */
//@ pure
export function canRetryIdeas(s: SoloConciergeJourney, who: Audience): boolean {
  return hasAnswer(answerFor(s, who));
}

/** Story: Get current public ideas without involving other members / An exact retry must still have the same answer (spec/soloConciergeJourney.md) */
//@ pure
export function retryIdeas(s: SoloConciergeJourney, who: Audience): ConciergeStep {
  //@ ensures (inv(s) && canRetryIdeas(s, who)) ==> alwaysSoloDoesNotRecruit(\result.state)
  //@ ensures (inv(s) && canRetryIdeas(s, who)) ==> alwaysTheYoungerMemberOnlyReceivesAllAges(\result.state)
  const local_2: CollectedAnswer = answerFor(s, who);
  const local_3 = answerListsAre(local_2, eligibleListings(s.catalog, who));
  const local_4: ConciergeReplay = soloConcierge_soloReplyReplayAllowed(hasAnswer(local_2), local_3) ? "ReplayedAnswer" : "RefusedStaleAnswer";
  return { state: ({ ...s, lastReplay: local_4 } as SoloConciergeJourney), out: ([({ tag: "ReplayObserved", result: local_4 } as ConciergeEffect)] as ConciergeEffect[]) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SoloConciergeJourney, event: Event): boolean {
  if (event.type === "publishCatalog") return canPublishCatalog(current, event.catalog);
  if (event.type === "askForIdeas") return canAskForIdeas(current, event.who);
  if (event.type === "retryIdeas") return canRetryIdeas(current, event.who);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: SoloConciergeJourney, event: Event): ConciergeStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "publishCatalog") return canPublishCatalog(current, event.catalog) ? publishCatalog(current, event.catalog) : { state: current, out: ([] as ConciergeEffect[]) };
  if (event.type === "askForIdeas") return canAskForIdeas(current, event.who) ? askForIdeas(current, event.who) : { state: current, out: ([] as ConciergeEffect[]) };
  if (event.type === "retryIdeas") return canRetryIdeas(current, event.who) ? retryIdeas(current, event.who) : { state: current, out: ([] as ConciergeEffect[]) };
  return { state: current, out: ([] as ConciergeEffect[]) };
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "publishCatalog" && (raw.catalog === "NoPublishedEvents" || raw.catalog === "FullCatalog" || raw.catalog === "ReducedCatalog")) return { type: "publishCatalog", catalog: raw.catalog };
  if (raw.type === "askForIdeas" && (raw.who === "AdultMember" || raw.who === "YoungerMember")) return { type: "askForIdeas", who: raw.who };
  if (raw.type === "retryIdeas" && (raw.who === "AdultMember" || raw.who === "YoungerMember")) return { type: "retryIdeas", who: raw.who };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SoloConciergeJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.catalog === "NoPublishedEvents" || raw.catalog === "FullCatalog" || raw.catalog === "ReducedCatalog") && typeof raw.adultAnswer === "object" && raw.adultAnswer !== null && !Array.isArray(raw.adultAnswer) && (raw.adultAnswer.tag === "NoAnswer" && Object.keys(raw.adultAnswer).length === 1 || raw.adultAnswer.tag === "Answered" && Array.isArray(raw.adultAnswer.listings) && raw.adultAnswer.listings.every((x2: any) => (x2 === "NatureWalk" || x2 === "ArtTour" || x2 === "HistoryTour")) && Object.keys(raw.adultAnswer).length === 2) && typeof raw.youngerAnswer === "object" && raw.youngerAnswer !== null && !Array.isArray(raw.youngerAnswer) && (raw.youngerAnswer.tag === "NoAnswer" && Object.keys(raw.youngerAnswer).length === 1 || raw.youngerAnswer.tag === "Answered" && Array.isArray(raw.youngerAnswer.listings) && raw.youngerAnswer.listings.every((x2: any) => (x2 === "NatureWalk" || x2 === "ArtTour" || x2 === "HistoryTour")) && Object.keys(raw.youngerAnswer).length === 2) && (raw.lastReplay === "NoReplay" || raw.lastReplay === "ReplayedAnswer" || raw.lastReplay === "RefusedStaleAnswer") && Number.isSafeInteger(raw.requests) && Number.isSafeInteger(raw.opportunities) && Object.keys(raw).length === 6)) return undefined;
  const parsed: SoloConciergeJourney = ({ catalog: raw.catalog, adultAnswer: (raw.adultAnswer.tag === "NoAnswer" ? { tag: raw.adultAnswer.tag } : { tag: raw.adultAnswer.tag, listings: raw.adultAnswer.listings.map((x2: any) => x2) }), youngerAnswer: (raw.youngerAnswer.tag === "NoAnswer" ? { tag: raw.youngerAnswer.tag } : { tag: raw.youngerAnswer.tag, listings: raw.youngerAnswer.listings.map((x2: any) => x2) }), lastReplay: raw.lastReplay, requests: raw.requests, opportunities: raw.opportunities });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SoloConciergeJourney {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_soloConciergeJourney(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_soloConciergeJourney((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
