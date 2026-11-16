// The Network's opportunity generators (Section 33.4) as thin readers of the match core: every
// pair value comes from a bounded search (searchFor), and every group is a circle or a coherent set
// whose pairs all have a searched pair value. ORDER IS PART OF THE CONTRACT: the run log's
// funnel.byGenerator serializes in this order, and network_growth consumes the intents that the
// earlier generators left unmatched.
import { needsSecondHomeHelper } from "../../../../core/src/generated/boundedHelp.ts";
import { circleCoherent } from "../../../../core/src/generated/groupFormation.ts";
import { laneLimits, laneOffered, type MatchLane } from "../../../../core/src/generated/matchLane.ts";
import { noPairValue } from "../../../../core/src/generated/pairValue.ts";
import { recentRepeatSource, sameEncounterConsent } from "../../../../core/src/generated/repeatEncounter.ts";
import type { Category, Facet, Intent, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import type { GeneratorName } from "../../config.ts";
import { isHomeEntry, isMinor, memberReason } from "../../filters.ts";
import {
  circleCandidate, eventMembers, eventRiskText, label, makeCandidate, pairCandidate, searchFor, warmPathValue, type GenCtx, type MatchedFields,
} from "../../genkit.ts";
import { circleEvidence, type Circle } from "../../match/circles.ts";
import { compareText, laneCategory, type MatchProfile } from "../../match/profile.ts";
import type { Anchor, Candidate, Format, NetworkEvent, Role } from "../../types.ts";
import { intentText, pairKey, type World } from "../../world.ts";
import { CATEGORY_LABEL } from "./copy.ts";
import { intentWant, MATCH_LANES, memberTags, wantHas } from "./vectors.ts";

function roleOf(p: MatchProfile): Role {
  switch (p.side) {
    case "Peer": return "peer";
    case "Offering": return "provider";
    case "Seeking": return "seeker";
    default: { const _exhaustive: never = p.side; return _exhaustive; }
  }
}

/** Events and their groups are professional introductions or social ones. */
const eventLane = (category: Category): MatchLane => (category === "professional" ? "Intro" : "Friend");

/** The first shareable offer of a member that covers one of `seeks` (for labels and evidence). */
function coveringOffer(w: World, memberId: MemberId, seeks: readonly string[]): Facet | undefined {
  return w.get(memberId)?.share.find(f => (f.kind === "skill" || f.kind === "offer" || f.kind === "resource")
    && f.tags.some(t => seeks.includes(t.trim().toLowerCase())));
}

const coverage = (seeks: readonly string[], offers: ReadonlySet<string>): number => seeks.filter(t => offers.has(t)).length;

/**
 * The pair value of two profiles as their bounded searches found it (either side kept the other, as
 * in mutualEdges); noPairValue when neither did. The pack reads no pair value outside a search, so
 * w.match.tally() counts every pair check that ntwrk makes.
 */
function searchedValue(ctx: GenCtx, a: MatchProfile, b: MatchProfile): number {
  const kept = (x: MatchProfile, y: MatchProfile) => searchFor(ctx, x).kept.find(k => k.profile.id === y.id)?.value;
  return kept(a, b) ?? kept(b, a) ?? noPairValue;
}

/** The lowest pair value a group of the lane accepts; 0 for a pair. */
const groupPairFloor = (lane: MatchLane, size: number): number => (size > 2 ? laneLimits(lane).circlePairFloor : 0);

/** A circle of the lane from a group whose pairs all have a searched pair value, or undefined when it is not coherent. */
function circleOf(ctx: GenCtx, lane: MatchLane, profiles: readonly MatchProfile[]): Circle | undefined {
  if (profiles.length === 0) return undefined;
  const evidence = circleEvidence(profiles, (a, b) => { const value = searchedValue(ctx, a, b); return value >= 0 ? value : undefined; });
  const limits = laneLimits(lane);
  // spec/groupFormation.md, "A primary circle values every pair and keeps a narrow standing spread"
  return circleCoherent(evidence, limits.circleMinimum, limits.circleMaximum, limits.circlePairFloor, limits.rules.parityBand)
    ? { members: profiles.map(p => p.id), evidence } : undefined;
}

// ---------------------------------------------------------------------------------------
// Pairs anchored to a live intent (shared by intent_to_capability and warm_path).
interface AnchoredPair { readonly profile: MatchProfile; readonly partner: MatchProfile; readonly value: number; readonly intent: Intent; readonly offer?: Facet }
interface AnchoredRun { readonly pairs: readonly AnchoredPair[]; readonly unmatched: readonly string[] }
const anchoredRuns = new WeakMap<World, AnchoredRun>();

/**
 * For each profile, its searched partners, each anchored to the profile's intent in that lane that
 * the partner's offers cover best (first intent by id on a tie). At most maxPerIntent pairs per
 * intent, best value first, and one pair per two members. Intro is the fallback lane of every
 * professional want (vectors.ts wantRoles), so its profiles come last: the profiles are sorted by
 * lane name, and Intro before Invest and Mentor would spend each intent's pairs in the fallback lane.
 */
function anchoredPairs(ctx: GenCtx): AnchoredRun {
  const { w } = ctx;
  const done = anchoredRuns.get(w);
  if (done) return done;
  const pairs: AnchoredPair[] = [];
  const paired = new Set<string>();
  const perIntent = new Map<string, number>();
  const fallbackLast = [...w.match.profiles].sort((x, y) => Number(x.lane === "Intro") - Number(y.lane === "Intro"));
  for (const profile of fallbackLast) {
    const intents = (w.get(profile.memberId)?.intents ?? []).filter(i => i.category !== "help" && wantHas(intentWant(w, i), profile));
    if (!intents.length) continue;
    for (const { profile: partner, value } of searchFor(ctx, profile).kept) {
      const key = pairKey(profile.memberId, partner.memberId);
      if (paired.has(key)) continue;
      const offers = memberTags(w, partner.memberId).offers;
      const covered = (i: Intent) => coverage(intentWant(w, i).seeks, offers);
      const intent = intents.reduce((best, i) => (covered(i) > covered(best) ? i : best));
      const used = perIntent.get(intent.id) ?? 0;
      if (used >= w.cfg.maxPerIntent) continue;
      perIntent.set(intent.id, used + 1);
      paired.add(key);
      pairs.push({ profile, partner, value, intent, offer: coveringOffer(w, partner.memberId, intentWant(w, intent).seeks) });
    }
  }
  const unmatched = w.ids.flatMap(id => (w.get(id)?.intents ?? [])
    .filter(i => i.category !== "help" && intentWant(w, i).roles.length > 0 && !perIntent.has(i.id)).map(i => i.id));
  const run = { pairs, unmatched };
  anchoredRuns.set(w, run);
  return run;
}

function anchoredCandidate(w: World, pair: AnchoredPair, rest: Pick<MatchedFields, "kind" | "generator" | "channels" | "via" | "warm">, prefix: string): Candidate {
  const { profile, partner, value, intent, offer } = pair;
  const a = profile.memberId, b = partner.memberId;
  const category = laneCategory(profile.lane);
  return pairCandidate(w, profile, partner, value, {
    ...rest, category, roles: { [a]: roleOf(profile), [b]: roleOf(partner) }, format: "one_to_one",
    objective: `${prefix}: ${label(offer) ?? CATEGORY_LABEL[category]}`,
    anchor: { type: "intent", id: intent.id }, preferredCity: w.get(a)?.m.homeCity,
    evidence: { [a]: [], [b]: offer ? [offer.id] : [] },
    riskText: `${intentText(intent)} ${offer?.value ?? ""}`,
  });
}

// ---------------------------------------------------------------------------------------
// 1. Intent to capability: a one-to-one introduction from a live intent.
export function intentToCapability(ctx: GenCtx): Candidate[] {
  const run = anchoredPairs(ctx);
  for (const id of run.unmatched) ctx.unmatchedIntents.add(id);
  return run.pairs.map(pair => anchoredCandidate(ctx.w, pair, { kind: "intro", generator: "intent_to_capability", channels: new Set(["match"]) }, "Intro"));
}

// ---------------------------------------------------------------------------------------
// 2. Event anchor: members for an event come from the tag postings; each pair needs a searched pair value.
const EVENT_POOL = 6;
const EVENT_PAIRS = 6;
export function eventAnchor(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const horizon = w.now + 2 * w.cfg.windowDays * DAY;
  for (const ev of w.events) {
    if (ev.start > horizon || ev.start < w.now || ev.category === "romance") continue;
    const lane = eventLane(ev.category);
    const timeSensitive = ev.start - w.now < DAY;
    const tags = ev.tags.map(t => t.toLowerCase());
    const pool = eventMembers(ctx, ev, "attendee", timeSensitive).flatMap(id => {
      const profile = w.match.profilesOf(id).find(p => p.lane === lane && p.market === ev.city);
      const mi = w.get(id);
      return profile && mi && w.location(id, ev.start, ev.end).has(ev.city) ? [{ profile, hits: tags.filter(t => mi.tags.has(t)).length }] : [];
    }).sort((x, y) => y.hits - x.hits || compareText(x.profile.id, y.profile.id)).slice(0, EVENT_POOL).map(x => x.profile);
    const pairs: { a: MatchProfile; b: MatchProfile; value: number }[] = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const value = searchedValue(ctx, pool[i], pool[j]);
      if (value >= 0) pairs.push({ a: pool[i], b: pool[j], value });
    }
    pairs.sort((x, y) => y.value - x.value || compareText(x.a.id, y.a.id) || compareText(x.b.id, y.b.id));
    const anchor: Anchor = { type: "event", id: ev.id, label: ev.title };
    for (const { a, b, value } of pairs.slice(0, EVENT_PAIRS)) {
      out.push(pairCandidate(w, a, b, value, {
        kind: "event_coattend", generator: "event_anchor", category: ev.category,
        roles: { [a.memberId]: "attendee", [b.memberId]: "attendee" }, format: "event",
        objective: `Go together: ${ev.title}`, anchor, preferredCity: ev.city, fixedWindow: { start: ev.start, end: ev.end },
        channels: new Set(["match", "event_interest"]), timeSensitive,
        evidence: { [a.memberId]: [], [b.memberId]: [] }, riskText: eventRiskText(ev), riskFlags: ev.riskTags,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 3. Warm path: an anchored pair that a friend of both can introduce. The intermediary is attached
// to a pair that already has a pair value; it never creates a pair.
function warmTie(w: World, a: MemberId, b: MemberId): { via: MemberId; strength: number } | undefined {
  const direct = w.positive.get(a);
  if (!direct || direct.has(b)) return undefined;
  let best: { via: MemberId; strength: number } | undefined;
  for (const via of [...direct.keys()].sort()) {
    // An intermediary on a safety hold or paused never carries a warm path. The warm graph already
    // holds no minor and no blocked pair (World constructor), so neither can be `via`.
    if (w.holds.has(via) || w.get(via)?.m.state === "paused") continue;
    const onward = w.positive.get(via)?.get(b);
    if (onward === undefined) continue;
    const strength = direct.get(via)! * onward;
    if (!best || strength > best.strength) best = { via, strength };
  }
  return best;
}

export function warmPath(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  return anchoredPairs(ctx).pairs.flatMap(pair => {
    const tie = warmTie(w, pair.profile.memberId, pair.partner.memberId);
    return tie ? [anchoredCandidate(w, pair, {
      kind: "member_intro", generator: "warm_path", channels: new Set(["match", "graph"]), via: tie.via, warm: warmPathValue(tie.strength),
    }, "Friend-of-a-friend intro")] : [];
  });
}

// ---------------------------------------------------------------------------------------
// 4. Help request: a bounded ask needs one to three helpers from the asker's searched partners
// (F14 safety rule for home entry). Every pair of the group has a pair value.
function helpersNeeded(text: string): number {
  const m = text.match(/\b([1-3])\s*(people|helpers|hands|persons)\b/i) ?? text.match(/\b(one|two|three)\s*(people|helpers|hands)\b/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3 };
  return m ? (Number(m[1]) || words[m[1]!.toLowerCase()] || 1) : 1;
}

interface Helper { readonly profile: MatchProfile; readonly value: number; readonly covered: number; readonly acquainted: boolean; readonly offer?: Facet }

export function helpRequest(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const a of w.ids) {
    const ma = w.get(a)!;
    for (const intent of ma.intents) {
      if (intent.category !== "help") continue;
      const want = intentWant(w, intent);
      const asker = w.match.profilesOf(a).find(p => wantHas(want, p));
      if (!asker) { ctx.unmatchedIntents.add(intent.id); continue; }
      const text = intentText(intent);
      const home = isHomeEntry(w.cfg, text);
      const rankHelpers = (format: Format): Helper[] => {
        if (!ma.m.prefs.formats.includes(format)
          || memberReason(w, a, { category: "help", role: "seeker", format, timeSensitive: false, ownIntentCreatedAt: intent.createdAt })) return [];
        return searchFor(ctx, asker).kept.flatMap(({ profile, value }): Helper[] => {
          const id = profile.memberId;
          const covered = coverage(want.seeks, memberTags(w, id).offers);
          if ((want.seeks.length > 0 && covered === 0) || !w.get(id)?.m.prefs.formats.includes(format)
            || memberReason(w, id, { category: "help", role: "helper", format, timeSensitive: false })) return [];
          const acquainted = w.edgeHas(a, id, "met") || w.edgeHas(a, id, "knows") || w.edgeHas(a, id, "helped");
          return [{ profile, value, covered, acquainted, offer: coveringOffer(w, id, want.seeks) }];
        }).sort((x, y) => y.covered - x.covered || Number(home && y.acquainted) - Number(home && x.acquainted)
          || y.value - x.value || compareText(x.profile.id, y.profile.id));
      };
      let need = helpersNeeded(text);
      let ranked = rankHelpers(need > 1 ? "small_group" : "one_to_one");
      if (needsSecondHomeHelper(home, need, ranked[0]?.acquainted === true)) {
        need = 2;
        ranked = rankHelpers("small_group");
      }
      // A group (asker and two or more helpers) is a circle of the asker's lane: every pair at the
      // lane's circle pair floor, and a lane that forms no circles gets no group.
      const floor = groupPairFloor(asker.lane, need + 1);
      ranked = ranked.filter(h => h.value >= floor);
      if (ranked.length < need) { ctx.unmatchedIntents.add(intent.id); continue; }
      const fits = (helpers: readonly Helper[], h: Helper) => helpers.every(g => searchedValue(ctx, g.profile, h.profile) >= floor);
      // Up to three helper-set variants so one busy helper does not sink the whole request.
      const seenSets = new Set<string>();
      let proposed = false;
      for (let v = 0; v < 3; v++) {
        const helpers: Helper[] = [];
        for (const h of ranked.slice(v)) {
          if (helpers.length >= need) break;
          if (fits(helpers, h)) helpers.push(h);
        }
        if (helpers.length < need) break;
        const setKey = helpers.map(h => h.profile.memberId).sort().join(",");
        if (seenSets.has(setKey)) continue;
        seenSets.add(setKey);
        const ids = [a, ...helpers.map(h => h.profile.memberId)];
        // Alternates must be able to join this group: a pair value with every helper.
        const alternates = ranked.filter(r => !ids.includes(r.profile.memberId) && fits(helpers, r)).slice(0, 3).map(r => r.profile.memberId);
        const rest: MatchedFields = {
          kind: "help", generator: "help_request", category: "help",
          roles: Object.fromEntries([[a, "seeker"], ...helpers.map(h => [h.profile.memberId, "helper"])]), format: need > 1 ? "small_group" : "one_to_one",
          objective: `Help with: ${label(helpers[0]!.offer) ?? "a bounded task"}`, anchor: { type: "intent", id: intent.id },
          preferredCity: ma.m.homeCity, channels: new Set(["match"]),
          evidence: Object.fromEntries([[a, []], ...helpers.map(h => [h.profile.memberId, h.offer ? [h.offer.id] : []])]),
          alternates, safetyClass: home ? "medium" : "low", riskText: text,
        };
        if (helpers.length === 1) { out.push(pairCandidate(w, asker, helpers[0]!.profile, helpers[0]!.value, rest)); proposed = true; continue; }
        // The asker comes first: the home-entry rule reads participants[0] as the requester.
        const circle = circleOf(ctx, asker.lane, [asker, ...helpers.map(h => h.profile)]);
        if (circle) { out.push(circleCandidate(w, circle, asker.lane, rest)); proposed = true; }
      }
      if (!proposed) ctx.unmatchedIntents.add(intent.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 5. Group composer: the circles of every lane that forms them, around a shared shareable theme.
function sharedTheme(w: World, ids: readonly MemberId[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const own = new Set((w.get(id)?.share ?? []).filter(f => f.kind === "interest" || f.kind === "desire").flatMap(f => f.tags.map(t => t.toLowerCase())));
    for (const tag of own) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const [best] = [...counts].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || compareText(x[0], y[0]));
  return best?.[0];
}

export function groupComposer(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const lane of MATCH_LANES) {
    if (!laneOffered(w.pack.id, lane) || laneLimits(lane).circleMaximum === 0) continue;
    const category = laneCategory(lane);
    for (const circle of w.match.circles(lane)) {
      const profiles = circle.members.flatMap(id => { const p = w.match.profile(id); return p ? [p] : []; });
      const ids = profiles.map(p => p.memberId);
      const market = profiles[0]?.market;
      const theme = sharedTheme(w, ids);
      out.push(circleCandidate(w, circle, lane, {
        kind: "group", generator: "group_composer", category,
        roles: Object.fromEntries(ids.map(id => [id, "guest"])), format: "small_group",
        objective: theme ? `Small group around ${theme}` : `Small group: ${CATEGORY_LABEL[category]}`,
        anchor: theme && market ? { type: "interest", id: `${market}:${theme}`, label: theme } : undefined,
        preferredCity: market, channels: new Set(["match", "group"]),
        evidence: Object.fromEntries(ids.map(id => [id, theme ? (w.get(id)?.share ?? []).filter(f => f.tags.some(t => t.toLowerCase() === theme)).map(f => f.id) : []])),
        riskText: theme ?? CATEGORY_LABEL[category],
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 6. Second encounter: a mutually positive completed meeting, still a pair with a pair value, plus
// a natural next context (an upcoming event on a shared interest).
function bestLanePair(ctx: GenCtx, a: MemberId, b: MemberId): { a: MatchProfile; b: MatchProfile; value: number } | undefined {
  let best: { a: MatchProfile; b: MatchProfile; value: number } | undefined;
  for (const pa of ctx.w.match.profilesOf(a)) for (const pb of ctx.w.match.profilesOf(b)) {
    if (pa.lane !== pb.lane) continue;
    const value = searchedValue(ctx, pa, pb);
    if (value >= 0 && (!best || value > best.value)) best = { a: pa, b: pb, value };
  }
  return best;
}

export function secondEncounter(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const horizon = w.now + 2 * w.cfg.windowDays * DAY;
  const eventsByTag = new Map<string, NetworkEvent[]>();
  for (const ev of w.events) {
    if (ev.start < w.now || ev.start > horizon) continue;
    for (const tag of new Set(ev.tags.map(t => t.toLowerCase()))) {
      const list = eventsByTag.get(tag);
      if (list) list.push(ev); else eventsByTag.set(tag, [ev]);
    }
  }
  const done = new Set<string>();
  // Repeat answers indexed once per run by (from, about), so each pair reads only its own answers.
  const repeatAnswers = new Map<string, string[]>();
  for (const f of w.feedback) {
    if (f.repeatConsent !== true) continue;
    const k = `${f.from}|${f.about}`;
    const list = repeatAnswers.get(k);
    if (list) list.push(f.opportunityId ?? ""); else repeatAnswers.set(k, [f.opportunityId ?? ""]);
  }
  const wantsRepeat = (from: MemberId, about: MemberId, oppId: string) =>
    (repeatAnswers.get(`${from}|${about}`) ?? []).some(answered => sameEncounterConsent(true, answered, oppId));
  const recentDone = w.interactions.filter(r => recentRepeatSource(r.outcome === "completed", r.participants.length === 2, w.now - r.at))
    .sort((a, b) => (b.at - a.at) || compareText(a.id, b.id));
  for (const r of recentDone) {
    const [a, b] = r.participants;
    if (a === undefined || b === undefined) continue;
    const k = pairKey(a, b);
    if (done.has(k)) continue;
    done.add(k);
    if (!wantsRepeat(a, b, r.id) || !wantsRepeat(b, a, r.id)) continue;
    const ma = w.get(a), mb = w.get(b);
    const pair = bestLanePair(ctx, a, b);
    if (!ma || !mb || !pair) continue;
    // Next context: the upcoming event with the most shared interests (earliest first on a tie).
    const theirs = memberTags(w, b).interests;
    const hits = new Map<NetworkEvent, number>();
    for (const tag of memberTags(w, a).interests) if (theirs.has(tag)) for (const ev of eventsByTag.get(tag) ?? []) hits.set(ev, (hits.get(ev) ?? 0) + 1);
    const event = [...hits].sort((x, y) => y[1] - x[1] || x[0].start - y[0].start || compareText(x[0].id, y[0].id))[0]?.[0];
    const category: Category = event?.category ?? laneCategory(pair.a.lane);
    const format: Format = event ? "event" : "one_to_one";
    if (memberReason(w, a, { category, role: "peer", format, timeSensitive: false })
      || memberReason(w, b, { category, role: "peer", format, timeSensitive: false })) continue;
    const shared = ma.share.find(f => f.tags.some(t => mb.share.some(g => g.tags.includes(t))));
    out.push(pairCandidate(w, pair.a, pair.b, pair.value, {
      kind: "second_encounter", generator: "second_encounter", category,
      roles: { [a]: "peer", [b]: "peer" }, format,
      objective: event ? `See each other again at ${event.title}` : `Another meetup${shared ? ` around ${shared.tags[0] ?? "a shared interest"}` : ""}`,
      anchor: event ? { type: "event", id: event.id, label: event.title } : { type: "interaction", id: r.id },
      preferredCity: event ? event.city : ma.m.homeCity,
      fixedWindow: event ? { start: event.start, end: event.end } : undefined,
      channels: new Set(["history", ...(event ? ["event_interest"] : [])]),
      evidence: { [a]: shared ? [shared.id] : [], [b]: mb.share.filter(g => shared?.tags.some(t => g.tags.includes(t))).map(g => g.id).slice(0, 1) },
      warm: 1, confidenceHint: 0.95,
      riskText: event ? eventRiskText(event) : (shared?.value ?? ""), riskFlags: event?.riskTags,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 7. Newcomer welcome: a new member, a host and friendly members from the newcomer's own search.
const WELCOME_LANE: MatchLane = "Friend";
const WELCOME_MIN = 3;
const WELCOME_MAX = 4;
export function newcomerWelcome(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const category = laneCategory(WELCOME_LANE);
  for (const n of w.ids) {
    if (!w.get(n)?.newcomer) continue;
    if (memberReason(w, n, { category, role: "newcomer", format: "small_group", timeSensitive: false })) continue;
    const profile = w.match.profilesOf(n).find(p => p.lane === WELCOME_LANE);
    if (!profile) continue;
    const others = searchFor(ctx, profile).kept.map(k => k.profile).filter(p => {
      const mi = w.get(p.memberId);
      return !!mi && !mi.newcomer && (mi.m.state === "open" || mi.m.state === "normal");
    });
    const floor = laneLimits(WELCOME_LANE).circlePairFloor;
    const host = others.find(p => w.get(p.memberId)?.isHost && searchedValue(ctx, profile, p) >= floor
      && !memberReason(w, p.memberId, { category, role: "host", format: "small_group", timeSensitive: false }));
    if (!host) continue;
    const group = [profile, host];
    for (const p of others) {
      if (group.length >= WELCOME_MAX) break;
      if (p !== host && group.every(g => searchedValue(ctx, g, p) >= floor)) group.push(p);
    }
    const circle = group.length >= WELCOME_MIN ? circleOf(ctx, WELCOME_LANE, group) : undefined;
    if (!circle) continue;
    const roles: Record<MemberId, Role> = Object.fromEntries(group.map(p => [p.memberId, p === profile ? "newcomer" : p === host ? "host" : "guest"]));
    out.push(circleCandidate(w, circle, WELCOME_LANE, {
      kind: "newcomer_welcome", generator: "newcomer_welcome", category, roles, format: "small_group",
      objective: "First-week welcome coffee", anchor: { type: "member", id: n }, preferredCity: profile.market,
      channels: new Set(["newcomer", "match", "group"]), evidence: Object.fromEntries(group.map(p => [p.memberId, []])),
      riskText: "welcome coffee", confidenceHint: 0.85,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 8. Network growth: ask members whose tags cover a gap to bring in someone who fills it.
const MAX_GAPS = 12;
const CONNECTORS_PER_GAP = 2;
const HOST_TAGS: readonly string[] = ["host", "hosting"];
export function networkGrowth(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  type Gap = { id: string; city: string; label: string; tags: readonly string[]; owners: ReadonlySet<MemberId> };
  const gaps: Gap[] = [];
  // (a) Unmet intents, grouped by city + category (never reveal the intent text).
  const byCat = new Map<string, Intent[]>();
  for (const iid of [...ctx.unmatchedIntents].sort()) {
    const it = w.intentById.get(iid);
    // Minors policy: a minor's unmet need never becomes a growth ask shown to adults.
    if (!it || isMinor(w, it.memberId)) continue;
    const k = `${w.get(it.memberId)!.m.homeCity}:${it.category}`;
    const list = byCat.get(k);
    if (list) list.push(it); else byCat.set(k, [it]);
  }
  for (const [k, its] of byCat) {
    const [city, cat] = k.split(":") as [string, Category];
    gaps.push({
      id: `unmet:${k}`, city, label: `someone for ${CATEGORY_LABEL[cat]}`,
      tags: [...new Set(its.flatMap(i => intentWant(w, i).seeks))].sort(), owners: new Set(its.map(i => i.memberId)),
    });
  }
  // (b) Areas with members but no host.
  const areaMembers = new Map<string, MemberId[]>();
  for (const id of w.ids) {
    if (isMinor(w, id)) continue; // minors never count toward (or reveal) a host-less area
    for (const p of w.get(id)!.presence) if (p.type === "home") for (const area of p.areas) {
      const k = `${p.city}:${area}`;
      const list = areaMembers.get(k);
      if (list) list.push(id); else areaMembers.set(k, [id]);
    }
  }
  for (const [k, ids] of [...areaMembers].sort((p, q) => compareText(p[0], q[0]))) {
    if (ids.length >= 3 && !ids.some(id => w.get(id)!.isHost)) {
      const [city, area] = k.split(":") as [string, string];
      gaps.push({ id: `nohost:${k}`, city, label: `a host in ${area}`, tags: HOST_TAGS, owners: new Set() });
    }
  }
  const asked = new Set<MemberId>();
  for (const gap of gaps.slice(0, MAX_GAPS)) {
    if (!gap.tags.length) continue;
    const hits = new Map<MemberId, number>();
    for (const tag of gap.tags) for (const id of w.tagPostings.get(tag) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    const connectors = [...hits].filter(([id]) => {
      const mi = w.get(id);
      return !!mi && mi.m.homeCity === gap.city && !mi.newcomer && !asked.has(id) && !gap.owners.has(id)
        && !memberReason(w, id, { category: "growth", role: "connector", format: "one_to_one", timeSensitive: false });
    }).sort((x, y) => y[1] - x[1] || compareText(x[0], y[0])).slice(0, CONNECTORS_PER_GAP);
    for (const [id, n] of connectors) {
      asked.add(id);
      const fit = n / gap.tags.length;
      out.push(makeCandidate({
        kind: "network_growth", generator: "network_growth", category: "growth",
        participants: [id], roles: { [id]: "connector" }, format: "one_to_one",
        objective: `Know ${gap.label}?`, anchor: { type: "gap", id: gap.id, label: gap.label },
        preferredCity: w.get(id)!.m.homeCity, channels: new Set(["network_health"]), evidence: { [id]: [] },
        fit, benefit: { [id]: fit }, riskText: gap.label, confidenceHint: 0.85,
      }));
    }
  }
  return out;
}

export const NETWORK_GENERATORS: { name: GeneratorName; run: (ctx: GenCtx) => Candidate[] }[] = [
  { name: "intent_to_capability", run: intentToCapability },
  { name: "event_anchor", run: eventAnchor },
  { name: "warm_path", run: warmPath },
  { name: "help_request", run: helpRequest },
  { name: "group_composer", run: groupComposer },
  { name: "second_encounter", run: secondEncounter },
  { name: "newcomer_welcome", run: newcomerWelcome },
  // Must run after the intent-driven generators: it consumes unmatched intents.
  { name: "network_growth", run: networkGrowth },
];
