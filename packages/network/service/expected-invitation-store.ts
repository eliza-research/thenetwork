import { createCipheriv, createDecipheriv, createSecretKey, hkdfSync, randomBytes } from "node:crypto";
import {
  expectedInviteChallengeCurrent, expectedInviteMayAccept, expectedInviteMayDecline, expectedInviteMayDispatch, expectedInviteMayStage,
} from "../../core/src/generated/expectedMemberInvitation.ts";
import { memberInviteDraftMs, memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS, type AppInfo } from "../../platform/src/apps.ts";
import { memberInvitationHash } from "../../platform/src/invite-links.ts";
import { keyedHash, normalizePhone } from "../../platform/src/phone.ts";
import { isMemberInvitationLink } from "../src/invitation.ts";

type AppId = AppInfo["id"];
type InviteOwner = { app: AppId; inviterMemberId: string };
type InviteKey = { app: AppId; tokenHash: string };
type DeliveryKey = { app: AppId; id: string; to: string; body: string };
type PrivateRecipient = { to: string; link: string };
type StagedRecipient = { nonce: Buffer; ciphertext: Buffer; auth_tag: Buffer };

export interface ExpectedInvitationDelivery extends InviteOwner, InviteKey, PrivateRecipient {
  id: string;
  expiresAt: number;
}

export type ExpectedInvitationBinding = InviteOwner & InviteKey & { expiresAt: number };

type InviteRow = { inviter_member_id: string; expires_at: Date; expected_recipient_hash: string | null };
type PendingRow = { staged_at: Date; expires_at: Date; queued_at: Date | null } & (StagedRecipient | { nonce: null; ciphertext: null; auth_tag: null });
type QueuedRow = { attempted_at: Date | null; body_hash: string };
type OutboundRow = { status: string; note: string | null };

const ALGORITHM = "aes-256-gcm";
const TAG_BYTES = 16;
const CHALLENGE = /^mit_[a-p]{32}$/;
const DIGEST = /^[0-9a-f]{64}$/;
export const EXPECTED_INVITATION_PREFIX = "expected-invite:";

export function expectedInvitationRecipientHash(secret: string, e164: string): string {
  return keyedHash(secret, `expected_invitation_recipient:${e164}`);
}

function newChallenge(): string {
  return `mit_${randomBytes(16).toString("hex").replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)))}`;
}

/** Call with the transaction that owns the signed reply, carrier claim, or membership write. */
export class ExpectedMemberInvitations {
  private readonly encryptionKey;

  constructor(
    private readonly secret: string,
    private readonly now: () => number,
    private readonly appInfo: (app: AppId) => Pick<AppInfo, "id" | "domain"> = app => APPS[app],
  ) {
    this.encryptionKey = createSecretKey(Buffer.from(hkdfSync("sha256", secret, "thenetwork", "expected-invitation-v1", 32)));
  }

  private parseRecipient(key: InviteKey, value: unknown): PrivateRecipient | undefined {
    if (!value || typeof value !== "object" || !("link" in value) || !("to" in value)) return;
    const { link, to } = value;
    if (typeof to !== "string" || normalizePhone(to) !== to || typeof link !== "string"
      || !isMemberInvitationLink(this.appInfo(key.app), link) || memberInvitationHash(this.secret, key.app, link.slice(-43)) !== key.tokenHash) return;
    return { to, link };
  }

  private challengeHash(input: InviteOwner, code: string): string {
    return keyedHash(this.secret, JSON.stringify(["expected_invitation_challenge", input.app, input.inviterMemberId, code]));
  }

  private bodyHash(body: string): string {
    return keyedHash(this.secret, `expected_invitation_body:${body}`);
  }

  private lockInvitation(tx: SQL, key: InviteKey, at: Date) {
    return tx<InviteRow[]>`select inviter_member_id,expires_at,expected_recipient_hash from platform.member_invitations
      where app_id=${key.app} and token_hash=${key.tokenHash} and issued_at<=${at} and expires_at>${at} and redeemed_at is null for update`;
  }

