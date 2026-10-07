// Opportunity generators (Section 33.4). Each proposes candidate configurations of one type;
// all share retrieval (retrieval.ts), hard filters (filters.ts), scoring and policy.
import type { Category, Facet, Intent, MemberId, OpportunityKind } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { GeneratorName } from "./config.ts";
import { cosine, tokenize } from "./embed.ts";
import { isHomeEntry, isMinor, memberReason, pairReason } from "./filters.ts";
import { composeGroup } from "./group.ts";
import { eligibleMembers, retrieveByEmbedding, retrieveForIntent, twoHop, type RetrievalCtx } from "./retrieval.ts";
import type { Rng } from "./rng.ts";
import type { Anchor, Candidate, Format, NetworkEvent, Role } from "./types.ts";
import { intentText, pairKey, type MemberIndex, type World } from "./world.ts";

export interface GenCtx extends RetrievalCtx {
  rng: Rng;
  /** Intents for which retrieval found nobody (input to network growth + empty states). */
  unmatchedIntents: Set<string>;
}

const CATEGORY_LABEL: Record<Category, string> = {
  social: "a social introduction", professional: "a professional introduction", romance: "a dinner introduction",
  hobby: "a shared-hobby meetup", help: "a bounded help request", events: "an event together", growth: "growing the Network",
};

function makeCandidate(p: Omit<Candidate, "key" | "alternates" | "exploration" | "safetyClass" | "timeSensitive" | "riskText" | "warm" | "channels"> & Partial<Candidate>): Candidate {
  const parts = [...p.participants];
  return {
    key: `${p.generator}:${p.kind}:${p.anchor?.id ?? "-"}:${[...parts].sort().join(",")}`,
    alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: p.objective,
    warm: 0, channels: new Set(), ...p,
  } as Candidate;
}

/** A shareable label for a facet (tags first, then the short value). Only call with shareable facets. */
function label(f: Facet | undefined): string | undefined {
  if (!f || f.scope !== "shareable") return undefined;
  return f.tags[0] ?? f.value.split(/[.,;]/)[0]!.slice(0, 40);
}

/** Best shareable facet of `of` relative to embedding q (used for objectives / explanations). */
function bestShareable(w: World, of: MemberIndex, q: number[]): Facet | undefined {
  let best: Facet | undefined; let bs = -1;
  for (const f of of.share) {
    const e = of.facetEmb.get(f.id);
    if (!e) continue;
    const s = cosine(q, e);
    if (s > bs || (s === bs && best && f.id < best.id)) { bs = s; best = f; }
  }
  return best;
}

export function intentFormat(i: Intent): Format { return /\b(group|band|team|crew|club|doubles|people)\b/i.test(intentText(i)) ? "small_group" : "one_to_one"; }

function benefitForProvider(w: World, provider: MemberIndex, seeker: MemberIndex, facet?: Facet): number {
  const interest = cosine(provider.desireEmb, seeker.profileEmb);
  const enjoys = facet?.kind === "offer" ? 0.6 : facet ? 0.35 : 0.2;
  return Math.min(1, Math.max(enjoys, enjoys + 0.4 * Math.max(0, interest)));
}

