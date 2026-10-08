// What each staff role receives in /api/state and on the WebSocket (audit observatory-5, -6, -18).
// Admin-console 4.1: an analyst sees counts and the shape of the network, never a person. So for a
// caller whose only role for the app is analyst, members carry no name, age, minor flag, trust level
// or occupation, opportunity texts written for a member are dropped, and feed lines lose the names in
// them. The oracle's verdict on an opportunity (hidden truth, game mode) is stripped for everyone
// until the opportunity is resolved, unless this staff member has the truth lens on.
import type { ObsDelta, ObsFeedItem, ObsMember, ObsOpportunity, ObsState, StaffRole } from "./types.ts";

/** "full": staff who may open members (admin, reviewer, safety; engineer in simulated worlds). "counts": analysts. */
export type ViewClass = "full" | "counts";

/** The view for the roles a caller holds for one app (rolesFor() in staff.ts). */
export const viewClass = (roles: ReadonlySet<StaffRole>): ViewClass =>
  roles.has("admin") || roles.has("reviewer") || roles.has("safety") || roles.has("engineer") ? "full" : "counts";

/** Opportunities whose outcome is known: the oracle's verdict is no longer a spoiler. */
const RESOLVED = new Set(["COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED"]);

/** The oracle only when resolved or unsafe (a safety strike already shows it), or with the truth lens. */
export function stripOracle(o: ObsOpportunity, truth: boolean): ObsOpportunity {
  if (!o.oracle || truth || RESOLVED.has(o.state) || o.oracle.unsafe) return o;
  const { oracle: _, ...rest } = o;
  return rest;
}

/** A stable label that is not a name: "Member 3f9a". */
export const anonName = (id: string) => `Member ${id.replace(/^.*[:-]/, "").slice(-4) || id.slice(-4)}`;

export function countsMember(m: ObsMember): ObsMember {
  const { age: _a, minor: _m, ageUnknown: _u, trust: _t, occupation: _o, controlled: _c, ...rest } = m;
  // `minor` is required by the type; the analyst view has no age facts at all.
  return { ...rest, name: anonName(m.id) } as ObsMember;
}

export function countsOpp(o: ObsOpportunity): ObsOpportunity {
  const { feedback: _f, ...rest } = o;
  return { ...rest, explanations: {}, objective: "" };
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
  if (!truth) delete out.truth;
  if (cls === "full") return out;
  const names = namePattern(s.members);
  delete out.truth;
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
