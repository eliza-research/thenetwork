// Load the synthetic dataset.
//
//   import { loadSnapshot } from "./scripts/synthetic/load.ts";
//   const snapshot = await loadSnapshot();            // core WorldSnapshot from PUBLIC files only
//
//   bun scripts/synthetic/load.ts                     # summary of the snapshot
//   bun scripts/synthetic/load.ts --engine            # also run engine v1 once and report proposals
//
// loadSnapshot never reads hidden_truth.jsonl. loadPersonas (simulator/oracle only) does.
import { parseArgs } from "node:util";
import type { Edge, Facet, Intent, Member, Presence, WorldSnapshot } from "../../packages/core/src/index.ts";
import type { Persona } from "../../packages/sim/src/persona.ts";
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
});
const toFacet = ({ synthetic: _s, ...f }: FacetRecord): Facet => ({ ...f, tags: [...f.tags] });
const toIntent = ({ synthetic: _s, ...i }: IntentRecord): Intent => i;
const toPresence = ({ synthetic: _s, ...p }: PresenceRecord): Presence => ({ ...p, areas: [...p.areas] });
const toEdge = ({ synthetic: _s, relation: _r, ...e }: EdgeRecord): Edge => e;

export function toSnapshot(d: PublicData, opts: { now?: number; cities?: ("sf" | "nyc")[] } = {}): WorldSnapshot {
  const keep = new Set(d.members.filter(m => !opts.cities || opts.cities.includes(m.homeCity)).map(m => m.id));
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
  return hidden.map(h => ({
    id: h.memberId, name: h.name, gender: h.gender, archetype: h.archetype, homeCity: h.homeCity,
    ...(h.secondaryCity ? { secondaryCity: h.secondaryCity } : {}),
    routine: h.routine, relationships: h.relationships, invitedBy: members.get(h.memberId)?.invitedBy,
    joinDay: 0, hidden: h.hidden, public: h.personaPublic, enriched: members.get(h.memberId)?.profile.enrichment === "llm",
  }));
}

// ---------------------------------------------------------------------------------------------
if (import.meta.main) {
  const a = parseArgs({ options: { engine: { type: "boolean", default: false }, seed: { type: "string", default: "1" }, dir: { type: "string", default: DATA_DIR } } }).values;
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
    const { proposals, runLog } = await runEngine(snap, { seed: Number(a.seed) });
    const ms = Math.round(performance.now() - t0);
    const minors = new Set(d.members.filter(m => m.age < 18).map(m => m.id));
    const canaries = d.facets.filter(f => f.tags.includes("sensitive")).map(f => /\(ref ([^)]+)\)/.exec(f.value)?.[1]).filter(Boolean) as string[];
    const text = JSON.stringify(proposals);
    const byGen = Object.fromEntries(GENERATOR_NAMES.map(g => [g, proposals.filter(p => p.generator === g).length]));
    const touched = new Set(proposals.flatMap(p => p.participants));
    const report = {
      engineVersion: runLog.engineVersion, seed: runLog.seed, configHash: runLog.configHash, inputHash: runLog.inputHash, wallMs: ms,
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
    summary.engine = report;
    await Bun.write(`${a.dir}/engine_v1_run.json`, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(summary, null, 2));
}
