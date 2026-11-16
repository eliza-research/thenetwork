// A review decision applies only to what the reviewer saw (known gap G6 of the review desk model,
// spec/models/review_desk.md approveMatchesSeenPeople). Two reviewers hold the same item: one re-rolls
// it to other people, then the other approves the version they read. Before the fix the approval named
// only the item id, so it started probes for people no reviewer had approved. The real ConsentNetwork
// and engine on a SimClock (mini.ts), with human review.
import { describe, expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("review revision", () => {
  // spec/reviewDeadline.md, "A decision applies only to the revision the reviewer saw"
  test("an approval of the revision before a re-roll is refused, contacts nobody, and the current revision can still be approved", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")], { review: "human" });
    await w.onboard("a", "b", "c");
    const id = w.propose(["a", "b"], { alternates: ["c"] });
    expect(await w.runUntil(() => w.net.reviewQueue().some(x => x.oppId === id))).toBe(true);
    const seen = w.net.reviewQueue().find(x => x.oppId === id)!;
    expect(seen.revision).toBe(0);
    expect(seen.proposal.participants).toEqual(["a", "b"]);

    // Reviewer 2 re-rolls Ben out with the revision they saw.
    expect(w.net.decide(id, "reroll", { reviewer: "staff-2", swapOut: "b", revision: seen.revision })).toEqual({ ok: true });
    const now = w.net.reviewQueue().find(x => x.oppId === id)!;
    expect(now.proposal.participants).toEqual(["a", "c"]);
    expect(now.revision).toBe(1);

    // Reviewer 1 approves the card they still see (Ana and Ben).
    const from = w.mark();
    expect(w.net.decide(id, "approve", { reviewer: "staff-1", revision: seen.revision })).toEqual({ ok: false, reason: "review_stale" });
    // A stale reject or re-roll changes nothing either.
    expect(w.net.decide(id, "reject", { reviewer: "staff-1", revision: seen.revision })).toEqual({ ok: false, reason: "review_stale" });
    expect(w.log("review_refused").map(l => [l.detail.oppId, l.detail.decision, l.detail.reason]))
      .toEqual([[id, "approve", "review_stale"], [id, "reject", "review_stale"]]);
    await w.run(2 * HOUR);
    for (const p of ["a", "b", "c"]) expect(w.to(p, from)).toEqual([]);
    expect(w.net.reviewQueue().find(x => x.oppId === id)).toMatchObject({ revision: 1, proposal: { participants: ["a", "c"] } });
    expect(w.log("probe_started")).toEqual([]);

    // The current revision is approved and the consent flow starts for the people it names.
    expect(w.net.decide(id, "approve", { reviewer: "staff-1", revision: now.revision })).toEqual({ ok: true });
    expect(w.log("probe_started").map(l => (l.detail.proposal as { participants: string[] }).participants)).toEqual([["a", "c"]]);
  });
});
