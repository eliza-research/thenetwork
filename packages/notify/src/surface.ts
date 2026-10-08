// Which surface a person's next notification should point at (entry-flows doc, section 4).
// Order: an explicit choice, then a score per surface, then the plain thread. We cannot detect from
// a web page whether an app is installed, so we never guess silently: a surface whose links went
// unused twice in a row drops out until the member uses it again.

import { isAssistant, type Assistant, type Channel, type Surface } from "./types.ts";

export interface SurfaceSignal {
  surface: Surface;
  /** The member has a live OAuth grant or agent key for this surface (always true for their channel). */
  active: boolean;
  lastUsedAt?: number;
  /** Notifications pointed at this surface that the member acted on (task token redeemed, reply). */
  acted: number;
  /** Notifications pointed at this surface that went unused. */
  ignored: number;
  /** Unused notifications in a row, reset when the member acts on one. */
  ignoredStreak: number;
}

export interface SurfacePrefs {
  /** The member's push channel: iMessage, SMS or Telegram. */
  channel: Channel;
  /** "send my updates to Claude", the onboarding poll, or the web setting. */
  explicit?: Surface;
}

/**
 * thread: put the update itself in the message; the reply is the action.
 * deeplink: one line plus the assistant's own link (iMessage only, where universal links open the app).
 * button_page: one line plus our page with a button per assistant (SMS, or a preference we can't act on directly).
 */
export type Delivery =
  | { mode: "thread"; reason: string }
  | { mode: "deeplink"; assistant: Assistant; reason: string }
  | { mode: "button_page"; assistants: Assistant[]; reason: string };

export const RECENT_MS = 14 * 24 * 3600_000;
export const MAX_IGNORED_STREAK = 2;
const LEAD = 2;
const MIN_SCORE = 3;

export function score(s: SurfaceSignal, now: number): number {
  return s.acted * 3 + (s.lastUsedAt !== undefined && now - s.lastUsedAt <= RECENT_MS ? 2 : 0) + (s.active ? 1 : 0) - s.ignored * 2;
}

const usable = (s: SurfaceSignal) => s.active && s.ignoredStreak < MAX_IGNORED_STREAK;

export function resolveDelivery(prefs: SurfacePrefs, signals: SurfaceSignal[], now: number): Delivery {
  const bySurface = new Map(signals.map(s => [s.surface, s]));
  const assistants = signals.filter(s => isAssistant(s.surface) && usable(s)).map(s => s.surface as Assistant);
  const toAssistant = (a: Assistant, reason: string): Delivery =>
    prefs.channel === "imessage" ? { mode: "deeplink", assistant: a, reason } : { mode: "button_page", assistants: [a, ...assistants.filter(x => x !== a)], reason };

  const explicit = prefs.explicit;
  if (explicit !== undefined) {
    if (!isAssistant(explicit)) return { mode: "thread", reason: "explicit_thread" };
    const sig = bySurface.get(explicit);
    if (sig?.active) {
      // An explicit choice is honoured even after ignored links, but a dead link twice in a row falls back to the thread.
      if (sig.ignoredStreak >= MAX_IGNORED_STREAK) return { mode: "thread", reason: "explicit_link_unused" };
      return toAssistant(explicit, "explicit");
    }
    return { mode: "thread", reason: "explicit_not_connected" };
  }

  const channelSig = bySurface.get(prefs.channel);
  const channelScore = channelSig ? score(channelSig, now) : 0;
  const ranked = assistants
    .map(a => ({ a, s: score(bySurface.get(a)!, now) }))
    .sort((x, y) => y.s - x.s || x.a.localeCompare(y.a));
  const top = ranked[0];
  if (!top) return { mode: "thread", reason: "no_assistant" };
  const runnerUp = Math.max(ranked[1]?.s ?? -Infinity, channelScore);
  if (top.s >= MIN_SCORE && top.s - runnerUp >= LEAD) return toAssistant(top.a, "score");
  return { mode: "thread", reason: "no_clear_leader" };
}