  private context(key: InviteKey & InviteOwner, hash: string, expiresAt: number): Buffer {
    return Buffer.from(JSON.stringify(["expected-invitation-v1", key.app, key.tokenHash, key.inviterMemberId, hash, expiresAt]));
  }

  private seal(key: InviteKey & InviteOwner, hash: string, expiresAt: number, recipient: PrivateRecipient): StagedRecipient {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(this.context(key, hash, expiresAt));
    const clear = Buffer.from(JSON.stringify(recipient));
    try {
      return { nonce, ciphertext: Buffer.concat([cipher.update(clear), cipher.final()]), auth_tag: cipher.getAuthTag() };
    } finally {
      clear.fill(0);
    }
  }

  private open(key: InviteKey & InviteOwner, hash: string, row: PendingRow): PrivateRecipient | undefined {
    if (!row.nonce || !row.auth_tag || !row.ciphertext) return;
    try {
      const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, row.nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(this.context(key, hash, row.expires_at.getTime()));
      decipher.setAuthTag(row.auth_tag);
      const clear = decipher.update(row.ciphertext);
      try {
        decipher.final();
        return this.parseRecipient(key, JSON.parse(clear.toString("utf8")));
      } finally {
        clear.fill(0);
      }
    } catch {
      return;
    }
  }

  async stage(tx: SQL, input: InviteKey & InviteOwner & PrivateRecipient): Promise<{ code: string; expiresAt: number } | undefined> {
    const recipient = this.parseRecipient(input, input);
    if (!recipient) return;
    const now = this.now();
    const at = new Date(now);
    const [invite] = await this.lockInvitation(tx, input, at);
    if (!invite || invite.inviter_member_id !== input.inviterMemberId || invite.expected_recipient_hash !== null) return;
    const expiresAt = Math.min(now + memberInviteDraftMs, invite.expires_at.getTime());
    const code = newChallenge();
    const hash = this.challengeHash(input, code);
    const { nonce, ciphertext, auth_tag } = this.seal(input, hash, expiresAt, recipient);
    const changed = await tx`insert into platform.expected_member_invitations (app_id,token_hash,challenge_hash,staged_at,expires_at,nonce,ciphertext,auth_tag)
      values (${input.app},${input.tokenHash},${hash},${at},${new Date(expiresAt)},${nonce},${ciphertext},${auth_tag})
      on conflict (app_id,token_hash) do update set challenge_hash=excluded.challenge_hash,staged_at=excluded.staged_at,
        expires_at=excluded.expires_at,nonce=excluded.nonce,ciphertext=excluded.ciphertext,auth_tag=excluded.auth_tag
        where expected_member_invitations.queued_at is null returning token_hash`;
    if (changed.length === 1) return { code, expiresAt };
  }

