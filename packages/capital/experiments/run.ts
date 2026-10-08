// NC simulation runner: 90 days x 8 seeds, metrics and launch gates (design 2.8).
//   bun run packages/capital/experiments/run.ts                 # default config, all arms
//   bun run packages/capital/experiments/run.ts --seeds 8 --days 90 --json out.json
//   bun run packages/capital/experiments/run.ts --sweep         # tuning sweep (cap, pair decay, thresholds)
// HARNESS ONLY. No LLM calls. Persona truth is read here only to score.
import { simulate, v14Rate, isBad, DAY, T0, type SimOptions, type SimResult, type PType } from "./world.ts";
import { balanceOf } from "../src/levers.ts";
import type { CapitalConfigInput } from "../src/config.ts";
import { effortTier } from "../src/levers.ts";

const args = process.argv.slice(2);
const flag = (k: string, d: number) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const SEEDS = flag("seeds", 8), DAYS = flag("days", 90);
/** Seeds for the paired fairness gate. 8 seeds give a standard error of about 0.045 on the paired difference, too wide for a 0.02 bound. */
const GATE_SEEDS = flag("gate-seeds", 32);

/** Small bounded gain: an adversary's net NC from gaming, after clawback and penalties. */
export const GAMING_BOUND_SHARE = 0.25; // <= 25% of an honest regular's 90-day NC, mean per strategy

export interface Metrics {
  gini: number; giniHonest: number;
  v14Bottom: number; v14Top: number; v14Ratio: number; v14All: number;
  deciles: number[];
  /** Participation per week over the V14 window, per NC decile: yeses to plans, intros and crews, sessions organized, help asked or given. */
  partDeciles: number[]; partBottom: number; partTop: number;
  regularNC: number;
  gaming: Record<string, { n: number; netGain: number; netGainShare: number; detected: number; ttdDays: number | null; ncTotal: number }>;
  flaky: { nc: number; regularNC: number; penalizedShare: number; meanPenalty: number; tierBelowRegularShare: number; netPenaltyGt3Share: number };
  vouch: { invites: number; qualityAll: number; byType: Record<string, { invites: number; quality: number }>; badAdmitted: number };
  honestFlaggedShare: number; falseConfirmed: number; flagsRaised: number;
  /** Share of honest friends (A5) ever flagged. */
  friendsFlaggedShare: number;
  tiers: number[];
}

