// slopPack weekly assignment (AppPack.selection.assign): who gets proposed to whom this run. The
// generic greedy selection over the Date lane's edges: the highest value first, each member at most
// once per round and never past the lane capacity left this week. Congestion control: a member is in
// at most `perMemberPerTick` proposals per run (rounds; round 2 is a backup the harness / dispatcher
// only sends when round 1 failed). The exposure floor: pairs whose scarcer member has few eligible
// partners go first, and carried exposure debt lifts a pair. Nothing here reads a rating. A member's
// degree is the number of searched partners (one candidate per member pair), not every eligible one.
import type { MemberId } from "@thenetwork/core";
import { canReservePair, initial, memberCount, step } from "../../../../core/src/generated/slopAssignment.ts";
import type { AssignContext } from "../../pack.ts";
import type { Selected, SelectionResult } from "../../policy.ts";
import type { Scored } from "../../scoring.ts";
import { pairKey, type World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import { SLOP_MATCH_LANE } from "./rules.ts";

interface Edge { s: Scored; a: MemberId; b: MemberId; v: number }

export function slopAssign(o: SlopPackOptions, w: World, scored: readonly Scored[], ctx: AssignContext): SelectionResult {
  const C = o.congestion;
  const pairs = scored.filter(x => x.eligible && x.c.participants.length === 2 && !x.c.exploration);
  const degree = new Map<MemberId, number>();
  for (const x of pairs) for (const id of x.c.participants) degree.set(id, (degree.get(id) ?? 0) + 1);
  const capacity = (id: MemberId) => w.match.profileIn(id, SLOP_MATCH_LANE)?.capacity ?? 0;
  const usable = (id: MemberId) => !ctx.exclude?.has(id) && !w.get(id)!.inOpenOpportunity;
  const debt = (id: MemberId) => Math.min(C.debtCap, Math.max(0, ctx.debt[id] ?? 0));
  const edges: Edge[] = [];
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    if (!usable(a) || !usable(b) || x.score < o.minValue) continue;
    edges.push({ s: x, a, b, v: x.score + (C.debtWeight * (debt(a) + debt(b))) / 2 });
  }
  const tier = (e: Edge) => (C.scarceDegree > 0 && Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.scarceDegree ? 0 : 1);
  edges.sort((p, q) => (tier(p) - tier(q)) || (q.v - p.v) || (p.s.c.key < q.s.c.key ? -1 : 1));

  const selected: Selected[] = [];
  // spec/slopAssignment.md, "Assignment opens each configured round once in order"
  const configuredRounds = Math.floor(Math.max(1, C.perMemberPerTick, C.backupMaxDegree > 0 ? 2 : 1));
  const totalRounds = Number.isNaN(configuredRounds) ? 0 : Math.min(configuredRounds, edges.length);
  const baseRounds = Math.max(0, Math.min(Math.floor(C.perMemberPerTick), totalRounds)) || 0;
  let run = step(initial, { type: "configureAssignment", totalRounds, baseRounds });
  const withinBackupDegree = (e: Edge) => Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.backupMaxDegree;
  const hasRoom = (id: MemberId) => memberCount(run.memberCounts, id) < capacity(id);
  while (run.phase === "BetweenRounds") {
    run = step(run, { type: "openRound" });
    for (const e of edges) {
      // spec/slopAssignment.md, "Each pair can be reserved once and each member can participate once per round"
      if (!hasRoom(e.a) || !hasRoom(e.b) || !canReservePair(run, pairKey(e.a, e.b), e.a, e.b, withinBackupDegree(e))) continue;
      run = step(run, { type: "reservePair", pairKey: pairKey(e.a, e.b), memberA: e.a, memberB: e.b, withinBackupDegree: withinBackupDegree(e) });
      selected.push({ s: e.s, exploration: false, rank: run.proposed - 1, probability: 1, value: null });
    }
    run = step(run, { type: "closeRound" });
  }
  return { selected, budgetSkips: edges.length - selected.length };
}
