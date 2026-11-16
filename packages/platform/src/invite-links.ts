import { randomBytes } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import type { AppId } from "./apps.ts";
import { keyedHash } from "./phone.ts";

export interface ReferralJoin {
  tokenHash: string;
  inviterMemberId: string;
}

export class InvitationUnavailable extends Error {
  constructor() { super("Invitation is unavailable"); }
}

export function memberInvitationHash(key: string, app: AppId, token: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) return;
  return keyedHash(key, `member_invitation:${app}:${token}`);
}

export function newMemberInvitation(key: string, app: AppId): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: keyedHash(key, `member_invitation:${app}:${token}`) };
}

export async function storeMemberInvitation(tx: SQL, app: AppId, referral: ReferralJoin, relationship: string, now: number): Promise<void> {
  await tx`insert into platform.member_invitations (app_id, token_hash, inviter_member_id, relationship, issued_at, expires_at)
    values (${app}, ${referral.tokenHash}, ${referral.inviterMemberId}, ${relationship}, ${new Date(now)}, ${new Date(now + memberInviteWindowMs)})`;
}

export async function findMemberInvitation(tx: SQL, app: AppId, tokenHash: string, now: number): Promise<ReferralJoin | undefined> {
  const [row] = await tx`select inviter_member_id from platform.member_invitations
    where app_id=${app} and token_hash=${tokenHash} and issued_at<=${new Date(now)} and expires_at>${new Date(now)} and redeemed_at is null`;
  if (row) return { tokenHash, inviterMemberId: row.inviter_member_id as string };
}

export async function consumeMemberInvitation(tx: SQL, app: AppId, referral: ReferralJoin, inviteeMemberId: string, now: number): Promise<void> {
  const rows = await tx`update platform.member_invitations set redeemed_member_id=${inviteeMemberId}, redeemed_at=${new Date(now)}
    where app_id=${app} and token_hash=${referral.tokenHash} and inviter_member_id=${referral.inviterMemberId}
      and inviter_member_id<>${inviteeMemberId} and redeemed_at is null and issued_at<=${new Date(now)} and expires_at>${new Date(now)}
    returning token_hash`;
  if (rows.length !== 1) throw new InvitationUnavailable();
}