export function measure(r: SimResult): Metrics {
  const L = r.ledger;
  const end = T0 + r.days * DAY;
  const mid = Math.floor(r.days / 2);
  const adults = r.personas.filter(p => p.age >= 18);
  const nc = (id: string, at = end) => balanceOf(L.internalEntries(id), at);
  const honest = adults.filter(p => !isBad(p.type));

  const gini = giniOf(adults.map(p => Math.max(0, nc(p.id))));
  const giniHonest = giniOf(honest.map(p => Math.max(0, nc(p.id))));

  // V14 deciles: members eligible for V14 (adults, tenure >= 14 days at mid, not paused/quiet, not sybils),
  // ranked by NC at mid-run, V14 measured over the second half (prospective).
  const elig = adults.filter(p => p.type !== "sybil" && p.joinDay <= mid - 14 && p.state !== "paused" && p.state !== "quiet" && !p.removed && p.active);
  const tieRng = mulberry(r.seed);
  const weeks = (r.days - mid) / 7;
  const ranked = elig.map(p => ({ p, nc: nc(p.id, T0 + mid * DAY), tie: tieRng(), v: v14Rate(r.values.get(p.id), mid, r.days - 1), part: (r.participation.get(p.id) ?? []).filter(d => d >= mid).length / weeks }))
    .sort((a, b) => a.nc - b.nc || a.tie - b.tie);
  const dec = Array.from({ length: 10 }, (_, i) => ranked.slice(Math.floor(i * ranked.length / 10), Math.floor((i + 1) * ranked.length / 10)));
  const deciles = dec.map(d => mean(d.map(x => x.v)));
  const v14Bottom = deciles[0]!, v14Top = deciles[9]!;
  const partDeciles = dec.map(d => mean(d.map(x => x.part)));

  const regular = adults.filter(p => p.type === "regular");
  const regularNC = mean(regular.map(p => nc(p.id)));

  const gaming: Metrics["gaming"] = {};
  for (const t of ["adv_vouch_ring", "adv_staged", "adv_help_farm"] as PType[]) {
    const advs = adults.filter(p => p.type === t);
    const gains = advs.map(p => L.internalEntries(p.id)
      .filter(e => r.gamingEvents.has(e.provenance.eventId) || e.category === "clawback" || e.category === "fraud" || (e.category === "vouch" && e.provenance.counterparts.some(c => c.startsWith("syb"))) || (e.category === "vouch_stake"))
      .reduce((s, e) => s + e.amount, 0));
    const det = advs.filter(p => r.detectedAt.has(p.id));
    const ttd = det.map(p => (r.detectedAt.get(p.id)! - (r.firstGaming.get(p.id) ?? r.detectedAt.get(p.id)!)) / DAY);
    gaming[t] = {
      n: advs.length, netGain: mean(gains), netGainShare: regularNC > 0 ? mean(gains) / regularNC : NaN,
      detected: det.length / Math.max(1, advs.length), ttdDays: ttd.length ? median(ttd) : null, ncTotal: mean(advs.map(p => nc(p.id))),
    };
  }

  const flaky = adults.filter(p => p.type === "flaky_legit");
  const penaltyOf = (id: string) => -L.internalEntries(id).filter(e => e.category === "no_show" || e.category === "ghosting").reduce((s, e) => s + e.amount, 0);
  const regTierMedian = median(regular.map(p => effortTier(nc(p.id), L.cfg)));
  const flakyM = {
    nc: mean(flaky.map(p => nc(p.id))), regularNC,
    penalizedShare: flaky.filter(p => penaltyOf(p.id) > 0).length / Math.max(1, flaky.length),
    meanPenalty: mean(flaky.map(p => penaltyOf(p.id))),
    tierBelowRegularShare: flaky.filter(p => effortTier(nc(p.id), L.cfg) < regTierMedian).length / Math.max(1, flaky.length),
    netPenaltyGt3Share: flaky.filter(p => penaltyOf(p.id) > 3).length / Math.max(1, flaky.length),
  };

  // Vouch quality (39.5): invitees who activate, get value within 30 days, and have no safety flag within 90 days.
  // Invitations sent by day days-30 only, so the 30-day value window is observed.
  const P = new Map(r.personas.map(p => [p.id, p]));
  const inv = r.invites.filter(i => i.day <= r.days - 32);
  const good = (i: SimResult["invites"][number]) => {
    const p = P.get(i.invitee);
    if (!i.joined || !p || p.type === "sybil" || p.activateDay === undefined) return false;
    if (r.safetyFlagDay.has(p.id)) return false;
    return (r.values.get(p.id) ?? []).some(d => d - p.joinDay <= 30);
  };
  const byType: Metrics["vouch"]["byType"] = {};
  for (const i of inv) {
    const t = P.get(i.voucher)!.type;
    byType[t] ??= { invites: 0, quality: 0 };
    byType[t].invites++;
    if (good(i)) byType[t].quality++;
  }
  for (const v of Object.values(byType)) v.quality = v.quality / v.invites;
  const vouch = { invites: inv.length, qualityAll: inv.filter(good).length / Math.max(1, inv.length), byType, badAdmitted: r.invites.filter(i => i.quality === "bad" && i.joined).length };

  const tiers = [0, 0, 0, 0];
  for (const p of honest) tiers[effortTier(nc(p.id), L.cfg)]!++;

  return {
    gini, giniHonest, v14Bottom, v14Top, v14Ratio: v14Bottom / v14Top, v14All: mean(ranked.map(x => x.v)), deciles, partDeciles, partBottom: partDeciles[0]!, partTop: partDeciles[9]!,
    regularNC, gaming, flaky: flakyM, vouch,
    honestFlaggedShare: r.honestFlagged.size / Math.max(1, honest.length), friendsFlaggedShare: r.friendsFlagged.size / Math.max(1, r.friends.length), falseConfirmed: r.falseConfirmed.length, flagsRaised: r.flagsRaised, tiers,
  };
}

