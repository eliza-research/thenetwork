import { randomBytes } from "node:crypto";
import { DAY } from "../../core/src/clock.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  initial as linkInitial, step as stepLink, uploadLinkBatchAllowed, uploadLinkDailyLimitReached, uploadLinkHolderAllowed, uploadLinkUsable,
  type PhotoUploadLink, type UploadLinkHolder,
} from "../../core/src/generated/photoUploadLink.ts";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import { PgPeopleStore } from "./pg-store.ts";
import { keyedHash } from "./phone.ts";
import { privateJson } from "./photo-pages.ts";
import { LIVE_MEMBERSHIP, newPhotoBatchId, PHOTO_APPS, PHOTO_CONSENT, PHOTO_MAX_BYTES, RATER_MAX_PHOTOS, type PhotoRefusal, type PhotoService } from "./photos.ts";

export const PHOTO_UPLOAD_PATH = "/api/photos/upload";
const PHOTO_UPLOAD_LINK_HEADER = "x-photo-upload-link";
const PHOTO_UPLOAD_PAGE = "/photos/add";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BODY_CAP = PHOTO_MAX_BYTES + 64 * 1024;
const linkOf = (row: Record<string, unknown>): PhotoUploadLink => ({
  phase: row.used_at === null ? "UploadLinkOpen" : "UploadLinkSpent",
  issuedAt: new Date(row.issued_at as Date).getTime(), expiresAt: new Date(row.expires_at as Date).getTime(),
});

export type UploadLinkIssue = { ok: true; url: string; expiresAt: number } | { ok: false; reason: PhotoRefusal | "held" | "not_member" | "daily_limit" };

async function writePhotoConsent(tx: SQL, personId: string, app: AppId, at: number, source: "text" | "link"): Promise<boolean> {
  const rows = await tx`update platform.memberships
    set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('photoConsent', ${PHOTO_CONSENT.version}::text, 'photoConsentAt', ${at}::bigint, 'photoConsentSource', ${source}::text)
    where app_id = ${app} and person_id = ${personId}::uuid and state = any(${tx.array([...LIVE_MEMBERSHIP], "TEXT")}) returning 1`;
  return rows.length === 1;
}

