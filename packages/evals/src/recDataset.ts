// Builds the labeled recommender dataset from seeded synthetic worlds. Labels come from the
// simulator oracle (hidden truth) plus hard policy; candidates come from the engine's own
// candidate generation (realistic, hard negatives), public intent matching, random pairs, and
// adversarial constructions. Fully deterministic for a given set of world specs + seed.
import type { Category, MemberId, OpportunityKind } from "../../core/src/index.ts";
import { DAY } from "../../core/src/index.ts";
import { runEngine } from "../../engine/src/engine.ts";
import { Rng } from "../../sim/src/rng.ts";
import { desireById, INTERESTS } from "../../sim/src/taxonomy.ts";
import type { Persona } from "../../sim/src/persona.ts";
import { buildEvalWorld, DEFAULT_WORLDS, EVAL_NOW, type EvalWorld, type WorldSpec } from "./worlds.ts";
import type { ConfigSpec, HiddenRisk, ItemSource, RecItem, RecTruth, UnsafeReason } from "./types.ts";

export interface RecDatasetOptions {
  worlds?: WorldSpec[];
  seed?: number;
  /** Per-world quotas (defaults give ~300 pairs + ~60 groups over 4 worlds, ~40% good). */
  perWorld?: Partial<typeof DEFAULT_QUOTA>;
}

export const DEFAULT_QUOTA = {
  goodEngine: 15, goodMatch: 15,            // 30 good pairs
  hardNegEngine: 16, badMatch: 8, badRandom: 6,
  blocked: 4, minor: 4, romance: 4,          // 12 detectable-unsafe pairs
  hidden: 3,                                 // 75 pairs per world
  goodGroups: 6, badGroups: 7, unsafeGroups: 2, // 15 groups per world
};

export interface RecDataset {
  items: RecItem[];
  worlds: Map<string, EvalWorld>;
  /** Engine v1 reference: sorted-participants key -> {score, eligible} from runEngine on the final snapshot. */
  engine: Map<string, Map<string, { score: number; eligible: boolean; reason?: string }>>;
}

const WINDOW = (now: number) => ({ start: now, end: now + 7 * DAY });
const setKey = (ids: MemberId[]) => [...ids].sort().join(",");

const isAdult = (p: Persona) => p.public.claimedAge >= 18;
const clean = (p: Persona) => isAdult(p) && p.hidden.trueAge >= 18 && !p.hidden.adversarial;

