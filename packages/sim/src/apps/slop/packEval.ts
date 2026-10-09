// Evaluate the slop.date AppPack (the real engine with slopPack) against the baselines on the slop
// world, with the launch gates of docs/results/2026-10-08-slop-pack.md. No LLM calls.
//   bun run packages/sim/src/apps/slop/packEval.ts --seeds 1-4 --weeks 4 [--arms random,greedy,oracle,slop]
//       [--variant '{"assignment":"stable"}' --variant-name stable] [--json out.json] [--md]
// Arms: random, greedy, oracle (the world's baselines) and slop (the pack with its defaults); every
// --variant adds a slop arm with those pack options (ablations / tuning).
import type { MemberId } from "@thenetwork/core";
import { BASELINES } from "./baselines.ts";
import { slopEngineMatcher } from "./enginePack.ts";
import { slopMetrics, type SlopMetrics } from "./metrics.ts";
import { isSafe } from "./oracle.ts";
import { groupOf } from "./persona.ts";
import { biasMonitor, ratingQuintiles, type BiasReport } from "@thenetwork/engine/src/packs/slop/biasMonitor.ts";
import { parseAppearance } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { CHECKIN_DEFAULTS, RATER_DEFAULTS, demoGroupOf, raterFacet, RELAY_DEFAULTS, REVIEW_DEFAULTS, VERIFICATION_DEFAULTS, WIDEN_DEFAULTS, type PlatformModel, type VerificationModel } from "./snapshot.ts";
import { runSlopWorld, runSlopWorldAsync, type SlopRunResult } from "./world.ts";
import { BODY_TYPE_DEFAULTS, type BodyTypeModel } from "./bodyType.ts";

export interface ArmResult { arm: string; seeds: number[]; metrics: SlopMetrics[]; extra: Extra[] }
/** Metrics the world's slopMetrics does not compute. */
export interface Extra {
  /** Distinct real members each scammer reached (a reveal) during the run: median over scammers (PRD 40.8: <= 1). */
  scammerMedianReach: number;
  /** Dates and member-months per fairness group (pooled across seeds for the fairness gate). */
  groups: Record<string, { dates: number; memberMonths: number }>;
  /** The same, over FEASIBLE members only: real members with at least one stated-mutual real partner at the start. */
  feasibleGroups: Record<string, { dates: number; memberMonths: number }>;
  overall: { dates: number; memberMonths: number };
  asksSent: number; asksAnswered: number;
  /** Adversary contacts (per side) and harm events by kind. */
  contactsByKind: Record<string, number>; harmsByKind: Record<string, number>;
  /** Iteration 3: outcomes by the synthetic demographic group (rater bias test), real members only. */
  demo: Record<"A" | "B", { n: number; dates: number; second: number; memberMonths: number; proposals: number }>;
  /** Iteration 4: per real member outcomes with their synthetic group and rating quintile (bias monitor input). */
  outcomes: { demo: "A" | "B"; quintile?: string; memberMonths: number; proposals: number; dates: number; secondDates: number }[];
  /** Iteration 3: harassers' victims: offenders with any victim, total victims, victims after the offender's first report (max and total). */
  harassment: { offenders: number; victims: number; secondPlusVictims: number; afterReportMax: number; afterReportTotal: number };
  /** Iteration 3 gate inputs: scam harm events; core adversary contacts (scammers, harassers, age liars); harms other than deception. */
  scamHarms: number; coreAdversaryContacts: number; harmsNoDeception: number;
  /** Iteration 2: members who widened their radius when asked; relay classifier stats. */
  widened: number; relay?: NonNullable<SlopRunResult["relay"]>; photos?: NonNullable<SlopRunResult["photos"]>;
  /**
   * Low-variance companions of the realized rates (for tuning; the gates use the realized ones):
   * mean oracle soft label over the dates that happened (pSecond, 32 chemistry draws; 0 with an
   * adversary or a minor), and its sum (expected second dates).
   */
  softSecondRate: number; softSecondDates: number;
}

const WEEKS_PER_MONTH = 4.345;

