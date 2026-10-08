// Run friends.help arms over seeds and print the comparison table (docs/results/2026-10-08-friends-pack.md).
// No LLM calls.
//   bun run packages/sim/src/apps/friends/cli.ts --seeds 1-4 --n 400 --weeks 8 [--only pack,random,greedy,oracle] [--json out.json]
import { friendsArms } from "./arms.ts";
import { historicalGates, officialGates, printGates, trackedMetrics } from "./gates.ts";
import { friendsMetrics, type FriendsMetrics } from "./metrics.ts";
import { runFriendsWorld } from "./world.ts";

async function main() {
  const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
  const parseSeeds = (s: string) => s.split(",").flatMap(r => { const [a, b] = r.split("-").map(Number); return Array.from({ length: (b ?? a!) - a! + 1 }, (_, i) => a! + i); });
  const seeds = parseSeeds(arg("seeds", "1-4")!);
  const n = Number(arg("n", "400")), weeks = Number(arg("weeks", "8")), planCap = Number(arg("plan-cap", "1"));

  const packOverride = arg("pack");
  const ARMS = friendsArms(packOverride ? JSON.parse(packOverride) : {});
  const only = (arg("only", "pack,random,greedy,oracle")!).split(",");

  const all: Record<string, FriendsMetrics[]> = {};
  for (const name of only) {
    all[name] = [];
    for (const seed of seeds) {
      const t = performance.now();
      const m = friendsMetrics(runFriendsWorld({ seed, n, weeks, planCap, matcher: ARMS[name]! }));
      all[name]!.push(m);
      console.error(`${name} seed ${seed}: meetups ${m.meetups}, repeat ${(m.repeatRate * 100).toFixed(0)}%, V14 ${(m.v14 * 100).toFixed(0)}%, track ${(m.friendshipTrackShare * 100).toFixed(1)}%, travel ${m.travel.medianGroupMax.toFixed(0)}m, boroughMin ${m.boroughRatioMin.toFixed(2)}, adv ${m.safety.adversaryContacts}/${m.safety.knownAdversaryContacts}, minor ${m.safety.declaredMinorContacts}/${m.safety.hiddenMinorContacts} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const se = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length); };
  const fmt = (xs: number[], pct = false, d = 2) => (pct ? `${(mean(xs) * 100).toFixed(1)}% ± ${(se(xs) * 100).toFixed(1)}` : `${mean(xs).toFixed(d)} ± ${se(xs).toFixed(d)}`);
  const rows: [string, (m: FriendsMetrics) => number, boolean, number?][] = [
    ["Proposals / seed", m => m.proposals, false, 0],
    ["Probes / seed", m => m.probes, false, 0],
    ["Probe yes rate", m => m.probeYesRate, true],
    ["Quorum rate (booked / probed)", m => m.quorumRate, true],
    ["Meetups held / seed", m => m.meetups, false, 1],
    ["  of which crew sessions", m => m.crewSessions, false, 1],
    ["Attendance (came / booked)", m => m.attendance, true],
    ["Mean group size", m => m.meanGroupSize, false, 2],
    ["Good meetups (least misery >= 0.45)", m => m.goodRate, true],
    ["Mean enjoyment (real attendees)", m => m.meanEnjoy, false, 3],
    ["**Repeat-meetup rate (>= 2 again within 30 d)**", m => m.repeatRate, true],
    ["Repeat, same group (>= 3 again)", m => m.repeatGroupRate, true],
    ["Repeat, counting crew handoffs", m => m.repeatRateWithHandoff, true],
    ["Crews formed / seed", m => m.crewsFormed, false, 1],
    ["Crews handed off / seed", m => m.crewsHandedOff, false, 1],
    ["Hours with members, per real member", m => m.hoursPerMember, false, 1],
    ["Hours with top person, per real member", m => m.topPairHours, false, 1],
    ["**Members with a friendship forming (pair met 3+ times, mutual see-again)**", m => m.friendshipTrackShare, true],
    ["Members on Hall pace (>= 12 h, on pace for 50 h by month 6)", m => m.hallPaceShare, true],
    ["Members with a pair past 50 h (casual friend)", m => m.casualFriendShare, true],
    ["Pairs past 50 h / seed", m => m.casualFriendPairs, false, 1],
    ["Pairs past 90 h / seed", m => m.friendPairs, false, 1],
    ["Members with a meetup", m => m.timeToFirstMeetup.shareWithMeetup, true],
    ["Median days to first meetup", m => m.timeToFirstMeetup.medianDays ?? NaN, false, 1],
    ["**V14**", m => m.v14, true],
    ["V14, Network-arranged only", m => m.v14Arranged, true],
    ["**Borough fairness: min V14 ratio (boroughs with >= 10 real members)**", m => m.boroughRatioMin, false, 2],
    ["Borough fairness, boroughs with >= 30 real members", m => m.boroughRatioMin30, false, 2],
    ["**Median group max travel (min)**", m => m.travel.medianGroupMax, false, 1],
    ["Mean seat travel (min)", m => m.travel.meanSeat, false, 1],
    ["Seats over the member's tolerance", m => m.travel.overTolerance, true],
    ["Gini of meetups (real members)", m => m.giniMeetups, false, 3],
    ["Real members with no meetup", m => m.zeroMeetupShare, true],
    ["**Declared-minor contacts (must be 0)**", m => m.safety.declaredMinorContacts, false, 1],
    ["Hidden-minor contacts (age liars)", m => m.safety.hiddenMinorContacts, false, 1],
    ["**Known-adversary contacts (must be 0)**", m => m.safety.knownAdversaryContacts, false, 1],
    ["Adversary contacts (all, member-pairs)", m => m.safety.adversaryContacts, false, 1],
    ["Adversaries who reached anyone", m => m.safety.adversariesReached, false, 1],
    ["Harm events from undetected adversaries / seed", m => m.safety.harmsUndetected, false, 1],
    ["Harm events / seed", m => Object.values(m.safety.harms).reduce((a, b) => a + (b ?? 0), 0), false, 1],
  ];
  console.log(`| Metric (mean ± SE, seeds ${seeds.join(",")}; ${n} personas; ${weeks} weeks${planCap !== 1 ? `; plan allowance ${planCap}/wk` : ""}) | ${only.join(" | ")} |`);
  console.log(`|---|${only.map(() => "---:").join("|")}|`);
  for (const [label, f, pct, d] of rows) console.log(`| ${label} | ${only.map(k => fmt(all[k]!.map(f), pct, d)).join(" | ")} |`);
  console.log("\nV14 by borough (n averaged):");
  for (const k of only) console.log(`  ${k}: ` + Object.keys(all[k]![0]!.v14ByBorough).map(b => `${b} (n≈${Math.round(mean(all[k]!.map(m => m.v14ByBorough[b]!.n)))}) ${(mean(all[k]!.map(m => m.v14ByBorough[b]!.v14).filter(Number.isFinite)) * 100).toFixed(1)}%`).join("; "));
  console.log("\nAdversary contacts by kind:");
  for (const k of only) console.log(`  ${k}: ` + ["romance_seeker", "mlm", "bot", "harasser"].map(a => `${a} ${mean(all[k]!.map(m => m.safety.adversaryContactsByKind[a] ?? 0)).toFixed(1)}`).join("; "));
  if (all.pack && all.random) {
    if (all.oracle) {
      const og = officialGates(all.pack, all.random, all.oracle);
      console.log("\n" + printGates("OFFICIAL gates (adopted 2026-10-08), friendsPack vs random-within-area and oracle on the same seeds:", og));
      if (og.some(g => !g.pass)) process.exitCode = 1;
    }
    console.log("\n" + printGates("TRACKED metrics (non-blocking):", trackedMetrics(all.pack, all.random), true));
    console.log("\n" + printGates("HISTORICAL gates (first proposed; not the launch criteria):", historicalGates(all.pack, all.random)));
  }
  const out = arg("json");
  if (out) await Bun.write(out, JSON.stringify(all, null, 1));
}

if (import.meta.main) await main();