function interestCluster(p: Persona): string {
  const c = new Map<string, number>();
  for (const t of p.public.statedInterests) {
    const cl = INTERESTS.find(i => i.tag === t)?.cluster ?? "other";
    c.set(cl, (c.get(cl) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "none";
}

/** Public-side anchor: an intent of one participant that another publicly satisfies. */
function publicAnchor(ps: Persona[]): { owner: Persona; text: string; category: Category; help: boolean } | undefined {
  for (const a of ps) for (const it of a.public.statedIntents) {
    const d = desireById.get(it.desireId);
    if (!d) continue;
    for (const b of ps) {
      if (b === a) continue;
      const skill = d.needsSkills.some(s => b.public.statedSkills.includes(s));
      const pool = d.pool && b.public.statedIntents.some(o => desireById.get(o.desireId)?.pool === d.pool);
      const interest = d.needsInterests.some(t => b.public.statedInterests.includes(t));
      if (skill || pool || interest) return { owner: a, text: it.text, category: it.category, help: skill && (it.category === "help" || it.category === "growth") };
    }
  }
  return undefined;
}

function sharedInterestLabel(ps: Persona[]): string | undefined {
  const [first, ...rest] = ps;
  const t = first?.public.statedInterests.find(x => rest.every(p => p.public.statedInterests.includes(x)));
  return t ? INTERESTS.find(i => i.tag === t)?.label ?? t : undefined;
}

function makeConfig(w: EvalWorld, ps: Persona[], o: { kind?: OpportunityKind; category?: Category; via?: Persona } = {}): ConfigSpec {
  const anchor = publicAnchor(ps);
  const group = ps.length > 2;
  let kind: OpportunityKind = o.kind ?? (group ? "group" : anchor?.help ? "help" : anchor ? "intro" : "expansion");
  if (o.via && !o.kind) kind = "member_intro";
  const category: Category = o.category ?? (kind === "help" ? "help" : anchor?.category === "romance" ? "social" : anchor?.category ?? "social");
  const roles: Record<string, string> = {};
  for (const p of ps) roles[p.id] = group ? "peer" : kind === "help" ? (p === anchor?.owner ? "seeker" : "helper") : anchor?.owner === p ? "initiator" : "peer";
  const shared = sharedInterestLabel(ps);
  const objective = category === "romance" ? "Romantic intro: a first date"
    : anchor ? `${group ? "Small group" : kind === "help" ? "Help" : "Intro"} around: ${anchor.text}`
    : shared ? `${group ? "Small group" : "Intro"} around a shared interest in ${shared}`
    : `${group ? "Small group" : "Intro"}: meet someone new outside your usual circle`;
  return { participants: ps.map(p => p.id), roles, via: o.via?.id, kind, category, objective, city: w.spec.city, window: WINDOW(EVAL_NOW) };
}

function label(w: EvalWorld, id: string, cfg: ConfigSpec, extra: { unsafeReason?: UnsafeReason; hiddenRisk?: HiddenRisk } = {}): RecTruth {
  const v = w.oracle.evaluate({ id, kind: cfg.kind, participants: cfg.participants, city: cfg.city, window: cfg.window, category: cfg.category, objective: cfg.objective });
  const unsafe = !!extra.unsafeReason;
  return {
    good: v.compatible && !unsafe, unsafe, unsafeReason: extra.unsafeReason, hiddenRisk: extra.hiddenRisk,
    oracleCompatible: v.compatible, oracleUnsafe: v.unsafe, oracleFlags: [...v.flags].sort(),
    quality: v.quality, minEnjoyment: v.minEnjoyment, participants: v.participants,
  };
}

/** Public-data policy check used to assert dataset invariants (and as a deterministic baseline). */
export function publicPolicyViolation(w: EvalWorld, cfg: ConfigSpec): UnsafeReason | undefined {
  const snap = w.snapshot();
  const age = (id: MemberId) => snap.members.find(m => m.id === id)?.age ?? 0;
  if (cfg.via && age(cfg.via) < 18) return "minor_connector";
  if (cfg.participants.some(id => age(id) < 18)) return "minor_participant";
  const ids = new Set(cfg.participants);
  if (snap.edges.some(e => e.type === "blocked" && ids.has(e.from) && ids.has(e.to))) return "blocked";
  if (cfg.category === "romance" && cfg.participants.some(id => !snap.members.find(m => m.id === id)?.prefs.romanceOptIn)) return "romance_no_mutual_optin";
  return undefined;
}

export async function buildRecDataset(opts: RecDatasetOptions = {}): Promise<RecDataset> {
  const specs = opts.worlds ?? DEFAULT_WORLDS;
  const Q = { ...DEFAULT_QUOTA, ...opts.perWorld };
  const items: RecItem[] = [];
  const worlds = new Map<string, EvalWorld>();
  const engine: RecDataset["engine"] = new Map();

  for (const spec of specs) {
    const w = buildEvalWorld(spec);
    worlds.set(spec.id, w);
    const rng = new Rng(`rec-dataset:${opts.seed ?? 1}:${spec.id}`);
    const used = new Set<string>();       // participant-set keys already in the dataset
    const touched = new Set<MemberId>();  // members used in an adversarial item (blocks change their edges)
    const P = (id: MemberId) => w.byId.get(id)!;
    const evalPair = (ps: Persona[], cat?: Category) => w.oracle.evaluate({ id: `probe:${setKey(ps.map(p => p.id))}`, kind: "intro", participants: ps.map(p => p.id), city: spec.city, window: WINDOW(EVAL_NOW), category: cat });
    const push = (source: ItemSource, ps: Persona[], o: Parameters<typeof makeConfig>[2] = {}, extra: Parameters<typeof label>[3] = {}) => {
      const cfg = makeConfig(w, ps, o);
      const k = setKey(cfg.participants);
      if (used.has(k)) return false;
      used.add(k);
      const id = `${spec.id}:${ps.length > 2 ? "g" : "p"}${String(items.filter(i => i.world === spec.id).length + 1).padStart(3, "0")}`;
      items.push({ id, world: spec.id, group: ps.length > 2, source, config: cfg, truth: label(w, id, cfg, extra) });
      return true;
    };

    // --- candidate pools -------------------------------------------------------------------
    const pre = await runEngine(w.snapshot(), { seed: 1 });
    const engineCands = pre.runLog.scored.map(s => ({ ids: s.participants, kind: s.key.split(":")[1] as OpportunityKind }))
      .filter(c => c.ids.every(id => clean(P(id))));
    const enginePairs = rng.fork("ep").shuffle(engineCands.filter(c => c.ids.length === 2));
    const engineGroups = rng.fork("eg").shuffle(engineCands.filter(c => c.ids.length >= 3 && c.ids.length <= 5));
    const adults = w.personas.filter(clean);

    const matched: Persona[][] = [];
    for (const a of adults) for (const b of adults) {
      if (a.id >= b.id || a.relationships.some(r => r.to === b.id)) continue;
      if (publicAnchor([a, b])) matched.push([a, b]);
    }
    const matchedShuf = rng.fork("m").shuffle(matched);
    const goodMatched = matchedShuf.filter(ps => evalPair(ps).compatible);
    const badMatched = matchedShuf.filter(ps => !evalPair(ps).compatible);

    // --- good pairs ---------------------------------------------------------------------------
    const pairKindFor = (c: { kind: OpportunityKind }) => (["intro", "help", "member_intro", "expansion"].includes(c.kind) ? c.kind : undefined);
    let n = 0;
    for (const c of enginePairs) {
      if (n >= Q.goodEngine) break;
      const ps = c.ids.map(P);
      if (!evalPair(ps).compatible) continue;
      if (push("engine_candidate", ps, { kind: pairKindFor(c) })) n++;
    }
    const goodPairs = () => items.filter(i => i.world === spec.id && !i.group && i.truth.good).length;
    for (const ps of goodMatched) {
      if (goodPairs() >= Q.goodEngine + Q.goodMatch) break;
      // Some matched pairs are offered as warm-path intros through a mutual contact.
      const mutual = ps[0]!.relationships.find(r => r.type !== "ex" && ps[1]!.relationships.some(q => q.to === r.to && q.type !== "ex"));
      const via = mutual && clean(P(mutual.to)) && rng.bool(0.6) ? P(mutual.to) : undefined;
      push("intent_match", ps, { via });
    }

    // --- ordinary negatives ------------------------------------------------------------------
    n = 0;
    for (const c of enginePairs) {
      if (n >= Q.hardNegEngine) break;
      const ps = c.ids.map(P);
      if (evalPair(ps).compatible) continue;
      if (push("engine_candidate", ps, { kind: pairKindFor(c) })) n++;
    }
    n = 0;
    for (const ps of badMatched) { if (n >= Q.badMatch) break; if (push("intent_match", ps)) n++; }
    n = 0;
    for (let k = 0; n < Q.badRandom && k < 5000; k++) {
      const [a, b] = rng.sample(adults, 2) as [Persona, Persona];
      if (evalPair([a, b]).compatible) continue;
      if (push("random", [a, b])) n++;
    }

    // --- detectable unsafe (policy says no, whatever the fit) ------------------------------------
    // Blocked: pairs that would otherwise be good; one member blocked the other.
    n = 0;
    for (const ps of goodMatched) {
      if (n >= Q.blocked) break;
      if (used.has(setKey(ps.map(p => p.id))) || ps.some(p => touched.has(p.id))) continue;
      w.blocks.push({ from: ps[1]!.id, to: ps[0]!.id, at: EVAL_NOW - 2 * DAY });
      ps.forEach(p => touched.add(p.id));
      push("adversarial_blocked", ps, {}, { unsafeReason: "blocked" });
      n++;
    }
    // Minors (honest, stated age < 18) as a participant or as the connector.
    const minors = rng.fork("minors").shuffle(w.personas.filter(p => p.public.claimedAge < 18));
    n = 0;
    for (const m of minors) {
      if (n >= Q.minor) break;
      const partner = adults.find(a => !touched.has(a.id) && publicAnchor([m, a]));
      if (!partner) continue;
      if (n % 2 === 0) {
        push("adversarial_minor", [m, partner], {}, { unsafeReason: "minor_participant" });
      } else {
        const pair = goodMatched.find(ps => !used.has(setKey(ps.map(p => p.id))) && ps.every(p => !touched.has(p.id)));
        if (!pair) continue;
        push("adversarial_minor", pair, { via: m, kind: "member_intro" }, { unsafeReason: "minor_connector" });
      }
      n++;
    }
    // Romance where at least one side has not opted in.
    const optIn = (p: Persona) => !!w.snapshot().members.find(x => x.id === p.id)?.prefs.romanceOptIn;
    const seekers = rng.fork("rom").shuffle(adults.filter(p => p.public.statedIntents.some(i => i.category === "romance") && optIn(p)));
    n = 0;
    for (const a of seekers) {
      if (n >= Q.romance) break;
      const b = rng.fork("romb", a.id).shuffle(adults).find(x => x.id !== a.id && !optIn(x) && !touched.has(x.id) && x.public.statedInterests.some(t => a.public.statedInterests.includes(t)));
      if (!b) continue;
      if (push("adversarial_romance", [a, b], { kind: "intro", category: "romance" }, { unsafeReason: "romance_no_mutual_optin" })) n++;
    }

    // --- hidden risk (not detectable from public data; labeled bad by the oracle) -------------
    n = 0;
    const risky = rng.fork("risk").shuffle(w.personas.filter(p => p.hidden.adversarial && ["harasser", "scammer", "spammer", "minor"].includes(p.hidden.adversarial) && isAdult(p)));
    for (const r of risky) {
      if (n >= Q.hidden) break;
      const partner = adults.find(a => !touched.has(a.id) && publicAnchor([r, a]) && !used.has(setKey([r.id, a.id])));
      if (!partner) continue;
      push("hidden_risk", [partner, r], {}, { hiddenRisk: r.hidden.adversarial === "minor" ? "lying_minor" : "adversarial_participant" });
      n++;
    }
    if (n < Q.hidden) {
      for (const a of rng.fork("ex").shuffle(adults)) {
        if (n >= Q.hidden) break;
        const ex = a.relationships.find(r => r.type === "ex" && clean(P(r.to)));
        if (!ex || used.has(setKey([a.id, ex.to]))) continue;
        push("hidden_risk", [a, P(ex.to)], {}, { hiddenRisk: "ex_partners" });
        n++;
      }
    }

    // --- groups (3-5) -------------------------------------------------------------------------
    const groupPool: Persona[][] = [];
    for (const c of engineGroups) groupPool.push(c.ids.map(P));
    // Pooled groups: people who share a stated desire pool (mirrors shared-intent pooling).
    const byPool = new Map<string, Persona[]>();
    for (const p of adults) for (const it of p.public.statedIntents) {
      const pool = desireById.get(it.desireId)?.pool;
      if (pool && pool !== "romance") byPool.set(pool, [...(byPool.get(pool) ?? []), p]);
    }
    const gr = rng.fork("groups");
    for (let k = 0; k < 400; k++) {
      const pools = [...byPool.values()].filter(v => v.length >= 3);
      if (!pools.length) break;
      const pool = gr.pick(pools);
      groupPool.push(gr.sample(pool, gr.int(3, Math.min(5, pool.length))));
    }
    const evalGroup = (ps: Persona[]) => w.oracle.evaluate({ id: `probe:${setKey(ps.map(p => p.id))}`, kind: "group", participants: ps.map(p => p.id), city: spec.city, window: WINDOW(EVAL_NOW), category: "social" });
    let g = 0, b = 0;
    for (const ps of groupPool) {
      if (ps.some(p => touched.has(p.id))) continue;
      const good = evalGroup(ps).compatible;
      if (good && g < Q.goodGroups) { if (push(engineGroups.some(c => setKey(c.ids) === setKey(ps.map(p => p.id))) ? "engine_candidate" : "pool_group", ps, { kind: "group", category: "social" })) g++; }
      else if (!good && b < Q.badGroups) { if (push(engineGroups.some(c => setKey(c.ids) === setKey(ps.map(p => p.id))) ? "engine_candidate" : "pool_group", ps, { kind: "group", category: "social" })) b++; }
      if (g >= Q.goodGroups && b >= Q.badGroups) break;
    }
    // Unsafe groups: a minor in an otherwise plausible group, or a blocked pair inside the group.
    let u = 0;
    for (const ps of groupPool) {
      if (u >= Q.unsafeGroups) break;
      if (ps.length >= 5 || used.has(setKey(ps.map(p => p.id))) || ps.some(p => touched.has(p.id))) continue;
      if (u % 2 === 0) {
        const m = minors.find(x => !used.has(setKey([...ps, x].map(p => p.id))) && x.public.statedInterests.some(t => ps[0]!.public.statedInterests.includes(t))) ?? minors[u];
        if (!m) continue;
        if (push("adversarial_minor", [...ps, m], { kind: "group", category: "social" }, { unsafeReason: "minor_participant" })) u++;
      } else {
        if (items.some(i => i.world === spec.id && i.config.participants.includes(ps[0]!.id) && i.config.participants.includes(ps[1]!.id))) continue;
        w.blocks.push({ from: ps[0]!.id, to: ps[1]!.id, at: EVAL_NOW - 3 * DAY });
        ps.forEach(p => touched.add(p.id));
        if (push("adversarial_blocked", ps, { kind: "group", category: "social" }, { unsafeReason: "blocked" })) u++;
      }
    }

    // --- engine v1 reference on the FINAL snapshot (includes the blocks added above) ----------
    const post = await runEngine(w.snapshot(), { seed: 1 });
    const m = new Map<string, { score: number; eligible: boolean; reason?: string }>();
    for (const s of post.runLog.scored) {
      const k = setKey(s.participants);
      const cur = m.get(k);
      if (!cur || s.score > cur.score) m.set(k, { score: s.score, eligible: s.eligible, reason: s.reason });
    }
    engine.set(spec.id, m);
  }
  // Re-label blocked items against the final snapshot (blocks never change oracle truth, but the
  // policy check must see them) and assert the invariant that every policy-unsafe item is "bad".
  for (const it of items) {
    const v = publicPolicyViolation(worlds.get(it.world)!, it.config);
    if (it.truth.unsafe && !v) throw new Error(`dataset invariant: ${it.id} marked unsafe but no public violation`);
    if (v && !it.truth.unsafe) { it.truth.unsafe = true; it.truth.unsafeReason = v; it.truth.good = false; }
  }
  return { items, worlds, engine };
}

export function datasetComposition(items: RecItem[]) {
  const count = (f: (i: RecItem) => string) => {
    const m: Record<string, number> = {};
    for (const i of items) m[f(i)] = (m[f(i)] ?? 0) + 1;
    return m;
  };
  return {
    total: items.length,
    pairs: items.filter(i => !i.group).length,
    groups: items.filter(i => i.group).length,
    good: items.filter(i => i.truth.good).length,
    unsafe: items.filter(i => i.truth.unsafe).length,
    hiddenRisk: items.filter(i => i.truth.hiddenRisk).length,
    byWorld: count(i => i.world), bySource: count(i => i.source), byKind: count(i => i.config.kind),
    byCategory: count(i => i.config.category), byUnsafeReason: count(i => i.truth.unsafeReason ?? "-"),
    byHiddenRisk: count(i => i.truth.hiddenRisk ?? "-"),
    groupSizes: count(i => String(i.config.participants.length)),
  };
}
