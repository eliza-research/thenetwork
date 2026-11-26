// spec/photosCheckPage.md, "The page sends only the proposal that the person saw, and only when the person taps "Send""
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import {
  canAnswerCheck,
  canAnswerOpen,
  enabled,
  type Event,
  initial,
  type PhotoCheck,
  step,
} from "../../packages/core/src/generated/photosCheckPage.ts";
import type { NetworkState } from "../../packages/network/src/network.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import { photoTokenWellFormed } from "../../packages/ui/src/api/photoUpload.ts";
import { answerPhotoCheck, type CheckProposal, loadCheckPhoto, openPhotoCheck } from "../../packages/ui/src/api/photosCheck.ts";
import { Browser, newPhone, pgAvailable, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const DAY = 86_400_000;
const MINUTE = 60_000;

describe.skipIf(!pgAvailable)("photo check page (the /photos/check shell and machine against the site router and the backend)", () => {
  let st: Stack, sql: SQL;
  const realFetch = globalThis.fetch;
  let calls = 0;
  beforeAll(async () => { st = await startStack(); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterEach(() => { globalThis.fetch = realFetch; });
  afterAll(async () => { globalThis.fetch = realFetch; await sql?.close(); await st?.close(); });

  const browserOn = (origin: string, browser: Browser) => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/")) return realFetch(input, init);
      calls++;
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      headers.set("sec-fetch-site", "same-origin");
      const cookie = browser.header();
      if (cookie) headers.set("cookie", cookie);
      const res = await realFetch(`${origin}${input}`, { ...init, headers });
      browser.take(res);
      return res;
    }) as typeof fetch;
  };
  const phoneOn = (app: AppId, browser = new Browser()) => { browserOn(st.sites[app].origin, browser); return browser; };

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  const png = (tag: string) => {
    const pixels = new TextEncoder().encode(`PIXELS-${tag}`);
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };

  let seq = 0;
  const turn = async (phone: string, text: string) => {
    const messageId = `photo-check-page-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(MINUTE);
    const out = (await res.json()) as { outcome: string; replies?: string[] };
    return { ...out, reply: (out.replies ?? []).join(" ") };
  };
  const checkToken = (reply: string) => /\/photos\/check#([A-Za-z0-9_-]+)/.exec(reply)?.[1];
  const member = async (phone: string) => {
    const [row] = await sql`select p.person_id, m.member_id from platform.phone_identities p join platform.memberships m on m.person_id = p.person_id and m.app_id = 'slop' where p.e164 = ${phone}`;
    return { personId: row!.person_id as string, memberId: row!.member_id as string };
  };
  const offersOf = async (personId: string) =>
    (await sql`select phase, photo_ids from platform.photo_offers where sender_person_id = ${personId}::uuid order by created_at`) as unknown as { phase: string; photo_ids: string[] }[];
  const photoIdsOf = async (personId: string) =>
    ((await sql`select id from platform.photos where person_id = ${personId}::uuid and app_id = 'slop' and deleted_at is null order by created_at`) as unknown as { id: string }[]).map((r) => r.id);

  let pairSeq = 0;
  const pair = async (photoCount: number) => {
    const ari = newPhone(), maya = newPhone();
    const joined = await webJoin(st, "slop", ari, { age: 29, firstName: "Ari" });
    expect(joined.res.status).toBe(200);
    expect((await webJoin(st, "slop", maya, { age: 30, firstName: "Maya" })).res.status).toBe(200);
    const sender = await member(ari), receiver = await member(maya);
    const threadId = `e2e-photo-check-${++pairSeq}`;
    await st.svc.runtimeFor("slop")!.unitOfWork(n => {
      const s = n.exportState(), now = st.clock.now(), ids = [sender.memberId, receiver.memberId];
      s.opps = s.opps.filter(op => op.id !== threadId);
      s.opps.push({ id: threadId, origin: "engine", kind: "intro", category: "romance", objective: "drinks", detail: "drinks", participants: ids, alternates: [], primed: [], status: ids.map(id => [id, "yes"]), explanations: {}, stage: "scheduled", deadline: now + 30 * DAY, createdAt: now, score: .8, generator: "fixture", components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 }, exploration: false, review: { queuedAt: now, deadline: now + 30 * DAY, decision: "approve", reviewer: "fixture" }, sameDay: false, contacted: ids, reminded: [], feedbackFrom: [], tags: [], replacements: 0 } as NetworkState["opps"][number]);
      n.importState(s);
    });
    for (let i = 1; i <= photoCount; i++) {
      expect((await st.svc.photos.upload(sender.personId, "slop", png(`check-${pairSeq}-${i}`), PHOTO_CONSENT.version)).ok).toBe(true);
      st.clock.advance(MINUTE);
    }
    return { ari, maya, sender, receiver, senderBrowser: joined.b };
  };

  class CheckPage {
    page: PhotoCheck = initial;
    proposal: CheckProposal | undefined;
    proposed: number[] = [];
    marked: number[] = [];
    text = "";
    loaded: number[] = [];
    private token = "";
    private revision = 0;
    private send(event: Event): boolean {
      if (!enabled(this.page, event)) return false;
      this.page = step(this.page, event);
      return true;
    }
    async open(fragment: string) {
      if (!this.send({ type: "readCheckLink", tokenWellFormed: photoTokenWellFormed(fragment) }) || !canAnswerOpen(this.page)) return;
      this.token = fragment;
      await this.load();
    }
    async retry() {
      if (this.send({ type: "retryOpen" }) && canAnswerOpen(this.page)) await this.load();
    }
    private async load() {
      const { opened, proposal } = await openPhotoCheck(this.token);
      this.send({ type: "answerOpen", opened });
      if (this.page.screen === "ProposalShown" || this.page.screen === "ProposalPicking") {
        this.proposal = proposal;
        this.proposed = proposal!.proposed;
        this.revision = proposal!.revision;
        for (const { n } of proposal!.photos) if (((await loadCheckPhoto(this.token, n))?.size ?? 0) > 0) this.loaded.push(n);
        this.see();
      }
    }
    see() {
      this.send({ type: "seeProposal", loaded: this.proposed.length > 0 && this.proposed.every((n) => this.loaded.includes(n)) });
    }
    async tapSend() {
      if (!this.send({ type: "sendProposal" }) || !canAnswerCheck(this.page)) return false;
      await this.answer({ answer: "send" });
      return true;
    }
    notThis() {
      this.send({ type: "showOthers" });
      this.marked = [];
    }
    mark(n: number) {
      const next = this.marked.includes(n) ? this.marked.filter((m) => m !== n) : [...this.marked, n];
      if (this.send({ type: "pickPhotos", picked: next.length })) this.marked = next;
    }
    async choose() {
      if (!this.send({ type: "choosePicked" }) || !canAnswerCheck(this.page)) return false;
      await this.answer({ answer: "pick", numbers: this.marked });
      return true;
    }
    private async answer(request: { answer: "send" } | { answer: "pick"; numbers: number[] }) {
      const reply = await answerPhotoCheck(this.token, this.revision, request, this.proposal!.photos.map((p) => p.n));
      this.text = reply.text;
      this.send({ type: "answerCheck", answer: reply.answer });
      if (this.page.screen === "ProposalShown" && reply.answer.kind === "CheckProposed") {
        this.proposed = reply.proposed;
        if (reply.revision !== undefined) this.revision = reply.revision;
        this.see();
      }
    }
  }

  test("the link shows exactly the named photo, Send offers it once, and the same link then shows the closed step", async () => {
    const { ari, sender } = await pair(2);
    const proposal = await turn(ari, "send Maya my first photo");
    const token = checkToken(proposal.reply);
    expect(token).toBeDefined();

    phoneOn("slop");
    const p = new CheckPage();
    await p.open(token!);
    expect([p.page.screen, p.page.proposedCount, p.page.seen, p.proposed]).toEqual(["ProposalShown", 1, true, [1]]);
    expect(p.proposal!.toFirstName).toBe("Maya");
    expect(p.proposal!.notice).toContain("Maya");
    expect(p.proposal!.notice).not.toContain("{{recipient}}");
    expect(await offersOf(sender.personId)).toEqual([]);

    phoneOn("slop", new Browser());
    const elsewhere = new CheckPage();
    await elsewhere.open(token!);
    expect(elsewhere.page.screen).toBe("ProposalOtherDevice");
    expect(await elsewhere.tapSend()).toBe(false);
    expect(await offersOf(sender.personId)).toEqual([]);
  }, T);

  test("Send on the page is the consent: one offer of the photo that the page showed, and a reopened link is closed", async () => {
    const { ari, sender } = await pair(2);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    const phone = phoneOn("slop");
    const p = new CheckPage();
    await p.open(token);
    expect(await p.tapSend()).toBe(true);
    expect(p.page.screen).toBe("ProposalSent");
    expect(p.text).toContain("Maya");
    const offers = await offersOf(sender.personId);
    expect(offers.map((o) => o.phase)).toEqual(["asking"]);
    expect(offers[0]!.photo_ids).toEqual([(await photoIdsOf(sender.personId))[0]]);
    expect(await p.tapSend()).toBe(false);

    phoneOn("slop", phone);
    const again = new CheckPage();
    await again.open(token);
    expect(again.page.screen).toBe("ProposalClosed");
    expect(await again.tapSend()).toBe(false);
    expect((await offersOf(sender.personId)).length).toBe(1);
  }, T);

  test("Send stays off until every named photo loaded, so a photo that the page did not show is never sent", async () => {
    const { ari, sender } = await pair(1);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    phoneOn("slop");
    const p = new CheckPage();
    await p.open(token);
    p.loaded = [];
    p.see();
    expect(p.page.seen).toBe(false);
    expect(await p.tapSend()).toBe(false);
    expect(await offersOf(sender.personId)).toEqual([]);
  }, T);

  test("a removed Checkout photo cannot be replaced in the image, the draft or the offer", async () => {
    const { ari, sender, senderBrowser } = await pair(2);
    const [first, second] = await photoIdsOf(sender.personId);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    phoneOn("slop");
    const { proposal } = await openPhotoCheck(token);
    expect(proposal?.proposed).toEqual([1]);
    expect((await loadCheckPhoto(token, 1))?.size).toBeGreaterThan(0);

    const removed = await st.site("slop", "/api/photos/delete", { browser: senderBrowser, json: { id: first } });
    expect(removed.status).toBe(200);
    expect(await photoIdsOf(sender.personId)).toEqual([second]);

    const image = await loadCheckPhoto(token, 1);
    const pick = await answerPhotoCheck(token, proposal!.revision, { answer: "pick", numbers: [1] }, [1, 2]);
    const send = await answerPhotoCheck(token, proposal!.revision, { answer: "send" }, [1, 2]);
    expect(pick.answer.kind).toBe("CheckChanged");
    const [draft] = await sql`select revision, proposed_ids from platform.photo_relay_drafts where sender_person_id = ${sender.personId}`;
    expect(draft).toMatchObject({ revision: proposal!.revision, proposed_ids: [first] });
    expect(send.answer.kind).toBe("CheckChanged");
    expect(await offersOf(sender.personId)).toEqual([]);
    expect(image).toBeUndefined();
  }, T);

  test("Not this one: a pick asks for a new proposal, sends nothing, and only the next Send offers the picked photo", async () => {
    const { ari, sender } = await pair(3);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    phoneOn("slop");
    const p = new CheckPage();
    await p.open(token);
    p.notThis();
    expect(p.page.screen).toBe("ProposalPicking");
    expect(await p.choose()).toBe(false);
    expect(p.page.error).toBe("ProposalPickCount");
    for (const n of [1, 2, 3]) p.mark(n);
    expect(p.page.picked).toBe(3);
    p.mark(1);
    p.mark(2);
    expect(p.marked).toEqual([3]);
    expect(await p.choose()).toBe(true);
    expect([p.page.screen, p.proposed, p.page.seen]).toEqual(["ProposalShown", [3], true]);
    expect(await offersOf(sender.personId)).toEqual([]);
    expect(await p.tapSend()).toBe(true);
    expect(p.page.screen).toBe("ProposalSent");
    const offers = await offersOf(sender.personId);
    expect(offers[0]!.photo_ids).toEqual([(await photoIdsOf(sender.personId))[2]]);
  }, T);

  test("a correction by text makes the open page's proposal old: Send shows the changed step and offers nothing", async () => {
    const { ari, sender } = await pair(2);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    phoneOn("slop");
    const p = new CheckPage();
    await p.open(token);
    expect(p.page.seen).toBe(true);
    const corrected = await turn(ari, "no, the second one");
    expect(checkToken(corrected.reply)).toBeDefined();
    expect(checkToken(corrected.reply)).not.toBe(token);
    expect(await p.tapSend()).toBe(true);
    expect([p.page.screen, p.page.linkOpen]).toEqual(["ProposalChanged", false]);
    expect(await offersOf(sender.personId)).toEqual([]);
  }, T);

  test("after 15 minutes the open page and a new page both show the timed-out step and offer nothing", async () => {
    const { ari, sender } = await pair(1);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    const phone = phoneOn("slop");
    const p = new CheckPage();
    await p.open(token);
    st.clock.advance(16 * MINUTE);
    expect(await p.tapSend()).toBe(true);
    expect(p.page.screen).toBe("ProposalLapsed");
    phoneOn("slop", phone);
    const later = new CheckPage();
    await later.open(token);
    expect(later.page.screen).toBe("ProposalLapsed");
    expect(await offersOf(sender.personId)).toEqual([]);
  }, T);

  test("a malformed token sends no request; an unknown token and another site show the closed step", async () => {
    phoneOn("slop");
    calls = 0;
    const malformed = new CheckPage();
    await malformed.open("short");
    expect([malformed.page.screen, calls]).toEqual(["ProposalBadLink", 0]);

    const unknown = new CheckPage();
    await unknown.open("A".repeat(43));
    expect(unknown.page.screen).toBe("ProposalClosed");

    const { ari, sender } = await pair(1);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    phoneOn("ntwrk");
    const wrongSite = new CheckPage();
    await wrongSite.open(token);
    expect(wrongSite.page.screen).toBe("ProposalClosed");
    expect(await offersOf(sender.personId)).toEqual([]);
  }, T);

  test("a server that cannot be reached keeps the link, and Try again opens it", async () => {
    const { ari } = await pair(1);
    const token = checkToken((await turn(ari, "send Maya my first photo")).reply)!;
    browserOn("http://127.0.0.1:1", new Browser());
    const p = new CheckPage();
    await p.open(token);
    expect([p.page.screen, p.page.error, p.page.linkOpen]).toEqual(["ProposalOpenFailed", "ProposalUnreachable", true]);
    phoneOn("slop");
    await p.retry();
    expect([p.page.screen, p.page.seen]).toEqual(["ProposalShown", true]);
  }, T);

  test("a member under 18 gets no check link", async () => {
    const teen = newPhone();
    expect((await webJoin(st, "slop", teen, { age: 16 })).res.status).toBe(200);
    expect(checkToken((await turn(teen, "send Maya my first photo")).reply)).toBeUndefined();
  }, T);
});
