// friends.help candidate generators for the engine's nightly run (runEngine with friendsPack). The
// weekly planner (planner.ts) is the main path; these give the review queue and the Network's run log
// the same shapes from the same match core. ORDER IS PART OF THE CONTRACT.
//
//   same_table_again    a completed meetup where >= 2 attendees said they'd see each other again:
//                       the same people again (group of 3-6, or a pair), the wedge against reshuffled
//                       dinners (Hall 2018: hours accumulate only with repetition)
//   friend_circle       a circle of 3-6 people who fit (w.match.circles("Friend"): every pair has a
//                       real pair value; Back et al. 2008; Adams: proximity drives friendship)
//   activity_partner    one-to-one: each member's best searched partner (w.match.candidates) who
//                       passes the one-to-one rules (rules.ts group_first)
import type { MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { friendsCandidateCanMeet, friendsSeatFitsFormat } from "../../../../core/src/generated/friendsPlanningSeats.ts";
import { isMinor, memberReason, pairReason } from "../../filters.ts";
import { circleCandidate, pairCandidate, searchFor, type GenCtx } from "../../genkit.ts";
import type { Circle } from "../../match/circles.ts";
import type { MatchProfile } from "../../match/profile.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate, Role } from "../../types.ts";
import type { World } from "../../world.ts";
import { FRIENDS_CITY } from "./geo.ts";
import { friendsRosterVerified } from "./rules.ts";
import { FRIENDS_ACTIVITY_TAGS } from "./vectors.ts";

function positiveSeeIndex(w: World): ReadonlySet<string> {
  const index = new Set<string>();
  for (const f of w.feedback) {
    if (f.wouldMeetAgain === true) index.add(`${f.from}|${f.about}|${f.opportunityId ?? ""}`);
  }
  return index;
}

const byStanding = (a: MatchProfile, b: MatchProfile): number => a.standing - b.standing || a.ordinal - b.ordinal;

/**
 * A familiar group (the same table again) as a Friend circle, in the given order: every member has a
 * Friend profile and every pair has a pair value through the one pair gate (blocks, pack rules,
 * cooldowns). Undefined when one pair has none. The planner's repeats and same_table_again use it.
 */
export function familiarCircle(w: World, ids: readonly MemberId[]): Circle | undefined {
  const profiles: MatchProfile[] = [];
  for (const id of ids) {
    const profile = w.match.profileIn(id, "Friend");
    if (!profile) return undefined;
    profiles.push(profile);
  }
  let lowestPairValue = Number.MAX_SAFE_INTEGER, pairValueTotal = 0, pairCount = 0;
  for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) {
    const value = w.match.value(profiles[i]!, profiles[j]!);
    if (value < 0) return undefined;
    lowestPairValue = Math.min(lowestPairValue, value);
    pairValueTotal += value;
    pairCount++;
  }
  if (pairCount === 0) return undefined;
  const low = profiles.reduce((x, p) => (byStanding(p, x) < 0 ? p : x));
  const high = profiles.reduce((x, p) => (byStanding(p, x) > 0 ? p : x));
  return {
    members: profiles.map(p => p.id),
    evidence: {
      size: profiles.length, lowestPairValue, pairValueTotal, pairCount,
      standingLow: low.standing, standingHigh: high.standing, uncertaintyTotal: low.uncertainty + high.uncertainty,
    },
  };
}

/** Shared activity tags of a group, in tag order (the anchor and the objective name the first). */
function sharedActivityTags(ctx: GenCtx, ids: readonly MemberId[]): string[] {
  const [first, ...rest] = ids.map(id => ctx.w.get(id)?.tags ?? new Set<string>());
  return [...(first ?? [])].filter(t => FRIENDS_ACTIVITY_TAGS.has(t) && rest.every(tags => tags.has(t))).sort();
}

