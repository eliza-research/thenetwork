// spec/runtimeUnit.md, "The engine runs on a snapshot outside the store lock"
// The engine call of a tick, as a step that runTick (store.ts) supplies: inline (no store: the
// simulator and direct ticks), capture (the first unit under the lock: record the request and end
// the unit), or a prepared result (the commit unit under the lock).
import { runEngine, type EngineConfigInput, type EngineDeps, type EngineResult } from "@thenetwork/engine";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";
import type { NetworkEvent } from "@thenetwork/core";
import { evidenceOwner, preparedItemCommits, preparedRunUsable } from "../../core/src/generated/runtimeUnit.ts";

/** One engine run that a tick asks for. `key` names the run: its kind and its New York day. */
export interface EngineRequest { key: string; input: EngineInput; config: EngineConfigInput; deps: EngineDeps }
export type EngineStep = (request: EngineRequest) => Promise<EngineResult>;

export const inlineEngine: EngineStep = request => runEngine(request.input, request.config, request.deps);

/** Thrown at the engine call of a capturing tick: the unit ends without a save. */
export class EngineRunDue extends Error {
  constructor(readonly request: EngineRequest) { super(`engine run ${request.key} is due`); }
}

/** Record the request from the loaded state. A copy: the state of later units never changes it. */
export const captureEngine: EngineStep = async request => {
  throw new EngineRunDue({ ...request, input: structuredClone(request.input) });
};

/** Compute a captured request. It runs without the store lock. */
export async function computeEngine(request: EngineRequest): Promise<{ request: EngineRequest; result: EngineResult }> {
  return { request, result: await inlineEngine(request) };
}

/** The evidence key of a public event: a separate namespace, so an event id never reads as a member id. */
const eventOwner = (id: string) => `event\0${id}`;

/**
 * spec/runtimeUnit.md, "A prepared engine result commits only for members whose evidence did not change"
 * The engine evidence of the input, one digest per owner (evidenceOwner): each public event is its own
 * evidence (it leaves the input when it starts, by the clock, with no member change); each other list
 * item and record entry that names a member goes to every member it names; the rest is shared.
 */
function evidence(input: EngineInput, ids: ReadonlySet<string>): { shared: string; owners: Map<string, string> } {
  const parts = new Map<string, string[]>();
  const shared: string[] = [];
  const named = (value: unknown, out: Set<string>) => {
    if (typeof value === "string") { if (ids.has(value)) out.add(value); return; }
    if (Array.isArray(value)) { for (const v of value) named(v, out); return; }
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (ids.has(k)) out.add(k); named(v, out); }
  };
  const put = (text: string, publicEvent: string | undefined, members: Set<string>) => {
    const owner = evidenceOwner(publicEvent !== undefined, members.size > 0);
    const keys = owner === "EventEvidence" ? [eventOwner(publicEvent!)] : owner === "MemberEvidence" ? [...members] : [];
    if (!keys.length) { shared.push(text); return; }
    for (const key of keys) { const list = parts.get(key) ?? []; list.push(text); parts.set(key, list); }
  };
  for (const [field, value] of Object.entries(input)) {
    if (field === "events" && Array.isArray(value)) {
      for (const event of value as NetworkEvent[]) put(`${field}:${stableStringify(event)}`, event.id, new Set());
    } else if (Array.isArray(value)) {
      for (const item of value) { const owners = new Set<string>(); named(item, owners); put(`${field}:${stableStringify(item)}`, undefined, owners); }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) { const owners = new Set<string>(); named(k, owners); named(v, owners); put(`${field}.${k}:${stableStringify(v)}`, undefined, owners); }
    } else shared.push(`${field}:${stableStringify(value)}`);
  }
  const digest = (xs: string[]) => sha256(xs.sort().join("\n"));
  return { shared: digest(shared), owners: new Map([...parts].map(([key, xs]) => [key, digest(xs)])) };
}

/**
 * spec/runtimeUnit.md, "A prepared engine result commits only for members whose evidence did not change"
 * The engine step of the commit unit. A different run asks for a new computation (EngineRunDue); in the
 * same run, each proposal, question and standing row keeps only when no owner it names (its members, the
 * public event that anchors a proposal) has changed evidence.
 */
export function preparedEngine(prepared: { request: EngineRequest; result: EngineResult }): EngineStep {
  return async current => {
    const ids = new Set<string>([...prepared.request.input.members, ...current.input.members].map(m => m.id));
    const before = evidence(prepared.request.input, ids), now = evidence(current.input, ids);
    const usable = preparedRunUsable(prepared.request.key === current.key,
      stableStringify(prepared.request.config) === stableStringify(current.config), before.shared === now.shared);
    if (!usable) throw new EngineRunDue({ ...current, input: structuredClone(current.input) });
    const changed = [...new Set([...before.owners.keys(), ...now.owners.keys()])].filter(key => before.owners.get(key) !== now.owners.get(key));
    const commits = (named: string[]) => preparedItemCommits(usable, named, changed);
    const { result } = prepared;
    return {
      ...result,
      proposals: result.proposals.filter(p => commits([...p.participants, ...p.alternates,
        ...(p.anchor?.type === "event" ? [eventOwner(p.anchor.id)] : [])])),
      asks: result.asks.filter(a => commits([a.memberId])),
      ...(result.memberStanding ? { memberStanding: result.memberStanding.filter(row => commits([row.memberId])) } : {}),
    };
  };
}
