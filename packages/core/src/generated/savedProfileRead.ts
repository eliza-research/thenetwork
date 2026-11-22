// GENERATED from spec/savedProfileRead.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Read my saved profile / An ordinary turn starts without a profile read (spec/savedProfileRead.md) */
export type ReadPhase = "Unclassified" | "AwaitingAuthority" | "UseConversation" | "StaySilent" | "AskWhichApp" | "RefuseOtherProfile" | "DifferentAppLine" | "ShowOwnProfile";
/** Story: Read my saved profile / An ordinary turn starts without a profile read (spec/savedProfileRead.md) */
export type ReadIntent = "OrdinaryTurn" | "OwnRead" | "NamedRead" | "UnclearRead" | "OtherProfile";
/** Story: Read my saved profile / An ordinary turn starts without a profile read (spec/savedProfileRead.md) */
export interface ReadFacts { readForm: boolean; namesProfile: boolean; asksChange: boolean; ownSubject: boolean; endsWithProfile: boolean; hasAppName: boolean; appKnown: boolean }
/** Story: Read my saved profile / An ordinary turn starts without a profile read (spec/savedProfileRead.md) */
export interface ProfileRead { phase: ReadPhase; intent: ReadIntent; sameMember: boolean; optedOut: boolean; requestedAppMatches: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "classifyRead"; facts: ReadFacts }
  | { type: "resolveRead"; sameMember: boolean; optedOut: boolean; requestedAppMatches: boolean };

/** Story: Read my saved profile / Simulation covers the distinct read forms (spec/savedProfileRead.md) */
export const ownProfileFacts: ReadFacts = { readForm: true, namesProfile: true, asksChange: false, ownSubject: true, endsWithProfile: true, hasAppName: false, appKnown: false };
/** Story: Read my saved profile / An ordinary turn starts without a profile read (spec/savedProfileRead.md) */
export const initial: ProfileRead = { phase: "Unclassified", intent: "OrdinaryTurn", sameMember: false, optedOut: false, requestedAppMatches: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ProfileRead): boolean {
  return alwaysOnlyOwnProfileShown(current) && alwaysNoReadReplyWithoutAuthority(current);
}

/** Story: Read my saved profile / Only explicit read requests enter the read path (spec/savedProfileRead.md) */
//@ pure
export function readIntent(facts: ReadFacts): ReadIntent {
  return !facts.readForm || !facts.namesProfile || facts.asksChange ? "OrdinaryTurn" : (!facts.ownSubject ? "OtherProfile" : (!facts.endsWithProfile ? "UnclearRead" : (!facts.hasAppName ? "OwnRead" : (facts.appKnown ? "NamedRead" : "UnclearRead"))));
}

/** Story: Read my saved profile / Only explicit read requests enter the read path (spec/savedProfileRead.md) */
//@ pure
export function canClassifyRead(request: ProfileRead): boolean {
  return request.phase === "Unclassified";
}

/** Story: Read my saved profile / Only explicit read requests enter the read path (spec/savedProfileRead.md) */
//@ pure
export function lawAChangeIsAnOrdinaryTurn(facts: ReadFacts): boolean {
  //@ ensures \result === true
  return !facts.asksChange || readIntent(facts) === "OrdinaryTurn";
}

/** Story: Read my saved profile / Only explicit read requests enter the read path (spec/savedProfileRead.md) */
//@ pure
export function classifyRead(request: ProfileRead, facts: ReadFacts): ProfileRead {
  //@ ensures (inv(request) && canClassifyRead(request)) ==> alwaysOnlyOwnProfileShown(\result)
  //@ ensures (inv(request) && canClassifyRead(request)) ==> alwaysNoReadReplyWithoutAuthority(\result)
  const local_0: ReadIntent = readIntent(facts);
  return { ...request, intent: local_0, phase: local_0 === "OrdinaryTurn" ? "UseConversation" : "AwaitingAuthority" };
}

/** Story: Read my saved profile / Current membership and consent authorize a reply (spec/savedProfileRead.md) */
//@ pure
export function canResolveRead(request: ProfileRead): boolean {
  return request.phase === "AwaitingAuthority";
}

/** Story: Read my saved profile / Current membership and consent authorize a reply (spec/savedProfileRead.md) */
//@ pure
export function resolveRead(request: ProfileRead, sameMember: boolean, optedOut: boolean, requestedAppMatches: boolean): ProfileRead {
  //@ ensures (inv(request) && canResolveRead(request)) ==> alwaysOnlyOwnProfileShown(\result)
  //@ ensures (inv(request) && canResolveRead(request)) ==> alwaysNoReadReplyWithoutAuthority(\result)
  const local_1: ReadPhase = !sameMember || optedOut ? "StaySilent" : (request.intent === "OtherProfile" ? "RefuseOtherProfile" : (request.intent === "UnclearRead" ? "AskWhichApp" : (request.intent === "OwnRead" ? "ShowOwnProfile" : (request.intent === "NamedRead" ? (requestedAppMatches ? "ShowOwnProfile" : "DifferentAppLine") : "StaySilent"))));
  return { ...request, phase: local_1, sameMember: sameMember, optedOut: optedOut, requestedAppMatches: requestedAppMatches };
}