export function sameTableAgain(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const seeAgain = positiveSeeIndex(w);
  const recent = w.interactions.filter(r => r.outcome === "completed" && w.now - r.at < 21 * DAY && r.participants.length >= 2)
    .sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1));
  for (const r of recent) {
    const mutual = (a: MemberId, b: MemberId) => seeAgain.has(`${a}|${b}|${r.id}`) && seeAgain.has(`${b}|${a}|${r.id}`);
    // Attendees with a mutual "see again" with at least one other attendee.
    const ids = r.participants.filter(a => r.participants.some(b => b !== a && mutual(a, b)));
    const startsAsGroup = ids.length >= 3;
    const fit = (id: MemberId, group: boolean) => {
      const format = group ? "small_group" : "one_to_one";
      return !isMinor(w, id) && w.get(id)?.m.prefs.formats.includes(format) === true
        && memberReason(w, id, { category: "social", role: "peer", format, timeSensitive: false }) === null;
    };
    const firstPass = ids.filter(id => fit(id, startsAsGroup)).slice(0, 6);
    const ok = firstPass.length === 2 && startsAsGroup
      ? firstPass.filter(id => friendsSeatFitsFormat(true, true, fit(id, false))) : firstPass;
    if (ok.length < 2) continue;
    const k = [...ok].sort().join(",");
    if (seen.has(k)) continue;
    const circle = familiarCircle(w, ok);
    if (!circle || !friendsCandidateCanMeet(true, w.canMeet(ok))) continue;
    seen.add(k);
    const group = ok.length >= 3;
    // The mutual "see again" is the evidence and the warmth; fit and benefit come from the match core.
    out.push(circleCandidate(w, circle, "Friend", {
      kind: group ? "group" : "second_encounter", generator: "same_table_again", category: "social",
      roles: Object.fromEntries(ok.map(id => [id, "peer" as Role])), format: group ? "small_group" : "one_to_one",
      objective: "Same table again", anchor: { type: "interaction", id: r.id }, preferredCity: FRIENDS_CITY, channels: new Set(["history"]),
      evidence: Object.fromEntries(ok.map(id => [id, []])), warm: 1, confidenceHint: 0.9, riskText: "same group again",
    }));
  }
  return out;
}

export function friendCircle(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  return w.match.circles("Friend").map(circle => {
    const ids = circle.members.flatMap(id => { const p = w.match.profile(id); return p ? [p.memberId] : []; });
    const tag = sharedActivityTags(ctx, ids)[0];
    return circleCandidate(w, circle, "Friend", {
      kind: "group", generator: "friend_circle", category: "social", roles: Object.fromEntries(ids.map(id => [id, "guest" as Role])), format: "small_group",
      objective: tag ? `A small group for ${tag.replace(/_/g, " ")}` : "A small group nearby",
      ...(tag ? { anchor: { type: "interest" as const, id: tag, label: tag } } : {}),
      preferredCity: FRIENDS_CITY, channels: new Set(["match", "group"]),
      evidence: Object.fromEntries(ids.map(id => [id, tag ? w.get(id)!.share.filter(f => f.tags.includes(tag)).map(f => f.id) : []])),
      riskText: tag ?? "small group",
    });
  });
}

const ONE_TO_ONE = { category: "hobby", role: "peer", format: "one_to_one", timeSensitive: false } as const;

export function activityPartner(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const done = new Set<string>();
  const oneToOne = (id: MemberId) => w.get(id)?.m.prefs.formats.includes("one_to_one") === true
    && memberReason(w, id, ONE_TO_ONE) === null;
  for (const profile of w.match.profiles) {
    if (profile.lane !== "Friend" || !oneToOne(profile.memberId)) continue;
    const best = searchFor(ctx, profile).kept.find(({ profile: other }) => {
      const pair = [profile.memberId, other.memberId];
      return oneToOne(other.memberId) && friendsRosterVerified(w, pair) && friendsCandidateCanMeet(
        pairReason(w, profile.memberId, other.memberId, ONE_TO_ONE.category) === null, w.canMeet(pair));
    });
    if (!best) continue;
    const [a, b] = [profile.memberId, best.profile.memberId];
    const k = [a, b].sort().join(",");
    if (done.has(k)) continue;
    done.add(k);
    const tag = sharedActivityTags(ctx, [a, b])[0];
    out.push(pairCandidate(w, profile, best.profile, best.value, {
      kind: "intro", generator: "activity_partner", category: "hobby", roles: { [a]: "peer", [b]: "peer" }, format: "one_to_one",
      objective: tag ? `Activity partner: ${tag.replace(/_/g, " ")}` : "Activity partner",
      ...(tag ? { anchor: { type: "interest" as const, id: tag, label: tag } } : {}),
      preferredCity: FRIENDS_CITY, channels: new Set(["match"]), evidence: { [a]: [], [b]: [] }, riskText: tag ?? "activity partner",
    }));
  }
  return out;
}

export const FRIENDS_GENERATORS: readonly GeneratorSpec[] = [
  { name: "same_table_again", run: ctx => sameTableAgain(ctx) },
  { name: "friend_circle", run: ctx => friendCircle(ctx) },
  { name: "activity_partner", run: ctx => activityPartner(ctx) },
];
