import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

test("a fresh-time retry keeps a current alternate's join notice pending", async () => {
  const climber = (id: string, name: string) => ({
    id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
    wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
  });
  const w = new Mini([climber("a", "Ana Diaz"), climber("theo", "Theo Jones"), climber("r", "Rae Kim")], { plans: false });
  w.members.find(member => member.id === "theo")!.invitedBy = "r";
  await w.onboard("a", "theo", "r");
  const oppId = w.propose(["r", "a"], { alternates: ["theo"] });
  expect(await w.runUntil(() => w.probed("r"))).toBe(true);
  const opp = w.net.opps.get(oppId)!;
  expect(opp.first).toBe("r");
  expect(opp.alternates).toContain("theo");
  const oldTimes = opp.offered?.r?.map(option => option.start) ?? [];
  expect(oldTimes.length).toBeGreaterThan(0);

  const rae = w.members.find(member => member.id === "r")!;
  const quiet = rae.prefs!.quietHours;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(w.clock.now()));
  rae.prefs!.quietHours = [hour, (hour + 22) % 24];
  w.net.welcomeJoined("theo", "r");
  rae.prefs!.quietHours = quiet;
  const pending = () => w.net.memberList().find(member => member.id === "r")?.pendingInviteJoins?.map(notice => notice.inviteeId);
  expect(pending()).toEqual(["theo"]);

  const from = w.mark();
  await w.say("r", "Yes, but none of those work.");
  expect(w.log("probe_answer").at(-1)?.detail).toEqual({ oppId, memberId: "r", yes: true, picked: [] });
  expect(opp.timeRetry).toContain("r");
  const retry = w.to("r", from).find(message => message.body.startsWith("No problem. Would one of these work instead:"));
  expect(retry).toMatchObject({ reply: true, meta: { type: "scheduling" } });
  expect(retry!.meta.proposalId).toBeUndefined();
  expect(retry!.meta.timeOptions?.length).toBeGreaterThan(0);
  expect(retry!.meta.timeOptions?.some(option => oldTimes.includes(option.start))).toBe(false);
  expect(retry!.body).not.toContain("Theo");
  expect(retry!.meta.invitationJoins).toBeUndefined();
  expect(pending()).toEqual(["theo"]);
});
