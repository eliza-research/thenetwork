// A data source feeds the observatory: the simulated world (game mode) or Postgres (real mode).
import type {
  ConfigInfo, ControlCommand, ControlResult, MemberDetail, MemberTimeline, Mode, ObsDelta, ObsState, OpportunityDetail, SafetyAction,
  SafetyInfo, SearchHit,
} from "../types.ts";

/**
 * Per-call view options. `reveal`: show this member's PII (an active, audited reveal grant). `truth`:
 * this staff member has the truth lens on (game mode; hidden truth, agent-private facets, the oracle).
 */
export interface ViewOptions { reveal?: boolean; truth?: boolean }

export interface DataSource {
  readonly mode: Mode;
  init(): Promise<void>;
  /** The full state. Hidden truth only with `truth` (one staff member's lens; never in the shared deltas). */
  state(opts?: ViewOptions): ObsState;
  member(id: string, opts?: ViewOptions): Promise<MemberDetail | undefined>;
  /** Messages and what the system did for one member, in time order (gap 6). */
  timeline(id: string, opts?: ViewOptions): Promise<MemberTimeline | undefined>;
  opportunity(id: string, opts?: ViewOptions): Promise<OpportunityDetail | undefined>;
  /** `actor` is the staff user who sent the command (the reviewer of record). */
  control(cmd: ControlCommand, actor?: string): Promise<ControlResult>;
  /** Is this member in an opportunity that waits for review now (a reviewer may open them)? */
  inOpenReview(memberId: string): boolean;
  safety(): Promise<SafetyInfo>;
  safetyAction(a: SafetyAction, actor: string): Promise<ControlResult>;
  config(): Promise<ConfigInfo>;
  /** Outbound agent messages and system events only; never what a member wrote (gap 18). */
  search(q: string, limit?: number): Promise<SearchHit[]>;
  /** Deltas pushed as the source changes (about 4 per second while anything changes). */
  subscribe(fn: (d: ObsDelta) => void): () => void;
  dispose(): Promise<void>;
}

export class Listeners<T> {
  private fns = new Set<(x: T) => void>();
  add(fn: (x: T) => void) { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  emit(x: T) { for (const fn of this.fns) { try { fn(x); } catch { /* a broken listener must not stop the source */ } } }
  get size() { return this.fns.size; }
}

/** A search query as a case-blind literal (no regex syntax from the caller). */
export function searchPattern(q: string): RegExp {
  return new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/** A short piece of text around the first match. */
export function snippet(text: string, re: RegExp, width = 60): string {
  const m = re.exec(text);
  if (!m) return text.slice(0, width * 2);
  const a = Math.max(0, m.index - width), b = Math.min(text.length, m.index + m[0].length + width);
  return `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
}

/** Why a review decision was refused or stopped (the Network's reason codes), for staff. */
export const REVIEW_BLOCK_ERRORS: Record<string, string> = {
  not_in_review: "that opportunity is not waiting for review",
  note_required: "reason \"other\" needs a note",
  participant_minor: "a participant is under 18: members under 18 are never introduced to anyone",
  participant_declined: "a participant was declined at join (under 13)",
  matching_paused: "proactive matching is off: approvals wait until an admin turns it back on",
  nothing_to_edit: "an edit needs a new explanation or objective",
  not_a_participant: "an explanation can only be edited for a participant",
  edit_leak: "the edited text would leak a private fact or contact details",
  cannot_swap: "that member cannot be swapped out",
  unknown_decision: "decision must be approve, reject, edit or reroll",
  busy_elsewhere: "approved, but a participant is now busy in another opportunity: nothing was sent",
  held: "approved, but a participant is now on safety hold: nothing was sent",
  on_watch: "approved, but a participant is now on watch: nothing was sent",
  opted_out: "approved, but a participant opted out: nothing was sent",
  blocked_pair: "approved, but two participants now block each other: nothing was sent",
  unknown_member: "approved, but a participant is unknown: nothing was sent",
};
/** Why a safety action was refused. */
export const SAFETY_ERRORS: Record<string, string> = {
  not_on_hold: "that member is not on hold", unknown_case: "no such case", already_closed: "that case is already closed",
  actor_required: "a staff name is required", unknown_action: "action must be lift or close",
};