  async confirm(
    tx: SQL, input: InviteOwner & { code: string },
    authorize: (tx: SQL, context: ExpectedInvitationDelivery) => Promise<boolean>,
    enqueue: (tx: SQL, context: ExpectedInvitationDelivery) => Promise<string>,
  ): Promise<"queued" | "replayed" | undefined> {
    if (!CHALLENGE.test(input.code)) return;
    const now = this.now();
    const at = new Date(now);
    const hash = this.challengeHash(input, input.code);
    const [found] = await tx<{ token_hash: string }[]>`select token_hash from platform.expected_member_invitations
      where app_id=${input.app} and challenge_hash=${hash}`;
    if (!found) return;
    const key = { ...input, tokenHash: found.token_hash };
    const [invite] = await this.lockInvitation(tx, key, at);
    if (!invite || invite.inviter_member_id !== input.inviterMemberId) return;
    const [pending] = await tx<PendingRow[]>`select staged_at,expires_at,queued_at,nonce,ciphertext,auth_tag
      from platform.expected_member_invitations where app_id=${key.app} and token_hash=${key.tokenHash} and challenge_hash=${hash} for update`;
    if (!pending) return;
    if (pending.queued_at !== null) return "replayed";
    if (invite.expected_recipient_hash !== null || !expectedInviteChallengeCurrent(pending.staged_at.getTime(), now) || pending.expires_at.getTime() <= now) return;
    const recipient = this.open(key, hash, pending);
    if (!recipient) return;
    const delivery: ExpectedInvitationDelivery = {
      app: key.app, inviterMemberId: key.inviterMemberId, tokenHash: key.tokenHash, ...recipient,
      id: `${EXPECTED_INVITATION_PREFIX}${hash}`, expiresAt: invite.expires_at.getTime(),
    };
    // The authority callback rechecks the distinct recipient, current issuer and ordinary app restrictions.
    if (!await authorize(tx, delivery)) return;
    const recipientHash = expectedInvitationRecipientHash(this.secret, recipient.to);
    const windowStart = new Date(now - memberInviteWindowMs);
    const reserved = await tx`insert into platform.expected_invitation_contacts (recipient_hash,reserved_at)
      values (${recipientHash},${at}) on conflict (recipient_hash) do update set reserved_at=excluded.reserved_at
      where expected_invitation_contacts.declined_at is null and expected_invitation_contacts.reserved_at<=${windowStart}
        and (expected_invitation_contacts.attempted_at is null or expected_invitation_contacts.attempted_at<=${windowStart})
      returning recipient_hash`;
    if (!expectedInviteMayStage({
      direct: true, confirmedExpected: true, exactTarget: true, distinctRecipient: true, issuerCurrent: true,
      reviewClear: true, recipientAllowed: true, firstContact: reserved.length === 1, now, expiresAt: delivery.expiresAt,
    })) return;
    const body = await enqueue(tx, delivery);
    const [queued] = await tx`select id from platform.outbound where app_id=${key.app} and id=${delivery.id}
      and to_address=${recipient.to} and body=${body} and kind='transactional' and member_id is null and status='pending'`;
    if (!queued) throw new Error("Expected invitation queue write did not match");
    await tx`update platform.member_invitations set expected_recipient_hash=${recipientHash}
      where app_id=${key.app} and token_hash=${key.tokenHash}`;
    await tx`update platform.expected_member_invitations set queued_at=${at},body_hash=${this.bodyHash(body)},nonce=null,ciphertext=null,auth_tag=null
      where app_id=${key.app} and token_hash=${key.tokenHash}`;
    return "queued";
  }

  /** Admission and the subsequent durable claim both use the same app, number and immutable queue body. */
  private async delivery(tx: SQL, input: DeliveryKey, claimed: boolean): Promise<ExpectedInvitationBinding | undefined> {
    if (!input.id.startsWith(EXPECTED_INVITATION_PREFIX) || normalizePhone(input.to) !== input.to) return;
    const hash = input.id.slice(EXPECTED_INVITATION_PREFIX.length);
    if (!DIGEST.test(hash)) return;
    const now = this.now();
    const at = new Date(now);
    const recipientHash = expectedInvitationRecipientHash(this.secret, input.to);
    const [found] = await tx<{ token_hash: string }[]>`select token_hash from platform.expected_member_invitations
      where app_id=${input.app} and challenge_hash=${hash}`;
    if (!found) return;
    const key = { app: input.app, tokenHash: found.token_hash };
    const [invite] = await this.lockInvitation(tx, key, at);
    if (!invite || invite.expected_recipient_hash !== recipientHash) return;
    const [delivery] = await tx<QueuedRow[]>`select attempted_at,body_hash from platform.expected_member_invitations
      where app_id=${key.app} and token_hash=${key.tokenHash} and challenge_hash=${hash} and queued_at is not null for update`;
    if (!delivery || delivery.body_hash !== this.bodyHash(input.body)) return;
    const [outbound] = await tx<OutboundRow[]>`select status,note from platform.outbound
      where app_id=${key.app} and id=${input.id} and to_address=${input.to} and body=${input.body} and kind='transactional' and member_id is null`;
    if (!outbound || (claimed ? outbound.status !== "sending" : !["pending", "retry_scheduled", "deferred_quiet_hours"].includes(outbound.status))) return;
    const queued = delivery.attempted_at === null || (outbound.note === "receipt lookup: never admitted"
      && outbound.status === (claimed ? "sending" : "retry_scheduled"));
    const [allowed] = await tx`select recipient_hash from platform.expected_invitation_contacts
      where recipient_hash=${recipientHash} and declined_at is null for update`;
    const expiresAt = invite.expires_at.getTime();
    if (!expectedInviteMayDispatch({ queued, issuerCurrent: true, recipientAllowed: !!allowed, exactPayload: true, now, expiresAt })) return;
    return { ...key, inviterMemberId: invite.inviter_member_id, expiresAt };
  }

