/** Canonical scheduled participation on network.members; no second state store. */
import type { ParticipationState } from "@thenetwork/core";
import { NETWORK_STATE_TO_PARTICIPATION, type NetworkMemberState } from "../../plugin-network/src/types.ts";

export interface ParticipationWindow {
  state: NetworkMemberState;
  from: string | null;
  until: string | null;
  note: string | null;
}

export function participationWindow(value: unknown): ParticipationWindow | undefined {
  if (value === null || value === undefined) return undefined;
  const window = value as ParticipationWindow;
  if (typeof window !== "object" || Array.isArray(window) || !Object.hasOwn(NETWORK_STATE_TO_PARTICIPATION, window.state)
    || ![window.from, window.until].every(date => date === null || (typeof date === "string" && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/u.test(date) && Number.isFinite(Date.parse(date))))
    || (window.note !== null && typeof window.note !== "string") || Object.keys(window).length !== 4
    || (window.from !== null && window.until !== null && Date.parse(window.until) <= Date.parse(window.from))) throw new Error("Invalid canonical participation window");
  return {state: window.state, from: window.from === null ? null : new Date(window.from).toISOString(), until: window.until === null ? null : new Date(window.until).toISOString(), note: window.note};
}

export function effectiveParticipation(base: ParticipationState, window: ParticipationWindow | undefined, now: number): ParticipationState {
  return window && (window.from === null || Date.parse(window.from) <= now) && (window.until === null || now < Date.parse(window.until))
    ? NETWORK_STATE_TO_PARTICIPATION[window.state] : base;
}
