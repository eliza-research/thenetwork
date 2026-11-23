// slopPack weekly assignment (AppPack.selection.assign): who gets proposed to whom this run. The
// generic selection over the Date lane's edges, each member at most once per round and never past
// the lane capacity left this week. Congestion control: a member is in at most `perMemberPerTick`
// proposals per run (rounds; round 2 is a backup the harness / dispatcher only sends when round 1
// failed). The first round opens with the engine's exposure floor (policy.ts exposureFloor): each
// floor member, highest carried exposure debt first, gets their best edge that fits. Then pairs whose
// scarcer member has few searched partners go first, then the highest value, which carried exposure
// debt lifts. Nothing here reads a rating. A member's degree is the number of searched partners (one
// candidate per member pair), not every eligible one.
import type { MemberId } from "@thenetwork/core";
import { canReservePair, initial, memberCount, step } from "../../../../core/src/generated/slopAssignment.ts";
import type { AssignContext } from "../../pack.ts";
import { exposureFloor, type Selected, type SelectionResult } from "../../policy.ts";
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
  // Interruption budget (ME-002): proposals in the budget period. Asks are not counted here: a missing
  // hard field already holds the member back (needs_answer), and the Network sends one open question at a time.
  const budgetLeft = (id: MemberId) => { const mi = w.get(id)!; return w.cfg.budgets[mi.m.state].limit - mi.recentProactive; };
  const usable = (id: MemberId) => !ctx.exclude?.has(id) && !w.get(id)!.inOpenOpportunity && budgetLeft(id) > 0;
  const debt = (id: MemberId) => Math.min(C.debtCap, Math.max(0, ctx.debt[id] ?? 0));
  const edges: Edge[] = [];
  for (const x of pairs) {
    const [a, b] = x.c.participants as [MemberId, MemberId];
    if (!usable(a) || !usable(b) || x.score < o.minValue) continue;
    edges.push({ s: x, a, b, v: x.score + (C.debtWeight * (debt(a) + debt(b))) / 2 });
  }
  const tier = (e: Edge) => (C.scarceDegree > 0 && Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.scarceDegree ? 0 : 1);
  edges.sort((p, q) => (tier(p) - tier(q)) || (q.v - p.v) || (p.s.c.key < q.s.c.key ? -1 : 1));
  const byMember = new Map<MemberId, Edge[]>();
  for (const e of edges) for (const id of [e.a, e.b]) { const own = byMember.get(id); if (own) own.push(e); else byMember.set(id, [e]); }

  const selected: Selected[] = [];
  // spec/slopAssignment.md, "Assignment opens each configured round once in order"
  const configuredRounds = Math.floor(Math.max(1, C.perMemberPerTick, C.backupMaxDegree > 0 ? 2 : 1));
  const totalRounds = Number.isNaN(configuredRounds) ? 0 : Math.min(configuredRounds, edges.length);
  const baseRounds = Math.max(0, Math.min(Math.floor(C.perMemberPerTick), totalRounds)) || 0;
  let run = step(initial, { type: "configureAssignment", totalRounds, baseRounds });
  const withinBackupDegree = (e: Edge) => Math.min(degree.get(e.a) ?? 0, degree.get(e.b) ?? 0) <= C.backupMaxDegree;
  const hasRoom = (id: MemberId) => memberCount(run.memberCounts, id) < Math.min(capacity(id), budgetLeft(id));
  // spec/slopAssignment.md, "Each pair can be reserved once and each member can participate once per round"
  const tryReserve = (e: Edge): boolean => {
    if (!hasRoom(e.a) || !hasRoom(e.b) || !canReservePair(run, pairKey(e.a, e.b), e.a, e.b, withinBackupDegree(e))) return false;
    run = step(run, { type: "reservePair", pairKey: pairKey(e.a, e.b), memberA: e.a, memberB: e.b, withinBackupDegree: withinBackupDegree(e) });
    selected.push({ s: e.s, exploration: false, rank: run.proposed - 1, probability: 1 });
    return true;
  };
  while (run.phase === "BetweenRounds") {
    run = step(run, { type: "openRound" });
    // spec/selectionRun.md, "Exposure selection precedes exploration and greedy selection": the same
    // floor members and cap. The floor order is a shell decision (spec/slopAssignment.md, first
    // paragraph); each floor reservation steps this machine through tryReserve.
    if (run.round === 1) {
      const floor = exposureFloor(w, ctx.rng, ctx.debt);
      let taken = 0;
      for (const id of floor.members) {
        if (taken >= floor.cap) break;
        if ((byMember.get(id) ?? []).some(tryReserve)) taken++;
      }
    }
    for (const e of edges) tryReserve(e);
    run = step(run, { type: "closeRound" });
  }
  return { selected, budgetSkips: edges.length - selected.length };
}
