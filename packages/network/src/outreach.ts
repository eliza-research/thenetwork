// Outreach and interruption control (PRD 32.9, F28, founder decisions 1-3 of 2026-10-07, attention
// v1.2): the one definition of the budgets, the send timing and the unanswered rules. The
// ConsentNetwork send path, the Blooio queue hook and the tests all read these numbers from here
// (audit P2-13). The send-time functions themselves come from the engine (@thenetwork/engine
// attention.ts): learnSendProfile, inSendWindow, inMemberQuietHours, canInterrupt, canSendLogistics.
import { DAY, HOUR, MINUTE, type ParticipationState } from "@thenetwork/core";
import { DEFAULT_ATTENTION } from "@thenetwork/engine";

export const NY = "America/New_York";

export const OUTREACH = {
  /**
   * Initial invites per participation state (founder defaults D1-D18, shared with the engine:
   * Open 4/7d, Normal 2/7d, Quiet 1/30d, Receiving 2/7d support-only, Paused 0). Founder decision 3:
   * only a member's initial invite to a new opportunity counts (their first probe, including the
   * partner's first probe), once per member and opportunity. Counted at send time over what was sent.
   */
  budget: {
    open: { n: 4, days: 7 }, normal: { n: 2, days: 7 }, quiet: { n: 1, days: 30 }, receiving: { n: 2, days: 7 }, paused: { n: 0, days: 7 },
  } as Record<string, { n: number; days: number }>,
  /** The most initial invites any member can get in a rolling 7 days (the judge's weeklyBudget). */
  maxPerWeek: 4,
  /** An initial invite counts as unanswered after this long without any inbound message. */
  unansweredAfterMs: 72 * HOUR,
  /** At this many unanswered initial invites the member moves to "only when I ask". */
  unansweredLimit: 2,
  /** One re-engagement message is allowed after this much silence (founder default D6)... */
  reengageAfterMs: 30 * DAY,
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
  | "growth" | "reengage" | "cancellation" | "info" | "checkin"
  /** A message one matched member asked the agent to pass to the other (relay.ts): logistics inside a match both said yes to. */
  | "relay";

/** Agent-started asks that are not invites (one-question rule; never on the cap). */
export const ASK_KINDS: ReadonlySet<SendKind> = new Set<SendKind>(["interview", "growth", "checkin"]);
/** Interruptions that wait for the member's send slot (initial invites are added by the send path). */
export const SLOT_KINDS: ReadonlySet<SendKind> = new Set<SendKind>(["interview", "growth", "checkin", "reengage"]);
/** Messages about another member: the recipient must not be a minor or on watch, and no block may stand between them. */
export const ABOUT_OTHERS: ReadonlySet<SendKind> = new Set<SendKind>(["probe", "reveal", "nudge", "scheduling", "reminder", "feedback", "relay"]);
/** Never a direct reply, even when sent while handling the member's message. */
export const NEVER_REPLY: ReadonlySet<SendKind> = new Set<SendKind>(["growth", "reengage", "checkin"]);

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
export function nyParts(t: number) {
  const p = Object.fromEntries(fmt.formatToParts(t).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 + Number(p.minute) / 60, weekday: p.weekday as string };
}

/** Next time (>= t) at local NY hour h on a day accepted by `dayOk`. */
export function nextAt(t: number, h: number, dayOk: (wd: string) => boolean = () => true): number {
  let x = t - (t % (15 * MINUTE)) + 15 * MINUTE;
  for (let i = 0; i < 24 * 4 * 9; i++, x += 15 * MINUTE) {
    const p = nyParts(x);
    if (Math.abs(p.hour - h) < 0.01 && dayOk(p.weekday)) return x;
  }
  return t + DAY;
}

const inWindow = (h: number, [s, e]: [number, number]) => (s === e ? false : s < e ? h >= s && h < e : h >= s || h < e);

/**
 * May a logistics text reach a member with these quiet hours at time t? Quiet hours always win.
 * (Interruptions also need the member's send window: ConsentNetwork.timingOk.)
 */
export function allowedAt(t: number, quietHours: [number, number]): boolean {
  return !inWindow(nyParts(t).hour, quietHours);
}

/**
 * Interruption budget per participation state (PRD 32.9, INV-OUT-01): at most `n` proactive messages
 * in any rolling `days` window. The ConsentNetwork caps every unsolicited send with it, and the
 * simulator's judge (packages/sim/src/judge/metrics.ts) grades runs against it. Receiving is
 * "support-only": the judge cannot see the category, so it allows no proactive message. (Initial
 * invites have their own per-state numbers, OUTREACH.budget above, where Receiving is 2 / 7 days.)
 */
export const PRD_BUDGETS: Record<ParticipationState, { n: number; days: number }> = {
  open: { n: 4, days: 7 }, normal: { n: 2, days: 7 }, quiet: { n: 1, days: 30 }, receiving: { n: 0, days: 7 }, paused: { n: 0, days: 7 },
};
/**
 * Lanes outside the state budget (founder decisions 2026-10-08): plan invites have their own
 * allowance (1 per 7 days), and the opt-in weekly availability check-in is not an interruption
 * (1 per 7 days). A message is in a lane when its meta says so (`lane: "plan"`, `checkIn: true`);
 * each lane is capped here, so a mislabeled message gains at most that lane's allowance. Members
 * whose state budget is 0 (receiving, paused) get nothing in any lane.
 */
export const LANE_BUDGETS: Record<"plan" | "check_in", { n: number; days: number }> = {
  plan: { n: 1, days: 7 }, check_in: { n: 1, days: 7 },
};

/** Text that connects the recipient to other people (an intro, a meetup, a group): the observatory's real source and the simulator's judge read it. */
export const CONNECTION = /\b(intro(duce|duction|s)?|connect (you|him|her|them)|set (you |it )?up|set up (a|an|the)\b|meet (up )?with|meet (him|her|them)|match(ed)? (you )?with|put you in (touch|a group|the group)|group chat|join (him|her|them)|grab (coffee|a coffee|lunch|dinner) with|with (him|her|them) this|mentor|pair you|(see|check|ask) if (anyone|someone|others?|other members?|a few people)( else)? (is |are |would be |wants? to )?(up for|interested|in|free|around|join))\b/i;
