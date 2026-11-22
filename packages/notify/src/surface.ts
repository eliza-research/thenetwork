// Which surface a person's next notification should point at (entry-flows doc, section 4).
// Order: an explicit choice, then a score per surface, then the plain thread. We cannot detect from
// a web page whether an app is installed, so we never guess silently: a surface whose links went
// unused twice in a row drops out until the member uses it again.

import { updateDeliveryFor, type Channel as UpdateChannel } from "../../core/src/generated/agentEntry.ts";
import { deliverySurfaceScore, maxIgnoredStreak, surfaceHasClearLead, surfaceIsUsable, surfaceRecentMs } from "../../core/src/generated/notificationDelivery.ts";
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
  /** Unused notifications in a row, reset when the member acts on one or uses the surface again. */
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

export const RECENT_MS = surfaceRecentMs;
export const MAX_IGNORED_STREAK = maxIgnoredStreak;

export function score(s: SurfaceSignal, now: number): number {
  return deliverySurfaceScore(s.acted, s.ignored, s.lastUsedAt !== undefined && now - s.lastUsedAt <= RECENT_MS, s.active);
}

const usable = (s: SurfaceSignal) => surfaceIsUsable(s.active, s.ignoredStreak);

const UPDATE_CHANNEL = { imessage: "IMessage", sms: "Sms", telegram: "Telegram" } as const satisfies Record<Channel, UpdateChannel>;

export function resolveDelivery(prefs: SurfacePrefs, signals: SurfaceSignal[], now: number): Delivery {
  const bySurface = new Map(signals.map(s => [s.surface, s]));
  const assistants = signals.filter(s => isAssistant(s.surface) && usable(s)).map(s => s.surface as Assistant);
  const deliver = (reason: string, assistant?: Assistant): Delivery => {
    const mode = updateDeliveryFor(UPDATE_CHANNEL[prefs.channel], assistant !== undefined);
    if (mode === "InThread" || assistant === undefined) return { mode: "thread", reason };
    return mode === "AssistantLink" ? { mode: "deeplink", assistant, reason }
      : { mode: "button_page", assistants: [assistant, ...assistants.filter(x => x !== assistant)], reason };
  };

  const explicit = prefs.explicit;
  if (explicit !== undefined) {
    if (!isAssistant(explicit)) return deliver("explicit_thread");
    const sig = bySurface.get(explicit);
    if (!sig?.active) return deliver("explicit_not_connected");
    return sig.ignoredStreak >= MAX_IGNORED_STREAK ? deliver("explicit_link_unused") : deliver("explicit", explicit);
  }

  const channelSig = bySurface.get(prefs.channel);
  const channelScore = channelSig ? score(channelSig, now) : 0;
  const ranked = assistants
    .map(a => ({ a, s: score(bySurface.get(a)!, now) }))
    .sort((x, y) => y.s - x.s || x.a.localeCompare(y.a));
  const top = ranked[0];
  if (!top) return deliver("no_assistant");
  const runnerUp = Math.max(ranked[1]?.s ?? -Infinity, channelScore);
  return surfaceHasClearLead(top.s, runnerUp) ? deliver("score", top.a) : deliver("no_clear_leader");
}
