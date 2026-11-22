import { createHash } from "node:crypto";
import {
  gatheringFollowupCanChoose, gatheringFollowupMayReplace, gatheringFollowupMutual, gatheringFollowupOpen,
  gatheringFollowupPairCurrent, gatheringFollowupReferenceAllowed,
} from "../../core/src/generated/monthlyGatheringFollowup.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { keyedHash, safeEqual } from "../../platform/src/phone.ts";
import { storedInviteNoticePartyCurrent, type GatheringRepeatSource, type NetworkState } from "../src/network.ts";
import type { MemberCommandOwner } from "./member-command.ts";
import { currentGatheringMember, gatheringRsvpKey, gatheringRsvpReference, type GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";

export type GatheringFollowupCommand = GatheringRsvpKey & (
  { kind: "attendance"; yes: boolean } | { kind: "reference" } | { kind: "preference"; reference: string; yes: boolean }
);
export function gatheringFollowupRequested(text: string): boolean {
  return /^\s*gathering\s+(?:attended|reference|follow-up)\b/i.test(text);
}

export function gatheringFollowupCommand(text: string): GatheringFollowupCommand | undefined {
  const [name, action, reference, revision, decision, peerDecision, extra] = text.trim().toLowerCase().replace(/[.!]$/, "").split(/\s+/, 7);
  if (name !== "gathering" || !reference || !revision || extra !== undefined) return;
  const key = gatheringRsvpKey(reference, revision);
  if (!key) return;
  if (action === "reference" && decision === undefined) return { ...key, kind: "reference" };
  if (action === "attended" && (decision === "yes" || decision === "no") && peerDecision === undefined)
    return { ...key, kind: "attendance", yes: decision === "yes" };
  if (action === "follow-up" && decision && /^[a-p]{32}$/.test(decision) && (peerDecision === "yes" || peerDecision === "no"))
    return { ...key, kind: "preference", reference: decision, yes: peerDecision === "yes" };
}

export type FollowupAccounts = Pick<Accounts, "activeMembership" | "lowestAge">;
interface SignedResponse { id: string; at: number }
interface FollowupContext { key: GatheringRsvpKey; app: AppInfo; city: string; state: NetworkState; now: number; endsAt: number }
export interface GatheringFollowupRecipient { memberId: string; e164: string }
interface Group { review_id: string; group_no: number }
interface Attendance { attended: boolean; responded_at: Date; response_id: string }
interface Preference { wanted: boolean; responded_at: Date; response_id: string }
const FOLLOWUP_RECEIPT = "Follow-up choices are private and require both people to choose them.";
const ATTENDANCE_RECEIPTS = { yes: "I recorded that you attended the gathering.", no: "I recorded that you did not attend the gathering." };

async function followupContext(tx: SQL, app: AppInfo, key: GatheringRsvpKey, reference: boolean, receivedAt: number, now: number,
  write: boolean, state?: NetworkState): Promise<FollowupContext | undefined> {
  if (app.id !== "ntwrk" || gatheringRsvpKey(key.id, String(key.revision))?.id !== key.id) return;
  const [event] = await tx<{ city: string; revision: number; status: string; starts_at: Date; ends_at: Date }[]>`select city,revision,status,starts_at,ends_at
    from network.monthly_gatherings where app_id=${app.id} and id=${key.id} and city='nyc' ${write ? tx`for update` : tx``}`;
  if (!event || !gatheringFollowupOpen(event.status === "approved", event.revision === key.revision, reference,
    event.starts_at.getTime(), event.ends_at.getTime(), receivedAt, now)) return;
  if (!state) {
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${app.id} and id=${`${app.id}:${event.city}`}`;
    state = saved?.state;
  }
  if (state) return { key, app, city: event.city, state, now, endsAt: event.ends_at.getTime() };
}

async function admittedMember(tx: SQL, accounts: FollowupAccounts, ctx: FollowupContext, memberId: string, exactPhone?: string): Promise<boolean> {
  const { app, key, state, now, city } = ctx;
  const stored = state.members.find(candidate => candidate.id === memberId);
  if (stored?.stage !== "active" || state.trust?.some(record => record.id === memberId && record.level !== "ok") ||
    !storedInviteNoticePartyCurrent(state, memberId)) return false;
  const [owner] = await tx<{ phones: string[] }[]>`select array_agg(ph.e164 order by ph.e164) as phones
    from network.monthly_gathering_rsvps r join network.members m on m.app_id=r.app_id and m.id=r.member_id
    join platform.phone_identities ph on ph.person_id=m.person_id and ph.hold is null
    where r.app_id=${app.id} and r.gathering_id=${key.id} and r.revision=${key.revision} and r.member_id=${memberId}
      and r.choice in ('attending','grouping') and (${exactPhone ?? null}::text is null or ph.e164=${exactPhone ?? null})
    group by r.member_id`;
  for (const e164 of owner?.phones ?? []) {
    if (await currentGatheringMember(tx, accounts, { app, memberId, e164 }, city, now)) return true;
  }
  return false;
}

async function approvedGroup(tx: SQL, ctx: FollowupContext, memberId: string): Promise<Group | undefined> {
  const { app, key } = ctx;
  const [group] = await tx<Group[]>`select gm.review_id,gm.group_no from network.monthly_gathering_group_members gm
    join network.monthly_gathering_grouping_reviews g on g.app_id=gm.app_id and g.gathering_id=gm.gathering_id
      and g.revision=gm.revision and g.review_id=gm.review_id and g.superseded_at is null
    join network.monthly_gathering_rsvps r on r.app_id=gm.app_id and r.gathering_id=gm.gathering_id
      and r.revision=gm.revision and r.member_id=gm.member_id and r.choice='grouping'
    where gm.app_id=${app.id} and gm.gathering_id=${key.id} and gm.revision=${key.revision} and gm.member_id=${memberId}`;
  return group;
}

function memberReference(ctx: FollowupContext, group: Group, memberId: string, hashKey: string): string {
  const { app, key } = ctx;
  const digest = keyedHash(hashKey, `gathering-followup:${app.id}:${key.id}:${key.revision}:${group.review_id}:${memberId}`);
  return digest.slice(0, 32).replace(/[0-9a-f]/g, hex => "abcdefghijklmnop"[Number.parseInt(hex, 16)]!);
}

function referenceReply(ctx: FollowupContext, group: Group, memberId: string, hashKey: string): string {
  const event = `${gatheringRsvpReference(ctx.key.id)} ${ctx.key.revision}`;
  return `Your private gathering reference is ${memberReference(ctx, group, memberId, hashKey)}. Share it only by choice.\n`
    + `If someone in your group shares their reference, replace THEIR-REFERENCE below to choose a follow-up. End with NO to take it back.\n`
    + `GATHERING FOLLOW-UP ${event} THEIR-REFERENCE YES`;
}

async function attendance(tx: SQL, ctx: FollowupContext, memberId: string): Promise<Attendance | undefined> {
  const { app, key } = ctx;
  const [saved] = await tx<Attendance[]>`select attended,responded_at,response_id from network.monthly_gathering_attendance
    where app_id=${app.id} and gathering_id=${key.id} and revision=${key.revision} and member_id=${memberId}`;
  return saved;
}

async function attendanceReceipt(tx: SQL, ctx: FollowupContext, memberId: string, yes: boolean): Promise<string> {
  const receipt = ATTENDANCE_RECEIPTS[yes ? "yes" : "no"];
  if (!yes || !await approvedGroup(tx, ctx, memberId)) return receipt;
  return `${receipt}\nTo get a private reference to share, send the line below.\nGATHERING REFERENCE ${gatheringRsvpReference(ctx.key.id)} ${ctx.key.revision}`;
}

async function attendanceReply(tx: SQL, ctx: FollowupContext, memberId: string, yes: boolean, turn: SignedResponse, write: boolean): Promise<string | undefined> {
  const saved = await attendance(tx, ctx, memberId);
  if (saved?.response_id === turn.id && saved.responded_at.getTime() === turn.at && saved.attended === yes)
    return attendanceReceipt(tx, ctx, memberId, yes);
  if (!write || !gatheringFollowupMayReplace(!!saved, saved?.response_id === turn.id, saved?.responded_at.getTime() ?? 0, turn.at, saved?.attended ?? false, yes)) return;
  const { app, key } = ctx;
  await tx`insert into network.monthly_gathering_attendance (app_id,gathering_id,revision,member_id,attended,response_id,responded_at)
    values (${app.id},${key.id},${key.revision},${memberId},${yes},${turn.id},${new Date(turn.at)})
    on conflict (app_id,gathering_id,revision,member_id) do update set attended=excluded.attended,
      response_id=excluded.response_id,responded_at=excluded.responded_at`;
  return attendanceReceipt(tx, ctx, memberId, yes);
}

async function unblockedPair(tx: SQL, ctx: FollowupContext, first: string, second: string): Promise<boolean> {
  const pair = first < second ? `${first}|${second}` : `${second}|${first}`;
  if (ctx.state.blocks.includes(pair) || ctx.state.avoid.includes(pair)) return false;
  const [blocked] = await tx`select 1 from network.edges e where e.app_id=${ctx.app.id} and e.type in ('blocked','avoid')
      and ((e.from_id=${first} and e.to_id=${second}) or (e.from_id=${second} and e.to_id=${first}))
    union all select 1 from platform.person_blocks b join network.members f on f.app_id=${ctx.app.id} and f.id=${first}
      join network.members s on s.app_id=${ctx.app.id} and s.id=${second}
      where (b.from_person=f.person_id and b.to_person=s.person_id) or (b.from_person=s.person_id and b.to_person=f.person_id) limit 1`;
  return !blocked;
}

async function currentPair(tx: SQL, accounts: FollowupAccounts, ctx: FollowupContext, ownGroup: Group, ownId: string, peerId: string,
  ownAlreadyAdmitted: boolean, recipient?: GatheringFollowupRecipient) {
  const own = await attendance(tx, ctx, ownId);
  const peer = await attendance(tx, ctx, peerId);
  if (!own || !peer) return;
  const otherGroup = await approvedGroup(tx, ctx, peerId);
  const sameGroup = otherGroup?.review_id === ownGroup.review_id && otherGroup.group_no === ownGroup.group_no;
  if (!sameGroup || ownId === peerId) return;
  const eligible = (ownAlreadyAdmitted || await admittedMember(tx, accounts, ctx, ownId, recipient?.memberId === ownId ? recipient.e164 : undefined))
    && await admittedMember(tx, accounts, ctx, peerId, recipient?.memberId === peerId ? recipient.e164 : undefined);
  if (gatheringFollowupPairCurrent(sameGroup, ownId !== peerId, eligible, await unblockedPair(tx, ctx, ownId, peerId), own.attended, peer.attended))
    return { own, peer };
}

async function savePreference(tx: SQL, accounts: FollowupAccounts, ctx: FollowupContext, memberId: string,
  command: Extract<GatheringFollowupCommand, {kind: "preference"}>, turn: SignedResponse, hashKey: string) {
  const { app, key } = ctx;
  const group = await approvedGroup(tx, ctx, memberId);
  if (!group) return;
  const peers = await tx<{ member_id: string }[]>`select member_id from network.monthly_gathering_group_members
    where app_id=${app.id} and gathering_id=${key.id} and revision=${key.revision} and review_id=${group.review_id}
      and group_no=${group.group_no} and member_id<>${memberId} order by member_id`;
  const matches = peers.filter(peer => safeEqual(memberReference(ctx, group, peer.member_id, hashKey), command.reference));
  if (matches.length !== 1) return;
  const peerId = matches[0]!.member_id;
  const [saved] = await tx<Preference[]>`select wanted,responded_at,response_id from network.monthly_gathering_followup_choices
    where app_id=${app.id} and gathering_id=${key.id} and revision=${key.revision} and group_review_id=${group.review_id}
      and member_id=${memberId} and peer_id=${peerId}`;
  if (!gatheringFollowupMayReplace(!!saved, saved?.response_id === turn.id, saved?.responded_at.getTime() ?? 0, turn.at, saved?.wanted ?? false, command.yes)) return;
  if (!command.yes && saved) {
    await tx`update network.monthly_gathering_followup_choices set wanted=false,response_id=${turn.id},responded_at=${new Date(turn.at)}
      where app_id=${app.id} and gathering_id=${key.id} and revision=${key.revision} and group_review_id=${group.review_id}
        and member_id=${memberId} and peer_id=${peerId}`;
    return;
  }
  const pair = await currentPair(tx, accounts, ctx, group, memberId, peerId, true);
  if (!pair || !gatheringFollowupCanChoose(true, pair.own.responded_at.getTime(), pair.peer.responded_at.getTime(), turn.at)) return;
  await tx`insert into network.monthly_gathering_followup_choices
      (app_id,gathering_id,revision,group_review_id,member_id,peer_id,wanted,response_id,responded_at,own_attendance_response,peer_attendance_response)
    values (${app.id},${key.id},${key.revision},${group.review_id},${memberId},${peerId},${command.yes},${turn.id},${new Date(turn.at)},${pair.own.response_id},${pair.peer.response_id})
    on conflict (app_id,gathering_id,revision,group_review_id,member_id,peer_id) do update set
      wanted=excluded.wanted,response_id=excluded.response_id,responded_at=excluded.responded_at,
      own_attendance_response=excluded.own_attendance_response,peer_attendance_response=excluded.peer_attendance_response`;
}

async function followupReply(tx: SQL, accounts: FollowupAccounts, owner: MemberCommandOwner, command: GatheringFollowupCommand,
  turn: SignedResponse, now: number, hashKey: string, write: boolean): Promise<string | undefined> {
  const ctx = await followupContext(tx, owner.app, command, command.kind === "reference", turn.at, now, write);
  if (!ctx || !await admittedMember(tx, accounts, ctx, owner.memberId, owner.e164)) return;
  if (command.kind === "attendance") return attendanceReply(tx, ctx, owner.memberId, command.yes, turn, write);
  if (command.kind === "reference") {
    const group = await approvedGroup(tx, ctx, owner.memberId);
    if (group && gatheringFollowupReferenceAllowed(true, true, true)) return referenceReply(ctx, group, owner.memberId, hashKey);
    return;
  }
  if (write) await savePreference(tx, accounts, ctx, owner.memberId, command, turn, hashKey);
  return FOLLOWUP_RECEIPT;
}
export function saveGatheringFollowup(tx: SQL, accounts: FollowupAccounts, owner: MemberCommandOwner, command: GatheringFollowupCommand,
  turn: SignedResponse, now: number, hashKey: string): Promise<string | undefined> {
  return followupReply(tx, accounts, owner, command, turn, now, hashKey, true);
}

export async function gatheringFollowupReplyCurrent(tx: SQL, accounts: FollowupAccounts, owner: MemberCommandOwner,
  command: GatheringFollowupCommand, turn: SignedResponse, now: number, hashKey: string, body: string): Promise<boolean> {
  return body === await followupReply(tx, accounts, owner, command, turn, now, hashKey, false);
}
export async function gatheringMutualFollowups(tx: SQL, accounts: FollowupAccounts, app: AppInfo,
  key: GatheringRsvpKey, now: number): Promise<{ members: [string, string]; groupReviewId: string }[]> {
  return (await gatheringRepeatSourcesForEvent(tx, accounts, app, key, now)).map(({ members, groupReviewId }) => ({ members, groupReviewId }));
}

interface MutualChoice {
  member_id: string;
  peer_id: string;
  group_review_id: string;
  one_own: string;
  one_peer: string;
  two_own: string;
  two_peer: string;
  one_id: string;
  two_id: string;
  one_at: Date;
  two_at: Date;
}
export async function gatheringRepeatSourcesForEvent(tx: SQL, accounts: FollowupAccounts, app: AppInfo, key: GatheringRsvpKey, now: number,
  o: { state?: NetworkState; expected?: GatheringRepeatSource; recipient?: GatheringFollowupRecipient } = {}): Promise<GatheringRepeatSource[]> {
  const ctx = await followupContext(tx, app, key, false, now, now, false, o.state);
  if (!ctx) return [];
  const expected = o.expected;
  const choices = await tx<MutualChoice[]>`select one.member_id,one.peer_id,one.group_review_id,
      one.own_attendance_response as one_own,one.peer_attendance_response as one_peer,
      two.own_attendance_response as two_own,two.peer_attendance_response as two_peer,
      one.response_id as one_id, two.response_id as two_id, one.responded_at as one_at, two.responded_at as two_at
    from network.monthly_gathering_followup_choices one join network.monthly_gathering_followup_choices two
      on two.app_id=one.app_id and two.gathering_id=one.gathering_id and two.revision=one.revision and two.group_review_id=one.group_review_id
      and two.member_id=one.peer_id and two.peer_id=one.member_id and two.wanted
    where one.app_id=${app.id} and one.gathering_id=${key.id} and one.revision=${key.revision}
      and one.member_id collate "C" < one.peer_id collate "C" and one.wanted
      ${expected ? tx`and one.member_id=${expected.members[0]} and one.peer_id=${expected.members[1]} and one.group_review_id=${expected.groupReviewId}` : tx``}
    order by one.member_id collate "C",one.peer_id collate "C"`;
  const result: GatheringRepeatSource[] = [];
  for (const choice of choices) {
    const group = await approvedGroup(tx, ctx, choice.member_id);
    if (!group || group.review_id !== choice.group_review_id) continue;
    const pair = await currentPair(tx, accounts, ctx, group, choice.member_id, choice.peer_id, false, o.recipient);
    if (!pair) continue;
    const exactAttendance = choice.one_own === pair.own.response_id && choice.two_peer === pair.own.response_id &&
      choice.one_peer === pair.peer.response_id && choice.two_own === pair.peer.response_id;
    const ownAt = pair.own.responded_at.getTime(), peerAt = pair.peer.responded_at.getTime();
    const firstChoiceAt = choice.one_at.getTime(), secondChoiceAt = choice.two_at.getTime();
    if (!gatheringFollowupMutual(true, true, true, exactAttendance) || ownAt < ctx.endsAt || peerAt < ctx.endsAt
      || firstChoiceAt > now || secondChoiceAt > now
      || !gatheringFollowupCanChoose(true, ownAt, peerAt, firstChoiceAt) || !gatheringFollowupCanChoose(true, ownAt, peerAt, secondChoiceAt)) continue;
    const members: [string, string] = [choice.member_id, choice.peer_id];
    const consentVersion = createHash("sha256").update(JSON.stringify(["gathering-repeat", app.id, key.id, key.revision, group.review_id, members,
      [pair.own.response_id, ownAt], [pair.peer.response_id, peerAt], [choice.one_id, firstChoiceAt], [choice.two_id, secondChoiceAt]])).digest("hex");
    result.push({ gatheringId: key.id, revision: key.revision, groupReviewId: group.review_id, members, consentVersion });
  }
  return result;
}