export function extraOf(res: SlopRunResult, m: SlopMetrics): Extra {

  const reach = new Map<MemberId, Set<MemberId>>();
  for (const p of res.world.personas) if (p.hidden.adversary === "romance_scammer") reach.set(p.id, new Set());
  for (const f of res.flows) {
    if (!f.revealed) continue;
    for (const [x, y] of [[f.first, f.partner], [f.partner, f.first]] as const) reach.get(x)?.add(y);
  }
  const rs = [...reach.values()].map(s => s.size).sort((a, b) => a - b);
  const months = res.world.weeks / WEEKS_PER_MONTH;
  const groups: Extra["groups"] = {};
  for (const [k, g] of Object.entries(m.fairness.byGroup)) groups[k] = { dates: g.datesPerMemberMonth * g.n * months, memberMonths: g.n * months };

  // Feasible members: at least one other real member inside the stated filters both ways (week 0).
  const O = res.world.oracle, real = res.world.personas.filter(isSafe);
  const datesOf = new Map<MemberId, number>();
  for (const f of res.flows) if (f.stage === "date") for (const id of [f.first, f.partner]) datesOf.set(id, (datesOf.get(id) ?? 0) + 1);
  const feasibleGroups: Extra["feasibleGroups"] = {};
  for (const p of real) {
    if (!real.some(q => O.statedMutual(p, q, 0))) continue;
    const g = (feasibleGroups[groupOf(p)] ??= { dates: 0, memberMonths: 0 });
    g.dates += datesOf.get(p.id) ?? 0; g.memberMonths += months;
  }
  const contactsByKind: Record<string, number> = {}, harmsByKind: Record<string, number> = {};
  for (const f of res.flows) {
    if (f.revealed) for (const id of [f.first, f.partner]) { const k = O.p(id).hidden.adversary; if (k) contactsByKind[k] = (contactsByKind[k] ?? 0) + 1; }
    for (const h of f.harms) harmsByKind[h.kind] = (harmsByKind[h.kind] ?? 0) + 1;
  }
  // Iteration 3 metrics.
  const demo: Extra["demo"] = { A: { n: 0, dates: 0, second: 0, memberMonths: 0, proposals: 0 }, B: { n: 0, dates: 0, second: 0, memberMonths: 0, proposals: 0 } };
  const share = res.world.state.platform?.rater?.biasShare ?? RATER_DEFAULTS.biasShare;
  const secOf = new Map<MemberId, number>(), propOf = new Map<MemberId, number>();
  for (const f of res.flows) for (const id of [f.first, f.partner]) { propOf.set(id, (propOf.get(id) ?? 0) + 1); if (f.secondDate) secOf.set(id, (secOf.get(id) ?? 0) + 1); }
  for (const p of real) { const g = demo[demoGroupOf(p.id, share)]; g.n++; g.dates += datesOf.get(p.id) ?? 0; g.second += secOf.get(p.id) ?? 0; g.memberMonths += months; g.proposals += propOf.get(p.id) ?? 0; }
  // Iteration 4: rating quintile (of the RATED overall score, what an admin would see) for the bias monitor.
  // Without a rater in the run (control arms), the same simulated rating is computed so the quintiles compare.
  const rater = res.world.state.platform?.rater ?? { ...RATER_DEFAULTS, biasShare: share };
  const rated = new Map<MemberId, number>();
  if (rater) for (const p of real) { const f = raterFacet(p, 0, rater, false); const a = f && parseAppearance(f.tags); if (a) rated.set(p.id, a.overall); }
  const qOf = ratingQuintiles(rated);
  const outcomes: Extra["outcomes"] = real.map(p => ({ demo: demoGroupOf(p.id, share), ...(qOf.has(p.id) ? { quintile: qOf.get(p.id)! } : {}), memberMonths: months, proposals: propOf.get(p.id) ?? 0, dates: datesOf.get(p.id) ?? 0, secondDates: secOf.get(p.id) ?? 0 }));
  const har = new Map<MemberId, { victims: MemberId[]; reportedAt: number }>();
  res.flows.forEach((f, i) => { for (const h of f.harms) if (h.kind === "harassment") {
    const e = har.get(h.offender) ?? { victims: [], reportedAt: Infinity };
    if (i > e.reportedAt && !e.victims.includes(h.victim)) (e as { after?: number }).after = ((e as { after?: number }).after ?? 0) + 1;
    if (!e.victims.includes(h.victim)) e.victims.push(h.victim);
    if (h.reported) e.reportedAt = Math.min(e.reportedAt, i);
    har.set(h.offender, e);
  } });
  const after = [...har.values()].map(e => (e as { after?: number }).after ?? 0);
  const harassment = { offenders: har.size, victims: [...har.values()].reduce((s, e) => s + e.victims.length, 0), secondPlusVictims: [...har.values()].reduce((s, e) => s + Math.max(0, e.victims.length - 1), 0), afterReportMax: Math.max(0, ...after), afterReportTotal: after.reduce((s, x) => s + x, 0) };
  let scamHarms = 0, harmsNoDeception = 0, coreAdversaryContacts = 0;
  for (const f of res.flows) {
    for (const h of f.harms) { if (["offplatform_move", "money_ask", "financial_loss"].includes(h.kind)) scamHarms++; if (h.kind !== "deception") harmsNoDeception++; }
    if (f.revealed && [f.first, f.partner].some(id => ["romance_scammer", "harasser", "age_liar"].includes(O.p(id).hidden.adversary ?? ""))) coreAdversaryContacts++;
  }
  let soft = 0, nd = 0;
  for (const f of res.flows) if (f.stage === "date") { nd++; soft += res.world.oracle.softLabel(f.first, f.partner, f.activity, 32).pSecond; }
  return {
    softSecondRate: nd ? soft / nd : 0, softSecondDates: soft,
    scammerMedianReach: rs.length ? rs[Math.floor((rs.length - 1) / 2)]! : 0,
    groups, feasibleGroups, overall: { dates: m.datesPerMemberMonth * m.members * months, memberMonths: m.members * months },
    asksSent: res.asks?.sent ?? 0, asksAnswered: res.asks?.answered ?? 0,
    contactsByKind, harmsByKind, demo, outcomes, harassment, scamHarms, coreAdversaryContacts, harmsNoDeception,
    widened: res.asks?.widened ?? 0, ...(res.relay ? { relay: res.relay } : {}), ...(res.photos ? { photos: res.photos } : {}),
  };
}

/** A world spec for an arm: verification and the iteration-2 platform features (snapshot.ts PlatformModel). */
export interface WorldSpec {
  verification?: boolean; photos?: number; /** Share of adults who consent to show their photo to a match (default 1). */ photoConsent?: number; relay?: boolean | Partial<NonNullable<PlatformModel["relay"]>>; review?: number; widen?: boolean;
  /** Iteration 3: appearance rater (noise, bias), post-date check-in reports, catfish share of the population. */
  rater?: boolean | Partial<NonNullable<PlatformModel["rater"]>>; checkin?: boolean; catfish?: number;
  /** Iteration 4: body types and body-type preferences in the world (bodyType.ts). */
  bodyTypes?: boolean | Partial<BodyTypeModel>;
}
export function worldOptions(w: WorldSpec = {}): { verification?: VerificationModel; platform?: PlatformModel; adversaryShares?: { catfish: number }; bodyTypes?: BodyTypeModel } {
  const platform: PlatformModel = {};
  if (w.rater) platform.rater = { ...RATER_DEFAULTS, ...(typeof w.rater === "object" ? w.rater : {}) };
  if (w.checkin) platform.checkin = { ...CHECKIN_DEFAULTS };
  if (w.photos !== undefined) platform.photos = { noiseSd: w.photos, ...(w.photoConsent !== undefined ? { consent: w.photoConsent } : {}) };
  if (w.relay) platform.relay = { ...RELAY_DEFAULTS, ...(typeof w.relay === "object" ? w.relay : {}) };
  if (w.review !== undefined) platform.review = { ...REVIEW_DEFAULTS, days: w.review };
  if (w.widen) platform.widen = { ...WIDEN_DEFAULTS };
  return { ...(w.verification ? { verification: VERIFICATION_DEFAULTS } : {}), ...(Object.keys(platform).length ? { platform } : {}), ...(w.catfish !== undefined ? { adversaryShares: { catfish: w.catfish } } : {}), ...(w.bodyTypes ? { bodyTypes: { ...BODY_TYPE_DEFAULTS, ...(typeof w.bodyTypes === "object" ? w.bodyTypes : {}) } } : {}) };
}

