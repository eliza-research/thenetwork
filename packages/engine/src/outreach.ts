// Outreach and interruption control (Section 32.9, flows F20, F28). Decides whether, when and
// how to contact a member. Budgets count only proactive messages the member did not ask for;
// budgets reset weekly (monthly for Quiet) in the member's local time; quiet hours are local;
// two consecutive unanswered proactive messages move the member to "only when I ask".
import type { Category, City, Clock, Member, MemberId, ParticipationState } from "@thenetwork/core";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { DEFAULT_ATTENTION } from "./config.ts";

export type MessageKind =
  | "invitation" | "profiling_question" | "recommendation" | "worthwhile_check"
  | "reply" | "scheduling" | "reminder" | "check_in" | "relay" | "safety_notice" | "account_notice";

/**
 * F28 / 32.9 as amended by founder decision 3 (2026-10-07): only INITIAL INVITES count against the
 * budget and toward the two-unanswered pause: an invitation (a probe or invite to a new opportunity,
 * including the partner's first probe) or a recommendation (an outside-world suggestion). Everything
 * after the invite (scheduling, reminders, check-ins, relays, feedback asks, acknowledgements) and
 * profiling asks never count.
 */
const PROACTIVE: ReadonlySet<MessageKind> = new Set<MessageKind>(["invitation", "recommendation"]);
export const isProactive = (k: MessageKind) => PROACTIVE.has(k);
/**
 * Agent-initiated asks that are not invites: a profiling question (including an opt-in weekly
 * "what's your week like?" check-in that carries no proposal) and a "was that worth a text?"
 * feedback ask. Not budgeted; held by the one-question rule: at most one such ask open at a time.
 */
const ASKS: ReadonlySet<MessageKind> = new Set<MessageKind>(["profiling_question", "worthwhile_check"]);
export const isAsk = (k: MessageKind) => ASKS.has(k);
const ALWAYS: ReadonlySet<MessageKind> = new Set<MessageKind>(["safety_notice", "account_notice"]);
/**
 * Audit 2026-10-07 P1-8: everything the Network starts on its own is agent-initiated: proactive
 * kinds plus scheduling, reminders, check-ins/nudges and relays. Quiet hours and pause apply to all
 * of them. Only a direct reply to the member's own message and safety/account notices are exempt.
 */
export const isAgentInitiated = (k: MessageKind) => k !== "reply" && !ALWAYS.has(k);

/** True if `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export interface OutboundMessage {
  id: string; memberId: MemberId; kind: MessageKind; category?: Category;
  /** Time sent (history) or requested (new). */
  at: number; expiresAt?: number; repliedAt?: number;
  /** Receiving state: support / low-effort social value only. */
  supportive?: boolean; priority?: number;
}

export interface Budget { limit: number; period: "week" | "month" }
/**
 * Interruption caps (D1). One number per state, shared with the attention budget (config.ts
 * DEFAULT_ATTENTION.caps, audit P2-13). This controller counts them per calendar week / month in
 * the member's local time; attention.ts counts the same caps over rolling 7 / 30 days, which is the
 * founder's definition (D1: "Normal 2/7d") and the one the Network's send path should use.
 */
export const BUDGETS: Record<ParticipationState, Budget> = {
  open: { limit: DEFAULT_ATTENTION.caps.open.limit, period: "week" },
  normal: { limit: DEFAULT_ATTENTION.caps.normal.limit, period: "week" },
  quiet: { limit: DEFAULT_ATTENTION.caps.quiet.limit, period: "month" },
  receiving: { limit: DEFAULT_ATTENTION.caps.receiving.limit, period: "week" }, // support-only (see decide)
  paused: { limit: 0, period: "week" },
};
export const UNANSWERED_WINDOW = 72 * HOUR;

