// spec/photoUploadLink.md, "Story: Add my photos with a private one-time link"
//
// The member gets one app-bound link by text (photoIntake.ts) and a page on the app's site posts the
// batch to POST /api/photos/upload with the link token in the X-Photo-Upload-Link header. The token is
// random and is kept only as a keyed hash. The link is bound to the person and the app it was issued
// for: a session cookie or any other input never names the person. Each photo then goes through
// PhotoService.upload, which checks the consent, the adult rule, the ban, the type, the size and the
// slots again, strips metadata, stores the photo privately and rates the member.
import { randomBytes } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  initial as linkInitial, step as stepLink, uploadLinkBatchAllowed, uploadLinkDailyLimitReached,
  type PhotoUploadLink, type UploadLinkHolder,
} from "../../core/src/generated/photoUploadLink.ts";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import { PgPeopleStore } from "./pg-store.ts";
import { keyedHash } from "./phone.ts";
import { PHOTO_APPS, PHOTO_CONSENT, RATER_MAX_BYTES, RATER_MAX_PHOTOS, type PhotoRefusal, type PhotoService } from "./photos.ts";
import type { MembershipState } from "./store.ts";

export const PHOTO_UPLOAD_PATH = "/api/photos/upload";
export const PHOTO_UPLOAD_LINK_HEADER = "x-photo-upload-link";
/** The page the app's site serves for the link. The token is in the fragment, so it never reaches a server log. */
export const PHOTO_UPLOAD_PAGE = "/photos/add";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIVE: readonly MembershipState[] = ["active", "paused", "onboarding"];
/** The multipart body: the photos and the part headers (a few hundred bytes a part). */
const BODY_CAP = RATER_MAX_PHOTOS * RATER_MAX_BYTES + 64 * 1024;
const DAY_MS = 24 * 60 * 60_000;

export type UploadLinkIssue = { ok: true; url: string; expiresAt: number } | { ok: false; reason: PhotoRefusal | "held" | "not_member" | "daily_limit" };

export interface PhotoUploadLinkOptions {
  sql: SQL;
  photos: PhotoService;
  hashKey: string;
  now: () => number;
  /** The app's public origin, such as https://slop.date. */
  origin: (app: AppId) => string;
  /** A staff hold that covers this person on this app (staff-safety-holds.ts currentStaffHold). */
  held: (personId: string, app: AppId, tx: SQL) => Promise<boolean>;
  log?: (s: string) => void;
}

export class PhotoUploadLinks {
  constructor(private readonly o: PhotoUploadLinkOptions) {}

  private id(token: string) { return keyedHash(this.o.hashKey, `photo-upload-link:${token}`); }

  /** The facts the link machine needs about its holder now, read in the caller's transaction. */
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

  /** spec/photoUploadLink.md, "A link is issued only to an adult live member of a photo app who is not banned or held" */
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

  /**
   * POST /api/photos/upload: one use of a link. spec/photoUploadLink.md, "A link uploads once, before it
   * expires, on its own app, for a holder who is still eligible"; "One link use carries one to four
   * photos of at most four MiB each".
   */
  async redeem(req: Request, app: AppId): Promise<Response> {
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
    const token = req.headers.get(PHOTO_UPLOAD_LINK_HEADER) ?? "";
    if (!TOKEN.test(token)) return json(404, { ok: false, error: "link_unavailable" });
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) return json(415, { ok: false, error: "multipart_required" });
    const raw = await readCapped(req, BODY_CAP);
    if (raw === "too_large") return json(413, { ok: false, error: "too_large" });
    let photos: Uint8Array[];
    try {
      const form = await new Response(raw as unknown as BodyInit, { headers: { "content-type": type } }).formData();
      if ([...form.keys()].some(k => k !== "photo")) return json(400, { ok: false, error: "invalid" });
      const parts = form.getAll("photo");
      if (parts.some(p => typeof p === "string")) return json(400, { ok: false, error: "invalid" });
      photos = await Promise.all((parts as Blob[]).map(async p => new Uint8Array(await p.arrayBuffer())));
    } catch { return json(400, { ok: false, error: "invalid" }); }
    if (!uploadLinkBatchAllowed(photos.length, Math.max(0, ...photos.map(p => p.length))))
      return photos.length >= 1 && photos.length <= RATER_MAX_PHOTOS ? json(413, { ok: false, error: "too_large" }) : json(400, { ok: false, error: "photo_count" });
    const consentGiven = req.headers.get("x-photo-consent") === PHOTO_CONSENT.version;
    const at = this.o.now();
    const outcome = await this.o.sql.begin(async tx => {
      const [row] = await tx`select person_id, app_id, issued_at, expires_at, used_at from platform.photo_upload_links where id = ${this.id(token)} for update`;
      if (!row) return { refused: "link_unavailable" as const };
      const personId = row.person_id as string;
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const { holder, consented } = await this.holder(tx, personId, row.app_id as AppId);
      // The consent is checked before the link is used, so a member who missed the box keeps the link.
      if (row.used_at === null && !consented && !consentGiven) return { refused: "consent_required" as const };
      const before: PhotoUploadLink = { phase: row.used_at === null ? "UploadLinkOpen" : "UploadLinkSpent", issuedAt: new Date(row.issued_at).getTime(), expiresAt: new Date(row.expires_at).getTime() };
      if (before.phase !== "UploadLinkOpen") return { refused: "link_unavailable" as const };
      const after = stepLink(before, { type: "redeemUploadLink", holder, sameApp: row.app_id === app, at });
      await tx`update platform.photo_upload_links set used_at = ${new Date(at)}, outcome = ${after.phase === "UploadLinkSpent" ? "uploaded" : "refused"} where id = ${this.id(token)}`;
      if (after.phase !== "UploadLinkSpent") return { refused: "link_unavailable" as const };
      if (!consented) {
        const people = new PgPeopleStore(tx), m = (await people.getMembership(personId, app))!;
        await people.putMembership({ ...m, profile: { ...m.profile, photoConsent: PHOTO_CONSENT.version, photoConsentAt: at, photoConsentSource: "link" } });
      }
      return { personId };
    });
    if ("refused" in outcome) return outcome.refused === "consent_required" ? json(400, { ok: false, error: "consent_required" }) : json(410, { ok: false, error: "link_unavailable" });
    const stored: string[] = [], refused: PhotoRefusal[] = [];
    for (const bytes of photos) {
      const r = await this.o.photos.upload(outcome.personId, app, bytes, PHOTO_CONSENT.version);
      if (r.ok) stored.push(r.value.id); else refused.push(r.reason);
    }
    this.o.log?.(`[photos] upload link used: ${stored.length} stored, ${refused.length} refused`);
    return json(stored.length ? 200 : 422, { ok: stored.length > 0, stored: stored.length, refused });
  }
}