/**
 * Run one arm over seeds. A baseline name runs that baseline; anything else runs slopPack with
 * `options`. In `options`, "$world" sets the arm's world (WorldSpec) and "$baseline" runs a baseline
 * in that world instead of the pack.
 */
export async function runArm(arm: string, seeds: number[], weeks: number, perCity: number, options?: Record<string, unknown>, world: WorldSpec = {}): Promise<ArmResult> {
  const out: ArmResult = { arm, seeds, metrics: [], extra: [] };
  const { $world, $baseline, ...packOpts } = (options ?? {}) as { $world?: WorldSpec; $baseline?: string };
  const wo = worldOptions({ ...world, ...($world ?? {}) });
  const base = $baseline ?? (arm in BASELINES && !options ? arm : undefined);
  for (const seed of seeds) {
    const res = base
      ? runSlopWorld({ seed, perCity, weeks, matcher: BASELINES[base as keyof typeof BASELINES] as never, ...wo })
      : await runSlopWorldAsync({ seed, perCity, weeks, matcher: slopEngineMatcher({ name: arm, options: packOpts, seed }), ...wo });
    const m = slopMetrics(res);
    out.metrics.push(m);
    out.extra.push(extraOf(res, m));
  }
  return out;
}

const STACK = { verification: true, relay: true, review: 3, widen: true };
/** Iteration-3 appearance semantics (overall only, no body type), so the it3 presets reproduce after the iteration-4 defaults. */
/** Runs made before the iteration-5 rating floor became default: the floor off. */
const NOFLOOR = { ratingFloor: { weight: 0 } };
const IT3 = { dims: { face: 0, body: 0, overall: 1 }, bodyType: { enabled: false }, protectBelow: 0 };
/** Iteration-4 appearance semantics (no bottom-quintile protection), so the it4 / it5tune presets reproduce. */
const IT4 = { protectBelow: 0 };

