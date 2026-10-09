// The relay block: the engine's relay policy (packages/engine/src/relay.ts) and the photo in the
// probe (packs/slop/plan.ts probePhotoRefs, copy.ts slopProbeMessage), critical path item 7.
//   corpus     evals/relay/: hand-written honest messages, scams, harassment, contact attempts and
//              rating probes (relay.jsonl, relay-paraphrases.jsonl, relay-heldout-1.jsonl: blocking;
//              relay-heldout-2.jsonl: tracked, never tuned on), member requests (requests.jsonl),
//              and the Network's benign adult phrasing as a second false-hold check
//   scenarios  scripted items against the policy: minors, state, blocks, consent, photos, leaks,
//              rate limits, the log, the LLM hook, and the photo-in-probe rule
// The relay inside the slop world (adversary personas exchanging items after the reveal) is gated in
// the slop block (scripts/sim/slop.ts, "relay world" gates), on the pinned seeds.
import { findLeaks } from "../../packages/core/src/index.ts";
import { appearanceLeak } from "../../packages/engine/src/packs/slop/appearance.ts";
import { SLOP_PROBE_PHOTO_LINE, slopProbeMessage, slopProbeText } from "../../packages/engine/src/packs/slop/copy.ts";
import { probePhotoRefs } from "../../packages/engine/src/packs/slop/plan.ts";
import { parseRelayRequest, pastContacts, relayGuard, relayItem, relayItemAsync, relayItemFromRequest, RELAY_WORDING, threadMessage, type RelayContext, type RelayItem, type RelayRecord } from "../../packages/engine/src/relay.ts";
import { Block, expect } from "./gate.ts";

