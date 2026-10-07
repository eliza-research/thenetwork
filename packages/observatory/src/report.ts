#!/usr/bin/env bun
// Reproducible observatory findings: run the 500-member synthetic world headless for N days and
// print what the observatory shows (funnel, outcomes vs ground truth, unsafe proposals by cause,
// dispatch skips, fairness over time, the graph the Network learned).
//   bun run packages/observatory/src/report.ts --days 14 --seed 1 [--engine engine-v1|random]
import { parseArgs } from "node:util";
import { DAY } from "@thenetwork/core";
import { scoreboard } from "./scoring.ts";
import { GameSource } from "./sources/game.ts";

const { values: a } = parseArgs({ options: { days: { type: "string", default: "14" }, seed: { type: "string", default: "1" }, engine: { type: "string", default: "engine-v1" }, personas: { type: "string", default: "0" } } });
const days = Number(a.days);
const g = new GameSource({ seed: Number(a.seed), days, engine: a.engine as "engine-v1" | "random", personas: Number(a.personas), pushMs: 3_600_000, tickMs: 3_600_000 });
const t0 = performance.now();
await g.init();
await g.control({ type: "step", ms: days * DAY });
const s = g.state();
await g.dispose();

const count = <T>(xs: T[], f: (x: T) => string | undefined) => xs.reduce<Record<string, number>>((m, x) => { const k = f(x); if (k) m[k] = (m[k] ?? 0) + 1; return m; }, {});
const opps = s.opportunities.filter(o => o.source !== "shadow");
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const unsafe = opps.filter(o => o.oracle?.unsafe);
const report = {
  world: { seed: Number(a.seed), days, engine: a.engine, members: s.members.length, wallMs: Math.round(performance.now() - t0) },
  proposals: {
    total: opps.length, byState: s.stats.oppsByState,
    skippedAtDispatch: { count: s.stats.oppsByState.SKIPPED ?? 0, share: r3((s.stats.oppsByState.SKIPPED ?? 0) / Math.max(1, opps.length)), reasons: count(opps.filter(o => o.state === "SKIPPED"), o => o.reason) },
    precisionVsTruth: r3(s.stats.compatible / Math.max(1, s.stats.oracleJudged)),
    unsafe: { count: unsafe.length, share: r3(unsafe.length / Math.max(1, opps.length)), byFlag: count(unsafe.flatMap(o => o.oracle!.flags), f => f), reachedInvite: unsafe.filter(o => o.state !== "PROPOSED" && o.state !== "SKIPPED").length },
  },
  people: {
    invites: s.stats.invites, acceptRate: r3(s.stats.accepts / Math.max(1, s.stats.invites)), meetingsHeld: s.stats.meetingsHeld,
    showRate: r3(s.stats.attended / Math.max(1, s.stats.attended + s.stats.noShows + s.stats.cancelledWithNotice)),
    meanEnjoyment: r3(s.stats.enjoymentSum / Math.max(1, s.stats.enjoymentN)),
    membersWhoMet: s.members.filter(m => m.counters.meetings > 0).length,
    proactivePerMemberPerWeek: r3(s.stats.proactive / Math.max(1, s.stats.joined) / (days / 7)),
    optOuts: s.stats.optOuts, blocks: s.stats.blocks, safetyFlags: s.stats.adversarialAttempts, invariantViolations: s.stats.invariantViolations,
  },
  engineRunsByDay: s.engineRuns.map(r => ({ day: Math.floor((r.at - s.clock.start) / DAY) + 1, city: r.city, candidates: r.funnel.generated, eligible: r.funnel.eligible, budgetSkips: r.funnel.budgetSkips, proposals: r.proposals, gini: r3(r.fairness.gini), zeroExposure: r3(r.fairness.zeroExposureShare) })),
  learnedGraph: Object.fromEntries(["introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"].map(k => [k, s.stats.edgesByType[k] ?? 0])),
  scoreboard: scoreboard(s.opportunities),
};
console.log(JSON.stringify(report, null, 2));
process.exit(0);
