import { randomBytes } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { photoPageLinkTtlMs, photoPagePurposeHeader, photoPagePurposeMatches, photoPageReportConfirmed, photoPickFor } from "../../core/src/generated/photoRelayItem.ts";
import type { AppId } from "./apps.ts";
import { readCapped } from "./body.ts";
import { maskOf, numbersOf, PHOTO_RELAY_TIME_ZONE, PHOTO_SEND_NOTICE, photoDay, type PhotoPageLink, type PhotoRelayService } from "./photo-relay.ts";
import type { PhotoService } from "./photos.ts";

export const PHOTO_PAGE_API = "/api/photos/page/";
export const PHOTO_PAGE_COOKIE = "__Host-photo-page";
const PHOTO_VIEW_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
const OPAQUE_REFERENCE = /^[A-Za-z0-9_-]{43}$/;
const BODY_CAP = 4096;

type CheckAnswerState = "offered" | "changed" | "lapsed" | "refused" | "proposed" | "cancelled";
interface PhotoPageActions {
  consent(personId: string, app: AppId, draftId: string, revision: number): Promise<{ state: "offered" | "changed" | "lapsed" | "refused"; text?: string }>;
  takeBack(personId: string, app: AppId, shareRef: string): Promise<{ state: "taken_back" | "nothing_open" }>;
  report(recipientPersonId: string, app: AppId, offerId: string): Promise<{ filed: boolean } | undefined>;
}
interface PhotoPagesOptions {
  sql: SQL;
  relay: PhotoRelayService;
  photos: PhotoService;
  actions: PhotoPageActions;
  timeZone?: string;
}

const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } as const;
export const privateJson = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...HEADERS, ...extra } });
const fail = (status: number, error: string) => privateJson(status, { ok: false, error });
const exactKeys = (b: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(k => k in b) && Object.keys(b).every(k => required.includes(k) || optional.includes(k));
const numberList = (v: unknown, min: number, max: number, cap: number): number[] | undefined => {
  if (!Array.isArray(v) || v.length < min || v.length > max) return;
  if (!v.every(n => Number.isInteger(n) && n >= 1 && n <= cap)) return;
  return new Set(v).size === v.length ? [...(v as number[])].sort((a, b) => a - b) : undefined;
};

function cookieOf(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === PHOTO_PAGE_COOKIE) { const value = v.join("="); return OPAQUE_REFERENCE.test(value) ? value : null; }
  }
  return null;
}

export class PhotoPages {
  private readonly timeZone: string;
  constructor(private readonly o: PhotoPagesOptions) { this.timeZone = o.timeZone ?? PHOTO_RELAY_TIME_ZONE; }

  async route(req: Request, path: string, app: AppId): Promise<Response> {
    if (req.method !== "POST") return fail(405, "method");
    const action = path.slice(PHOTO_PAGE_API.length);
    if (action !== "open" && action !== "image" && action !== "answer") return fail(404, "not_found");
    const raw = await readCapped(req, BODY_CAP);
    if (raw === "too_large") return fail(413, "too_large");
    let b: Record<string, unknown>;
    try { b = JSON.parse(new TextDecoder().decode(raw)); if (!b || typeof b !== "object" || Array.isArray(b)) throw new TypeError("object"); } catch { return fail(400, "invalid"); }
    if (typeof b.token !== "string") return fail(400, "invalid");
    const purpose = req.headers.get(photoPagePurposeHeader);
    if (purpose === null) return fail(404, "link_unavailable");
    const link = await this.o.relay.pageLink(b.token);
    if (!link || link.app !== app || !photoPagePurposeMatches(purpose, link.purpose)) return fail(404, "link_unavailable");
    const cookie = cookieOf(req);
    const deviceHash = cookie ? this.o.relay.deviceId(cookie) : null;
    if (link.deviceHash !== null && link.deviceHash !== deviceHash) return fail(403, "other_device");
    if (action === "open") return exactKeys(b, ["token"]) ? this.open(link, cookie) : fail(400, "invalid");
    if (link.deviceHash === null) return fail(403, "other_device");
    if (action === "image") {
      if (!exactKeys(b, ["token", "n"]) || !Number.isInteger(b.n) || (b.n as number) < 1 || (b.n as number) > 6) return fail(400, "invalid");
      return this.image(link, deviceHash!, b.n as number);
    }
    return this.answer(link, deviceHash!, b);
  }

