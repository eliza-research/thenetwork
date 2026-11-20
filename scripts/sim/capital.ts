// The capital block (nightly, or `pnpm run sim --with-capital`): the network-capital simulation
// (packages/capital/experiments/run.ts) and its launch gates. The primary fairness gate needs at least
// 32 paired seeds (capital-13), so this block is slow; it is not part of the default run.
//   blocking: (a) NC levers lower the bottom/top-decile V14 ratio by <= 0.02 (95% CI lower bound, paired
//             against every NC lever off); gaming: each strategy's mean net gain <= 25% of a regular's NC.
//   tracked:  (b) the absolute bottom/top ratio >= 0.80 (a network-health target).
//   The vouch-period and vouch-config gates (vouchPeriodGate, capitalConfigGate) run in the default
//   network block, not here.
import { CapitalLedger, resolveCapital, vouchCapacity, type CapitalConfigInput } from "../../packages/capital/src/index.ts";
import { GATE_MIN_SEEDS, launchGates, runArm } from "../../packages/capital/experiments/run.ts";
import { DAY } from "../../packages/core/src/clock.ts";
import { Block, expect } from "./gate.ts";

// A vouch window of zero days is not "no window": the check is half-open, so every entry falls
// outside it and the lever goes inert with no error. The same window is positive in every other
// lever and in antiGaming and detection, so resolveCapital must refuse zero here too.
export async function capitalConfigGate(b: Block): Promise<void> {
  await b.run("levers: a vouch period must be positive, so the lever cannot go inert", () => {
    expect(resolveCapital().levers.vouch.periodDays).toBe(30);
    const problem = (input: CapitalConfigInput): string => {
      try { resolveCapital(input); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
    };
    expect(problem({ levers: { vouch: { periodDays: 0 } } })).toMatch("levers.vouch.periodDays must be > 0");
    expect(problem({ levers: { vouch: { periodDays: -1 } } })).toMatch("levers.vouch.periodDays must be > 0");
    // Why zero must be refused: one good vouch raises capacity by perGood inside the window and
    // raises nothing when the window is empty, so the lever would silently stop working.
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    for (const [i, who] of ["v", "x"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    L.record({ id: "join-i", t: at(1), type: "member_joined", member: "i", age: 30, vouchedBy: "v" });
    L.record({ id: "act-i", t: at(2), type: "member_activated", member: "i" });
    L.record({ id: "value-i", t: at(3), type: "value_received", member: "i", with: ["x"], confirmedBy: ["x"] });
    const entries = L.internalEntries("v");
    const inert = structuredClone(resolveCapital());
    inert.levers.vouch.periodDays = 0;
    expect(vouchCapacity(entries, at(20))).toBe(3); // base 2, plus the good vouch 1
    expect(vouchCapacity(entries, at(20), inert)).toBe(2); // an empty window: the vouch no longer counts
  });
}

// The vouch-period check is cheap and deterministic, so the default network block runs it
// (scripts/sim/network.ts); ConsentNetwork reads `capital.vouchCapacity` at invite time.
// spec/capitalLevers.md, "Vouch capacity counts only the vouches and stakes of its rolling period"
// Upstream PR #475: before the fix, one lost stake removed the voucher's invites for good.
export async function vouchPeriodGate(b: Block): Promise<void> {
  await b.run("levers: vouch capacity counts only the vouches and stakes in its rolling period", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    // The value providers must be eligible adults, or the invitee's value does not count.
    for (const [i, who] of ["v", "x", "w", "y"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    // Invitee i gets one value, then is removed for serious abuse: the voucher v loses the stake on day 10.
    L.record({ id: "join-i", t: at(1), type: "member_joined", member: "i", age: 30, vouchedBy: "v" });
    L.record({ id: "act-i", t: at(2), type: "member_activated", member: "i" });
    L.record({ id: "value-i", t: at(3), type: "value_received", member: "i", with: ["x"], confirmedBy: ["x"] });
    L.record({ id: "remove-i", t: at(10), type: "member_removed", member: "i", reason: "serious_abuse" });
    // Invitee i2 gets one value and stays: one good vouch for v2 on day 13.
    L.record({ id: "join-v2", t: at(10, 1), type: "member_joined", member: "v2", age: 30 });
    L.record({ id: "join-i2", t: at(10, 2), type: "member_joined", member: "i2", age: 30, vouchedBy: "v2" });
    L.record({ id: "act-i2", t: at(12), type: "member_activated", member: "i2" });
    L.record({ id: "value-i2", t: at(13), type: "value_received", member: "i2", with: ["y"], confirmedBy: ["y"] });
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("v", 20)).toBe(0); // inside the period: base 2, minus the stake 2
    expect(capacity("v", 40)).toBe(2); // the period is over: the stake no longer counts
    expect(capacity("v", 400)).toBe(2);
    expect(capacity("v2", 20)).toBe(3); // inside the period: base 2, plus the good vouch 1
    expect(capacity("v2", 45)).toBe(2); // the period is over: the vouch no longer counts
  });
}

export async function capitalBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const seeds = o.quick ? 4 : GATE_MIN_SEEDS;
  const on = runArm("A", {}, seeds).per;
  const off = runArm("Z", { effortLever: false, vouchLever: false, reachLever: false }, seeds).per;
  const lg = launchGates(on, off);
  const f = (x: number) => x.toFixed(3);
  b.gate(`fairness: NC levers lower the bottom/top V14 ratio by <= 0.02 (CI lower bound, ${seeds} paired seeds)`, lg.primaryFairness.pass, `change ${f(lg.primaryFairness.diff)}, lower ${f(lg.primaryFairness.lower)}`, !o.quick);
  b.gate("gaming: each strategy's mean net gain <= 25% of a regular's NC", lg.gaming.pass, Object.entries(lg.gaming.gainShare).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", "));
  b.track("health target: bottom/top V14 ratio >= 0.80", lg.healthTarget.met, f(lg.healthTarget.ratio));
}
