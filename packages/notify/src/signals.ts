// Per-surface signals that feed resolveDelivery: what the member actually acts on.
// A delivery that pointed at a surface is "acted" when its task token is redeemed or the member
// replies in the thread, and "ignored" when the outcome window passes with neither.

import type { SurfaceSignal } from "./surface.ts";
import type { Surface } from "./types.ts";

export const OUTCOME_WINDOW_MS = 72 * 3600_000;

interface PendingOutcome { personId: string; deliveryId: string; target: Surface; sentAt: number }

export class MemorySignals {
  private readonly signals = new Map<string, Map<Surface, SurfaceSignal>>();
  private readonly pending = new Map<string, PendingOutcome>();

  private sig(personId: string, surface: Surface): SurfaceSignal {
    let m = this.signals.get(personId);
    if (!m) this.signals.set(personId, (m = new Map()));
    let s = m.get(surface);
    if (!s) m.set(surface, (s = { surface, active: false, acted: 0, ignored: 0, ignoredStreak: 0 }));
    return s;
  }

  /** A grant or key was issued (true) or revoked (false). The member's channel is always active. */
  setActive(personId: string, surface: Surface, active: boolean) {
    this.sig(personId, surface).active = active;
  }

  /** Any use of a surface: a tool call from an assistant, a message in the thread. */
  used(personId: string, surface: Surface, now: number) {
    this.sig(personId, surface).lastUsedAt = now;
  }

  sent(personId: string, deliveryId: string, target: Surface, now: number) {
    this.pending.set(deliveryId, { personId, deliveryId, target, sentAt: now });
  }

  /** The member acted on a delivery (token redeemed, or a reply in the thread). */
  acted(deliveryId: string, on: Surface, now: number) {
    const p = this.pending.get(deliveryId);
    if (!p) return;
    this.pending.delete(deliveryId);
    const s = this.sig(p.personId, on);
    s.acted++;
    s.ignoredStreak = 0;
    s.lastUsedAt = now;
  }

  /** Close deliveries whose outcome window passed with no action. */
  sweep(now: number) {
    for (const [id, p] of this.pending) {
      if (now - p.sentAt < OUTCOME_WINDOW_MS) continue;
      this.pending.delete(id);
      const s = this.sig(p.personId, p.target);
      s.ignored++;
      s.ignoredStreak++;
    }
  }

  list(personId: string): SurfaceSignal[] {
    return [...(this.signals.get(personId)?.values() ?? [])].map(s => ({ ...s }));
  }
}
