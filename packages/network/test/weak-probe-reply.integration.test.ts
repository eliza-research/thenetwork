import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test.each(["immediate", "unrelated reply", "unrelated open turn", "receipt unresolved"] as const)(
  "a weak acknowledgement only answers the member's current introduction probe (%s)", async scene => {
    // spec/probeReply.md, "A short acknowledgement must immediately follow its own probe"
    const w = new Mini([
      { id: "ari", name: "Ari Chen", age: 33, interests: ["chess"] },
      { id: "mateo", name: "Mateo Barros", age: 34, interests: ["chess"] },
    ], { app: "ntwrk", plans: false, growth: false });
    if (scene === "receipt unresolved") w.net.init({ ...w.ctx(), initialInviteReceipt: () => undefined });
    await w.onboard("ari", "mateo");
    const oppId = w.propose(["ari", "mateo"], { category: "hobby", objective: "play chess over the board" });
    expect(await w.runUntil(() => w.probed("ari"), 3 * DAY)).toBe(true);
    await w.say("ari", "Yes, I'd like to meet.");
    expect(await w.runUntil(() => w.probed("mateo"), 3 * DAY)).toBe(true);

    const afterProbe = w.mark();
    if (scene === "unrelated reply") {
      await w.say("mateo", "Still hoping to meet someone to date. Anything come up? 🙌💯");
      expect(w.to("mateo", afterProbe).some(message => message.meta.type === "info" && !message.meta.proposalId)).toBe(true);
    }
    if (scene === "unrelated open turn") {
      const outcome = await w.net.onInbound({
        id: "unrelated-open-turn", memberId: "mateo", body: "I want to find a cofounder.", ts: w.clock.now(), channel: "sms",
      });
      expect(outcome).toBe("open");
      expect(w.mark()).toBe(afterProbe);
    }
    const revealed = () => w.to("ari", afterProbe).some(message => message.meta.type === "proposal" && message.meta.proposalId === oppId);
    await w.say("mateo", scene === "unrelated reply" ? "Thanks! 👍💯" : "👍");
    if (scene === "immediate") {
      expect(revealed()).toBe(true);
      return;
    }
    expect(revealed()).toBe(false);
    expect(w.probed("mateo")).toBe(true);
    expect(w.log("probe_answer").some(row => row.detail.oppId === oppId && row.detail.memberId === "mateo")).toBe(false);
    await w.say("mateo", "Yes, I'd like to meet for chess.");
    expect(revealed()).toBe(true);
  },
);
