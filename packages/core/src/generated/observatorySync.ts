// GENERATED from spec/observatorySync.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: See the selected app and mode / Changing the view invalidates the old snapshot and pending reads (spec/observatorySync.md:9) */
export type SnapshotPhase = "Unsynced" | "Loading" | "Live";
/** Story: See the selected app and mode / Changing the view invalidates the old snapshot and pending reads (spec/observatorySync.md:9) */
export interface ObservatorySync { appName: string; viewMode: string; generation: number; phase: SnapshotPhase; version: number }
/** Story: Follow live updates without replaying changes / Only the next data version can change the view (spec/observatorySync.md:60) */
export type DeltaAction = "BufferDelta" | "ReloadSnapshot" | "DropDelta" | "RefreshMetadata" | "ApplyData";

/** One variant per transition in the spec. */
export type Event =
  | { type: "changeView"; appName: string; viewMode: string }
  | { type: "publishSnapshot"; generation: number; appName: string; viewMode: string; version: number }
  | { type: "failLoad"; generation: number }
  | { type: "startLoad" }
  | { type: "acceptDelta"; version: number };

/** Story: See the selected app and mode / Changing the view invalidates the old snapshot and pending reads (spec/observatorySync.md:9) */
export const initial: ObservatorySync = { appName: "ntwrk", viewMode: "game", generation: 0, phase: "Unsynced", version: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ObservatorySync): boolean {
  return true;
}

/** Story: See the selected app and mode / Changing the view invalidates the old snapshot and pending reads (spec/observatorySync.md:9) */
//@ pure
export function canChangeView(s: ObservatorySync, appName: string, viewMode: string): boolean {
  return appName !== s.appName || viewMode !== s.viewMode;
}

