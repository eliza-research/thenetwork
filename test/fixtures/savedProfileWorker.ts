import type { Event, ProfileApp, ProfileMemberships, ProfileShown } from "../../packages/core/src/generated/savedProfileJourney.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { withSignedTurnFixture, type FixtureApp, type FixtureMember } from "./signedTurnFixture.ts";
import { serveJourney } from "./serveJourney.ts";

type ProfileMember = FixtureMember & { output: ProfileShown[] };
const appId = (app: ProfileApp): FixtureApp => app === "Slop" ? "slop" : "friends";

await withSignedTurnFixture(async ({ service, createMember, sendTurn }) => {
  const members = new Map<string, ProfileMember>();
  const markers = new Map<string, { personId: string; app: FixtureApp }>();
  let sequence = 0;

  async function memberFor(key: string): Promise<ProfileMember> {
    const current = members.get(key);
    if (current) return current;
    const id = ++sequence;
    const slop = `Slop garden journal reference ${id}.`;
    const friends = `Friends bicycle notes reference ${id}.`;
    const member = { ...await createMember({ slop, friends }), output: [] };
    markers.set(slop, { personId: member.personId, app: "slop" });
    markers.set(friends, { personId: member.personId, app: "friends" });
    members.set(key, member);
    return member;
  }

  const memberships = (member: ProfileMember) => Promise.all([
    service.accounts.store.getMembership(member.personId, "slop"),
    service.accounts.store.getMembership(member.personId, "friends"),
  ]);
  const joined = (membership: Awaited<ReturnType<typeof memberships>>[number]) =>
    !!membership && membership.state !== "removed";

  await serveJourney<Event>({
    reset: () => { members.clear(); return null; },
    async dispatch(key, event) {
      const member = await memberFor(key);
      const target = appId(event.app);
      const before = await memberships(member);
      member.output = [];
      if (event.type === "leaveProfileApp") {
        const { response } = await sendTurn(member.phone, `leave ${APPS[target].domain}`, { app: target });
        if (joined(before[target === "slop" ? 0 : 1]) && (response.outcome !== "handled"
          || response.consent?.state !== "opted_out"
          || response.consent.scope !== "app"
          || response.consent.app !== target)) throw new Error("A member's leave did not return an app opt-out");
        return "accepted";
      }
      const subject = event.kind === "ReadSomeoneElse" ? "Jordan's" : "my";
      const forced = event.kind === "ReadOnOtherLine" ? target === "slop" ? "friends" : "slop" : undefined;
      const { response } = await sendTurn(member.phone, `Show ${subject} ${APPS[target].name} profile`, { app: forced });
      if (response.outcome !== "handled" || response.delivery !== "collected")
        throw new Error("A saved profile read did not take the collected reply path");
      const after = await memberships(member);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("A saved profile read changed a membership");
      const text = response.replies.join("\n");
      for (const [marker, entry] of markers) {
        if (!text.includes(marker)) continue;
        if (entry.personId !== member.personId) throw new Error("Read revealed a different person's saved fields");
        member.output.push(entry.app === "slop" ? "SlopProfile" : "FriendsProfile");
      }
      if (text.includes("Here is your saved") && !member.output.length)
        throw new Error("A profile reply did not contain the person's saved fixture fields");
      return "accepted";
    },
    async observe(key): Promise<ProfileMemberships> {
      const [slop, friends] = await memberships(await memberFor(key));
      return { inSlop: joined(slop), inFriends: joined(friends) };
    },
    async observeOutput(key) { return (await memberFor(key)).output; },
  });
});
