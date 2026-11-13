// A cancellation that waits out quiet hours is stored with the deferred sends. If the member who
// cancelled is then removed, forget deletes the opportunity. The other member must still get the
// notice after quiet hours, as long as the meeting has not started. The meeting time is kept on
// the send hook because the opportunity row is gone.
import { describe, expect, test } from "bun:test";
import { fromLocal, HOUR, inQuietHours, localParts } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const NY = "America/New_York";
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

/** The next local hour `h` strictly after `ts`. */
function nextLocalHour(ts: number, h: number): number {
  const p = localParts(ts, NY);
  let end = fromLocal(p.year, p.month, p.day, h, NY);
  if (end <= ts) {
    const n = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    end = fromLocal(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), h, NY);
  }
  return end;
}

describe("a stored cancellation notice", () => {
  test("still goes out after the sender is removed and the process restarts", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(await w.runUntil(() => w.sent.filter(s => s.meta.booked).length >= 2)).toBe(true);
    const at = w.meetings[0]!.at;
    expect(at).toBeGreaterThan(w.clock.now() + 3 * HOUR);
    const hour = localParts(w.clock.now(), NY).hour;
    const quiet: [number, number] = [hour, (hour + 2) % 24];
    w.members.find(m => m.id === "b")!.prefs.quietHours = quiet;
    const from = w.mark();
    await w.say("a", "I need to cancel");
    const notice = copy.dropNotice("Ana", false);
    expect(w.to("a", from).map(s => s.body)).toContain("No worries, thanks for the heads up.");
    expect(w.to("b", from).map(s => s.body)).not.toContain(notice);
    expect(w.log("send_deferred").some(l => l.detail.memberId === "b" && l.detail.kind === "cancellation")).toBe(true);
    w.net.forgetMember("a");
    w.restart();
    const open = nextLocalHour(w.clock.now(), quiet[1]);
    expect(open).toBeLessThan(at);
    expect(inQuietHours(w.clock.now(), NY, quiet)).toBe(true);
    expect(inQuietHours(open, NY, quiet)).toBe(false);
    w.clock.set(open);
    await w.net.tick(w.clock.now());
    expect(w.to("b", from).map(s => s.body)).toContain(notice);
    expect(w.log("send_refused").filter(l => l.detail.kind === "cancellation" && l.t >= open)).toEqual([]);
  });
});
