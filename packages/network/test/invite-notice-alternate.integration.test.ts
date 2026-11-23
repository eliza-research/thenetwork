// A pending invitation join notice ("Theo just joined.") rides the inviter's next direct reply. When that
// reply is about an opportunity in which the invitee has a role (participant or alternate) and has not
// said yes, the notice names a member of that opportunity before their yes (the judge's
// name_before_reveal; network block, consent arm seed 2: "Jun just joined." on the reveal of nw-2-223,
// where Jun was an alternate). The notice must wait for a reply that is not about that opportunity.
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string) => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

test.each([
  { scene: "for the current invitee", namesake: false, clarification: undefined },
  { scene: "for the current namesake", namesake: true, clarification: undefined },
  { scene: "through a general clarification", namesake: false, clarification: "general" },
  { scene: "through a time clarification", namesake: false, clarification: "time" },
] as const)("a join notice waits $scene", async ({ namesake, clarification }) => {
  const w = new Mini([
    { id: "a", name: "Ana Diaz", age: 31, area: "Greenpoint", interests: ["climbing", "hiking", "bouldering"] },
    { id: "r", name: "Rae Kim", age: 30, area: "Greenpoint", interests: ["climbing", "hiking", "bouldering"], skills: ["climbing_belay"] },
  ], { growth: true, plans: false });
  w.net.init({ ...w.ctx(), invite: (_inviter, first) => first.toLowerCase() });
  await w.onboard("a", "r");
  await w.say("r", "My friend Theo would love this, can you invite them?");
  await w.run(DAY);
  if (namesake) {
    w.add({ id: "unconfirmed", name: "Theo Hall", age: 31, area: "Greenpoint", interests: ["climbing"] });
    await w.onboard("unconfirmed");
  }
  w.add({ id: "theo", name: "Theo Jones", age: 30, area: "Greenpoint", interests: namesake ? ["jazz"] : ["climbing"] });
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
  expect(opp.stage).toBe("review");
  const [work] = w.net.judgePackets().work.filter(x => x.packet.oppId === opp.id);
  expect(w.net.recordJudgment(simulatedReviewJudge({ exceptions: false })(work!.packet)!)).toEqual({ ok: true });
  expect(opp.review).toMatchObject({ decision: "approve", approver: "judge" });
  if (clarification) {
    if (w.probed("a")) await w.say("a", "yes");
    expect(w.probed("r")).toBe(true);
    const offered = opp.offered?.r ?? [];
    expect(offered.length).toBeGreaterThan(0);
    const unoffered = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      .find(day => offered.every(slot => !slot.label.startsWith(day)));
    expect(unoffered).toBeDefined();
    const question = clarification === "general"
      ? "Just to check: is that a yes or a no? Either is fine."
      : "Which of the offered times work for you? Reply with the letters or the times.";
    const beforeQuestion = w.mark();
    await w.say("r", clarification === "general" ? "Maybe." : `${unoffered} works.`);
    const asked = w.to("r", beforeQuestion).find(sent => sent.meta.type === "question");
    expect(asked).toMatchObject({ body: question, meta: { proposalId: opp.id } });
    expect(w.meetings).toHaveLength(0);
    expect(w.net.memberList().find(m => m.id === "r")?.pendingInviteJoins?.map(notice => notice.inviteeId)).toEqual(["theo"]);
    await w.say("r", clarification === "general" ? "yes" : `${offered[0]!.label} works.`);
  } else {
    for (let i = 0; i < 4; i++) for (const id of ["a", "r"]) if (w.probed(id)) await w.say(id, "yes");
  }
  expect(opp.participants).toEqual(["a", "r"]);
  expect(opp.alternates).toContain(namesake ? "unconfirmed" : "theo");
  if (namesake) expect(opp.alternates).not.toContain("theo");
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

test("a declined invitee's join notice waits past the replacement's booking reply", async () => {
  const w = new Mini([climber("a", "Ana Diaz"), climber("theo", "Theo Jones"), climber("r", "Rae Kim")], { plans: false });
  const theo = w.members.find(member => member.id === "theo")!;
  theo.invitedBy = "r";
  await w.onboard("a", "theo", "r");
  const oppId = w.propose(["a", "theo"], { alternates: ["r"] });
  expect(await w.runUntil(() => w.probed("a"))).toBe(true);
  await w.say("a", "Yes.");
  expect(await w.runUntil(() => w.probed("theo"))).toBe(true);
  await w.say("theo", "I'll pass for now.");
  expect(w.log("probe_answer").map(entry => entry.detail)).toContainEqual(expect.objectContaining({ oppId, memberId: "theo", yes: false }));
  expect(await w.runUntil(() => w.probed("r"))).toBe(true);
  const opportunity = w.net.opps.get(oppId)!;
  expect(opportunity.participants).toEqual(["a", "r"]);
  expect(opportunity.alternates).not.toContain("theo");
  expect(opportunity.contacted.has("theo")).toBe(true);
  expect(opportunity.offered?.r?.[0]?.key).toBe("a");

  const rae = w.members.find(member => member.id === "r")!;
  const quiet = rae.prefs!.quietHours;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(w.clock.now()));
  rae.prefs!.quietHours = [hour, (hour + 22) % 24];
  w.net.welcomeJoined("theo", "r");
  rae.prefs!.quietHours = quiet;
  const pendingNames = () => w.net.memberList().find(member => member.id === "r")?.pendingInviteJoins?.map(notice => notice.inviteeId);
  expect(pendingNames()).toEqual(["theo"]);
  const from = w.mark();
  await w.say("r", "Option a works.");
  expect(w.meetings).toEqual([expect.objectContaining({ proposalId: oppId, participants: ["a", "r"], at: opportunity.offered!.r![0]!.start })]);
  const booking = w.to("r", from).find(message => message.meta.proposalId === oppId && message.meta.booked);
  expect(booking).toMatchObject({ reply: true, body: expect.stringContaining("Ana") });
  expect(booking!.body).not.toContain("Theo");
  expect(booking!.meta.invitationJoins).toBeUndefined();
  expect(pendingNames()).toEqual(["theo"]);

  await w.say("r", "Anything fun near Greenpoint this weekend?");
  const notices = w.to("r", from).filter(message => message.meta.invitationJoins?.includes("theo"));
  expect(notices).toEqual([expect.objectContaining({
    reply: true, body: expect.stringContaining("Theo just joined."),
    meta: expect.objectContaining({ invitationJoins: ["theo"] }),
  })]);
  expect(notices[0]!.meta.proposalId).toBeUndefined();
  expect(pendingNames()).toEqual([]);
});

test("a fresh-time retry keeps a current alternate's join notice pending", async () => {
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