/** The tuning trail (cumulative steps; run on seeds 1-4) and the ablations (each component off; held-out 5-8). */
const OFF = { safetyGate: false, trust: { enabled: false }, asks: false, compatAsks: false, typeAsk: false, learned: { enabled: false }, reprobeAfterDays: 0, congestion: { scarceDegree: 0 } };
export const PRESETS: Record<string, [string, object][]> = {
  trail: [
    ["t1 filters+compat", OFF],
    ["t2 +safety holds", { ...OFF, safetyGate: true, trust: { enabled: true } }],
    ["t3 +hard-field asks", { ...OFF, safetyGate: true, trust: { enabled: true }, asks: true }],
    ["t4 +basics ask", { ...OFF, safetyGate: true, trust: { enabled: true }, asks: true, compatAsks: true }],
    ["t5 +type ask", { ...OFF, safetyGate: true, trust: { enabled: true }, asks: true, compatAsks: true, typeAsk: true }],
    ["t6 +learned", { ...OFF, safetyGate: true, trust: { enabled: true }, asks: true, compatAsks: true, typeAsk: true, learned: { enabled: true } }],
    ["t7 +re-probe", { congestion: { scarceDegree: 0 } }],
    ["t8 +scarce first (final)", {}],
  ],
  rejected: [
    ["x stable roommates", { assignment: "stable" }],
    ["x min aggregate", { aggregate: "min" }],
    ["x backup round", { congestion: { perMemberPerTick: 2 } }],
    ["x minValue 0.4", { minValue: 0.4 }],
    ["x hold for basics", { holdForBasics: true }],
    ["x typeWeight 0.3", { compat: { typeWeight: 0.3 } }],
    ["x scarce 4", { congestion: { scarceDegree: 4 } }],
    ["x guess after a silent ask", { silentFallback: { enabled: true } }],
  ],
  ablations: [
    ["- stable instead of greedy", { assignment: "stable" }],
    ["- no scarce-first", { congestion: { scarceDegree: 0 } }],
    ["- backup round (2/tick)", { congestion: { perMemberPerTick: 2 } }],
    ["- no safety gating", { safetyGate: false, trust: { enabled: false } }],
    ["- no asks (guess)", { asks: false, compatAsks: false }],
    ["- no compat asks", { compatAsks: false }],
    ["- no learned", { learned: { enabled: false } }],
    ["- no compat model", { compat: { goalClash: 1, goalUnsure: 1, goalUnknown: 1, lifestyleMismatch: 1, politicsClash: 1, religionGap: 1, kidsClash: 1, unknownField: 1, hiddenDealbreaker: 0, sharedInterest: [1, 1, 1], activityMiss: 1, typeWeight: 0 } }],
  ],
  // Iteration 3 (tuning seeds 1-12, held-out 13-16), all with --population '{"catfish":0.005}' --world STACK3.
  it3tune: [
    ["stack3", {}],
    ["soft 0.1", { $world: { rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.1 }, congestion: NOFLOOR }],
    ["soft 0.25", { $world: { rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.25 }, congestion: NOFLOOR }],
    ["soft 0.5", { $world: { rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.5 }, congestion: NOFLOOR }],
    ["band 1", { $world: { rater: true }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["band 1.5", { $world: { rater: true }, appearance: { ...IT3, mode: "band", band: 1.5 }, congestion: NOFLOOR }],
    ["photos 1", { $world: { photos: 1 } }],
    ["photos 1 + learning", { $world: { photos: 1 }, attraction: { enabled: true } }],
    ["photos 1 + soft 0.25", { $world: { photos: 1, rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.25 }, congestion: NOFLOOR }],
    ["photos 1 + band 1", { $world: { photos: 1, rater: true }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
  ],
  it3held: [
    ["stack3", {}],
    ["stack3 + soft 0.1", { $world: { rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.1 }, congestion: NOFLOOR }],
    ["stack3 + band 1", { $world: { rater: true }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["photos 1", { $world: { photos: 1 } }],
    ["photos 1 + learning", { $world: { photos: 1 }, attraction: { enabled: true } }],
    ["photos 1 + soft 0.1", { $world: { photos: 1, rater: true }, appearance: { ...IT3, mode: "soft", softWeight: 0.1 }, congestion: NOFLOOR }],
    ["photos 1 + band 1", { $world: { photos: 1, rater: true }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["soft 0.1, bias 0.5", { $world: { rater: { bias: 0.5 } }, appearance: { ...IT3, mode: "soft", softWeight: 0.1 }, congestion: NOFLOOR }],
    ["soft 0.1, bias 1", { $world: { rater: { bias: 1 } }, appearance: { ...IT3, mode: "soft", softWeight: 0.1 }, congestion: NOFLOOR }],
    ["band 1, bias 0.5", { $world: { rater: { bias: 0.5 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["band 1, bias 1", { $world: { rater: { bias: 1 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["photos 1 + band 1, bias 1", { $world: { photos: 1, rater: { bias: 1 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["random + stack3", { $baseline: "random" }],
  ],
  it3bias: [
    ["band 1, bias 0", { $world: { rater: { bias: 0 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["band 1, bias 0.5", { $world: { rater: { bias: 0.5 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["band 1, bias 1", { $world: { rater: { bias: 1 } }, appearance: { ...IT3, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["soft 0.25, bias 0", { $world: { rater: { bias: 0 } }, appearance: { ...IT3, mode: "soft", softWeight: 0.25 }, congestion: NOFLOOR }],
    ["soft 0.25, bias 0.5", { $world: { rater: { bias: 0.5 } }, appearance: { ...IT3, mode: "soft", softWeight: 0.25 }, congestion: NOFLOOR }],
    ["soft 0.25, bias 1", { $world: { rater: { bias: 1 } }, appearance: { ...IT3, mode: "soft", softWeight: 0.25 }, congestion: NOFLOOR }],
  ],
  // Iteration 4 (rater ON by default; founder wants photos in the probe). Run with
  // --population '{"catfish":0.005,"bodyTypes":true}' --world STACK3 (+ checkin). Tuning seeds 1-12, held-out 13-16.
  it4tune: [
    ["photos 1, rater off", { $world: { photos: 1 } }],
    ["photos 1 + it3 soft 0.1 (overall only)", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1, dims: { face: 0, body: 0, overall: 1 }, bodyType: { enabled: false } }, congestion: NOFLOOR }],
    ["photos 1 + soft 0.1 face/body/overall", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1, bodyType: { enabled: false } }, congestion: NOFLOOR }],
    ["photos 1 + body type only", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0 }, congestion: NOFLOOR }],
    ["photos 1 + soft 0.05 + body type (chosen default)", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1 + soft 0.1 + body type", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1 }, congestion: NOFLOOR }],
    ["photos 1 + soft 0.2 + body type", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.2 }, congestion: NOFLOOR }],
    ["photos 1 + soft 0.1 + body type 0.6/1", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1, bodyType: { statedWeight: 0.6, revealedWeight: 1 } }, congestion: NOFLOOR }],
    ["photos 1 + band 1 + body type", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["no photos + default", { $world: { rater: true }, appearance: IT4, congestion: NOFLOOR }],
  ],
  // Iteration 5: the rating-quintile fairness fix (photos in the probe, rater on). Same flags as it4.
  it5tune: [
    ["photos 1, rater off", { $world: { photos: 1 } }],
    ["it4 default (soft 0.05 + body type)", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: NOFLOOR }],
    ["body type only", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0 }, congestion: NOFLOOR }],
    ["a: gapFree 0.5, soft 0.1", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 0.5, softWeight: 0.1 }, congestion: NOFLOOR }],
    ["a: gapFree 1, soft 0.05", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 1 }, congestion: NOFLOOR }],
    ["a: gapFree 1, soft 0.2", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 1, softWeight: 0.2 }, congestion: NOFLOOR }],
    ["a: gapFree 1.5, soft 0.2", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 1.5, softWeight: 0.2 }, congestion: NOFLOOR }],
    ["b: floor 0.9 w 0.1", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: { ratingFloor: { floor: 0.9, weight: 0.1, smooth: 0.5 } } }],
    ["b: floor 0.9 w 0.3", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: { ratingFloor: { floor: 0.9, weight: 0.3, smooth: 0.5 } } }],
    ["c: tiebreak 2%", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "tiebreak", tieBucket: 0.02 }, congestion: NOFLOOR }],
    ["c: tiebreak 5%", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "tiebreak", tieBucket: 0.05 }, congestion: NOFLOOR }],
    ["a+b: gapFree 1, soft 0.2, floor w 0.2", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 1, softWeight: 0.2 }, congestion: { ratingFloor: { floor: 0.9, weight: 0.2, smooth: 0.5 } } }],
    ["c+b: tiebreak 2%, floor w 0.2", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "tiebreak", tieBucket: 0.02 }, congestion: { ratingFloor: { floor: 0.9, weight: 0.2, smooth: 0.5 } } }],
  ],
  it5tune2: [
    ["d: protect bottom 20%, soft 0.05", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.2 }, congestion: NOFLOOR }],
    ["d: protect bottom 20%, tiebreak 2%", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.2, mode: "tiebreak" }, congestion: NOFLOOR }],
    ["d: protect bottom 20%, gapFree 1", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.2, gapFree: 1 }, congestion: NOFLOOR }],
    ["d: protect bottom 40%, soft 0.05", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.4 }, congestion: NOFLOOR }],
    ["b2: floor 1.0 w 0.3 smooth 0.05", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: { ratingFloor: { floor: 1, weight: 0.3, smooth: 0.05 } } }],
    ["c+b2: tiebreak 2%, floor 1.0 w 0.3", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "tiebreak" }, congestion: { ratingFloor: { floor: 1, weight: 0.3, smooth: 0.05 } } }],
    ["d+c+b2", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.2, mode: "tiebreak" }, congestion: { ratingFloor: { floor: 1, weight: 0.3, smooth: 0.05 } } }],
  ],
  it5tune3: [
    ["d: protect bottom 30%, soft 0.05", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.3 }, congestion: NOFLOOR }],
    ["d: protect bottom 40%, gapFree 1", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.4, gapFree: 1 }, congestion: NOFLOOR }],
    ["d: protect bottom 40%, gapFree 1, soft 0.2", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.4, gapFree: 1, softWeight: 0.2 }, congestion: NOFLOOR }],
    ["d: protect bottom 40%, tiebreak 2%", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.4, mode: "tiebreak" }, congestion: NOFLOOR }],
    ["d+b2: protect bottom 40%, floor 1.0 w 0.3", { $world: { photos: 1, rater: true }, appearance: { protectBelow: 0.4 }, congestion: { ratingFloor: { floor: 1, weight: 0.3, smooth: 0.05 } } }],
  ],
  // Iteration 5 held-out (seeds 13-16 and 17-20).
  it5held: [
    ["photos 1, rater off", { $world: { photos: 1 } }],
    ["it4 default (soft 0.05 + body type)", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: NOFLOOR }],
    ["a: gapFree 1", { $world: { photos: 1, rater: true }, appearance: { ...IT4, gapFree: 1 }, congestion: NOFLOOR }],
    ["b: floor 1.0 w 0.3", { $world: { photos: 1, rater: true }, appearance: IT4 }],
    ["c: tiebreak 2%", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "tiebreak" }, congestion: NOFLOOR }],
    ["d: protect bottom 40%", { $world: { photos: 1, rater: true }, congestion: NOFLOOR }],
    ["d+b: protect 40% + floor (DEFAULT)", { $world: { photos: 1, rater: true } }],
    ["it4 default, bias 1", { $world: { photos: 1, rater: { bias: 1 } }, appearance: IT4, congestion: NOFLOOR }],
    ["d: protect 40%, bias 1", { $world: { photos: 1, rater: { bias: 1 } }, congestion: NOFLOOR }],
    ["no photos + d", { $world: { rater: true }, congestion: NOFLOOR }],
  ],
  it5bias: [
    ["d+b (DEFAULT), bias 0.5", { $world: { photos: 1, rater: { bias: 0.5 } } }],
    ["d+b (DEFAULT), bias 1", { $world: { photos: 1, rater: { bias: 1 } } }],
    ["no photos + DEFAULT", { $world: { rater: true } }],
  ],
  // Pooled with it4held for the bias-sensitivity table (run on seeds 1-12).
  it4bias: [
    ["photos 1, rater off", { $world: { photos: 1 } }],
    ["photos 1 + rater, bias 0", { $world: { photos: 1, rater: { bias: 0 } }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1 + rater, bias 0.5", { $world: { photos: 1, rater: { bias: 0.5 } }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1 + rater, bias 1", { $world: { photos: 1, rater: { bias: 1 } }, appearance: IT4, congestion: NOFLOOR }],
  ],
  it4held: [
    ["stack3, rater off", {}],
    ["no photos + rater (default)", { $world: { rater: true }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1, rater off", { $world: { photos: 1 } }],
    ["photos 1 + it3 soft 0.1", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1, dims: { face: 0, body: 0, overall: 1 }, bodyType: { enabled: false } }, congestion: NOFLOOR }],
    ["photos 1 + soft 0.1 face/body/overall", { $world: { photos: 1, rater: true }, appearance: { ...IT4, softWeight: 0.1, bodyType: { enabled: false } }, congestion: NOFLOOR }],
    ["photos 1 + band 1 + body type", { $world: { photos: 1, rater: true }, appearance: { ...IT4, mode: "band", band: 1 }, congestion: NOFLOOR }],
    ["photos 1 + rater (DEFAULT)", { $world: { photos: 1, rater: true }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1 + rater, bias 0.5", { $world: { photos: 1, rater: { bias: 0.5 } }, appearance: IT4, congestion: NOFLOOR }],
    ["photos 1 + rater, bias 1", { $world: { photos: 1, rater: { bias: 1 } }, appearance: IT4, congestion: NOFLOOR }],
    ["random + stack3", { $baseline: "random" }],
  ],
  // Iteration 2 (held-out seeds 9-12). W = the safety stack: verification, relay classifier, 3-day review, widen answers.
  it2: [
    ["slop it1 (iteration-1 defaults)", { maxAsksPerField: 0, widen: { enabled: false } }],
    ["slop it2, pack only", { $world: { widen: true } }],
    ["slop it2 + stack", { $world: STACK }],
    ["stack + photos sd 0.5", { $world: { ...STACK, photos: 0.5 }, attraction: { enabled: true } }],
    ["stack + photos sd 1", { $world: { ...STACK, photos: 1 }, attraction: { enabled: true } }],
    ["stack + photos sd 2", { $world: { ...STACK, photos: 2 }, attraction: { enabled: true } }],
    ["stack + photos sd 1, no learning", { $world: { ...STACK, photos: 1 } }],
    ["stack + learning, no photos", { $world: STACK, attraction: { enabled: true, probeWeight: 0 } }],
    ["stack + 2 proposals/tick", { $world: STACK, congestion: { perMemberPerTick: 2 } }],
    ["stack - relay classifier", { $world: { ...STACK, relay: false } }],
    ["stack - human review", { $world: { verification: true, relay: true, widen: true } }],
    ["stack - verification", { $world: { relay: true, review: 3, widen: true } }],
    ["stack - widen ask", { $world: STACK, widen: { enabled: false } }],
    ["stack, relay recall 0.6 / 0.5", { $world: { ...STACK, relay: { scamRecall: 0.6, hostileRecall: 0.5 } } }],
    ["random + stack", { $baseline: "random", $world: STACK }],
    ["random + photos sd 1", { $baseline: "random", $world: { photos: 1 } }],
  ],
};
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / Math.max(1, xs.length)); };
const harms = (m: SlopMetrics) => Object.values(m.safety.harms).reduce((a, b) => a + (b ?? 0), 0);