  private async draftRevisionLive(link: PhotoPageLink) {
    const draft = await this.o.relay.draftOf(link.personId, link.app);
    const same = !!draft && draft.id === link.draftId && draft.revision === link.draftRevision && draft.purpose === "send";
    return { draft: same ? draft : undefined, same };
  }

  private async live(link: PhotoPageLink, deviceHash: string | null, tx?: SQL): Promise<"live" | "expired"> {
    if (link.purpose === "check") return this.o.relay.linkLive(link, deviceHash, (await this.draftRevisionLive(link)).same) ? "live" : "expired";
    if (link.purpose === "mine") return this.o.relay.linkLive(link, deviceHash, true) ? "live" : "expired";
    const offer = link.offerId ? await this.o.relay.offer(link.offerId, tx) : undefined;
    if (!offer || offer.recipientPersonId !== link.personId) return "expired";
    const bound = link.deviceHash !== null;
    return this.o.relay.viewAllowed(offer, bound, bound && link.deviceHash === deviceHash, await this.o.relay.viewCurrent(offer, tx)) ? "live" : "expired";
  }

  private async open(link: PhotoPageLink, cookie: string | null): Promise<Response> {
    const deviceHash = cookie ? this.o.relay.deviceId(cookie) : null;
    if (await this.live(link, deviceHash) !== "live") return fail(410, "link_expired");
    if (link.purpose !== "view" && await this.o.photos.mayTake(link.personId, link.app)) return fail(404, "link_unavailable");
    const fresh = link.deviceHash === null ? (cookie ?? randomBytes(32).toString("base64url")) : null;
    const keep = link.purpose === "view" ? fresh ?? cookie : fresh !== cookie ? fresh : null;
    const lifetime = link.purpose === "view" ? `; Max-Age=${PHOTO_VIEW_COOKIE_MAX_AGE_S}` : "";
    const extra: Record<string, string> = keep ? { "set-cookie": `${PHOTO_PAGE_COOKIE}=${keep}; Path=/; Secure; HttpOnly; SameSite=Strict${lifetime}` } : {};
    const bound = await this.o.sql.begin(async (tx: SQL): Promise<"bound" | "other_device" | "expired"> => {
      const locked = await this.o.relay.lockLink(tx, link.id);
      if (!locked || (fresh ? locked.deviceHash !== null : locked.deviceHash !== deviceHash)) return "other_device";
      if (locked.purpose === "view" && await this.live(locked, deviceHash, tx) !== "live") return "expired";
      if (fresh && !(await this.o.relay.bindDevice(tx, link.id, this.o.relay.deviceId(fresh)))) return "other_device";
      return "bound";
    });
    if (bound === "other_device") return fail(403, "other_device");
    if (bound === "expired") return fail(410, "link_expired");
    const until = link.issuedAt + photoPageLinkTtlMs;
    if (link.purpose === "check") {
      const { draft } = await this.draftRevisionLive(link);
      if (!draft) return fail(410, "link_expired");
      const slots = await this.o.relay.slots(link.personId, link.app);
      const toFirstName = await this.o.relay.firstName(link.app, draft.recipientMemberId!);
      return privateJson(200, {
        ok: true, purpose: "check", toFirstName, notice: PHOTO_SEND_NOTICE.text.replaceAll("{{recipient}}", toFirstName), revision: draft.revision,
        photos: slots.map(s => ({ n: s.n, label: s.label, addedOn: photoDay(s.addedAt, this.timeZone), shared: s.heldBy.includes(draft.recipientMemberId!) })),
        proposed: slots.filter(s => draft.proposedIds.includes(s.id)).map(s => s.n), until,
      }, extra);
    }
    if (link.purpose === "mine") {
      const photos = await this.o.relay.holdings(link.personId, link.app, this.timeZone);
      return privateJson(200, { ok: true, purpose: "mine", photos: photos.map(p => ({ n: p.n, label: p.label, addedOn: p.addedOn, access: p.access })), until }, extra);
    }
    const offer = await this.o.relay.offer(link.offerId!);
    if (!offer || offer.phase !== "ready") return fail(410, "link_expired");
    const items = await this.o.relay.viewItems(offer);
    const fromFirstName = await this.o.relay.firstName(link.app, offer.senderMemberId);
    if (await this.live(link, deviceHash) !== "live") return fail(410, "link_expired");
    return privateJson(200, { ok: true, purpose: "view", fromFirstName, count: items.length }, extra);
  }

