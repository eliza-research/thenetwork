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


// The overturned-removal check is cheap and deterministic, so the default network block runs it
// (scripts/sim/network.ts) alongside the vouch-period check.
// spec/capitalLedger.md, "A removal overturned on review returns the voucher's lost stake"
export async function vouchReversedStakeGate(b: Block): Promise<void> {
  await b.run("levers: a reversed lost stake restores vouch capacity", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    for (const [i, who] of ["v", "x"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    // Invitee i gets one value, then is removed for serious abuse: the voucher v loses the stake on day 10.
    L.record({ id: "join-i", t: at(1), type: "member_joined", member: "i", age: 30, vouchedBy: "v" });
    L.record({ id: "act-i", t: at(2), type: "member_activated", member: "i" });
    L.record({ id: "value-i", t: at(3), type: "value_received", member: "i", with: ["x"], confirmedBy: ["x"] });
    // No stake exists yet, so an overturn before the removal writes nothing.
    expect(L.record({ id: "overturn-early", t: at(5), type: "removal_overturned", member: "i" })).toEqual([]);
    L.record({ id: "remove-i", t: at(10), type: "member_removed", member: "i", reason: "serious_abuse" });
    const stake = L.all().find((e) => e.category === "vouch_stake" && e.provenance.counterparts.includes("i"));
    expect(stake?.category).toBe("vouch_stake");
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("v", 15)).toBe(0); // inside the period: base 2, minus the stake 2
    const written = L.record({ id: "overturn-i", t: at(20), type: "removal_overturned", member: "i" });
    expect(written.length).toBe(1);
    expect(written[0]?.category).toBe("clawback");
    expect(written[0]?.member).toBe("v");
    expect(written[0]?.sign).toBe(-1);
    expect(written[0]?.amount).toBe(-(stake?.amount ?? 0));
    expect(written[0]?.provenance.eventId).toBe("overturn-i");
    expect(written[0]?.provenance.eventType).toBe("removal_overturned");
    expect(written[0]?.provenance.reverses).toBe(stake?.id);
    expect(L.isReversed(stake?.id ?? "")).toBe(true);
    expect(capacity("v", 15)).toBe(0); // a later reversal does not count before its time
    expect(capacity("v", 20)).toBe(2); // the stake is returned
    // A second overturn of the same removal writes nothing: the stake is already reversed.
    expect(L.record({ id: "overturn-again", t: at(21), type: "removal_overturned", member: "i" })).toEqual([]);
    expect(capacity("v", 21)).toBe(2);
  });
  await b.run("levers: only the named lost stake is reversed", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    for (const [i, who] of ["v", "x"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    L.record({ id: "join-i", t: at(1), type: "member_joined", member: "i", age: 30, vouchedBy: "v" });
    L.record({ id: "act-i", t: at(2), type: "member_activated", member: "i" });
    L.record({ id: "value-i", t: at(3), type: "value_received", member: "i", with: ["x"], confirmedBy: ["x"] });
    L.record({ id: "remove-i", t: at(10), type: "member_removed", member: "i", reason: "serious_abuse" });
    L.record({ id: "join-j", t: at(11), type: "member_joined", member: "j", age: 30, vouchedBy: "v" });
    L.record({ id: "act-j", t: at(12), type: "member_activated", member: "j" });
    L.record({ id: "value-j", t: at(13), type: "value_received", member: "j", with: ["x"], confirmedBy: ["x"] });
    L.record({ id: "remove-j", t: at(14), type: "member_removed", member: "j", reason: "serious_abuse" });
    const first = L.all().find((e) => e.category === "vouch_stake" && e.provenance.counterparts.includes("i"));
    const second = L.all().find((e) => e.category === "vouch_stake" && e.provenance.counterparts.includes("j"));
    expect(first?.category).toBe("vouch_stake");
    expect(second?.category).toBe("vouch_stake");
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("v", 15)).toBe(0); // two lost stakes: base 2, minus 2 each
    L.record({ id: "overturn-i", t: at(20), type: "removal_overturned", member: "i" });
    expect(L.isReversed(first?.id ?? "")).toBe(true);
    expect(L.isReversed(second?.id ?? "")).toBe(false);
    expect(capacity("v", 20)).toBe(0); // one lost stake remains
    L.record({ id: "overturn-j", t: at(26), type: "removal_overturned", member: "j" });
    expect(L.isReversed(second?.id ?? "")).toBe(true);
    expect(capacity("v", 26)).toBe(2); // both stakes are returned
  });
  await b.run("levers: a stake out of its period is not reversed", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    for (const [i, who] of ["w", "x"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    L.record({ id: "join-k", t: at(1), type: "member_joined", member: "k", age: 30, vouchedBy: "w" });
    L.record({ id: "act-k", t: at(2), type: "member_activated", member: "k" });
    L.record({ id: "value-k", t: at(3), type: "value_received", member: "k", with: ["x"], confirmedBy: ["x"] });
    L.record({ id: "remove-k", t: at(10), type: "member_removed", member: "k", reason: "serious_abuse" });
    const stake = L.all().find((e) => e.category === "vouch_stake" && e.provenance.counterparts.includes("k"));
    expect(stake?.category).toBe("vouch_stake");
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("w", 20)).toBe(0); // inside the period: base 2, minus the stake 2
    expect(capacity("w", 40)).toBe(2); // the period is over: the stake no longer counts
    // The stake is already out of its period, so there is nothing to return.
    expect(L.record({ id: "overturn-k", t: at(41), type: "removal_overturned", member: "k" })).toEqual([]);
    expect(L.isReversed(stake?.id ?? "")).toBe(false);
    expect(capacity("w", 41)).toBe(2);
  });
  await b.run("levers: an overturn with no lost stake writes nothing", () => {
    const T0 = Date.UTC(2026, 0, 1);
    const at = (d: number, n = 0) => T0 + d * DAY + n;
    const L = new CapitalLedger();
    for (const [i, who] of ["u", "y"].entries()) L.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    L.record({ id: "join-n", t: at(1), type: "member_joined", member: "n", age: 30, vouchedBy: "u" });
    L.record({ id: "act-n", t: at(2), type: "member_activated", member: "n" });
    L.record({ id: "value-n", t: at(3), type: "value_received", member: "n", with: ["y"], confirmedBy: ["y"] });
    // A removal that is not for serious abuse takes no stake.
    L.record({ id: "remove-n", t: at(10), type: "member_removed", member: "n", reason: "left" });
    expect(L.record({ id: "overturn-n", t: at(15), type: "removal_overturned", member: "n" })).toEqual([]);
    expect(L.record({ id: "overturn-ghost", t: at(16), type: "removal_overturned", member: "ghost" })).toEqual([]);
    expect(L.all().filter((e) => e.category === "clawback").length).toBe(0);
    const capacity = (m: string, d: number) => vouchCapacity(L.internalEntries(m), at(d));
    expect(capacity("u", 20)).toBe(3); // the vouch credit was never reversed: base 2, plus the good vouch 1
    const L2 = new CapitalLedger();
    for (const [i, who] of ["v3", "x"].entries()) L2.record({ id: `join-${who}`, t: at(0, i), type: "member_joined", member: who, age: 30 });
    L2.record({ id: "join-p", t: at(1), type: "member_joined", member: "p", age: 30, vouchedBy: "v3" });
    L2.record({ id: "act-p", t: at(2), type: "member_activated", member: "p" });
    L2.record({ id: "value-p", t: at(3), type: "value_received", member: "p", with: ["x"], confirmedBy: ["x"] });
    // The voucher is a minor at removal time, so no stake is taken.
    L2.record({ id: "age-16", t: at(9), type: "age_updated", member: "v3", age: 16 });
    L2.record({ id: "remove-p", t: at(10), type: "member_removed", member: "p", reason: "serious_abuse" });
    L2.record({ id: "age-30", t: at(11), type: "age_updated", member: "v3", age: 30 });
    expect(L2.all().filter((e) => e.category === "vouch_stake").length).toBe(0);
    expect(L2.record({ id: "overturn-p", t: at(12), type: "removal_overturned", member: "p" })).toEqual([]);
    const capacity2 = (m: string, d: number) => vouchCapacity(L2.internalEntries(m), at(d));
    expect(capacity2("v3", 20)).toBe(3);
  });
}
