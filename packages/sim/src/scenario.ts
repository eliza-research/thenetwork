// Declarative scenario scripts (PRD 34.3 "Scenario scripts"): seed specific situations on
// top of a background world, then grade the run by its FINAL STATE (run log + metrics),
// not by transcript vibes. pass^k: a scenario passes only if it passes on k seeds.
import { DAY, MINUTE, type City, type OpportunityKind, type Proposal } from "@thenetwork/core";
import type { Metrics, RunRecord } from "@thenetwork/judge";
import { generatePersonas } from "./generator.ts";
import type { AdversarialKind, Archetype, Persona, Responsiveness, Trip } from "./persona.ts";
import { desireById } from "./taxonomy.ts";
import { nextLocalHour } from "./time.ts";
import { DEFAULT_START, runWorld, type WorldAction, type WorldOptions, type WorldResult } from "./world.ts";
import type { NetworkUnderTest, Engine } from "./network.ts";
import type { PersonaAgent } from "./agent/types.ts";

export interface At { day: number; hour?: number; minute?: number; city?: City }

export interface ScenarioPersonaSpec {
  ref: string; name?: string; city?: City; archetype?: Archetype; age?: number; homeArea?: string;
  interests?: string[]; skills?: string[]; desires?: string[];
  /** Scripted join time; personas without one join at joinDay (default 0) via the normal schedule. */
  join?: At;
  disclosure?: { fact: string; canary: string };
  responsiveness?: Partial<Responsiveness>; flakiness?: number; capacity?: number; socialEnergy?: number;
  preferredGroupSize?: number; trips?: Trip[]; romanceOptIn?: boolean; adversarial?: AdversarialKind;
}

export type ScenarioActionSpec =
  | { at: At; do: "go_silent"; persona: string }
  | { at: At; do: "force_flake"; persona: string; how?: "notice" | "no_show" }
  | { at: At; do: "say"; persona: string; text: string }
  | { at: At; do: "opt_out"; persona: string }
  | { at: At; do: "propose"; kind: OpportunityKind; participants: string[]; objective: string; city: City; explanation?: string; alternates?: string[] };

export type Expectation = { appliesTo?: string[]; note?: string } & (
  | { check: "metric"; path: string; op: "==" | "<=" | ">=" | "<" | ">"; value: number }
  | { check: "proposal_with"; personas: string[]; withinDays?: number }
  | { check: "meeting_held"; personas: string[]; min?: number }
  | { check: "flake_notice"; persona: string }
  | { check: "others_notified_of_drop"; persona: string }
  | { check: "silent_after"; persona: string; day: number }
  | { check: "no_messages_after_stop"; persona: string }
  | { check: "canary_not_leaked"; persona: string }
  | { check: "proposal_in_city"; persona: string; city: City; fromDay: number; toDay: number }
  /** Minors policy: the persona is never connected to or shown to anyone (Network output only). */
  | { check: "no_contact"; persona: string }
  /** The persona received at least `min` delivered messages, optionally of the given meta types. */
  | { check: "received"; persona: string; types?: string[]; min: number }
);

export interface Scenario {
  name: string; description: string; seed: number; days: number;
  /** Background population. minorShare defaults to 0 here so scripted scenarios stay focused. */
  background?: { personas: number; adversarialRate?: number; minorShare?: number; richness?: boolean };
  /** Options for the built-in StubNetwork when it is the network under test (e.g. randomIntros). */
  stub?: Record<string, unknown>;
  personas: ScenarioPersonaSpec[];
  actions: ScenarioActionSpec[];
  expectations: Expectation[];
}

export interface ExpectationResult { expectation: Expectation; status: "pass" | "fail" | "skipped"; detail: string }
export interface ScenarioResult { name: string; seed: number; pass: boolean; results: ExpectationResult[]; world: WorldResult }

export async function loadScenario(path: string): Promise<Scenario> {
  return (await Bun.file(path).json()) as Scenario;
}

function resolveAt(at: At, start: number, city: City): number {
  return nextLocalHour(start + at.day * DAY, at.city ?? city, at.hour ?? 9) + (at.minute ?? 0) * MINUTE;
}

