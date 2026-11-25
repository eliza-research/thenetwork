// The capital block (nightly, or `pnpm run sim --with-capital`): the network-capital simulation
// (packages/capital/experiments/run.ts) and its launch gates. The primary fairness gate needs at least
// 32 paired seeds (capital-13), so this block is slow; it is not part of the default run.
//   blocking: (a) NC levers lower the bottom/top-decile V14 ratio by <= 0.02 (95% CI lower bound, paired
//             against every NC lever off); gaming: each strategy's mean net gain <= 25% of a regular's NC.
//   tracked:  (b) the absolute bottom/top ratio >= 0.80 (a network-health target).
//   The vouch-period gate (vouchPeriodGate) runs in the default network block, not here.
import { CapitalLedger, vouchCapacity } from "../../packages/capital/src/index.ts";
import { GATE_MIN_SEEDS, launchGates, runArm } from "../../packages/capital/experiments/run.ts";
import { DAY } from "../../packages/core/src/clock.ts";
import { Block, expect } from "./gate.ts";

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

export async function vouchStakeEligibilityGate(b: Block): Promise<void> {
  await b.run("ledger: a removal while the voucher is ineligible does not spend the stake", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    // The value providers must be eligible adults, or the invitee's value does not count.
    for (const [i, who] of ["v", "x"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    // Invitee i gets one value: one good vouch for v on day 3.
    L.record({ id: "join-i", t: at(1), type: "member_joined", member: "i", age: 30, vouchedBy: "v" });
    L.record({ id: "act-i", t: at(2), type: "member_activated", member: "i" });
    L.record({ id: "value-i", t: at(3), type: "value_received", member: "i", with: ["x"], confirmedBy: ["x"] });
    // The voucher is found to be a minor, so the removal on day 10 writes nothing for v.
    L.record({ id: "age-v-minor", t: at(9), type: "age_updated", member: "v", age: 16 });
    L.record({ id: "remove-i-1", t: at(10), type: "member_removed", member: "i", reason: "serious_abuse" });
    expect(L.all().filter(e => e.t === at(10) && e.member === "v")).toEqual([]);
    // The voucher is an adult again, so the second removal on day 12 takes the stake.
    L.record({ id: "age-v-adult", t: at(11), type: "age_updated", member: "v", age: 30 });
    L.record({ id: "remove-i-2", t: at(12), type: "member_removed", member: "i", reason: "serious_abuse" });
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("v", 20)).toBe(0); // inside the period: base 2, minus the stake 2
    expect(capacity("v", 45)).toBe(2); // the period is over: the stake no longer counts
  });
}
