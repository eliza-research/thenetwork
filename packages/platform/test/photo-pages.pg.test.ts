import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS, type AppId } from "../src/apps.ts";
import { PhotoPages, PHOTO_PAGE_COOKIE } from "../src/photo-pages.ts";
import { PhotoRelayService, PgPhotoRelayStore } from "../src/photo-relay.ts";
import { simulatedPhotoScreen, type PhotoScreenImage, type PhotoScreenResult } from "../src/photo-screen.ts";
import { LocalDiskPhotoStorage, PgPhotoStore, PHOTO_CONSENT, PhotoService } from "../src/photos.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

interface PagePhoto { n: number; shared?: boolean; label?: string | null; addedOn?: string; access?: { firstName: string; state: string; shareRef: string }[] }
interface PageAnswer { notice?: string; photos?: PagePhoto[]; [key: string]: unknown }
const T = 120_000;
const HOUR = 60 * 60_000;
const SECRET = /ph_|pdr_|pof_|pri_|member_|[a-f0-9]{64}|sha256|https?:/;
const jpeg = (tag: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x03, tag, tag, 0xff, 0xd9]);

const CLEAN: PhotoScreenResult = { kind: "answered", riskPerMille: 0 };
const FLAGGED: PhotoScreenResult = { kind: "answered", riskPerMille: 900 };
const DOWN: PhotoScreenResult = { kind: "unanswered" };

