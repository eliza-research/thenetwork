// spec/photoUploadLink.md, "Story: Add my photos with a private one-time link"
// The deployed path for slop.date photos: the signed gateway turn carries no media, so the member texts
// ADD PHOTOS (through /internal/turn, as the Eliza gateway sends it), agrees to the photo consent, gets
// one app-bound link, and the link page posts the photos through the site router to the backend. Before
// this change ADD PHOTOS went on to the conversation and /api/photos/upload did not exist, so no photo
// could arrive. Needs the dev Postgres on :54339.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { writeStaffHold } from "../../packages/network/service/staff-safety-holds.ts";
import { Browser, newPhone, pgAvailable, signIn, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 120_000;


describe.skipIf(!pgAvailable)("photo upload link (deployed path for slop.date photos)", () => {
  let st: Stack, sql: SQL;
  beforeAll(async () => { st = await startStack(); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterAll(async () => { await sql?.close(); await st?.close(); });

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  /** A PNG; `bytes` pads the pixel chunk so the file is a phone-photo size. */
  const png = (tag: string, bytes = 0) => {
    const pixels = new Uint8Array(Math.max(0, bytes - 57) + `PIXELS-${tag}`.length); pixels.set(new TextEncoder().encode(`PIXELS-${tag}`));
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };
  let seq = 0;
  /** A text from `phone` routed to slop, signed as the Eliza gateway signs /internal/turn. */
  const turn = async (phone: string, text: string) => {
    const messageId = `photo-link-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(60_000);
    return (await res.json()) as { outcome: string; replies?: string[] };
  };
  const tokenIn = (replies: string[] = []) => /\/photos\/add#([A-Za-z0-9_-]{43})/.exec(replies.join(" "))?.[1];
  const upload = (token: string, photos: Uint8Array<ArrayBuffer>[], o: { app?: "slop" | "ntwrk"; browser?: Browser; consent?: boolean } = {}) => {
    const form = new FormData();
    for (const p of photos) form.append("photo", new Blob([p], { type: "image/png" }), "photo.png");
    return st.site(o.app ?? "slop", "/api/photos/upload", { browser: o.browser, method: "POST", body: form,
      headers: { "x-photo-upload-link": token, ...(o.consent ? { "x-photo-consent": PHOTO_CONSENT.version } : {}) } });
  };
  const personOf = async (phone: string) => (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
  const photoCount = async (phone: string) => (await sql`select count(*)::int as n from platform.photos where person_id = ${await personOf(phone)}`)[0]!.n as number;
  /** A consenting adult with a fresh link. */
  const adultWithLink = async () => {
    const phone = newPhone();
    expect((await webJoin(st, "slop", phone, { age: 29 })).res.status).toBe(200);
    const ask = await turn(phone, "ADD PHOTOS");
    expect(ask.outcome).toBe("handled");
    expect(ask.replies!.join(" ")).toContain("Reply YES PHOTOS");
    expect(tokenIn(ask.replies)).toBeUndefined();
    const agreed = await turn(phone, "YES PHOTOS");
    const token = tokenIn(agreed.replies);
    expect(token).toBeDefined();
    return { phone, token: token! };
  };

  test("ADD PHOTOS, the consent, then one link stores up to four photos once; a reused link stores nothing", async () => {
    const { phone, token } = await adultWithLink();
    const ok = await upload(token, [png("a"), png("b")]);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, stored: 2, refused: [] });
    expect(await photoCount(phone)).toBe(2);
    const again = await upload(token, [png("c")]);
    expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([410, "link_unavailable"]);
    expect(await photoCount(phone)).toBe(2);
    // The consent is recorded, so the next ADD PHOTOS answers with a link at once.
    const next = tokenIn((await turn(phone, "add photos")).replies);
    expect(next).toBeDefined();
    // Five photos in one use are refused before the link is used.
    expect((await upload(next!, [1, 2, 3, 4, 5].map(i => png(`x${i}`)))).status).toBe(400);
    expect((await upload(next!, [png("d")])).status).toBe(200);
    expect(await photoCount(phone)).toBe(3);
  }, T);

  test("an expired link and a link used on another app store nothing; the link, not a session, names the person", async () => {
    const { phone, token } = await adultWithLink();
    st.clock.advance(15 * 60_000);
    expect((await upload(token, [png("late")])).status).toBe(410);
    const fresh = tokenIn((await turn(phone, "ADD PHOTOS")).replies)!;
    expect((await upload(fresh, [png("wrong-app")], { app: "ntwrk" })).status).toBe(410);
    expect((await upload(fresh, [png("after-wrong-app")])).status).toBe(410);
    expect(await photoCount(phone)).toBe(0);
    // Another adult's signed-in session does not move the photos: they go to the link's own person.
    const other = newPhone(), b = new Browser();
    expect((await webJoin(st, "slop", other, { age: 31, browser: b })).res.status).toBe(200);
    await signIn(st, "slop", other, b);
    const mine = tokenIn((await turn(phone, "ADD PHOTOS")).replies)!;
    expect((await upload(mine, [png("bound")], { browser: b })).status).toBe(200);
    expect([await photoCount(phone), await photoCount(other)]).toEqual([1, 0]);
  }, T);

  test("a minor gets no link; an adult whose age drops or who is banned after the issue cannot use it", async () => {
    const teen = newPhone();
    expect((await webJoin(st, "slop", teen, { age: 15 })).res.status).toBe(200);
    const asked = await turn(teen, "ADD PHOTOS");
    expect(asked.outcome).toBe("handled");
    expect(tokenIn(asked.replies)).toBeUndefined();
    expect(await st.svc.photoLinks.issue(await personOf(teen), "slop", "agent")).toEqual({ ok: false, reason: "adults_only" });
    expect((await sql`select 1 from platform.photo_upload_links where person_id = ${await personOf(teen)}`).length).toBe(0);

    const younger = await adultWithLink();
    await st.svc.accounts.recordAge(younger.phone, await st.svc.people.getPerson(await personOf(younger.phone)), 16);
    expect((await upload(younger.token, [png("minor")])).status).toBe(410);
    expect(await photoCount(younger.phone)).toBe(0);

    const banned = await adultWithLink();
    await st.svc.people.ban({ id: randomUUID(), scope: "person", personId: await personOf(banned.phone), phoneHash: null, reason: "e2e", reportId: null, bannedBy: "e2e", at: st.clock.now() });
    expect((await upload(banned.token, [png("banned")])).status).toBe(410);
    expect(await photoCount(banned.phone)).toBe(0);
  }, T);

  test("without a recorded consent the upload must carry it, and then records it on the membership", async () => {
    const phone = newPhone();
    expect((await webJoin(st, "slop", phone, { age: 27 })).res.status).toBe(200);
    const issued = await st.svc.photoLinks.issue(await personOf(phone), "slop", "agent");
    if (!issued.ok) throw new Error(JSON.stringify(issued));
    const token = /#([A-Za-z0-9_-]{43})$/.exec(issued.url)![1]!;
    expect(issued.url.startsWith("https://slop.date/photos/add#")).toBe(true);
    expect([(await upload(token, [png("no-consent")])).status, await photoCount(phone)]).toEqual([400, 0]);
    expect((await upload(token, [png("consent")], { consent: true })).status).toBe(200);
    expect(await photoCount(phone)).toBe(1);
    const m = await st.svc.people.getMembership(await personOf(phone), "slop");
    expect(m?.profile.photoConsent).toBe(PHOTO_CONSENT.version);
  }, T);
  const MiB = 1024 * 1024;
  test("a batch is bounded by 8 MiB in all, so the largest allowed batch passes the site router", async () => {
    const { phone, token } = await adultWithLink();
    // Over the router's 9 MiB: refused at the edge, unread, and the link stays open.
    expect((await upload(token, [png("e1", 3.5 * MiB), png("e2", 3.5 * MiB), png("e3", 3.5 * MiB)])).status).toBe(413);
    // Under the router's cap but over 8 MiB in all: refused before the link is used.
    const over = await upload(token, [png("o1", 2.9 * MiB), png("o2", 2.9 * MiB), png("o3", 2.9 * MiB)]);
    expect([over.status, ((await over.json()) as { error: string }).error]).toEqual([413, "too_large"]);
    expect(await photoCount(phone)).toBe(0);
    // The largest batch the link text promises arrives through the router and is stored.
    const ok = await upload(token, [png("m1", 4 * MiB - 64 * 1024), png("m2", 4 * MiB - 64 * 1024)]);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await photoCount(phone)).toBe(2);
  }, T);

  test("a staff hold refuses an issue and a link issued before it; a member who left slop cannot use a link", async () => {
    const held = await adultWithLink();
    const personId = await personOf(held.phone);
    await sql.begin(tx => writeStaffHold(tx, personId, "slop", randomUUID(), st.clock.now()));
    expect((await upload(held.token, [png("held")])).status).toBe(410);
    expect(await st.svc.photoLinks.issue(personId, "slop", "agent")).toEqual({ ok: false, reason: "held" });
    expect(tokenIn((await turn(held.phone, "ADD PHOTOS")).replies)).toBeUndefined();
    expect(await photoCount(held.phone)).toBe(0);

    const left = await adultWithLink();
    expect((await turn(left.phone, "leave slop.date")).outcome).toBe("handled");
    expect((await upload(left.token, [png("left")])).status).toBe(410);
    expect(await photoCount(left.phone)).toBe(0);
    expect((await st.svc.photoLinks.issue(await personOf(left.phone), "slop", "agent")).ok).toBe(false);
  }, T);

  test("an unknown token is refused before the body is read", async () => {
    // A body that is not even multipart: before the fix the server read and judged it (415); now the token is looked up first.
    const res = await st.site("slop", "/api/photos/upload", { method: "POST", body: "x".repeat(1024), headers: { "content-type": "text/plain", "x-photo-upload-link": "A".repeat(43) } });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([410, "link_unavailable"]);
  }, T);
});