  currentDelivery(tx: SQL, input: DeliveryKey): Promise<ExpectedInvitationBinding | undefined> {
    return this.delivery(tx, input, false);
  }

  /** Run after the outbound row changes to `sending`, within that same transaction and before provider I/O. */
  async markDeliveryAttempt(tx: SQL, input: DeliveryKey): Promise<boolean> {
    const binding = await this.delivery(tx, input, true);
    if (!binding) return false;
    const at = new Date(this.now());
    const recipientHash = expectedInvitationRecipientHash(this.secret, input.to);
    const first = await tx`update platform.expected_member_invitations set attempted_at=${at}
      where app_id=${binding.app} and token_hash=${binding.tokenHash} and attempted_at is null returning token_hash`;
    if (first.length === 1) {
      await tx`update platform.expected_invitation_contacts set attempted_at=${at} where recipient_hash=${recipientHash}`;
    }
    return true;
  }

  /** Bind a verified phone and the prior attempt to the ordinary, atomic invitation redemption. */
  async verifyRecipient(tx: SQL, input: InviteKey & { to: string }): Promise<boolean> {
    if (normalizePhone(input.to) !== input.to) return false;
    const now = this.now();
    const recipientHash = expectedInvitationRecipientHash(this.secret, input.to);
    const [invite] = await this.lockInvitation(tx, input, new Date(now));
    if (!invite || invite.expected_recipient_hash !== recipientHash) return false;
    const [started] = await tx`select token_hash from platform.expected_member_invitations
      where app_id=${input.app} and token_hash=${input.tokenHash} and attempted_at is not null`;
    const [allowed] = await tx`select recipient_hash from platform.expected_invitation_contacts
      where recipient_hash=${recipientHash} and declined_at is null for update`;
    return expectedInviteMayAccept({
      exactApp: true, verifiedRecipient: true, unredeemed: !!started, issuerCurrent: true, recipientAllowed: !!allowed,
      now, expiresAt: invite.expires_at.getTime(),
    });
  }

  /** A signed recipient decline makes every outstanding binding to that recipient unusable across apps. */
  async decline(tx: SQL, to: string): Promise<boolean> {
    if (normalizePhone(to) !== to) return false;
    const recipientHash = expectedInvitationRecipientHash(this.secret, to);
    const rows = await tx`update platform.expected_invitation_contacts set declined_at=coalesce(declined_at,${new Date(this.now())})
      where recipient_hash=${recipientHash} and attempted_at is not null returning recipient_hash`;
    return expectedInviteMayDecline(true, rows.length === 1);
  }

  async purgeExpired(tx: SQL, app: AppId): Promise<void> {
    const now = this.now();
    const windowStart = new Date(now - memberInviteWindowMs);
    await tx`delete from platform.expected_member_invitations where app_id=${app} and queued_at is null and expires_at<=${new Date(now)}`;
    await tx`delete from platform.expected_invitation_contacts where declined_at is null and reserved_at<=${windowStart}
      and (attempted_at is null or attempted_at<=${windowStart})`;
  }
}
