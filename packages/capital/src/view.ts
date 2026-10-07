// "What you've built" (design 2.6, PRD 39.2.4). A short private story built from the member's own
// itemized entries. No number of NC, no points, no tier, no per-act price. Counts of things the
// member did ("helped 5 members") are fine; those are facts they already know. Clawed-back credits
// are left out. Misses (no-shows) are left out by default: the view acknowledges contribution.
import type { LedgerEntry } from "./types.ts";

export interface ViewOptions { includeMisses?: boolean }

const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
const plural = (label: string, k: number) => (k === 1 ? `a ${label}` : `${k} ${label.endsWith("s") ? label : `${label}s`}`);

export function whatYouBuilt(entries: readonly LedgerEntry[], opts: ViewOptions = {}): string {
  const reversed = new Set(entries.filter(e => e.provenance.reverses).map(e => e.provenance.reverses!));
  const kept = entries.filter(e => e.sign === 1 && !reversed.has(e.id));
  const parts: string[] = [];

  const vouches = kept.filter(e => e.category === "vouch").length;
  if (vouches) parts.push(`you've vouched for ${n(vouches, "someone who is now active", "people who are now active")}`);

  const helped = new Set(kept.filter(e => e.category === "help").flatMap(e => e.provenance.counterparts)).size;
  if (helped) parts.push(`you've helped ${n(helped, "a member", "members")}`);

  const needs = kept.filter(e => e.category === "needs_answered").length;
  if (needs) parts.push(`you answered ${n(needs, "one of the Network's asks", "of the Network's asks")}`);

  const byLabel = new Map<string, number>();
  for (const e of kept.filter(e => e.category === "organizing")) {
    const l = e.provenance.label?.trim() || "plan";
    byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
  }
  const organized = [...byLabel].map(([l, k]) => plural(l, k));
  if (organized.length) parts.push(`you organized ${joinList(organized)}`);

  const attended = new Set(kept.filter(e => e.category === "attendance" && e.provenance.eventType === "plan_attended").map(e => e.provenance.planId)).size;
  if (attended) parts.push(`you showed up to ${n(attended, "a plan", "plans")}`);

  if (kept.some(e => e.category === "review")) parts.push("you helped review things for the Network");

  if (opts.includeMisses) {
    const missed = entries.filter(e => e.category === "no_show" && !e.provenance.forgiven).length;
    if (missed) parts.push(`${n(missed, "one plan was", "plans were")} missed after confirming`);
  }

  if (!parts.length) return "Nothing here yet. Showing up, helping someone, and vouching for people all count.";
  const s = parts.join("; ");
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
