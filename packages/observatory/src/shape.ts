// What each staff role receives in /api/state and on the WebSocket (audit observatory-5, -6, -18).
// Admin-console 4.1: an analyst sees counts and the shape of the network, never a person. So for a
// caller whose only role for the app is analyst, members carry no name, age, minor flag, trust level
// or occupation, opportunity texts written for a member are dropped, and feed lines lose the names in
// them. The oracle's verdict on an opportunity (hidden truth, game mode) is stripped for everyone
// until the opportunity is resolved, unless this staff member has the truth lens on. The decisions are
// in privacy-core.ts (proved). This file reads the objects and builds the output.
import type { ObsDelta, ObsFeedItem, ObsMember, ObsOpportunity, ObsState, StaffRole } from "./types.ts";
import { classOf, memberFieldUse, oppFieldUse, oracleShown, truthShown, type ViewClass } from "./privacy-core.ts";

/** "full": staff who may open members (admin, reviewer, safety; engineer in simulated worlds). "counts": analysts. */
export type { ViewClass };

/** The view for the roles a caller holds for one app (rolesFor() in staff.ts). */
export const viewClass = (roles: ReadonlySet<StaffRole>): ViewClass =>
  classOf({ admin: roles.has("admin"), reviewer: roles.has("reviewer"), safety: roles.has("safety"), engineer: roles.has("engineer") });

/** The oracle only when resolved or unsafe (a safety strike already shows it), or with the truth lens. */
export function stripOracle(o: ObsOpportunity, truth: boolean): ObsOpportunity {
  if (!o.oracle || oracleShown({ lens: truth, state: o.state, unsafe: !!o.oracle.unsafe })) return o;
  const { oracle: _, ...rest } = o;
  return rest;
}

/** A stable label that is not a name: "Member 3f9a". */
export const anonName = (id: string) => `Member ${id.replace(/^.*[:-]/, "").slice(-4) || id.slice(-4)}`;

/** The fields of `o` that `use` keeps, in their order. A masked field keeps its place with `mask[key]`. */
function shapeFields<T extends object>(o: T, use: (key: string) => "keep" | "drop" | "mask", mask: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // An own data property, as the spread made it (also for a key such as "__proto__").
  const put = (k: string, v: unknown) => { Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true }); };
  for (const [k, v] of Object.entries(o)) {
    const u = use(k);
    if (u === "keep") put(k, v);
    else if (u === "mask") put(k, mask[k]);
  }
  // A masked field is always there, as the spread `{ ...rest, key: value }` made it before.
  for (const k of Object.keys(mask)) put(k, mask[k]);
  return out;
}

export function countsMember(m: ObsMember): ObsMember {
  // `minor` is required by the type; the analyst view has no age facts at all.
  return shapeFields(m, k => memberFieldUse("counts", k), { name: anonName(m.id) }) as unknown as ObsMember;
}

export function countsOpp(o: ObsOpportunity): ObsOpportunity {
  return shapeFields(o, k => oppFieldUse("counts", k), { explanations: {}, objective: "" }) as unknown as ObsOpportunity;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every member name and first name, longest first, as one word-bounded pattern (undefined: no names). */
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

/** /api/state for one caller. */
export function shapeState(s: ObsState, cls: ViewClass, truth: boolean): ObsState {
  const out: ObsState = { ...s, opportunities: s.opportunities.map(o => stripOracle(o, truth)) };
  if (!truthShown(cls, truth)) delete out.truth;
  // The full class keeps every field (memberFieldUse and oppFieldUse in privacy-core.ts).
  if (cls === "full") return out;
  const names = namePattern(s.members);
  return {
    ...out, members: s.members.map(countsMember), opportunities: out.opportunities.map(countsOpp),
    feed: countsFeed(s.feed, names), ...(s.game ? { game: { ...s.game, prompts: [] } } : {}),
  };
}

/** One WebSocket delta for one caller. `allMembers`: the app's members now (the feed names come from them). */
export function shapeDelta(d: ObsDelta, cls: ViewClass, truth: boolean, allMembers: () => Iterable<ObsMember>): ObsDelta {
  const out: ObsDelta = d.opportunities ? { ...d, opportunities: d.opportunities.map(o => stripOracle(o, truth)) } : { ...d };
  if (cls === "full") return out;
  if (out.members) out.members = out.members.map(countsMember);
  if (out.opportunities) out.opportunities = out.opportunities.map(countsOpp);
  if (out.feed) out.feed = countsFeed(out.feed, namePattern(allMembers()));
  if (out.game) out.game = { ...out.game, prompts: [] };
  return out;
}