export const CITY_TZ: Record<City, string> = { sf: "America/Los_Angeles", nyc: "America/New_York", la: "America/Los_Angeles" };

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localParts(ts: number, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!);
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, weekday: wd };
}
/** UTC timestamp of a local wall-clock time (handles DST via a two-step offset correction). */
export function fromLocal(y: number, mo: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  const off = (ts: number) => { const p = localParts(ts, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ts / MINUTE) * MINUTE; };
  let ts = guess - off(guess);
  ts = guess - off(ts);
  return ts;
}
/** Start of the current budget window in member local time (Monday 00:00 or the 1st 00:00). */
export function windowStart(ts: number, tz: string, period: "week" | "month"): number {
  const p = localParts(ts, tz);
  if (period === "month") return fromLocal(p.year, p.month, 1, 0, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
  return fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, tz);
}
export function nextWindowStart(ts: number, tz: string, period: "week" | "month"): number {
  const p = localParts(ts, tz);
  if (period === "month") return p.month === 12 ? fromLocal(p.year + 1, 1, 1, 0, tz) : fromLocal(p.year, p.month + 1, 1, 0, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday + 7));
  return fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, tz);
}
export function inQuietHours(ts: number, tz: string, [s, e]: [number, number]): boolean {
  if (s === e) return false;
  const h = localParts(ts, tz).hour;
  return s < e ? h >= s && h < e : h >= s || h < e;
}
export function quietHoursEnd(ts: number, tz: string, qh: [number, number]): number {
  let t = ts;
  for (let i = 0; i < 4 * 48 && inQuietHours(t, tz, qh); i++) t = Math.floor(t / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE;
  return t;
}

/** Deadline after which an unreplied proactive message counts as unanswered: 72h or expiry, whichever first. */
export const unansweredDeadline = (m: OutboundMessage) => Math.min(m.at + UNANSWERED_WINDOW, m.expiresAt ?? Infinity);

/** Number of consecutive most-recent proactive messages that are unanswered (pending ones skipped). */
export function unansweredStreak(history: OutboundMessage[], now: number): number {
  // Bundled items share one message id (one text, one budget unit): count each message once,
  // answered if any of its rows has a reply. Otherwise one unanswered bundle of two items
  // would trip the two-unanswered rule on its own.
  const byId = new Map<string, OutboundMessage>();
  for (const m of history) {
    if (!isProactive(m.kind) || m.at > now) continue;
    const cur = byId.get(m.id);
    if (!cur) { byId.set(m.id, m); continue; }
    const replied = [cur.repliedAt, m.repliedAt].filter((x): x is number => x !== undefined);
    byId.set(m.id, {
      ...cur, at: Math.min(cur.at, m.at),
      expiresAt: cur.expiresAt === undefined || m.expiresAt === undefined ? undefined : Math.max(cur.expiresAt, m.expiresAt),
      repliedAt: replied.length ? Math.min(...replied) : undefined,
    });
  }
  const pro = [...byId.values()].sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : 1));
  let n = 0;
  for (const m of pro) {
    const dl = unansweredDeadline(m);
    const answered = m.repliedAt !== undefined && m.repliedAt <= dl && m.repliedAt <= now;
    if (answered) break;
    if (now < dl) continue; // still pending
    n++;
  }
  return n;
}

export type Decision =
  | { action: "send"; reason: string; sendAt: number; countsAgainstBudget: boolean }
  | { action: "defer"; reason: string; sendAt: number; countsAgainstBudget: boolean }
  | { action: "hold"; reason: string }
  | { action: "drop"; reason: string };

export interface DecisionLog { at: number; memberId: MemberId; messageId: string; decision: Decision }

export class OutreachController {
  readonly log: DecisionLog[] = [];
  constructor(private clock: Clock, private tzFor: (m: Member) => string = m => CITY_TZ[m.homeCity]) {}

  budgetUsed(member: Member, history: OutboundMessage[], at = this.clock.now()): number {
    const b = BUDGETS[member.state];
    const tz = this.tzFor(member);
    const start = windowStart(at, tz, b.period);
    // Bundled items share a message id; count unique message ids.
    return new Set(history.filter(m => m.memberId === member.id && isProactive(m.kind) && m.at >= start && m.at <= at).map(m => m.id)).size;
  }

  /** F28: apply the two-unanswered rule. Returns whether the member is now "only when I ask". */
  applyUnansweredRule(member: Member, history: OutboundMessage[]): { onlyWhenAsked: boolean; changed: boolean; streak: number } {
    const streak = unansweredStreak(history.filter(m => m.memberId === member.id), this.clock.now());
    const was = member.prefs.onlyWhenAsked;
    const now = was || streak >= 2;
    return { onlyWhenAsked: now, changed: now !== was, streak };
  }

  /** On the member's next inbound message: tell them (visibly) and offer to resume. */
  onInbound(member: Member, history: OutboundMessage[]): { notice?: string; resetStreak: true } {
    const st = this.applyUnansweredRule(member, history);
    return st.onlyWhenAsked && st.streak >= 2
      ? { notice: "I paused proactive messages since my last couple went unanswered. Want me to turn them back on?", resetStreak: true }
      : { resetStreak: true };
  }

  decide(member: Member, msg: OutboundMessage, history: OutboundMessage[]): Decision {
    const d = this.decideInner(member, msg, history);
    this.log.push({ at: this.clock.now(), memberId: member.id, messageId: msg.id, decision: d });
    return d;
  }

