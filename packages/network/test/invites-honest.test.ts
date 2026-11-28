// Without an invite link (the service sets no NetworkContext.invite), an unmet request offers no
// invite and does not wait for a friend's name: a one-word reply afterwards is not read as one.
import { describe, expect, test } from "vitest";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { inviteVouchEvidence, memberInvitationLink, type MemberInviteRequest } from "../src/invitation.ts";
import { Mini } from "./mini.ts";

describe("no invite link: an unmet request does not wait for a friend's name", () => {
  test("a lone capitalized reply after requestNoneYet is not taken as a friend to invite", async () => {
    const w = new Mini([{ id: "r", name: "Rae Kim", age: 30, area: "Greenpoint", interests: ["climbing"] }], { growth: true });
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

test("a withheld join receipt rides the next real reply once, after restart and a fresh consent check", async () => {
  const w = new Mini([{ id: "r", name: "Rae Kim", age: 30, area: "Greenpoint" }], { growth: true });
  w.net.init({ ...w.ctx(), invite: (_inviter, first) => first.toLowerCase() });
  await w.onboard("r");
  await w.say("r", "My friend Maya would love this, can you invite them?");
  await w.say("r", "My friend Theo would love this, can you invite them?");
  await w.say("r", "My friend Priya would love this, can you invite them?");
  await w.run(3 * DAY);
  for (const [id, name] of [["maya", "Maya Lee"], ["theo", "Theo Jones"], ["priya", "Priya Hall"]] as const) {
    w.add({ id, name, age: 30 });
    w.members.find(member => member.id === id)!.invitedBy = "r";
    await w.say(id, "Hi, I'm joining!");
  }
  expect(w.logs.filter(log => log.kind === "send_refused" && log.detail.kind === "invite_notice"
    && log.detail.reason === "conversation_streak")).toHaveLength(2);
  const beforeReply = w.mark();
  expect(w.to("r").filter(message => /just joined/.test(message.body))).toEqual([
    expect.objectContaining({ body: expect.stringContaining("Maya just joined."), meta: expect.objectContaining({ invitationJoins: ["maya"] }) }),
  ]);

  w.restart();
  await w.net.onInbound({ id: "stop-priya", memberId: "priya", body: "STOP", channel: "sms", ts: w.clock.now(), keyword: "STOP" });
  await w.say("r", "Anything fun near Williamsburg this weekend?");
  const receipts = () => w.to("r", beforeReply).filter(message => /just joined/.test(message.body));
  expect(receipts()).toHaveLength(1);
  expect(receipts()[0]).toMatchObject({ reply: true, meta: { invitationJoins: ["theo"] } });
  expect(receipts()[0]!.body).toContain("Theo just joined.");
  expect(receipts()[0]!.body).not.toMatch(/Maya|Priya/);
  await w.say("r", "Anything fun near Williamsburg tonight?");
  expect(receipts()).toHaveLength(1);
});

// spec/outreachPolicy.md, "An eligible join receipt can ride on a current reply": the receipt
// stays pending until it goes out or goes stale, so a paused inviter still hears on a reply.
test("a join receipt survives the inviter's paused account and rides a reply", async () => {
  const w = new Mini([{ id: "r", name: "Rae Kim", age: 30, area: "Greenpoint" }], { growth: true });
  w.net.init({ ...w.ctx(), invite: (_inviter, first) => first.toLowerCase() });
  await w.onboard("r");
  w.add({ id: "maya", name: "Maya Lee", age: 30 });
  w.members.find(member => member.id === "maya")!.invitedBy = "r";
  const rae = w.members.find(member => member.id === "r")!;
  const quiet = rae.prefs!.quietHours;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(w.clock.now()));
  rae.prefs!.quietHours = [hour, (hour + 22) % 24];
  expect(w.net.welcomeJoined("maya", "r")).toBe(true);
  rae.prefs!.quietHours = quiet;
  expect(w.net.memberList().find(m => m.id === "r")?.pendingInviteJoins?.map(n => n.inviteeId)).toEqual(["maya"]);
  const from = w.mark();
  Object.assign(rae, { accountStatus: "paused" });
  await w.say("r", "Anything fun near Williamsburg this weekend?");
  expect(w.to("r", from).filter(message => /Maya just joined/.test(message.body))).toEqual([
    expect.objectContaining({ reply: true, body: expect.stringContaining("Maya just joined.") }),
  ]);
  await w.say("r", "Anything fun near Williamsburg tonight?");
  expect(w.to("r", from).filter(message => /Maya just joined/.test(message.body))).toHaveLength(1);
});

// spec/memberInvitation.md, "Forward an invitation for someone I know".
test("only a direct adult vouch gets an app-owned link and a new verified acceptance can tell its inviter", async () => {
  const token = "A".repeat(43);
  const link = memberInvitationLink({ id: "ntwrk", domain: "ntwrk.party" }, token);
  const requests: MemberInviteRequest[] = [];
  const w = new Mini([
    { id: "rae", name: "Rae Kim", age: 30 },
    { id: "minor", name: "Pia Lee", age: 17 },
  ], {
    memberInviteTurnAllowed: (_id, messageId) => messageId !== "unsigned",
    issueMemberInvite: request => {
      requests.push(request);
      return { status: "issued", url: request.firstName === "Eli" ? link : "https://example.org/join" };
    },
  });
  const ctx = w.ctx();
  const noticeKeys: string[] = [];
  w.net.init({ ...ctx, send: (id, body, opts) => {
    if (opts?.meta?.invitationJoins) noticeKeys.push(opts.idempotencyKey ?? "");
    return ctx.send(id, body, opts);
  } });
  await w.onboard("rae", "minor");
  await w.say("rae", "Don't invite my friend Eli.");
  await w.say("rae", "My friend Eli would love this.");
  await w.say("minor", "Invite my friend Eli");
  await w.net.onInbound({ id: "profile", memberId: "rae", body: "Invite my friend Eli", channel: "sms", ts: w.clock.now(), source: "mcp" });
  await w.net.onInbound({ id: "unsigned", memberId: "rae", body: "Invite my friend Eli", channel: "sms", ts: w.clock.now() });
  expect(requests).toHaveLength(0);

  const start = w.mark();
  await w.say("rae", "Invite my friend Zoe");
  await w.say("rae", "2 years, well");
  await w.say("rae", "CONFIRM INVITE");
  expect(w.sent.slice(start).some(message => /https:\/\//.test(message.body))).toBe(false);
  expect(w.net.counters.invitesSent).toBe(0);
  await w.say("rae", "I'd like to invite my cousin Eli.");
  await w.say("rae", "CONFIRM INVITE");
  expect(requests).toHaveLength(1);
  await w.say("rae", "two years, well");
  await w.say("rae", "yes");
  expect(requests).toHaveLength(1);
  await w.say("rae", "CONFIRM INVITE");
  expect(requests.at(-1)).toMatchObject({ inviterId: "rae", firstName: "Eli", relationship: "family", durationMonths: 24, depth: "well", disposition: "issue", reviewReasons: [] });
  expect(requests.at(-1)!.requestId).not.toBe(requests.at(-1)!.messageId);
  expect(w.sent.slice(start).filter(message => message.body.includes(link))).toEqual([
    expect.objectContaining({ to: "rae", reply: true, meta: expect.objectContaining({ approvedInviteLink: link }) }),
  ]);
  expect(JSON.stringify(w.net.exportState())).not.toContain(token);

  w.add({ id: "eli", name: "Eli Reed", age: 28 });
  w.members.find(member => member.id === "eli")!.invitedBy = "rae";
  expect(w.net.welcomeJoined("eli", "rae")).toBe(true);
  expect(w.net.welcomeJoined("eli", "rae")).toBe(false);
  expect(w.to("rae").filter(message => message.body.includes("Eli just joined."))).toHaveLength(1);
  expect(noticeKeys).toEqual([expect.stringMatching(/^invite-notice:rae:/)]);
});

test("confirmed weak, unusual or clustered vouches wait for review without storing the invitation conversation", async () => {
  const attempts: MemberInviteRequest[] = [], privateTurns: string[] = [];
  const reviewId = `mir_${"a".repeat(32)}`;
  const w = new Mini([{ id: "rae", name: "Rae Kim", age: 30 }], {
    memberInviteTurnAllowed: () => true,
    onPrivateInviteTurn: (_id, messageId) => { privateTurns.push(messageId); },
    issueMemberInvite: request => {
      attempts.push(request);
      return request.disposition === "review" ? { status: "review", reviewId }
        : { status: "issued", url: memberInvitationLink({ id: "ntwrk", domain: "ntwrk.party" }, "A".repeat(43)) };
    },
  });
  await w.onboard("rae");
  await w.say("rae", "Invite my friend Colin");
  await w.say("rae", "2 years, well");
  await w.run(15 * MINUTE);
  await w.say("rae", "CONFIRM INVITE");
  expect(attempts).toHaveLength(0);

  for (const [name, evidence] of [["Luz", "2 years, well"], ["Inez", "3 weeks, met once. We met online."], ["Sol", "1 year, well"]]) {
    await w.say("rae", `Invite my friend ${name}`);
    await w.say("rae", evidence!);
    await w.say("rae", "CONFIRM INVITE");
  }
  expect(attempts.map(({ disposition, reviewReasons }) => ({ disposition, reviewReasons }))).toEqual([
    { disposition: "issue", reviewReasons: [] },
    { disposition: "review", reviewReasons: ["weak_vouch", "risk_language"] },
    { disposition: "review", reviewReasons: ["burst"] },
  ]);
  expect(w.sent.filter(message => message.body.includes(reviewId))).toHaveLength(2);
  expect(privateTurns).toHaveLength(12);
  expect(JSON.stringify(w.net.exportState())).not.toMatch(/met online|Inez|Sol|mir_/);
});

test("a verified cross-city notice leaves the invitee out of this Network and redacts the saved reply", async () => {
  const w = new Mini([{ id: "rae", name: "Rae Kim", age: 30 }]);
  w.net.init({ ...w.ctx(), verifiedJoinedInviteeName: (inviter, invitee) => inviter === "rae" && invitee === "foreign" ? "Orla" : undefined });
  await w.onboard("rae");
  w.net.announceVerifiedInviteJoin("rae", "foreign", w.clock.now());
  w.net.announceVerifiedInviteJoin("rae", "foreign", w.clock.now());
  const notices = w.to("rae").filter(message => message.meta.invitationJoins);
  expect(notices).toEqual([expect.objectContaining({ body: expect.stringContaining("Orla just joined."), meta: expect.objectContaining({ invitationJoins: ["foreign"] }) })]);
  expect(w.net.memberList().some(member => member.id === "foreign")).toBe(false);
  expect(JSON.stringify(w.net.exportState())).not.toContain("Orla");
});

test("single-meeting vouches with intervening or past-time detail hold for weak_vouch review while recurring schedules and negated closeness classify accurately", async () => {
  const attempts: MemberInviteRequest[] = [];
  const reviewId = `mir_${"b".repeat(32)}`;
  const w = new Mini([{ id: "rae", name: "Rae Kim", age: 30 }], {
    memberInviteTurnAllowed: () => true,
    issueMemberInvite: request => {
      attempts.push(request);
      return request.disposition === "review" ? { status: "review", reviewId }
        : { status: "issued", url: memberInvitationLink({ id: "ntwrk", domain: "ntwrk.party" }, "B".repeat(43)) };
    },
  });
  await w.onboard("rae");
  for (const [name, evidence] of [
    ["Maya", "2 months, met at a party once and got along well"],
    ["Liam", "6 months, met him once a while back, we got along well"],
    ["Cleo", "6 months, met her once a few months ago at a party, got along well"],
    ["Owen", "1 year, met him once a year ago at a wedding, know him well enough"],
    ["Zara", "6 months, met once a couple of months ago, seemed close to my friends"],
    ["Kai", "2 years, met him once a year or so ago, know him well"],
    ["Jude", "2 years, met her once a month back at a gig, got along well"],
    ["Milo", "2 years, met him once a year back in 2023, know him well"],
    ["Vera", "2 years, met her once a month earlier, know her well"],
    ["Theo", "6 months, I don't know him well yet"],
    ["Nia", "2 years, close friends who met once a week"],
  ]) {
    await w.say("rae", `Invite my friend ${name}`);
    await w.say("rae", evidence!);
    await w.say("rae", "CONFIRM INVITE");
    await w.run(31 * DAY);
  }
  expect(attempts.map(({ firstName, durationMonths, depth, disposition, reviewReasons }) => ({
    firstName, durationMonths, depth, disposition, reviewReasons,
  }))).toEqual([
    { firstName: "Maya", durationMonths: 2, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Liam", durationMonths: 6, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Cleo", durationMonths: 6, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Owen", durationMonths: 12, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Zara", durationMonths: 6, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Kai", durationMonths: 24, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Jude", durationMonths: 24, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Milo", durationMonths: 24, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Vera", durationMonths: 24, depth: "met_once", disposition: "review", reviewReasons: ["weak_vouch"] },
    { firstName: "Theo", durationMonths: 6, depth: "somewhat", disposition: "issue", reviewReasons: [] },
    { firstName: "Nia", durationMonths: 24, depth: "well", disposition: "issue", reviewReasons: [] },
  ]);
  expect(inviteVouchEvidence("8 months, not met once, we work together well")).toEqual({ durationMonths: 8, depth: "well" });
  expect(inviteVouchEvidence("8 months, not just met once, we're close")).toEqual({ durationMonths: 8, depth: "well" });
  expect(inviteVouchEvidence("8 months, not only met once, we're close")).toEqual({ durationMonths: 8, depth: "well" });
  expect(inviteVouchEvidence("1 year, met more than once, very close")).toEqual({ durationMonths: 12, depth: "well" });
  expect(inviteVouchEvidence("1 year, spoken once per week, know her well")).toEqual({ durationMonths: 12, depth: "well" });
  expect(inviteVouchEvidence("1 year, hung out once every month, close friends")).toEqual({ durationMonths: 12, depth: "well" });
  expect(inviteVouchEvidence("2 years, hung out once every two weeks, close friends")).toEqual({ durationMonths: 24, depth: "well" });
  expect(inviteVouchEvidence("3 years, met once a year at our reunion, close friends")).toEqual({ durationMonths: 36, depth: "well" });
  expect(inviteVouchEvidence("3 years, met once a week back in college, close friends")).toEqual({ durationMonths: 36, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met him once a year back in 2023, know him well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met her once a month earlier, know her well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met her once a month before, know her well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met him once a week prior, know him well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met him once a month previously, know him well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met at one time or another, close friends")).toEqual({ durationMonths: 24, depth: "well" });
  expect(inviteVouchEvidence("6 months, hung out once or twice, know him well")).toEqual({ durationMonths: 6, depth: "well" });
  expect(inviteVouchEvidence("3 months, only talked to her at work, know her well")).toEqual({ durationMonths: 3, depth: "well" });
  expect(inviteVouchEvidence("2 years, met him once a month or two ago, we got along well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met her once a year and a half ago, close with my sister")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met him once a year back, get along well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met him a single time at a meetup, seemed well spoken")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("2 years, met her one time last spring, got along well")).toEqual({ durationMonths: 24, depth: "met_once" });
  expect(inviteVouchEvidence("4 months, not close friends yet")).toEqual({ durationMonths: 4, depth: "somewhat" });
  expect(inviteVouchEvidence("4 months, not that close yet")).toEqual({ durationMonths: 4, depth: "somewhat" });
  expect(inviteVouchEvidence("5 months, we aren't that close")).toEqual({ durationMonths: 5, depth: "somewhat" });
  expect(inviteVouchEvidence("5 months, wouldn't say we're close")).toEqual({ durationMonths: 5, depth: "somewhat" });
  expect(inviteVouchEvidence("5 months, wouldn't say we're that close")).toEqual({ durationMonths: 5, depth: "somewhat" });
  expect(inviteVouchEvidence("6 months, acquaintances from climbing, get along well")).toEqual({ durationMonths: 6, depth: "somewhat" });
  expect(inviteVouchEvidence("6 months, know her casually, get along well")).toEqual({ durationMonths: 6, depth: "somewhat" });
});
