// The relay block: the engine's relay policy (packages/engine/src/relay.ts) and the photo in the
// probe (packs/slop/plan.ts probePhotoRefs, copy.ts slopProbeMessage), critical path item 7.
//   corpus     evals/relay/: hand-written honest messages, scams, harassment, contact attempts and
//              rating probes (relay.jsonl, relay-paraphrases.jsonl, relay-heldout-1.jsonl: blocking;
//              relay-heldout-2.jsonl: tracked, never tuned on), member requests (requests.jsonl),
//              and the Network's benign adult phrasing as a second false-hold check
//   scenarios  scripted items against the policy: minors, state, blocks, consent, photos, leaks,
//              rate limits, the log, the LLM hook, and the photo-in-probe rule
//   clef       the Clef relay classifier (engine relayClef.ts) against a fake Workers AI fetch: the
//              hook contract (raise only, never lower), clef-flash default, timeouts and failures fall
//              back to the rules (high-risk cues held), no body in events or records; and the
//              rules + Clef arm scored from RECORDED answers (evals/relay/clef-answers.jsonl) when that
//              cache exists. No Clef call is ever made here; without the cache the arm is skipped
//              and tracked. The rules-only gates above are unchanged.
//   adversarial the relay and photo adversarial scenarios inside the slop world (packages/sim/src/apps/
//              slop/adversarial.ts; #11 sims-and-e2e) on seeds 13-16: a scam after the reveal, a number
//              swap before both yeses, a leak of the other member's details, a minor in the relay, and
//              the photo in the probe with the flag off, no consent, a minor or a held member; then
//              the same cases on the live path (the slop probe hook with SLOP_PROBE_PHOTOS, the desk).
// The relay inside the slop world (adversary personas exchanging items after the reveal) is gated in
// the slop block (scripts/sim/slop.ts, "relay world" gates), on the pinned seeds.
import { findLeaks } from "../../packages/core/src/index.ts";
import { appearanceLeak } from "../../packages/engine/src/packs/slop/appearance.ts";
import { SLOP_PROBE_PHOTO_LINE, slopProbeMessage, slopProbeText } from "../../packages/engine/src/packs/slop/copy.ts";
import { probePhotoRefs } from "../../packages/engine/src/packs/slop/plan.ts";
import { parseRelayRequest, pastContacts, relayGuard, relayItem, relayItemAsync, relayItemFromRequest, RELAY_WORDING, threadMessage, type RelayContext, type RelayItem, type RelayRecord } from "../../packages/engine/src/relay.ts";
import { clefRelayClassifier, DEFAULT_RELAY_CLEF_WEIGHTS, directRelayClefWeights, loadRelayClefWeights, RELAY_CLEF_QUESTIONS, type RelayClefEvent } from "../../packages/engine/src/relayClef.ts";
import { scoreArm, type ArmRow, reasonCategories } from "../../packages/engine/src/relayClefFit.ts";
import type { ClefFetch } from "../../packages/engine/src/packs/slop/clef.ts";
import { cacheLookup, CLEF_CACHE, CLEF_WEIGHTS, HELDOUT_FILE, loadClefCache, loadCorpus, TUNING_FILES } from "../relay-clef-lib.ts";
import { RelayDesk, type RelayHost, type RelayMatch, type RelayMember } from "../../packages/network/src/relay.ts";
import { newPhotoId } from "../../packages/platform/src/photos.ts";
import { isOpaquePhotoId } from "../../packages/engine/src/relay.ts";
import { slopRelayAdversarial, type AdversarialResult } from "../../packages/sim/src/apps/slop/adversarial.ts";
import { appWiring, SLOP_PROBE_PHOTOS } from "../../packages/network/service/packs.ts";
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

  await clefGates(b);
  await deskGates(b);
  await adversarialGates(b);

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

