// Sim gate for the candidateSlots window fix: the docstring says slots are
// "inside `window` if given", but the old filter was
// `slot.end > o.window.end + A.slotHours * HOUR`. Since
// `slot.end = start + slotHours * HOUR`, that is exactly `start > window.end`,
// so a slot only had to *start* by the window's end. A 19:00-21:00 slot was
// returned for a 17:00-20:00 window, and a slot starting exactly at the window
// end (entirely outside it) also passed. This gate fails before the fix and
// passes after it. It is a sim gate, not a unit test: it runs inside
// `bun run sim --only network` via the network block.
import { candidateSlots } from "../../packages/engine/src/attention.ts";
import { DEFAULT_ATTENTION } from "../../packages/engine/src/config.ts";
import { Block, expect } from "./gate.ts";

// Wednesday 2026-10-07, America/New_York (EDT, UTC-4). `now` is Monday
// 2026-10-05 12:00 EDT, so the Wednesday 19:00 template slot is more than
// minLeadHours (24h) ahead and inside the 7-day horizon.
const NOW = Date.UTC(2026, 9, 5, 16, 0);
const TZ = "America/New_York";
const WIN_START = Date.UTC(2026, 9, 7, 21, 0); // Wed 17:00 EDT
const WIN_END = Date.UTC(2026, 9, 8, 0, 0); // Wed 20:00 EDT

export async function candidateSlotsGate(b: Block): Promise<void> {
  await b.run("engine: candidateSlots never returns a slot ending after the given window", () => {
    const slots = candidateSlots(TZ, NOW, { window: { start: WIN_START, end: WIN_END } }, DEFAULT_ATTENTION);
    expect(slots.filter(s => s.end > WIN_END)).toEqual([]);
    expect(slots.filter(s => s.start < WIN_START)).toEqual([]);
  });

  await b.run("engine: a slot fully inside the window is still returned (control)", () => {
    // Widen the window to 17:00-22:00 EDT so the 19:00-21:00 slot fits inside it.
    const slots = candidateSlots(TZ, NOW, { window: { start: WIN_START, end: WIN_END + 2 * 60 * 60 * 1000 } }, DEFAULT_ATTENTION);
    expect(slots.length).toBe(1);
    expect(slots[0]!.start).toBe(Date.UTC(2026, 9, 7, 23, 0));
    expect(slots[0]!.end).toBe(Date.UTC(2026, 9, 8, 1, 0));
  });

  await b.run("engine: no window given still returns the template slots (control)", () => {
    const slots = candidateSlots(TZ, NOW, {}, DEFAULT_ATTENTION);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.end - s.start).toBe(2 * 60 * 60 * 1000);
  });
}