export function runArm(name: string, o: Omit<SimOptions, "seed">, seeds = SEEDS): { name: string; per: Metrics[] } {
  const per: Metrics[] = [];
  for (let s = 1; s <= seeds; s++) per.push(measure(simulate({ ...o, seed: s, days: DAYS })));
  return { name, per };
}

// ------------------------------------------------------------------------------------------------ reporting

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const ms = (xs: number[], d = 2) => `${f(mean(xs), d)} ± ${f(se(xs), d)}`;

/**
 * Fairness gate (coordinator decision, 2026-10-08):
 *  (a) PRIMARY, blocking: NC levers must not lower the bottom/top-decile V14 ratio by more than
 *      0.02 against the same seeds with every NC lever off (paired). See `attributable`.
 *  (b) TRACKED, non-blocking network-health target: the absolute ratio is at least 0.80. It reflects
 *      the participation gap and is addressed by other levers (plans, asks), not NC.
 * Gaming gate (blocking): each strategy's mean net gain <= GAMING_BOUND_SHARE of a regular's NC.
 */
export const FAIRNESS_MAX_DROP = 0.02;
export const HEALTH_TARGET_RATIO = 0.8;

export function gates(per: Metrics[]) {
  const ratio = mean(per.map(m => m.v14Ratio));
  const worstSeedRatio = Math.min(...per.map(m => m.v14Ratio));
  const strategies = Object.keys(per[0]!.gaming);
  const gainShare = Object.fromEntries(strategies.map(s => [s, mean(per.map(m => m.gaming[s]!.netGainShare))]));
  const gamingOk = Object.values(gainShare).every(x => x <= GAMING_BOUND_SHARE);
  return { ratio, worstSeedRatio, healthTargetMet: ratio >= HEALTH_TARGET_RATIO, gainShare, gamingOk };
}

/** Launch gates for an arm (`on`) against its paired all-levers-off arm (`off`). */
export function launchGates(on: Metrics[], off: Metrics[]) {
  const g = gates(on);
  const primary = attributable(on, off);
  return {
    primaryFairness: { ...primary, pass: primary.ok },
    gaming: { gainShare: g.gainShare, pass: g.gamingOk },
    healthTarget: { ratio: g.ratio, worstSeedRatio: g.worstSeedRatio, met: g.healthTargetMet, blocking: false as const,
      participationBottom: mean(on.map(m => m.partBottom)), participationTop: mean(on.map(m => m.partTop)) },
    pass: primary.ok && g.gamingOk,
  };
}

