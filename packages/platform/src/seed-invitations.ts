import { createCipheriv, createSecretKey, hkdfSync, randomBytes } from "node:crypto";
import {
  seedInvitationBatchDecision, seedInvitationBatchReplayLive, seedInvitationBatchSizeAllowed, seedInvitationCitySupported,
  seedInvitationExpiresAt, seedInvitationMayDecline, seedInvitationMayRedeem, seedInvitationRecipientCurrent,
} from "../../core/src/generated/seedInvitation.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "./apps.ts";
import { InvitationUnavailable } from "./invite-links.ts";
import { keyedHash, normalizePhone } from "./phone.ts";

export type SeedInvitationCity = "nyc" | "sf";
export interface SeedInvitationEntry { e164: string; homeCity: SeedInvitationCity; vouchNote: string }
export interface SeedInvitationBatchRequest {
  app: AppId;
  issuerId: string;
  requestId: string;
  entries: readonly SeedInvitationEntry[];
}

export type SeedInvitationBatch = {
  kind: "issued" | "replayed";
  batchId: string;
  issuedAt: number;
  expiresAt: number;
  links: { token: string; homeCity: SeedInvitationCity }[];
} | { kind: "conflict" } | { kind: "unavailable" };

export interface SeedInvitationReferral {
  kind: "seed";
  tokenHash: string;
  batchId: string;
  issuerId: string;
  homeCity: SeedInvitationCity;
}

type BatchRow = { issuer_id: string; body_hash: string; issued_at: Date; expires_at: Date };
type InviteRow = {
  batch_id: string;
  issuer_id: string;
  home_city: SeedInvitationCity;
  recipient_hash: string | null;
  closed_at: Date | null;
  issued_at: Date;
  expires_at: Date;
};

const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const TOKEN = /^[a-zA-Z0-9_-]{43}$/;

/** Run issuance inside the app-scoped staff/audit transaction and consume inside the verified first join. */
export class SeedInvitations {
  private readonly encryptionKey;

  constructor(private readonly secret: string, private readonly now: () => number) {
    const material = Buffer.from(hkdfSync("sha256", secret, "thenetwork", "seed-invitation-vouch-v1", 32));
    try { this.encryptionKey = createSecretKey(material); } finally { material.fill(0); }
  }

  private digest(domain: string, facts: readonly unknown[]): string {
    return keyedHash(this.secret, JSON.stringify([domain, ...facts]));
  }

  private recipientHash(app: AppId, e164: string): string {
    return this.digest("seed_invitation_recipient", [app, e164]);
  }

  private tokenHash(app: AppId, token: string): string {
    return this.digest("seed_invitation_token_digest", [app, token]);
  }