// ------------------------------------------------------------------------------------------- clef
type FakeAnswers = { [k: string]: number | undefined };
/** A fake Workers AI endpoint: answers from `pick(message)` (noul probabilities by question id); records calls. */
function fakeClef(pick: (message: string) => FakeAnswers | "timeout" | "error") {
  const calls: { url: string; state: string; questions: number }[] = [];
  const fetch: ClefFetch = async (url, init) => {
    const body = JSON.parse(init.body) as { state: string; questions: Record<string, unknown> };
    calls.push({ url, state: body.state, questions: Object.keys(body.questions).length });
    const msg = /<<<MESSAGE\n([\s\S]*)\nMESSAGE>>>/.exec(body.state)?.[1] ?? "";
    const a = pick(msg);
    if (a === "timeout") return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    if (a === "error") return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "internal" }] }) };
    const answers = Object.fromEntries(Object.keys(RELAY_CLEF_QUESTIONS).map(id => [id, id === "harm" ? { score: (a.harm ?? 0) * 4, confidence: 0.9 } : { noul: a[id] ?? (id === "ordinary" ? 0.9 : 0.02), confidence: a.confidence ?? 0.9 }]));
    return { ok: true, status: 200, json: async () => ({ success: true, result: { answers, usage: { input_tokens: 950 } } }) };
  };
  return { fetch, calls };
}

