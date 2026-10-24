// Voluntary selected-item sharing. Appearance scores and gallery/staff links never enter this path.
// No production policy is supplied by default: uploading privately does not authorize item review.
import { privateJson } from "./response.ts";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SQL } from "bun";
import type { ApprovedRelayPhoto } from "../../core/src/svc/contract.ts";
import type { AppId } from "./apps.ts";
import type { PhotoService, PhotoRow, PhotoType } from "./photos.ts";
import { readCapped } from "./body.ts";

export const PHOTO_RELAY_TTL = 15 * 60_000;
const FETCH_TTL = 60_000;
const opaque = () => { for (;;) { const id = randomBytes(16).toString("hex"); if (!/\d{7}/.test(id)) return id; } };
export interface PhotoRelayParties {
  threadId: string; senderPersonId: string; recipientPersonId: string;
  senderMemberId: string; recipientMemberId: string;
}
export interface PhotoRelayItem extends PhotoRelayParties {
  id: string; app: AppId; photoId: string; sha256: string; bytes: number; contentType: PhotoType;
  consentId: string; consentedAt: number; expiresAt: number; policyVersion: string; policyNotice: string; notice: string;
  state: "pending" | "approved" | "rejected" | "revoked";
  reviewId: string | null; reviewedAt: number | null; reviewerId: string | null;
  actionId: string | null; deliveryIntent: string | null; deliveryExpiresAt: number | null;
}
export interface PhotoRelayStore {
  create(item: PhotoRelayItem, requestId: string, requestHash: string): Promise<{ item?: PhotoRelayItem; conflict?: true }>;
  owned(app: AppId, personId: string): Promise<PhotoRelayItem[]>;
  list(app: AppId): Promise<PhotoRelayItem[]>;
  /** Callback and state transition share a durable item lock; throw rolls back. */
  locked<T>(id: string, fn: (item: PhotoRelayItem | undefined, save: (item: PhotoRelayItem) => Promise<void>, tx: SQL) => Promise<T>, tx?: SQL): Promise<T>;
}
const itemRow = (r: Record<string, any>): PhotoRelayItem => ({
  id: r.id, app: r.app_id, photoId: r.photo_id, threadId: r.thread_id,
  senderPersonId: r.sender_person_id, recipientPersonId: r.recipient_person_id,
  senderMemberId: r.sender_member_id, recipientMemberId: r.recipient_member_id,
  sha256: r.content_sha256, bytes: r.content_bytes, contentType: r.content_type,
  consentId: r.consent_id, consentedAt: new Date(r.consented_at).getTime(), expiresAt: new Date(r.expires_at).getTime(),
  policyVersion: r.policy_version, policyNotice: r.policy_notice, notice: r.notice, state: r.state, reviewId: r.review_id,
  reviewedAt: r.reviewed_at === null ? null : new Date(r.reviewed_at).getTime(), reviewerId: r.reviewer_id, actionId: r.action_id, deliveryIntent: r.delivery_intent, deliveryExpiresAt: r.delivery_expires_at === null ? null : new Date(r.delivery_expires_at).getTime(),
});
export class PgPhotoRelayStore implements PhotoRelayStore {
  constructor(private readonly sql: SQL) {}
  async create(r: PhotoRelayItem, requestId: string, requestHash: string) {
    let result: { item?: PhotoRelayItem; conflict?: true } = {};
    await this.sql.begin(async tx => {
      const inserted = await tx`insert into platform.photo_relay_requests (sender_person_id,app_id,request_id,request_hash,item_id)
        values (${r.senderPersonId}::uuid,${r.app},${requestId},${requestHash},${r.id}) on conflict do nothing returning item_id`;
      const [request] = await tx`select * from platform.photo_relay_requests where sender_person_id=${r.senderPersonId}::uuid and app_id=${r.app} and request_id=${requestId}`;
      if (!request || request.request_hash !== requestHash || request.item_id !== r.id) { result = { conflict: true }; return; }
      if (!inserted.length) {
        const [existing] = await tx`select * from platform.photo_relay_items where id=${r.id}`;
        result = { item: existing ? itemRow(existing) : undefined }; return;
      }
      await tx`insert into platform.photo_relay_items
      (id,app_id,sender_person_id,recipient_person_id,photo_id,thread_id,sender_member_id,recipient_member_id,
       content_sha256,content_type,content_bytes,consent_id,consented_at,expires_at,policy_version,policy_notice,notice,state)
      values (${r.id},${r.app},${r.senderPersonId}::uuid,${r.recipientPersonId}::uuid,${r.photoId},${r.threadId},
       ${r.senderMemberId},${r.recipientMemberId},${r.sha256},${r.contentType},${r.bytes},${r.consentId},
       ${new Date(r.consentedAt)},${new Date(r.expiresAt)},${r.policyVersion},${r.policyNotice},${r.notice},${r.state})`;
      result = { item: r };
    });
    return result;
  }
  async owned(app: AppId, personId: string) {
    return (await this.sql`select * from platform.photo_relay_items where app_id=${app} and sender_person_id=${personId}::uuid order by consented_at desc,id`).map(itemRow);
  }
  async list(app: AppId) {
    return (await this.sql`select * from platform.photo_relay_items where app_id=${app} and state in ('pending','approved') order by consented_at,id`).map(itemRow);
  }
  async locked<T>(id: string, fn: (item: PhotoRelayItem | undefined, save: (item: PhotoRelayItem) => Promise<void>, tx: SQL) => Promise<T>, transaction?: SQL): Promise<T> {
    let result!: T;
    const perform = async (tx: SQL) => {
      const [row] = await tx`select * from platform.photo_relay_items where id=${id} for update`;
      result = await fn(row ? itemRow(row) : undefined, async r => {
        // Identity/content/consent are immutable. Only a locked review/revocation transition may change.
        if (!row || r.id !== id) throw new Error("photo_relay_missing");
        await tx`update platform.photo_relay_items set state=${r.state},review_id=${r.reviewId},
          reviewed_at=${r.reviewedAt === null ? null : new Date(r.reviewedAt)},reviewer_id=${r.reviewerId},action_id=${r.actionId},delivery_intent=${r.deliveryIntent},delivery_expires_at=${r.deliveryExpiresAt === null ? null : new Date(r.deliveryExpiresAt)} where id=${id}`;
      }, tx);
    };
    if (transaction) await perform(transaction); else await this.sql.begin(perform);
    return result;
  }
}
export interface PhotoRelayPolicy {
  /** Must identify an actually approved selected-item review policy and its exact human notice. */
  version: string; notice: string;
  authorizeReviewer(reviewerId: string, item: Readonly<PhotoRelayItem>, tx?: SQL): Promise<boolean>;
}
export interface PhotoRelayOptions {
  store: PhotoRelayStore; photos: PhotoService; signingKey: string; now?: () => number;
  /** No policy configured until the specific reviewer purpose/notice/safety path is approved. */
  policy?: PhotoRelayPolicy;
  /** Canonical RelayDesk check: active mutual match, exact parties, adults, membership, STOP, blocks and holds. */
  authorize(input: { app: AppId; threadId: string; senderPersonId: string }, tx?: SQL): Promise<Omit<PhotoRelayParties, "threadId"> | undefined>;
  /** Only current authorized threads; returned labels must contain no private profile facts. */
  threads(app: AppId, senderPersonId: string): Promise<{ id: string; label: string }[]>;
}
class SelectionConflict extends Error { constructor() { super("photo_selection_conflict"); } }
export class PhotoRelayService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoRelayOptions) { this.now = o.now ?? Date.now; }
  get enabled() { return !!this.o.policy && this.o.photos.enabled; }
  private async current(r: PhotoRelayItem, tx?: SQL): Promise<PhotoRow | undefined> {
    if (!this.enabled || r.policyVersion !== this.o.policy!.version || r.policyNotice !== this.o.policy!.notice || r.expiresAt <= this.now() || r.state === "revoked" || r.state === "rejected") return;
    const p = await this.o.authorize({ app: r.app, threadId: r.threadId, senderPersonId: r.senderPersonId }, tx);
    if (!p || !sameParties({ ...p, threadId: r.threadId }, r)) return;
    const photo = await this.o.photos.relayPhoto(r.senderPersonId, r.app, r.photoId, r, tx);
    if (!this.enabled || r.expiresAt <= this.now() || r.policyVersion !== this.o.policy!.version || r.policyNotice !== this.o.policy!.notice) return;
    return photo;
  }
  async select(app: AppId, senderPersonId: string, threadId: string, photoId: string, noticeVersion: string, consent: boolean, requestId: string) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return undefined;
    if (!this.enabled || !/^ph_[a-f0-9]{24}$/.test(photoId) || !threadId || threadId.length > 200) return undefined;
    if (!consent || noticeVersion !== this.o.policy!.version) return undefined;
    const parties = await this.o.authorize({ app, threadId, senderPersonId });
    if (!parties || parties.senderPersonId !== senderPersonId || parties.senderPersonId === parties.recipientPersonId || parties.senderMemberId === parties.recipientMemberId) return undefined;
    const photo = await this.o.photos.relayPhoto(senderPersonId, app, photoId);
    if (!photo) return undefined;
    const thread = (await this.o.threads(app, senderPersonId)).find(t => t.id === threadId);
    if (!thread || !this.o.policy!.notice.includes("{{recipient}}")) return undefined;
    const notice = this.o.policy!.notice.replaceAll("{{recipient}}", thread.label);
    const at = this.now();
    const itemId = `pri_${createHmac("sha256", `photo-selection:${this.o.signingKey}`).update(JSON.stringify([app, senderPersonId, requestId])).digest("hex").slice(0, 32)}`;
    const requestHash = createHash("sha256").update(JSON.stringify({ photoId, threadId, noticeVersion, consent, parties, sha256: photo.sha256, bytes: photo.bytes, contentType: photo.contentType, policyNotice: this.o.policy!.notice, notice })).digest("hex");
    const item: PhotoRelayItem = { ...parties, threadId, id: itemId, app, photoId, sha256: photo.sha256, bytes: photo.bytes,
      contentType: photo.contentType, consentId: `prc_${opaque()}`, consentedAt: at, expiresAt: at + PHOTO_RELAY_TTL,
      policyVersion: this.o.policy!.version, policyNotice: this.o.policy!.notice, notice, state: "pending", reviewId: null, reviewedAt: null, reviewerId: null, actionId: null, deliveryIntent: null, deliveryExpiresAt: null };
    const created = await this.o.store.create(item, requestId, requestHash);
    if (created.conflict) throw new SelectionConflict();
    const saved = created.item;
    if (!saved) return undefined;
    // Replay returns the original immutable consent/deadline, never a fresh item.
    if (!(await this.current(saved))) return { itemId: saved.id, state: saved.expiresAt <= this.now() ? "expired" : saved.state, expiresAt: saved.expiresAt };
    return { itemId: saved.id, state: saved.state, expiresAt: saved.expiresAt };
  }
  async revoke(app: AppId, personId: string, id: string): Promise<boolean> {
    return this.o.store.locked(id, async (r, save) => {
      if (!r || r.app !== app || r.senderPersonId !== personId) return false;
      await save({ ...r, state: "revoked" }); return true;
    });
  }
  /** Item-scoped review: never a fabricated report and never an appearance rating. Unknown stays pending. */
  async review(id: string, reviewerId: string, decision: "safe" | "unsafe" | "unknown", tx?: SQL): Promise<boolean> {
    return this.o.store.locked(id, async (r, save, context) => {
      if (!r || !this.enabled || r.policyVersion !== this.o.policy!.version || r.policyNotice !== this.o.policy!.notice || (r.state !== "pending" && r.state !== "approved") || !(await this.o.policy!.authorizeReviewer(reviewerId, r, context))) return false;
      if ((decision !== "safe" && decision !== "unsafe") || this.now() >= r.expiresAt) return false;
      if (decision === "safe" && (r.state !== "pending" || !(await this.current(r, context)))) return false;
      if (this.now() >= r.expiresAt) return false;
      // A safety rejection can revoke even a claimed item; retain its action/intent bindings.
      await save({ ...r, state: decision === "safe" ? "approved" : r.state === "approved" ? "revoked" : "rejected", reviewId: `prv_${opaque()}`, reviewedAt: this.now(), reviewerId });
      return true;
    }, tx);
  }
  /** Release/retry authorization, including inside the queue claim transaction. No bytes are read. */
  async reviewAuthorized(id: string, reviewerId: string, tx?: SQL): Promise<boolean> {
    return this.o.store.locked(id, async (r, _save, context) => {
      if (!r || (r.state !== "pending" && r.state !== "approved") || !(await this.current(r, context)) || !(await this.o.policy!.authorizeReviewer(reviewerId, r, context))) return false;
      return this.enabled && r.expiresAt > this.now() && r.policyVersion === this.o.policy!.version && r.policyNotice === this.o.policy!.notice;
    }, tx);
  }
  /** Called only by the existing authenticated safety console after item-scoped authorization. */
  async reviewBytes(id: string, reviewerId: string) {
    return this.o.store.locked(id, async (r, _save, context) => {
      if (!r || !(r.state === "pending" || (r.state === "approved" && r.actionId === null)) || !(await this.current(r, context)) || !(await this.o.policy!.authorizeReviewer(reviewerId, r, context))) return;
      if (r.expiresAt <= this.now()) return;
      const bytes = await this.o.photos.relayBytes(r.senderPersonId, r.app, r.photoId, r, context);
      return r.expiresAt > this.now() ? bytes : undefined;
    });
  }
  /** Internal console/queue only; never returned by a member API or the model. */
  async item(id: string) { return this.o.store.locked(id, async r => r); }
  async held(app: AppId) {
    const rows = await this.o.store.list(app), held: { id: string; app: AppId; photoId: string; threadId: string; senderMemberId: string; recipientMemberId: string; createdAt: number }[] = [];
    for (const r of rows) if ((r.state === "pending" || (r.state === "approved" && r.actionId === null)) && await this.current(r)) held.push({ id: r.id, app: r.app, photoId: r.photoId, threadId: r.threadId, senderMemberId: r.senderMemberId, recipientMemberId: r.recipientMemberId, createdAt: r.consentedAt });
    return held;
  }
  async approvedForParty(app: AppId, threadId: string, senderMemberId: string): Promise<ApprovedRelayPhoto | undefined> {
    const rows = (await this.o.store.list(app)).filter(r => r.threadId === threadId && r.senderMemberId === senderMemberId && r.state === "approved" && r.actionId === null);
    const eligible: ApprovedRelayPhoto[] = [];
    for (const r of rows) { const d = await this.approved(r.id); if (d) eligible.push(d); }
    return eligible.length === 1 ? eligible[0] : undefined;
  }
  async approved(id: string, tx?: SQL): Promise<ApprovedRelayPhoto | undefined> {
    return this.o.store.locked(id, async (r, _save, context) => r && r.state === "approved" && await this.current(r, context) ? descriptor(r) : undefined, tx);
  }
  /** Runs INSIDE the normal completeAction transaction; one selection can bind only one action. */
  async claimForAction(tx: SQL, id: string, app: AppId, threadId: string, senderMemberId: string, actionId: string): Promise<ApprovedRelayPhoto | undefined> {
    if (!actionId || actionId.length > 200) return;
    return this.o.store.locked(id, async (r, save, context) => {
      if (!r || r.app !== app || r.threadId !== threadId || r.senderMemberId !== senderMemberId || r.state !== "approved" || (r.actionId !== null && r.actionId !== actionId) || !(await this.current(r, context))) return;
      await save({ ...r, actionId });
      return descriptor(r);
    }, tx);
  }
  /** Trusted service caller only: a durable claimed action and exact intended member. */
  async issueDelivery(d: ApprovedRelayPhoto, recipientMemberId: string, providerIntentKey: string, origin: string) {
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(providerIntentKey)) return;
    const base = new URL(origin);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) return;
    return this.o.store.locked(d.itemId, async (r, save, context) => {
      if (!r || !r.actionId || r.state !== "approved" || recipientMemberId !== r.recipientMemberId || (r.deliveryIntent !== null && r.deliveryIntent !== providerIntentKey) || !sameDescriptor(d, descriptor(r)) || !(await this.current(r, context))) return;
      // First resolve fixes the deadline durably. Receipt recovery must precede any retry;
      // the same intent can neither extend nor resurrect an expired capability.
      const exp = r.deliveryExpiresAt ?? Math.min(r.expiresAt, this.now() + FETCH_TTL);
      if (exp <= this.now()) return;
      const bound = { ...r, deliveryIntent: providerIntentKey, deliveryExpiresAt: exp };
      if (r.deliveryIntent === null) await save(bound);
      if (exp <= this.now() || r.expiresAt <= this.now()) return;
      const sig = this.sign(bound, exp);
      return { photoId: d.photoId, sha256: d.sha256, bytes: d.bytes, contentType: d.contentType,
        url: `${base.origin}/api/relay-photos/deliver/${r.id}?exp=${exp}&sig=${sig}` };
    });
  }
  private sign(r: PhotoRelayItem, exp: number) { return createHmac("sha256", `selected-photo-delivery:${this.o.signingKey}`).update(JSON.stringify({ d: descriptor(r), action: r.actionId, intent: r.deliveryIntent, exp })).digest("base64url"); }
  async delivery(app: AppId | undefined, id: string, exp: number, sig: string) {
    if (!Number.isSafeInteger(exp) || exp <= this.now() || exp > this.now() + FETCH_TTL || sig.length > 100) return;
    return this.o.store.locked(id, async (r, _save, context) => {
      if (!r || (app !== undefined && r.app !== app) || !r.actionId || !r.deliveryIntent || r.state !== "approved" || exp <= this.now() || exp !== r.deliveryExpiresAt || exp > r.expiresAt) return;
      const want = Buffer.from(this.sign(r, exp)), got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got) || !(await this.current(r, context)) || exp <= this.now()) return;
      const bytes = await this.o.photos.relayBytes(r.senderPersonId, r.app, r.photoId, r, context);
      return exp > this.now() && r.expiresAt > this.now() ? bytes : undefined;
    });
  }
  /** Provider fetch capability: no browser session or cross-app gallery authority is accepted here. */
  async serveDelivery(req: Request): Promise<Response | undefined> {
    const u = new URL(req.url);
    const match = /^\/api\/relay-photos\/deliver\/(pri_[a-f0-9]{32})$/.exec(u.pathname);
    if (!match || req.method !== "GET") return;
    const value = await this.delivery(undefined, match[1]!, Number(u.searchParams.get("exp")), u.searchParams.get("sig") ?? "");
    if (!value) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    return new Response(value.bytes as unknown as BodyInit, { headers: { "content-type": value.contentType, "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
  }
  async route(req: Request, path: string, app: AppId, who: () => Promise<{ personId: string; accountView: string } | undefined>): Promise<Response | undefined> {
    if (!path.startsWith("/api/relay-photos/")) return;
    const json = (status: number, body: unknown) => privateJson(body, status);
    const identity = await who();
    if (!identity) return json(401, { ok: false, error: "unauthorized" });
    const person = identity.personId;
    if (req.method === "POST" && req.headers.get("x-photo-account") !== identity.accountView) return json(409, { ok: false, error: "account_changed" });
    if (path === "/api/relay-photos/options" && req.method === "GET") {
      const selections = (await this.o.store.owned(app, person)).map(r => ({ itemId: r.id, photoId: r.photoId, state: r.expiresAt <= this.now() ? "expired" : r.state, expiresAt: r.expiresAt }));
      const enabled = this.enabled && !(await this.o.photos.mayTake(person, app));
      return json(200, { ok: true, accountView: identity.accountView, enabled, selections,
        ...(enabled ? { version: this.o.policy!.version, notice: this.o.policy!.notice } : {}),
        threads: enabled ? await this.o.threads(app, person) : [] });
    }
    if (req.method !== "POST") return json(404, { ok: false, error: "not_found" });
    const raw = await readCapped(req, 4096); if (raw === "too_large") return json(413, { ok: false, error: "too_large" });
    let b: Record<string, unknown>;
    try { b = JSON.parse(new TextDecoder().decode(raw)); if (!b || typeof b !== "object" || Array.isArray(b)) throw 0; } catch { return json(400, { ok: false, error: "invalid" }); }
    // Cancellation is an ownership operation, not a new photo/consent action. It remains available
    // after policy withdrawal, STOP, a hold or loss of photo eligibility.
    if (path === "/api/relay-photos/revoke" && Object.keys(b).length === 1 && typeof b.itemId === "string") return await this.revoke(app, person, b.itemId) ? json(200, { ok: true }) : json(404, { ok: false, error: "not_found" });
    if (!this.enabled) return json(503, { ok: false, error: "photo_relay_off" });
    if (await this.o.photos.mayTake(person, app)) return json(403, { ok: false, error: "unavailable" });
    if (path === "/api/relay-photos/select" && Object.keys(b).every(k => ["photoId","threadId","noticeVersion","consent"].includes(k)) && typeof b.photoId === "string" && typeof b.threadId === "string" && typeof b.noticeVersion === "string" && b.consent === true) {
      try {
        const item = await this.select(app, person, b.threadId, b.photoId, b.noticeVersion, true, req.headers.get("idempotency-key") ?? "");
        return item ? json(200, { ok: true, ...item }) : json(403, { ok: false, error: "unavailable" });
      } catch (e) { if (e instanceof SelectionConflict) return json(409, { ok: false, error: "selection_conflict" }); throw e; }
    }
    return json(400, { ok: false, error: "invalid" });
  }
}
function sameParties(a: PhotoRelayParties, b: PhotoRelayParties) { return a.threadId === b.threadId && a.senderPersonId === b.senderPersonId && a.recipientPersonId === b.recipientPersonId && a.senderMemberId === b.senderMemberId && a.recipientMemberId === b.recipientMemberId; }
function descriptor(r: PhotoRelayItem): ApprovedRelayPhoto { return { version: 1, photoId: r.photoId, itemId: r.id, threadId: r.threadId, app: r.app, senderMemberId: r.senderMemberId, recipientMemberId: r.recipientMemberId, sha256: r.sha256, bytes: r.bytes, contentType: r.contentType, consentId: r.consentId, consentedAt: r.consentedAt, expiresAt: r.expiresAt, reviewId: r.reviewId!, reviewedAt: r.reviewedAt!, policyVersion: r.policyVersion }; }
function sameDescriptor(a: ApprovedRelayPhoto, b: ApprovedRelayPhoto) { return Object.keys(b).every(k => a[k as keyof ApprovedRelayPhoto] === b[k as keyof ApprovedRelayPhoto]) && Object.keys(a).length === Object.keys(b).length; }