  private async image(link: PhotoPageLink, deviceHash: string, n: number): Promise<Response> {
    const check = link.purpose === "check";
    const draft = check ? (await this.draftRevisionLive(link)).draft : undefined;
    const live = check ? draft !== undefined && this.o.relay.linkLive(link, deviceHash, true) : await this.live(link, deviceHash) === "live";
    if (!live) return fail(410, "link_expired");
    let value: { bytes: Uint8Array; contentType: string } | undefined;
    if (link.purpose === "view") {
      const offer = await this.o.relay.offer(link.offerId!);
      value = offer && offer.phase === "ready" ? await this.o.relay.viewBytes(offer, n) : undefined;
      if (await this.live(link, deviceHash) !== "live") return fail(410, "link_expired");
    } else value = await this.o.relay.ownBytes(link.personId, link.app, n, draft?.photoSetSha);
    if (!value) return fail(404, "not_found");
    if (check && !(await this.draftRevisionLive(link)).same) return fail(410, "link_expired");
    return new Response(new Uint8Array(value.bytes), { status: 200, headers: {
      "content-type": value.contentType, ...HEADERS, "cache-control": "private, no-store", "content-security-policy": "default-src 'none'", "content-disposition": "inline",
    } });
  }

  private async answer(link: PhotoPageLink, deviceHash: string, b: Record<string, unknown>): Promise<Response> {
    if (link.purpose === "check") {
      if (!exactKeys(b, ["token", "revision", "answer"], ["numbers"]) || !Number.isInteger(b.revision)) return fail(400, "invalid");
      if (b.answer !== "send" && b.answer !== "cancel" && b.answer !== "pick") return fail(400, "invalid");
      if (b.answer !== "pick" && "numbers" in b) return fail(400, "invalid");
      if (!this.o.relay.linkLive(link, deviceHash, true)) return privateJson(200, { ok: true, state: "lapsed" satisfies CheckAnswerState });
      const { draft } = await this.draftRevisionLive(link);
      if (!draft || b.revision !== draft.revision) return privateJson(200, { ok: true, state: "changed" satisfies CheckAnswerState });
      if (b.answer === "send") {
        const r = await this.o.actions.consent(link.personId, link.app, draft.id, draft.revision);
        return privateJson(200, { ok: true, state: r.state, ...(r.text ? { text: r.text } : {}) });
      }
      if (b.answer === "cancel") {
        await this.o.sql.begin(tx => this.o.relay.dropDraft(tx, link.personId, link.app));
        return privateJson(200, { ok: true, state: "cancelled" satisfies CheckAnswerState });
      }
      const slots = await this.o.relay.slots(link.personId, link.app);
      const numbers = numberList(b.numbers, 1, 3, slots.length);
      if (!numbers) return fail(400, "invalid");
      const shared = slots.filter(s => s.heldBy.includes(draft.recipientMemberId!)).map(s => s.n);
      const pick = photoPickFor(true, false, false, false, 1, slots.length, true, numbers.length > 1, maskOf(numbers), 0, 0, maskOf(shared));
      if (pick.pick !== "ProposePhotos") return privateJson(200, { ok: true, state: "refused" satisfies CheckAnswerState });
      const proposed = numbersOf(pick.chosen, slots.length);
      const saved = await this.o.sql.begin(tx => this.o.relay.pickOnPage(tx, link, proposed.map(n => slots[n - 1]!.id)));
      if (!saved) return privateJson(200, { ok: true, state: "changed" satisfies CheckAnswerState });
      return privateJson(200, { ok: true, state: "proposed" satisfies CheckAnswerState, proposed, revision: saved.revision });
    }
    if (link.purpose === "mine") {
      if (!exactKeys(b, ["token", "answer", "shareRef"]) || b.answer !== "take_back" || typeof b.shareRef !== "string" || !OPAQUE_REFERENCE.test(b.shareRef)) return fail(400, "invalid");
      if (await this.live(link, deviceHash) !== "live") return fail(410, "link_expired");
      const r = await this.o.actions.takeBack(link.personId, link.app, b.shareRef);
      return privateJson(200, { ok: true, state: r.state });
    }
    if (!exactKeys(b, ["token", "answer"]) || b.answer !== "report") return fail(400, "invalid");
    const r = await this.o.actions.report(link.personId, link.app, link.offerId!);
    return photoPageReportConfirmed(r !== undefined, r?.filed === true)
      ? privateJson(200, { ok: true, state: "reported" })
      : fail(410, "link_expired");
  }
}
