// Without an invite link (the service sets no NetworkContext.invite), an unmet request offers no
// invite and does not wait for a friend's name: a one-word reply afterwards is not read as one.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

describe("no invite link: an unmet request does not wait for a friend's name", () => {
  test("a lone capitalized reply after requestNoneYet is not taken as a friend to invite", async () => {
    const w = new Mini([{ id: "r", name: "Rae Kim", age: 30, area: "Greenpoint", interests: ["climbing"] }], { review: "auto", growth: true });
    await w.onboard("r");
    await w.run(DAY);
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    expect(await w.runUntil(() => w.to("r").some(s => /couldn't find someone/.test(s.body)), 5 * DAY)).toBe(true);
    const none = w.to("r").find(s => /couldn't find someone/.test(s.body))!;
    expect(none.body).not.toMatch(/invite/i);
    expect(w.net.memberList().find(m => m.id === "r")?.awaiting?.kind).not.toBe("growth");
    const from = w.mark();
    await w.say("r", "Bummer");
    expect(w.to("r", from).map(s => s.body).join(" ")).not.toMatch(/nothing went to|invite/i);
  });
});
