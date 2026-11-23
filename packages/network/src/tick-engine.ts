import { runEngine, type EngineConfigInput, type EngineDeps, type EngineResult } from "@thenetwork/engine";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { sha256, stableStringify } from "@thenetwork/engine/src/hash.ts";
import type { NetworkEvent } from "@thenetwork/core";
import { evidenceOwner, preparedItemCommits, preparedRunUsable } from "../../core/src/generated/runtimeUnit.ts";

interface EngineRequest { key: string; input: EngineInput; config: EngineConfigInput; deps: EngineDeps }
export type EngineStep = (request: EngineRequest) => Promise<EngineResult>;

export const inlineEngine: EngineStep = request => runEngine(request.input, request.config, request.deps);

export class EngineRunDue extends Error {
  constructor(readonly request: EngineRequest) { super(`engine run ${request.key} is due`); }
}

export const captureEngine: EngineStep = async request => {
  throw new EngineRunDue({ ...request, input: structuredClone(request.input) });
};

const eventOwner = (id: string) => `event\0${id}`;

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
