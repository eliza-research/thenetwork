import { presenceWindowValid, type PresenceWindow } from "./generated/travelPresence.ts";
import type { Presence } from "./types.ts";

/** Decode the two stored bounds before using a temporary city as matching evidence. */
export function temporaryPresenceWindow(presence: Presence): PresenceWindow | undefined {
  const { from, to } = presence;
  if (presence.type !== "temporary" || from === undefined || to === undefined || !Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return;
  const window = { from, to };
  return presenceWindowValid(window) ? window : undefined;
}
