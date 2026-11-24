// spec/photosViewPage.md, "Photo view page"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import type { NetworkState } from "../../packages/network/src/network.ts";
import {
  canAnswerReport,
  canAnswerViewImage,
  canAnswerViewOpen,
  canTapToView,
  enabled,
  type Event,
  initial,
  type PhotosViewPage,
  step,
  viewPhotosHeld,
} from "../../packages/core/src/generated/photosViewPage.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { loadPhotoView, openPhotoView, photoViewTokenWellFormed, reportPhotoView } from "../../packages/ui/src/api/photosView.ts";
import { Browser, newPhone, pgAvailable, SAFETY_TOKEN, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const DAY = 86_400_000;

describe.skipIf(!pgAvailable)("photo view page (the /photos/view shell and machine against the site router and the backend)", () => {
  let st: Stack, sql: SQL;
  const realFetch = globalThis.fetch;
  beforeAll(async () => { st = await startStack({ slopPhotoReviewer: true }); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterEach(() => { globalThis.fetch = realFetch; });
  afterAll(async () => { globalThis.fetch = realFetch; await sql?.close(); await st?.close(); });

  let sent: { method: string; url: string; body: string }[] = [];
  const phoneOn = (browser: Browser) => {
    sent = [];
    const origin = st.sites.slop.origin;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/")) return realFetch(input, init);
      const { cache: _cache, referrerPolicy: _referrer, credentials: _credentials, ...rest } = init ?? {};
      const headers = new Headers(rest.headers);
      headers.set("origin", origin);
      headers.set("sec-fetch-site", "same-origin");
      if (browser.jar.size) headers.set("cookie", browser.header());
      sent.push({ method: rest.method ?? "GET", url: input, body: typeof rest.body === "string" ? rest.body : "" });
      const res = await realFetch(`${origin}${input}`, { ...rest, headers });
      browser.take(res);
      return res;
    }) as typeof fetch;
  };

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  const png = (tag: string) => {
    const pixels = new TextEncoder().encode(`PIXELS-${tag}`);
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };
  let seq = 0;
  const turn = async (phone: string, text: string) => {
    const messageId = `photos-view-page-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(60_000);
    const out = (await res.json()) as { outcome: string; replies?: string[] };
    return { ...out, reply: (out.replies ?? []).join(" ") };
  };
  const member = async (phone: string) => {
    const [row] = await sql`select p.person_id, m.member_id from platform.phone_identities p join platform.memberships m on m.person_id = p.person_id and m.app_id = 'slop' where p.e164 = ${phone}`;
    return { personId: row!.person_id as string, memberId: row!.member_id as string };
  };
  const phaseOf = async (offerId: string) => (await sql`select phase from platform.photo_offers where id = ${offerId}`)[0]!.phase as string;

  const readyOffer = async (tag: string) => {
    const ari = newPhone(), maya = newPhone();
    expect((await webJoin(st, "slop", ari, { age: 29, firstName: "Ari" })).res.status).toBe(200);
    expect((await webJoin(st, "slop", maya, { age: 30, firstName: "Maya" })).res.status).toBe(200);
    const sender = await member(ari), receiver = await member(maya);
    const threadId = `e2e-photos-view-${tag}`;
    await st.svc.runtimeFor("slop")!.unitOfWork(n => {
      const s = n.exportState(), now = st.clock.now(), ids = [sender.memberId, receiver.memberId];
      s.opps = s.opps.filter(op => op.id !== threadId);
      s.opps.push({ id: threadId, origin: "engine", kind: "intro", category: "romance", objective: "drinks", detail: "drinks", participants: ids, alternates: [], primed: [], status: ids.map(id => [id, "yes"]), explanations: {}, stage: "scheduled", deadline: now + 30 * DAY, createdAt: now, score: .8, generator: "fixture", components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 }, exploration: false, review: { queuedAt: now, deadline: now + 30 * DAY, decision: "approve", reviewer: "fixture" }, sameDay: false, contacted: ids, reminded: [], feedbackFrom: [], tags: [], replacements: 0 } as NetworkState["opps"][number]);
      n.importState(s);
    });
    expect((await st.svc.photos.upload(sender.personId, "slop", png(`ari-${tag}`), PHOTO_CONSENT.version)).ok).toBe(true);
    expect((await turn(ari, "send Maya my first photo")).outcome).toBe("handled");
    expect((await turn(ari, "YES")).outcome).toBe("handled");
    const [offer] = await sql`select id from platform.photo_offers where sender_person_id = ${sender.personId}::uuid`;
    const offerId = offer!.id as string;
    expect((await turn(maya, "yes")).outcome).toBe("handled");
    for (const wait of [60_000, 300_000, 900_000, 3_600_000]) {
      st.clock.advance(wait);
      await st.svc.tick();
    }
    const [item] = await sql`select id, state from platform.photo_relay_items where offer_id = ${offerId}`;
    expect(item!.state).toBe("pending");
    const itemId = item!.id as string;
    const preview = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${itemId}/photo?app=slop`, { headers: { authorization: `Bearer ${SAFETY_TOKEN}` } }));
    expect(preview.status).toBe(200);
    await preview.arrayBuffer();
    const release = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${itemId}/release?app=slop`, { method: "POST",
      headers: { authorization: `Bearer ${SAFETY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ note: "Photo checked for consent and safety", photoReviewToken: preview.headers.get("x-network-photo-review-token") }) }));
    expect(release.status, await release.clone().text()).toBe(200);
    expect(await phaseOf(offerId)).toBe("ready");
    const [ready] = await sql`select body from network.messages where app_id = 'slop' and member_id = ${receiver.memberId} and id = ${`photo-ready:${offerId}`}`;
    const token = /\/photos\/view#([A-Za-z0-9_-]{43})/.exec(String(ready?.body))?.[1];
    expect(token).toBeDefined();
    return { ari, maya, senderMemberId: sender.memberId, receiverMemberId: receiver.memberId, offerId, token: token! };
  };

  class ViewPage {
    page: PhotosViewPage = initial;
    urls: string[] = [];
    fromFirstName = "";
    constructor(private readonly token: string) {
      this.send({ type: "openViewPage", tokenWellFormed: photoViewTokenWellFormed(token) });
    }
    private send(event: Event): boolean {
      if (!enabled(this.page, event)) return false;
      this.page = step(this.page, event);
      if (!viewPhotosHeld(this.page)) { for (const url of this.urls) URL.revokeObjectURL(url); this.urls = []; }
      return true;
    }
    async tap() {
      if (!this.send({ type: "tapToView" }) || !canAnswerViewOpen(this.page)) return;
      const opened = await openPhotoView(this.token);
      if (!this.send({ type: "answerViewOpen", openAnswer: opened.answer })) return;
      if (this.page.screen !== "ViewShowing") return;
      this.fromFirstName = opened.fromFirstName;
      for (let n = 1; n <= this.page.count && canAnswerViewImage(this.page); n++) {
        const image = await loadPhotoView(this.token, n);
        if (image.url !== undefined) this.urls.push(image.url);
        this.send({ type: "answerViewImage", image: image.answer });
      }
    }
    askToReport() { return this.send({ type: "askToReport" }); }
    async report() {
      if (!this.send({ type: "sendReport" }) || !canAnswerReport(this.page)) return;
      this.send({ type: "answerReport", report: await reportPhotoView(this.token) });
    }
  }

  test("nothing is sent before the tap; the tap opens the photo and binds this phone; another phone sees the other-phone step", async () => {
    const { offerId, token } = await readyOffer("bind");
    const mayaPhone = new Browser();
    phoneOn(mayaPhone);
    const first = new ViewPage(token);
    expect([first.page.screen, first.page.linkHeld, sent.length]).toEqual(["ViewTap", true, 0]);
    expect(await phaseOf(offerId)).toBe("ready");

    await first.tap();
    expect([first.page.screen, first.page.pending, first.page.count, first.page.loaded, first.page.missing]).toEqual(["ViewShowing", "ViewIdle", 1, 1, 0]);
    expect(first.fromFirstName).toBe("Ari");
    expect(first.urls).toHaveLength(1);
    expect(first.urls[0]).toMatch(/^blob:/);
    expect(await phaseOf(offerId)).toBe("ready");
    expect(sent.map(r => [r.method, r.url])).toEqual([["POST", "/api/photos/page/open"], ["POST", "/api/photos/page/image"]]);
    expect(sent.every(r => !r.url.includes(token))).toBe(true);

    phoneOn(new Browser());
    const other = new ViewPage(token);
    await other.tap();
    expect([other.page.screen, other.page.linkHeld, other.page.loaded, other.urls.length]).toEqual(["ViewOtherDevice", false, 0, 0]);
    expect(canTapToView(other.page)).toBe(false);

    phoneOn(mayaPhone);
    const again = new ViewPage(token);
    await again.tap();
    expect([again.page.screen, again.page.loaded]).toEqual(["ViewShowing", 1]);
  }, T);

  test("a report goes only after the confirm, the server closes the offer, and the link then shows the no-longer-available step", async () => {
    const { offerId, token, receiverMemberId, senderMemberId } = await readyOffer("report");
    const mayaPhone = new Browser();
    phoneOn(mayaPhone);
    const p = new ViewPage(token);
    await p.tap();
    const before = sent.length;
    expect(p.askToReport()).toBe(true);
    expect([p.page.screen, viewPhotosHeld(p.page), sent.length]).toEqual(["ViewConfirmReport", true, before]);
    await p.report();
    expect([p.page.screen, p.page.linkHeld, p.urls.length]).toEqual(["ViewReported", false, 0]);
    expect(sent.slice(before).map(r => [r.url, JSON.parse(r.body).answer])).toEqual([["/api/photos/page/answer", "report"]]);
    expect(await phaseOf(offerId)).toBe("reported");
    const reports = await st.svc.runtimeFor("slop")!.readState(net => net.safetyReports());
    expect(reports.filter(report => report.reporterId === receiverMemberId)).toEqual([
      expect.objectContaining({ subjectId: senderMemberId, kind: "harassment", status: "open" }),
    ]);

    const later = new ViewPage(token);
    await later.tap();
    expect([later.page.screen, later.page.opened, later.page.reportLost]).toEqual(["ViewGone", false, false]);
  }, T);

  test("no clock closes the link: the bound phone opens it after 2 days and after 30 days, until the sender takes it back", async () => {
    const { ari, offerId, token } = await readyOffer("noclock");
    const mayaPhone = new Browser();
    phoneOn(mayaPhone);
    const first = new ViewPage(token);
    await first.tap();
    expect(first.page.screen).toBe("ViewShowing");
    for (const wait of [2 * DAY, 28 * DAY]) {
      st.clock.advance(wait);
      await st.svc.tick();
      const later = new ViewPage(token);
      await later.tap();
      expect([later.page.screen, later.page.count, later.page.loaded]).toEqual(["ViewShowing", 1, 1]);
      expect(await phaseOf(offerId)).toBe("ready");
    }
    expect((await turn(ari, "take back photo 1")).outcome).toBe("handled");
    expect(await phaseOf(offerId)).toBe("revoked");
    const takenBack = new ViewPage(token);
    await takenBack.tap();
    expect([takenBack.page.screen, takenBack.page.reportLost]).toEqual(["ViewGone", false]);
  }, T);

  test("a photo the sender took back and an offer that ended give the same answer and the same step", async () => {
    const withdrawn = await readyOffer("withdrawn");
    expect((await turn(withdrawn.ari, "take back photo 1")).outcome).toBe("handled");
    expect(await phaseOf(withdrawn.offerId)).toBe("revoked");
    phoneOn(new Browser());
    const fromWithdrawn = await openPhotoView(withdrawn.token);
    const takenBack = new ViewPage(withdrawn.token);
    await takenBack.tap();

    const stopped = await readyOffer("stopped");
    const mayaPhone = new Browser();
    phoneOn(mayaPhone);
    const seen = new ViewPage(stopped.token);
    await seen.tap();
    expect(seen.page.screen).toBe("ViewShowing");
    expect((await turn(stopped.ari, "STOP")).outcome).toBe("handled");
    const fromEnded = await openPhotoView(stopped.token);
    const ended = new ViewPage(stopped.token);
    await ended.tap();

    expect(fromWithdrawn).toEqual(fromEnded);
    expect(fromEnded).toEqual({ answer: { kind: "OpenGone", count: 0 }, fromFirstName: "" });
    expect([takenBack.page.screen, ended.page.screen]).toEqual(["ViewGone", "ViewGone"]);
    expect(takenBack.page).toEqual(ended.page);
  }, T);

  test("a link that PHOTO LINK replaced shows the replaced step, and the new link opens on a new phone", async () => {
    const { maya, receiverMemberId, token } = await readyOffer("renew");
    const renewal = await turn(maya, "PHOTO LINK");
    expect(renewal.outcome).toBe("handled");
    phoneOn(new Browser());
    const old = new ViewPage(token);
    await old.tap();
    expect([old.page.screen, old.page.linkHeld]).toEqual(["ViewReplaced", false]);
    const sentToMaya = await sql`select body from network.messages where app_id = 'slop' and member_id = ${receiverMemberId}`;
    const fresh = [renewal.reply, ...sentToMaya.map((m: Record<string, unknown>) => String(m.body))]
      .map(body => /new private link[^:]*: \S*\/photos\/view#([A-Za-z0-9_-]{43})/.exec(body)?.[1]).find(found => found !== undefined);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(token);
    const next = new ViewPage(fresh!);
    await next.tap();
    expect(next.page.screen).toBe("ViewShowing");
  }, T);

  test("a report that arrives after the sender took the photo back shows that the report did not go", async () => {
    const { ari, offerId, token } = await readyOffer("lost");
    phoneOn(new Browser());
    const p = new ViewPage(token);
    await p.tap();
    expect(p.askToReport()).toBe(true);
    expect((await turn(ari, "take back photo 1")).outcome).toBe("handled");
    expect(await phaseOf(offerId)).toBe("revoked");
    await p.report();
    expect([p.page.screen, p.page.reportLost, p.page.linkHeld, p.urls.length]).toEqual(["ViewGone", true, false, 0]);
  }, T);

  // spec/photosViewPage.md, "A report needs a confirm, goes once, and only the server's answer says it is done"
  test("closing a photo without a filed safety report cannot confirm the report", async () => {
    const { offerId, token, receiverMemberId } = await readyOffer("unfiled-report");
    phoneOn(new Browser());
    const p = new ViewPage(token);
    await p.tap();
    expect(p.askToReport()).toBe(true);

    await sql`update network.members set account_status = 'removed' where app_id = 'slop' and id = ${receiverMemberId}`;
    expect(await st.svc.runtimeOfMember("slop", receiverMemberId)).toBeUndefined();
    expect(await phaseOf(offerId)).toBe("ready");
    await p.report();

    const reports = await st.svc.runtimeFor("slop")!.readState(net => net.safetyReports());
    expect(reports.some(report => report.reporterId === receiverMemberId)).toBe(false);
    expect(await phaseOf(offerId)).toBe("reported");
    expect([p.page.screen, p.page.reportLost, p.page.linkHeld, p.urls.length]).toEqual(["ViewGone", true, false, 0]);
  }, T);

  test("a malformed token shows the no-longer-available step and sends nothing", async () => {
    phoneOn(new Browser());
    const p = new ViewPage("not-a-view-token");
    expect([p.page.screen, p.page.linkHeld]).toEqual(["ViewGone", false]);
    await p.tap();
    expect(sent).toHaveLength(0);
  }, T);
});
