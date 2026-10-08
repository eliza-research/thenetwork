// Trust and safety state per member (PRD 17, 32.14). A risk score accumulates from abuse signals
// and decays with clean time. Levels:
//   ok     - normal
//   watch  - score >= 3: never put into new opportunities (they can still use concierge), 14 days
//   hold   - score >= 6: everything paused, open opportunities involving them cancelled, staff review
// Reports only count against the target when corroborated (two distinct reporters, or a target
// already at risk), so one person can't get someone removed; a member who blocks or reports many
// people in a short time is flagged as a block abuser instead. Inviters are accountable: when
// someone they vouched for reaches hold, the inviter loses invites for 30 days.
import { DAY, type MemberId } from "@thenetwork/core";
import type { Abuse } from "./classify.ts";

export type TrustLevel = "ok" | "watch" | "hold";
export interface TrustEvent { at: number; kind: Abuse | "report_received" | "block_abuse" | "invitee_held" | "decay" | "hold_lifted"; points: number; by?: MemberId }
export interface TrustRecord {
  score: number; level: TrustLevel; events: TrustEvent[]; reportsFrom: Set<MemberId>; blocksMade: number[];
  heldAt?: number; lastDecay?: number;
}

export const WATCH = 3, HOLD = 6;
/** A Trust as plain JSON (exportState). */
export type TrustState = { id: MemberId; score: number; level: TrustLevel; events: TrustEvent[]; reportsFrom: MemberId[]; blocksMade: number[]; heldAt?: number; lastDecay?: number }[];
const DECAY_DAYS = 14;

export class Trust {
  private recs = new Map<MemberId, TrustRecord>();
  /** Fired when a member's level changes (the Network cancels opportunities, tells staff...). */
  onChange?: (id: MemberId, from: TrustLevel, to: TrustLevel, why: string) => void;
  /** Fired for every trust event, before any level change it causes (the Network's safety cases). */
  onEvent?: (id: MemberId, e: TrustEvent) => void;

  get(id: MemberId): TrustRecord {
    let r = this.recs.get(id);
    if (!r) { r = { score: 0, level: "ok", events: [], reportsFrom: new Set(), blocksMade: [] }; this.recs.set(id, r); }
    return r;
  }
  level(id: MemberId): TrustLevel { return this.recs.get(id)?.level ?? "ok"; }
  ok(id: MemberId) { return this.level(id) === "ok"; }
  all() { return this.recs; }
  /** Delete everything held about a member (an under-13 decline keeps nothing), including the reports they made. */
  forget(id: MemberId) {
    this.recs.delete(id);
    for (const r of this.recs.values()) {
      r.reportsFrom.delete(id);
      for (const e of r.events) if (e.by === id) delete e.by;
    }
  }

  /**
   * A person lifted a hold (staff only; holds never decay). The score goes to 0 with a "hold_lifted"
   * event that carries the negative points, so the events still add up to the score.
   */
  lift(id: MemberId, now: number): boolean {
    const r = this.recs.get(id);
    if (!r || r.level !== "hold") return false;
    const e: TrustEvent = { at: now, kind: "hold_lifted", points: -r.score };
    r.events.push(e);
    this.onEvent?.(id, e);
    r.score = 0; r.heldAt = undefined; r.lastDecay = now;
    const prev = r.level;
    r.level = "ok";
    this.onChange?.(id, prev, "ok", "hold_lifted");
    return true;
  }

  /** Plain JSON for the Network's stored state (Sets become arrays). */
  exportState(): TrustState {
    return [...this.recs].map(([id, r]) => ({ id, score: r.score, level: r.level, events: r.events.map(e => ({ ...e })), reportsFrom: [...r.reportsFrom], blocksMade: [...r.blocksMade], heldAt: r.heldAt, lastDecay: r.lastDecay }));
  }
  importState(state: TrustState) {
    this.recs = new Map(state.map(r => [r.id, { score: r.score, level: r.level, events: r.events.map(e => ({ ...e })), reportsFrom: new Set(r.reportsFrom), blocksMade: [...r.blocksMade], heldAt: r.heldAt ?? undefined, lastDecay: r.lastDecay ?? undefined }]));
  }

  add(id: MemberId, now: number, kind: TrustEvent["kind"], points: number, by?: MemberId) {
    const r = this.get(id);
    r.lastDecay ??= now;
    r.score += points;
    const e: TrustEvent = { at: now, kind, points, by };
    r.events.push(e);
    this.onEvent?.(id, e);
    this.relevel(id, now, kind);
  }

  /** A member blocked someone. Many blocks in two weeks = block abuse (flag the blocker). */
  block(from: MemberId, now: number) {
    const r = this.get(from);
    r.blocksMade = [...r.blocksMade.filter(t => now - t < 14 * DAY), now];
    if (r.blocksMade.length === 3) this.add(from, now, "block_abuse", 2);
  }

  /** A report against `target`. Counts only when corroborated or the target is already at risk. */
  report(target: MemberId, by: MemberId, now: number) {
    const r = this.get(target);
    const reporter = this.get(by);
    const reporterCredible = reporter.level === "ok" && reporter.blocksMade.filter(t => now - t < 14 * DAY).length < 3;
    if (!reporterCredible) return; // a serial reporter's reports don't count toward corroboration either
    r.reportsFrom.add(by);
    if (r.reportsFrom.size >= 2 || r.score > 0) this.add(target, now, "report_received", 3, by);
  }

  /** Clean time pays the score down one point per two weeks (never below zero). */
  decay(now: number) {
    for (const [id, r] of this.recs) {
      if (r.lastDecay === undefined) { r.lastDecay = now; continue; }
      const steps = Math.floor((now - r.lastDecay) / (DECAY_DAYS * DAY));
      if (steps <= 0) continue;
      r.lastDecay += steps * DECAY_DAYS * DAY;
      if (r.level === "hold" || r.score <= 0) continue; // holds are lifted by a person, not by time
      r.score = Math.max(0, r.score - steps);
      this.relevel(id, now, "decay");
    }
  }

  private relevel(id: MemberId, now: number, why: string) {
    const r = this.get(id);
    const prev = r.level;
    const next: TrustLevel = r.level === "hold" || r.score >= HOLD ? "hold" : r.score >= WATCH ? "watch" : "ok";
    if (next === prev) return;
    r.level = next;
    if (next === "hold") r.heldAt = now;
    this.onChange?.(id, prev, next, why);
  }
}
