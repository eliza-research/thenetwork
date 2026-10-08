// Load the synthetic dataset.
//
//   import { loadSnapshot } from "./scripts/synthetic/load.ts";
//   const snapshot = await loadSnapshot();            // core WorldSnapshot from PUBLIC files only
//
//   bun scripts/synthetic/load.ts                     # summary of the snapshot
//   bun scripts/synthetic/load.ts --engine            # also run engine v1 once and report proposals
//   bun scripts/synthetic/load.ts --engine --config '{"complementarity":{"weight":0}}'   # config override
//   bun scripts/synthetic/load.ts --engine --dir /tmp/x --no-write   # other dataset; don't write engine_v1_run.json
//
// loadSnapshot never reads hidden_truth.jsonl. loadPersonas (simulator/oracle only) does.
import { parseArgs } from "node:util";
import type { Edge, Facet, Intent, Member, Presence, WorldSnapshot } from "../../packages/core/src/index.ts";
import type { Persona } from "../../packages/sim/src/persona.ts";
import type { Knowledge } from "../../packages/sim/src/sources.ts";
import {
  DATA_DIR, FILES, readJsonl,
  type EdgeRecord, type FacetRecord, type HiddenTruthRecord, type IntentRecord, type Manifest, type MemberRecord, type PresenceRecord,
} from "./common.ts";

export interface PublicData {
  manifest: Manifest; members: MemberRecord[]; facets: FacetRecord[]; intents: IntentRecord[];
  presence: PresenceRecord[]; edges: EdgeRecord[];
}

export async function loadPublic(dir = DATA_DIR): Promise<PublicData> {
  return {
    manifest: await Bun.file(`${dir}/${FILES.manifest}`).json(),
    members: await readJsonl(`${dir}/${FILES.members}`),
    facets: await readJsonl(`${dir}/${FILES.facets}`),
    intents: await readJsonl(`${dir}/${FILES.intents}`),
    presence: await readJsonl(`${dir}/${FILES.presence}`),
    edges: await readJsonl(`${dir}/${FILES.edges}`),
  };
}

// Strip dataset-only fields so the engine sees exactly the core contract.
const toMember = (m: MemberRecord): Member => ({
  id: m.id, name: m.name, homeCity: m.homeCity, state: m.state, prefs: { ...m.prefs, categoriesOptIn: [...m.prefs.categoriesOptIn], formats: [...m.prefs.formats] },
  ...(m.invitedBy ? { invitedBy: m.invitedBy } : {}), joinedAt: m.joinedAt, age: m.age, unansweredProactive: m.unansweredProactive,
  ...(m.connectedSources ? { connectedSources: m.connectedSources.map(s => ({ ...s })) } : {}),
});
const toFacet = ({ synthetic: _s, ...f }: FacetRecord): Facet => ({ ...f, tags: [...f.tags] });
const toIntent = ({ synthetic: _s, ...i }: IntentRecord): Intent => i;
const toPresence = ({ synthetic: _s, ...p }: PresenceRecord): Presence => ({ ...p, areas: [...p.areas] });
const toEdge = ({ synthetic: _s, relation: _r, ...e }: EdgeRecord): Edge => e;

export function toSnapshot(d: PublicData, opts: { now?: number; cities?: ("sf" | "nyc")[] } = {}): WorldSnapshot {
  const keep = new Set(d.members.filter(m => !opts.cities || opts.cities.includes(m.homeCity as "sf" | "nyc")).map(m => m.id));
  return {
    now: opts.now ?? d.manifest.snapshotNow,
    members: d.members.filter(m => keep.has(m.id)).map(toMember),
    facets: d.facets.filter(f => keep.has(f.memberId)).map(toFacet),
    intents: d.intents.filter(i => keep.has(i.memberId)).map(toIntent),
    presence: d.presence.filter(p => keep.has(p.memberId)).map(toPresence),
    edges: d.edges.filter(e => keep.has(e.from) && keep.has(e.to)).map(toEdge),
    recentProposals: [],
  };
}

/** Core WorldSnapshot built from the public files only (hidden truth is never read). */
export async function loadSnapshot(dir = DATA_DIR, opts: { now?: number; cities?: ("sf" | "nyc")[] } = {}): Promise<WorldSnapshot> {
  return toSnapshot(await loadPublic(dir), opts);
}

/**
 * Simulator personas (HIDDEN truth + public profile) for packages/sim runWorld / Oracle.
 * Harness use only. Pass `start: manifest.snapshotNow` to runWorld; trips are day offsets from it.
 */