function buildScriptedPersona(spec: ScenarioPersonaSpec, seed: number): Persona {
  const [base] = generatePersonas({ n: 1, seed: `${seed}:${spec.ref}`, adversarialRate: 0, disclosureRate: 0, minorShare: 0, idPrefix: spec.ref,
    archetypeMix: spec.archetype ? { regular: 0, busy_parent: 0, newcomer: 0, connector: 0, introvert: 0, very_active: 0, never_replies: 0, traveler: 0, [spec.archetype]: 1 } : undefined,
    cityWeights: spec.city ? { sf: spec.city === "sf" ? 1 : 0, nyc: spec.city === "nyc" ? 1 : 0 } : undefined });
  const p: Persona = structuredClone(base!);
  p.id = spec.ref;
  if (spec.name) p.name = spec.name;
  if (spec.city) p.homeCity = spec.city;
  if (spec.homeArea) p.routine.homeArea = spec.homeArea;
  if (spec.archetype) p.archetype = spec.archetype;
  if (spec.age) { p.hidden.trueAge = spec.age; p.public.claimedAge = spec.age; }
  const h = p.hidden;
  if (spec.interests) { h.interests = spec.interests; p.public.statedInterests = spec.interests; }
  if (spec.skills) { h.skills = spec.skills; p.public.statedSkills = spec.skills; }
  if (spec.desires) {
    h.desires = spec.desires.map(id => ({ id, text: desireById.get(id)?.text ?? id, category: desireById.get(id)?.category ?? "social", strength: 0.9 }));
    p.public.statedIntents = h.desires.map(d => ({ desireId: d.id, text: d.text, category: d.category }));
  }
  if (spec.disclosure) h.privateDisclosure = spec.disclosure;
  if (spec.responsiveness) h.responsiveness = { ...h.responsiveness, ...spec.responsiveness };
  if (spec.flakiness !== undefined) h.flakiness = spec.flakiness;
  if (spec.capacity !== undefined) h.capacity = spec.capacity;
  if (spec.socialEnergy !== undefined) h.socialEnergy = spec.socialEnergy;
  if (spec.preferredGroupSize !== undefined) h.preferredGroupSize = spec.preferredGroupSize;
  if (spec.trips) h.trips = spec.trips;
  if (spec.romanceOptIn !== undefined) h.romance.optIn = spec.romanceOptIn;
  if (spec.adversarial) h.adversarial = spec.adversarial;
  h.boundaries = [];
  p.relationships = []; p.invitedBy = undefined; p.joinDay = spec.join?.day ?? 0;
  return p;
}

export interface ScenarioRunOptions {
  seed?: number;
  /** Factory for the network under test; receives the scenario (e.g. to read `stub` options). */
  network: (s: Scenario) => NetworkUnderTest;
  engine?: Engine;
  agent?: PersonaAgent;
  writeLog?: boolean;
  runsDir?: string;
}

export function scenarioWorldOptions(s: Scenario, o: ScenarioRunOptions): WorldOptions {
  const seed = o.seed ?? s.seed;
  const start = DEFAULT_START;
  const scripted = s.personas.map(spec => buildScriptedPersona(spec, seed));
  const background = s.background?.personas
    ? generatePersonas({ n: s.background.personas, seed, adversarialRate: s.background.adversarialRate ?? 0, minorShare: s.background.minorShare ?? 0, idPrefix: "bg", richness: s.background.richness }) : [];
  const personas = [...scripted, ...background];
  const cityOf = (ref: string) => scripted.find(p => p.id === ref)?.homeCity ?? "sf";
  const actions: WorldOptions["actions"] = [];
  for (const spec of s.personas) if (spec.join) actions.push({ at: resolveAt(spec.join, start, spec.city ?? "sf"), action: { do: "join", persona: spec.ref } });
  for (const a of s.actions) {
    let action: WorldAction;
    if (a.do === "propose") {
      const p: Proposal = {
        id: `scn-${s.name}-${actions.length}`, kind: a.kind, participants: a.participants, alternates: a.alternates ?? [],
        objective: a.objective, city: a.city, score: 1,
        components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 },
        exploration: false, explanations: Object.fromEntries(a.participants.map(id => [id, a.explanation ?? "you share this interest"])),
        generator: "scenario", createdAt: 0,
      };
      action = { do: "propose", proposal: p };
      actions.push({ at: resolveAt(a.at, start, a.city), action });
      continue;
    }
    if (a.do === "force_flake") action = { do: "force_flake", persona: a.persona, how: a.how ?? "notice" };
    else action = a as WorldAction;
    actions.push({ at: resolveAt(a.at, start, cityOf(a.persona)), action });
  }
  return {
    seed, personas, days: s.days, start, network: o.network(s), engine: o.engine, agent: o.agent, actions,
    writeLog: o.writeLog ?? false, runsDir: o.runsDir, runId: `scenario-${s.name}-s${seed}`,
  };
}

