// A pending invitation join notice ("Theo just joined.") rides the inviter's next direct reply. When that
// reply is about an opportunity in which the invitee has a role (participant or alternate) and has not
// said yes, the notice names a member of that opportunity before their yes (the judge's
// name_before_reveal; network block, consent arm seed 2: "Jun just joined." on the reveal of nw-2-223,
// where Jun was an alternate). The notice must wait for a reply that is not about that opportunity.
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("a join notice never rides a reply about an opportunity in which the invitee has not said yes", async () => {
  const w = new Mini([
    { id: "a", name: "Ana Diaz", age: 31, area: "Greenpoint", interests: ["climbing", "hiking", "bouldering"] },
    { id: "r", name: "Rae Kim", age: 30, area: "Greenpoint", interests: ["climbing", "hiking", "bouldering"] },
  ], { growth: true, plans: false });
  w.net.init({ ...w.ctx(), invite: (_inviter, first) => first.toLowerCase() });
  await w.onboard("a", "r");
  await w.say("r", "My friend Theo would love this, can you invite them?");
  await w.run(DAY);
  w.add({ id: "theo", name: "Theo Jones", age: 30, area: "Greenpoint", interests: ["climbing"] });
  w.members.find(member => member.id === "theo")!.invitedBy = "r";
  // Theo joins in Rae's quiet hours: the standalone notice waits for her window, so it is still
  // pending when Rae writes next, in the same minute (after her quiet hours change back).
  const rae = w.members.find(member => member.id === "r")!;
  const quiet = rae.prefs!.quietHours;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(w.clock.now()));
  rae.prefs!.quietHours = [hour, (hour + 22) % 24];
  await w.onboard("theo");
  rae.prefs!.quietHours = quiet;
  expect(w.net.memberList().find(m => m.id === "r")?.pendingInviteJoins?.map(n => n.inviteeId)).toEqual(["theo"]);

  const from = w.mark();
  await w.say("a", "Anyone around who'd want to go climbing this week? I'm near Greenpoint.");
  const opp = [...w.net.opps.values()].find(o => o.participants.includes("a"))!;
  for (let i = 0; i < 4; i++) for (const id of ["a", "r"]) if (w.probed(id)) await w.say(id, "yes");
  expect(opp.participants).toEqual(["a", "r"]);
  expect(opp.alternates).toContain("theo");
  expect(w.meetings.map(m => m.proposalId)).toEqual([opp.id]);
  const aboutOpp = w.to("r", from).filter(s => s.meta.proposalId === opp.id || (s.meta.probe as { key?: string } | undefined)?.key === opp.id);
  expect(aboutOpp.some(s => s.meta.type === "proposal")).toBe(true);
  expect(aboutOpp.filter(s => /Theo/.test(s.body))).toEqual([]);

  await w.say("r", "Thanks!");
  await w.run(DAY);
  const notices = w.to("r", from).filter(s => /Theo just joined/.test(s.body));
  expect(notices).toHaveLength(1);
  expect(notices[0]!.meta).toMatchObject({ invitationJoins: ["theo"] });
  expect(notices[0]!.meta.proposalId).toBeUndefined();
});