function report(arm: { name: string; per: Metrics[] }) {
  const p = arm.per;
  const g = gates(p);
  const lines: string[] = [];
  lines.push(`\n## ${arm.name} (${p.length} seeds, ${DAYS} days)`);
  lines.push(`NC Gini (adults): ${ms(p.map(m => m.gini))}; honest only: ${ms(p.map(m => m.giniHonest))}`);
  lines.push(`Effort tiers (honest adults, end of run, mean count per seed): ${[0, 1, 2, 3].map(t => `T${t} ${f(mean(p.map(m => m.tiers[t]!)), 1)}`).join(", ")}`);
  lines.push(`V14 by NC decile (NC at day ${Math.floor(DAYS / 2)}, V14 over the second half): ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => f(mean(p.map(m => m.deciles[i]!)))).join(" ")}`);
  lines.push(`V14 bottom/top ratio: ${ms(p.map(m => m.v14Ratio))} (worst seed ${f(g.worstSeedRatio)}); V14 all eligible ${ms(p.map(m => m.v14All))}  health target >= ${HEALTH_TARGET_RATIO} (tracked, non-blocking): ${g.healthTargetMet ? "met" : "not met"}`);
  lines.push(`Participation (acts per week: yeses, sessions organized, help asked/given; days ${Math.floor(DAYS / 2)}-${DAYS - 1}) by NC decile: ${p[0]!.partDeciles.map((_, i) => f(mean(p.map(m => m.partDeciles[i]!)))).join(" ")}`);
  lines.push(`Honest regular NC at day ${DAYS}: ${ms(p.map(m => m.regularNC), 1)}`);
  for (const s of Object.keys(p[0]!.gaming)) {
    const x = p.map(m => m.gaming[s]!);
    const ttd = x.map(y => y.ttdDays).filter((y): y is number => y !== null);
    lines.push(`  ${s}: n ${x[0]!.n}, net gaming gain ${ms(x.map(y => y.netGain), 1)} NC = ${f(mean(x.map(y => y.netGainShare)) * 100, 0)}% of a regular's NC; total NC ${ms(x.map(y => y.ncTotal), 1)}; detected ${f(mean(x.map(y => y.detected)) * 100, 0)}%; median time to detection ${ttd.length ? f(median(ttd), 1) : "n/a"} d`);
  }
  lines.push(`Gaming GATE (each strategy's mean net gain <= ${GAMING_BOUND_SHARE * 100}% of a regular's NC): ${g.gamingOk ? "PASS" : "FAIL"}`);
  lines.push(`Flags raised/seed ${ms(p.map(m => m.flagsRaised), 1)}; honest members ever flagged ${f(mean(p.map(m => m.honestFlaggedShare)) * 100, 1)}% (honest weekly friends ${f(mean(p.map(m => m.friendsFlaggedShare)) * 100, 1)}%); honest wrongly confirmed (members, total over seeds) ${p.reduce((s, m) => s + m.falseConfirmed, 0)}`);
  const fl = p.map(m => m.flaky);
  lines.push(`Flaky (legit): NC ${ms(fl.map(x => x.nc), 1)} vs regular ${ms(fl.map(x => x.regularNC), 1)}; any penalty ${f(mean(fl.map(x => x.penalizedShare)) * 100, 0)}%; mean penalty ${ms(fl.map(x => x.meanPenalty), 2)}; penalty > 3 NC ${f(mean(fl.map(x => x.netPenaltyGt3Share)) * 100, 0)}%; effort tier below the regular median ${f(mean(fl.map(x => x.tierBelowRegularShare)) * 100, 0)}%`);
  const types = [...new Set(p.flatMap(m => Object.keys(m.vouch.byType)))].sort();
  lines.push(`Vouch quality (all invites): ${ms(p.map(m => m.vouch.qualityAll))}; invites/seed ${ms(p.map(m => m.vouch.invites), 1)}; bad invitees admitted/seed ${ms(p.map(m => m.vouch.badAdmitted), 1)}`);
  lines.push(`  by voucher type: ${types.map(t => `${t} ${f(mean(p.map(m => m.vouch.byType[t]?.quality ?? NaN).filter(Number.isFinite)))} (${f(mean(p.map(m => m.vouch.byType[t]?.invites ?? 0)), 1)} inv)`).join("; ")}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------ helpers

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = (xs: number[]) => { if (xs.length < 2) return NaN; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : NaN; };
function giniOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), n = s.length, tot = s.reduce((a, b) => a + b, 0);
  if (!n || tot === 0) return 0;
  return s.reduce((acc, x, i) => acc + (2 * (i + 1) - n - 1) * x, 0) / (n * tot);
}
function mulberry(seed: number) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------------------------------------ main

/** Paired (same seeds) effect of the effort lever on the bottom/top V14 ratio: on - off. */
export function attributable(on: Metrics[], off: Metrics[]) {
  const d = on.map((m, i) => m.v14Ratio - off[i]!.v14Ratio);
  const top = on.map((m, i) => m.v14Top - off[i]!.v14Top), bottom = on.map((m, i) => m.v14Bottom - off[i]!.v14Bottom);
  return { diff: mean(d), se: se(d), topGain: mean(top), bottomGain: mean(bottom), ok: mean(d) >= -FAIRNESS_MAX_DROP };
}

if (import.meta.main) {
  if (args.includes("--effort-sweep")) effortSweep();
  else if (args.includes("--sweep")) antiGamingSweep();
  else await main();
}

async function main() {
  const arms: { key: string; name: string; o: Omit<SimOptions, "seed"> }[] = [
    { key: "A", name: "A default (all levers, detection on)", o: {} },
    { key: "Z", name: "Z all NC levers off (paired comparator for the primary fairness gate)", o: { effortLever: false, vouchLever: false, reachLever: false } },
    { key: "B", name: "B effort lever off (counterfactual: everyone at the floor)", o: { effortLever: false } },
    { key: "C", name: "C effort effect x2.5 (sensitivity: effortGain 1.0)", o: { effortGain: 1.0 } },
    { key: "C0", name: "C0 all NC levers off, effortGain 1.0 (pair for C)", o: { effortLever: false, vouchLever: false, reachLever: false, effortGain: 1.0 } },
    { key: "D", name: "D detection off (anti-gaming = decay + cap only)", o: { detection: false } },
    { key: "E", name: "E no anti-gaming decay or cap (detection on)", o: { cfg: { antiGaming: { pairDecay: 1, periodCap: 1e9, categorySoftN: { vouch: 1e9, attendance: 1e9, help: 1e9, organizing: 1e9, needs_answered: 1e9, review: 1e9 } } } } },
    { key: "F", name: "F vouch-capacity lever off (fixed 3 invites / 30 days)", o: { vouchLever: false } },
  ];
  const results: Record<string, unknown> = {};
  const per: Record<string, Metrics[]> = {};
  for (const a of arms) {
    const r = runArm(a.name, a.o);
    per[a.key] = r.per;
    console.log(report(r));
    results[a.name] = { gates: gates(r.per), per: r.per };
  }
  for (const [on, off, what] of [["A", "Z", "all NC levers"], ["A", "B", "effort lever only"], ["C", "C0", "all NC levers, effect x2.5"]] as const) {
    const a = attributable(per[on]!, per[off]!);
    console.log(`\nChange in bottom/top V14 ratio, ${on} vs ${off} (${what}, paired seeds): ${f(a.diff, 3)} ± ${f(a.se, 3)}; top decile V14 ${f(a.topGain, 3)}, bottom ${f(a.bottomGain, 3)}`);
    results[`attributable ${on}-${off}`] = a;
  }
  // Gate arms at GATE_SEEDS (paired, common random numbers).
  const gs = Math.max(GATE_SEEDS, SEEDS);
  const gA = gs === SEEDS ? per.A! : runArm("A", {}, gs).per;
  const gZ = gs === SEEDS ? per.Z! : runArm("Z", { effortLever: false, vouchLever: false, reachLever: false }, gs).per;
  const gC = gs === SEEDS ? per.C! : runArm("C", { effortGain: 1.0 }, gs).per;
  const gC0 = gs === SEEDS ? per.C0! : runArm("C0", { effortLever: false, vouchLever: false, reachLever: false, effortGain: 1.0 }, gs).per;
  const lg = launchGates(gA, gZ), lgC = launchGates(gC, gC0);
  const comp = Object.fromEntries((["effortLever", "reachLever", "vouchLever"] as const).map(k => [k, attributable(gA, runArm("", { [k]: false }, gs).per)]));
  const h = lg.healthTarget;
  const ci = (a: { diff: number; se: number }) => `${f(a.diff, 3)} (95% CI ${f(a.diff - 1.96 * a.se, 3)} to ${f(a.diff + 1.96 * a.se, 3)})`;
  console.log(`\n## LAUNCH GATES (default config, arm A vs all levers off Z, ${gs} paired seeds, ${DAYS} days)`);
  console.log(`(a) PRIMARY fairness: NC levers lower the bottom/top V14 ratio by <= ${FAIRNESS_MAX_DROP}: change ${ci(lg.primaryFairness)} -> ${lg.primaryFairness.pass ? "PASS" : "FAIL"}`);
  console.log(`    by lever (A minus A with that lever off): ${Object.entries(comp).map(([k, a]) => `${k} ${f(a.diff, 3)} ± ${f(a.se, 3)}`).join(", ")}`);
  console.log(`    sensitivity, effect x2.5 (C vs C0): ${ci(lgC.primaryFairness)} -> ${lgC.primaryFairness.pass ? "pass" : "fail"} (not a gate)`);
  console.log(`    V14 all eligible: levers on ${f(mean(gA.map(m => m.v14All)), 3)} vs off ${f(mean(gZ.map(m => m.v14All)), 3)}; bottom decile ${f(lg.primaryFairness.bottomGain, 3)}, top decile ${f(lg.primaryFairness.topGain, 3)}`);
  console.log(`Gaming: each strategy's mean net gain <= ${GAMING_BOUND_SHARE * 100}% of a regular's NC: ${Object.entries(lg.gaming.gainShare).map(([k, v]) => `${k} ${f(v * 100, 0)}%`).join(", ")} -> ${lg.gaming.pass ? "PASS" : "FAIL"}`);
  console.log(`(b) TRACKED, non-blocking health target: absolute ratio >= ${HEALTH_TARGET_RATIO}: ${f(h.ratio)} (worst seed ${f(h.worstSeedRatio)}; levers off ${f(gates(gZ).ratio)}) -> ${h.met ? "met" : "not met"}. Participation gap: bottom NC decile ${f(h.participationBottom)} vs top ${f(h.participationTop)} acts per week (${f(h.participationBottom / h.participationTop * 100, 0)}%). Addressed by plans and asks, not NC.`);
  console.log(`Blocking gates overall: ${lg.pass ? "PASS" : "FAIL"}`);
  results.launchGates = { seeds: gs, ...lg, byLever: comp };
  results.launchGatesSensitivity = lgC;
  const ji = args.indexOf("--json");
  if (ji >= 0) await Bun.write(args[ji + 1]!, JSON.stringify(results, null, 1));
}

function effortSweep() {
  const gs = Math.max(GATE_SEEDS, SEEDS);
  console.log(`Paired against all NC levers off, ${gs} seeds. Reach above the base reserved for low exposure (default) unless noted.`);
  console.log("| thresholds | effortGain | reach extra to low exposure | honest T0/T1/T2/T3 (day 90) | V14 ratio on | all levers: on - off | effort lever only |");
  console.log("|---|---|---|---|---|---|---|");
  const off: Record<string, Metrics[]> = {};
  for (const th of [[10, 30, 80], [15, 45, 120], [20, 60, 150]] as [number, number, number][]) for (const g of [0.4, 1.0]) for (const low of [true, false]) {
    if (!low && g !== 0.4) continue;
    off[g] ??= runArm("", { effortLever: false, vouchLever: false, reachLever: false, effortGain: g }, gs).per;
    const cfg: CapitalConfigInput = { levers: { effortThresholds: th } };
    const on = runArm("", { cfg, effortGain: g, reachExtraToLowExposure: low }, gs).per;
    const a = attributable(on, off[g]!);
    const e = attributable(on, runArm("", { cfg, effortGain: g, reachExtraToLowExposure: low, effortLever: false }, gs).per);
    const tiers = [0, 1, 2, 3].map(t => f(mean(on.map(m => m.tiers[t]!)), 0)).join("/");
    console.log(`| ${th.join(", ")} | ${g} | ${low ? "yes" : "no"} | ${tiers} | ${ms(on.map(m => m.v14Ratio))} | ${f(a.diff, 3)} ± ${f(a.se, 3)} | ${f(e.diff, 3)} ± ${f(e.se, 3)} |`);
  }
}

function antiGamingSweep() {
  console.log("| periodCap | pairDecay | regular NC | flaky NC | vouch ring gain, no detection | staged gain, no detection | help farm gain, no detection | with detection: worst strategy gain |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const cap of [25, 40, 60]) for (const pd of [0.35, 0.5, 0.7]) {
    const cfg: CapitalConfigInput = { antiGaming: { periodCap: cap, pairDecay: pd } };
    const nd = runArm("", { cfg, detection: false }).per, wd = runArm("", { cfg }).per;
    const g = (s: string) => `${f(mean(nd.map(m => m.gaming[s]!.netGain)), 1)} (${f(mean(nd.map(m => m.gaming[s]!.netGainShare)) * 100, 0)}%)`;
    const worst = Math.max(...Object.values(gates(wd).gainShare));
    console.log(`| ${cap} | ${pd} | ${f(mean(nd.map(m => m.regularNC)), 1)} | ${f(mean(nd.map(m => m.flaky.nc)), 1)} | ${g("adv_vouch_ring")} | ${g("adv_staged")} | ${g("adv_help_farm")} | ${f(worst * 100, 0)}% |`);
  }
}