export async function loadPersonas(dir = DATA_DIR): Promise<Persona[]> {
  const hidden = await readJsonl<HiddenTruthRecord>(`${dir}/${FILES.hidden}`);
  const members = new Map((await readJsonl<MemberRecord>(`${dir}/${FILES.members}`)).map(m => [m.id, m]));
  const facets = new Map((await readJsonl<FacetRecord>(`${dir}/${FILES.facets}`)).map(f => [f.id, f]));
  return hidden.map(h => {
    // Rebuild the sim Knowledge view (source facets + their truth labels) so sim buildSnapshot
    // exposes the same tiered knowledge. Absent on pre-1.2.0 data.
    const k = h.knowledge;
    const knowledge: Knowledge | undefined = k ? {
      richness: k.richness, chat: k.chat, sources: k.sources,
      observations: Object.entries(k.observationTruth).flatMap(([id, t]) => {
        const f = facets.get(id);
        if (!f) return [];
        const { synthetic: _s, id: _i, memberId: _m, ...facet } = f;
        return [{ facet, truth: t.truth, ...(t.note ? { note: t.note } : {}) }];
      }),
    } : undefined;
    return {
      id: h.memberId, name: h.name, gender: h.gender, archetype: h.archetype, homeCity: h.homeCity,
      ...(h.secondaryCity ? { secondaryCity: h.secondaryCity } : {}),
      routine: h.routine, relationships: h.relationships, invitedBy: members.get(h.memberId)?.invitedBy,
      joinDay: 0, hidden: h.hidden, public: h.personaPublic, enriched: members.get(h.memberId)?.profile.enrichment === "llm",
      ...(knowledge ? { knowledge } : {}),
    };
  });
}

