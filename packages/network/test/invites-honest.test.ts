// Without an invite link (the service sets no NetworkContext.invite), an unmet request offers no
// invite and does not wait for a friend's name: a one-word reply afterwards is not read as one.
import { describe, expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { memberInvitationLink, type MemberInviteRequest } from "../src/invitation.ts";
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

// spec/memberInvitation.md, "Forward an invitation for someone I know".
test("only a direct adult vouch gets an app-owned link and a new verified acceptance can tell its inviter", async () => {
  const token = "A".repeat(43);
  const link = memberInvitationLink({ id: "ntwrk", domain: "ntwrk.party" }, token);
  const requests: MemberInviteRequest[] = [];
  const w = new Mini([
    { id: "rae", name: "Rae Kim", age: 30 },
    { id: "minor", name: "Pia Lee", age: 17 },
  ], {
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
  expect(requests).toHaveLength(0);

  const start = w.mark();
  await w.say("rae", "Invite my friend Zoe");
  expect(w.sent.slice(start).some(message => /https:\/\//.test(message.body))).toBe(false);
  expect(w.net.counters.invitesSent).toBe(0);
  await w.say("rae", "I'd like to invite my cousin Eli.");
  expect(requests.at(-1)).toMatchObject({ inviterId: "rae", firstName: "Eli", relationship: "family" });
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