describe.skipIf(!pgAvailable)("photo pages: one step each, from a link, for the receiver's bound browser", () => {
  let url: string, sql: SQL, people: PgPeopleStore, dir: string;
  beforeAll(async () => { url = await migratedDb("photo_pages"); sql = new SQL({ url, max: 2 }); people = new PgPeopleStore(url); dir = mkdtempSync(join(tmpdir(), "photo-pages-")); }, T);
  afterAll(async () => { await people?.close(); await sql?.close(); if (url) await dropDb(url); if (dir) rmSync(dir, { recursive: true, force: true }); });

  let k = 0;
  async function world() {
    let now = Date.UTC(2026, 10, 22, 20);
    const storage = new LocalDiskPhotoStorage(dir);
    const getFromDisk = storage.get.bind(storage);
    let nextObjectRead: (() => Promise<void>) | undefined;
    storage.get = async key => {
      const beforeRead = nextObjectRead;
      nextObjectRead = undefined;
      await beforeRead?.();
      return getFromDisk(key);
    };
    const photos = new PhotoService({ people, meta: new PgPhotoStore(sql), storage, signingKey: "fixture-key", now: () => now, eligible: async () => true });
    const person = async (age: number) => {
      const n = k++;
      const p = await people.createPerson({ id: crypto.randomUUID(), e164: `+1212555${String(3000 + n).padStart(4, "0")}`, method: "otp_sms", at: now, lowestAge: age });
      await people.putMembership({ app: "slop", personId: p.id, memberId: `slop_pages_${process.pid}_${n}`, state: "active", review: null, firstName: `P${n}`, profile: {}, joinedAt: now, leftAt: null });
      return p.id;
    };
    const sender = await person(29), recipient = await person(31);
    const ids: string[] = [];
    for (const tag of [1, 2, 3]) { const r = await photos.upload(sender, "slop", jpeg(tag), PHOTO_CONSENT.version); if (!r.ok) throw new Error(r.reason); ids.push(r.value.id); }
    const binding = { senderPersonId: sender, recipientPersonId: recipient, senderMemberId: "member_sender", recipientMemberId: "member_recipient" };
    const shaById = new Map((await photos.rows(sender, "slop")).map(r => [r.id, r.sha256]));
    const numberOf = (image: PhotoScreenImage) => ids.findIndex(id => shaById.get(id) === createHash("sha256").update(image.bytes).digest("hex")) + 1;
    let allowed = true;
    let nextAuthorize: (() => void) | undefined;
    let verdict: (image: PhotoScreenImage) => PhotoScreenResult = () => CLEAN;
    const screened: number[] = [];
    const relay = new PhotoRelayService({
      store: new PgPhotoRelayStore(sql), photos, sql, signingKey: "fixture-key", hashKey: "fixture-hash-key", now: () => now,
      screen: simulatedPhotoScreen(image => { screened.push(numberOf(image)); return verdict(image); }),
      origin: app => `https://${APPS[app].domain}`,
      authorize: async ({ threadId, senderPersonId }) => {
        const notify = nextAuthorize;
        nextAuthorize = undefined;
        notify?.();
        return allowed && threadId === "thread_pages" && senderPersonId === sender ? binding : undefined;
      },
      threads: async () => [{ id: "thread_pages", label: "Robin" }],
    });
    const consents: [string, number][] = [], takeBacks: string[] = [];
    const pages = new PhotoPages({
      sql, relay, photos,
      actions: {
        consent: async (_p, _a, draftId, revision) => { consents.push([draftId, revision]); return { state: "offered" }; },
        takeBack: async (_p, _a, shareRef) => { takeBacks.push(shareRef); return { state: "taken_back" }; },
        report: async (recipientPersonId, _a, offerId) => (await sql.begin(tx => relay.report(tx, offerId, recipientPersonId))) ? { filed: false } : undefined,
      },
    });
    const draft = (proposed: number[]) => sql.begin(tx => relay.saveDraft(tx, {
      personId: sender, app: "slop", purpose: "send", threadId: "thread_pages", recipientMemberId: "member_recipient",
      shownIds: ids, proposedIds: proposed.map(n => ids[n - 1]!), wantsSet: proposed.length > 1, listed: false, prompt: { via: "send" },
    }));
    const linkPurposes = new Map<string, string>();
    const token = (link: string) => {
      const url = new URL(link);
      const value = url.hash.slice(1);
      linkPurposes.set(value, url.pathname.split("/").at(-1)!);
      return value;
    };
    const call = async (action: string, body: Record<string, unknown>, cookie?: string, app: AppId = "slop", purpose?: string | null) => {
      const requestedPurpose = purpose === undefined ? linkPurposes.get(String(body.token)) ?? "check" : purpose;
      const res = (await pages.route(new Request(`https://${APPS[app].domain}/api/photos/page/${action}`, {
        method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie: `${PHOTO_PAGE_COOKIE}=${cookie}` } : {}),
          ...(requestedPurpose === null ? {} : { "x-photo-page-purpose": requestedPurpose }) }, body: JSON.stringify(body),
      }), `/api/photos/page/${action}`, app))!;
      const setCookie = res.headers.get("set-cookie");
      const type = res.headers.get("content-type") ?? "";
      return { status: res.status, type, cookie: setCookie ? /__Host-photo-page=([A-Za-z0-9_-]{43})/.exec(setCookie)![1]! : undefined, setCookie,
        body: type.startsWith("application/json") ? await res.json() as PageAnswer : undefined,
        bytes: type.startsWith("application/json") ? undefined : new Uint8Array(await res.arrayBuffer()) };
    };
    const ask = async (proposed: number[]) => {
      const d = await draft(proposed);
      return sql.begin(async tx => (await relay.prepareOffer(sender, "slop", d.draftId, d.revision, now))!.commit(tx));
    };
    const ready = async (proposed: number[]) => {
      const offer = await ask(proposed);
      expect(offer.phase).toBe("asking");
      expect((await sql.begin(tx => relay.answer(tx, offer.offerId!, recipient, "yes"))).outcome).toBe("taken");
      for (const d of await relay.screensDue("slop", offer.offerId)) expect(await relay.screen(d.itemId)).toBe("ReleasePhoto");
      const settled = await sql.begin(tx => relay.settle(tx, offer.offerId!));
      expect(settled?.phase).toBe("ready");
      return { offerId: offer.offerId!, link: settled!.viewLink! };
    };
    const access = async () => (await relay.holdings(sender, "slop")).map(h => h.access.map(({ firstName, state }) => ({ firstName, state })));
    const sharedWith = async () => (await relay.slots(sender, "slop")).map(s => s.sharedWith);
    const noticesOf = async (offerId: string) => (await relay.notices("slop")).filter(n => n.offerId === offerId).map(n => n.notice);
    const withdraw = (photoIds: string[] | null) => sql.begin(tx => relay.withdraw(tx, "slop", sender, "thread_pages", photoIds));
    const yes = async (offerId: string) => expect((await sql.begin(tx => relay.answer(tx, offerId, recipient, "yes"))).outcome).toBe("taken");
    const settle = (offerId: string) => sql.begin(tx => relay.settle(tx, offerId));
    const itemsOf = async (offerId: string) => (await sql`select id, state, screen_attempts, reviewer_id from platform.photo_relay_items where offer_id = ${offerId} order by array_position(${ids}::text[], photo_id)`)
      .map((r: any) => ({ id: r.id as string, state: r.state as string, attempts: r.screen_attempts as number, reviewer: r.reviewer_id as string | null }));
    return {
      relay, pages, photos, draft, ask, yes, settle, itemsOf, access, sharedWith, noticesOf, withdraw, call, token, ready, sender, recipient, ids, consents, takeBacks, screened, numberOf,
      at: () => now,
      beforeAuthorize: (notify: () => void) => { nextAuthorize = notify; },
      beforeObjectRead: (notify: () => Promise<void>) => { nextObjectRead = notify; },
      pauseRecipient: async () => {
        const membership = await people.getMembership(recipient, "slop");
        if (!membership) throw new Error("No Slop membership for the recipient");
        await people.putMembership({ ...membership, state: "paused" });
      },
      screenAs: (decide: (image: PhotoScreenImage) => PhotoScreenResult) => { verdict = decide; }, cut: () => { allowed = false; }, tick: (ms: number) => { now += ms; },
    };
  }

  // spec/photoRelayItem.md, "A photo link only serves its own page"
  test("a wrong-purpose request leaves the photo link and proposal untouched", async () => {
    const w = await world();
    const draft = await w.draft([1]);
    const token = w.token(draft.link!);
    const before = await w.relay.draftOf(w.sender, "slop");
    const unavailable = { status: 404, body: { ok: false, error: "link_unavailable" }, setCookie: null, bytes: undefined };

    expect((await w.relay.pageLink(token))?.deviceHash).toBeNull();
    expect(await w.call("open", { token }, undefined, "slop", "mine")).toMatchObject(unavailable);
    expect(await w.call("open", { token }, undefined, "slop", null)).toMatchObject(unavailable);
    expect(await w.call("open", { token }, undefined, "slop", "check, mine")).toMatchObject(unavailable);
    expect(await w.call("open", { token }, undefined, "ntwrk", "check")).toMatchObject(unavailable);
    expect((await w.relay.pageLink(token))?.deviceHash).toBeNull();
    expect(await w.relay.draftOf(w.sender, "slop")).toEqual(before);

    const right = await w.call("open", { token }, undefined, "slop", "check");
    expect(right).toMatchObject({ status: 200, body: { purpose: "check", revision: draft.revision }, cookie: expect.any(String) });
    const phone = right.cookie!;
    expect(await w.call("image", { token, n: 1 }, phone, "slop", "view")).toMatchObject(unavailable);
    expect(await w.call("answer", { token, revision: draft.revision, answer: "pick", numbers: [2] }, phone, "slop", "mine")).toMatchObject(unavailable);
    expect(await w.relay.draftOf(w.sender, "slop")).toEqual(before);
    expect(await w.call("image", { token, n: 1 }, phone, "slop", "check")).toMatchObject({ status: 200, type: "image/jpeg" });
  });

  test("a check link binds to the first phone; a second phone gets other_device; an old revision answers changed and never consents", async () => {
    const w = await world();
    const first = await w.draft([1]);
    const opened = await w.call("open", { token: w.token(first.link!) });
    expect(opened.status).toBe(200);
    expect(opened.setCookie).toMatch(/^__Host-photo-page=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
    expect(opened.body).toMatchObject({ purpose: "check", toFirstName: "Your match", revision: 1, proposed: [1] });
    expect(opened.body!.photos!.map(p => [p.n, p.shared])).toEqual([[1, false], [2, false], [3, false]]);
    expect(opened.body!.notice).toContain("can view it until you take it back");
    expect(opened.body!.notice).not.toContain("24 hours");
    expect(JSON.stringify(opened.body)).not.toMatch(SECRET);
    const phone = opened.cookie!;
    expect(await w.call("open", { token: w.token(first.link!) }, "x".repeat(43))).toMatchObject({ status: 403, body: { error: "other_device" } });
    expect(await w.call("open", { token: w.token(first.link!) })).toMatchObject({ status: 403, body: { error: "other_device" } });
    expect(await w.call("image", { token: w.token(first.link!), n: 1 }, "x".repeat(43))).toMatchObject({ status: 403, body: { error: "other_device" } });
    const image = await w.call("image", { token: w.token(first.link!), n: 2 }, phone);
    expect([image.status, image.type]).toEqual([200, "image/jpeg"]);
    expect(await w.call("image", { token: w.token(first.link!), n: 4 }, phone)).toMatchObject({ status: 404, body: { error: "not_found" } });
    const second = await w.draft([2]);
    expect(await w.call("open", { token: w.token(first.link!) }, phone)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await w.call("answer", { token: w.token(first.link!), revision: 1, answer: "send" }, phone)).toMatchObject({ status: 200, body: { state: "changed" } });
    expect(w.consents).toEqual([]);
    expect((await w.call("open", { token: w.token(second.link!) }, phone)).body).toMatchObject({ revision: 2, proposed: [2] });
    const picked = await w.call("answer", { token: w.token(second.link!), revision: 2, answer: "pick", numbers: [3, 1] }, phone);
    expect(picked).toMatchObject({ status: 200, body: { state: "proposed", proposed: [1, 3], revision: 3 } });
    expect((await w.relay.draftOf(w.sender, "slop"))?.promptKey).toMatch(/^photo-page:/);
    expect(await w.call("answer", { token: w.token(second.link!), revision: 2, answer: "send" }, phone)).toMatchObject({ body: { state: "changed" } });
    expect(await w.call("answer", { token: w.token(second.link!), revision: 3, answer: "send" }, phone)).toMatchObject({ status: 200, body: { state: "offered" } });
    expect(w.consents).toEqual([[second.draftId, 3]]);
    w.tick(15 * 60_000);
    expect(await w.call("answer", { token: w.token(second.link!), revision: 3, answer: "send" }, phone)).toMatchObject({ body: { state: "lapsed" } });
    expect(w.consents).toHaveLength(1);
    expect(await w.call("open", { token: "A".repeat(43) })).toMatchObject({ status: 404, body: { error: "link_unavailable" } });
    expect(await w.call("open", { token: w.token(second.link!), extra: 1 }, phone)).toMatchObject({ status: 400 });
  }, T);

  test("the view link opens for the receiver's bound browser with no time limit; another browser is refused; a take-back ends it at once and lists it as taken back; a new link replaces the old one", async () => {
    const w = await world();
    const { offerId, link } = await w.ready([1, 2]);
    const opened = await w.call("open", { token: w.token(link) });
    expect(opened).toMatchObject({ status: 200, body: { purpose: "view", fromFirstName: "Your match", count: 2 } });
    expect(opened.body).not.toHaveProperty("until");
    expect(JSON.stringify(opened.body)).not.toMatch(/label|addedOn/);
    expect(JSON.stringify(opened.body)).not.toMatch(SECRET);
    const phone = opened.cookie!;
    expect(await w.relay.offer(offerId)).toMatchObject({ phase: "ready" });
    expect(await w.call("open", { token: w.token(link) })).toMatchObject({ status: 403, body: { error: "other_device" } });
    expect(await w.call("open", { token: w.token(link) }, "y".repeat(43))).toMatchObject({ status: 403, body: { error: "other_device" } });
    expect(await w.call("image", { token: w.token(link), n: 1 }, "y".repeat(43))).toMatchObject({ status: 403, body: { error: "other_device" } });
    w.tick(48 * HOUR);
    expect(await w.settle(offerId)).toMatchObject({ phase: "ready", changed: false, notice: "NoNotice" });
    expect(await w.call("open", { token: w.token(link) }, phone)).toMatchObject({ status: 200, body: { purpose: "view", count: 2 } });
    const bytes = await w.call("image", { token: w.token(link), n: 2 }, phone);
    expect([bytes.status, bytes.type]).toEqual([200, "image/jpeg"]);
    w.tick(30 * 24 * HOUR);
    expect((await w.call("image", { token: w.token(link), n: 1 }, phone)).status).toBe(200);

    expect(await w.withdraw([w.ids[1]!])).toEqual({ revoked: 1, viewing: true });
    expect(await w.call("image", { token: w.token(link), n: 2 }, phone)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await w.call("open", { token: w.token(link) }, phone)).toMatchObject({ status: 200, body: { count: 1 } });
    expect(await w.access()).toEqual([[{ firstName: "Your match", state: "ready" }], [{ firstName: "Your match", state: "taken_back" }], []]);
    expect(await w.sharedWith()).toEqual([["member_recipient"], [], []]);

    const renewed = await w.relay.renewViewLinks(w.recipient, "slop");
    expect(renewed.map(r => [r.offerId, r.count])).toEqual([[offerId, 1]]);
    expect(renewed[0]!.link).toMatch(/^https:\/\/slop\.date\/photos\/view#[A-Za-z0-9_-]{43}$/);
    expect(await w.relay.renewViewLinks(w.sender, "slop")).toEqual([]);
    expect(await w.call("open", { token: w.token(link) }, phone)).toMatchObject({ status: 404, body: { error: "link_unavailable" } });
    const next = renewed[0]!.link;
    expect(await w.call("open", { token: w.token(next) }, phone)).toMatchObject({ status: 200, body: { purpose: "view", count: 1 } });
    expect(await w.call("open", { token: w.token(next) }, "z".repeat(43))).toMatchObject({ status: 403, body: { error: "other_device" } });

    expect(await w.withdraw(null)).toEqual({ revoked: 1, viewing: true });
    expect(await w.relay.offer(offerId)).toMatchObject({ phase: "revoked", endedBySender: true });
    expect(await w.call("open", { token: w.token(next) }, phone)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await w.call("image", { token: w.token(next), n: 1 }, phone)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    const takenBack = [{ firstName: "Your match", state: "taken_back" }];
    expect(await w.access()).toEqual([takenBack, takenBack, []]);
    expect(await w.sharedWith()).toEqual([[], [], []]);
    expect(await w.withdraw(null)).toEqual({ revoked: 0, viewing: false });
    expect(await w.relay.renewViewLinks(w.recipient, "slop")).toEqual([]);

    const r = await world();
    const reported = await r.ready([3]);
    const rp = (await r.call("open", { token: r.token(reported.link) })).cookie!;
    expect(await r.call("answer", { token: r.token(reported.link), answer: "report" }, rp)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await r.relay.offer(reported.offerId)).toMatchObject({ phase: "reported" });
    expect(await r.call("image", { token: r.token(reported.link), n: 1 }, rp)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await r.call("open", { token: r.token(reported.link) }, rp)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await r.relay.renewViewLinks(r.recipient, "slop")).toEqual([]);
  }, T);

  test("a recipient STOP during the first open refuses metadata and binds no browser", async () => {
    const w = await world();
    const { offerId, link } = await w.ready([1]);
    const token = w.token(link);
    const linkRow = (await w.relay.pageLink(token))!;
    const locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const barrier = sql.begin(async tx => {
      await w.relay.lockLink(tx, linkRow.id);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const admitted = Promise.withResolvers<void>();
    w.beforeAuthorize(admitted.resolve);
    const opening = w.call("open", { token });
    try {
      await admitted.promise;
      await w.pauseRecipient();
      expect(await w.relay.offer(offerId)).toMatchObject({ phase: "ready", partyEnded: true });
    } finally {
      release.resolve();
      await barrier;
    }
    expect(await opening).toMatchObject({ status: 410, body: { error: "link_expired" }, setCookie: null });
    expect((await w.relay.pageLink(token))?.deviceHash).toBeNull();
  }, T);

  test("a recipient STOP during a bound image read returns no photo bytes", async () => {
    const w = await world();
    const { offerId, link } = await w.ready([1]);
    const token = w.token(link);
    const browser = (await w.call("open", { token })).cookie!;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    w.beforeObjectRead(async () => { entered.resolve(); await release.promise; });
    const image = w.call("image", { token, n: 1 }, browser);
    try {
      await entered.promise;
      await w.pauseRecipient();
      expect(await w.relay.offer(offerId)).toMatchObject({ phase: "ready", partyEnded: true });
    } finally {
      release.resolve();
    }
    expect(await image).toMatchObject({ status: 410, body: { error: "link_expired" }, bytes: undefined });
  }, T);

  test("the automatic check: a clean photo opens right after the receiver's yes; a flagged photo is never shown and waits for staff; an outage releases nothing", async () => {
    const c = await world();
    const clean = await c.ask([1]);
    await c.yes(clean.offerId!);
    expect(await c.relay.held("slop").then(h => h.filter(i => i.offerId === clean.offerId))).toEqual([]);
    const [due] = await c.relay.screensDue("slop", clean.offerId);
    expect(await c.relay.screen(due!.itemId)).toBe("ReleasePhoto");
    expect(await c.itemsOf(clean.offerId!)).toEqual([{ id: due!.itemId, state: "approved", attempts: 0, reviewer: "screen:simulated" }]);
    const released = await c.settle(clean.offerId!);
    expect(released).toMatchObject({ from: "reviewing", phase: "ready", notice: "TellSent", count: 1 });
    const cleanView = await c.call("open", { token: c.token(released!.viewLink!) });
    expect(cleanView).toMatchObject({ status: 200, body: { purpose: "view", count: 1 } });
    expect((await c.call("image", { token: c.token(released!.viewLink!), n: 1 }, cleanView.cookie)).status).toBe(200);
    expect(c.screened).toEqual([1]);

    const f = await world();
    f.screenAs(image => f.numberOf(image) === 2 ? FLAGGED : CLEAN);
    const mixed = await f.ask([1, 2]);
    await f.yes(mixed.offerId!);
    for (const d of await f.relay.screensDue("slop", mixed.offerId)) await f.relay.screen(d.itemId);
    const [first, second] = await f.itemsOf(mixed.offerId!);
    expect([first!.state, second!.state]).toEqual(["approved", "pending"]);
    const partly = await f.settle(mixed.offerId!);
    expect(partly).toMatchObject({ phase: "ready", count: 1 });
    expect((await f.relay.held("slop")).filter(h => h.offerId === mixed.offerId).map(h => h.id)).toEqual([second!.id]);
    const view = await f.call("open", { token: f.token(partly!.viewLink!) });
    expect(view).toMatchObject({ status: 200, body: { count: 1 } });
    expect(JSON.stringify(view.body)).not.toMatch(/flag|review|safety|pending/);
    expect(await f.call("image", { token: f.token(partly!.viewLink!), n: 2 }, view.cookie)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await f.access()).toEqual([[{ firstName: "Your match", state: "ready" }], [{ firstName: "Your match", state: "checking" }], []]);
    expect(await f.relay.review(second!.id, { id: "staff_safety", roles: ["safety"] }, "safe")).toBe(true);
    expect(await f.settle(mixed.offerId!)).toMatchObject({ phase: "ready", changed: false });
    expect(await f.call("open", { token: f.token(partly!.viewLink!) }, view.cookie)).toMatchObject({ status: 200, body: { count: 2 } });

    const g = await world();
    g.screenAs(() => FLAGGED);
    const flagged = await g.ask([3]);
    await g.yes(flagged.offerId!);
    for (const d of await g.relay.screensDue("slop", flagged.offerId)) expect(await g.relay.screen(d.itemId)).toBe("HoldForStaff");
    const [held] = await g.itemsOf(flagged.offerId!);
    expect(held).toMatchObject({ state: "pending", reviewer: null });
    expect(await g.settle(flagged.offerId!)).toMatchObject({ phase: "reviewing", changed: false });
    expect(await g.relay.offer(flagged.offerId!)).toMatchObject({ phase: "reviewing" });
    expect(await g.relay.renewViewLinks(g.recipient, "slop")).toEqual([]);
    expect(Number((await sql`select count(*)::int as n from platform.photo_page_links where offer_id = ${flagged.offerId!}`)[0].n)).toBe(0);
    expect((await g.relay.held("slop")).filter(h => h.offerId === flagged.offerId).map(h => h.id)).toEqual([held!.id]);
    expect(await g.relay.review(held!.id, { id: "staff_safety", roles: ["safety"] }, "unsafe")).toBe(true);
    expect(await g.settle(flagged.offerId!)).toMatchObject({ phase: "rejected", notice: "TellNotApproved" });

    const o = await world();
    o.screenAs(() => DOWN);
    const outage = await o.ask([1]);
    await o.yes(outage.offerId!);
    const [down] = await o.relay.screensDue("slop", outage.offerId);
    expect(await o.relay.screen(down!.itemId)).toBe("RetryScreen");
    expect(await o.relay.screen(down!.itemId)).toBeUndefined();
    for (const [wait, outcome] of [[60_000, "RetryScreen"], [300_000, "RetryScreen"], [900_000, "RetryScreen"], [3_600_000, "HoldForStaff"]] as const) {
      expect(await o.relay.held("slop").then(h => h.filter(i => i.offerId === outage.offerId))).toEqual([]);
      expect(await o.settle(outage.offerId!)).toMatchObject({ phase: "reviewing", changed: false });
      o.tick(wait);
      expect(await o.relay.screen(down!.itemId)).toBe(outcome);
    }
    expect(await o.itemsOf(outage.offerId!)).toEqual([{ id: down!.itemId, state: "pending", attempts: 5, reviewer: null }]);
    expect(await o.settle(outage.offerId!)).toMatchObject({ phase: "reviewing", changed: false });
    expect((await o.relay.held("slop")).filter(h => h.offerId === outage.offerId).map(h => h.id)).toEqual([down!.itemId]);
    expect(Number((await sql`select count(*)::int as n from platform.photo_page_links where offer_id = ${outage.offerId!}`)[0].n)).toBe(0);

    const u = await world();
    u.screenAs(() => DOWN);
    const late = await u.ask([2]);
    await u.yes(late.offerId!);
    u.tick(12 * HOUR);
    const [stale] = await u.relay.screensDue("slop", late.offerId);
    u.screenAs(() => CLEAN);
    expect(await u.relay.screen(stale!.itemId)).toBeUndefined();
    expect(await u.settle(late.offerId!)).toMatchObject({ phase: "check_timed_out", notice: "TellCheckTimedOut" });
    expect((await u.itemsOf(late.offerId!)).map(i => i.state)).toEqual(["expired"]);
  }, T);

  test("a ready offer does not hold the next offer to the same match; one deleted photo hides only that photo; the bound browser keeps its cookie; one check attempt calls the model once", async () => {
    const w = await world();
    const first = await w.ready([1, 2]);
    const opened = await w.call("open", { token: w.token(first.link) });
    expect(opened).toMatchObject({ status: 200, body: { purpose: "view", count: 2 } });
    expect(opened.setCookie).toMatch(/^__Host-photo-page=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000$/);
    const phone = opened.cookie!;
    expect((await w.call("open", { token: w.token(first.link) }, phone)).setCookie).toBe(`__Host-photo-page=${phone}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=34560000`);
    w.tick(HOUR);
    const second = await w.ask([3]);
    expect(second).toMatchObject({ admission: "OfferAsk", phase: "asking" });
    const third = await w.draft([3]);
    expect((await w.relay.prepareOffer(w.sender, "slop", third.draftId, third.revision, w.at()))?.admission).toBe("OfferWaitForAnswer");
    const thirdCheck = await w.call("open", { token: w.token(third.link!) });
    expect(thirdCheck.body!.photos!.map(p => [p.n, p.shared])).toEqual([[1, true], [2, true], [3, false]]);
    expect(await w.call("answer", { token: w.token(third.link!), revision: third.revision, answer: "pick", numbers: [1] }, thirdCheck.cookie)).toMatchObject({ status: 200, body: { state: "refused" } });
    expect((await w.relay.offer(first.offerId))?.phase).toBe("ready");

    expect(await w.photos.remove(w.sender, "slop", w.ids[0]!)).toBe(true);
    expect(await w.call("open", { token: w.token(first.link) }, phone)).toMatchObject({ status: 200, body: { purpose: "view", count: 1 } });
    const kept = await w.call("image", { token: w.token(first.link), n: 1 }, phone);
    expect(kept.status).toBe(200);
    expect(w.numberOf({ bytes: kept.bytes!, contentType: "image/jpeg" })).toBe(2);
    expect(await w.call("image", { token: w.token(first.link), n: 2 }, phone)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await w.settle(first.offerId)).toMatchObject({ phase: "ready", changed: false });
    expect(await w.photos.remove(w.sender, "slop", w.ids[1]!)).toBe(true);
    expect(await w.call("open", { token: w.token(first.link) }, phone)).toMatchObject({ status: 410, body: { error: "link_expired" } });

    const c = await world();
    const asked = await c.ask([1]);
    await c.yes(asked.offerId!);
    const [due] = await c.relay.screensDue("slop", asked.offerId);
    const outcomes = await Promise.all([c.relay.screen(due!.itemId), c.relay.screen(due!.itemId)]);
    expect(outcomes.filter(o => o === "ReleasePhoto")).toHaveLength(1);
    expect(outcomes.filter(o => o === undefined)).toHaveLength(1);
    expect(c.screened).toEqual([1]);
    expect(await c.itemsOf(asked.offerId!)).toEqual([{ id: due!.itemId, state: "approved", attempts: 0, reviewer: "screen:simulated" }]);
  }, T);

  test("the photo list shows numbers, names, days and who has each, never ids or links; names are checked for format and are unique", async () => {
    const w = await world();
    await w.ready([1]);
    expect(await w.relay.label(w.sender, "slop", 1, "beach")).toBe("ok");
    expect(await w.relay.label(w.sender, "slop", 2, "Beach")).toBe("taken");
    for (const bad of ["beach!!", "a b c d", "a".repeat(25), " beach", "beach--day"]) expect([bad, await w.relay.label(w.sender, "slop", 2, bad)]).toEqual([bad, "invalid"]);
    expect(await w.relay.label(w.sender, "slop", 2, "beach day")).toBe("ok");
    expect(await w.relay.label(w.sender, "slop", 9, "gym")).toBe("not_found");
    expect(await sql`update platform.photos set label = 'Bad Label' where id = ${w.ids[2]!}`.then(() => "ok", e => String(e.message))).toContain("check");
    const link = await w.relay.mineLink(w.sender, "slop");
    expect(link).toMatch(/^https:\/\/slop\.date\/photos\/mine#[A-Za-z0-9_-]{43}$/);
    const mine = await w.call("open", { token: w.token(link!) });
    expect(mine).toMatchObject({ status: 200, body: { purpose: "mine" } });
    expect(mine.body!.photos!.map(p => [p.n, p.label, p.addedOn, p.access?.map(({ firstName, state }) => ({ firstName, state }))])).toEqual([
      [1, "beach", "2026-11-22", [{ firstName: "Your match", state: "ready" }]], [2, "beach day", "2026-11-22", []], [3, null, "2026-11-22", []],
    ]);
    const shareRef = mine.body!.photos![0]!.access![0]!.shareRef;
    expect(shareRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(mine.body).replaceAll(shareRef, "")).not.toMatch(SECRET);
    expect(await w.call("answer", { token: w.token(link!), answer: "take_back", shareRef }, mine.cookie)).toMatchObject({ status: 200, body: { state: "taken_back" } });
    expect(w.takeBacks).toEqual([shareRef]);
    expect(await w.call("answer", { token: w.token(link!), answer: "take_back", numbers: [1], firstName: "Robin" }, mine.cookie)).toMatchObject({ status: 400 });
  }, T);

  test("a decline shows as asked until its notice is due; a silent decline shows as asked; a take-back of a hidden decline reads like a take-back of an ask and both list as taken back", async () => {
    const w = await world();
    const asked = await w.ask([1]);
    expect(asked).toMatchObject({ admission: "OfferAsk", phase: "asking" });
    expect(await sql.begin(tx => w.relay.answer(tx, asked.offerId!, w.recipient, "no"))).toMatchObject({ outcome: "declined" });
    const askedLine = [{ firstName: "Your match", state: "asked" }];
    expect(await w.access()).toEqual([askedLine, [], []]);
    expect(await w.sharedWith()).toEqual([["member_recipient"], [], []]);
    const mine = await w.call("open", { token: w.token((await w.relay.mineLink(w.sender, "slop"))!) });
    expect(mine.body!.photos!.map(p => p.access?.map(({ firstName, state }) => ({ firstName, state })))).toEqual([askedLine, [], []]);
    expect(await w.noticesOf(asked.offerId!)).toEqual([]);
    const again = await w.draft([2]);
    const check = await w.call("open", { token: w.token(again.link!) });
    expect(check.body!.photos!.map(p => [p.n, p.shared])).toEqual([[1, false], [2, false], [3, false]]);
    expect(await w.call("answer", { token: w.token(again.link!), revision: again.revision, answer: "pick", numbers: [1] }, check.cookie)).toMatchObject({ status: 200, body: { state: "proposed", proposed: [1] } });
    expect(await w.access()).toEqual([askedLine, [], []]);
    w.tick(24 * HOUR);
    expect(await w.access()).toEqual([[], [], []]);
    expect(await w.sharedWith()).toEqual([[], [], []]);
    expect(await w.noticesOf(asked.offerId!)).toEqual(["TellNotTaken"]);

    const s = await world();
    await sql.begin(tx => s.relay.setNever(tx, s.recipient, "slop", true));
    const silent = await s.ask([2]);
    expect(silent).toMatchObject({ admission: "OfferSilentDecline", phase: "declined" });
    expect(await s.access()).toEqual([[], askedLine, []]);
    expect(await s.sharedWith()).toEqual([[], ["member_recipient"], []]);
    expect(await s.withdraw(null)).toEqual({ revoked: 1, viewing: false });
    expect(await s.relay.offer(silent.offerId!)).toMatchObject({ phase: "declined", endedBySender: true, senderNotice: null });
    expect(await s.access()).toEqual([[], [{ firstName: "Your match", state: "taken_back" }], []]);
    expect(await s.sharedWith()).toEqual([[], [], []]);
    expect(await s.withdraw(null)).toEqual({ revoked: 0, viewing: false });
    s.tick(24 * HOUR);
    expect(await s.noticesOf(silent.offerId!)).toEqual([]);

    const a = await world();
    const open = await a.ask([2]);
    expect(await a.access()).toEqual([[], askedLine, []]);
    expect(await a.withdraw(null)).toEqual({ revoked: 1, viewing: false });
    expect(await a.relay.offer(open.offerId!)).toMatchObject({ phase: "revoked", endedBySender: true, senderNotice: null });
    expect(await a.access()).toEqual([[], [{ firstName: "Your match", state: "taken_back" }], []]);
    expect(await a.sharedWith()).toEqual([[], [], []]);
  }, T);

  test("from ready on the list and a take-back read the same whether the match opened it, reported it or the match ended; an unsent 'on its way' is dropped at the end", async () => {
    const sentLine = [{ firstName: "Your match", state: "ready" }];
    const takenLine = [{ firstName: "Your match", state: "taken_back" }];
    const v = await world();
    const viewed = await v.ready([1]);
    expect((await v.call("open", { token: v.token(viewed.link) })).status).toBe(200);
    v.tick(24 * HOUR);
    expect(await v.settle(viewed.offerId)).toMatchObject({ phase: "ready", changed: false });
    expect(await v.noticesOf(viewed.offerId)).toEqual(["TellSent"]);

    const e = await world();
    const ended = await e.ready([1]);
    e.cut();
    expect(await e.settle(ended.offerId)).toMatchObject({ phase: "ended", notice: "NoNotice" });
    expect(await e.noticesOf(ended.offerId)).toEqual([]);

    const r = await world();
    const reported = await r.ready([1]);
    const phone = (await r.call("open", { token: r.token(reported.link) })).cookie!;
    expect(await r.call("answer", { token: r.token(reported.link), answer: "report" }, phone)).toMatchObject({ status: 410, body: { error: "link_expired" } });
    expect(await r.noticesOf(reported.offerId)).toEqual([]);

    for (const x of [v, e, r]) {
      expect(await x.access()).toEqual([sentLine, [], []]);
      expect(await x.sharedWith()).toEqual([["member_recipient"], [], []]);
    }
    for (const x of [v, e, r]) {
      expect(await x.withdraw([x.ids[0]!])).toEqual({ revoked: 1, viewing: true });
      expect(await x.access()).toEqual([takenLine, [], []]);
      expect(await x.withdraw([x.ids[0]!])).toEqual({ revoked: 0, viewing: false });
    }
    expect((await v.relay.offer(viewed.offerId))?.phase).toBe("revoked");
    expect((await e.relay.offer(ended.offerId))?.phase).toBe("ended");
    expect((await r.relay.offer(reported.offerId))?.phase).toBe("reported");
  }, T);

  test("the daily photo count keeps the photos of the consent after a take-back; the tick checks every open offer in turn", async () => {
    const w = await world();
    const first = await w.ask([1, 2, 3]);
    expect(first).toMatchObject({ admission: "OfferAsk", phase: "asking" });
    expect(await w.withdraw([w.ids[1]!, w.ids[2]!])).toEqual({ revoked: 1, viewing: false });
    expect(await w.relay.offer(first.offerId!)).toMatchObject({ phase: "asking", photoIds: [w.ids[0]] });
    expect(await w.withdraw(null)).toEqual({ revoked: 1, viewing: false });
    const second = await w.ask([1, 2, 3]);
    expect(second).toMatchObject({ admission: "OfferAsk", phase: "asking" });
    expect(await w.withdraw(null)).toEqual({ revoked: 1, viewing: false });
    const d = await w.draft([1]);
    expect((await w.relay.prepareOffer(w.sender, "slop", d.draftId, d.revision, Date.UTC(2026, 10, 22, 20)))?.admission).toBe("OfferDailyLimit");

    const a = await world(), b = await world();
    const ao = (await a.ask([1])).offerId!, bo = (await b.ask([1])).offerId!;
    const order = async () => { const due = await a.relay.due("slop", 1000); return [due.indexOf(ao), due.indexOf(bo)]; };
    a.tick(HOUR);
    await sql.begin(tx => a.relay.settle(tx, ao));
    const [a1, b1] = await order();
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(a1!);
    b.tick(2 * HOUR);
    await sql.begin(tx => b.relay.settle(tx, bo));
    const [a2, b2] = await order();
    expect(a2).toBeGreaterThanOrEqual(0);
    expect(a2).toBeLessThan(b2!);
  }, T);

  test("a changed stored file gives no bytes; another app is refused; two consents at once make one offer; a reused request id with another photo is a conflict", async () => {
    const w = await world();
    const { link } = await w.ready([1]);
    const phone = (await w.call("open", { token: w.token(link) })).cookie!;
    const [{ storage_key: key }] = await sql`select storage_key from platform.photos where id = ${w.ids[0]!}`;
    const file = join(dir, key as string), original = readFileSync(file);
    writeFileSync(file, new Uint8Array(original.length));
    expect(await w.call("image", { token: w.token(link), n: 1 }, phone)).toMatchObject({ status: 404, body: { error: "not_found" } });
    writeFileSync(file, original);
    expect((await w.call("image", { token: w.token(link), n: 1 }, phone)).status).toBe(200);

    const f = await world();
    const d = await f.draft([2]);
    expect(await f.call("open", { token: f.token(d.link!) }, undefined, "friends")).toMatchObject({ status: 404, body: { error: "link_unavailable" } });
    expect(await f.relay.prepareOffer(f.sender, "friends", d.draftId, d.revision, Date.UTC(2026, 10, 22, 20))).toBeUndefined();
    expect(await f.relay.mineLink(f.sender, "friends")).toBeUndefined();
    const prepared = (await f.relay.prepareOffer(f.sender, "slop", d.draftId, d.revision, Date.UTC(2026, 10, 22, 20)))!;
    const both = await Promise.all([sql.begin(tx => prepared.commit(tx)), sql.begin(tx => prepared.commit(tx))]);
    expect(new Set(both.map(c => c.offerId)).size).toBe(1);
    expect(both.map(c => c.replayed).sort()).toEqual([false, true]);
    expect(Number((await sql`select count(*)::int as n from platform.photo_offers where sender_person_id = ${f.sender}::uuid`)[0].n)).toBe(1);

    const offerId = both[0]!.offerId!;
    await sql`insert into platform.photo_relay_requests (sender_person_id, app_id, request_id, request_hash, item_id)
      values (${f.sender}::uuid, 'slop', ${`${offerId}_${f.ids[1]!}`}, ${"a".repeat(64)}, ${`pri_${"b".repeat(32)}`})`;
    await expect(sql.begin(tx => f.relay.answer(tx, offerId, f.recipient, "yes"))).rejects.toThrow("photo_selection_conflict");
    expect(await f.relay.offer(offerId)).toMatchObject({ phase: "asking" });
    expect((await f.relay.held("slop")).filter(h => h.offerId === offerId)).toEqual([]);
  }, T);

  test("a STOP that commits while a view-link renewal waits for the offer lock issues no new link", async () => {
    const w = await world();
    const { offerId } = await w.ready([1]);
    const viewLinks = async () => (await sql`select id from platform.photo_page_links where offer_id = ${offerId} and purpose = 'view' order by id`).map((r: any) => r.id as string);
    const before = await viewLinks();
    expect(before).toHaveLength(1);
    const watcher = new SQL({ url, max: 1 });
    let held!: () => void, release!: () => void;
    const holding = new Promise<void>(r => { held = r; }), gate = new Promise<void>(r => { release = r; });
    const stop = sql.begin(async tx => {
      await tx`select id from platform.photo_offers where id = ${offerId} for update`;
      held();
      await gate;
      return w.relay.endFor(w.recipient, tx);
    });
    await holding;
    const renewal = w.relay.renewViewLinks(w.recipient, "slop");
    let waiting = 0;
    for (let i = 0; i < 200 && waiting === 0; i++) {
      waiting = Number((await watcher`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)[0].n);
      if (waiting === 0) await new Promise(r => setTimeout(r, 25));
    }
    expect(waiting).toBe(1);
    release();
    expect(await stop).toBe(1);
    expect(await renewal).toEqual([]);
    expect(await viewLinks()).toEqual(before);
    await watcher.close();
  }, T);
});