/**
 * Pooled fairness: each group's dates per member-month over the overall rate (groups with n >= 15
 * per seed on average). `feasible`: both sides over members who have at least one stated-mutual
 * partner (a member whose stated filters admit nobody cannot be served by any matcher).
 */
export function fairnessRatios(a: ArmResult, feasible = false): { byGroup: Record<string, { n: number; rate: number; ratio: number }>; min: number; minGroup: string } {
  const G = (e: Extra) => (feasible ? e.feasibleGroups : e.groups);
  const all = a.extra.reduce((s, e) => { for (const g of Object.values(G(e))) { s.dates += g.dates; s.mm += g.memberMonths; } return s; }, { dates: 0, mm: 0 });
  const overall = all.dates / all.mm;
  const keys = new Set(a.extra.flatMap(e => Object.keys(G(e))));
  const byGroup: Record<string, { n: number; rate: number; ratio: number }> = {};
  const months = a.metrics[0]!.weeks / WEEKS_PER_MONTH;
  for (const k of [...keys].sort()) {
    const d = a.extra.reduce((s, e) => s + (G(e)[k]?.dates ?? 0), 0), mm = a.extra.reduce((s, e) => s + (G(e)[k]?.memberMonths ?? 0), 0);
    const n = mm / months / a.seeds.length;
    byGroup[k] = { n, rate: d / mm, ratio: d / mm / overall };
  }
  const elig = Object.entries(byGroup).filter(([, g]) => g.n >= 15);
  const [minGroup, minG] = elig.sort((x, y) => x[1].ratio - y[1].ratio)[0] ?? ["-", { ratio: 0 }];
  return { byGroup, min: minG.ratio, minGroup };
}