async function clefGates(b: Block): Promise<void> {
  await b.run("relay + Clef: clef-flash by default, the full question bank (<= 64, with the 3 direct questions), thread context; it raises pass to hold or block", async () => {
    const f = fakeClef(m => (/sister/.test(m) ? { direct_scam: 0.92, money: 0.9, sob_story: 0.9, harm: 0.75 } : /shame/.test(m) ? { direct_harassment: 0.95, threat: 0.97, harm: 1 } : {}));
    const events: RelayClefEvent[] = [];
    const hook = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch, onEvent: e => events.push(e) });
    const thread = ["Riley says: \"see you Saturday!\"", "Sam says: \"can't wait\"", "a", "b", "c", "d"];
    const ok = await relayItemAsync(text("see you at 7 then"), baseCtx({ thread }), { hook });
    expect(ok.decision).toBe("pass");
    expect(f.calls[0]!.url).toMatch(/\/accounts\/acct\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
    expect(f.calls[0]!.questions).toBe(Object.keys(RELAY_CLEF_QUESTIONS).length);
    expect(Object.keys(RELAY_CLEF_QUESTIONS).length).toBeLessThanOrEqual(64);
    for (const q of ["direct_scam", "direct_harassment", "direct_contact"]) expect(Object.keys(RELAY_CLEF_QUESTIONS)).toContain(q);
    expect(f.calls[0]!.state).toContain("- d");
    expect(f.calls[0]!.state).not.toContain("Riley says"); // only the last 4 context messages
    const scam = await relayItemAsync(text("my sister is in the hospital abroad and I'm so stressed"), baseCtx(), { hook });
    expect([scam.decision, scam.reasons]).toEqual(["hold", ["clef:scam"]]);
    const threat = await relayItemAsync(text("it would be a shame if something happened to your car"), baseCtx(), { hook });
    expect(threat.decision).toBe("block");
    expect(threat.reasons).toContain("clef_severe:harassment");
    const big = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch, model: "clef" });
    await big({ text: "hello", kind: "text" });
    expect(f.calls.at(-1)!.url).toMatch(/\/@cf\/cloudflare\/clef$/);
  });

  await b.run("relay + Clef: Clef never lowers the rules (blocked items never reach it; held stay held), and only escalateHeld lets it raise a hold to a block", async () => {
    const f = fakeClef(() => ({ ordinary: 1 })); // Clef says everything is fine
    const hook = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch });
    const blocked = await relayItemAsync(text("i know where you live"), baseCtx(), { hook, escalateHeld: true });
    expect(blocked.decision).toBe("block");
    const held = await relayItemAsync(text("venmo me 50 for the tickets"), baseCtx(), { hook, escalateHeld: true });
    expect(held.decision).toBe("hold");
    expect(f.calls.length).toBe(1); // the held item was escalated (asked); the blocked one never was
    const g = fakeClef(() => ({ direct_harassment: 0.99, threat: 0.99, harm: 1 }));
    const h2 = clefRelayClassifier({ token: "t", accountId: "acct", fetch: g.fetch });
    expect((await relayItemAsync(text("venmo me 50 for the tickets"), baseCtx(), { hook: h2 })).decision).toBe("hold");
    expect(g.calls.length).toBe(0); // default: Clef only sees items the rules pass
    expect((await relayItemAsync(text("venmo me 50 for the tickets"), baseCtx(), { hook: h2, escalateHeld: true })).decision).toBe("block");
    // Every corpus row: rules + Clef (Clef says yes to everything) is never less severe than the rules.
    const yes = fakeClef(() => Object.fromEntries(Object.keys(RELAY_CLEF_QUESTIONS).map(k => [k, 0.99])));
    const no = fakeClef(() => ({ ordinary: 1 }));
    const sev = { pass: 0, hold: 1, block: 2 } as const;
    for (const file of [...TUNING_FILES, HELDOUT_FILE]) for (const row of await loadCorpus(file)) {
      const rules = relayItem(text(row.text), baseCtx()).decision;
      for (const ff of [yes, no]) for (const escalateHeld of [false, true]) {
        const r = await relayItemAsync(text(row.text), baseCtx(), { hook: clefRelayClassifier({ token: "t", accountId: "acct", fetch: ff.fetch }), escalateHeld });
        if (sev[r.decision] < sev[rules]) throw new Error(`Clef lowered ${rules} to ${r.decision} (${file})`);
      }
    }
  });

  await b.run("relay + Clef: a timeout, an error or no answer falls back to the rules; high-risk cues hold (clef:unavailable); uncertain high-risk answers hold", async () => {
    const events: RelayClefEvent[] = [];
    const slow = fakeClef(() => "timeout"), down = fakeClef(() => "error");
    for (const [name, hook] of [
      ["timeout", clefRelayClassifier({ token: "t", accountId: "acct", fetch: slow.fetch, timeoutMs: 20, onEvent: e => events.push(e) })],
      ["error", clefRelayClassifier({ token: "t", accountId: "acct", fetch: down.fetch, onEvent: e => events.push(e) })],
      ["no token", clefRelayClassifier({ onEvent: e => events.push(e) })],
      ["offline cache miss", clefRelayClassifier({ token: "t", accountId: "acct", fetch: down.fetch, offline: true, answers: () => undefined, onEvent: e => events.push(e) })],
    ] as const) {
      const plain = await relayItemAsync(text("see you at the corner at 7"), baseCtx(), { hook });
      expect([name, plain.decision]).toEqual([name, "pass"]);
      const risky = await relayItemAsync(text("thinking about investing more this year, any tips?"), baseCtx(), { hook });
      expect([name, risky.decision, risky.reasons]).toEqual([name, "hold", ["clef:unavailable"]]);
      const off = await relayItemAsync(text("thinking about investing more this year, any tips?"), baseCtx(), { hook: name === "no token" ? clefRelayClassifier({ holdOnUnavailable: false }) : hook });
      if (name === "no token") expect(off.decision).toBe("pass");
    }
    expect(down.calls.length).toBe(3); // the error hook was asked 3 times; the offline hook never calls
    expect(events.map(e => e.outcome)).toContain("timeout");
    expect(events.map(e => e.outcome)).toContain("error");
    expect(events.map(e => e.outcome)).toContain("miss");
    const unsure = fakeClef(() => ({ direct_scam: 0.45, money: 0.3, confidence: 0.4, ordinary: 0.3 }));
    const r = await relayItemAsync(text("would be nice to get dinner sometime"), baseCtx(), { hook: clefRelayClassifier({ token: "t", accountId: "acct", fetch: unsure.fetch, weights: directRelayClefWeights({ scam: 0.6 }) }) });
    expect([r.decision, r.reasons]).toEqual(["hold", ["clef:uncertain"]]);
  });

  await b.run("relay + Clef: direct mode thresholds the direct answer alone; no body in events, records or reasons", async () => {
    const f = fakeClef(m => (/crypto/.test(m) ? { direct_scam: 0.8 } : { money: 0.99, investment: 0.99 }));
    const events: RelayClefEvent[] = [];
    const hook = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch, weights: directRelayClefWeights(), onEvent: e => events.push(e) });
    const secret = "my uncle does crypto stuff, pretty wild";
    const r1 = await relayItemAsync(text(secret), baseCtx({ thread: ["Riley says: \"thread-secret-xyz\""] }), { hook });
    expect(r1.reasons).toEqual(["clef:scam"]);
    expect((await relayItemAsync(text("lunch tomorrow?"), baseCtx(), { hook })).decision).toBe("pass"); // bank answers alone do not count in direct mode
    const s = JSON.stringify([events, r1.record, threadMessage(r1)]);
    for (const leak of ["uncle", "crypto", "thread-secret-xyz", "wild"]) expect(s).not.toContain(leak);
    for (const reason of r1.record.reasons) expect(reason).toMatch(/^[a-z_]+:[a-z0-9_]+$/);
    expect(events[0]).toMatchObject({ model: "clef-flash", outcome: "ok", inputTokens: 950 });
  });

  // ---- the rules + Clef arm from recorded answers (never live) ---------------------------------------
  const cache = await loadClefCache(CLEF_CACHE);
  if (!cache?.size) {
    b.track("relay + Clef arm (recorded answers): skipped, no evals/relay/clef-answers.jsonl (fill it with `bun run relay-eval --live`)", false, "rules-only gates above still block");
    return;
  }
  const weights = (await Bun.file(CLEF_WEIGHTS).exists()) ? await loadRelayClefWeights(CLEF_WEIGHTS) : DEFAULT_RELAY_CLEF_WEIGHTS;
  const model = (weights.provenance?.model as "clef" | "clef-flash" | undefined) ?? "clef-flash";
  for (const file of [...TUNING_FILES, HELDOUT_FILE]) {
    const rows = await loadCorpus(file);
    const events: RelayClefEvent[] = [];
    const hook = clefRelayClassifier({ model, weights, offline: true, answers: cacheLookup(cache), onEvent: e => events.push(e) });
    const arm: ArmRow[] = [];
    let lowered = 0;
    for (const row of rows) {
      const rules = relayItem(text(row.text), baseCtx());
      const r = await relayItemAsync(text(row.text), baseCtx(), { hook });
      if (rules.decision !== "pass" && r.decision === "pass") lowered++;
      arm.push({ cls: row.class, stopped: r.decision !== "pass", categories: [...reasonCategories(r.reasons)] });
    }
    const asked = events.length, missed = events.filter(e => e.outcome === "miss").length;
    const s = scoreArm(arm), tracked = file === HELDOUT_FILE;
    b.gate(`relay + Clef ${file}: never passes an item the rules stop`, lowered === 0, `${lowered} lowered`);
    b.gate(`relay + Clef ${file}: recorded answers cover the rows Clef sees (weights ${weights.version})`, missed === 0, `${asked - missed}/${asked}`, !tracked);
    b.gate(`relay + Clef ${file}: honest held <= 5% (n ${s.counts.honest})`, s.falseHold <= 0.05, pct(s.falseHold), !tracked);
    b.track(`relay + Clef ${file}: recall scam ${pct(s.recall.scam)}, harassment ${pct(s.recall.harassment)}, contact ${pct(s.recall.contact)}, rating ${pct(s.recall.rating)}`, Math.min(s.recall.scam, s.recall.harassment) >= 0.9, tracked ? "heldout-2: never fitted on" : "tuning set");
  }
}