/** Story: See the selected app and mode / Changing the view invalidates the old snapshot and pending reads (spec/observatorySync.md:9) */
//@ pure
export function changeView(s: ObservatorySync, appName: string, viewMode: string): ObservatorySync {
  //@ ensures (inv(s) && canChangeView(s, appName, viewMode)) ==> stepReadGenerationNeverFalls(s, \result)
  //@ ensures (inv(s) && canChangeView(s, appName, viewMode)) ==> stepDeltasAdvanceOneVersion(s, "changeView", \result)
  return { appName: appName, viewMode: viewMode, generation: s.generation + 1, phase: "Unsynced", version: 0 };
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function ownsLoad(s: ObservatorySync, generation: number): boolean {
  return s.phase === "Loading" && s.generation === generation;
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function publishSnapshot(s: ObservatorySync, generation: number, appName: string, viewMode: string, version: number): ObservatorySync {
  //@ ensures (inv(s) && canPublishSnapshot(s, generation, appName, viewMode)) ==> stepReadGenerationNeverFalls(s, \result)
  //@ ensures (inv(s) && canPublishSnapshot(s, generation, appName, viewMode)) ==> stepDeltasAdvanceOneVersion(s, "publishSnapshot", \result)
  return { ...s, phase: "Live", version: version };
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function failLoad(s: ObservatorySync, generation: number): ObservatorySync {
  //@ ensures (inv(s) && canFailLoad(s, generation)) ==> stepReadGenerationNeverFalls(s, \result)
  //@ ensures (inv(s) && canFailLoad(s, generation)) ==> stepDeltasAdvanceOneVersion(s, "failLoad", \result)
  return { ...s, phase: "Unsynced" };
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function stepReadGenerationNeverFalls(before: ObservatorySync, after: ObservatorySync): boolean {
  return after.generation >= before.generation;
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function sometimesSnapshotIsLive(s: ObservatorySync): boolean {
  return s.phase === "Live";
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function startLoad(s: ObservatorySync): ObservatorySync {
  //@ ensures (inv(s)) ==> stepReadGenerationNeverFalls(s, \result)
  //@ ensures (inv(s)) ==> stepDeltasAdvanceOneVersion(s, "startLoad", \result)
  return { ...s, generation: s.generation + 1, phase: "Loading" };
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function canPublishSnapshot(s: ObservatorySync, generation: number, appName: string, viewMode: string): boolean {
  return ownsLoad(s, generation) && s.appName === appName && s.viewMode === viewMode;
}

/** Story: See the selected app and mode / Only the current load can publish or fail a snapshot (spec/observatorySync.md:30) */
//@ pure
export function canFailLoad(s: ObservatorySync, generation: number): boolean {
  return ownsLoad(s, generation);
}

/** Story: Follow live updates without replaying changes / Only the next data version can change the view (spec/observatorySync.md:60) */
//@ pure
export function deltaAction(s: ObservatorySync, version: number, resetSignal: boolean): DeltaAction {
  return resetSignal ? "ReloadSnapshot" : (s.phase === "Loading" ? "BufferDelta" : (s.phase === "Unsynced" ? "ReloadSnapshot" : (version < s.version ? "DropDelta" : (version === s.version ? "RefreshMetadata" : (version > s.version + 1 ? "ReloadSnapshot" : "ApplyData")))));
}

/** Story: Follow live updates without replaying changes / Only the next data version can change the view (spec/observatorySync.md:60) */
//@ pure
export function acceptDelta(s: ObservatorySync, version: number): ObservatorySync {
  //@ ensures (inv(s) && canAcceptDelta(s, version)) ==> stepReadGenerationNeverFalls(s, \result)
  //@ ensures (inv(s) && canAcceptDelta(s, version)) ==> stepDeltasAdvanceOneVersion(s, "acceptDelta", \result)
  return { ...s, version: version };
}

/** Story: Follow live updates without replaying changes / Only the next data version can change the view (spec/observatorySync.md:60) */
//@ pure
export function stepDeltasAdvanceOneVersion(before: ObservatorySync, via: string, after: ObservatorySync): boolean {
  return !(via === "acceptDelta") || (before.phase === "Live" && after.version === before.version + 1);
}

/** Story: Follow live updates without replaying changes / Only the next data version can change the view (spec/observatorySync.md:60) */
//@ pure
export function canAcceptDelta(s: ObservatorySync, version: number): boolean {
  return deltaAction(s, version, false) === "ApplyData";
}

/** Story: Follow live updates without replaying changes / The activity feed adds each new sequence once (spec/observatorySync.md:83) */
//@ pure
export function acceptsFeedItem(hasTail: boolean, tailSeq: number, itemSeq: number): boolean {
  return !hasTail || itemSeq > tailSeq;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ObservatorySync, event: Event): boolean {
  if (event.type === "changeView") return canChangeView(current, event.appName, event.viewMode);
  if (event.type === "publishSnapshot") return canPublishSnapshot(current, event.generation, event.appName, event.viewMode);
  if (event.type === "failLoad") return canFailLoad(current, event.generation);
  if (event.type === "startLoad") return true;
  if (event.type === "acceptDelta") return canAcceptDelta(current, event.version);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ObservatorySync, event: Event): ObservatorySync {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "changeView" && canChangeView(current, event.appName, event.viewMode)) return changeView(current, event.appName, event.viewMode);
  if (event.type === "publishSnapshot" && canPublishSnapshot(current, event.generation, event.appName, event.viewMode)) return publishSnapshot(current, event.generation, event.appName, event.viewMode, event.version);
  if (event.type === "failLoad" && canFailLoad(current, event.generation)) return failLoad(current, event.generation);
  if (event.type === "startLoad") return startLoad(current);
  if (event.type === "acceptDelta" && canAcceptDelta(current, event.version)) return acceptDelta(current, event.version);
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
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "changeView" && typeof raw.appName === "string" && typeof raw.viewMode === "string") return { type: "changeView", appName: raw.appName, viewMode: raw.viewMode };
  if (raw.type === "publishSnapshot" && Number.isSafeInteger(raw.generation) && typeof raw.appName === "string" && typeof raw.viewMode === "string" && Number.isSafeInteger(raw.version)) return { type: "publishSnapshot", generation: raw.generation, appName: raw.appName, viewMode: raw.viewMode, version: raw.version };
  if (raw.type === "failLoad" && Number.isSafeInteger(raw.generation)) return { type: "failLoad", generation: raw.generation };
  if (raw.type === "startLoad") return { type: "startLoad" };
  if (raw.type === "acceptDelta" && Number.isSafeInteger(raw.version)) return { type: "acceptDelta", version: raw.version };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ObservatorySync | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.appName === "string" && typeof raw.viewMode === "string" && Number.isSafeInteger(raw.generation) && (raw.phase === "Unsynced" || raw.phase === "Loading" || raw.phase === "Live") && Number.isSafeInteger(raw.version) && Object.keys(raw).length === 5)) return undefined;
  const parsed: ObservatorySync = ({ appName: raw.appName, viewMode: raw.viewMode, generation: raw.generation, phase: raw.phase, version: raw.version });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ObservatorySync {
  //@ ensures inv(\result)
  return initial;
}