/** Iteration 4: the admin bias monitor, pooled over an arm's seeds, by synthetic group and by rating quintile. */
export function armBias(a: ArmResult): { demo: BiasReport; quintile?: BiasReport } {
  const rows = a.extra.flatMap(e => e.outcomes);
  const demo = biasMonitor(rows.map(r => ({ ...r, group: r.demo })));
  const q = rows.filter(r => r.quintile);
  return { demo, ...(q.length ? { quintile: biasMonitor(q.map(r => ({ ...r, group: r.quintile! }))) } : {}) };
}

export interface Gate { name: string; value: number; target: string; pass: boolean }
/** The launch gates for "matches go well" (docs/results/2026-10-08-slop-pack.md section 3). */
export function gates(a: ArmResult, random: ArmResult): Gate[] {
  const M = (f: (m: SlopMetrics) => number, r = a) => mean(r.metrics.map(f));
  const sdr = M(m => m.secondDateRate), sdrR = M(m => m.secondDateRate, random);
  const sec = M(m => m.secondDateRate * m.dates), secR = M(m => m.secondDateRate * m.dates, random);
  const adv = M(m => m.safety.adversaryContacts), advR = M(m => m.safety.adversaryContacts, random);
  const hm = M(harms), hmR = M(harms, random);
  const fair = fairnessRatios(a), fairF = fairnessRatios(a, true);
  return [
    { name: "Declared-minor contacts", value: M(m => m.safety.minorContacts), target: "= 0", pass: a.metrics.every(m => m.safety.minorContacts === 0) },
    { name: "Hidden-minor contacts once flagged (age liars)", value: M(m => m.safety.undisclosedMinorContacts), target: "report", pass: true },
    { name: "Adversary contacts cut vs random", value: 1 - adv / advR, target: ">= 90%", pass: 1 - adv / advR >= 0.9 },
    { name: "Harm events cut vs random", value: 1 - hm / hmR, target: ">= 90%", pass: 1 - hm / hmR >= 0.9 },
    { name: "Scammer median reach (PRD 40.8)", value: mean(a.extra.map(e => e.scammerMedianReach)), target: "<= 1", pass: mean(a.extra.map(e => e.scammerMedianReach)) <= 1 },
    { name: "Second-date rate vs random", value: sdr / sdrR, target: ">= 2.5x (and >= 20%)", pass: sdr / sdrR >= 2.5 && sdr >= 0.2 },
    { name: "Second dates per seed vs random", value: sec / secR, target: ">= 2x", pass: sec / secR >= 2 },
    { name: "Top-10% share of proposals", value: M(m => m.congestion.top10ProposalShare), target: "<= 20%", pass: M(m => m.congestion.top10ProposalShare) <= 0.2 },
    { name: `Min group dates/member-month vs overall (${fair.minGroup})`, value: fair.min, target: ">= 0.7x", pass: fair.min >= 0.7 },
    { name: `Same, feasible members only (${fairF.minGroup})`, value: fairF.min, target: ">= 0.7x", pass: fairF.min >= 0.7 },
    { name: "Back-outs at reveal", value: M(m => m.backoutRate), target: "< 10%", pass: M(m => m.backoutRate) < 0.1 },
    { name: "Dates per member-month vs random", value: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random), target: ">= 0.9x", pass: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random) >= 0.9 },
    { name: "Stated-filter violations", value: M(m => m.filterViolations), target: "= 0", pass: a.metrics.every(m => m.filterViolations === 0) },
  ];
}

