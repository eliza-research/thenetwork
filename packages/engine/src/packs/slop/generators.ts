// slopPack on the match core: one Date-lane membership per dating market of a member who can be matched, the dating
// profile as tags, the private appearance rating as standing, and the directed compatibility
// estimate as the pack value. The one generator turns the lane's searched edges into candidates:
// no pair outside the bounded candidate search is ever checked.
import type { City, MemberId } from "@thenetwork/core";
import { DAY, withinMutualRadius } from "@thenetwork/core";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { datingClassAdmits, datingSegmentClassOf, type DatingSegmentClass, type DatingStatement } from "../../../../core/src/generated/mutualOpenness.ts";
import { standingFromRating, standingRatingScale, standingReadable, standingUncertainty } from "../../../../core/src/generated/memberStanding.ts";
import { memberReason, type MemberCheck } from "../../filters.ts";
import { countExclusion, pairCandidate, type GenCtx } from "../../genkit.ts";
import type { EntitySegment, EntityTags, MatchProfile, Membership, PackVectors } from "../../match/profile.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import { pairKey, type World } from "../../world.ts";
import { ratingPermille } from "./appearance.ts";
import { limitMiles, mutualMarkets } from "./geo.ts";
import type { SlopPackOptions } from "./options.ts";
import { cellIn, datingMarkets, datingStatementOf, slopProfiles, type SlopProfile } from "./profile.ts";
import { SLOP_LANE, SLOP_MATCH_LANE } from "./rules.ts";
import { dateActivity, datePackValue, responsiveness } from "./score.ts";
import { cellMiles, cellOfZip, ZIPS, type Cell } from "./zips.ts";

export const SLOP_GENERATOR = "slop_reciprocal";

const DATING: MemberCheck = { category: SLOP_LANE, role: "peer", format: "one_to_one", timeSensitive: false };
const profilesOf = (w: World) => slopProfiles(w.input, w.canonical);

