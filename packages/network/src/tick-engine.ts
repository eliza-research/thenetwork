// spec/runtimeUnit.md, "The engine runs on a snapshot outside the store lock"
// The engine call of a tick, as a step that runTick (store.ts) supplies: inline (no store: the
// simulator and direct ticks), capture (the first unit under the lock: record the request and end
// the unit), or a prepared result (the commit unit under the lock).
import { runEngine, type EngineConfigInput, type EngineDeps, type EngineResult } from "@thenetwork/engine";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";
import { preparedItemCommits, preparedRunUsable } from "../../core/src/generated/runtimeUnit.ts";

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

/**
 * The engine evidence of the input, split by member: every list item and every record entry that names
 * a member goes to that member; the rest (the time, public events) is shared. One digest per part.
 */
function evidence(input: EngineInput, ids: ReadonlySet<string>): { shared: string; members: Map<string, string> } {
  const parts = new Map<string, string[]>();
  const shared: string[] = [];
  const named = (value: unknown, out: Set<string>) => {
    if (typeof value === "string") { if (ids.has(value)) out.add(value); return; }
    if (Array.isArray(value)) { for (const v of value) named(v, out); return; }
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (ids.has(k)) out.add(k); named(v, out); }
  };
  const put = (text: string, owners: Set<string>) => {
    if (!owners.size) { shared.push(text); return; }
    for (const id of owners) { const list = parts.get(id) ?? []; list.push(text); parts.set(id, list); }
  };
  for (const [field, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) { const owners = new Set<string>(); named(item, owners); put(`${field}:${stableStringify(item)}`, owners); }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) { const owners = new Set<string>(); named(k, owners); named(v, owners); put(`${field}.${k}:${stableStringify(v)}`, owners); }
    } else shared.push(`${field}:${stableStringify(value)}`);
  }
  const digest = (xs: string[]) => sha256(xs.sort().join("\n"));
  return { shared: digest(shared), members: new Map([...ids].map(id => [id, digest(parts.get(id) ?? [])])) };
}

/**
 * spec/runtimeUnit.md, "A prepared engine result commits only for members whose evidence did not change"
 * The engine step of the commit unit. A different run asks for a new computation (EngineRunDue); in the
 * same run, each proposal, question and standing row keeps only when its members' evidence is unchanged.
 */
export function preparedEngine(prepared: { request: EngineRequest; result: EngineResult }): EngineStep {
  return async current => {
    const ids = new Set<string>([...prepared.request.input.members, ...current.input.members].map(m => m.id));
    const before = evidence(prepared.request.input, ids), now = evidence(current.input, ids);
    const usable = preparedRunUsable(prepared.request.key === current.key,
      stableStringify(prepared.request.config) === stableStringify(current.config), before.shared === now.shared);
    if (!usable) throw new EngineRunDue({ ...current, input: structuredClone(current.input) });
    const unchanged = (members: readonly string[]) => preparedItemCommits(usable, members.every(id => before.members.get(id) === now.members.get(id)));
    const { result } = prepared;
    return {
      ...result,
      proposals: result.proposals.filter(p => unchanged([...p.participants, ...p.alternates])),
      asks: result.asks.filter(a => unchanged([a.memberId])),
      ...(result.memberStanding ? { memberStanding: result.memberStanding.filter(row => unchanged([row.memberId])) } : {}),
    };
  };
}
