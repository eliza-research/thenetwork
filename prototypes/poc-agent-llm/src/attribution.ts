// Deterministic thread attribution: which active item does an inbound member message belong to?
// The model may PROPOSE a target item (thread_id / opportunity_id); this code decides whether that target is allowed.
//
// Rule (in priority order):
//   1. reply_to: the channel supplied a quoted reply to an item's message -> that item only.
//   2. mention: the message references one or more items by a trusted anchor (counterpart name, activity, place,
//      day from the item's own database description) -> exactly those items.
//   3. unanchored (any length: "sure", "sounds good", "nice, saturday?"): bind to the most recent outbound item,
//      unless 2+ distinct items had outbound messages within WINDOW_MIN -> ambiguous: ask, do not act.
//      With no outbound in the window, the most recent outbound overall wins; with no outbound at all, the only
//      active item wins; otherwise ambiguous.
// Anchors come only from trusted item descriptions, never from relayed (untrusted) text.
import type { CtxV2 } from "./contexts.ts";
import type { ProposedAction } from "./spec.ts";

export const WINDOW_MIN = 60;

export interface Item { id: string; status: string; names: string[]; anchors: string[]; desc: string }
export type Attribution =
  | { mode: "reply_to"; allowed: string[]; candidates: string[] }
  | { mode: "mention"; allowed: string[]; candidates: string[] }
  | { mode: "bound"; allowed: string[]; candidates: string[]; bound: string | null }
  | { mode: "ambiguous"; allowed: string[]; candidates: string[]; newest?: string | null };

const DAYS: Record<string, string> = {
  mon: "mon", monday: "mon", tue: "tue", tues: "tue", tuesday: "tue", wed: "wed", weds: "wed", wednesday: "wed",
  thu: "thu", thur: "thu", thurs: "thu", thursday: "thu", fri: "fri", friday: "fri", sat: "sat", saturday: "sat", sun: "sun", sunday: "sun",
};
// Activity stems recognised in item descriptions (and matched as prefixes in member text).
// Places are deliberately NOT anchors ("near the mission?" must not bind to Priya-from-the-Mission).
const ACTIVITIES = ["coffee", "climb", "boulder", "dinner", "noise", "concert", "ceramic", "pottery", "game"];

const tokens = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[‘’]/g, "'").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Parse trusted active-item descriptions into ids + anchors. */
export function parseItems(ctx: { active_items: string[] }): Item[] {
  return ctx.active_items.flatMap(desc => {
    const id = desc.match(/\b(thread|opp)_\d+\b/)?.[0];
    if (!id) return [];
    const status = desc.split(" ")[0];
    const names = [...desc.matchAll(/\b(?:with|to)\s+([A-Z][a-z]+)/g), ...desc.matchAll(/\b(Sam|Lee|Ana)\b/g)].map(m => m[1].toLowerCase());
    const toks = tokens(desc);
    const acts = ACTIVITIES.filter(a => toks.some(t => t.startsWith(a)));
    const days = toks.filter(t => DAYS[t]).map(t => "day:" + DAYS[t]);
    return [{ id, status, names: [...new Set(names)], anchors: [...new Set([...names, ...acts, ...days])], desc }];
  });
}

const FULL_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Canonical day for a member token, tolerating SMS typos ("satruday", "saturdat", "thrusday"). */
export function dayOf(t: string): string | undefined {
  if (DAYS[t]) return DAYS[t];
  if (t.length < 6) return undefined;
  const hit = FULL_DAYS.find(d => lev(t, d) <= 2);
  return hit ? DAYS[hit] : undefined;
}

/** Items the message explicitly references (by id, counterpart name, activity or day). */
export function mentionedItems(text: string, items: Item[]): string[] {
  const toks = tokens(text);
  const has = (a: string) => a.startsWith("day:") ? toks.some(t => dayOf(t) === a.slice(4))
    : ACTIVITIES.includes(a) ? toks.some(t => t.startsWith(a)) : toks.includes(a);
  return items.filter(it => text.includes(it.id) || it.anchors.some(has)).map(it => it.id);
}

