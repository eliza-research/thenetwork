// The plan allowance after a member writes back (engine-attention-plans-1): two plan invites left
// unanswered past 72 hours pause plan invites, and any later message from the member lifts that
// pause, as it does for intros (heardFrom). The plan lane's two-unanswered check is
// attention.composeMessage over the plan-only ledger; it must see the member's last inbound message
// (Conversation.lastInboundAt), or the allowance stops for good once two invites went unanswered.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const NAMES = ["Ava", "Ben", "Cal", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo"];
const INTERESTS = ["hiking", "running", "books", "photography", "yoga", "cycling", "pickleball", "film"];

describe("the plan allowance after a late reply", () => {
  test("a member who writes back after two unanswered plan invites gets plan invites again", async () => {
    const ids = NAMES.map(n => n.toLowerCase());
    const w = new Mini(ids.map((id, i) => ({ id, name: `${NAMES[i]} Q`, age: 30, area: "Williamsburg", interests: INTERESTS })));
    await w.onboard(...ids);
    const planProbes = (id: string, from = 0) => w.to(id, from).filter(s => s.meta.type === "plan_probe");
    // Two weeks of plan invites nobody answers.
    await w.run(14 * DAY);
    const resumed = ids.filter(id => planProbes(id).length >= 2);
    expect(resumed.length).toBeGreaterThan(0);
    for (const id of resumed) expect(w.net.memberList().find(m => m.id === id)?.onlyWhenAsked).toBe(true);
    // They write back: outreach resumes (the two-unanswered pause is lifted).
    for (const id of resumed) await w.say(id, "Hey, sorry, been busy. Still keen on plans!");
    for (const id of resumed) expect(w.net.memberList().find(m => m.id === id)?.onlyWhenAsked).toBe(false);
    const from = w.mark();
    await w.run(35 * DAY);
    // Each of them is asked to a plan again (their old unanswered invites no longer pause the plan lane).
    expect(resumed.map(id => [id, planProbes(id, from).length > 0])).toEqual(resumed.map(id => [id, true]));
  }, 300_000);
});
