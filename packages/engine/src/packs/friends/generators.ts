// friends.help candidate generators for the engine's nightly run (runEngine with friendsPack). The
// weekly group planner (planner.ts) is the main path in the simulator; these generators give the
// review queue and the Network's run log the same three shapes. ORDER IS PART OF THE CONTRACT.
//
//   same_table_again   a completed meetup where >= 2 attendees said they'd see each other again:
//                      the same people again (group of 3-6, or a pair), the wedge against reshuffled
//                      dinners (Hall 2018: hours accumulate only with repetition)
//   zone_interest_group a 3-6 group around one stated interest, pooled within a planning zone (Back et
//                      al. 2008; Adams: proximity drives friendship)
//   activity_partner   one-to-one activity partner (climbing, running, tennis...), nearest by transit;
//                      only after a group meetup (rules.ts group_first)
import type { Category, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { isMinor, memberReason, pairReason } from "../../filters.ts";
import { makeCandidate, type GenCtx } from "../../genkit.ts";
import { composeGroup } from "../../group.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate, Role } from "../../types.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { FRIENDS_EXCLUDED_ACTIVITIES, transitMinutes } from "./geo.ts";
import { friendsInfo } from "./info.ts";

const PAIR_TAGS = new Set(ACTIVITIES.filter(a => a.groupSize[0] <= 2 && !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)).flatMap(a => a.tags));
const GROUP_TAGS = new Set(ACTIVITIES.filter(a => !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)).flatMap(a => a.tags));

const positiveAbout = (ctx: GenCtx, from: MemberId, about: MemberId, opp: string) =>
  ctx.w.feedback.some(f => f.from === from && f.about === about && f.opportunityId === opp && f.wouldMeetAgain === true);

export function sameTableAgain(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const recent = w.interactions.filter(r => r.outcome === "completed" && w.now - r.at < 21 * DAY && r.participants.length >= 2)
    .sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1));
  for (const r of recent) {
    // Attendees with a mutual "see again" with at least one other attendee.
    const ids = r.participants.filter(a => r.participants.some(b => b !== a && positiveAbout(ctx, a, b, r.id) && positiveAbout(ctx, b, a, r.id)));
    const ok = ids.filter(id => !memberReason(w, id, { category: "social", role: "peer", format: ids.length >= 3 ? "small_group" : "one_to_one", timeSensitive: false }));
    if (ok.length < 2) continue;
    if (ok.some((a, i) => ok.slice(i + 1).some(b => pairReason(w, a, b, "social")))) continue;
    const k = [...ok].sort().join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    const group = ok.length >= 3;
    out.push(makeCandidate({
      kind: group ? "group" : "second_encounter", generator: "same_table_again", category: "social",
      participants: ok.slice(0, 6), roles: Object.fromEntries(ok.slice(0, 6).map(id => [id, "peer" as Role])), format: group ? "small_group" : "one_to_one",
      objective: "Same table again", anchor: { type: "interaction", id: r.id }, preferredCity: "nyc", channels: new Set(["history"]),
      evidence: Object.fromEntries(ok.map(id => [id, []])), fit: 0.8, benefit: Object.fromEntries(ok.map(id => [id, 0.8])), warm: 1, confidenceHint: 0.9,
      riskText: "same group again",
    }));
  }
  return out;
}

