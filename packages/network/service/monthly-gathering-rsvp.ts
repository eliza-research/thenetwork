import { canBeMatched, type ParticipationState } from "@thenetwork/core";
import {
  gatheringInvitationPriority, gatheringRsvpAttendanceAllowed, gatheringRsvpGroupingAllowed,
  gatheringRsvpHasSeat, gatheringRsvpReplaces, gatheringRsvpRosterAllowed, gatheringRsvpWindow,
} from "../../core/src/generated/monthlyGatheringRsvp.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { lowestAge } from "../../platform/src/age.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import type { MemberCommandOwner } from "./member-command.ts";
import { effectiveParticipation } from "./snapshot.ts";

export interface GatheringRsvpKey { id: string; revision: number }
type Choice = "attending" | "grouping" | "withdrawn";
export interface GatheringRsvpCommand extends GatheringRsvpKey { choice: Choice }
interface RsvpTurn { id: string; at: number }
type RsvpAccounts = Pick<Accounts, "activeMembership" | "lowestAge">;

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RSVP_REFERENCE = `${ID}|[a-p]{32}`;
const RSVP = new RegExp(`^RSVP GATHERING (${RSVP_REFERENCE}) ([1-9][0-9]{0,8}) YES( WITH GROUPING)?[.!]?$`, "i");
const WITHDRAW = new RegExp(`^WITHDRAW GATHERING (${RSVP_REFERENCE}) ([1-9][0-9]{0,8})[.!]?$`, "i");
const UUID = new RegExp(`^${ID}$`, "i");
const REFERENCE_LETTERS = "abcdefghijklmnop";

/** Spell the public event ID without phone-shaped digits in automated outreach. */
export function gatheringRsvpReference(id: string): string {
  return id.replace(/-/g, "").replace(/[0-9a-f]/g, hex => REFERENCE_LETTERS[Number.parseInt(hex, 16)]!);
}