interface PhotoUploadLinkOptions {
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
    await tx`select set_config('app.app_id', ${app}, true),
      set_config('app.age_as_of', ${new Date(this.o.now()).toISOString()}, true)`;
    const refusal = await this.o.photos.mayTake(personId, app, tx);
    const m = await new PgPeopleStore(tx).getMembership(personId, app);
    const liveMember = !!m && LIVE_MEMBERSHIP.includes(m.state) && m.review === null;
    const [phone] = await tx`select 1 from platform.phone_identities where person_id = ${personId}::uuid and hold is null limit 1`;
    const held = !phone || await this.o.held(personId, app, tx);
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
    return this.o.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const at = this.o.now();
      await tx`delete from platform.photo_upload_links where person_id = ${personId}::uuid and issued_at < ${new Date(at - DAY)}`;
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
    if (!TOKEN.test(token)) return privateJson(404, { ok: false, error: "link_unavailable" });
    const open = await this.o.sql.begin(async tx => {
      const [row] = await tx`select person_id, app_id, issued_at, expires_at, used_at from platform.photo_upload_links where id = ${this.id(token)}`;
      if (!row) return;
      const { holder, consented } = await this.holder(tx, row.person_id as string, row.app_id as AppId);
      return uploadLinkUsable(linkOf(row), holder, row.app_id === app, this.o.now()) ? { consented } : undefined;
    });
    if (!open) return privateJson(410, { ok: false, error: "link_unavailable" });
    return privateJson(200, { ok: true, consentRequired: !open.consented, consent: { version: PHOTO_CONSENT.version, text: PHOTO_CONSENT.text } });
  }

  async redeem(req: Request, app: AppId): Promise<Response> {
    const token = req.headers.get(PHOTO_UPLOAD_LINK_HEADER) ?? "";
    if (!TOKEN.test(token)) return privateJson(404, { ok: false, error: "link_unavailable" });
    const id = this.id(token);
    const [open] = await this.o.sql<{ person_id: string }[]>`select person_id from platform.photo_upload_links
      where id = ${id} and used_at is null and expires_at > ${new Date(this.o.now())}`;
    if (!open) return privateJson(410, { ok: false, error: "link_unavailable" });
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) return privateJson(415, { ok: false, error: "multipart_required" });
    const raw = await readCapped(req, BODY_CAP);
    if (raw === "too_large") return privateJson(413, { ok: false, error: "too_large" });
    let photos: Uint8Array[];
    try {
      const form = await new Response(new Uint8Array(raw), { headers: { "content-type": type } }).formData();
      if ([...form.keys()].some(k => k !== "photo")) return privateJson(400, { ok: false, error: "invalid" });
      const parts = form.getAll("photo");
      if (parts.some(p => typeof p === "string")) return privateJson(400, { ok: false, error: "invalid" });
      photos = await Promise.all((parts as Blob[]).map(async p => new Uint8Array(await p.arrayBuffer())));
    } catch { return privateJson(400, { ok: false, error: "invalid" }); }
    if (!uploadLinkBatchAllowed(photos.length, Math.max(0, ...photos.map(p => p.length)), photos.reduce((n, p) => n + p.length, 0)))
      return photos.length >= 1 && photos.length <= RATER_MAX_PHOTOS ? privateJson(413, { ok: false, error: "too_large" }) : privateJson(400, { ok: false, error: "photo_count" });
    const consentGiven = req.headers.get("x-photo-consent") === PHOTO_CONSENT.version;
    const outcome = await this.o.sql.begin(async tx => {
      // Account erasure and link issuance lock the person before changing its links.
      const personId = open.person_id;
      const [person] = await tx`select id from platform.people where id = ${personId}::uuid and deleted_at is null for update`;
      if (!person) return { refused: "link_unavailable" as const };
      const [row] = await tx`select app_id, issued_at, expires_at, used_at from platform.photo_upload_links
        where id = ${id} and person_id = ${personId}::uuid for update`;
      if (!row) return { refused: "link_unavailable" as const };
      const { holder, consented } = await this.holder(tx, personId, row.app_id as AppId);
      const at = this.o.now();
      const before = linkOf(row);
      if (before.phase !== "UploadLinkOpen") return { refused: "link_unavailable" as const };
      const sameApp = row.app_id === app;
      if (uploadLinkUsable(before, holder, sameApp, at) && !consented && !consentGiven) return { refused: "consent_required" as const };
      const after = stepLink(before, { type: "redeemUploadLink", holder, sameApp, at });
      const spent = after.phase === "UploadLinkSpent" && (consented || await writePhotoConsent(tx, personId, app, at, "link"));
      await tx`update platform.photo_upload_links set used_at = ${new Date(at)}, outcome = ${spent ? "uploaded" : "refused"} where id = ${id}`;
      if (!spent) return { refused: "link_unavailable" as const };
      return { personId };
    });
    if ("refused" in outcome) return outcome.refused === "consent_required" ? privateJson(400, { ok: false, error: "consent_required" }) : privateJson(410, { ok: false, error: "link_unavailable" });
    const stored: string[] = [], refused: PhotoRefusal[] = [];
    const admit = async (tx?: SQL): Promise<PhotoRefusal | undefined> => {
      const check = async (current: SQL): Promise<PhotoRefusal | undefined> => {
        const { holder, refusal, consented } = await this.holder(current, outcome.personId, app);
        if (!uploadLinkHolderAllowed(holder)) return refusal === "held" ? "not_member" : refusal ?? "not_member";
        if (!consented) return "consent_required";
      };
      return tx ? check(tx) : this.o.sql.begin(check);
    };
    const batchId = newPhotoBatchId();
    for (const bytes of photos) {
      const r = await this.o.photos.upload(outcome.personId, app, bytes, PHOTO_CONSENT.version, admit, batchId);
      if (r.ok) stored.push(r.value.id); else refused.push(r.reason);
    }
    this.o.log?.(`[photos] upload link used: ${stored.length} stored, ${refused.length} refused`);
    return privateJson(stored.length ? 200 : 422, { ok: stored.length > 0, stored: stored.length, refused });
  }
}