/** Iteration 3 gates (founder safety model 2026-10-08): not being single is not a harm; catfish not gated pre-contact. */
export function gates3(a: ArmResult, random: ArmResult): Gate[] {
  const M = (f: (m: SlopMetrics) => number, r = a) => mean(r.metrics.map(f));
  const X = (f: (e: Extra) => number, r = a) => mean(r.extra.map(f));
  const cut = (f: (e: Extra) => number) => 1 - X(f) / Math.max(1e-9, X(f, random));
  const cutM = (f: (m: SlopMetrics) => number) => 1 - M(f) / Math.max(1e-9, M(f, random));
  const sdr = M(m => m.secondDateRate), sdrR = M(m => m.secondDateRate, random);
  const sec = M(m => m.secondDateRate * m.dates), secR = M(m => m.secondDateRate * m.dates, random);
  const fair = fairnessRatios(a), fairF = fairnessRatios(a, true);
  const rep = Math.max(...a.extra.map(e => e.harassment.afterReportMax));
  return [
    { name: "Declared-minor contacts", value: M(m => m.safety.minorContacts), target: "= 0", pass: a.metrics.every(m => m.safety.minorContacts === 0) },
    { name: "Stated-filter violations", value: M(m => m.filterViolations), target: "= 0", pass: a.metrics.every(m => m.filterViolations === 0) },
    { name: "Scam harm events cut vs random", value: cut(e => e.scamHarms), target: ">= 90%", pass: cut(e => e.scamHarms) >= 0.9 },
    { name: "Minor contacts (age liars) cut vs random", value: cutM(m => m.safety.undisclosedMinorContacts), target: ">= 90%", pass: cutM(m => m.safety.undisclosedMinorContacts) >= 0.9 },
    { name: "Repeat harassment victims per offender after the first report (max)", value: rep, target: "<= 1", pass: rep <= 1 },
    { name: "Adversary contacts cut (scammers, harassers, age liars)", value: cut(e => e.coreAdversaryContacts), target: ">= 90%", pass: cut(e => e.coreAdversaryContacts) >= 0.9 },
    { name: "Harm events cut (not counting 'not single')", value: cut(e => e.harmsNoDeception), target: ">= 90%", pass: cut(e => e.harmsNoDeception) >= 0.9 },
    { name: "Scammer median reach", value: X(e => e.scammerMedianReach), target: "<= 1", pass: X(e => e.scammerMedianReach) <= 1 },
    { name: "Second-date rate vs random (and >= 20%)", value: sdr / sdrR, target: ">= 2.5x", pass: sdr / sdrR >= 2.5 && sdr >= 0.2 },
    { name: "Second dates per seed vs random", value: sec / secR, target: ">= 2x", pass: sec / secR >= 2 },
    { name: "Top-10% share of proposals", value: M(m => m.congestion.top10ProposalShare), target: "<= 20%", pass: M(m => m.congestion.top10ProposalShare) <= 0.2 },
    { name: `Lowest group vs overall (${fair.minGroup})`, value: fair.min, target: ">= 0.7x", pass: fair.min >= 0.7 },
    { name: `Same, feasible members (${fairF.minGroup})`, value: fairF.min, target: ">= 0.7x", pass: fairF.min >= 0.7 },
    { name: "Back-outs at reveal", value: M(m => m.backoutRate), target: "< 10%", pass: M(m => m.backoutRate) < 0.1 },
    { name: "Dates per member-month vs random", value: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random), target: ">= 0.9x", pass: M(m => m.datesPerMemberMonth) / M(m => m.datesPerMemberMonth, random) >= 0.9 },
    // Iteration 5: no rating quintile under 0.85x the overall date rate (pooled over seeds).
    ...((q => (q ? [{ name: `Lowest rating quintile dates vs overall (${q.min.dates.group})`, value: q.min.dates.ratio, target: ">= 0.85x", pass: q.min.dates.ratio >= 0.85 }] : []))(armBias(a).quintile)),
  ];
}

export const ROWS: [string, (m: SlopMetrics) => number, boolean, number?][] = [
  ["Proposals / seed", m => m.proposals, false, 0],
  ["Probes delivered / seed", m => m.probesDelivered, false, 0],
  ["Dropped at a cap / seed", m => m.droppedForCap, false, 0],
  ["Mutual-yes rate", m => m.mutualYesRate, true],
  ["Back-out at reveal", m => m.backoutRate, true],
  ["Attendance (dates / booked)", m => m.attendance, true],
  ["Dates / seed", m => m.dates, false, 1],
  ["Dates per member-month", m => m.datesPerMemberMonth, false, 3],
  ["Good-date rate", m => m.goodDateRate, true],
  ["**Second-date rate (per date)**", m => m.secondDateRate, true],
  ["**Second dates / seed**", m => m.secondDateRate * m.dates, false, 1],
  ["Mean date quality", m => m.meanQuality, false, 3],
  ["Seats at a not-free time", m => m.seatsNotFree, true],
  ["Stated-filter violations / seed", m => m.filterViolations, false, 1],
  ["Members with a date", m => m.timeToFirstDate.shareWithDate, true],
  ["Median days to first date", m => m.timeToFirstDate.medianDays ?? NaN, false, 1],
  ["Top-10% share of proposals", m => m.congestion.top10ProposalShare, true],
  ["Zero-proposal share", m => m.congestion.zeroProposalShare, true],
  ["Gini, proposals", m => m.congestion.giniProposals, false, 3],
  ["Gini, probes received", m => m.congestion.giniProbes, false, 3],
  ["Declared-minor contacts (must be 0)", m => m.safety.minorContacts, false, 1],
  ["Hidden-minor contacts (age liars) / seed", m => m.safety.undisclosedMinorContacts, false, 1],
  ["Adversary contacts (reveals) / seed", m => m.safety.adversaryContacts, false, 1],
  ["Harm events / seed", harms, false, 1],
];