/** Story: Read my saved profile / Only the sender's saved profile for the routed app is shown (spec/savedProfileRead.md) */
//@ pure
export function alwaysOnlyOwnProfileShown(request: ProfileRead): boolean {
  return !(request.phase === "ShowOwnProfile") || (request.sameMember && !request.optedOut && (request.intent === "OwnRead" || (request.intent === "NamedRead" && request.requestedAppMatches)));
}

/** Story: Read my saved profile / Only the sender's saved profile for the routed app is shown (spec/savedProfileRead.md) */
//@ pure
export function alwaysNoReadReplyWithoutAuthority(request: ProfileRead): boolean {
  return !(request.phase === "ShowOwnProfile" || request.phase === "AskWhichApp" || request.phase === "RefuseOtherProfile" || request.phase === "DifferentAppLine") || (request.sameMember && !request.optedOut);
}

/** Story: Read my saved profile / The read can complete, refuse, clarify or remain silent (spec/savedProfileRead.md) */
//@ pure
export function sometimesShowsOwnProfile(request: ProfileRead): boolean {
  return request.phase === "ShowOwnProfile";
}

/** Story: Read my saved profile / The read can complete, refuse, clarify or remain silent (spec/savedProfileRead.md) */
//@ pure
export function sometimesAsksWhichApp(request: ProfileRead): boolean {
  return request.phase === "AskWhichApp";
}

/** Story: Read my saved profile / The read can complete, refuse, clarify or remain silent (spec/savedProfileRead.md) */
//@ pure
export function sometimesRefusesOtherProfile(request: ProfileRead): boolean {
  return request.phase === "RefuseOtherProfile";
}

/** Story: Read my saved profile / The read can complete, refuse, clarify or remain silent (spec/savedProfileRead.md) */
//@ pure
export function sometimesIdentifiesDifferentLine(request: ProfileRead): boolean {
  return request.phase === "DifferentAppLine";
}

/** Story: Read my saved profile / The read can complete, refuse, clarify or remain silent (spec/savedProfileRead.md) */
//@ pure
export function sometimesStaysSilent(request: ProfileRead): boolean {
  return request.phase === "StaySilent";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ProfileRead, event: Event): boolean {
  if (event.type === "classifyRead") return canClassifyRead(current);
  if (event.type === "resolveRead") return canResolveRead(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ProfileRead, event: Event): ProfileRead {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "classifyRead") return canClassifyRead(current) ? classifyRead(current, event.facts) : current;
  if (event.type === "resolveRead") return canResolveRead(current) ? resolveRead(current, event.sameMember, event.optedOut, event.requestedAppMatches) : current;
  return current;
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
  const is_ReadFacts = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.readForm === "boolean" && typeof v.namesProfile === "boolean" && typeof v.asksChange === "boolean" && typeof v.ownSubject === "boolean" && typeof v.endsWithProfile === "boolean" && typeof v.hasAppName === "boolean" && typeof v.appKnown === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "classifyRead" && is_ReadFacts(raw.facts)) return { type: "classifyRead", facts: ({ readForm: raw.facts.readForm, namesProfile: raw.facts.namesProfile, asksChange: raw.facts.asksChange, ownSubject: raw.facts.ownSubject, endsWithProfile: raw.facts.endsWithProfile, hasAppName: raw.facts.hasAppName, appKnown: raw.facts.appKnown }) };
  if (raw.type === "resolveRead" && typeof raw.sameMember === "boolean" && typeof raw.optedOut === "boolean" && typeof raw.requestedAppMatches === "boolean") return { type: "resolveRead", sameMember: raw.sameMember, optedOut: raw.optedOut, requestedAppMatches: raw.requestedAppMatches };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ProfileRead | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unclassified" || raw.phase === "AwaitingAuthority" || raw.phase === "UseConversation" || raw.phase === "StaySilent" || raw.phase === "AskWhichApp" || raw.phase === "RefuseOtherProfile" || raw.phase === "DifferentAppLine" || raw.phase === "ShowOwnProfile") && (raw.intent === "OrdinaryTurn" || raw.intent === "OwnRead" || raw.intent === "NamedRead" || raw.intent === "UnclearRead" || raw.intent === "OtherProfile") && typeof raw.sameMember === "boolean" && typeof raw.optedOut === "boolean" && typeof raw.requestedAppMatches === "boolean" && Object.keys(raw).length === 5)) return undefined;
  const parsed: ProfileRead = ({ phase: raw.phase, intent: raw.intent, sameMember: raw.sameMember, optedOut: raw.optedOut, requestedAppMatches: raw.requestedAppMatches });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ProfileRead {
  //@ ensures inv(\result)
  return initial;
}
