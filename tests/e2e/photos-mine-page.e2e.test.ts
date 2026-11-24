// spec/photosMinePage.md, "The person takes back one share at a time, and only the server's answer marks it taken back"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import {
  canAnswerOpen,
  canAnswerTakeBack,
  enabled,
  type Event,
  type GrantMark,
  grantMarkAfter,
  grantMarkOnOpen,
  grantOffersTakeBack,
  initial,
  type PhotoHoldingsPage,
  type PhotoTile,
  photoTileFor,
  step,
} from "../../packages/core/src/generated/photosMinePage.ts";
import type { NetworkState } from "../../packages/network/src/network.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { type HoldingPhoto, holdingImage, holdingsTokenWellFormed, openHoldings, takeBackShare } from "../../packages/ui/src/api/photosMine.ts";
import { Browser, newPhone, pgAvailable, SAFETY_TOKEN, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const DAY = 86_400_000;

describe.skipIf(!pgAvailable)("my photos page (the /photos/mine shell and machine against the site router and the backend)", () => {
  let st: Stack, sql: SQL;
  const realFetch = globalThis.fetch;
  beforeAll(async () => { st = await startStack({ slopPhotoReviewer: true }); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterEach(() => { globalThis.fetch = realFetch; });
  afterAll(async () => { globalThis.fetch = realFetch; await sql?.close(); await st?.close(); });

  const pageOn = (origin: string, phone: Browser) => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/")) return realFetch(input, init);
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      headers.set("sec-fetch-site", "same-origin");
      if (phone.jar.size) headers.set("cookie", phone.header());
      const res = await realFetch(`${origin}${input}`, { ...init, headers });
      phone.take(res);
      return res;
    }) as typeof fetch;
  };
  const pageOnSite = (app: AppId, phone: Browser) => pageOn(st.sites[app].origin, phone);

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  const png = (tag: string) => {
    const pixels = new TextEncoder().encode(`PIXELS-${tag}`);
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };

  let seq = 0;
  const turn = async (phone: string, text: string) => {
    const messageId = `photos-mine-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(60_000);
    return ((await res.json()) as { replies?: string[] }).replies?.join(" ") ?? "";
  };
  const member = async (phone: string) => {
    const [row] = await sql`select p.person_id, m.member_id from platform.phone_identities p join platform.memberships m on m.person_id = p.person_id and m.app_id = 'slop' where p.e164 = ${phone}`;
    return { personId: row!.person_id as string, memberId: row!.member_id as string };
  };
  const mineToken = (reply: string) => /\/photos\/mine#([A-Za-z0-9_-]{43})/.exec(reply)?.[1];
  const checkToken = (reply: string) => /\/photos\/check#([A-Za-z0-9_-]{43})/.exec(reply)?.[1];
  const offerPhase = async (senderPersonId: string, recipientMemberId: string) =>
    (await sql`select phase from platform.photo_offers where sender_person_id = ${senderPersonId}::uuid and recipient_member_id = ${recipientMemberId} order by created_at desc limit 1`)[0]?.phase as string | undefined;

  let pairSeq = 0;
  const pair = async (senderName: string, ...receiverNames: string[]) => {
    const senderPhone = newPhone();
    expect((await webJoin(st, "slop", senderPhone, { age: 29, firstName: senderName })).res.status).toBe(200);
    const sender = await member(senderPhone);
    const receivers: { phone: string; memberId: string; personId: string }[] = [];
    for (const name of receiverNames) {
      const phone = newPhone();
      expect((await webJoin(st, "slop", phone, { age: 31, firstName: name })).res.status).toBe(200);
      receivers.push({ phone, ...(await member(phone)) });
    }
    await st.svc.runtimeFor("slop")!.unitOfWork(n => {
      const s = n.exportState(), now = st.clock.now();
      for (const r of receivers) {
        const id = `e2e-mine-${++pairSeq}`, ids = [sender.memberId, r.memberId];
        s.opps.push({ id, origin: "engine", kind: "intro", category: "romance", objective: "drinks", detail: "drinks", participants: ids, alternates: [], primed: [], status: ids.map(m => [m, "yes"]), explanations: {}, stage: "scheduled", deadline: now + 30 * DAY, createdAt: now, score: .8, generator: "fixture", components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 }, exploration: false, review: { queuedAt: now, deadline: now + 30 * DAY, decision: "approve", reviewer: "fixture" }, sameDay: false, contacted: ids, reminded: [], feedbackFrom: [], tags: [], replacements: 0 } as NetworkState["opps"][number]);
      }
      n.importState(s);
    });
    for (const tag of ["first", "second"]) expect((await st.svc.photos.upload(sender.personId, "slop", png(`${senderName}-${tag}`), PHOTO_CONSENT.version)).ok).toBe(true);
    return { senderPhone, sender, receivers };
  };
  const offer = async (senderPhone: string, words: string) => {
    expect(checkToken(await turn(senderPhone, words))).toBeDefined();
    expect(await turn(senderPhone, "YES")).toContain("I'll ask");
  };
  const release = async (senderPersonId: string, recipientMemberId: string) => {
    const [o] = await sql`select id from platform.photo_offers where sender_person_id = ${senderPersonId}::uuid and recipient_member_id = ${recipientMemberId} and phase = 'reviewing'`;
    for (const wait of [60_000, 300_000, 900_000, 3_600_000]) {
      st.clock.advance(wait);
      await st.svc.tick();
    }
    for (const item of await sql`select id from platform.photo_relay_items where offer_id = ${o!.id} and state = 'pending'`) {
      const preview = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${item.id}/photo?app=slop`, { headers: { authorization: `Bearer ${SAFETY_TOKEN}` } }));
      await preview.arrayBuffer();
      const res = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${item.id}/release?app=slop`, { method: "POST",
        headers: { authorization: `Bearer ${SAFETY_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ note: "Photo checked for consent and safety", photoReviewToken: preview.headers.get("x-network-photo-review-token") }) }));
      expect(res.status, await res.clone().text()).toBe(200);
    }
  };

  class MinePage {
    page: PhotoHoldingsPage = initial;
    photos: HoldingPhoto[] = [];
    marks: Record<string, GrantMark> = {};
    tiles: Record<number, PhotoTile> = {};
    urls: string[] = [];
    requests = 0;
    private token = "";
    constructor(private readonly fragment: string) {}
    private send(event: Event): boolean {
      if (!enabled(this.page, event)) return false;
      this.page = step(this.page, event);
      if (!this.page.linkHeld) this.token = "";
      return true;
    }
    async open() {
      if (!this.send({ type: "openHoldingsPage", tokenWellFormed: holdingsTokenWellFormed(this.fragment) }) || !canAnswerOpen(this.page)) return;
      this.token = this.fragment;
      await this.read();
    }
    async retry() {
      if (this.send({ type: "retryOpen" })) await this.read();
    }
    private async read() {
      this.requests++;
      const result = await openHoldings(this.token);
      if (!this.send({ type: "answerOpen", opened: result.answer })) return;
      this.photos = result.photos;
      this.marks = Object.fromEntries(result.photos.flatMap(p => p.shares.map((s, i) => [`${p.n}:${i}`, grantMarkOnOpen(s.access)])));
      for (const photo of this.photos) {
        if (!this.page.linkHeld) return;
        this.requests++;
        const image = await holdingImage(this.token, photo.n);
        if (image.url) this.urls.push(image.url);
        if (this.send({ type: "answerImage", imageAnswer: image.kind })) this.tiles[photo.n] = photoTileFor(image.kind);
      }
    }
    share(firstName: string, n: number) {
      const photo = this.photos.find(p => p.n === n)!;
      const index = photo.shares.findIndex(s => s.firstName === firstName);
      expect(index).toBeGreaterThanOrEqual(0);
      return { key: `${n}:${index}`, share: photo.shares[index]! };
    }
    async takeBack(firstName: string, n: number) {
      const { key, share } = this.share(firstName, n);
      if (!grantOffersTakeBack(this.page, this.marks[key]!) || !this.send({ type: "takeBack" }) || !canAnswerTakeBack(this.page)) return;
      this.marks[key] = "GrantTakingBack";
      this.requests++;
      const kind = await takeBackShare(this.token, n, share.firstName);
      if (this.send({ type: "answerTakeBack", takeBackAnswer: kind })) this.marks[key] = grantMarkAfter(kind);
      if (this.send({ type: "reopenAfterTakeBack" }) && canAnswerOpen(this.page)) await this.read();
      return kind;
    }
  }

  test("a texted MY PHOTOS link lists each photo with who has it, shows the images, and takes back one share", async () => {
    const { senderPhone, sender, receivers: [maya, jordan] } = await pair("Ari", "Maya", "Jordan");
    await offer(senderPhone, "send Maya my first photo");
    expect(await turn(maya!.phone, "yes")).toContain("private link");
    await release(sender.personId, maya!.memberId);
    expect(await offerPhase(sender.personId, maya!.memberId)).toBe("ready");
    await offer(senderPhone, "send Jordan my first photo");

    const token = mineToken(await turn(senderPhone, "MY PHOTOS"));
    expect(token).toBeDefined();
    pageOnSite("slop", new Browser());
    const p = new MinePage(token!);
    await p.open();
    expect([p.page.screen, p.page.photos, p.page.grants, p.page.linkHeld]).toEqual(["HoldingsList", 2, 2, true]);
    const byName = (shares: HoldingPhoto["shares"]) => [...shares].sort((a, b) => a.firstName.localeCompare(b.firstName));
    expect(p.photos.map(ph => [ph.n, ph.label, /^\d{4}-\d{2}-\d{2}$/.test(ph.addedOn), byName(ph.shares)])).toEqual([
      [1, null, true, [{ firstName: "Jordan", access: "GrantAsked" }, { firstName: "Maya", access: "GrantReady" }]],
      [2, null, true, []],
    ]);
    expect(JSON.stringify(p.photos)).not.toMatch(/ph_|pof_|http|sha256|score/);
    expect(p.tiles).toEqual({ 1: "TileShown", 2: "TileShown" });
    expect(p.urls.length).toBe(2);
    expect(p.urls.every(u => u.startsWith("blob:"))).toBe(true);

    expect(await p.takeBack("Jordan", 1)).toBe("TakeBackDone");
    expect([p.page.screen, p.page.grants, p.page.takenBack, p.marks[p.share("Jordan", 1).key], p.share("Jordan", 1).share.access]).toEqual(["HoldingsList", 1, 0, "GrantTakenBack", "GrantWasTakenBack"]);
    expect(await offerPhase(sender.personId, jordan!.memberId)).toBe("revoked");
    expect(await offerPhase(sender.personId, maya!.memberId)).toBe("ready");
    expect(grantOffersTakeBack(p.page, p.marks[p.share("Jordan", 1).key]!)).toBe(false);
    expect(await p.takeBack("Jordan", 1)).toBeUndefined();

    expect(await p.takeBack("Maya", 1)).toBe("TakeBackDone");
    expect([p.page.screen, p.page.grants, p.page.takenBack]).toEqual(["HoldingsList", 0, 0]);
    expect(p.photos[0]!.shares.map(s => s.access)).toEqual(["GrantWasTakenBack", "GrantWasTakenBack"]);
    expect(Object.values(p.marks)).toEqual(["GrantTakenBack", "GrantTakenBack"]);
    expect(await offerPhase(sender.personId, maya!.memberId)).toBe("revoked");
    for (const u of p.urls) URL.revokeObjectURL(u);
  }, T);

  test("a share whose offer already ended answers nothing open, and the page offers it no more", async () => {
    const { senderPhone, sender, receivers: [sam] } = await pair("Bea", "Sam");
    await offer(senderPhone, "send Sam my first photo");
    const token = mineToken(await turn(senderPhone, "MY PHOTOS"))!;
    pageOnSite("slop", new Browser());
    const p = new MinePage(token);
    await p.open();
    expect(p.share("Sam", 1).share.access).toBe("GrantAsked");
    expect(await turn(sam!.phone, "no")).toContain("isn't told why");
    expect(await offerPhase(sender.personId, sam!.memberId)).toBe("declined");
    expect(await p.takeBack("Sam", 1)).toBe("TakeBackNothingOpen");
    expect([p.page.grants, p.page.takenBack, p.marks[p.share("Sam", 1).key]]).toEqual([0, 0, "GrantClosed"]);
  }, T);

  test("the link opens on one phone only, times out after 15 minutes, and a closed link sends nothing more", async () => {
    const { senderPhone, sender, receivers: [maya] } = await pair("Cy", "Maya");
    await offer(senderPhone, "send Maya my first photo");
    const token = mineToken(await turn(senderPhone, "MY PHOTOS"))!;
    const first = new Browser();
    pageOnSite("slop", first);
    const p = new MinePage(token);
    await p.open();
    expect(p.page.screen).toBe("HoldingsList");

    pageOnSite("slop", new Browser());
    const other = new MinePage(token);
    await other.open();
    expect([other.page.screen, other.page.linkHeld, other.photos]).toEqual(["HoldingsOtherPhone", false, []]);

    pageOnSite("slop", first);
    st.clock.advance(15 * 60_000);
    expect(await p.takeBack("Maya", 1)).toBe("TakeBackTimedOut");
    expect([p.page.screen, p.page.linkHeld]).toEqual(["HoldingsTimedOut", false]);
    expect(await offerPhase(sender.personId, maya!.memberId)).toBe("asking");
    const before = p.requests;
    await p.retry();
    expect(p.requests).toBe(before);

    const late = new MinePage(token);
    await late.open();
    expect(late.page.screen).toBe("HoldingsTimedOut");
  }, T);

  test("a malformed token sends nothing; an unknown token, a check link, another site and a member no longer 18+ show the link does not work", async () => {
    pageOnSite("slop", new Browser());
    const malformed = new MinePage("short");
    await malformed.open();
    expect([malformed.page.screen, malformed.requests]).toEqual(["HoldingsUnavailable", 0]);

    const unknown = new MinePage("A".repeat(43));
    await unknown.open();
    expect(unknown.page.screen).toBe("HoldingsUnavailable");

    const { senderPhone } = await pair("Dee", "Maya");
    const token = mineToken(await turn(senderPhone, "MY PHOTOS"))!;
    const check = checkToken(await turn(senderPhone, "send Maya my first photo"))!;
    const wrongPage = new MinePage(check);
    await wrongPage.open();
    expect([wrongPage.page.screen, wrongPage.photos]).toEqual(["HoldingsUnavailable", []]);

    pageOnSite("ntwrk", new Browser());
    const elsewhere = new MinePage(token);
    await elsewhere.open();
    expect(elsewhere.page.screen).toBe("HoldingsUnavailable");

    const older = await pair("Eve", "Jordan");
    const minorToken = mineToken(await turn(older.senderPhone, "MY PHOTOS"))!;
    await st.svc.accounts.recordAge(older.senderPhone, await st.svc.people.getPerson(older.sender.personId), 16);
    pageOnSite("slop", new Browser());
    const minor = new MinePage(minorToken);
    await minor.open();
    expect([minor.page.screen, minor.photos]).toEqual(["HoldingsUnavailable", []]);
  }, T);

  test("a server that cannot be reached keeps the link, and Try again lists the photos", async () => {
    const { senderPhone } = await pair("Fay", "Maya");
    const token = mineToken(await turn(senderPhone, "MY PHOTOS"))!;
    const phone = new Browser();
    pageOn("http://127.0.0.1:1", phone);
    const p = new MinePage(token);
    await p.open();
    expect([p.page.screen, p.page.notice, p.page.linkHeld]).toEqual(["HoldingsOpenFailed", "HoldingsUnreachable", true]);
    pageOnSite("slop", phone);
    await p.retry();
    expect([p.page.screen, p.page.photos, p.page.grants]).toEqual(["HoldingsList", 2, 0]);
    expect(p.photos.every(ph => ph.shares.length === 0)).toBe(true);
  }, T);
});
