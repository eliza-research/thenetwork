#!/usr/bin/env bun
// PRIMED_MODEL sensitivity sweep for "consent-first beats push" (audit matching-e2e-4).
//   bun --conditions eliza-source packages/sim/experiments/primed-sweep.ts --param identity --values 0.6,0.8,0.95 --seeds 1,2,3 [--days 21] [--fit 0.55|off]
// --param is one of identity, identityFit, met, partial, or "all" (scales met, partial and identity
// together by each value). --fit sets PRIMED_MODEL.identityFit for every run (default 0.55: the
// probe-primed accept depends on partner fit; "off" is the flat model the oracle uses by default).
// Every PRIMED value runs on the same seeds, so the oracle's seeded draws (chemistry, decisions,
// show-ups) are common random numbers across values: a difference between two values is the
// effect of the value, not of a different world. The push arm does not use probes,
// so it is rerun only when met or partial change.
// Reports outcome metrics (meetings held, good meetings, unsafe proposals, opt-outs, interruptions)
// per seed and the paired difference consent - push; accept rates are shown but are not outcomes.
// HARNESS ONLY: imports the Network experiment (packages/network) and mutates the oracle's model.
import { parseArgs } from "node:util";
import { PRIMED_MODEL } from "../src/oracle.ts";
import { runArm, type ArmResult } from "../../network/harness/experiment.ts";

const { values: a } = parseArgs({ options: {
  param: { type: "string", default: "identity" }, values: { type: "string", default: "0.6,0.8,0.95" },
  seeds: { type: "string", default: "1,2,3" }, days: { type: "string", default: "21" }, fit: { type: "string", default: "0.55" },
} });
const param = a.param!;
if (!["identity", "identityFit", "met", "partial", "all"].includes(param)) throw new Error(`unknown --param ${param}`);
const values = a.values!.split(",").map(Number);
const seeds = a.seeds!.split(",").map(Number);
const days = Number(a.days);
const base = { ...PRIMED_MODEL, ...(a.fit === "off" ? {} : { identityFit: Number(a.fit) }) };
const original = { ...PRIMED_MODEL };

const outcome = (r: ArmResult) => ({
  meetingsHeld: r.meetingsHeld, goodMeetings: Math.round(r.enjoyedShare * r.meetingsHeld), unsafe: r.unsafe, optOuts: r.optOuts,
  proactivePerMemberWeek: r.proactivePerMemberWeek, inviteAcceptRate: r.inviteAcceptRate, proposalAllYesRate: r.proposalAllYesRate,
});
type Row = ReturnType<typeof outcome>;
const pushCache = new Map<string, Row>();
const rows: { value: number; seed: number; push: Row; consent: Row; diff: Record<string, number> }[] = [];
for (const value of values) {
  delete PRIMED_MODEL.identityFit;
  Object.assign(PRIMED_MODEL, base);
  if (param === "all") { PRIMED_MODEL.met = Math.min(1, base.met * value); PRIMED_MODEL.partial = Math.min(1, base.partial * value); PRIMED_MODEL.identity = Math.min(1, base.identity * value); }
  else PRIMED_MODEL[param as "identity" | "identityFit" | "met" | "partial"] = value;
  for (const seed of seeds) {
    const pk = `${seed}|${PRIMED_MODEL.met}|${PRIMED_MODEL.partial}`;
    if (!pushCache.has(pk)) pushCache.set(pk, outcome(await runArm("push_baseline", { days, seed })));
    const push = pushCache.get(pk)!;
    const consent = outcome(await runArm("consent", { days, seed }));
    const diff = Object.fromEntries(Object.keys(consent).map(k => [k, Math.round(((consent as any)[k] - (push as any)[k]) * 1000) / 1000]));
    rows.push({ value, seed, push, consent, diff });
    process.stderr.write(`${param}=${value} seed=${seed}: consent-push meetings ${diff.meetingsHeld}, good ${diff.goodMeetings}, unsafe ${diff.unsafe}\n`);
  }
}
delete PRIMED_MODEL.identityFit;
Object.assign(PRIMED_MODEL, original);

const keys = ["meetingsHeld", "goodMeetings", "unsafe", "optOuts", "proactivePerMemberWeek"] as const;
const summary = values.map(value => {
  const rs = rows.filter(r => r.value === value);
  return { value, ...Object.fromEntries(keys.map(k => {
    const d = rs.map(r => r.diff[k]!);
    return [k, { mean: Math.round((d.reduce((s, x) => s + x, 0) / d.length) * 1000) / 1000, min: Math.min(...d), max: Math.max(...d) }];
  })) };
});
console.log(JSON.stringify({ param, values, seeds, days, base, rows, pairedDiffConsentMinusPush: summary }, null, 2));
process.exit(0);