export function attribute(text: string, ctx: CtxV2, windowMin = WINDOW_MIN): Attribution {
  const items = parseItems(ctx);
  const ids = items.map(i => i.id);
  const ch = ctx.channel ?? {};
  if (ch.reply_to && ids.includes(ch.reply_to)) return { mode: "reply_to", allowed: [ch.reply_to], candidates: [ch.reply_to] };
  const mentioned = mentionedItems(text, items);
  if (mentioned.length) return { mode: "mention", allowed: mentioned, candidates: mentioned };
  // unanchored: outbound timeline, newest first; channel.last_seen counts as the newest outbound
  const ob = [...(ctx.outbound ?? [])].sort((a, b) => a.agoMin - b.agoMin);
  if (ch.last_seen && ids.includes(ch.last_seen)) ob.unshift({ item: ch.last_seen, agoMin: 0, kind: "agent" });
  const recent = [...new Set(ob.filter(o => o.agoMin <= windowMin && o.item && ids.includes(o.item)).map(o => o.item!))];
  if (recent.length >= 2) return { mode: "ambiguous", allowed: [], candidates: recent, newest: ob[0]?.item ?? null };
  if (ob.length) {
    // most recent outbound (may be a non-item message such as concierge results -> bound to nothing actionable)
    const newest = ob[0];
    const b = newest.item && ids.includes(newest.item) ? newest.item : null;
    return { mode: "bound", allowed: b ? [b] : [], candidates: b ? [b] : [], bound: b };
  }
  if (ids.length === 1) return { mode: "bound", allowed: ids, candidates: ids, bound: ids[0] };
  return { mode: "ambiguous", allowed: [], candidates: ids };
}

/** The item an action targets, if it is an item-targeting action. */
export function targetOf(a: ProposedAction): string | null {
  switch (a.type) {
    case "RESPOND_TO_OPPORTUNITY": return a.opportunity_id;
    case "RELAY_MESSAGE": case "SHARE_CONTACT": case "SCHEDULE": return a.thread_id;
    default: return null;
  }
}

export type TargetCheck = { ok: true } | { ok: false; why: string; ask: string };

/** Validate the model's proposed target against the attribution rule. Non-item actions always pass. */
export function checkTarget(a: ProposedAction, att: Attribution, ctx: CtxV2): TargetCheck {
  const t = targetOf(a);
  if (t === null) return { ok: true };
  if (att.allowed.includes(t)) return { ok: true };
  // Read-only exception: a question about the most recent item ("tell me more about her?") changes no state, so in an
  // ambiguous window it binds to the newest outbound item instead of asking which. Anything that changes state still asks.
  if (att.mode === "ambiguous" && a.type === "RESPOND_TO_OPPORTUNITY" && a.response === "question" && att.newest === t) return { ok: true };
  const items = parseItems(ctx);
  const cands = [...new Set([...att.candidates, t])].filter(id => items.some(i => i.id === id));
  return { ok: false, why: att.mode === "ambiguous" ? `ambiguous: ${att.candidates.join(", ")} open in window` : `target ${t} not attributable (${att.mode}: ${att.allowed.join(",") || "none"})`,
    ask: disambiguation(cands, items) };
}

export function disambiguation(cands: string[], items: Item[]): string {
  const label = (id: string) => {
    const it = items.find(i => i.id === id);
    const who = it?.names[0] ? it.names[0][0].toUpperCase() + it.names[0].slice(1) : null;
    if (!it) return id;
    if (it.status === "PENDING") return who ? `${who}'s invite` : `the pending invite (${it.desc.replace(/^PENDING INVITE \w+: /, "").split(".")[0]})`;
    return who ? `your thread with ${who}` : id;
  };
  if (cands.length === 0) return "Which conversation was that for?";
  if (cands.length === 1) return `Just checking: was that about ${label(cands[0])}?`;
  return `Quick check: was that for ${cands.map(label).join(", or ")}?`;
}