/** The member probed first: the one with the live want (asked most recently), then the more responsive one. */
export function firstOf(a: SlopProfile, b: SlopProfile, now: number): [SlopProfile, SlopProfile] {
  const fresh = (p: SlopProfile) => (p.history.lastAskAt !== undefined && now - p.history.lastAskAt < 7 * DAY ? p.history.lastAskAt : -Infinity);
  const fa = fresh(a), fb = fresh(b);
  if (fa !== fb) return fa > fb ? [a, b] : [b, a];
  const ra = responsiveness(a), rb = responsiveness(b);
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/**
 * The markets of a member's Date memberships: every market they date in this week (scope and
 * visits, PRD 40.5) that the pack serves, home first. The home membership's entity id is the member
 * id; the others are `<member>@<market>`.
 */
function datingMemberships(memberId: MemberId, p: SlopProfile, markets: readonly City[]): { id: string; market: City }[] {
  const open = datingMarkets(p).filter(m => markets.includes(m));
  const ordered = open.includes(p.homeMarket) ? [p.homeMarket, ...open.filter(m => m !== p.homeMarket)] : open;
  return ordered.map((market, i) => ({ id: i === 0 ? memberId : `${memberId}@${market}`, market }));
}

/** A stated type dimension (a unit vector over 5 dimensions) counts when its weight reaches this. */
const TYPE_SIGNAL = 0.3;
const typeTags = (dims: readonly number[] | undefined): string[] =>
  (dims ?? []).flatMap((x, i) => (x >= TYPE_SIGNAL ? [`type:${i}:high`] : x <= -TYPE_SIGNAL ? [`type:${i}:low`] : []));

/**
 * One vocabulary for both directions: offers say who the member is (goal, lifestyle, self-described
 * type, interests, date ideas, free slots); seeks say what they stated they want in the same words
 * (the same goal, the same plans for kids when not casual, their type, their date ideas and slots);
 * interests are the things two people could share.
 */
export function dateTags(p: SlopProfile): EntityTags {
  const v = p.values;
  const known = (key: string, value: string | number | undefined): string[] => (value === undefined ? [] : [`${key}:${value}`]);
  const plans = [...p.activities.map(a => `activity:${a}`), ...p.free.map(s => `free:${s}`)];
  return {
    offers: [
      ...known("goal", p.goal), ...known("smoking", v.smoking), ...known("drinking", v.drinking), ...known("has_kids", v.hasKids),
      ...known("wants_kids", v.wantsKids), ...known("faith", v.religionImportance), ...known("politics", v.politics),
      ...typeTags(p.self), ...p.interests, ...plans,
    ],
    seeks: [
      ...(p.goal === "unsure" ? [] : known("goal", p.goal)),
      ...(p.goal === "casual" ? [] : known("wants_kids", v.wantsKids)),
      ...typeTags(p.wants), ...plans,
    ],
    interests: p.interests,
  };
}

/** Every cell a member can be placed on: profiles place members only on cells of table zips (cellIn). */
const ZIP_CELLS: readonly Cell[] = [...new Map(ZIPS.flatMap(z => { const c = cellOfZip(z.zip); return c ? [[c.id, c] as const] : []; })).values()];
/** Per run: the cells within each (cell, limit) and the partner list of each (seeks, cell, limit). */
interface SegmentMemo { readonly cells: Map<string, readonly string[]>; readonly partners: Map<string, readonly string[]> }
const segmentMemo = new WeakMap<World, SegmentMemo>();
function segmentMemoOf(w: World): SegmentMemo {
  let memo = segmentMemo.get(w);
  if (!memo) { memo = { cells: new Map(), partners: new Map() }; segmentMemo.set(w, memo); }
  return memo;
}

/** The cells within one member's own limit: their half of withinMutualRadius (geo.ts mutualMarkets). */
function reachableCells(memo: SegmentMemo, cell: Cell, limit: number, margin: number): readonly string[] {
  const key = `${cell.id}|${limit}|${margin}`;
  let cells = memo.cells.get(key);
  if (!cells) {
    cells = ZIP_CELLS.filter(c => withinMutualRadius(cellMiles(cell, c), margin, limit, limit)).map(c => c.id);
    memo.cells.set(key, cells);
  }
  return cells;
}
const dateSegment = (pool: string, cell: string): string => `${pool}|${cell}`;
const classKey = (c: DatingSegmentClass): string =>
  `${c.reachesWomenSeekers ? "w" : "-"}${c.reachesMenSeekers ? "m" : "-"}${c.reachesNonbinarySeekers ? "n" : "-"}${c.transStated ? "t" : "-"}`;
const SEGMENT_CLASSES: readonly DatingSegmentClass[] = Array.from({ length: 16 }, (_, k) => ({
  reachesWomenSeekers: (k & 1) !== 0, reachesMenSeekers: (k & 2) !== 0, reachesNonbinarySeekers: (k & 4) !== 0, transStated: (k & 8) !== 0,
}));
const admittedClasses = (m: DatingStatement): string[] => SEGMENT_CLASSES.filter(c => datingClassAdmits(m, c)).map(classKey);

function dateSegmentOf(w: World, p: SlopProfile, market: City, o: SlopPackOptions): EntitySegment | undefined {
  const markets = w.pack.geo.markets(w.cfg);
  if (datingMarkets(p).filter(m => markets.includes(m)).length > 1) return undefined;
  const cell = cellIn(p, market), limit = limitMiles(p, o);
  const statement = datingStatementOf(p);
  const own = dateSegment(classKey(datingSegmentClassOf(statement)), cell?.id ?? "unplaced");
  if (!cell || limit === undefined) return { own, partners: [] };
  const memo = segmentMemoOf(w);
  const classes = admittedClasses(statement);
  const key = `${classes.join(",")}|${cell.id}|${limit}|${o.radiusMargin}`;
  let partners = memo.partners.get(key);
  if (!partners) {
    const cells = reachableCells(memo, cell, limit, o.radiusMargin);
    partners = classes.flatMap(pool => cells.map(c => dateSegment(pool, c)));
    memo.partners.set(key, partners);
  }
  return { own, partners };
}

/** slop.date's match vectors (AppPack.vectors). */
export function slopVectors(o: SlopPackOptions): PackVectors {
  return {
    memberships(w, memberId) {
      if (memberReason(w, memberId, DATING) !== null) return [];
      const p = profilesOf(w).get(memberId), mi = w.get(memberId);
      if (!p || !mi) return [];
      // An open thread already stops the member (rule your_turn); recent proposals use up the week.
      // Every market shares the one weekly capacity: assign.ts counts it per member.
      const capacity = laneLimits(SLOP_MATCH_LANE).weeklyCapacity - mi.recentProactive;
      return datingMemberships(memberId, p, w.pack.geo.markets(w.cfg))
        .map(({ id, market }): Membership => ({ id, lane: SLOP_MATCH_LANE, side: "Peer", market, capacity }));
    },
    tags(w, entity) {
      const p = profilesOf(w).get(entity.memberId);
      return p ? dateTags(p) : { offers: [], seeks: [], interests: [] };
    },
    segment(w, entity) {
      const p = profilesOf(w).get(entity.memberId);
      return p ? dateSegmentOf(w, p, entity.market, o) : undefined;
    },
    // spec/memberStanding.md, "A private photo rating maps onto the standing scale for dating": a
    // member without a usable rating sits in the middle with the widest uncertainty; a rating counts
    // at least one photo.
    standing(w, entity) {
      const p = profilesOf(w).get(entity.memberId);
      const rating = p?.appearance;
      if (p && rating && rating.confidence >= o.appearance.minConfidence && standingReadable(p.adult, p.optedIn)) {
        return { standing: standingFromRating(ratingPermille(rating.overall)), uncertainty: standingUncertainty(rating.photos ?? 1),
          evidenceIds: p.appearanceEvidenceIds };
      }
      return { standing: standingFromRating(standingRatingScale / 2), uncertainty: standingUncertainty(0) };
    },
    packValue(w, a, b) {
      const P = profilesOf(w), pa = P.get(a.memberId), pb = P.get(b.memberId);
      return pa && pb ? datePackValue(pa, pb, o) : 0;
    },
  };
}

/**
 * How many partners the member's bounded searches kept this run, over all their Date markets
 * (Infinity without a Date profile, as for a member with no market or no capacity left this week).
 */
export function dateCandidateCount(w: World, id: MemberId): number {
  const profiles = w.match.profilesOf(id).filter(p => p.lane === SLOP_MATCH_LANE);
  return profiles.length ? profiles.reduce((n, p) => n + w.match.candidates(p).kept.length, 0) : Infinity;
}

const sharedEvidence = (p: SlopProfile, other: SlopProfile): string[] =>
  p.interests.filter(t => other.interests.includes(t)).flatMap(t => { const f = p.interestFacet.get(t); return f ? [f] : []; });

export function slopGenerators(o: SlopPackOptions): GeneratorSpec[] {
  return [{
    name: SLOP_GENERATOR,
    run(ctx: GenCtx): Candidate[] {
      const w = ctx.w;
      const P = profilesOf(w);
      for (const id of w.ids) {
        if (w.match.profileIn(id, SLOP_MATCH_LANE)) continue;
        const reason = memberReason(w, id, DATING);
        if (reason) countExclusion(ctx, reason);
      }
      const markets = w.pack.geo.markets(w.cfg);
      // One candidate per member pair: a pair that meets in several shared markets keeps the edge of
      // the highest value whose market fits both radii, then the one in more home markets, then by market.
      const homes = (x: MatchProfile, y: MatchProfile) => Number(x.id === x.memberId) + Number(y.id === y.memberId);
      const best = new Map<string, { x: MatchProfile; y: MatchProfile; px: SlopProfile; py: SlopProfile; value: number }>();
      for (const edge of w.match.edges(SLOP_MATCH_LANE)) {
        const x = w.match.profile(edge.a), y = w.match.profile(edge.b);
        const px = x && P.get(x.memberId), py = y && P.get(y.memberId);
        if (!x || !y || !px || !py) continue;
        if (!mutualMarkets(px, py, o, markets).some(m => m.market === x.market)) continue;
        const key = pairKey(x.memberId, y.memberId), cur = best.get(key);
        if (cur && ((cur.value - edge.value) || (homes(cur.x, cur.y) - homes(x, y)) || (cur.x.market <= x.market ? 1 : -1)) > 0) continue;
        best.set(key, { x, y, px, py, value: edge.value });
      }
      const out: Candidate[] = [];
      for (const [, { x, y, px, py, value }] of [...best].sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0))) {
        const [first, partner] = firstOf(px, py, w.now);
        const [firstProfile, partnerProfile]: [MatchProfile, MatchProfile] = first === px ? [x, y] : [y, x];
        const intent = w.get(first.id)?.intents.find(i => i.category === SLOP_LANE);
        out.push(pairCandidate(w, firstProfile, partnerProfile, value, {
          generator: SLOP_GENERATOR, kind: "intro", category: SLOP_LANE,
          roles: { [first.id]: "seeker", [partner.id]: "peer" }, format: "one_to_one",
          objective: `${dateActivity(first, partner).replace(/_/g, " ")} date`,
          ...(intent ? { anchor: { type: "intent" as const, id: intent.id } } : {}),
          preferredCity: x.market,
          channels: new Set(["geo", "prefs", "compat"]),
          evidence: { [first.id]: sharedEvidence(first, partner), [partner.id]: sharedEvidence(partner, first) },
          confidenceHint: 1,
        }));
      }
      return out;
    },
  }];
}