// ---------------------------------------------------------------------------------------
// 1. Intent to capability
export function intentToCapability(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const a of w.ids) {
    const ma = w.get(a)!;
    for (const intent of ma.intents) {
      if (intent.category === "help" || intent.category === "romance" || intent.category === "growth") continue;
      if (memberReason(w, a, { category: intent.category, role: "seeker", format: intentFormat(intent), timeSensitive: false, ownIntentCreatedAt: intent.createdAt })) continue;
      // Only people the seeker can actually meet this window (home city, routine city or a trip):
      // otherwise far-away members take the top-K slots and are all dropped later as
      // no_presence_overlap, starving the intent of a nearby match.
      const pool = eligibleMembers(ctx, intent.category, "provider", "one_to_one", false, new Set([a])).filter(id => w.canMeet([a, id]) && !pairReason(w, a, id, intent.category));
      const got = retrieveForIntent(ctx, intent, pool, "caps", w.cfg.retrieval.minSim);
      if (!got.length) { ctx.unmatchedIntents.add(intent.id); continue; }
      for (const r of got.slice(0, w.cfg.maxPerIntent)) {
        const mb = w.get(r.id)!;
        const shared = bestShareable(w, mb, w.intentEmb.get(intent.id)!);
        out.push(makeCandidate({
          kind: "intro", generator: "intent_to_capability", category: intent.category,
          participants: [a, r.id], roles: { [a]: "seeker", [r.id]: "provider" }, format: "one_to_one",
          objective: `Intro: ${label(r.facet) ?? label(shared) ?? CATEGORY_LABEL[intent.category]}`,
          anchor: { type: "intent", id: intent.id }, preferredCity: ma.m.homeCity,
          channels: r.channels, evidence: { [a]: [], [r.id]: [r.facet?.id, shared?.id].filter(Boolean) as string[] },
          fit: r.sim, benefit: { [a]: r.sim, [r.id]: benefitForProvider(w, mb, ma, r.facet) },
          warm: r.channels.has("graph") ? 0.4 : 0, riskText: `${intentText(intent)} ${r.facet?.value ?? ""}`,
        }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 2. Complementary intents (each intent fits the other member) — also the romance path.
export function complementaryIntents(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const all: Intent[] = w.ids.flatMap(id => w.get(id)!.intents).filter(i => !["help", "growth", "romance"].includes(i.category));
  for (let x = 0; x < all.length; x++) for (let y = x + 1; y < all.length; y++) {
    const i = all[x]!, j = all[y]!;
    if (i.memberId === j.memberId || i.category !== j.category) continue;
    const a = i.memberId, b = j.memberId;
    if (pairReason(w, a, b, i.category)) continue;
    if (!w.canMeet([a, b])) continue;
    const ma = w.get(a)!, mb = w.get(b)!;
    const fab = w.intentFit(i, mb, "match"), fba = w.intentFit(j, ma, "match");
    const min = w.cfg.retrieval.minSim;
    if (fab.sim < min || fba.sim < min) continue;
    const fmt: Format = intentFormat(i);
    const ok = (id: MemberId, own: Intent) => !memberReason(w, id, { category: i.category, role: "peer", format: fmt, timeSensitive: false, ownIntentCreatedAt: own.createdAt });
    if (!ok(a, i) || !ok(b, j)) continue;
    const sharedA = label(fab.facet) ?? label(bestShareable(w, mb, w.intentEmb.get(i.id)!));
    out.push(makeCandidate({
      kind: "intro", generator: "complementary_intents", category: i.category,
      participants: [a, b], roles: { [a]: "peer", [b]: "peer" }, format: fmt,
      objective: `Intro: ${sharedA ?? CATEGORY_LABEL[i.category]}`,
      anchor: { type: "intent", id: i.id }, preferredCity: ma.m.homeCity,
      channels: new Set(["semantic", "intent_pair"]),
      evidence: { [a]: [fba.facet?.id].filter(Boolean) as string[], [b]: [fab.facet?.id].filter(Boolean) as string[] },
      fit: (fab.sim + fba.sim) / 2, benefit: { [a]: fab.sim, [b]: fba.sim },
      riskText: `${intentText(i)} ${intentText(j)}`,
    }));
  }
  out.push(...romanceIntros(ctx));
  return out;
}

/**
 * Romance path (part of complementary_intents). Each live romance intent is matched against
 * every other member who has opted in to romance, whether or not they currently have a romance
 * intent of their own: opting in to the romance category is the consent to receive romance
 * proposals, and the invitation itself is still double opt-in (both must accept, 32.10).
 *
 * Hard rules come from the shared filters: both members romance-opted-in with romance in their
 * categories (memberReason), both 18+ (memberReason + pairReason), not blocked, no dealbreaker,
 * and each side's stated orientation / age range admits the other (pairReason). A member who is
 * "only when I ask" is only matched through their own fresh intent.
 *
 * Previously romance only paired two members who BOTH had a live romance intent and scored the
 * pair purely on intent-text similarity, which "meet someone to date" rarely clears: the
 * synthetic v1 run produced 0 romance proposals from 88 live intents and 207 opted-in adults.
 * Fit now also uses shared interests (desire centroids), and mutually satisfied stated
 * preferences count as evidence.
 */
export function romanceIntros(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const minSim = w.cfg.retrieval.minSim;
  const intents = w.ids.flatMap(id => w.get(id)!.intents).filter(i => i.category === "romance");
  const byPair = new Map<string, Candidate>();
  if (!intents.length) return out;
  const ownIntent = new Map<MemberId, Intent>();
  for (const i of intents) if (!ownIntent.has(i.memberId)) ownIntent.set(i.memberId, i);
  const check = (id: MemberId, own?: Intent) => memberReason(w, id, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: own?.createdAt });
  // Partners: every member who may receive a romance proposal right now (generic check; a member
  // whose only route is their own fresh intent is admitted with that intent).
  // v1.2 (config.romance.requireStatedPrefs): romance only between members who both stated who
  // they hope to meet; the engine asks the others first (engine.ts asks).
  const statedPrefs = (id: MemberId) => !w.cfg.romance.requireStatedPrefs || !!w.get(id)!.romance?.seeks.length;
  const partners = w.ids.filter(id => statedPrefs(id) && (!check(id) || (ownIntent.has(id) && !check(id, ownIntent.get(id)))));
  for (const i of intents) {
    const a = i.memberId;
    if (check(a, i) || !statedPrefs(a)) continue;
    const ma = w.get(a)!;
    const found: Candidate[] = [];
    for (const b of partners) {
      if (b === a || pairReason(w, a, b, "romance") || !w.canMeet([a, b])) continue;
      const mb = w.get(b)!;
      const j = ownIntent.get(b);
      if (check(b, j)) continue;
      const fab = w.intentFit(i, mb, "match");
      const fba = j ? w.intentFit(j, ma, "match") : { sim: cosine(mb.desireEmb, ma.profileEmb), facet: undefined };
      const shared = Math.max(0, cosine(ma.desireEmb, mb.desireEmb));
      const sideA = Math.max(fab.sim, shared);
      const sideB = j ? Math.max(fba.sim, shared) : 0.85 * Math.max(fba.sim, shared);
      if (sideA < minSim || sideB < minSim * 0.75) continue;
      // Both sides stated preferences and each admits the other (checked in pairReason).
      const prefBonus = ma.romance && mb.romance && ma.romance.seeks.length && mb.romance.seeks.length ? 0.1 : 0;
      const bA = Math.min(1, sideA + prefBonus), bB = Math.min(1, sideB + prefBonus);
      found.push(makeCandidate({
        kind: "intro", generator: "complementary_intents", category: "romance",
        participants: [a, b], roles: { [a]: "peer", [b]: "peer" }, format: "one_to_one",
        objective: "A low-key dinner introduction", anchor: { type: "intent", id: i.id }, preferredCity: ma.m.homeCity,
        channels: new Set(["semantic", "romance_prefs", ...(j ? ["intent_pair"] : [])]),
        evidence: { [a]: [fba.facet?.id].filter(Boolean) as string[], [b]: [fab.facet?.id].filter(Boolean) as string[] },
        fit: (bA + bB) / 2, benefit: { [a]: bA, [b]: bB },
        riskText: `${intentText(i)} ${j ? intentText(j) : ""}`,
      }));
    }
    found.sort((p, q) => (q.fit - p.fit) || (p.key < q.key ? -1 : 1));
    for (const c of found.slice(0, w.cfg.maxPerIntent)) {
      // When both members have a romance intent the pair is found twice: keep one.
      const k = pairKey(c.participants[0]!, c.participants[1]!);
      const cur = byPair.get(k);
      if (!cur || c.fit > cur.fit || (c.fit === cur.fit && c.key < cur.key)) byPair.set(k, c);
    }
  }
  out.push(...[...byPair.values()].sort((p, q) => (p.key < q.key ? -1 : 1)));
  return out;
}

// ---------------------------------------------------------------------------------------
// 3. Shared intent pooling: several members want the same thing -> a pair or a group.
export function sharedIntentPooling(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const all: Intent[] = w.ids.flatMap(id => w.get(id)!.intents).filter(i => !["help", "romance", "growth"].includes(i.category));
  const seenSets = new Set<string>();
  for (const seed of all) {
    const se = w.intentEmb.get(seed.id)!;
    const fmt = intentFormat(seed);
    if (memberReason(w, seed.memberId, { category: seed.category, role: "peer", format: fmt, timeSensitive: false, ownIntentCreatedAt: seed.createdAt })) continue;
    const similar: { id: MemberId; sim: number; intent: Intent }[] = [];
    for (const o of all) {
      if (o.memberId === seed.memberId || o.category !== seed.category) continue;
      const s = cosine(se, w.intentEmb.get(o.id)!);
      if (s < w.cfg.retrieval.poolSim) continue;
      if (!w.canMeet([seed.memberId, o.memberId]) || pairReason(w, seed.memberId, o.memberId, seed.category)) continue;
      if (memberReason(w, o.memberId, { category: seed.category, role: "peer", format: fmt, timeSensitive: false, ownIntentCreatedAt: o.createdAt })) continue;
      if (similar.some(x => x.id === o.memberId)) continue;
      similar.push({ id: o.memberId, sim: s, intent: o });
    }
    similar.sort((p, q) => (q.sim - p.sim) || (p.id < q.id ? -1 : 1));
    if (!similar.length) continue;
    const ma = w.get(seed.memberId)!;
    const theme = bestShareable(w, ma, se);
    if (similar.length >= 2 && fmt === "small_group") {
      const pool = [{ id: seed.memberId, affinity: 1 }, ...similar.map(s => ({ id: s.id, affinity: s.sim }))];
      const g = composeGroup(w, {
        pool, forced: [seed.memberId], category: seed.category, minSize: w.cfg.group.minSize, maxSize: Math.min(w.cfg.group.maxSize, pool.length),
        window: { start: w.now, end: w.now + w.cfg.windowDays * DAY }, preferredCity: ma.m.homeCity, needHost: false, forcedRole: "peer",
        beamWidth: w.cfg.group.beamWidth, minPairwise: w.cfg.group.minPairwise, alternates: w.cfg.group.alternates,
      });
      if (g) {
        const k = [...g.primary].sort().join(",");
        if (!seenSets.has(k)) {
          seenSets.add(k);
          const sims = new Map(similar.map(s => [s.id, s.sim]));
          out.push(makeCandidate({
            kind: "group", generator: "shared_intent_pooling", category: seed.category,
            participants: g.primary, roles: Object.fromEntries(g.primary.map(id => [id, "peer" as Role])), format: "small_group",
            objective: `Small group: ${label(theme) ?? CATEGORY_LABEL[seed.category]}`, anchor: { type: "intent", id: seed.id },
            preferredCity: g.city, channels: new Set(["semantic", "intent_pool"]), evidence: Object.fromEntries(g.primary.map(id => [id, []])),
            fit: g.stats.avgPairwise * 0.3 + 0.7 * (g.primary.filter(id => id !== seed.memberId).reduce((s, id) => s + (sims.get(id) ?? 0), 0) / (g.primary.length - 1)),
            benefit: Object.fromEntries(g.primary.map(id => [id, id === seed.memberId ? 0.8 : (sims.get(id) ?? 0.3)])),
            alternates: g.alternates, groupStats: g.stats, warm: g.stats.warmTies > 0 ? 0.5 : 0,
            // Risk text from the members actually in the group (not every similar intent).
            riskText: [seed, ...similar.filter(s => g.primary.includes(s.id)).map(s => s.intent)].map(intentText).join(" "),
          }));
        }
      }
    }
    const top = similar[0]!;
    const k = [seed.memberId, top.id].sort().join(",");
    if (seenSets.has(k)) continue;
    seenSets.add(k);
    out.push(makeCandidate({
      kind: "intro", generator: "shared_intent_pooling", category: seed.category,
      participants: [seed.memberId, top.id], roles: { [seed.memberId]: "peer", [top.id]: "peer" }, format: "one_to_one",
      objective: `Intro: ${label(theme) ?? CATEGORY_LABEL[seed.category]}`, anchor: { type: "intent", id: seed.id },
      preferredCity: ma.m.homeCity, channels: new Set(["semantic", "intent_pool"]),
      evidence: { [seed.memberId]: [], [top.id]: [] }, fit: top.sim, benefit: { [seed.memberId]: top.sim, [top.id]: top.sim },
      riskText: `${intentText(seed)} ${intentText(top.intent)}`,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 4. Event anchor: an event fits several members; go together or meet there.
export function eventAnchor(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const horizon = w.now + 2 * w.cfg.windowDays * DAY;
  for (const ev of w.events) {
    if (ev.start > horizon || ev.start < w.now) continue;
    const timeSensitive = ev.start - w.now < DAY;
    const pool = eligibleMembers(ctx, ev.category, "attendee", "event", timeSensitive, new Set())
      .filter(id => w.location(id, ev.start, ev.end).has(ev.city));
    const got = retrieveByEmbedding(ctx, w.eventEmb.get(ev.id)!, pool, w.cfg.retrieval.minSim);
    const top = got.slice(0, 6);
    const anchor: Anchor = { type: "event", id: ev.id, label: ev.title };
    let pairs = 0;
    for (let i = 0; i < top.length && pairs < 6; i++) for (let j = i + 1; j < top.length && pairs < 6; j++) {
      const a = top[i]!, b = top[j]!;
      if (pairReason(w, a.id, b.id, ev.category)) continue;
      pairs++;
      out.push(makeCandidate({
        kind: "event_coattend", generator: "event_anchor", category: ev.category,
        participants: [a.id, b.id], roles: { [a.id]: "attendee", [b.id]: "attendee" }, format: "event",
        objective: `Go together: ${ev.title}`, anchor, preferredCity: ev.city, fixedWindow: { start: ev.start, end: ev.end },
        channels: new Set([...a.channels, "event_interest"]), timeSensitive,
        evidence: { [a.id]: [a.facet?.id].filter(Boolean) as string[], [b.id]: [b.facet?.id].filter(Boolean) as string[] },
        fit: (a.sim + b.sim) / 2, benefit: { [a.id]: a.sim, [b.id]: b.sim }, riskText: eventRiskText(ev), riskFlags: ev.riskTags,
      }));
    }
    if (got.length >= w.cfg.group.minSize) {
      const g = composeGroup(w, {
        pool: got.slice(0, w.cfg.group.poolSize).map(r => ({ id: r.id, affinity: r.sim })), category: ev.category,
        minSize: w.cfg.group.minSize, maxSize: Math.min(4, w.cfg.group.maxSize), window: { start: ev.start, end: ev.end },
        preferredCity: ev.city, requireCity: true, needHost: false, format: "event",
        beamWidth: w.cfg.group.beamWidth, minPairwise: w.cfg.group.minPairwise, alternates: w.cfg.group.alternates,
      });
      if (g) {
        const sims = new Map(got.map(r => [r.id, r]));
        out.push(makeCandidate({
          kind: "event_coattend", generator: "event_anchor", category: ev.category,
          participants: g.primary, roles: Object.fromEntries(g.primary.map(id => [id, (g.roles[id] === "host" ? "host" : "attendee") as Role])), format: "event",
          objective: `Small crew for ${ev.title}`, anchor, preferredCity: ev.city, fixedWindow: { start: ev.start, end: ev.end },
          channels: new Set(["semantic", "event_interest", "group"]), timeSensitive,
          evidence: Object.fromEntries(g.primary.map(id => [id, [sims.get(id)?.facet?.id].filter(Boolean) as string[]])),
          fit: g.primary.reduce((s, id) => s + (sims.get(id)?.sim ?? 0), 0) / g.primary.length,
          benefit: Object.fromEntries(g.primary.map(id => [id, sims.get(id)?.sim ?? 0])),
          alternates: g.alternates, groupStats: g.stats, warm: g.stats.warmTies > 0 ? 0.5 : 0, riskText: eventRiskText(ev), riskFlags: ev.riskTags,
        }));
      }
    }
  }
  return out;
}
function eventRiskText(ev: NetworkEvent) { return `${ev.title} ${ev.description ?? ""} ${ev.tags.join(" ")} ${(ev.riskTags ?? []).join(" ")}`; }

// ---------------------------------------------------------------------------------------
// 5. Warm path: a friend-of-a-friend fits what someone asked about.
export function warmPath(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const a of w.ids) {
    const ma = w.get(a)!;
    if (!ma.intents.length) continue;
    const hop = twoHop(w, a);
    if (!hop.size) continue;
    for (const intent of ma.intents) {
      if (["help", "romance", "growth"].includes(intent.category)) continue;
      if (memberReason(w, a, { category: intent.category, role: "seeker", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: intent.createdAt })) continue;
      const found: Candidate[] = [];
      for (const [b, path] of [...hop.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
        const mb = w.get(b);
        if (!mb || isMinor(w, b) || isMinor(w, path.via)) continue;
        // Pair rules before ranking, so a blocked / dealbreaker pair never takes one of the slots.
        if (!w.canMeet([a, b]) || pairReason(w, a, b, intent.category)) continue;
        const f = w.intentFit(intent, mb, "match");
        if (f.sim < w.cfg.retrieval.warmMinSim) continue;
        const role: Role = f.facet && ["skill", "offer", "resource"].includes(f.facet.kind) ? "provider" : "peer";
        if (memberReason(w, b, { category: intent.category, role, format: "one_to_one", timeSensitive: false })) continue;
        found.push(makeCandidate({
          kind: "member_intro", generator: "warm_path", category: intent.category,
          participants: [a, b], roles: { [a]: "seeker", [b]: role }, format: "one_to_one",
          objective: `Friend-of-a-friend intro: ${label(f.facet) ?? CATEGORY_LABEL[intent.category]}`,
          anchor: { type: "intent", id: intent.id }, via: path.via, preferredCity: ma.m.homeCity,
          channels: new Set(["graph", f.sim >= w.cfg.retrieval.minSim ? "semantic" : "graph_only"]),
          evidence: { [a]: [], [b]: [f.facet?.id].filter(Boolean) as string[] },
          fit: f.sim, benefit: { [a]: f.sim, [b]: benefitForProvider(w, mb, ma, f.facet) }, warm: warmPathValue(path.strength),
          riskText: `${intentText(intent)} ${f.facet?.value ?? ""}`,
        }));
      }
      found.sort((p, q) => ((q.fit * 0.7 + q.warm * 0.3) - (p.fit * 0.7 + p.warm * 0.3)) || (p.key < q.key ? -1 : 1));
      out.push(...found.slice(0, w.cfg.maxPerIntent));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 6. Help request: a bounded ask needs one to three helpers (F14 safety rule for home entry).
export function helpRequest(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const a of w.ids) {
    const ma = w.get(a)!;
    for (const intent of ma.intents) {
      if (intent.category !== "help") continue;
      if (memberReason(w, a, { category: "help", role: "seeker", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: intent.createdAt })) continue;
      const text = intentText(intent);
      const m = text.match(/\b([1-3])\s*(people|helpers|hands|persons)\b/i) ?? text.match(/\b(one|two|three)\s*(people|helpers|hands)\b/i);
      const words: Record<string, number> = { one: 1, two: 2, three: 3 };
      let need = m ? (Number(m[1]) || words[m[1]!.toLowerCase()] || 1) : 1;
      const home = isHomeEntry(w.cfg, text);
      const pool = eligibleMembers(ctx, "help", "helper", need > 1 ? "small_group" : "one_to_one", false, new Set([a])).filter(id => w.canMeet([a, id]));
      const got = retrieveForIntent(ctx, intent, pool, "caps", w.cfg.retrieval.minSim);
      if (!got.length) { ctx.unmatchedIntents.add(intent.id); continue; }
      // Load-aware helper ranking: prefer people who enjoy it, penalise recent giving, develop new helpers.
      const ranked = got.map(r => {
        const mi = w.get(r.id)!;
        const acquainted = w.edgeHas(a, r.id, "met") || w.edgeHas(a, r.id, "knows") || w.edgeHas(a, r.id, "helped");
        const s = (r.rank ?? r.sim) + (r.facet?.kind === "offer" ? 0.1 : 0) - 0.1 * mi.recentContribution + (mi.recentContribution === 0 ? 0.03 : 0) + (home && acquainted ? 0.2 : 0);
        return { ...r, s, acquainted };
      }).filter(r => !pairReason(w, a, r.id, "help"))
        .sort((p, q) => (q.s - p.s) || (p.id < q.id ? -1 : 1));
      if (home && need === 1 && !ranked[0]?.acquainted) need = 2;
      if (ranked.length < need) { ctx.unmatchedIntents.add(intent.id); continue; }
      // Up to three helper-set variants so one busy helper does not sink the whole request.
      const seenSets = new Set<string>();
      for (let v = 0; v < 3; v++) {
        const helpers: typeof ranked = [];
        for (const r of ranked.slice(v)) {
          if (helpers.length >= need) break;
          if (helpers.some(h => pairReason(w, h.id, r.id, "help"))) continue;
          helpers.push(r);
        }
        if (helpers.length < need) break;
        const setKey = helpers.map(h => h.id).sort().join(",");
        if (seenSets.has(setKey)) continue;
        seenSets.add(setKey);
        const ids = [a, ...helpers.map(h => h.id)];
        const alternates = ranked.filter(r => !ids.includes(r.id)).slice(0, 3).map(r => r.id);
        out.push(makeCandidate({
          kind: "help", generator: "help_request", category: "help",
          participants: ids, roles: Object.fromEntries([[a, "seeker"], ...helpers.map(h => [h.id, "helper"])]), format: need > 1 ? "small_group" : "one_to_one",
          objective: `Help with: ${label(helpers[0]!.facet) ?? "a bounded task"}`, anchor: { type: "intent", id: intent.id },
          preferredCity: ma.m.homeCity, channels: new Set(helpers.flatMap(h => [...h.channels])),
          evidence: Object.fromEntries([[a, []], ...helpers.map(h => [h.id, [h.facet?.id].filter(Boolean)])]),
          fit: helpers.reduce((s, h) => s + h.sim, 0) / helpers.length,
          benefit: Object.fromEntries([[a, 0.9], ...helpers.map(h => [h.id, benefitForProvider(w, w.get(h.id)!, ma, h.facet)])]),
          alternates, safetyClass: home ? "medium" : "low", riskText: text,
        }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 7. Group composer: dinners / activities for 3-6 around shared (shareable) themes.
export function groupComposer(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const city of w.cfg.cities) {
    // Themes come from shareable facet tags only, so the anchor label is safe to show.
    const themeMembers = new Map<string, Set<MemberId>>();
    for (const id of w.ids) {
      const mi = w.get(id)!;
      if (isMinor(w, id)) continue; // minors never seed or size a group theme
      if (mi.m.homeCity !== city && !mi.presence.some(p => p.city === city)) continue;
      for (const f of mi.share) if (f.kind === "interest" || f.kind === "desire") for (const t of f.tags) {
        const k = t.toLowerCase();
        if (!themeMembers.has(k)) themeMembers.set(k, new Set());
        themeMembers.get(k)!.add(id);
      }
    }
    const themes = [...themeMembers.entries()].filter(([, s]) => s.size >= w.cfg.group.minThemeMembers)
      .sort((p, q) => (q[1].size - p[1].size) || (p[0] < q[0] ? -1 : 1)).slice(0, w.cfg.group.maxAnchorsPerCity);
    for (const [theme, members] of themes) {
      const category: Category = "social";
      const eligible = eligibleMembers(ctx, category, "guest", "small_group", false, new Set()).filter(id => members.has(id));
      if (eligible.length < w.cfg.group.minSize) continue;
      const q = w.embed(theme);
      const pool = eligible.map(id => ({ id, affinity: Math.max(0.3, w.bestFacet(w.get(id)!, q, "desires").sim) }))
        .sort((p, q2) => (q2.affinity - p.affinity) || (p.id < q2.id ? -1 : 1));
      // Exposure floor inside the pool: keep some low-exposure members in view.
      const top = pool.slice(0, w.cfg.group.poolSize - 4);
      top.push(...pool.slice(w.cfg.group.poolSize - 4).filter(p => w.get(p.id)!.lowExposure).slice(0, 4));
      const g = composeGroup(w, {
        pool: top, category, minSize: w.cfg.group.minSize, maxSize: w.cfg.group.maxSize,
        window: { start: w.now, end: w.now + w.cfg.windowDays * DAY }, preferredCity: city, requireCity: true, needHost: false,
        beamWidth: w.cfg.group.beamWidth, minPairwise: w.cfg.group.minPairwise, alternates: w.cfg.group.alternates,
      });
      if (!g) continue;
      const aff = new Map(top.map(p => [p.id, p.affinity]));
      out.push(makeCandidate({
        kind: "group", generator: "group_composer", category,
        participants: g.primary, roles: g.roles, format: "small_group",
        objective: `Small group around ${theme}`, anchor: { type: "interest", id: `${city}:${theme}`, label: theme },
        preferredCity: city, channels: new Set(["tag", "group"]),
        evidence: Object.fromEntries(g.primary.map(id => [id, w.get(id)!.share.filter(f => f.tags.map(t => t.toLowerCase()).includes(theme)).map(f => f.id)])),
        fit: 0.5 * g.stats.avgPairwise + 0.5 * (g.primary.reduce((s, id) => s + (aff.get(id) ?? 0), 0) / g.primary.length),
        benefit: Object.fromEntries(g.primary.map(id => [id, aff.get(id) ?? 0.3])),
        alternates: g.alternates, groupStats: g.stats, warm: g.stats.warmTies > 0 ? 0.5 : 0, riskText: theme,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 8. Second encounter: a mutually positive completed meeting plus a natural next context.
export function secondEncounter(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  const done = new Set<string>();
  const positive = (from: MemberId, about: MemberId, oppId: string) =>
    w.feedback.some(f => f.from === from && f.about === about && (f.opportunityId === undefined || f.opportunityId === oppId) && (f.sentiment === "positive" || f.wouldMeetAgain === true));
  const recentDone = w.interactions.filter(r => r.outcome === "completed" && w.now - r.at < 60 * DAY)
    .sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1));
  for (const r of recentDone) {
    for (let i = 0; i < r.participants.length; i++) for (let j = i + 1; j < r.participants.length; j++) {
      const a = r.participants[i]!, b = r.participants[j]!;
      const k = pairKey(a, b);
      if (done.has(k)) continue;
      if (!positive(a, b, r.id) || !positive(b, a, r.id)) continue;
      done.add(k);
      const ma = w.get(a), mb = w.get(b);
      if (!ma || !mb) continue;
      // Next context: an upcoming event both would like, else a shared shareable interest.
      let bestEv: NetworkEvent | undefined; let bs = 0;
      for (const ev of w.events) {
        if (ev.start < w.now || ev.start > w.now + 2 * w.cfg.windowDays * DAY) continue;
        const q = w.eventEmb.get(ev.id)!;
        const s = Math.min(w.bestFacet(ma, q, "desires").sim, w.bestFacet(mb, q, "desires").sim);
        if (s > bs) { bs = s; bestEv = ev; }
      }
      const category: Category = bestEv?.category ?? "social";
      const role: Role = "peer";
      if (memberReason(w, a, { category, role, format: bestEv ? "event" : "one_to_one", timeSensitive: false }) ||
          memberReason(w, b, { category, role, format: bestEv ? "event" : "one_to_one", timeSensitive: false })) continue;
      const shared = ma.share.find(f => f.tags.some(t => mb.share.some(g => g.tags.includes(t))));
      const sim = cosine(ma.desireEmb, mb.desireEmb);
      const useEvent = bestEv && bs >= w.cfg.retrieval.minSim * 0.8;
      out.push(makeCandidate({
        kind: "second_encounter", generator: "second_encounter", category,
        participants: [a, b], roles: { [a]: role, [b]: role }, format: useEvent ? "event" : "one_to_one",
        objective: useEvent ? `See each other again at ${bestEv!.title}` : `Another meetup${shared ? ` around ${shared.tags[0] ?? "a shared interest"}` : ""}`,
        anchor: useEvent ? { type: "event", id: bestEv!.id, label: bestEv!.title } : { type: "interaction", id: r.id },
        preferredCity: useEvent ? bestEv!.city : ma.m.homeCity,
        fixedWindow: useEvent ? { start: bestEv!.start, end: bestEv!.end } : undefined,
        channels: new Set(["history", ...(useEvent ? ["event_interest"] : [])]),
        evidence: { [a]: shared ? [shared.id] : [], [b]: mb.share.filter(g => shared?.tags.some(t => g.tags.includes(t))).map(g => g.id).slice(0, 1) },
        fit: Math.max(0.4, useEvent ? bs : sim), benefit: { [a]: 0.8, [b]: 0.8 }, warm: 1, confidenceHint: 0.95,
        riskText: useEvent ? eventRiskText(bestEv!) : (shared?.value ?? ""), riskFlags: useEvent ? bestEv!.riskTags : undefined,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 9. Newcomer welcome: a new member with few edges joins a low-stakes group with a host.
export function newcomerWelcome(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const n of w.ids) {
    const mn = w.get(n)!;
    if (!mn.newcomer || mn.degree > 2) continue;
    if (memberReason(w, n, { category: "social", role: "newcomer", format: "small_group", timeSensitive: false })) continue;
    const city = mn.m.homeCity;
    const pool = eligibleMembers(ctx, "social", "guest", "small_group", false, new Set([n]))
      .filter(id => { const mi = w.get(id)!; return !mi.newcomer && (mi.m.homeCity === city) && (mi.m.state === "open" || mi.m.state === "normal"); })
      .map(id => {
        const mi = w.get(id)!;
        const friendly = Math.min(1, mi.degree / 6);
        const hostOk = mi.isHost && !memberReason(w, id, { category: "social", role: "host", format: "small_group", timeSensitive: false });
        return { id, affinity: 0.4 * cosine(mn.desireEmb, mi.desireEmb) + 0.3 * friendly + (hostOk ? 0.4 : 0), hostOk };
      })
      .filter(p => p.affinity > 0.1 || p.hostOk)
      .sort((p, q) => (q.affinity - p.affinity) || (p.id < q.id ? -1 : 1)).slice(0, w.cfg.group.poolSize);
    if (!pool.some(p => p.hostOk)) continue;
    const g = composeGroup(w, {
      pool, forced: [n], forcedRole: "newcomer", category: "social", minSize: 3, maxSize: 4,
      window: { start: w.now, end: w.now + w.cfg.windowDays * DAY }, preferredCity: city, requireCity: true, needHost: true,
      beamWidth: w.cfg.group.beamWidth, minPairwise: -1, alternates: w.cfg.group.alternates,
    });
    if (!g || !Object.values(g.roles).includes("host")) continue;
    const aff = new Map(pool.map(p => [p.id, p.affinity]));
    out.push(makeCandidate({
      kind: "newcomer_welcome", generator: "newcomer_welcome", category: "social",
      participants: g.primary, roles: g.roles, format: "small_group", objective: "First-week welcome coffee",
      anchor: { type: "member", id: n }, preferredCity: city, channels: new Set(["newcomer", "group"]),
      evidence: Object.fromEntries(g.primary.map(id => [id, []])),
      fit: Math.max(0.35, g.stats.avgPairwise), benefit: Object.fromEntries(g.primary.map(id => [id, id === n ? 0.9 : Math.max(0.3, aff.get(id) ?? 0.3)])),
      alternates: g.alternates, groupStats: g.stats, warm: g.stats.warmTies > 0 ? 0.5 : 0.2, riskText: "welcome coffee", confidenceHint: 0.85,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 10. Network growth: ask well-connected members to bring in someone who fills a gap.
export function networkGrowth(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  type Gap = { id: string; city: string; label: string; q: number[] };
  const gaps: Gap[] = [];
  // (a) Unmet intents, grouped by city + category (never reveal the intent text).
  const byCat = new Map<string, Intent[]>();
  for (const iid of [...ctx.unmatchedIntents].sort()) {
    const it = w.intentById.get(iid);
    // Minors policy: a minor's unmet need never becomes a growth ask shown to adults.
    if (!it || isMinor(w, it.memberId)) continue;
    const k = `${w.get(it.memberId)!.m.homeCity}:${it.category}`;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(it);
  }
  for (const [k, its] of byCat) {
    const [city, cat] = k.split(":") as [string, Category];
    gaps.push({ id: `unmet:${k}`, city, label: `someone for ${CATEGORY_LABEL[cat]}`, q: w.embed(its.map(intentText).join(" ")) });
  }
  // (b) Areas with members but no host.
  const areaMembers = new Map<string, MemberId[]>();
  for (const id of w.ids) {
    const mi = w.get(id)!;
    if (isMinor(w, id)) continue; // minors never count toward (or reveal) a host-less area
    for (const p of mi.presence) if (p.type === "home") for (const a of p.areas) {
      const k = `${p.city}:${a}`;
      if (!areaMembers.has(k)) areaMembers.set(k, []);
      areaMembers.get(k)!.push(id);
    }
  }
  for (const [k, ids] of [...areaMembers.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    if (ids.length >= 3 && !ids.some(id => w.get(id)!.isHost)) {
      const [city, area] = k.split(":") as [string, string];
      gaps.push({ id: `nohost:${k}`, city, label: `a host in ${area}`, q: w.embed("host gatherings dinners community") });
    }
  }
  const asked = new Set<MemberId>();
  for (const gap of gaps.slice(0, 12)) {
    const pool = eligibleMembers(ctx, "growth", "connector", "one_to_one", false, asked)
      .filter(id => { const mi = w.get(id)!; return mi.m.homeCity === gap.city && !mi.newcomer && mi.degree >= 2; })
      .map(id => { const mi = w.get(id)!; return { id, s: 0.5 * Math.min(1, mi.degree / 8) + 0.5 * Math.max(0, cosine(gap.q, mi.profileEmb)) }; })
      .sort((p, q) => (q.s - p.s) || (p.id < q.id ? -1 : 1)).slice(0, 2);
    for (const p of pool) {
      asked.add(p.id);
      out.push(makeCandidate({
        kind: "network_growth", generator: "network_growth", category: "growth",
        participants: [p.id], roles: { [p.id]: "connector" }, format: "one_to_one",
        objective: `Know ${gap.label}?`, anchor: { type: "gap", id: gap.id, label: gap.label },
        preferredCity: w.get(p.id)!.m.homeCity, channels: new Set(["network_health"]), evidence: { [p.id]: [] },
        fit: Math.max(0.2, p.s), benefit: { [p.id]: 0.5 }, warm: 0, riskText: gap.label, confidenceHint: 0.85,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 11. Expansion: outside the member's usual pattern but plausibly life-expanding (exploration).
export function expansion(ctx: GenCtx): Candidate[] {
  const { w } = ctx;
  const out: Candidate[] = [];
  for (const a of w.ids) {
    const ma = w.get(a)!;
    const outside = ma.desires.filter(f => f.kind === "desire" && !f.tags.map(t => t.toLowerCase()).includes(ma.cluster));
    if (!outside.length) continue;
    const category: Category = "hobby";
    if (memberReason(w, a, { category, role: "seeker", format: "one_to_one", timeSensitive: false })) continue;
    const d = outside[0]!;
    const q = ma.facetEmb.get(d.id)!;
    const pool = eligibleMembers(ctx, category, "provider", "one_to_one", false, new Set([a])).filter(id => w.get(id)!.cluster !== ma.cluster && w.canMeet([a, id]));
    let best: { id: MemberId; sim: number; facet?: Facet } | undefined;
    for (const id of pool) {
      const r = w.bestFacet(w.get(id)!, q, "caps");
      if (r.sim >= w.cfg.retrieval.minSim && (!best || r.sim > best.sim)) best = { id, ...r };
    }
    if (!best) continue;
    const mb = w.get(best.id)!;
    out.push(makeCandidate({
      kind: "expansion", generator: "expansion", category,
      participants: [a, best.id], roles: { [a]: "seeker", [best.id]: "provider" }, format: "one_to_one",
      objective: `Try something new: ${label(best.facet) ?? "a new kind of activity"}`, anchor: { type: "member", id: a },
      preferredCity: ma.m.homeCity, channels: new Set(["expansion"]),
      evidence: { [a]: [d.id], [best.id]: [best.facet?.id].filter(Boolean) as string[] },
      fit: best.sim, benefit: { [a]: best.sim, [best.id]: benefitForProvider(w, mb, ma, best.facet) },
      exploration: true, riskText: `${d.value} ${best.facet?.value ?? ""}`,
    }));
  }
  return out;
}

/**
 * Warm-path value as an inverted U in tie strength (research: matching-and-graphs.md 4.9,
 * LinkedIn PYMK weak-tie experiments): moderate friend-of-a-friend ties beat both the
 * strongest and the weakest. Peaks at strength 0.5.
 */
export function warmPathValue(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return 0.3 + 0.7 * 4 * s * (1 - s);
}

export const GENERATORS: { name: GeneratorName; run: (ctx: GenCtx) => Candidate[] }[] = [
  { name: "intent_to_capability", run: intentToCapability },
  { name: "complementary_intents", run: complementaryIntents },
  { name: "shared_intent_pooling", run: sharedIntentPooling },
  { name: "event_anchor", run: eventAnchor },
  { name: "warm_path", run: warmPath },
  { name: "help_request", run: helpRequest },
  { name: "group_composer", run: groupComposer },
  { name: "second_encounter", run: secondEncounter },
  { name: "newcomer_welcome", run: newcomerWelcome },
  // Must run after the intent-driven generators: it consumes unmatched intents.
  { name: "network_growth", run: networkGrowth },
  { name: "expansion", run: expansion },
];

export const _internal = { label, bestShareable, CATEGORY_LABEL, HOUR, tokenize };
export type { OpportunityKind };
