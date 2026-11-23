import { randomBytes } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  initial as linkInitial, step as stepLink, uploadLinkBatchAllowed, uploadLinkDailyLimitReached, uploadLinkHolderAllowed, uploadLinkUsable,
  type PhotoUploadLink, type UploadLinkHolder,
} from "../../core/src/generated/photoUploadLink.ts";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import { PgPeopleStore } from "./pg-store.ts";
import { keyedHash } from "./phone.ts";
import { newPhotoBatchId, PHOTO_APPS, PHOTO_CONSENT, PHOTO_MAX_BYTES, RATER_MAX_PHOTOS, type PhotoRefusal, type PhotoService } from "./photos.ts";
import type { MembershipState } from "./store.ts";

export const PHOTO_UPLOAD_PATH = "/api/photos/upload";
export const PHOTO_UPLOAD_LINK_HEADER = "x-photo-upload-link";
export const PHOTO_UPLOAD_PAGE = "/photos/add";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIVE: readonly MembershipState[] = ["active", "paused", "onboarding"];
const BODY_CAP = PHOTO_MAX_BYTES + 64 * 1024;
const DAY_MS = 24 * 60 * 60_000;
const linkAnswer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });

export type UploadLinkIssue = { ok: true; url: string; expiresAt: number } | { ok: false; reason: PhotoRefusal | "held" | "not_member" | "daily_limit" };

export async function writePhotoConsent(tx: SQL, personId: string, app: AppId, at: number, source: "text" | "link"): Promise<boolean> {
  const rows = await tx`update platform.memberships
    set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('photoConsent', ${PHOTO_CONSENT.version}::text, 'photoConsentAt', ${at}::bigint, 'photoConsentSource', ${source}::text)
    where app_id = ${app} and person_id = ${personId}::uuid and state in ('active', 'paused', 'onboarding') returning 1`;
  return rows.length === 1;
}

export interface PhotoUploadLinkOptions {
  sql: SQL;
  photos: PhotoService;
  hashKey: string;
  now: () => number;
  origin: (app: AppId) => string;
  held: (personId: string, app: AppId, tx: SQL) => Promise<boolean>;
  log?: (s: string) => void;
}

export class PhotoUploadLinks {
  constructor(private readonly o: PhotoUploadLinkOptions) {}

  private id(token: string) { return keyedHash(this.o.hashKey, `photo-upload-link:${token}`); }

  private async holder(tx: SQL, personId: string, app: AppId): Promise<{ holder: UploadLinkHolder; refusal?: PhotoRefusal | "held" | "not_member"; consented: boolean }> {
    const refusal = await this.o.photos.mayTake(personId, app, tx);
    const m = await new PgPeopleStore(tx).getMembership(personId, app);
    const liveMember = !!m && LIVE.includes(m.state);
    const held = await this.o.held(personId, app, tx);
    const holder: UploadLinkHolder = {
      takesPhotos: refusal !== "photos_off" && refusal !== "app_not_allowed" && PHOTO_APPS.includes(app),
      adult: refusal !== "adults_only" && refusal !== "not_verified", banned: refusal === "banned", held, liveMember,
    };
    return { holder, refusal: refusal ?? (held ? "held" : liveMember ? undefined : "not_member"), consented: m?.profile.photoConsent === PHOTO_CONSENT.version };
  }

  async refusal(personId: string, app: AppId): Promise<UploadLinkIssue & { ok: false } | undefined> {
    return this.o.sql.begin(async tx => {
      const { holder, refusal } = await this.holder(tx, personId, app);
      return uploadLinkHolderAllowed(holder) ? undefined : { ok: false, reason: refusal ?? "adults_only" } as const;
    });
  }

