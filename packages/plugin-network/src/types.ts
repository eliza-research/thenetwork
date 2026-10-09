/**
 * Network plugin contracts. The plugin owns no state: every read and write goes
 * through a host-injected, app-scoped NetworkStore. The simulator uses memory;
 * the Cloud host must supply the durable membership-bound adapter before activation.
 */
import { isAppId, type AppId } from "../../platform/src/apps.js";
import type { ParticipationState } from "../../core/src/types.js";

export const NETWORK_CONTEXTS = ["network", "social", "settings"] as const;

export const NETWORK_MEMBER_STATES = [
  "open",
  "busy",
  "traveling",
  "paused",
] as const;
export type NetworkMemberState = (typeof NETWORK_MEMBER_STATES)[number];

/**
 * The plugin's member states mapped to the PRD 7.2 participation states in packages/core
 * (audit plugin-prototypes-10: the plugin, core and the connector used different words).
 * busy is "life is full right now" (Quiet). traveling holds intros for a window, so it is Paused
 * with from/until (PRD 16.1 presence windows). open ("back, send intros") is the default, Normal.
 * Stores translate with this table; nothing else may hard-code the mapping.
 */
export const NETWORK_STATE_TO_PARTICIPATION = {
  open: "normal",
  busy: "quiet",
  traveling: "paused",
  paused: "paused",
} as const satisfies Record<NetworkMemberState, ParticipationState>;

export interface NetworkMemberContext extends NetworkMemberScope {
  firstName: string;
  city: string;
  state: NetworkMemberState;
  /** Start of a scheduled state window (e.g. travel next week); null = effective now. */
  stateFrom?: string | null;
  stateUntil: string | null;
  /** Shareable profile facets only; private facets never reach the plugin. */
  facets: string[];
  /** null = the host cannot supply member-safe active items. */
  activeItems: Array<{ kind: string; summary: string }> | null;
}

export interface SetStateInput extends NetworkMemberScope {
  state: NetworkMemberState;
  /** Window start (ISO); null = now. Presence windows: PRD 16.1-16.3, ME-011. */
  from?: string | null;
  until: string | null;
  note: string | null;
  idempotencyKey: string;
}

export interface SetStateExecution {
  /** Null when the request matched the current state and nothing was written. */
  eventId: string | null;
  previous: NetworkMemberState;
  current: NetworkMemberState;
  from?: string | null;
  until: string | null;
  committedAt: Date;
  replayed: boolean;
  /** True when state and until already matched: stores MUST NOT write an event in that case. */
  unchanged: boolean;
}

export type NetworkSignalKind = "opt_out" | "travel" | "safety_concern";

export interface NetworkSignal {
  kind: NetworkSignalKind;
  evidence: string;
}

/**
 * Unseen updates from the single inbox (packages/notify). Reading them marks them seen on every
 * surface, so no text follows for them. Summaries are member-safe lines already leak-checked by
 * the producer.
 */
export interface NetworkUpdatesRead {
  items: Array<{ summary: string }>;
}

export interface NetworkStore {
  getMemberContext(memberId: string, app: AppId): Promise<NetworkMemberContext | null>;
  /** Optional: hosts wired to the single inbox implement it, and GET_UPDATES is registered only then. */
  readUpdates?(memberId: string, app: AppId): Promise<NetworkUpdatesRead>;
  setState(input: SetStateInput): Promise<SetStateExecution>;
  recordSignals(input: NetworkMemberScope & {
    messageId: string;
    signals: NetworkSignal[];
  }): Promise<{ recorded: number }>;
}

/** The context-only capability; supplying it grants no write capability. */
export type NetworkContextStore = Pick<NetworkStore, "getMemberContext">;

/** Hosts expose only the capabilities they actually implement. */
export type NetworkHostStore = NetworkContextStore & Partial<Pick<NetworkStore, "setState" | "recordSignals" | "readUpdates">>;

/** Canonical app membership resolved by the host, never by model output. */
export interface NetworkMemberScope {
  app: AppId;
  memberId: string;
}

/** Host-supplied, trusted turn authority. Never derived from model output. */
export interface NetworkTurnAuthority extends NetworkMemberScope {
  /** The member's IANA time zone; dates in the member's words resolve on their local day. */
  timeZone?: string;
}

/** Reject unscoped JavaScript callers as well as invalid typed host bindings. */
export function assertNetworkMemberScope(scope: NetworkMemberScope): void {
  if (!scope || !isAppId(scope.app) || typeof scope.memberId !== "string" || !scope.memberId.trim()) {
    throw new Error("Network authority requires a canonical app and a nonempty member id");
  }
}

/**
 * Idempotency key for one state change. Scoped by app and member (audit plugin-prototypes-4):
 * a message id or client message id alone can repeat across members, and the store would
 * replay another member's change.
 */
export function setStateIdempotencyKey(authority: NetworkTurnAuthority, origin: string, ordinal: number): string {
  assertNetworkMemberScope(authority);
  return `network:set_state:v2:${authority.app}:${authority.memberId}:${origin}:${ordinal}`;
}