// ------------------------------------------------------------------------------------------- desk
// The platform's relay desk (packages/network/src/relay.ts) on the engine policy: what members and staff
// see on the live path (POST /internal/relay, the staff held queue), against a fake Network host.
interface FakeHost extends RelayHost { sent: { to: string; body: string; key: string; contact?: string }[]; members: Map<string, RelayMember>; t: number; match: RelayMatch }
function fakeHost(over: { ratesPhotos?: boolean; members?: Partial<Record<"a" | "b", Partial<RelayMember>>> } = {}): FakeHost {
  const members = new Map<string, RelayMember>([
    ["a", { id: "a", firstName: "Sam", age: 29, optedOut: false, held: false, ...over.members?.a }],
    ["b", { id: "b", firstName: "Riley", age: 31, optedOut: false, held: false, ...over.members?.b }],
  ]);
  const h: FakeHost = {
    app: "slop", ratesPhotos: over.ratesPhotos ?? true, t: NOW, sent: [], members,
    match: { id: "op1", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual", at: NOW - 86_400_000 },
    now: () => h.t,
    member: id => members.get(id),
    matchesOf: id => (h.match.participants.includes(id) ? [h.match] : []),
    blocked: () => false,
    privateFacts: () => ({ forbidden: [{ text: "Halcyon Biotech", owner: "b" }], canaries: [] }),
    send: (to, body, o) => { h.sent.push({ to, body, key: o.key, ...(o.contact ? { contact: o.contact } : {}) }); return "sent"; },
  };
  return h;
}
const phones: Record<string, string> = { a: "+12125550147", b: "+13475550123" };
const contactOf = (id: string) => phones[id];

async function deskGates(b: Block): Promise<void> {
  await b.run("relay desk: an honest text passes and only the engine's rendered wording goes out (outbound id relay:<item>)", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const r = await d.request({ itemId: "t1", from: "a", kind: "text", text: "running 10 min late, see you at the cafe" });
    expect(r).toMatchObject({ decision: "sent", reason: "Sent." });
    expect(h.sent).toEqual([{ to: "b", body: 'Sam says: "running 10 min late, see you at the cafe"', key: "relay:t1" }]);
    expect(await d.request({ itemId: "t1", from: "a", kind: "text", text: "running 10 min late, see you at the cafe" })).toMatchObject({ decision: "sent", replayed: true });
    expect(h.sent.length).toBe(1);
    const log = JSON.stringify(d.records());
    expect(log).not.toContain("running");
  });

  await b.run("relay desk: a scam is held for staff (nothing sent); staff reject drops the text, release delivers the engine wording", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const r = await d.request({ itemId: "s1", from: "a", kind: "text", text: "can you venmo me 200 for the tickets? my card got frozen" });
    expect(r.decision).toBe("held");
    expect(h.sent).toEqual([]);
    expect(d.held().map(x => [x.itemId, x.text !== undefined])).toEqual([["s1", true]]);
    expect(d.reject("s1", "staff:1")).toEqual({ ok: true });
    expect(d.held()).toEqual([]);
    expect(JSON.stringify(d.exportState())).not.toContain("venmo");
    const r2 = await d.request({ itemId: "s2", from: "a", kind: "text", text: "add me on telegram, it's easier" });
    expect(r2.decision).toBe("held");
    expect(d.release("s2", "staff:1")).toEqual({ ok: true, delivered: true });
    expect(h.sent.map(x => x.body)).toEqual(['Sam says: "add me on telegram, it\'s easier"']);
    expect(d.release("s2", "staff:1")).toEqual({ ok: false, reason: "not_held" });
  });

  await b.run("relay desk: a number is shared only after both members asked; each gets the other's, once", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const first = await d.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf });
    expect(first.decision).toBe("held");
    expect(h.sent.length).toBe(1);
    expect(h.sent[0]!.to).toBe("b");
    expect(h.sent[0]!.body).not.toContain(phones.a!);
    expect(h.sent[0]!.body).not.toMatch(/\d{7,}/);
    h.t += 60_000;
    const second = await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf });
    expect(second.decision).toBe("sent");
    const shares = h.sent.slice(1);
    expect(shares.map(x => [x.to, x.contact])).toEqual([["b", phones.a], ["a", phones.b]]);
    expect(shares[0]!.body).toContain(phones.a!);
    expect(shares[1]!.body).toContain(phones.b!);
    expect(d.contactShareFrom("relay:c1")).toBe("a");
    expect(d.contactShareFrom("relay:t9")).toBeUndefined();
    h.t += 60_000;
    expect((await d.request({ itemId: "c3", from: "a", kind: "contact_share" }, { contactOf })).decision).not.toBe("sent");
    expect(h.sent.length).toBe(3);
    expect(JSON.stringify(d.records())).not.toContain("555");
    // One side only: nothing goes.
    const h2 = fakeHost(), d2 = new RelayDesk(h2);
    await d2.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf });
    h2.t += 73 * 3_600_000;
    await d2.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf });
    expect(h2.sent.some(x => x.body.includes(phones.a!))).toBe(false);
  });

  await b.run("relay desk: a minor's photo (or words) is never relayed; photos wait for a show consent", async () => {
    const h = fakeHost({ members: { a: { age: undefined } } }), d = new RelayDesk(h);
    const r = await d.request({ itemId: "p1", from: "a", kind: "photo", photoIds: ["ph_abcdefgh"] }, { photos: { ids: ["ph_abcdefgh"], showConsent: true } });
    expect(r.decision).toBe("refused");
    const t = await d.request({ itemId: "t1", from: "a", kind: "text", text: "hey!" });
    expect(t.decision).toBe("refused");
    expect(h.sent).toEqual([]);
    const h2 = fakeHost(), d2 = new RelayDesk(h2);
    const said = await d2.request({ itemId: "t2", from: "a", kind: "text", text: "im 16 is that ok" });
    expect(said.decision).toBe("refused");
    expect(d2.held()).toEqual([]);
    expect(d2.records()[0]!.ageSignal).toBe(true);
    const off = await d2.request({ itemId: "p2", from: "a", kind: "photo", photoIds: ["ph_abcdefgh"] }, { photos: { ids: ["ph_abcdefgh"], showConsent: false } });
    expect(off).toMatchObject({ decision: "refused", reason: "I can't send photos to a match yet." });
    expect(h2.sent).toEqual([]);
  });

  await b.run("relay desk: appearance and rating talk never passes on an app that rates photos", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    for (const [i, t] of ["you two have similar looks apparently", "what did the app rate me?", "you seem petite, love that"].entries()) {
      const r = await d.request({ itemId: `a${i}`, from: "a", kind: "text", text: t });
      expect([t, r.decision]).toEqual([t, "held"]);
    }
    expect(h.sent).toEqual([]);
    expect(d.records().every(r => r.reasons.some(x => x.startsWith("rating:")))).toBe(true);
  });

  await b.run("relay desk: a burst is rate-limited (held, not queued for staff) and the limit survives a restart", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    for (let i = 0; i < 6; i++) { h.t += 1000; expect((await d.request({ itemId: `r${i}`, from: "a", kind: "text", text: `see you at ${i + 1}` })).decision).toBe("sent"); }
    const saved = d.exportState();
    const d2 = new RelayDesk(h);
    d2.importState(JSON.parse(JSON.stringify(saved)));
    h.t += 1000;
    const r = await d2.request({ itemId: "r6", from: "a", kind: "text", text: "one more thing" });
    expect(r.decision).toBe("held");
    expect(d2.records().at(-1)!.reasons).toEqual(["rate:burst"]);
    expect(d2.held()).toEqual([]);
    h.t += 11 * 60_000;
    expect((await d2.request({ itemId: "r7", from: "a", kind: "text", text: "ok last one" })).decision).toBe("sent");
  });

  await b.run("relay desk: private facts of the other member, a closed match and no match are refused", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    expect((await d.request({ itemId: "l1", from: "a", kind: "text", text: "do you still work at Halcyon Biotech?" })).decision).not.toBe("sent");
    h.match = { ...h.match, status: "cancelled" };
    expect((await d.request({ itemId: "l2", from: "a", kind: "text", text: "hi" })).decision).toBe("refused");
    h.match = { ...h.match, status: "mutual", metAt: NOW - 8 * 86_400_000 };
    expect((await d.request({ itemId: "l3", from: "a", kind: "text", text: "hi" })).decision).toBe("refused");
    expect(h.sent).toEqual([]);
  });

  await b.run("photo ids: every platform-issued id is opaque; phone-number-like ids still fail", () => {
    for (let i = 0; i < 10_000; i++) { const id = newPhotoId(); if (!isOpaquePhotoId(id)) throw new Error(`issued id ${id} fails isOpaquePhotoId`); }
    for (const bad of ["ph_2125550147", "212-555-0147", "ph_12125550147abcd", "https://x.test/p.jpg", "+12125550147"]) expect([bad, isOpaquePhotoId(bad)]).toEqual([bad, false]);
  });
}