function gatheringIdFromReference(reference: string): string {
  const lower = reference.toLowerCase();
  if (UUID.test(lower)) return lower;
  const hex = lower.replace(/[a-p]/g, letter => REFERENCE_LETTERS.indexOf(letter).toString(16));
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function gatheringRsvpCommand(text: string): GatheringRsvpCommand | undefined {
  const normalized = text.trim();
  const affirmative = RSVP.exec(normalized);
  if (affirmative) return { id: gatheringIdFromReference(affirmative[1]!), revision: Number(affirmative[2]), choice: affirmative[3] ? "grouping" : "attending" };
  const withdrawal = WITHDRAW.exec(normalized);
  if (withdrawal) return { id: gatheringIdFromReference(withdrawal[1]!), revision: Number(withdrawal[2]), choice: "withdrawn" };
}

interface GatheringRow {
  city: string; status: string; revision: number; capacity: number;
  reviewed_at: Date | null; starts_at: Date; ends_at: Date;
}
interface RsvpRow { revision: number; choice: Choice; response_id: string; responded_at: Date }
interface MemberRow {
  person_id: string; home_city: string; age: number | null;
  participation_state: ParticipationState; participation_window: unknown;
}

function gathering(tx: SQL, app: AppInfo, key: GatheringRsvpKey, lock: boolean) {
  if (app.id !== "ntwrk" || !UUID.test(key.id) || !Number.isSafeInteger(key.revision) || key.revision < 1) return;
  return tx<GatheringRow[]>`select city,status,revision,capacity,reviewed_at,starts_at,ends_at
    from network.monthly_gatherings where app_id=${app.id} and id=${key.id} ${lock ? tx`for update` : tx``}`;
}

async function ownerMembership(tx: SQL, accounts: RsvpAccounts, owner: MemberCommandOwner, lock: boolean) {
  const [member] = await tx<MemberRow[]>`select person_id,home_city,age,participation_state,participation_window from network.members
    where app_id=${owner.app.id} and id=${owner.memberId} and person_id is not null and account_status='active' and not opted_out
    ${lock ? tx`for update` : tx``}`;
  if (!member) return;
  const binding = await accounts.activeMembership(owner.app, { e164: owner.e164, personId: member.person_id });
  if (binding?.membership.memberId !== owner.memberId || binding.membership.joinedAt === null) return;
  return { binding, member };
}

async function eligible(accounts: RsvpAccounts, owner: MemberCommandOwner, city: string,
  membership: NonNullable<Awaited<ReturnType<typeof ownerMembership>>>, now: number): Promise<boolean> {
  const { binding, member } = membership;
  const age = lowestAge(member.age, await accounts.lowestAge(owner.e164, binding.person));
  return gatheringRsvpAttendanceAllowed(true, canBeMatched(age), member.home_city === city, effectiveParticipation(member, now).state !== "paused");
}

/** Recheck a potential attendee against the same canonical scope used for RSVP and roster reads. */
export async function currentGatheringMember(tx: SQL, accounts: RsvpAccounts, owner: MemberCommandOwner, city: string, now: number): Promise<boolean> {
  if (owner.app.id !== "ntwrk" || city !== "nyc") return false;
  const membership = await ownerMembership(tx, accounts, owner, false);
  return !!membership && await eligible(accounts, owner, city, membership, now);
}

async function currentRsvpContext(tx: SQL, accounts: RsvpAccounts, owner: MemberCommandOwner,
  command: GatheringRsvpCommand, turn: RsvpTurn, now: number, lock: boolean) {
  const rows = await gathering(tx, owner.app, command, lock);
  const event = rows?.[0];
  const withdrawing = command.choice === "withdrawn";
  if (!event || !gatheringRsvpWindow(event.status === "approved", event.revision === command.revision, withdrawing,
    event.reviewed_at?.getTime() ?? 0, event.starts_at.getTime(), event.ends_at.getTime(), turn.at, now)) return;
  const membership = await ownerMembership(tx, accounts, owner, lock);
  if (!membership || membership.binding.membership.joinedAt! > turn.at) return;
  if (!withdrawing && !await eligible(accounts, owner, event.city, membership, now)) return;
  const [saved] = await tx<RsvpRow[]>`select revision,choice,response_id,responded_at from network.monthly_gathering_rsvps
    where app_id=${owner.app.id} and gathering_id=${command.id} and member_id=${owner.memberId}`;
  return { event, saved, withdrawing };
}

function exactResponse(saved: RsvpRow | undefined, command: GatheringRsvpCommand, turn: RsvpTurn): boolean {
  return !!saved && saved.revision === command.revision && saved.response_id === turn.id &&
    saved.responded_at.getTime() === turn.at && saved.choice === command.choice;
}

const RECEIPT: Record<Choice, string> = {
  attending: "Your gathering RSVP is recorded.",
  grouping: "Your gathering RSVP includes grouping suggestions.",
  withdrawn: "Your gathering RSVP is withdrawn.",
};

/** Called only inside the current signed direct member turn's transaction. */
export async function saveGatheringRsvp(tx: SQL, accounts: RsvpAccounts, owner: MemberCommandOwner,
  command: GatheringRsvpCommand, turn: RsvpTurn, now: number): Promise<string | undefined> {
  const current = await currentRsvpContext(tx, accounts, owner, command, turn, now, true);
  if (!current) return;
  const { event, saved, withdrawing } = current;
  if (exactResponse(saved, command, turn)) return RECEIPT[command.choice];
  if (withdrawing && !saved) return;
  const reserved = !!saved && saved.revision === command.revision && saved.choice !== "withdrawn";
  if (!gatheringRsvpReplaces(!!saved, saved?.response_id === turn.id, saved?.responded_at.getTime() ?? 0, turn.at, withdrawing, reserved)) return;
  if (!withdrawing && !reserved) {
    const [seat] = await tx<{ reserved: number }[]>`select count(*)::int as reserved from network.monthly_gathering_rsvps
      where app_id=${owner.app.id} and gathering_id=${command.id} and revision=${command.revision} and choice<>'withdrawn'`;
    if (!seat || !gatheringRsvpHasSeat(false, seat.reserved, event.capacity)) return;
  }
  await tx`insert into network.monthly_gathering_rsvps (app_id,gathering_id,member_id,revision,choice,response_id,responded_at)
    values (${owner.app.id},${command.id},${owner.memberId},${command.revision},${command.choice},${turn.id},${new Date(turn.at)})
    on conflict (app_id,gathering_id,member_id) do update set revision=excluded.revision,choice=excluded.choice,
      response_id=excluded.response_id,responded_at=excluded.responded_at`;
  return RECEIPT[command.choice];
}

/** A retry may return only the still-current acknowledgement for that exact turn. */
export async function gatheringRsvpReplyCurrent(tx: SQL, accounts: RsvpAccounts, owner: MemberCommandOwner,
  command: GatheringRsvpCommand, turn: RsvpTurn, now: number): Promise<boolean> {
  const current = await currentRsvpContext(tx, accounts, owner, command, turn, now, false);
  return exactResponse(current?.saved, command, turn);
}

export interface GatheringRosterMember { memberId: string; grouping: boolean }

/** Internal staff read; the caller must already be authorized for this gathering's operations. */
export async function gatheringRsvpRoster(tx: SQL, accounts: RsvpAccounts, app: AppInfo,
  key: GatheringRsvpKey, now: number): Promise<GatheringRosterMember[] | undefined> {
  const rows = await gathering(tx, app, key, false);
  const event = rows?.[0];
  if (!event || !gatheringRsvpRosterAllowed(event.status === "approved", event.revision === key.revision,
    event.reviewed_at?.getTime() ?? 0, event.ends_at.getTime(), now)) return;
  const responses = await tx<{ member_id: string; choice: Choice; responded_at: Date; phones: string[] }[]>`select
      r.member_id,r.choice,r.responded_at,array_agg(p.e164 order by p.e164) as phones
    from network.monthly_gathering_rsvps r join network.members m on m.app_id=r.app_id and m.id=r.member_id
      join platform.phone_identities p on p.person_id=m.person_id and p.hold is null
    where r.app_id=${app.id} and r.gathering_id=${key.id} and r.revision=${key.revision} and r.choice<>'withdrawn'
      and m.account_status='active' and not m.opted_out and m.home_city=${event.city}
    group by r.member_id,r.choice,r.responded_at order by r.responded_at,r.member_id`;
  const roster: GatheringRosterMember[] = [];
  for (const response of responses) {
    for (const e164 of response.phones) {
      const owner = { app, memberId: response.member_id, e164 };
      const membership = await ownerMembership(tx, accounts, owner, false);
      if (!membership || membership.binding.membership.joinedAt! > response.responded_at.getTime() ||
        !await eligible(accounts, owner, event.city, membership, now)) continue;
      roster.push({ memberId: owner.memberId, grouping: gatheringRsvpGroupingAllowed(true, response.choice === "grouping", true) });
      break;
    }
  }
  return roster;
}

export interface GatheringPriorityEvidence {
  memberId: string; eligible: boolean; newcomer: boolean; isolated: boolean; pendingSecondEncounter: boolean;
}

/** Order the engine's current app-local candidates for the staff invitation decision. */
export function rankGatheringInvitees(candidates: readonly GatheringPriorityEvidence[]): string[] {
  return candidates.map(candidate => ({ memberId: candidate.memberId, score: gatheringInvitationPriority(candidate.eligible, candidate.newcomer,
    candidate.isolated, candidate.pendingSecondEncounter) }))
    .filter(candidate => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || (a.memberId < b.memberId ? -1 : a.memberId === b.memberId ? 0 : 1))
    .map(candidate => candidate.memberId);
}
