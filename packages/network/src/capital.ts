// Network capital (NC) wiring for the ConsentNetwork (docs/results/2026-10-08-network-capital.md,
// "Integration asks"). The Network emits ledger events through one typed emitter
// (NetworkOptions.onLedger) and reads the levers through an injected reader
// (NetworkOptions.capital). Both are optional: without them the Network behaves as before.
//
// packages/capital is imported by relative path, as packages/capital imports core and engine,
// so that no workspace dependency (and no bun.lock change) is added.
import type { MemberId } from "@thenetwork/core";
import { CapitalLedger, detectGaming, effortOverlay, organizingReach, resolveCapital, vouchCapacity, type CapitalConfigInput, type CapitalEvent, type CapitalEventInput, type GamingFlag, type NetworkEffort, type OrganizingReach } from "../../capital/src/index.ts";

export type { CapitalEvent, CapitalEventInput, GamingFlag, NetworkEffort, OrganizingReach };
export { CapitalLedger };

/** The base organizing reach and the floor effort (levers off): what the Network does without a reader. */
export const BASE_REACH = 8;
export const FLOOR_EFFORT: NetworkEffort = { conciergeResearchDepth: 3, intentReSearchDays: 3, planBuildingOptions: 3 };

/**
 * What the Network reads from the NC ledger at run time. Every function is about ONE member's own
 * entries (design 2.5): nothing here ranks one member against another.
 */
export interface CapitalReader {
  /** Invites this member may send per rolling 30 days (read at invite time). */
  vouchCapacity(member: MemberId, now: number): number;
  /** People a crew or plan this member hosts may reach; slots above the base go to members with the least recent participation. */
  organizingReach(member: MemberId, now: number): OrganizingReach;
  /** How much work the Network does for this member's own asks. */
  effort(member: MemberId, now: number): NetworkEffort;
  /** Gaming flags for the human review queue (rings, staged meetups, help farming). */
  flags?(now: number): GamingFlag[];
}

/** A reader over a CapitalLedger (the levers are pure functions of the member's own entries). */
export function ledgerReader(ledger: CapitalLedger, cfg?: CapitalConfigInput): CapitalReader {
  // The ledger's own config unless one is passed: thresholds must agree with what the ledger credits (capital-m1).
  const conf = cfg ? resolveCapital(cfg) : ledger.cfg;
  return {
    vouchCapacity: (m, now) => vouchCapacity(ledger.internalEntries(m), now, conf),
    organizingReach: (m, now) => organizingReach(ledger.internalEntries(m), now, conf),
    effort: (m, now) => effortOverlay(ledger.internalEntries(m), now, conf).network,
    flags: now => detectGaming(ledger.all(), now, conf),
  };
}

/**
 * Wire a ledger to a Network: `onLedger` records every event, `capital` reads the levers. Events
 * the ledger cannot take (out of time order after a restart) are counted, never thrown into the
 * Network's send path.
 */
export function capitalWiring(ledger = new CapitalLedger(), o: { reader?: boolean } = {}) {
  const counts: Record<string, number> = {};
  let rejected = 0;
  const rejects: { id: string; reason: string }[] = [];
  const onLedger = (e: CapitalEvent) => {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    // A rejected event is kept with its id and reason (capital-3): the harness fails on any.
    try { ledger.record(e); } catch (err) { rejected++; rejects.push({ id: e.id, reason: err instanceof Error ? err.message.slice(0, 120) : "rejected" }); }
  };
  return { ledger, onLedger, counts, rejected: () => rejected, rejects: () => [...rejects], ...(o.reader === false ? {} : { capital: ledgerReader(ledger) }) };
}
