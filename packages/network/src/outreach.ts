// Outreach and interruption control (PRD 32.9, F28, founder decisions 1-3 of 2026-10-07, attention
// v1.2): the one definition of the budgets, the send timing and the unanswered rules. The
// ConsentNetwork send path, the Blooio queue hook and the tests all read these numbers from here
// (audit P2-13). The send-time functions themselves come from the engine (@thenetwork/engine
// attention.ts): learnSendProfile, inSendWindow, inMemberQuietHours, canInterrupt, canSendLogistics.
import {
  availabilityCheckInBudget, DAY, HOUR, initialInviteBudget, MINUTE, planInviteBudget, timeZoneOf, unsolicitedStateBudget,
  withinQuietHours, type OutreachBudget, type ParticipationState,
} from "@thenetwork/core";
import { DEFAULT_ATTENTION } from "@thenetwork/engine";
import { reengagementSilenceMs, unansweredInviteLimit, unansweredInviteWaitMs } from "../../core/src/generated/outreachPolicy.ts";

export const NY = "America/New_York";

export function tzForCity(city: string | undefined): string {
  return city ? timeZoneOf(city) : NY;
}

function toSendBudget({ limit, periodDays }: OutreachBudget): { n: number; days: number } {
  return { n: limit, days: periodDays };
}

export const OUTREACH = {
  /**
   * Initial invites per participation state (founder defaults D1-D18, shared with the engine:
   * Open 4/7d, Normal 2/7d, Quiet 1/30d, Receiving 2/7d support-only, Paused 0). Founder decision 3:
   * only a member's initial invite to a new opportunity counts (their first probe, including the
   * partner's first probe), once per member and opportunity. Counted at send time over what was sent.
   */
  budget: {
    open: toSendBudget(initialInviteBudget("open")),
    normal: toSendBudget(initialInviteBudget("normal")),
    quiet: toSendBudget(initialInviteBudget("quiet")),
    receiving: toSendBudget(initialInviteBudget("receiving")),
    paused: toSendBudget(initialInviteBudget("paused")),
  } as Record<string, { n: number; days: number }>,
  /** The most initial invites any member can get in a rolling 7 days (the judge's weeklyBudget). */
  maxPerWeek: initialInviteBudget("open").limit,
  unansweredAfterMs: unansweredInviteWaitMs,
  unansweredLimit: unansweredInviteLimit,
  /** One re-engagement message is allowed after this much silence (founder default D6)... */
  reengageAfterMs: reengagementSilenceMs,
  /** ...and only when something we're holding for them scored in the top quartile of its engine run (D6). */
  reengageMinQuantile: 0.75,
  /** A standalone acknowledgement ("Thanks, noted") is folded into the next message sent within this window, never sent alone. */
  ackFoldMs: 24 * HOUR,
  /** One-question rule: an ask (profiling, growth, weekly check-in) with no reply blocks the next ask for this long. */
  askOpenMs: 72 * HOUR,
  /** Founder decision 1: the send window after the member's daily slot (12:00 local by default, up to 2 h spread). */
  sendWindowHours: DEFAULT_ATTENTION.sendTime.windowHours,
} as const;

/**
 * What a send is, for the send-time checks:
 *  - reply: a direct answer to the member's own message (sent at once);
 *  - safety: a safety or account notice (sent at once);
 *  - interruptions (SLOT_KINDS, and every initial invite): wait for the member's send window and
 *    their quiet hours;
 *  - everything else is logistics inside something the member already said yes to: it waits only
 *    for the member's quiet hours.
 */
export type SendKind =
  | "reply" | "safety" | "interview" | "probe" | "reveal" | "nudge" | "scheduling" | "reminder" | "feedback"
  | "growth" | "reengage" | "cancellation" | "info" | "checkin" | "invite_notice" | "home_help_consent" | "worthwhile"
  /** A message one matched member asked the agent to pass to the other (relay.ts): logistics inside a match both said yes to. */
  | "relay";