// ------------------------------------------------------------------------------------ adversarial
const ADV_SEEDS = [13, 14, 15, 16];
const ADV_MIN: Record<AdversarialResult["scenario"], number> = { scam_after_reveal: 200, swap_before_yes: 1000, leak_other_member: 400, minor_in_relay: 400, photo_in_probe: 1500 };
const ADV_NAME: Record<AdversarialResult["scenario"], string> = {
  scam_after_reveal: "scam after the reveal: scammer reach <= 1 scam item, a sender hold, then nothing delivered from them",
  swap_before_yes: "number swap (share, number in text, photo) before both yeses: every item blocked, no number in the output or the log",
  leak_other_member: "leak of the other member's details (full name, number, private fact, canary): none delivered, stopped by the leak guard, a canary blocks",
  minor_in_relay: "minor in the relay (age slip, declared minor, unknown age): the slip blocks, then every item both ways blocked",
  photo_in_probe: "photo in the probe with the flag off, no consent, a minor or a held member: never a photo or the photo line; relayed photo never passes",
};

async function adversarialGates(b: Block): Promise<void> {
  const per = ADV_SEEDS.map(seed => ({ seed, results: slopRelayAdversarial(seed) }));
  for (const sc of Object.keys(ADV_NAME) as AdversarialResult["scenario"][]) {
    const rs = per.map(p => ({ seed: p.seed, r: p.results.find(x => x.scenario === sc)! }));
    const cases = rs.reduce((s, x) => s + x.r.cases, 0), ctlN = rs.reduce((s, x) => s + x.r.controls.n, 0), ctlOk = rs.reduce((s, x) => s + x.r.controls.ok, 0);
    const fails = rs.flatMap(x => x.r.failures.map(f => `seed ${x.seed} ${f}`));
    const stats: Record<string, number> = {};
    for (const x of rs) for (const [k, v] of Object.entries(x.r.stats)) stats[k] = k.startsWith("max") ? Math.max(stats[k] ?? 0, v) : (stats[k] ?? 0) + v;
    b.gate(`relay adversarial (slop world, seeds ${ADV_SEEDS.join(",")}): ${ADV_NAME[sc]} (n ${cases})`, cases >= ADV_MIN[sc] && fails.length === 0 && ctlN > 0 && ctlOk === ctlN,
      `${fails.length} failures${fails.length ? `: ${fails.slice(0, 3).join("; ")}` : ""}; controls ${ctlOk}/${ctlN}; ${Object.entries(stats).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }

  await b.run("relay adversarial (live path): the slop probe hook never attaches a photo while SLOP_PROBE_PHOTOS is off (adults, minors, unknown ages)", () => {
    expect(SLOP_PROBE_PHOTOS).toBe(false);
    const probe = appWiring("slop").hooks!.probe!;
    let n = 0;
    for (const [ageA, ageB] of [[29, 31], [45, 22], [18, 19], [17, 30], [30, 16], [undefined, 28]] as const) {
      const input = { now: NOW, members: [{ id: "a", age: ageA, prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }, { id: "b", age: ageB, prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }], facets: [], intents: [], presence: [], edges: [], recentProposals: [] } as never;
      for (const id of ["a", "b"]) {
        const t = probe({ id: `o-${ageA}-${ageB}`, category: "romance", participants: ["a", "b"] }, id, { when: "Thursday 7pm", input: () => input });
        if (t === undefined) continue;
        n++;
        expect([ageA, ageB, id, t.includes(SLOP_PROBE_PHOTO_LINE)]).toEqual([ageA, ageB, id, false]);
        expect(t).toMatch(/only tell you who it is if you both say yes/);
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  await b.run("relay adversarial (live path): the desk refuses a number swap before both yeses, and holds a scam after the reveal without sending", async () => {
    for (const [status, acceptedBy] of [["probing", []], ["probing", ["a"]], ["mutual", ["b"]]] as const) {
      const h = fakeHost(), d = new RelayDesk(h);
      h.match = { ...h.match, status, acceptedBy: [...acceptedBy] };
      for (const from of ["a", "b"] as const) {
        const r = await d.request({ itemId: `c-${status}-${acceptedBy.length}-${from}`, from, kind: "contact_share" }, { contactOf });
        expect([status, acceptedBy.length, from, r.decision]).toEqual([status, acceptedBy.length, from, "refused"]);
        const t = await d.request({ itemId: `t-${status}-${acceptedBy.length}-${from}`, from, kind: "text", text: `text me at ${phones[from]!.slice(2, 5)} ${phones[from]!.slice(5, 8)} ${phones[from]!.slice(8)}` });
        expect(t.decision).not.toBe("sent");
      }
      expect(h.sent).toEqual([]);
      expect(JSON.stringify(d.records())).not.toContain("555");
    }
    const h = fakeHost(), d = new RelayDesk(h);
    expect((await d.request({ itemId: "h1", from: "a", kind: "text", text: "so glad we matched, see you Saturday" })).decision).toBe("sent");
    for (const [i, t] of ["Do you have Telegram? Much easier to chat there.", "My card got frozen, can you send me $200 through cash app until it clears?", "Can you grab two Apple gift cards and send me the codes? I'll explain later."].entries()) {
      h.t += 60_000;
      expect([t, (await d.request({ itemId: `s${i}`, from: "a", kind: "text", text: t })).decision]).toEqual([t, "held"]);
    }
    expect(h.sent.length).toBe(1);
    expect(d.held().length).toBe(3);
  });
}