  private seal(context: readonly unknown[], note: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify(["seed-invitation-vouch-v1", ...context])));
    const clear = Buffer.from(note);
    try {
      return { nonce, ciphertext: Buffer.concat([cipher.update(clear), cipher.final()]), auth_tag: cipher.getAuthTag() };
    } finally {
      clear.fill(0);
    }
  }

  async issue(tx: SQL, { app, issuerId, requestId, entries }: SeedInvitationBatchRequest): Promise<SeedInvitationBatch> {
    const issuedAt = this.now();
    if (issuedAt < 0 || !REQUEST_ID.test(requestId) || !seedInvitationBatchSizeAllowed(entries.length)) return { kind: "unavailable" };
    const normalized = entries.map(entry => ({ ...entry, e164: normalizePhone(entry.e164), vouchNote: entry.vouchNote.trim() }));
    const vouchBytes = normalized.map(entry => Buffer.byteLength(entry.vouchNote));
    const facts = {
      // The app-scoped staff handler checks role and configured cities before calling this store.
      appAdmin: true,
      stableActor: issuerId.trim().length > 0,
      validCity: normalized.every(entry => seedInvitationCitySupported(entry.homeCity)),
      validRecipients: normalized.every(entry => entry.e164 !== undefined),
      uniqueRecipients: new Set(normalized.map(entry => entry.e164)).size === normalized.length,
      entryCount: normalized.length,
      shortestVouchBytes: Math.min(...vouchBytes),
      longestVouchBytes: Math.max(...vouchBytes),
    };
    if (seedInvitationBatchDecision({ ...facts, batchNew: true, sameBatch: false, batchLive: true }) !== "IssueSeedBatch") return { kind: "unavailable" };
    const batchId = `sib_${this.digest("seed_invitation_batch", [app, issuerId, requestId])}`;
    const bodyHash = this.digest("seed_invitation_batch_input", [batchId, normalized.map(({ e164, homeCity, vouchNote }) => [e164, homeCity, vouchNote])]);
    const expiresAt = seedInvitationExpiresAt(issuedAt);
    const [created] = await tx<BatchRow[]>`insert into platform.seed_invitation_batches (app_id,id,issuer_id,body_hash,issued_at,expires_at)
      values (${app},${batchId},${issuerId},${bodyHash},${new Date(issuedAt)},${new Date(expiresAt)})
      on conflict (app_id,id) do nothing returning issuer_id,body_hash,issued_at,expires_at`;
    const [original] = created ? [created] : await tx<BatchRow[]>`select issuer_id,body_hash,issued_at,expires_at from platform.seed_invitation_batches
      where app_id=${app} and id=${batchId}`;
    if (!original || original.issuer_id !== issuerId) return { kind: "unavailable" };
    if (original.body_hash !== bodyHash) return { kind: "conflict" };
    const batchLive = seedInvitationBatchReplayLive(original.issued_at.getTime(), original.expires_at.getTime(), issuedAt);
    const decision = seedInvitationBatchDecision({ ...facts, batchNew: !!created, sameBatch: true, batchLive });
    if (decision === "RejectSeedBatch") return { kind: "unavailable" };

    const links = normalized.map(({ homeCity }, ordinal) => ({
      homeCity,
      token: Buffer.from(this.digest("seed_invitation_token", [app, issuerId, requestId, batchId, ordinal]), "hex").toString("base64url"),
    }));
    if (decision === "IssueSeedBatch") {
      const rows = links.map(({ token, homeCity }, ordinal) => {
        const entry = normalized[ordinal];
        if (!entry?.e164) throw new Error("Seed invitation requires a valid recipient");
        const tokenHash = this.tokenHash(app, token);
        const recipientHash = this.recipientHash(app, entry.e164);
        return {
          app_id: app, batch_id: batchId, token_hash: tokenHash, ordinal, home_city: homeCity, recipient_hash: recipientHash,
          ...this.seal([app, batchId, ordinal, tokenHash, recipientHash, homeCity, expiresAt], entry.vouchNote),
        };
      });
      await tx`insert into platform.seed_invitations ${tx(rows)}`;
    }
    return {
      kind: decision === "IssueSeedBatch" ? "issued" : "replayed", batchId, links,
      issuedAt: original.issued_at.getTime(), expiresAt: original.expires_at.getTime(),
    };
  }

  private async current(tx: SQL, app: AppId, tokenHash: string, recipientHash: string): Promise<SeedInvitationReferral | undefined> {
    const [row] = await tx<InviteRow[]>`select i.batch_id,b.issuer_id,i.home_city,i.recipient_hash,i.closed_at,b.issued_at,b.expires_at
      from platform.seed_invitations i join platform.seed_invitation_batches b on b.app_id=i.app_id and b.id=i.batch_id
      where i.app_id=${app} and i.token_hash=${tokenHash}`;
    const now = this.now();
    if (!row || row.expires_at.getTime() <= now || !seedInvitationRecipientCurrent({
      exactApp: true, verifiedRecipient: row.recipient_hash === recipientHash, recipientAllowed: true,
      unredeemed: row.closed_at === null, issuedAt: row.issued_at.getTime(), now,
    })) return;
    return { kind: "seed", tokenHash, batchId: row.batch_id, issuerId: row.issuer_id, homeCity: row.home_city };
  }

  async findRecipient(tx: SQL, { app, token, e164 }: { app: AppId; token: string; e164: string }): Promise<SeedInvitationReferral | undefined> {
    if (normalizePhone(e164) !== e164 || !TOKEN.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) return;
    return this.current(tx, app, this.tokenHash(app, token), this.recipientHash(app, e164));
  }

  async consume(tx: SQL, { app, referral, e164, memberId }: { app: AppId; referral: SeedInvitationReferral; e164: string; memberId: string }): Promise<void> {
    const recipientHash = this.recipientHash(app, e164);
    const current = normalizePhone(e164) === e164 && await this.current(tx, app, referral.tokenHash, recipientHash);
    if (!current || current.batchId !== referral.batchId || current.issuerId !== referral.issuerId || current.homeCity !== referral.homeCity) {
      throw new InvitationUnavailable();
    }
    const at = new Date(this.now());
    const rows = await tx`with spent as (
        update platform.seed_invitations i set closed_at=${at},recipient_hash=null,nonce=null,ciphertext=null,auth_tag=null
        from platform.seed_invitation_batches b where i.app_id=${app} and i.token_hash=${referral.tokenHash}
          and i.app_id=b.app_id and i.batch_id=b.id and b.id=${referral.batchId} and b.issuer_id=${referral.issuerId}
          and i.home_city=${referral.homeCity} and b.issued_at<=${at} and b.expires_at>${at}
          and i.closed_at is null and i.recipient_hash=${recipientHash}
        returning i.app_id,i.batch_id,b.issuer_id,i.home_city
      ) insert into platform.seed_invitation_attributions (app_id,member_id,batch_id,issuer_id,home_city,redeemed_at)
      select app_id,${memberId},batch_id,issuer_id,home_city,${at} from spent
      on conflict (app_id,member_id) do nothing returning member_id`;
    if (!seedInvitationMayRedeem({ liveBinding: true, freshJoin: rows.length === 1, eligibleEnrollment: true, currentConsent: true })) {
      throw new InvitationUnavailable();
    }
  }

  /** The verified recipient closes their app's live links and erases the associated evidence. */
  async decline(tx: SQL, { app, e164 }: { app: AppId; e164: string }): Promise<number> {
    if (!seedInvitationMayDecline(normalizePhone(e164) === e164, true)) return 0;
    const at = new Date(this.now());
    const rows = await tx`update platform.seed_invitations i set closed_at=${at},recipient_hash=null,nonce=null,ciphertext=null,auth_tag=null
      from platform.seed_invitation_batches b where i.app_id=${app} and i.app_id=b.app_id and i.batch_id=b.id
        and i.recipient_hash=${this.recipientHash(app, e164)} and i.closed_at is null and b.issued_at<=${at} and b.expires_at>${at}
      returning i.token_hash`;
    return rows.length;
  }

  async purgeExpired(tx: SQL, app: AppId): Promise<void> {
    const at = new Date(this.now());
    await tx`delete from platform.seed_invitations i using platform.seed_invitation_batches b
      where i.app_id=${app} and b.app_id=i.app_id and b.id=i.batch_id and b.expires_at<=${at}`;
  }
}
