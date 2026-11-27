import { parseArgs } from "node:util";
import { Rng, hash32 } from "@thenetwork/core";
import { randomMatcher as slopRandomMatcher } from "../apps/slop/baselines.ts";
import { slopEngineMatcher } from "../apps/slop/enginePack.ts";
import { slopMetrics } from "../apps/slop/metrics.ts";
import { runSlopWorldAsync } from "../apps/slop/world.ts";
import { randomWithinArea } from "../apps/friends/baselines.ts";
import { friendsMetrics } from "../apps/friends/metrics.ts";
import { friendsPackMatcher } from "../apps/friends/packMatcher.ts";
import { runFriendsWorldAsync } from "../apps/friends/world.ts";
import { pairKey, safeDiv } from "../stats.ts";

export interface SoulmateArmSummary {
  arm: "random" | "slop";
  weeks: number;
  n: number;
  date1Count: number;
  date2Count: number;
  date5Count: number;
  exclusiveCouples: number;
  retainedWeek26Couples: number;
  anxiousAvoidantShareOfDate2: number;
  goodDateRate: number;
  bottom40SecondDateRate: number;
}

export interface FriendshipArmSummary {
  arm: "random" | "friends";
  weeks: number;
  n: number;
  meetupsHeld: number;
  repeatRate: number;
  hall50Pairs: number;
  hall90Pairs: number;
  crewMembersWeek26: number;
  v14: number;
  spendMismatchRate: number;
}

export interface LongHorizonReport {
  weeks: number;
  seeds: number[];
  soulmate: {
    random: SoulmateArmSummary;
    slop: SoulmateArmSummary;
    exclusiveLift: number;
    week26RetentionLift: number;
  };
  friendship: {
    random: FriendshipArmSummary;
    friends: FriendshipArmSummary;
    hall50Lift: number;
    repeatRateLift: number;
  };
}

async function runSoulmateArm(arm: "random" | "slop", weeks: number, n: number, seeds: readonly number[]): Promise<SoulmateArmSummary> {
  let date1Count = 0;
  let date2Count = 0;
  let date5Count = 0;
  let exclusiveCouples = 0;
  let retainedWeek26Couples = 0;
  let aaDate2 = 0;
  let goodSum = 0;
  let bottom40Sum = 0;

  for (const seed of seeds) {
    const matcher = arm === "random" ? slopRandomMatcher() : slopEngineMatcher();
    const res = await runSlopWorldAsync({ seed, weeks, perCity: Math.max(30, Math.round(n / 2)), matcher });
    const m = slopMetrics(res);
    goodSum += m.goodDateRate;
    bottom40Sum += m.assortativity.bottom40SecondDateRate;
    const byId = new Map(res.world.personas.map(p => [p.id, p]));
    const progressed = new Set<string>();

    for (const f of res.flows) {
      if (f.stage !== "date" || !f.outcome) continue;
      date1Count++;
      if (!f.secondDate) continue;
      const pk = pairKey(f.first, f.partner);
      if (progressed.has(pk)) continue;
      progressed.add(pk);
      date2Count++;

      const pa = byId.get(f.first)!;
      const pb = byId.get(f.partner)!;
      const aAtt = pa.hidden.attachmentStyle;
      const bAtt = pb.hidden.attachmentStyle;
      const isAaTrap = (aAtt === "anxious" && bAtt === "avoidant") || (aAtt === "avoidant" && bAtt === "anxious");
      if (isAaTrap) aaDate2++;

      const goalAligned = pa.hidden.goal === pb.hidden.goal;
      const meanEnjoy = (f.outcome.ea + f.outcome.eb) / 2;
      const r = new Rng(hash32(seed, "long-horizon-slop", pk));
      const pDate5 = Math.max(0.05, Math.min(0.92,
        0.25 + 0.55 * meanEnjoy + (goalAligned ? 0.14 : -0.10) + (isAaTrap ? -0.26 : 0.06),
      ));
      if (r.bool(pDate5)) {
        date5Count++;
        const pExclusive = Math.max(0.05, Math.min(0.88,
          0.30 + 0.40 * meanEnjoy + (goalAligned ? 0.18 : -0.15) + (isAaTrap ? -0.24 : 0.08),
        ));
        if (r.bool(pExclusive)) {
          exclusiveCouples++;
          const remainingWeeks = Math.max(0, weeks - f.week);
          const weeklyHazard = isAaTrap ? 0.065 : (goalAligned ? 0.014 : 0.032);
          const pRetain = Math.pow(1 - weeklyHazard, remainingWeeks);
          if (r.bool(pRetain)) retainedWeek26Couples++;
        }
      }
    }
  }

  return {
    arm,
    weeks,
    n,
    date1Count,
    date2Count,
    date5Count,
    exclusiveCouples,
    retainedWeek26Couples,
    anxiousAvoidantShareOfDate2: Number(safeDiv(aaDate2, date2Count).toFixed(3)),
    goodDateRate: Number(safeDiv(goodSum, seeds.length).toFixed(3)),
    bottom40SecondDateRate: Number(safeDiv(bottom40Sum, seeds.length).toFixed(3)),
  };
}

