// The gate on get_updates: only a summary with no leak label leaves. The proof shows the gate is applied
// to every update, not that the patterns in leaks.ts find every leak (evals/guard and the MCP output gate do).
import { outputLeaks } from "./leaks.ts";

/** One update for the person's assistant: a member-safe line from the inbox (packages/notify). */
export interface PublicUpdate { summary: string; at: string; kind: string }

//@ extern
export function leakCount(text: string): number { return outputLeaks(text).length; }

//@ verify
//@ ensures forall(u: PublicUpdate, \result.includes(u) ==> leakCount(u.summary) === 0)
export function gateUpdates(updates: readonly PublicUpdate[]): PublicUpdate[] {
  return updates.filter(u => leakCount(u.summary) === 0);
}