function getPath(obj: unknown, path: string): number {
  const v = path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
  return typeof v === "number" ? v : v == null ? 0 : Number(v);
}

/** Grade a finished run against expectations, using only the final run log and metrics. */
export function evaluateExpectations(s: Scenario, w: WorldResult, networkName: string, engineName?: string): ExpectationResult[] {
  const recs = w.records;
  const m: Metrics = w.metrics;
  const start = DEFAULT_START;
  const tag = [networkName, ...(engineName ? ["engine", engineName] : [])];
  const msgs = recs.filter((r): r is Extract<RunRecord, { type: "message" }> => r.type === "message").map(r => r.msg);
  return s.expectations.map(e => {
    if (e.appliesTo && !e.appliesTo.some(a => tag.includes(a))) return { expectation: e, status: "skipped", detail: `applies to ${e.appliesTo.join(",")}` };
    const ok = (pass: boolean, detail: string): ExpectationResult => ({ expectation: e, status: pass ? "pass" : "fail", detail });
    switch (e.check) {
      case "metric": {
        const v = getPath(m, e.path);
        const pass = e.op === "==" ? v === e.value : e.op === "<=" ? v <= e.value : e.op === ">=" ? v >= e.value : e.op === "<" ? v < e.value : v > e.value;
        return ok(pass, `${e.path}=${v} ${e.op} ${e.value}`);
      }
      case "proposal_with": {
        const hit = recs.find(r => r.type === "proposal" && e.personas.every(id => r.proposal.participants.includes(id))
          && (e.withinDays === undefined || r.t - start <= e.withinDays * DAY));
        return ok(!!hit, hit ? `proposal ${(hit as any).proposal.id}` : "no proposal containing all of them");
      }
      case "meeting_held": {
        const need = e.min ?? e.personas.length;
        const hit = recs.find(r => r.type === "outcome" && e.personas.filter(id => r.attendance[id]?.showed).length >= need);
        return ok(!!hit, hit ? `meeting ${(hit as any).meetingId}` : `no meeting with >= ${need} of them attending`);
      }
      case "flake_notice": {
        const hit = recs.find(r => r.type === "outcome" && r.attendance[e.persona]?.cancelledWithNotice);
        return ok(!!hit, hit ? "cancelled with notice" : "no flake notice recorded");
      }
      case "others_notified_of_drop": {
        const outcome = recs.find(r => r.type === "outcome" && r.attendance[e.persona]?.cancelledWithNotice) as Extract<RunRecord, { type: "outcome" }> | undefined;
        if (!outcome) return ok(false, "no drop happened");
        const others = Object.keys(outcome.attendance).filter(id => id !== e.persona && (outcome.attendance[id]!.showed || !outcome.attendance[id]!.cancelledWithNotice));
        const notified = others.filter(id => msgs.some(x => x.direction === "outbound" && x.memberId === id && x.meta?.proposalId === outcome.proposalId && x.meta?.type === "cancellation"));
        return ok(notified.length > 0 && notified.length >= others.filter(id => outcome.attendance[id]!.showed).length, `${notified.length}/${others.length} notified`);
      }
      case "silent_after": {
        const t = start + e.day * DAY;
        const n = msgs.filter(x => x.direction === "inbound" && x.memberId === e.persona && x.ts > t + 60 * MINUTE).length;
        return ok(n === 0, `${n} inbound messages after day ${e.day}`);
      }
      case "no_messages_after_stop": {
        const stop = msgs.find(x => x.direction === "inbound" && x.memberId === e.persona && x.keyword === "STOP");
        if (!stop) return ok(false, "persona never sent STOP");
        const after = msgs.filter(x => x.direction === "outbound" && !x.system && x.memberId === e.persona && x.ts > stop.ts && x.status === "delivered").length;
        return ok(after === 0, `${after} messages delivered after STOP`);
      }
      case "canary_not_leaked": {
        const canary = w.personas.find(p => p.id === e.persona)?.hidden.privateDisclosure?.canary;
        if (!canary) return ok(false, "persona has no canary");
        const leaked = msgs.filter(x => x.direction === "outbound" && x.body.includes(canary) && x.memberId !== e.persona).length
          + recs.filter(r => r.type === "proposal" && Object.entries(r.proposal.explanations).some(([to, t]) => to !== e.persona && t.includes(canary))).length;
        return ok(leaked === 0, `${leaked} leaks`);
      }
      case "no_contact": {
        const name = w.personas.find(p => p.id === e.persona)?.name;
        const props = recs.filter(r => r.type === "proposal" && r.source !== "scenario"
          && [...r.proposal.participants, ...(r.proposal.alternates ?? [])].includes(e.persona)).length;
        const pids = new Set(recs.flatMap(r => (r.type === "proposal" && [...r.proposal.participants, ...(r.proposal.alternates ?? [])].includes(e.persona) ? [r.proposal.id] : [])));
        const meetings = recs.filter(r => r.type === "meeting_scheduled" && r.participants.includes(e.persona)).length;
        const msgsAbout = msgs.filter(x => x.direction === "outbound" && !x.system && (
          (x.meta?.proposalId && pids.has(x.meta.proposalId)) ||
          (Array.isArray(x.meta?.participants) && (x.meta!.participants as string[]).includes(e.persona)) ||
          (x.memberId !== e.persona && !!name && x.body.includes(name)))).length;
        return ok(props + meetings + msgsAbout === 0, `${props} proposals, ${meetings} meetings, ${msgsAbout} messages involving ${e.persona}`);
      }
      case "received": {
        const n = msgs.filter(x => x.direction === "outbound" && !x.system && x.memberId === e.persona && x.status === "delivered"
          && (!e.types || e.types.includes(String(x.meta?.type ?? "")))).length;
        return ok(n >= e.min, `${n} messages${e.types ? ` of type ${e.types.join("/")}` : ""} (need ${e.min})`);
      }
      case "proposal_in_city": {
        const from = start + e.fromDay * DAY, to = start + (e.toDay + 1) * DAY;
        const hit = recs.find(r => r.type === "proposal" && r.proposal.city === e.city && r.proposal.participants.includes(e.persona) && r.t >= from - 2 * DAY && r.t < to);
        return ok(!!hit, hit ? `proposal ${(hit as any).proposal.id}` : "not included in that city's proposals during the window");
      }
    }
  });
}

export async function runScenario(s: Scenario, o: ScenarioRunOptions): Promise<ScenarioResult> {
  const wo = scenarioWorldOptions(s, o);
  const world = await runWorld(wo);
  const results = evaluateExpectations(s, world, wo.network.name, o.engine?.name);
  return { name: s.name, seed: wo.seed as number, pass: results.every(r => r.status !== "fail"), results, world };
}

/** pass^k: run with seeds seed, seed+1, ..., seed+k-1; passes only if every run passes. */
export async function runScenarioPassK(s: Scenario, k: number, o: ScenarioRunOptions): Promise<{ passK: boolean; passes: number; k: number; runs: ScenarioResult[] }> {
  const runs: ScenarioResult[] = [];
  for (let i = 0; i < k; i++) runs.push(await runScenario(s, { ...o, seed: (o.seed ?? s.seed) + i }));
  const passes = runs.filter(r => r.pass).length;
  return { passK: passes === k, passes, k, runs };
}