async function runFriendshipArm(arm: "random" | "friends", weeks: number, n: number, seeds: readonly number[]): Promise<FriendshipArmSummary> {
  let meetupsHeld = 0;
  let repeatRateSum = 0;
  let hall50Pairs = 0;
  let hall90Pairs = 0;
  let crewMembersWeek26 = 0;
  let v14Sum = 0;
  let spendMismatchSum = 0;

  for (const seed of seeds) {
    const matcher = arm === "random" ? randomWithinArea : friendsPackMatcher();
    const res = await runFriendsWorldAsync({ seed, weeks, n, matcher });
    const m = friendsMetrics(res);
    meetupsHeld += m.meetups;
    repeatRateSum += m.repeatRate ?? 0;
    v14Sum += m.v14;
    spendMismatchSum += m.strataQuality.spendMismatchRate;
    for (const hrs of res.world.hours.values()) {
      if (hrs >= 50) hall50Pairs++;
      if (hrs >= 90) hall90Pairs++;
    }
    const crewMembers = new Set<string>();
    for (const c of res.world.state.crews) {
      for (const id of c.members) crewMembers.add(id);
    }
    crewMembersWeek26 += crewMembers.size;
  }

  return {
    arm,
    weeks,
    n,
    meetupsHeld,
    repeatRate: Number(safeDiv(repeatRateSum, seeds.length).toFixed(3)),
    hall50Pairs,
    hall90Pairs,
    crewMembersWeek26,
    v14: Number(safeDiv(v14Sum, seeds.length).toFixed(3)),
    spendMismatchRate: Number(safeDiv(spendMismatchSum, seeds.length).toFixed(3)),
  };
}

export async function runLongHorizonBenchmark(weeks = 26, seeds: number[] = [1, 2], nSlop = 140, nFriends = 140): Promise<LongHorizonReport> {
  const slopRand = await runSoulmateArm("random", weeks, nSlop, seeds);
  const slopPack = await runSoulmateArm("slop", weeks, nSlop, seeds);
  const friendsRand = await runFriendshipArm("random", weeks, nFriends, seeds);
  const friendsPack = await runFriendshipArm("friends", weeks, nFriends, seeds);

  return {
    weeks,
    seeds,
    soulmate: {
      random: slopRand,
      slop: slopPack,
      exclusiveLift: Number(safeDiv(slopPack.exclusiveCouples - slopRand.exclusiveCouples, Math.max(1, slopRand.exclusiveCouples)).toFixed(3)),
      week26RetentionLift: Number(safeDiv(slopPack.retainedWeek26Couples - slopRand.retainedWeek26Couples, Math.max(1, slopRand.retainedWeek26Couples)).toFixed(3)),
    },
    friendship: {
      random: friendsRand,
      friends: friendsPack,
      hall50Lift: Number(safeDiv(friendsPack.hall50Pairs - friendsRand.hall50Pairs, Math.max(1, friendsRand.hall50Pairs)).toFixed(3)),
      repeatRateLift: Number((friendsPack.repeatRate - friendsRand.repeatRate).toFixed(3)),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      weeks: { type: "string", default: "26" },
      seeds: { type: "string", default: "1,2" },
      n: { type: "string", default: "140" },
      json: { type: "boolean", default: false },
    },
  });
  const weeks = Number(values.weeks);
  const seeds = values.seeds.split(",").map(Number).filter(x => Number.isFinite(x) && x > 0);
  const n = Number(values.n);
  const report = await runLongHorizonBenchmark(weeks, seeds, n, n);
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Long-Horizon Benchmark (${report.weeks} weeks, seeds=${report.seeds.join(",")}, n=${n})`);
    const sr = report.soulmate.random;
    const sp = report.soulmate.slop;
    console.log(
      `  Soulmate (slop): random(d1=${sr.date1Count}, d2=${sr.date2Count}, d5=${sr.date5Count}, excl=${sr.exclusiveCouples}, w26=${sr.retainedWeek26Couples}) -> `
      + `slop(d1=${sp.date1Count}, d2=${sp.date2Count}, d5=${sp.date5Count}, excl=${sp.exclusiveCouples}, w26=${sp.retainedWeek26Couples}) `
      + `exclLift=${(report.soulmate.exclusiveLift * 100).toFixed(1)}% w26Lift=${(report.soulmate.week26RetentionLift * 100).toFixed(1)}%`,
    );
    const fr = report.friendship.random;
    const fp = report.friendship.friends;
    console.log(
      `  Friendship (friends): random(meetups=${fr.meetupsHeld}, rep=${(fr.repeatRate * 100).toFixed(1)}%, h50=${fr.hall50Pairs}, h90=${fr.hall90Pairs}, crews=${fr.crewMembersWeek26}) -> `
      + `friends(meetups=${fp.meetupsHeld}, rep=${(fp.repeatRate * 100).toFixed(1)}%, h50=${fp.hall50Pairs}, h90=${fp.hall90Pairs}, crews=${fp.crewMembersWeek26}) `
      + `repeatLift=+${(report.friendship.repeatRateLift * 100).toFixed(1)}pp`,
    );
  }
}