export function fmt(xs: number[], pct = false, d = 2): string {
  return pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(se(xs) * 100).toFixed(1)}` : `${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`;
}

export function table(arms: ArmResult[]): string {
  const lines = [`| Metric (mean ± SE, seeds ${arms[0]!.seeds.join(",")}) | ${arms.map(a => a.arm).join(" | ")} |`, `|---|${arms.map(() => "---:").join("|")}|`];
  for (const [label, f, pct, d] of ROWS) lines.push(`| ${label} | ${arms.map(a => fmt(a.metrics.map(f), pct, d)).join(" | ")} |`);
  lines.push(`| Soft second-date rate (oracle pSecond of dates held) | ${arms.map(a => fmt(a.extra.map(e => e.softSecondRate), true)).join(" | ")} |`);
  lines.push(`| Soft second dates / seed | ${arms.map(a => fmt(a.extra.map(e => e.softSecondDates), false, 1)).join(" | ")} |`);
  lines.push(`| Scammer median reach | ${arms.map(a => mean(a.extra.map(e => e.scammerMedianReach)).toFixed(2)).join(" | ")} |`);
  lines.push(`| Asks sent / answered per seed | ${arms.map(a => `${mean(a.extra.map(e => e.asksSent)).toFixed(0)} / ${mean(a.extra.map(e => e.asksAnswered)).toFixed(0)}`).join(" | ")} |`);
  lines.push(`| Min group ratio (pooled; group) | ${arms.map(a => { const f = fairnessRatios(a); return `${f.min.toFixed(2)} (${f.minGroup})`; }).join(" | ")} |`);
  lines.push(`| Rating quintile dates ratio, lowest (pooled; q) | ${arms.map(a => { const q = armBias(a).quintile; return q ? `${q.min.dates.ratio.toFixed(2)} (${q.min.dates.group})` : "-"; }).join(" | ")} |`);
  lines.push(`| Rating quintile second dates ratio, lowest (pooled; q) | ${arms.map(a => { const q = armBias(a).quintile; return q ? `${q.min.secondDates.ratio.toFixed(2)} (${q.min.secondDates.group})` : "-"; }).join(" | ")} |`);
  lines.push(`| Min group ratio, feasible members (pooled) | ${arms.map(a => { const f = fairnessRatios(a, true); return `${f.min.toFixed(2)} (${f.minGroup})`; }).join(" | ")} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  const argv = process.argv;
  const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
  const all = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? [argv[i + 1]!] : []));
  const [s0, s1] = arg("seeds", "1-4")!.split("-").map(Number);
  const seeds = Array.from({ length: (s1 ?? s0!) - s0! + 1 }, (_, i) => s0! + i);
  const weeks = Number(arg("weeks", "4")), perCity = Number(arg("per-city", "300"));
  const arms = arg("arms", "random,greedy,oracle,slop")!.split(",").filter(Boolean);
  const variants = all("variant"), names = all("variant-name");
  for (const p of all("preset")) for (const [n, v] of PRESETS[p] ?? []) { variants.push(JSON.stringify(v)); names.push(n); }
  // --verification / --world '<WorldSpec>': the world of the slop arms (and variants); the baselines
  // stay the world-doc baselines unless a variant runs one with "$baseline" (so "cut vs random" is vs today's floor).
  // --population '<WorldSpec>' (e.g. {"catfish":0.005}) applies to EVERY arm, baselines included.
  const pop: WorldSpec = JSON.parse(arg("population", "{}")!);
  const world: WorldSpec = { ...pop, ...JSON.parse(arg("world", "{}")!), ...(argv.includes("--verification") ? { verification: true } : {}) };
  const results: ArmResult[] = [];
  for (const a of arms) { const t = performance.now(); results.push(await runArm(a, seeds, weeks, perCity, a === "slop" ? {} : undefined, a === "slop" ? world : pop)); console.error(`${a}: ${((performance.now() - t) / 1000).toFixed(1)}s`); }
  for (let i = 0; i < variants.length; i++) { const t = performance.now(); results.push(await runArm(names[i] ?? `v${i}`, seeds, weeks, perCity, JSON.parse(variants[i]!), world)); console.error(`${names[i] ?? `v${i}`}: ${((performance.now() - t) / 1000).toFixed(1)}s`); }
  console.log(table(results));
  const random = results.find(r => r.arm === "random");
  if (random) for (const r of results.filter(x => x.arm !== "random")) {
    console.log(`\nGates: ${r.arm}`);
    const gs = (argv.includes("--gates3") ? gates3 : gates)(r, random);
    for (const g of gs) console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${g.name}: ${g.name.includes("cut") ? (g.value * 100).toFixed(1) + "%" : g.value.toFixed(3)} (${g.target})`);
    // The official arm is "slop" (the default pack): exit 1 when one of its gates fails (bun run sim splits blocking and tracked).
    if (r.arm === "slop" && gs.some(g => !g.pass)) process.exitCode = 1;
  }
  if (argv.includes("--groups")) for (const r of results) {
    const f = fairnessRatios(r);
    console.log(`\nGroups ${r.arm}: ` + Object.entries(f.byGroup).map(([k, g]) => `${k} n${g.n.toFixed(0)} ${g.rate.toFixed(3)} (${g.ratio.toFixed(2)})`).join("; "));
  }
  if (argv.includes("--bias")) for (const r of results) {
    const b = armBias(r);
    const fmtR = (rep: BiasReport) => Object.entries(rep.groups).map(([k, g]) => `${k} n${g.n} dates ${g.ratio.dates.toFixed(2)} 2nd ${g.ratio.secondDates.toFixed(2)} prop ${g.ratio.proposals.toFixed(2)}`).join("; ");
    console.log(`\nBias ${r.arm}: demo ${fmtR(b.demo)}${b.quintile ? ` | quintile ${fmtR(b.quintile)}` : ""}${[...b.demo.alerts, ...(b.quintile?.alerts ?? [])].length ? ` | ALERTS ${[...b.demo.alerts, ...(b.quintile?.alerts ?? [])].map(x => `${x.group}:${x.metric}=${x.ratio.toFixed(2)}`).join(", ")}` : ""}`);
  }
  const out = arg("json");
  if (out) await Bun.write(out, JSON.stringify(results.map(r => ({ arm: r.arm, seeds: r.seeds, metrics: r.metrics, extra: r.extra })), null, 1));
}