  async recordConsent(personId: string, app: AppId): Promise<boolean> {
    return this.o.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const { holder } = await this.holder(tx, personId, app);
      return uploadLinkHolderAllowed(holder) && await writePhotoConsent(tx, personId, app, this.o.now(), "text");
    });
  }

  async issue(personId: string, app: AppId, via: "text" | "agent"): Promise<UploadLinkIssue> {
    const token = randomBytes(32).toString("base64url");
    const at = this.o.now();
    return this.o.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      await tx`delete from platform.photo_upload_links where person_id = ${personId}::uuid and issued_at < ${new Date(at - DAY_MS)}`;
      const [{ n }] = await tx`select count(*)::int as n from platform.photo_upload_links where person_id = ${personId}::uuid`;
      if (uploadLinkDailyLimitReached(n as number)) return { ok: false, reason: "daily_limit" } as const;
      const { holder, refusal } = await this.holder(tx, personId, app);
      const link = stepLink(linkInitial, { type: "issueUploadLink", holder, at });
      if (link.phase !== "UploadLinkOpen") return { ok: false, reason: refusal ?? "adults_only" } as const;
      await tx`insert into platform.photo_upload_links (id, person_id, app_id, issued_at, expires_at, via)
        values (${this.id(token)}, ${personId}::uuid, ${app}, ${new Date(link.issuedAt)}, ${new Date(link.expiresAt)}, ${via})`;
      return { ok: true, url: `${this.o.origin(app).replace(/\/+$/, "")}${PHOTO_UPLOAD_PAGE}#${token}`, expiresAt: link.expiresAt } as const;
    });
  }

  async status(req: Request, app: AppId): Promise<Response> {
    const token = req.headers.get(PHOTO_UPLOAD_LINK_HEADER) ?? "";
    if (!TOKEN.test(token)) return linkAnswer(404, { ok: false, error: "link_unavailable" });
    const at = this.o.now();
    const open = await this.o.sql.begin(async tx => {
      const [row] = await tx`select person_id, app_id, issued_at, expires_at, used_at from platform.photo_upload_links where id = ${this.id(token)}`;
      if (!row) return;
      const { holder, consented } = await this.holder(tx, row.person_id as string, row.app_id as AppId);
      const link: PhotoUploadLink = { phase: row.used_at === null ? "UploadLinkOpen" : "UploadLinkSpent", issuedAt: new Date(row.issued_at).getTime(), expiresAt: new Date(row.expires_at).getTime() };
      return uploadLinkUsable(link, holder, row.app_id === app, at) ? { consented } : undefined;
    });
    if (!open) return linkAnswer(410, { ok: false, error: "link_unavailable" });
    return linkAnswer(200, { ok: true, consentRequired: !open.consented, consent: { version: PHOTO_CONSENT.version, text: PHOTO_CONSENT.text } });
  }

  async redeem(req: Request, app: AppId): Promise<Response> {
    const token = req.headers.get(PHOTO_UPLOAD_LINK_HEADER) ?? "";
    if (!TOKEN.test(token)) return linkAnswer(404, { ok: false, error: "link_unavailable" });
    const [open] = await this.o.sql`select 1 from platform.photo_upload_links where id = ${this.id(token)} and used_at is null and expires_at > ${new Date(this.o.now())}`;
    if (!open) return linkAnswer(410, { ok: false, error: "link_unavailable" });
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) return linkAnswer(415, { ok: false, error: "multipart_required" });
    const raw = await readCapped(req, BODY_CAP);
    if (raw === "too_large") return linkAnswer(413, { ok: false, error: "too_large" });
    let photos: Uint8Array[];
    try {
      const form = await new Response(raw as unknown as BodyInit, { headers: { "content-type": type } }).formData();
      if ([...form.keys()].some(k => k !== "photo")) return linkAnswer(400, { ok: false, error: "invalid" });
      const parts = form.getAll("photo");
      if (parts.some(p => typeof p === "string")) return linkAnswer(400, { ok: false, error: "invalid" });
      photos = await Promise.all((parts as Blob[]).map(async p => new Uint8Array(await p.arrayBuffer())));
    } catch { return linkAnswer(400, { ok: false, error: "invalid" }); }
    if (!uploadLinkBatchAllowed(photos.length, Math.max(0, ...photos.map(p => p.length)), photos.reduce((n, p) => n + p.length, 0)))
      return photos.length >= 1 && photos.length <= RATER_MAX_PHOTOS ? linkAnswer(413, { ok: false, error: "too_large" }) : linkAnswer(400, { ok: false, error: "photo_count" });
    const consentGiven = req.headers.get("x-photo-consent") === PHOTO_CONSENT.version;
    const at = this.o.now();
    const outcome = await this.o.sql.begin(async tx => {
      const [row] = await tx`select person_id, app_id, issued_at, expires_at, used_at from platform.photo_upload_links where id = ${this.id(token)} for update`;
      if (!row) return { refused: "link_unavailable" as const };
      const personId = row.person_id as string;
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const { holder, consented } = await this.holder(tx, personId, row.app_id as AppId);
      if (row.used_at === null && uploadLinkHolderAllowed(holder) && !consented && !consentGiven) return { refused: "consent_required" as const };
      const before: PhotoUploadLink = { phase: row.used_at === null ? "UploadLinkOpen" : "UploadLinkSpent", issuedAt: new Date(row.issued_at).getTime(), expiresAt: new Date(row.expires_at).getTime() };
      if (before.phase !== "UploadLinkOpen") return { refused: "link_unavailable" as const };
      const after = stepLink(before, { type: "redeemUploadLink", holder, sameApp: row.app_id === app, at });
      const spent = after.phase === "UploadLinkSpent" && (consented || await writePhotoConsent(tx, personId, app, at, "link"));
      await tx`update platform.photo_upload_links set used_at = ${new Date(at)}, outcome = ${spent ? "uploaded" : "refused"} where id = ${this.id(token)}`;
      if (!spent) return { refused: "link_unavailable" as const };
      return { personId, linkApp: row.app_id as AppId };
    });
    if ("refused" in outcome) return outcome.refused === "consent_required" ? linkAnswer(400, { ok: false, error: "consent_required" }) : linkAnswer(410, { ok: false, error: "link_unavailable" });
    const stored: string[] = [], refused: PhotoRefusal[] = [];
    const holderRefused = () => this.o.sql.begin(async tx => {
      const { holder } = await this.holder(tx, outcome.personId, outcome.linkApp);
      return holder.held || !holder.liveMember;
    });
    const batchId = newPhotoBatchId();
    for (const bytes of photos) {
      const r = await this.o.photos.upload(outcome.personId, app, bytes, PHOTO_CONSENT.version, holderRefused, batchId);
      if (r.ok) stored.push(r.value.id); else refused.push(r.reason);
    }
    this.o.log?.(`[photos] upload link used: ${stored.length} stored, ${refused.length} refused`);
    return linkAnswer(stored.length ? 200 : 422, { ok: stored.length > 0, stored: stored.length, refused });
  }
}
