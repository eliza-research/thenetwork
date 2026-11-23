import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { PHOTO_CONSENT } from "../../packages/platform/src/photos.ts";
import type { NetworkState } from "../../packages/network/src/network.ts";
import { Browser, newPhone, pgAvailable, SAFETY_TOKEN, startStack, TURN_SECRET, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const DAY = 86_400_000;

describe.skipIf(!pgAvailable)("photo relay (sender names a photo, receiver says yes, automatic check, staff exception, bound-browser view)", () => {
  let st: Stack, sql: SQL;
  beforeAll(async () => { st = await startStack(); sql = new SQL({ url: st.url, max: 2 }); }, T);
  afterAll(async () => { await sql?.close(); await st?.close(); });

  const chunk = (type: string, data: Uint8Array) => { const o = new Uint8Array(12 + data.length); new DataView(o.buffer).setUint32(0, data.length); o.set(new TextEncoder().encode(type), 4); o.set(data, 8); return o; };
  const png = (tag: string) => {
    const pixels = new TextEncoder().encode(`PIXELS-${tag}`);
    const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", new Uint8Array(13)), chunk("IDAT", pixels), chunk("IEND", new Uint8Array(0))];
    const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o;
  };
  let seq = 0;
  const turn = async (phone: string, text: string) => {
    const messageId = `photo-relay-${++seq}`;
    const body: TurnRequest = { messageId, channel: "blooio", from: phone, to: null, text, transport: "imessage", receivedAt: st.clock.now(), app: "slop" };
    const raw = JSON.stringify(body);
    const res = await st.svc.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...await svcSign(TURN_SECRET, { method: "POST", path: TURN_PATH, id: messageId, body: raw, nowS: Math.floor(st.clock.now() / 1000) }) }, body: raw }));
    expect(res.status).toBe(200);
    st.clock.advance(60_000);
    const out = (await res.json()) as { outcome: string; replies?: string[] };
    return { ...out, reply: (out.replies ?? []).join(" ") };
  };
  const page = (path: "open" | "image" | "answer", json: unknown, browser: Browser) => st.site("slop", `/api/photos/page/${path}`, { browser, json });
  const member = async (phone: string) => {
    const [row] = await sql`select p.person_id, m.member_id from platform.phone_identities p join platform.memberships m on m.person_id = p.person_id and m.app_id = 'slop' where p.e164 = ${phone}`;
    return { personId: row!.person_id as string, memberId: row!.member_id as string };
  };

  test("a named photo is checked on its page, offered with YES, taken by the receiver, held for staff when the check cannot run, released, opened on one browser with no time limit and reported", async () => {
    const ari = newPhone(), maya = newPhone();
    expect((await webJoin(st, "slop", ari, { age: 29, firstName: "Ari" })).res.status).toBe(200);
    expect((await webJoin(st, "slop", maya, { age: 30, firstName: "Maya" })).res.status).toBe(200);
    const sender = await member(ari), receiver = await member(maya);
    const threadId = "e2e-photo-pair";
    await st.svc.runtimeFor("slop")!.unitOfWork(n => {
      const s = n.exportState(), now = st.clock.now(), ids = [sender.memberId, receiver.memberId];
      s.opps = s.opps.filter(op => op.id !== threadId);
      s.opps.push({ id: threadId, origin: "engine", kind: "intro", category: "romance", objective: "drinks", detail: "drinks", participants: ids, alternates: [], primed: [], status: ids.map(id => [id, "yes"]), explanations: {}, stage: "scheduled", deadline: now + 30 * DAY, createdAt: now, score: .8, generator: "fixture", components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 }, exploration: false, review: { queuedAt: now, deadline: now + 30 * DAY, decision: "approve", reviewer: "fixture" }, sameDay: false, contacted: ids, reminded: [], feedbackFrom: [], tags: [], replacements: 0 } as NetworkState["opps"][number]);
      n.importState(s);
    });
    const uploaded = await st.svc.photos.upload(sender.personId, "slop", png("ari-first"), PHOTO_CONSENT.version);
    expect(uploaded.ok).toBe(true);

    const proposed = await turn(ari, "send Maya my first photo");
    expect(proposed.outcome).toBe("handled");
    expect(proposed.reply).toContain("Send Maya photo 1");
    const checkToken = /\/photos\/check#([A-Za-z0-9_-]{43})/.exec(proposed.reply)?.[1];
    expect(checkToken).toBeDefined();
    const senderPhone = new Browser();
    const check = await page("open", { token: checkToken }, senderPhone);
    expect(check.status, await check.clone().text()).toBe(200);
    expect(check.headers.get("cache-control")).toContain("no-store");
    expect(check.headers.get("referrer-policy")).toBe("no-referrer");
    const checked = await check.json() as { purpose: string; toFirstName: string; photos: { n: number }[]; proposed: number[] };
    expect(checked).toMatchObject({ purpose: "check", toFirstName: "Maya", proposed: [1] });
    expect(checked.photos.map(p => p.n)).toEqual([1]);
    expect(JSON.stringify(checked)).not.toMatch(/ph_|http|sha256/);
    const own = await page("image", { token: checkToken, n: 1 }, senderPhone);
    expect([own.status, own.headers.get("content-type")]).toEqual([200, "image/png"]);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect((await own.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await page("open", { token: checkToken }, new Browser())).status).toBe(403);

    expect((await turn(ari, "YES")).reply).toBe("Okay. I'll ask Maya if they want it. An automatic check screens it first. I'll tell you if it doesn't go.");
    const [offer] = await sql`select id, phase from platform.photo_offers where sender_person_id = ${sender.personId}::uuid`;
    expect(offer!.phase).toBe("asking");
    expect((await turn(maya, "yes")).reply).toBe("Okay. I'll text you a private link after the check.");
    const states = async () => (await sql`select id, state, screen_attempts from platform.photo_relay_items where offer_id = ${offer!.id}`)
      .map((r: Record<string, unknown>) => [r.state, r.screen_attempts]);
    expect(await states()).toEqual([["screening", 1]]);
    for (const wait of [60_000, 300_000, 900_000, 3_600_000]) {
      expect((await sql`select phase from platform.photo_offers where id = ${offer!.id}`)[0]!.phase).toBe("reviewing");
      st.clock.advance(wait);
      await st.svc.tick();
    }
    expect(await states()).toEqual([["pending", 5]]);
    const pending = await sql`select id, state from platform.photo_relay_items where offer_id = ${offer!.id}`;
    const itemId = pending[0]!.id as string;
    const preview = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${itemId}/photo?app=slop`, { headers: { authorization: `Bearer ${SAFETY_TOKEN}` } }));
    expect([preview.status, preview.headers.get("content-type"), preview.headers.get("cache-control")]).toEqual([200, "image/png", "no-store"]);
    await preview.arrayBuffer();
    const reviewToken = preview.headers.get("x-network-photo-review-token");
    expect(reviewToken).toMatch(/^\d+\.[a-f0-9]{64}$/);
    const release = await st.svc.fetch(new Request(`http://127.0.0.1/relay/${itemId}/release?app=slop`, { method: "POST",
      headers: { authorization: `Bearer ${SAFETY_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ note: "Photo checked for consent and safety", photoReviewToken: reviewToken }) }));
    expect(release.status, await release.clone().text()).toBe(200);
    expect((await sql`select state from platform.photo_relay_items where id = ${itemId}`)[0]!.state).toBe("approved");
    expect((await sql`select phase from platform.photo_offers where id = ${offer!.id}`)[0]!.phase).toBe("ready");
    const [ready] = await sql`select body from network.messages where app_id = 'slop' and member_id = ${receiver.memberId} and id = ${`photo-ready:${offer!.id}`}`;
    const viewToken = /\/photos\/view#([A-Za-z0-9_-]{43})/.exec(String(ready?.body))?.[1];
    expect(viewToken).toBeDefined();

    const receiverPhone = new Browser();
    const view = await page("open", { token: viewToken }, receiverPhone);
    expect(view.status, await view.clone().text()).toBe(200);
    expect(await view.json()).toMatchObject({ purpose: "view", fromFirstName: "Ari", count: 1 });
    const seen = await page("image", { token: viewToken, n: 1 }, receiverPhone);
    expect([seen.status, seen.headers.get("content-type"), seen.headers.get("content-security-policy")]).toEqual([200, "image/png", "default-src 'none'"]);
    expect((await sql`select phase from platform.photo_offers where id = ${offer!.id}`)[0]!.phase).toBe("ready");
    const otherPhone = await page("open", { token: viewToken }, new Browser());
    expect([otherPhone.status, ((await otherPhone.json()) as { error: string }).error]).toEqual([403, "other_device"]);
    st.clock.advance(2 * DAY);
    await st.svc.tick();
    const later = await page("open", { token: viewToken }, receiverPhone);
    expect(later.status, await later.clone().text()).toBe(200);
    expect(await later.json()).toMatchObject({ purpose: "view", count: 1 });
    expect((await page("image", { token: viewToken, n: 1 }, receiverPhone)).status).toBe(200);

    const heardOf = async () => { const m = (await st.svc.runtimeFor("slop")!.readState(n => n.exportState())).members.find(x => x.id === receiver.memberId)!; return { lastInbound: m.lastInbound, msgsIn: m.msgsIn, replies: m.replies, unsolStreak: m.unsolStreak, outbound: m.outbound }; };
    const heardBefore = await heardOf();
    const reported = await page("answer", { token: viewToken, answer: "report" }, receiverPhone);
    expect(reported.status).toBe(200);
    expect(await reported.json()).toEqual({ ok: true, state: "reported" });
    expect((await sql`select phase from platform.photo_offers where id = ${offer!.id}`)[0]!.phase).toBe("reported");
    expect((await page("image", { token: viewToken, n: 1 }, receiverPhone)).status).toBe(410);
    const rt = st.svc.runtimeFor("slop")!;
    expect((await rt.readState(n => n.relayLiveMatches(sender.memberId as never))).map(l => l.match.id)).not.toContain(threadId);
    const state = await rt.readState(n => n.exportState());
    expect(state.reports?.some(r => r.kind === "harassment" && r.reporterId === receiver.memberId && r.subjectId === sender.memberId && r.opportunityId === threadId)).toBe(true);
    const [told] = await sql`select body from network.messages where app_id = 'slop' and member_id = ${receiver.memberId} and id = ${`photo-report:${offer!.id}`}`;
    expect(told?.body).toBe("Thanks for telling me. I closed the photo, and the safety team will look at it.");
    expect(await heardOf()).toEqual({ ...heardBefore, outbound: (heardBefore.outbound ?? 0) + 1 });
  }, T);
});
