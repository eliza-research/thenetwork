// The meetup block: fast deterministic 5-city meetup setup, red-line venue selection, Top-1 + 3-pivot
// flow, external event bridge, external matchmaker sourcing, cross-app firewall, kill-switch failover,
// panic exit halt, full-vs-closed quarantine, and no-show recovery.
// PINNED (CI): seeds [13, 14, 15, 16], 4 weeks, 200 personas across nyc/sf/la/chicago/miami (paired CRN).
// --quick: seed [13], 2 weeks; safety gates block, quality lift/acceptance tracked.
import { aggregateMeetupRuns } from "../../packages/sim/src/apps/meetup/metrics.ts";
import { meetupOfficialGates } from "../../packages/sim/src/apps/meetup/gates.ts";
import { MEETUP_PINNED, MEETUP_QUICK, runMeetupWorld, type MeetupRunResult } from "../../packages/sim/src/apps/meetup/world.ts";
import { Block } from "./gate.ts";

export async function meetupBlock(b: Block, opts: { quick: boolean }): Promise<void> {
  const cfg = opts.quick ? MEETUP_QUICK : MEETUP_PINNED;
  const baselineRuns: MeetupRunResult[] = [];
  const meetupRuns: MeetupRunResult[] = [];

  for (const seed of cfg.seeds) {
    baselineRuns.push(await runMeetupWorld({ seed, weeks: cfg.weeks, arm: "baseline" }));
    meetupRuns.push(await runMeetupWorld({ seed, weeks: cfg.weeks, arm: "meetup" }));
  }

  const metrics = aggregateMeetupRuns(baselineRuns, meetupRuns);
  for (const g of meetupOfficialGates(metrics, { quick: opts.quick })) {
    b.gate(g.gate, g.pass, g.value, g.blocking);
  }
}