const ROOT = `${import.meta.dir}/../../evals`;
const jsonl = async <T>(name: string): Promise<T[]> => (await Bun.file(`${ROOT}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const NOW = Date.UTC(2026, 9, 9, 18);
/** A mutual opportunity between Sam (a) and Riley (b), both adults, nothing held or blocked. */
export function baseCtx(over: Partial<RelayContext> = {}): RelayContext {
  return {
    now: NOW,
    opportunity: { id: "op1", app: "slop", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
    sender: { id: "a", firstName: "Sam", age: 29, photoIds: ["ph_abcdefgh"], photoConsent: true },
    recipient: { id: "b", firstName: "Riley", age: 31, photoIds: ["ph_ijklmnop"], photoConsent: true },
    blocked: false, history: [], ...over,
  };
}
const text = (t: string, id = "i1", at = NOW): RelayItem => ({ id, kind: "text", from: "a", to: "b", at, text: t });
const share = (over: Partial<RelayItem> = {}): RelayItem => ({ id: "c1", kind: "contact_share", from: "a", to: "b", at: NOW, contact: { kind: "phone", value: "+1 (212) 555-0147" }, consent: { kind: "contact_share", by: "a", itemId: "c1", at: NOW - 60_000 }, ...over });
const photo = (over: Partial<RelayItem> = {}): RelayItem => ({ id: "p1", kind: "photo", from: "a", to: "b", at: NOW, photoIds: ["ph_abcdefgh"], consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 30_000, photoIds: ["ph_abcdefgh"] }, ...over });

export async function relayBlock(b: Block): Promise<void> {
  // ---- corpus ---------------------------------------------------------------------------------------
  type Row = { text: string; class: "honest" | "scam" | "harassment" | "contact" | "rating"; want: "pass" | "stop" };
  // relay.jsonl, relay-paraphrases.jsonl and relay-heldout-1.jsonl were used to tune the rules: their gates block.
  // relay-heldout-2.jsonl was written after the tuning and scored once: its gates are tracked (the rules'
  // expected recall on new wording; do not tune on it, write a new held-out file instead).
  for (const file of ["relay/relay.jsonl", "relay/relay-paraphrases.jsonl", "relay/relay-heldout-1.jsonl", "relay/relay-heldout-2.jsonl"]) {
    const rows = await jsonl<Row>(file);
    const blocking = !file.includes("heldout-2");
    const stopped = (t: string) => relayItem(text(t), baseCtx()).decision !== "pass";
    const by = (c: Row["class"]) => rows.filter(r => r.class === c);
    const recall = (c: Row["class"]) => { const xs = by(c); return { r: xs.filter(x => stopped(x.text)).length / Math.max(1, xs.length), n: xs.length, miss: xs.filter(x => !stopped(x.text)).map(x => x.text) }; };
    for (const [c, target] of [["scam", 0.9], ["harassment", 0.9], ["contact", 0.95], ["rating", 0.95]] as const) {
      const x = recall(c);
      b.gate(`relay corpus ${file}: ${c} held or blocked >= ${target * 100}% (n ${x.n})`, x.n >= 10 && x.r >= target, `${pct(x.r)}${x.miss.length ? `; missed: ${x.miss.slice(0, 3).join(" | ")}` : ""}`, blocking);
    }
    const honest = by("honest"), held = honest.filter(x => stopped(x.text)).map(x => x.text);
    b.gate(`relay corpus ${file}: honest messages held <= 5% (n ${honest.length})`, honest.length >= 25 && held.length / honest.length <= 0.05, `${pct(held.length / honest.length)}${held.length ? `; held: ${held.slice(0, 3).join(" | ")}` : ""}`, blocking);
  }
  const benign = (await Bun.file(`${ROOT}/network/benign-adult.txt`).text()).trim().split("\n");
  const benignHeld = benign.filter(t => relayItem(text(t), baseCtx()).decision !== "pass");
  b.gate(`relay corpus network/benign-adult.txt: held <= 2% (n ${benign.length})`, benignHeld.length / benign.length <= 0.02, `${pct(benignHeld.length / benign.length)}${benignHeld.length ? `; ${benignHeld.slice(0, 3).join(" | ")}` : ""}`);

  const reqs = await jsonl<{ text: string; want: "contact_share" | "photo" | "text" | "none" }>("relay/requests.jsonl");
  const reqMiss = reqs.filter(r => parseRelayRequest(r.text).kind !== r.want).map(r => `${JSON.stringify(r.text)} -> ${parseRelayRequest(r.text).kind} (want ${r.want})`);
  const falseConsent = reqs.filter(r => r.want !== "contact_share" && r.want !== "photo" && ["contact_share", "photo"].includes(parseRelayRequest(r.text).kind));
  b.gate(`relay requests (n ${reqs.length}): every row read as labelled`, reqs.length >= 30 && reqMiss.length === 0, reqMiss.slice(0, 5).join("; "));
  b.gate("relay requests: 0 hedged, negated or question requests read as a contact share or photo send", falseConsent.length === 0, falseConsent.map(r => r.text).join(" | "));

  // ---- scenarios ------------------------------------------------------------------------------------
  await b.run("relay: never to or from a minor or an unknown age; a minor's self-disclosure blocks and flags the age", () => {
    for (const age of [13, 16, 17, undefined, Number.NaN, -1, 400]) {
      for (const side of ["sender", "recipient"] as const) {
        const ctx = baseCtx();
        ctx[side] = { ...ctx[side], age };
        for (const it of [text("see you at 7!"), share(), photo()]) { const r = relayItem(it, ctx); expect([age, side, r.decision]).toEqual([age, side, "block"]); expect(r.rendered).toBe(""); expect(r.reasons).toContain("minor:party"); }
      }
    }
    for (const t of ["lol I'm 16 tho", "im 17 years old", "I'm still in high school", "not 18 yet but soon"]) {
      const r = relayItem(text(t), baseCtx());
      expect([t, r.decision, r.record.ageSignal]).toEqual([t, "block", true]);
    }
    for (const t of ["I'm 15 minutes away", "I'm 29", "we met when I was in high school"]) expect([t, relayItem(text(t), baseCtx()).decision]).toEqual([t, "pass"]);
  });

  await b.run("relay: only inside a mutual match between its two participants; blocks, opt-outs and holds win", () => {
    const op = baseCtx().opportunity;
    for (const status of ["probing", "closed", "cancelled", "expired"] as const) expect(relayItem(text("hi"), baseCtx({ opportunity: { ...op, status } })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ opportunity: { ...op, acceptedBy: ["a"] } })).decision).toBe("block");
    expect(relayItem({ ...text("hi"), to: "c" }, baseCtx()).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ blocked: true })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ recipient: { ...baseCtx().recipient, optedOut: true } })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ sender: { ...baseCtx().sender, held: true } })).decision).toBe("hold");
    expect(relayItem(text("hi"), baseCtx({ recipient: { ...baseCtx().recipient, held: true } })).decision).toBe("hold");
    const ok = relayItem(text("hi, see you at 7"), baseCtx());
    expect(ok).toMatchObject({ decision: "pass", rendered: 'Sam says: "hi, see you at 7"' });
  });

  await b.run("relay: a contact share needs the sender's explicit, fresh consent for that item; one per match; never from free text", () => {
    const ok = relayItem(share(), baseCtx());
    expect(ok.decision).toBe("pass");
    expect(ok.rendered).toContain("+12125550147");
    expect(ok.record.contactShared).toBe(true);
    const bad: [string, RelayItem][] = [
      ["no consent", share({ consent: undefined })],
      ["consent by the other member", share({ consent: { kind: "contact_share", by: "b", itemId: "c1", at: NOW - 1000 } })],
      ["consent for another item", share({ consent: { kind: "contact_share", by: "a", itemId: "c0", at: NOW - 1000 } })],
      ["stale consent", share({ consent: { kind: "contact_share", by: "a", itemId: "c1", at: NOW - 16 * 60_000 } })],
      ["consent after the item", share({ consent: { kind: "contact_share", by: "a", itemId: "c1", at: NOW + 1000 } })],
      ["photo consent", share({ consent: { kind: "photo", by: "a", itemId: "c1", at: NOW - 1000 } })],
      ["invalid number", share({ contact: { kind: "phone", value: "call me" } })],
      ["free text inside", share({ text: "and my insta is sam_r" })],
    ];
    for (const [why, it] of bad) { const r = relayItem(it, baseCtx()); expect([why, r.decision, r.rendered]).toEqual([why, "block", ""]); }
    const again = relayItem(share({ id: "c2", consent: { kind: "contact_share", by: "a", itemId: "c2", at: NOW } }), baseCtx({ history: [ok.record] }));
    expect(again.reasons).toContain("contact_share:already_shared");
    for (const t of ["text me 212 555 0147", "my number is two one two five five five zero one four seven", "sam dot r at gmail dot com", "ig: sam_r_92", "212 555", "0147"]) {
      const r = relayItem(text(t), baseCtx({ recentTexts: t === "0147" ? ["212 555"] : [] }));
      if (t === "212 555") continue; // a fragment alone is not a number; the thread check catches the pair
      expect([t, r.decision]).toEqual([t, "hold"]);
      expect(r.senderNotice).toContain("send them my number");
    }
  });

  await b.run("relay: a photo needs the explicit send, the sender's photo consent and their own opaque photo ids", () => {
    const ok = relayItem(photo(), baseCtx());
    expect(ok).toMatchObject({ decision: "pass", photos: ["ph_abcdefgh"], rendered: "Sam sent you a photo." });
    const cases: [string, RelayItem, Partial<RelayContext>?][] = [
      ["no consent", photo({ consent: undefined })],
      ["consent names another photo", photo({ consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 1000, photoIds: ["ph_zzzzzzzz"] } })],
      ["not the sender's photo", photo({ photoIds: ["ph_ijklmnop"], consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 1000, photoIds: ["ph_ijklmnop"] } })],
      ["a URL", photo({ photoIds: ["https://x.test/a.jpg"], consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 1000, photoIds: ["https://x.test/a.jpg"] } })],
      ["an id with a phone number", photo({ photoIds: ["sam_2125550147"], consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 1000, photoIds: ["sam_2125550147"] } })],
      ["no photo consent on file", photo(), { sender: { ...baseCtx().sender, photoConsent: false } }],
      ["a caption with a handle", photo({ text: "follow me @sam_r" })],
    ];
    for (const [why, it, over] of cases) { const r = relayItem(it, baseCtx(over ?? {})); expect([why, r.decision === "pass", r.photos.length]).toEqual([why, false, 0]); }
  });

  await b.run("relay: private facts, canaries, ratings and scores never pass; the sender's own words about themselves do", () => {
    const guard = relayGuard({ facts: [{ text: "is going through a divorce", owner: "b" }, { text: "has two kids from a previous marriage", owner: "a" }], canaries: ["QX-4821-ORCHID"] });
    const ctx = baseCtx({ guard });
    expect(relayItem(text("heard you're going through a divorce?"), ctx).decision).toBe("hold");
    expect(relayItem(text("ref QX-4821-ORCHID"), ctx).decision).toBe("block");
    expect(relayItem(text("full disclosure, I have two kids from a previous marriage"), ctx).decision).toBe("pass");
    for (const t of ["how hot did the app rate me?", "what's my score", "appearance:face=1.20", "are we the same level of attractiveness", "you're a 10/10"]) {
      const r = relayItem(text(t), ctx);
      expect([t, r.decision, r.rendered]).toEqual([t, "hold", ""]);
    }
    // The agent's own wording never carries appearance or rating words.
    for (const w of [RELAY_WORDING.text("Sam", "x"), RELAY_WORDING.photo("Sam"), RELAY_WORDING.contact("Sam", "phone", "+12125550147")]) expect(appearanceLeak(w)).toBeNull();
  });

  await b.run("relay: rate limits hold a burst; the log has no body, no contact value, no photo id; ban notices from the log", () => {
    const history: RelayRecord[] = [];
    let last = relayItem(text("hi"), baseCtx());
    for (let i = 0; i < 7; i++) { last = relayItem(text(`message number ${i}`, `t${i}`, NOW + i * 30_000), baseCtx({ history })); history.push(last.record); }
    expect(last.reasons).toContain("rate:burst");
    const records = [relayItem(text("dinner was lovely, see you soon"), baseCtx()), relayItem(share(), baseCtx()), relayItem(photo(), baseCtx()), relayItem(text("send me $200 on cash app"), baseCtx())];
    for (const r of records) {
      const s = JSON.stringify(r.record);
      for (const leak of ["lovely", "555", "0147", "ph_abcdefgh", "cash app", "200"]) expect(s).not.toContain(leak);
      for (const reason of r.record.reasons) expect(reason).toMatch(/^[a-z_]+:[a-z0-9_]+$/);
    }
    expect(threadMessage(records[3]!).rendered).toBeNull();
    expect(pastContacts(records.map(r => r.record), "a")).toEqual(["b"]);
  });

  await b.run("relay: the plugin path (parseRelayRequest -> relayItemFromRequest -> relayItem) delivers only explicit requests", () => {
    const at = NOW;
    const mk = (t: string, id: string) => relayItemFromRequest(parseRelayRequest(t), { id, from: "a", to: "b", at, contact: { kind: "phone", value: "+12125550147" }, photoIds: ["ph_abcdefgh"] });
    const num = mk("send them my number", "r1"), pic = mk("send her this photo", "r2"), msg = mk("tell them I'm running 10 min late", "r3");
    expect([num?.kind, pic?.kind, msg?.kind]).toEqual(["contact_share", "photo", "text"]);
    expect(relayItem(num!, baseCtx()).decision).toBe("pass");
    expect(relayItem(pic!, baseCtx()).decision).toBe("pass");
    expect(relayItem(msg!, baseCtx()).rendered).toBe('Sam says: "I\'m running 10 min late"');
    for (const t of ["should I send them my number?", "don't send my number yet", "how are you?"]) expect([t, mk(t, "r4")]).toEqual([t, null]);
    expect(relayItemFromRequest({ kind: "contact_share" }, { id: "r5", from: "a", to: "b", at })).toBeNull();
  });

  await b.run("relay: the LLM hook runs only on items the rules pass; a flag or an error holds", async () => {
    let calls = 0;
    const hook = async () => { calls++; return { flags: ["scam"] }; };
    expect((await relayItemAsync(text("see you at 7"), baseCtx(), { hook })).decision).toBe("hold");
    expect((await relayItemAsync(text("venmo me 50"), baseCtx(), { hook })).decision).toBe("hold");
    expect(calls).toBe(1);
    const boom = async () => { throw new Error("down"); };
    expect((await relayItemAsync(text("see you at 7"), baseCtx(), { hook: boom })).reasons).toContain("llm:error");
    expect((await relayItemAsync(text("see you at 7"), baseCtx(), { hook: boom, failOpen: true })).decision).toBe("pass");
  });

  await b.run("photo in the probe: adults on both sides, photo consent, an opaque id, at most one; name and contact stay hidden", async () => {
    const sub = { age: 30, photoConsent: true, photoIds: ["ph_abcdefgh", "ph_ijklmnop"] };
    expect(probePhotoRefs(sub, { age: 28 })).toEqual([{ id: "ph_abcdefgh" }]);
    for (const [why, s, r] of [
      ["minor subject", { ...sub, age: 17 }, { age: 28 }], ["unknown subject age", { ...sub, age: undefined }, { age: 28 }],
      ["minor recipient", sub, { age: 16 }], ["unknown recipient age", sub, { age: undefined }],
      ["no photo consent", { ...sub, photoConsent: false }, { age: 28 }], ["held", { ...sub, held: true }, { age: 28 }],
      ["URL only", { ...sub, photoIds: ["https://cdn.test/x.jpg"] }, { age: 28 }],
    ] as const) expect([why, probePhotoRefs(s, r)]).toEqual([why, []]);
    const base = slopProbeText({ when: "Thursday 7pm or Saturday 2pm" }, "coffee", "climbing");
    const m = slopProbeMessage({ text: base }, probePhotoRefs(sub, { age: 28 }));
    expect(m.photos).toEqual(["ph_abcdefgh"]);
    expect(m.text).toContain(SLOP_PROBE_PHOTO_LINE);
    expect(m.text).toMatch(/only tell you who it is if you both say yes/);
    expect(m.text.indexOf(SLOP_PROBE_PHOTO_LINE)).toBeLessThan(m.text.indexOf("Want me to check"));
    expect(findLeaks(m.text)).toEqual([]);
    expect(appearanceLeak(m.text)).toBeNull();
    expect(slopProbeMessage({ text: base }, [])).toEqual({ text: base, photos: [] });
    const copy = await Bun.file(`${import.meta.dir}/../../packages/engine/src/packs/slop/copy.ts`).text();
    expect(copy).not.toMatch(/no photo/i);
  });
}
