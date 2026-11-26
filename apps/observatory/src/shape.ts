import { fullStaffView } from "../../../packages/core/src/generated/staffPermissions.ts";
import type { ObsDelta, ObsFeedItem, ObsMember, ObsOpportunity, ObsState, StaffRole } from "./types.ts";

export type ViewClass = "full" | "counts";

export const viewClass = (roles: ReadonlySet<StaffRole>): ViewClass => fullStaffView([...roles]) ? "full" : "counts";

const RESOLVED = new Set(["COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"]);

export function stripOracle(o: ObsOpportunity, truth: boolean): ObsOpportunity {
  if (!o.oracle || truth || RESOLVED.has(o.state) || o.oracle.unsafe) return o;
  const { oracle: _, ...rest } = o;
  return rest;
}

export const anonName = (id: string) => `Member ${id.replace(/^.*[:-]/, "").slice(-4) || id.slice(-4)}`;

export function countsMember(m: ObsMember): ObsMember {
  const { age: _a, minor: _m, ageUnknown: _u, trust: _t, occupation: _o, controlled: _c, declined: _d, weekly: _w, calendar: _k, community: _g, ...rest } = m;
  return { ...rest, name: anonName(m.id) } as ObsMember;
}

export function countsOpp(o: ObsOpportunity): ObsOpportunity {
  const { feedback: _f, ...rest } = o;
  return { ...rest, explanations: {}, objective: "" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namePattern(members: Iterable<ObsMember>): RegExp | undefined {
  const names = new Set<string>();
  for (const m of members) {
    const n = m.name?.trim();
    if (!n) continue;
    names.add(n);
    const first = n.split(/\s+/)[0];
    if (first && first.length >= 2) names.add(first);
  }
  if (!names.size) return undefined;
  return new RegExp(`\\b(${[...names].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})\\b`, "g");
}

function countsFeed(items: ObsFeedItem[], names: RegExp | undefined): ObsFeedItem[] {
  return items.map(f => ({ ...f, text: names ? f.text.replace(names, "a member") : f.text }));
}

export function shapeState(s: ObsState, cls: ViewClass, truth: boolean): ObsState {
  const out: ObsState = { ...s, opportunities: s.opportunities.map(o => stripOracle(o, truth)) };
  if (!truth) delete out.truth;
  if (cls === "full") return out;
  const names = namePattern(s.members);
  delete out.truth;
  return {
    ...out, members: s.members.map(countsMember), opportunities: out.opportunities.map(countsOpp),
    feed: countsFeed(s.feed, names), ...(s.game ? { game: { ...s.game, prompts: [] } } : {}),
  };
}

export function shapeDelta(d: ObsDelta, cls: ViewClass, truth: boolean, allMembers: () => Iterable<ObsMember>): ObsDelta {
  const out: ObsDelta = d.opportunities ? { ...d, opportunities: d.opportunities.map(o => stripOracle(o, truth)) } : { ...d };
  if (cls === "full") return out;
  if (out.members) out.members = out.members.map(countsMember);
  if (out.opportunities) out.opportunities = out.opportunities.map(countsOpp);
  if (out.feed) out.feed = countsFeed(out.feed, namePattern(allMembers()));
  if (out.game) out.game = { ...out.game, prompts: [] };
  return out;
}