  private decideInner(member: Member, msg: OutboundMessage, history: OutboundMessage[]): Decision {
    const now = this.clock.now();
    const tz = this.tzFor(member);
    if (ALWAYS.has(msg.kind)) return { action: "send", reason: "safety_or_account_notice", sendAt: now, countsAgainstBudget: false };
    if (msg.expiresAt !== undefined && msg.expiresAt <= now) return { action: "drop", reason: "expired" };
    if (msg.kind === "reply") return { action: "send", reason: "reply", sendAt: now, countsAgainstBudget: false };
    // Agent-initiated from here on. Without a usable zone we can't honour quiet hours: hold, never guess
    // (Intl would silently fall back to the server's zone).
    if (!isValidTimeZone(tz)) return { action: "hold", reason: "unknown_timezone" };
    if (isAsk(msg.kind)) {
      // Founder decision 3: not budgeted. Pause, only-when-asked and quiet hours apply; one open
      // question at a time (an ask sent in the last 72h with no reply blocks the next one).
      if (member.state === "paused") return { action: "hold", reason: "paused" };
      if (member.prefs.onlyWhenAsked || member.unansweredProactive >= 2) return { action: "hold", reason: "only_when_asked" };
      const open = history.some(h => h.memberId === member.id && isAsk(h.kind) && h.at <= now && h.at > now - UNANSWERED_WINDOW && (h.repliedAt === undefined || h.repliedAt > now));
      if (open) return { action: "hold", reason: "one_question" };
      if (inQuietHours(now, tz, member.prefs.quietHours)) {
        const sendAt = quietHoursEnd(now, tz, member.prefs.quietHours);
        if (msg.expiresAt !== undefined && sendAt >= msg.expiresAt) return { action: "drop", reason: "quiet_hours_until_expiry" };
        return { action: "defer", reason: "quiet_hours", sendAt, countsAgainstBudget: false };
      }
      return { action: "send", reason: "ask_not_budgeted", sendAt: now, countsAgainstBudget: false };
    }
    if (!isProactive(msg.kind)) {
      // Inside an accepted opportunity (scheduling, reminder, check-in, relay): never budgeted and never
      // blocked by the unanswered rule, but pause and quiet hours still apply.
      if (member.state === "paused") return { action: "hold", reason: "paused" };
      if (inQuietHours(now, tz, member.prefs.quietHours)) {
        const sendAt = quietHoursEnd(now, tz, member.prefs.quietHours);
        if (msg.expiresAt !== undefined && sendAt >= msg.expiresAt) return { action: "drop", reason: "quiet_hours_until_expiry" };
        return { action: "defer", reason: "quiet_hours", sendAt, countsAgainstBudget: false };
      }
      return { action: "send", reason: "not_proactive", sendAt: now, countsAgainstBudget: false };
    }
    if (member.state === "paused") return { action: "drop", reason: "paused" };
    if (member.state === "receiving" && !msg.supportive) return { action: "hold", reason: "receiving_support_only" };
    if (msg.category && !member.prefs.categoriesOptIn.includes(msg.category)) return { action: "drop", reason: "category_opt_out" };
    const mine = history.filter(m => m.memberId === member.id);
    if (member.prefs.onlyWhenAsked || member.unansweredProactive >= 2 || unansweredStreak(mine, now) >= 2) return { action: "hold", reason: "only_when_asked" };
    const b = BUDGETS[member.state];
    let sendAt = now;
    let reason = "ok";
    if (this.budgetUsed(member, mine, now) >= b.limit) {
      // Audit P2-12: messages already deferred into a later window (history entries with a future
      // `at`) use that window's budget, so several over-budget messages never share one instant.
      sendAt = nextWindowStart(now, tz, b.period);
      for (let i = 0; i < 12; i++) {
        const end = nextWindowStart(sendAt, tz, b.period);
        const queued = new Set(mine.filter(m => isProactive(m.kind) && m.at >= sendAt && m.at < end).map(m => m.id)).size;
        if (queued < b.limit) break;
        sendAt = end;
      }
      reason = "budget_exhausted";
    }
    if (inQuietHours(sendAt, tz, member.prefs.quietHours)) {
      sendAt = quietHoursEnd(sendAt, tz, member.prefs.quietHours);
      if (reason === "ok") reason = "quiet_hours";
    }
    if (msg.expiresAt !== undefined && sendAt >= msg.expiresAt) return { action: "drop", reason: `${reason}_until_expiry` };
    if (sendAt > now) return { action: "defer", reason, sendAt, countsAgainstBudget: true };
    return { action: "send", reason, sendAt, countsAgainstBudget: true };
  }

  /** Priority ordering + bundling: several competing items become one message (one budget unit). */
  bundle(items: OutboundMessage[], max = 3): { primary: OutboundMessage; bundled: OutboundMessage[]; deferred: OutboundMessage[] } | null {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => ((b.priority ?? 0) - (a.priority ?? 0)) || ((a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity)) || (a.id < b.id ? -1 : 1));
    return { primary: sorted[0]!, bundled: sorted.slice(1, max), deferred: sorted.slice(max) };
  }
}

export const _time = { DAY, HOUR };
