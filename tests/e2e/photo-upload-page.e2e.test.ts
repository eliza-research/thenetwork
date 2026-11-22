// spec/photoUploadPage.md, "The server answer decides between saved, refused, closed and a retry"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import {
  canAnswerUpload,
  enabled,
  type Event,
  initial,
  photoConsentHeaderSent,
  photoUploadOffered,
  type PhotoUploadPage,
  step,
} from "../../packages/core/src/generated/photoUploadPage.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { batchOf, type PhotoRefusalShown, photoTokenWellFormed, sendPhotos } from "../../packages/ui/src/api/photoUpload.ts";
import { newPhone, pgAvailable, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 120_000;
const MiB = 1024 * 1024;

describe.skipIf(!pgAvailable)("photo upload page (the /photos/add shell and machine against the site router and the backend)", () => {
  let st: Stack, sql: SQL;
  const realFetch = globalThis.fetch;
  beforeAll(async () => { st = await startStack(); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterEach(() => { globalThis.fetch = realFetch; });
  afterAll(async () => { globalThis.fetch = realFetch; await sql?.close(); await st?.close(); });

  const pageOn = (origin: string) => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/")) return realFetch(input, init);
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      headers.set("sec-fetch-site", "same-origin");
      return realFetch(`${origin}${input}`, { ...init, headers });
    }) as typeof fetch;
  };
  const pageOnSite = (app: AppId) => pageOn(st.sites[app].origin);

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  const png = (tag: string, bytes = 0) => {
    const pixels = new Uint8Array(Math.max(0, bytes - 57) + `PIXELS-${tag}`.length); pixels.set(new TextEncoder().encode(`PIXELS-${tag}`));
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };
  const photo = (tag: string, bytes = 0) => new File([png(tag, bytes)], `${tag}.png`, { type: "image/png" });
  const notAnImage = (tag: string) => new File([new TextEncoder().encode(`not a photo ${tag}`)], `${tag}.png`, { type: "image/png" });

  let seq = 0;
  const turn = async (phone: string, text: string) => {
    const messageId = `photo-page-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(60_000);
    return (await res.json()) as { outcome: string; replies?: string[] };
  };
  const fragmentIn = (replies: string[] = []) => /\/photos\/add#([A-Za-z0-9_-]+)/.exec(replies.join(" "))?.[1];
  const personOf = async (phone: string) => (await sql`select person_id from platform.phone_identities where e164 = ${phone}`)[0]!.person_id as string;
  const photoCount = async (phone: string) => (await sql`select count(*)::int as n from platform.photos where person_id = ${await personOf(phone)}`)[0]!.n as number;

  const adultWithTextedLink = async () => {
    const phone = newPhone();
    expect((await webJoin(st, "slop", phone, { age: 29 })).res.status).toBe(200);
    expect((await turn(phone, "ADD PHOTOS")).replies!.join(" ")).toContain("YES PHOTOS");
    const token = fragmentIn((await turn(phone, "YES PHOTOS")).replies);
    expect(token).toBeDefined();
    return { phone, token: token! };
  };
  const adultWithoutConsent = async (age = 27) => {
    const phone = newPhone();
    expect((await webJoin(st, "slop", phone, { age })).res.status).toBe(200);
    const issued = await st.svc.photoLinks.issue(await personOf(phone), "slop", "agent");
    if (!issued.ok) throw new Error(JSON.stringify(issued));
    return { phone, token: new URL(issued.url).hash.slice(1) };
  };

  class PhotoPage {
    page: PhotoUploadPage = initial;
    refused: PhotoRefusalShown[] = [];
    requests = 0;
    private files: File[] = [];
    constructor(private readonly token: string) {
      this.send({ type: "openPhotoPage", tokenWellFormed: photoTokenWellFormed(token) });
    }
    private send(event: Event): boolean {
      if (!enabled(this.page, event)) return false;
      this.page = step(this.page, event);
      return true;
    }
    choose(files: File[]) {
      if (this.send({ type: "choosePhotos", batch: batchOf(files) })) this.files = files;
    }
    tick(ticked: boolean) {
      this.send({ type: "tickConsent", ticked });
    }
    async upload() {
      if (!this.send({ type: "uploadPhotos", batch: batchOf(this.files) }) || !canAnswerUpload(this.page)) return;
      this.requests++;
      const result = await sendPhotos(this.token, this.files, photoConsentHeaderSent(this.page) ? PHOTO_CONSENT.version : undefined);
      this.refused = result.refused;
      this.send({ type: "answerUpload", answer: result.answer });
    }
  }

  test("a texted link saves the chosen photos once; the same link on a new page shows the closed link and stores nothing", async () => {
    const { phone, token } = await adultWithTextedLink();
    expect(photoTokenWellFormed(token)).toBe(true);
    pageOnSite("slop");
    const first = new PhotoPage(token);
    expect(photoUploadOffered(first.page)).toBe(true);
    first.choose([photo("a"), photo("b")]);
    await first.upload();
    expect([first.page.screen, first.page.savedCount, first.page.someRefused, first.page.linkOpen]).toEqual(["PhotoDone", 2, false, false]);
    expect(await photoCount(phone)).toBe(2);

    const again = new PhotoPage(token);
    again.choose([photo("c")]);
    await again.upload();
    expect([again.page.screen, again.page.savedCount]).toEqual(["PhotoLinkClosed", 0]);
    expect(await photoCount(phone)).toBe(2);
  }, T);

  test("without consent on file the answer asks for the box, the page does not resend unticked, and a ticked box sends the version", async () => {
    const { phone, token } = await adultWithoutConsent();
    pageOnSite("slop");
    const p = new PhotoPage(token);
    p.choose([photo("consent")]);
    await p.upload();
    expect([p.page.screen, p.page.error, p.page.consentTicked, p.page.linkOpen]).toEqual(["PhotoPick", "PhotoConsentNeeded", false, true]);
    expect(await photoCount(phone)).toBe(0);
    await p.upload();
    expect(p.requests).toBe(1);
    p.tick(true);
    expect(p.page.error).toBe("PhotoNoError");
    await p.upload();
    expect([p.page.screen, p.page.savedCount, p.requests]).toEqual(["PhotoDone", 1, 2]);
    expect((await st.svc.people.getMembership(await personOf(phone), "slop"))?.profile.photoConsent).toBe(PHOTO_CONSENT.version);
  }, T);

  test("the page refuses a batch outside the limits without a request, and the server's too-large answer keeps the link open", async () => {
    const { phone, token } = await adultWithTextedLink();
    pageOnSite("slop");
    const p = new PhotoPage(token);
    p.choose([1, 2, 3, 4, 5].map(i => photo(`n${i}`)));
    expect(p.page.error).toBe("PhotoPickCount");
    await p.upload();
    p.choose([photo("over-total-1", 2.9 * MiB), photo("over-total-2", 2.9 * MiB), photo("over-total-3", 2.9 * MiB)]);
    expect(p.page.error).toBe("PhotoPickTooLarge");
    await p.upload();
    p.choose([new File([png("heic")], "photo.heic", { type: "image/heic" })]);
    expect(p.page.error).toBe("PhotoPickType");
    await p.upload();
    expect(p.requests).toBe(0);

    const overServer = await sendPhotos(token, [photo("s1", 2.9 * MiB), photo("s2", 2.9 * MiB), photo("s3", 2.9 * MiB)], undefined);
    expect(overServer.answer.kind).toBe("UploadTooLarge");
    expect(await photoCount(phone)).toBe(0);

    p.choose([photo("fits", 4 * MiB - 64 * 1024), photo("fits-too", 4 * MiB - 64 * 1024)]);
    expect(p.page.error).toBe("PhotoNoError");
    await p.upload();
    expect([p.page.screen, p.page.savedCount]).toEqual(["PhotoDone", 2]);
    expect(await photoCount(phone)).toBe(2);
  }, T);

  test("a refused photo shows its line: some refused saves the rest, all refused saves nothing and closes the link", async () => {
    const partly = await adultWithTextedLink();
    pageOnSite("slop");
    const p = new PhotoPage(partly.token);
    p.choose([photo("good"), notAnImage("bad")]);
    await p.upload();
    expect([p.page.screen, p.page.savedCount, p.page.someRefused, p.refused.length]).toEqual(["PhotoDone", 1, true, 1]);
    expect(["bad_type", "bad_image"]).toContain(p.refused[0]);
    expect(await photoCount(partly.phone)).toBe(1);

    const none = await adultWithTextedLink();
    const q = new PhotoPage(none.token);
    q.choose([notAnImage("only")]);
    await q.upload();
    expect([q.page.screen, q.page.savedCount, q.page.linkOpen, q.refused.length]).toEqual(["PhotoAllRefused", 0, false, 1]);
    expect(["bad_type", "bad_image"]).toContain(q.refused[0]);
    expect(await photoCount(none.phone)).toBe(0);
  }, T);

  test("a server that cannot be reached leaves the link open and the page uploads again", async () => {
    const { phone, token } = await adultWithTextedLink();
    pageOn("http://127.0.0.1:1");
    const p = new PhotoPage(token);
    p.choose([photo("retry")]);
    await p.upload();
    expect([p.page.screen, p.page.error, p.page.linkOpen]).toEqual(["PhotoPick", "PhotoUnreachable", true]);
    pageOnSite("slop");
    await p.upload();
    expect([p.page.screen, p.page.savedCount, p.requests]).toEqual(["PhotoDone", 1, 2]);
    expect(await photoCount(phone)).toBe(1);
  }, T);

  test("a malformed token sends nothing; an unknown token, another site and an adult who is no longer 18+ close the link and store nothing", async () => {
    pageOnSite("slop");
    const malformed = new PhotoPage("short");
    expect(malformed.page.screen).toBe("PhotoBadLink");
    malformed.choose([photo("never")]);
    await malformed.upload();
    expect(malformed.requests).toBe(0);

    const unknown = new PhotoPage("A".repeat(43));
    unknown.choose([photo("unknown")]);
    await unknown.upload();
    expect(unknown.page.screen).toBe("PhotoLinkClosed");

    const wrongSite = await adultWithTextedLink();
    pageOnSite("ntwrk");
    const elsewhere = new PhotoPage(wrongSite.token);
    elsewhere.choose([photo("wrong-site")]);
    await elsewhere.upload();
    expect(elsewhere.page.screen).toBe("PhotoLinkClosed");
    pageOnSite("slop");
    const home = new PhotoPage(wrongSite.token);
    home.choose([photo("after-wrong-site")]);
    await home.upload();
    expect(home.page.screen).toBe("PhotoLinkClosed");
    expect(await photoCount(wrongSite.phone)).toBe(0);

    const younger = await adultWithTextedLink();
    await st.svc.accounts.recordAge(younger.phone, await st.svc.people.getPerson(await personOf(younger.phone)), 16);
    const minor = new PhotoPage(younger.token);
    minor.choose([photo("minor")]);
    await minor.upload();
    expect([minor.page.screen, minor.page.savedCount]).toEqual(["PhotoLinkClosed", 0]);
    expect(await photoCount(younger.phone)).toBe(0);
  }, T);

  test("a minor gets no link to open", async () => {
    const teen = newPhone();
    expect((await webJoin(st, "slop", teen, { age: 15 })).res.status).toBe(200);
    expect(fragmentIn((await turn(teen, "ADD PHOTOS")).replies)).toBeUndefined();
    expect(fragmentIn((await turn(teen, "YES PHOTOS")).replies)).toBeUndefined();
    expect(await st.svc.photoLinks.issue(await personOf(teen), "slop", "agent")).toEqual({ ok: false, reason: "adults_only" });
  }, T);
});
