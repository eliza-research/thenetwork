// A data source feeds the observatory: the simulated world (game mode) or Postgres (real mode).
import type { ControlCommand, ControlResult, MemberDetail, Mode, ObsDelta, ObsState, OpportunityDetail } from "../types.ts";

export interface DataSource {
  readonly mode: Mode;
  init(): Promise<void>;
  state(): ObsState;
  member(id: string): Promise<MemberDetail | undefined>;
  opportunity(id: string): Promise<OpportunityDetail | undefined>;
  control(cmd: ControlCommand): Promise<ControlResult>;
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