// ---------------------------------------------------------------------------------------------
if (import.meta.main) {
  const a = parseArgs({ options: {
    engine: { type: "boolean", default: false }, seed: { type: "string", default: "1" }, dir: { type: "string", default: DATA_DIR },
    config: { type: "string" }, "no-write": { type: "boolean", default: false },
  } }).values;
  const d = await loadPublic(a.dir);
  const snap = toSnapshot(d);
  const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { m[f(x)] = (m[f(x)] ?? 0) + 1; return m; }, {});
  const summary: Record<string, unknown> = {
    now: new Date(snap.now).toISOString(), members: snap.members.length, facets: snap.facets.length, intents: snap.intents.length,
    presence: snap.presence.length, edges: snap.edges.length, edgesByType: count(snap.edges, e => e.type),
  };
  if (a.engine) {
    const { runEngine, GENERATOR_NAMES } = await import("../../packages/engine/src/index.ts");
    const t0 = performance.now();
    const override = a.config ? JSON.parse(a.config) : {};
    const { proposals, runLog } = await runEngine(snap, { ...override, seed: Number(a.seed) });
    const ms = Math.round(performance.now() - t0);
    const minors = new Set(d.members.filter(m => m.age < 18).map(m => m.id));
    const canaries = d.facets.filter(f => f.tags.includes("sensitive")).map(f => /\(ref ([^)]+)\)/.exec(f.value)?.[1]).filter(Boolean) as string[];
    const text = JSON.stringify(proposals);
    const byGen = Object.fromEntries(GENERATOR_NAMES.map(g => [g, proposals.filter(p => p.generator === g).length]));
    const touched = new Set(proposals.flatMap(p => p.participants));
    const report: Record<string, unknown> = {
      engineVersion: runLog.engineVersion, seed: runLog.seed, configHash: runLog.configHash, inputHash: runLog.inputHash, wallMs: ms,
      ...(a.config ? { configOverride: override } : {}),
      judge: runLog.judgeModel ?? "off (no llm dep)",
      proposals: proposals.length,
      proposalsByGenerator: byGen,
      proposalsByKind: count(proposals, p => p.kind),
      proposalsByCity: count(proposals, p => p.city),
      proposalsByCategory: count(proposals, p => p.category ?? "none"),
      exploration: proposals.filter(p => p.exploration).length,
      membersWithProposal: touched.size,
      candidatesByGenerator: runLog.funnel.byGenerator,
      funnel: {
        generated: runLog.funnel.generated, passedHardFilters: runLog.funnel.passedHardFilters, deduped: runLog.funnel.deduped,
        eligible: runLog.funnel.eligible, belowThreshold: runLog.funnel.belowThreshold, budgetSkips: runLog.funnel.budgetSkips,
        selected: runLog.funnel.selected, rejectedBy: runLog.funnel.rejectedBy, memberFunnel: runLog.funnel.memberFunnel,
      },
      fairness: runLog.fairness,
      checks: {
        minorsInAnyProposal: proposals.filter(p => [...p.participants, ...(p.alternates ?? []), ...((p as any).via ? [(p as any).via] : [])].some(id => minors.has(id))).length,
        canaryLeaksInProposals: canaries.filter(c => text.includes(c)).length,
      },
    };
    // Stratify by the hidden richness tier (HARNESS ONLY: reads hidden_truth.jsonl for evaluation;
    // the engine above only saw the public snapshot). Oracle = packages/sim ground truth.
    const personas = await loadPersonas(a.dir);
    const tierOf = new Map(personas.map(p => [p.id, p.hidden.richness ?? "none"]));
    if (personas.some(p => p.hidden.richness)) {
      const { Oracle } = await import("../../packages/sim/src/oracle.ts");
      const oracle = new Oracle(personas, Number(a.seed), snap.now);
      const verdict = new Map(proposals.map(p => [p.id, oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective })]));
      // Latent good one-to-one pairs (oracle, same city, strangers, adults, non-adversarial).
      const latent = (["sf", "nyc"] as const).flatMap(c => oracle.latentPairs(personas.filter(p => p.homeCity === c).map(p => p.id), snap.now));
      const proposedPairs = new Set(proposals.flatMap(p => p.participants.flatMap((x, i) => p.participants.slice(i + 1).map(y => [x, y].sort().join("|")))));
      const tiers = ["minimal", "light", "medium", "rich", "very_rich"];
      const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000 : null);
      const adultIds = new Set(d.members.filter(m => m.age >= 18).map(m => m.id));
      // Whole-run oracle view (all tiers): precision of proposals and of one-to-one intros, pair recall.
      const intros = proposals.filter(p => p.participants.length === 2);
      const liveIntent = new Set(snap.intents.filter(i => i.status === "active" && i.createdAt + i.horizonDays * 86_400_000 > snap.now).map(i => i.memberId));
      report.oracle = {
        compatibleRate: mean(proposals.map(p => (verdict.get(p.id)!.compatible ? 1 : 0))),
        introCompatibleRate: mean(intros.map(p => (verdict.get(p.id)!.compatible ? 1 : 0))),
        meanQuality: mean(proposals.map(p => verdict.get(p.id)!.quality)),
        latentGoodPairs: latent.length,
        latentPairRecall: mean([latent.filter(l => proposedPairs.has([l.a, l.b].sort().join("|"))).length / Math.max(1, latent.length)]),
        adultsWithoutLiveIntent: [...adultIds].filter(id => !liveIntent.has(id)).length, adults: adultIds.size,
      };
      report.byRichness = Object.fromEntries(tiers.map(t => {
        const ids = d.members.filter(m => tierOf.get(m.id) === t && adultIds.has(m.id)).map(m => m.id);
        const set = new Set(ids);
        const theirs = proposals.filter(p => p.participants.some(x => set.has(x)));
        const appearances = proposals.reduce((n, p) => n + p.participants.filter(x => set.has(x)).length, 0);
        const lat = latent.filter(l => set.has(l.a) || set.has(l.b));
        return [t, {
          adultMembers: ids.length,
          proposalsPerMember: mean([appearances / Math.max(1, ids.length)]),
          shareWithProposal: mean([ids.filter(x => touched.has(x)).length / Math.max(1, ids.length)]),
          proposalsInvolving: theirs.length,
          meanFit: mean(theirs.map(p => p.components.fit)),
          meanConfidence: mean(theirs.map(p => p.components.confidence)),
          meanScore: mean(theirs.map(p => p.score)),
          oracleCompatibleRate: mean(theirs.map(p => (verdict.get(p.id)!.compatible ? 1 : 0))),
          oracleMeanQuality: mean(theirs.map(p => verdict.get(p.id)!.quality)),
          latentGoodPairs: lat.length,
          latentPairRecall: mean([lat.filter(l => proposedPairs.has([l.a, l.b].sort().join("|"))).length / Math.max(1, lat.length)]),
        }];
      }));
    }
    summary.engine = report;
    if (!a["no-write"]) await Bun.write(`${a.dir}/engine_v1_run.json`, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(summary, null, 2));
}
