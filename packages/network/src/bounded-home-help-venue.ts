import { createCipheriv, createDecipheriv, randomBytes, type KeyObject } from "node:crypto";
import {
  mayReadHomeHelpVenue, mayRevokeHomeHelpVenue, mayStoreHomeHelpVenue,
} from "../../core/src/generated/privateHomeHelpVenue.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { HomeHelpReviewPlan } from "./bounded-help.ts";

export interface HomeHelpVenueActor {
  app: AppId;
  /** The server resolves the member from the current direct human session. */
  memberId: string;
}

export interface HomeHelpVenueVersion {
  id: string;
  revision: number;
}

type VenueKey = HomeHelpVenueVersion & { app: AppId };
export type CurrentHomeHelpConsent = (tx: SQL, key: VenueKey) => Promise<HomeHelpReviewPlan | undefined>;

interface SealedVenue {
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
}

type StoredVenue = { expires_at: Date } & (SealedVenue | { nonce: null; ciphertext: null; auth_tag: null });

const ALGORITHM = "aes-256-gcm";
const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const ADDRESS_BYTES = 300;
const PLAN_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function validVersion({ id, revision }: HomeHelpVenueVersion): boolean {
  return typeof id === "string" && PLAN_ID.test(id) && Number.isInteger(revision) && revision > 0 && revision <= 2_147_483_647;
}

function parseAddress(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > ADDRESS_BYTES || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(input)) return;
  const address = input.trim();
  if (address && Buffer.byteLength(address, "utf8") <= ADDRESS_BYTES) return address;
}

function context(plan: HomeHelpReviewPlan): Buffer {
  const { app, id, revision, requesterId, helperIds, draft } = plan;
  return Buffer.from(JSON.stringify(["ntwrk-home-help-venue-v1", app, id, revision, requesterId, [...helperIds].sort(), draft.expiresAt]));
}

function seal(key: KeyObject, plan: HomeHelpReviewPlan, address: string): SealedVenue {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(context(plan));
  const clear = Buffer.from(address, "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    return { nonce, ciphertext, auth_tag: cipher.getAuthTag() };
  } finally {
    clear.fill(0);
  }
}

function open(key: KeyObject, plan: HomeHelpReviewPlan, row: SealedVenue): string | undefined {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, row.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(context(plan));
    decipher.setAuthTag(row.auth_tag);
    const clear = decipher.update(row.ciphertext);
    try {
      decipher.final();
      return parseAddress(clear.toString("utf8"));
    } finally {
      clear.fill(0);
    }
  } catch {
    // Missing or corrupt ciphertext and a retired key all deny the read.
    return;
  }
}

/** Call inside the app transaction of a directly verified participant. Plaintext may go only to that request's response. */
export class BoundedHomeHelpVenue {
  constructor(
    private readonly currentConsent: CurrentHomeHelpConsent,
    private readonly privateVenueKey: KeyObject,
    private readonly now: () => number,
  ) {
    if (privateVenueKey.type !== "secret" || privateVenueKey.symmetricKeySize !== 32) {
      throw new Error("Private venue needs a separate 32-byte encryption key");
    }
  }

  private async consentFor(tx: SQL, actor: HomeHelpVenueActor, version: HomeHelpVenueVersion): Promise<HomeHelpReviewPlan | undefined> {
    if (!actor.memberId || !validVersion(version)) return;
    const plan = await this.currentConsent(tx, { app: actor.app, id: version.id, revision: version.revision });
    if (plan?.app === actor.app && plan.id === version.id && plan.revision === version.revision && plan.phase === "Approved" && plan.approval) {
      return plan;
    }
  }

  async submit(tx: SQL, actor: HomeHelpVenueActor, input: HomeHelpVenueVersion & { address: unknown }): Promise<boolean> {
    const address = parseAddress(input.address);
    if (!address) return false;
    const plan = await this.consentFor(tx, actor, input);
    if (!plan || !mayStoreHomeHelpVenue(plan.requesterId === actor.memberId, true, this.now(), plan.draft.expiresAt)) return false;
    const { nonce, ciphertext, auth_tag } = seal(this.privateVenueKey, plan, address);
    const rows = await tx`insert into network.bounded_home_help_venue (app_id, plan_id, revision, expires_at, nonce, ciphertext, auth_tag)
      values (${plan.app}, ${plan.id}, ${plan.revision}, ${new Date(plan.draft.expiresAt)}, ${nonce}, ${ciphertext}, ${auth_tag})
      on conflict (app_id, plan_id) do nothing returning plan_id`;
    return rows.length === 1;
  }

  async reveal(tx: SQL, actor: HomeHelpVenueActor, version: HomeHelpVenueVersion): Promise<{ address: string } | undefined> {
    const plan = await this.consentFor(tx, actor, version);
    if (!plan || !mayReadHomeHelpVenue(plan.helperIds.includes(actor.memberId), true, this.now(), plan.draft.expiresAt)) return;
    const [row] = await tx<StoredVenue[]>`select expires_at, nonce, ciphertext, auth_tag from network.bounded_home_help_venue
      where app_id=${plan.app} and plan_id=${plan.id} and revision=${plan.revision} and ciphertext is not null`;
    if (!row || row.ciphertext === null || row.expires_at.getTime() !== plan.draft.expiresAt
      || !mayReadHomeHelpVenue(true, true, this.now(), plan.draft.expiresAt)) return;
    const address = open(this.privateVenueKey, plan, row);
    if (address) return { address };
  }

  async revoke(tx: SQL, actor: HomeHelpVenueActor, version: HomeHelpVenueVersion): Promise<boolean> {
    if (!actor.memberId || !validVersion(version)) return false;
    const [plan] = await tx<{ requester_id: string; revision: number; expires_at: Date }[]>`
      select requester_id, revision, expires_at from network.bounded_home_help
      where app_id=${actor.app} and id=${version.id} and phase='Approved' for update`;
    if (!plan || !mayRevokeHomeHelpVenue(plan.requester_id === actor.memberId, plan.revision === version.revision, this.now(), plan.expires_at.getTime())) {
      return false;
    }
    const rows = await tx`insert into network.bounded_home_help_venue (app_id, plan_id, revision, expires_at)
      values (${actor.app}, ${version.id}, ${version.revision}, ${plan.expires_at})
      on conflict (app_id, plan_id) do update set nonce=null, ciphertext=null, auth_tag=null
      where bounded_home_help_venue.revision=excluded.revision returning plan_id`;
    return rows.length === 1;
  }

  /** Call from the app's ordinary retention sweep. Access expires regardless of sweep timing. */
  async purgeExpired(tx: SQL, app: AppId): Promise<void> {
    await tx`delete from network.bounded_home_help_venue where app_id=${app} and expires_at<=${new Date(this.now())}`;
  }
}