/** Agent-started asks that are not invites (one-question rule). */
export const ASK_KINDS: ReadonlySet<SendKind> = new Set<SendKind>(["interview", "growth", "checkin", "worthwhile"]);
/** Interruptions that wait for the member's send slot (initial invites are added by the send path). */
export const SLOT_KINDS: ReadonlySet<SendKind> = new Set<SendKind>(["interview", "growth", "checkin", "reengage"]);
/** Never a direct reply, even when sent while handling the member's message. */
export const NEVER_REPLY: ReadonlySet<SendKind> = new Set<SendKind>(["growth", "reengage", "checkin", "home_help_consent", "worthwhile"]);

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}
export function localDateParts(t: number, tz: string = NY) {
  let year = "", month = "", day = "", hour = 0, minute = 0, weekday = "";
  for (const part of fmtFor(tz).formatToParts(t)) {
    switch (part.type) {
      case "year": year = part.value; break;
      case "month": month = part.value; break;
      case "day": day = part.value; break;
      case "hour": hour = Number(part.value); break;
      case "minute": minute = Number(part.value); break;
      case "weekday": weekday = part.value; break;
    }
  }
  return { day: `${year}-${month}-${day}`, hour: (hour % 24) + minute / 60, weekday };
}
export function nyParts(t: number) {
  return localDateParts(t, NY);
}

const STEP_15M = 15 * MINUTE;

/** Next time (>= t) at local hour h in timezone `tz` (default NY) on a day accepted by `dayOk`. */
export function nextAt(t: number, h: number, dayOk: (wd: string) => boolean = () => true, tz: string = NY): number {
  const start = Math.ceil(t / STEP_15M) * STEP_15M;
  const end = start + 24 * 4 * 9 * STEP_15M;
  let x = start;
  while (x < end) {
    const p = localDateParts(x, tz);
    if (Math.abs(p.hour - h) < 0.01 && dayOk(p.weekday)) return x;
    const deltaHours = ((h - p.hour) % 24 + 24) % 24;
    if (deltaHours < 0.01) {
      x += 23 * HOUR;
    } else if (deltaHours > 2) {
      x += Math.floor((deltaHours - 1) * 4) * STEP_15M;
    } else {
      x += STEP_15M;
    }
  }
  return t + DAY;
}

/**
 * May a logistics text reach a member with these quiet hours at time t? Quiet hours always win.
 * (Interruptions also need the member's send window: ConsentNetwork.timingOk.)
 */
export function allowedAt(t: number, quietHours: [number, number], tz: string = NY): boolean {
  return !withinQuietHours(localDateParts(t, tz).hour, ...quietHours);
}

/**
 * Interruption budget per participation state (PRD 32.9, INV-OUT-01): at most `n` proactive messages
 * in any rolling `days` window. The ConsentNetwork caps every unsolicited send with it, and the
 * simulator's judge (packages/sim/src/judge/metrics.ts) grades runs against it. Receiving is
 * "support-only": the judge cannot see the category, so it allows no proactive message. (Initial
 * invites have their own per-state numbers, OUTREACH.budget above, where Receiving is 2 / 7 days.)
 */
export const PRD_BUDGETS: Record<ParticipationState, { n: number; days: number }> = {
  open: toSendBudget(unsolicitedStateBudget("open")),
  normal: toSendBudget(unsolicitedStateBudget("normal")),
  quiet: toSendBudget(unsolicitedStateBudget("quiet")),
  receiving: toSendBudget(unsolicitedStateBudget("receiving")),
  paused: toSendBudget(unsolicitedStateBudget("paused")),
};
/**
 * Lanes outside the state budget (founder decisions 2026-10-08): plan invites have their own
 * allowance (1 per 7 days), and the opt-in weekly availability check-in is not an interruption
 * (1 per 7 days). A message is in a lane when its meta says so (`lane: "plan"`, `checkIn: true`);
 * each lane is capped here, so a mislabeled message gains at most that lane's allowance. Members
 * whose state budget is 0 (receiving, paused) get nothing in any lane.
 */
export const LANE_BUDGETS: Record<"plan" | "check_in", { n: number; days: number }> = {
  plan: toSendBudget(planInviteBudget),
  check_in: toSendBudget(availabilityCheckInBudget),
};

/** Text that connects the recipient to other people (an intro, a meetup, a group): the observatory's real source and the simulator's judge read it. */
export const CONNECTION = /\b(intro(duce|duction|s)?|connect (you|him|her|them)|set (you |it )?up|set up (a|an|the)\b|meet (up )?with|meet (him|her|them)|match(ed)? (you )?with|put you in (touch|a group|the group)|group chat|join (him|her|them)|grab (coffee|a coffee|lunch|dinner) with|with (him|her|them) this|mentor|pair you|(see|check|ask) if (anyone|someone|others?|other members?|a few people)( else)? (is |are |would be |wants? to )?(up for|interested|in|free|around|join))\b/i;