export function zoneInterestGroup(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const info = friendsInfo(w);
  const out: Candidate[] = [];
  const byZoneTag = new Map<string, MemberId[]>();
  for (const id of w.ids) {
    if (isMinor(w, id)) continue;
    const z = info.get(id)?.home?.zone;
    if (!z) continue;
    for (const f of w.get(id)!.match) if (f.kind === "interest") for (const t of f.tags) if (GROUP_TAGS.has(t)) {
      const k = `${z}|${t}`;
      if (!byZoneTag.has(k)) byZoneTag.set(k, []);
      if (!byZoneTag.get(k)!.includes(id)) byZoneTag.get(k)!.push(id);
    }
  }
  const keys = [...byZoneTag.keys()].filter(k => byZoneTag.get(k)!.length >= 3).sort((a, b) => (byZoneTag.get(b)!.length - byZoneTag.get(a)!.length) || (a < b ? -1 : 1)).slice(0, 40);
  const category: Category = "social";
  for (const k of keys) {
    const tag = k.split("|")[1]!;
    const pool = byZoneTag.get(k)!.filter(id => !memberReason(w, id, { category, role: "guest", format: "small_group", timeSensitive: false }))
      .map(id => ({ id, affinity: 0.6 })).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, w.cfg.group.poolSize);
    if (pool.length < 3) continue;
    const g = composeGroup(w, {
      pool, category, minSize: 3, maxSize: Math.min(6, w.cfg.group.maxSize), window: { start: w.now, end: w.now + w.cfg.windowDays * DAY },
      preferredCity: "nyc", requireCity: true, needHost: false, beamWidth: w.cfg.group.beamWidth, minPairwise: w.cfg.group.minPairwise, alternates: w.cfg.group.alternates,
    });
    if (!g) continue;
    out.push(makeCandidate({
      kind: "group", generator: "zone_interest_group", category, participants: g.primary, roles: Object.fromEntries(g.primary.map(id => [id, "guest" as Role])), format: "small_group",
      objective: `A small group for ${tag.replace(/_/g, " ")}`, anchor: { type: "interest", id: k, label: tag }, preferredCity: "nyc", channels: new Set(["tag", "geo", "group"]),
      evidence: Object.fromEntries(g.primary.map(id => [id, w.get(id)!.share.filter(f => f.tags.includes(tag)).map(f => f.id)])),
      fit: Math.max(0.3, 0.5 + 0.5 * g.stats.avgPairwise), benefit: Object.fromEntries(g.primary.map(id => [id, 0.6])), alternates: g.alternates, groupStats: g.stats,
      warm: g.stats.warmTies > 0 ? 0.5 : 0, riskText: tag,
    }));
  }
  return out;
}

export function activityPartner(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const info = friendsInfo(w);
  const out: Candidate[] = [];
  const done = new Set<string>();
  const category: Category = "hobby";
  const check = { category, role: "peer" as Role, format: "one_to_one" as const, timeSensitive: false };
  for (const a of w.ids) {
    if (memberReason(w, a, check)) continue;
    const ha = info.get(a)?.home;
    if (!ha) continue;
    const mine = [...w.get(a)!.tags].filter(t => PAIR_TAGS.has(t)).sort();
    let best: { id: MemberId; tag: string; min: number } | undefined;
    for (const b of w.ids) {
      if (b === a || memberReason(w, b, check)) continue;
      const hb = info.get(b)?.home;
      if (!hb) continue;
      const tag = mine.find(t => w.get(b)!.tags.has(t));
      if (!tag || pairReason(w, a, b, category)) continue;
      const min = transitMinutes(ha, hb);
      if (!best || min < best.min || (min === best.min && b < best.id)) best = { id: b, tag, min };
    }
    if (!best) continue;
    const k = [a, best.id].sort().join(",");
    if (done.has(k)) continue;
    done.add(k);
    out.push(makeCandidate({
      kind: "intro", generator: "activity_partner", category, participants: [a, best.id], roles: { [a]: "peer", [best.id]: "peer" }, format: "one_to_one",
      objective: `Activity partner: ${best.tag.replace(/_/g, " ")}`, anchor: { type: "interest", id: best.tag, label: best.tag }, preferredCity: "nyc",
      channels: new Set(["tag", "geo"]), evidence: { [a]: [], [best.id]: [] }, fit: Math.max(0.3, 1 - best.min / 90), benefit: { [a]: 0.6, [best.id]: 0.6 },
      riskText: best.tag,
    }));
  }
  return out;
}

export const FRIENDS_GENERATORS: readonly GeneratorSpec[] = [
  { name: "same_table_again", run: ctx => sameTableAgain(ctx) },
  { name: "zone_interest_group", run: ctx => zoneInterestGroup(ctx) },
  { name: "activity_partner", run: ctx => activityPartner(ctx) },
];
