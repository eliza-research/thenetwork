import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { DAY, findLeaks } from "../../packages/core/src/index.ts";
import {
  lawNewcomerNeverThrottledWithoutPitch, vampireAllowedTarget, vampireTier, vampireWeeklyCap,
} from "../../packages/core/src/generated/qualityAndLeague.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { memberVampireTierOf, pairLeagueAndVampireReason } from "../../packages/engine/src/filters.ts";
import { checkMemberFacing } from "../../packages/engine/src/judgeCommon.ts";
import { networkPack } from "../../packages/engine/src/packs/network/index.ts";
import { baseMember, emptyInput } from "../../packages/engine/src/testkit.ts";
import { World as EngineWorld } from "../../packages/engine/src/world.ts";
import { appearanceLeak } from "../../packages/engine/src/packs/slop/appearance.ts";
import { SLOP_PROBE_PHOTO_LINE, slopProbeMessage, slopProbeText } from "../../packages/engine/src/packs/slop/copy.ts";
import { probePhotoRefs } from "../../packages/engine/src/packs/slop/plan.ts";
import { parseRelayRequest, pastContacts, relayGuard, relayItem, relayItemAsync, relayItemFromRequest, RELAY_WORDING, threadMessage, type RelayContext, type RelayItem, type RelayRecord } from "../../packages/engine/src/relay.ts";
import { clefRelayClassifier, DEFAULT_RELAY_CLEF_WEIGHTS, directRelayClefWeights, loadRelayClefWeights, RELAY_CLEF_QUESTIONS, type RelayClefEvent } from "../../packages/engine/src/relayClef.ts";
import { scoreArm, type ArmRow, reasonCategories } from "../../packages/engine/src/relayClefFit.ts";
import type { ClefFetch } from "../../packages/engine/src/packs/slop/clef.ts";
import { baseCtx, textItem as text, cacheLookup, CLEF_CACHE, CLEF_WEIGHTS, HELDOUT_FILE, loadClefCache, loadCorpus, TUNING_FILES } from "../relay-clef-lib.ts";
import { RelayDesk, withdrawsSwap, type RelayHost, type RelayMatch, type RelayMember } from "../../packages/network/src/relay.ts";
import { newPhotoId } from "../../packages/platform/src/photos.ts";
import { isOpaquePhotoId, simulatedRelayClassifier } from "../../packages/engine/src/relay.ts";
import { slopRelayAdversarial, type AdversarialResult } from "../../packages/sim/src/apps/slop/adversarial.ts";
import { SLOP_RELAY_TEMPLATES } from "../../packages/sim/src/apps/slop/relay.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import { Block, expect } from "./gate.ts";

const ROOT = `${import.meta.dirname}/../../evals`;
const jsonl = async <T>(name: string): Promise<T[]> => (await fileAt(`${ROOT}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const NOW = Date.UTC(2026, 9, 9, 18);
const share = (over: Partial<RelayItem> = {}): RelayItem => ({ id: "c1", kind: "contact_share", from: "a", to: "b", at: NOW, contact: { kind: "phone", value: "+1 (212) 555-0147" }, consent: { kind: "contact_share", by: "a", itemId: "c1", at: NOW - 60_000 }, ...over });
const photo = (over: Partial<RelayItem> = {}): RelayItem => ({ id: "p1", kind: "photo", from: "a", to: "b", at: NOW, photoIds: ["ph_abcdefgh"], consent: { kind: "photo", by: "a", itemId: "p1", at: NOW - 30_000, photoIds: ["ph_abcdefgh"] }, ...over });

export async function relayBlock(b: Block): Promise<void> {
  // ---- corpus ---------------------------------------------------------------------------------------
  type Row = { text: string; class: "honest" | "scam" | "harassment" | "contact" | "rating"; want: "pass" | "stop" };
  // relay.jsonl, relay-paraphrases.jsonl and relay-heldout-1.jsonl were used to tune the rules: their gates block.
  // relay-heldout-2.jsonl and relay-heldout-3.jsonl were written after the tuning and scored once: their gates are
  // tracked (the rules' expected recall on new wording; do not tune on them, write a new held-out file instead).
  for (const file of ["relay/relay.jsonl", "relay/relay-paraphrases.jsonl", "relay/relay-heldout-1.jsonl", "relay/relay-heldout-2.jsonl", "relay/relay-heldout-3.jsonl"]) {
    const rows = await jsonl<Row>(file);
    const blocking = !/heldout-[23]\b/.test(file);
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
  const benign = (await fileAt(`${ROOT}/network/benign-adult.txt`).text()).trim().split("\n");
  const benignHeld = benign.filter(t => relayItem(text(t), baseCtx()).decision !== "pass");
  b.gate(`relay corpus network/benign-adult.txt: held <= 2% (n ${benign.length})`, benignHeld.length / benign.length <= 0.02, `${pct(benignHeld.length / benign.length)}${benignHeld.length ? `; ${benignHeld.slice(0, 3).join(" | ")}` : ""}`);

  const reqs = await jsonl<{ text: string; want: "contact_share" | "photo" | "text" | "none" }>("relay/requests.jsonl");
  const reqMiss = reqs.filter(r => parseRelayRequest(r.text).kind !== r.want).map(r => `${JSON.stringify(r.text)} -> ${parseRelayRequest(r.text).kind} (want ${r.want})`);
  const falseConsent = reqs.filter(r => r.want !== "contact_share" && r.want !== "photo" && ["contact_share", "photo"].includes(parseRelayRequest(r.text).kind));
  b.gate(`relay requests (n ${reqs.length}): every row read as labelled`, reqs.length >= 30 && reqMiss.length === 0, reqMiss.slice(0, 5).join("; "));
  b.gate("relay requests: 0 hedged, negated or question requests read as a contact share or photo send", falseConsent.length === 0, falseConsent.map(r => r.text).join(" | "));

  // ---- scenarios ------------------------------------------------------------------------------------
  await b.run("relay: alternatives pass while terminal or explicit threats block", () => {
    for (const body of ["Thursday works, or else Saturday", "I can do coffee or else we'll meet Thursday", "Tacos or else ramen is fine"]) {
      expect([body, relayItem(text(body), baseCtx()).decision]).toEqual([body, "pass"]);
    }
    for (const body of ["Answer me or else.", "Reply or else you'll regret it"]) {
      const result = relayItem(text(body), baseCtx());
      expect(result).toMatchObject({ decision: "block", rendered: "" });
      expect(result.reasons).toContain("harass_severe:threat");
    }
  });

  await b.run("relay: never to or from a minor or an unknown age; a minor's self-disclosure blocks and flags the age", () => {
    for (const age of [13, 16, 17, undefined, Number.NaN, -1, 400]) {
      for (const side of ["sender", "recipient"] as const) {
        const ctx = baseCtx();
        ctx[side] = { ...ctx[side], age };
        for (const it of [text("see you at 7!"), share(), photo()]) { const r = relayItem(it, ctx); expect([age, side, r.decision]).toEqual([age, side, "block"]); expect(r.rendered).toBe(""); expect(r.reasons).toContain("minor:party"); }
      }
    }
    for (const t of ["my son is 15 years old", "my sister is 15 yo and loves the zoo", "you said you're 16?", "ben is 15 years old"]) expect([t, relayItem(text(t), baseCtx()).record.ageSignal]).toEqual([t, false]);
    for (const t of ["lol I'm 16 tho", "im 17 years old", "I'm still in high school", "not 18 yet but soon", "im a 16 year old guy", "15 y/o here",
      "im 12 is that ok", "i am 10 years old", "11 yo", "im 17m", "i'm 16f looking to meet",
      "hey im 15f btw", "im 16/x from brooklyn", "17m here", "I'm 18 in two weeks",
      "I'm turning 16 next month", "I'm turning 16 in May", "I turn 16 next month",
      "I'll be 16 in May", "I'm almost 16", "I'm nearly 16", "almost 16",
      "I'm turning 18 next month", "I'll be 18 in May", "turning 16 next month", "16 next month",
      "I'm turning 18 today", "I'm turning 18 this month", "I'm in seventh grade and she works as a teacher",
      'I said "I\'m turning 16 next month"', 'She said "hi" and I\'m turning 16 next month',
      'I said "I\'m in seventh grade, as a teacher told me."',
      "I'm in 7th grade", "I'm in seventh grade", "I'm a 7th grader",
      "I'm in 5th grade", "I'm in fifth grade", "I'm a 5th grader", "I'm a fifth grader",
      "I'm a seventh grader", "I'm an eighth grader", "I'm a ninth grader", "I'm a tenth grader",
      "I'm a high schooler", "I'm a middle schooler", "I'm a middle school student",
      "I'm turning 12 next month", "I'm turning twelve next week", "I'll be 12 in May", "I turn 11 next week",
      "I'm almost 12 years old", "turning 12 today", "turning 12 next month",
      "I'm sixteen years old", "I'm fifteen", "I'm twelve years old", "I'm a 16-year-old",
      "I'm a sophomore in high school", "I'm a high school junior",
      "I'm 16.5 years old", "I'm 15.5 y.o. and I live in NYC"]) {
      const r = relayItem(text(t), baseCtx());
      expect([t, r.decision, r.record.ageSignal]).toEqual([t, "block", true]);
    }
    for (const t of ["I'm 15 minutes away", "I'm 29", "we met when I was in high school",
      "I'm 17m away from the bar", "im 170m from home", "I'm 5'8", "I'm 3 years into my PhD",
      "I'm 1 of 3 siblings", "I'm 2 drinks in", 'she said "I am 10 years old"',
      "I'm 18.5 years old", "I'm 15.5 miles away", "I'm 15 y.o. in two years",
      "I'm 15 years old in two years", "My child is 12.5 years old",
      "I'm almost 30", "I'm in 12th grade as a teacher", "I'm in 12th grade, as a teacher",
      "I'm in 5th grade as a teacher", "I'm a ninth grade teacher", "I'm a high school teacher", "I'm a middle school teacher",
      'I said "I\'m in 12th grade, as a teacher at the school."', 'She said "I\'m in seventh grade, as a teacher told me."',
      "As a teacher of biology, I'm in 12th grade",
      "I'm almost 150 miles away", "I'm turning 165 degrees clockwise", "I'm turning 16.5 degrees",
      "I'm turning 12 degrees left", "I'm almost 12 miles away", "I'm fifteen minutes away",
      "I'm turning sixteen degrees", "I'm turning 16 in two years", "Imagine I'm turning 15",
      "Imagine I'm a tenth grader", "almost 12", "12 next month",
      'She said "I\'m turning 16 next month"', 'She said "I\'m turning 12 next month"',
      'She said "I\'m a tenth grader"', 'She said "I\'m sixteen years old"',
      "My cousin said I am in seventh grade", "My kid is a ninth grader",
      "My daughter is a high schooler", "My son is a 16-year-old", "I'm a 12-year veteran",
      "My race result is 29.15 years old"]) expect([t, relayItem(text(t), baseCtx()).decision]).toEqual([t, "pass"]);
  });

  await b.run("relay teen_relay_contact: a teen friendship pair gets moderated text only; no number, photo or contact move ever passes", () => {
    const pair = (over: Partial<RelayContext> = {}) => baseCtx({
      opportunity: { ...baseCtx().opportunity, app: "friends" },
      sender: { ...baseCtx().sender, age: 16, photoConsent: false }, recipient: { ...baseCtx().recipient, age: 17, photoConsent: false }, ...over,
    });
    const teen = (over: Partial<RelayContext> = {}) => pair({ teenFriendPair: true, ...over });
    for (const it of [share(), photo()]) for (const ctx of [teen(), teen({ sender: { ...baseCtx().sender, age: 29 } })]) {
      const r = relayItem(it, ctx);
      expect([it.kind, r.decision, r.rendered]).toEqual([it.kind, "block", ""]);
      expect(r.reasons).toContain("minor:party");
    }
    const clean = relayItem(text("that robotics club sounds fun!"), teen());
    expect(clean.decision).toBe("pass");
    expect(relayItem(text("that robotics club sounds fun!"), pair()).decision).toBe("block");
    for (const t of ["add me on snap", "what's your insta", "text me, my number is 212 555 0147", "email me at sam@example.com", "don't tell your parents", "how old are you really",
      "i can buy you a gift card", "send me a pic", "come over to my place", "which school do you go to"]) {
      expect([t, relayItem(text(t), teen()).decision === "pass"]).toEqual([t, false]);
    }
    const met = teen({ opportunity: { ...pair().opportunity, metAt: baseCtx().now - 86_400_000 } });
    for (const t of ["add me on snap", "what's your insta", "let's talk off this app"]) {
      expect([t, relayItem(text(t), met).decision === "pass"]).toEqual([t, false]);
    }
  });

  await b.run("relay: only inside a mutual match between its two participants; blocks, opt-outs and holds win", () => {
    const op = baseCtx().opportunity;
    for (const status of ["probing", "closed", "cancelled", "expired"] as const) expect(relayItem(text("hi"), baseCtx({ opportunity: { ...op, status } })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ opportunity: { ...op, acceptedBy: ["a"] } })).decision).toBe("block");
    expect(relayItem({ ...text("hi"), to: "c" }, baseCtx()).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ blocked: true })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ recipient: { ...baseCtx().recipient, optedOut: true } })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ sender: { ...baseCtx().sender, held: true } })).decision).toBe("block");
    expect(relayItem(text("hi"), baseCtx({ recipient: { ...baseCtx().recipient, held: true } })).decision).toBe("block");
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
      expect([t, r.decision, r.rendered]).toEqual([t, "block", ""]);
      expect([t, r.senderNotice]).toEqual([t, "I didn't send that. I don't pass on contact details, handles, addresses or other apps inside a message."]);
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
    expect(relayItem(text("heard you're going through a divorce?"), ctx)).toMatchObject({ decision: "block", rendered: "", senderNotice: "I didn't send that, so it didn't reach them." });
    expect(relayItem(text("ref QX-4821-ORCHID"), ctx).decision).toBe("block");
    expect(relayItem(text("full disclosure, I have two kids from a previous marriage"), ctx).decision).toBe("pass");
    for (const t of ["how hot did the app rate me?", "what's my score", "appearance:face=1.20", "are we the same level of attractiveness", "you're a 10/10"]) {
      const r = relayItem(text(t), ctx);
      expect([t, r.decision, r.rendered]).toEqual([t, "block", ""]);
    }
    // The agent's own wording never carries appearance or rating words.
    for (const w of [RELAY_WORDING.text("Sam", "x"), RELAY_WORDING.photo("Sam"), RELAY_WORDING.contact("Sam", "phone", "+12125550147")]) expect(appearanceLeak(w)).toBeNull();
  });

  await b.run("relay: rate limits stop a burst; the log has no body, no contact value, no photo id; ban notices from the log", () => {
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
    for (const t of ["should I send them my number?", "don't send my number yet", "send them my number if she asks", "send them this photo next week", "how are you?"]) {
      expect([t, mk(t, "r4")]).toEqual([t, null]);
    }
    expect(relayItemFromRequest({ kind: "contact_share" }, { id: "r5", from: "a", to: "b", at })).toBeNull();

    const quoted = '"I will send you my number when we meet."';
    expect(mk(`tell them ${quoted}`, "quoted-shared-text")).toMatchObject({ kind: "text", text: quoted });
    const scheduling = mk('tell them "I can meet Friday if that works for you."', "quoted-schedule");
    expect(relayItem(scheduling!, baseCtx()).decision).toBe("pass");
    const contactInQuote = mk('tell them "I will send you my number +1 (212) 555-0147 when we meet."', "quoted-private-contact");
    expect(contactInQuote?.kind).toBe("text");
    const checked = relayItem(contactInQuote!, baseCtx());
    expect(checked.decision).not.toBe("pass");
    expect(checked.rendered).toBe("");
  });

  await b.run("relay: the classifier hook runs only on items the rules pass; a flag, an error or an answer that does not parse blocks (owner decision 2026-11-22, D18)", async () => {
    let calls = 0;
    const hook = async () => { calls++; return { flags: ["scam"] }; };
    const flagged = await relayItemAsync(text("see you at 7"), baseCtx(), { hook });
    expect([flagged.decision, flagged.reasons, flagged.rendered, flagged.senderNotice]).toEqual(["block", ["clef:scam"], "", "I didn't send that, so it didn't reach them."]);
    expect((await relayItemAsync(text("venmo me 50"), baseCtx(), { hook })).decision).toBe("block");
    expect(calls).toBe(1);
    const boom = async () => { throw new Error("down"); };
    const down = await relayItemAsync(text("see you at 7"), baseCtx(), { hook: boom });
    expect([down.decision, down.reasons, down.rendered, down.senderNotice]).toEqual(["block", ["classifier:unavailable"], "", "I couldn't check that message just now, so I didn't send it. Please try again in a few minutes."]);
    for (const bad of [undefined, null, "yes", [], {}, { flags: "scam" }, { flags: [1] }, { flags: [], block: "x" }, { flags: [], unavailable: true }]) {
      const r = await relayItemAsync(text("see you at 7"), baseCtx(), { hook: async () => bad as never });
      expect([String(JSON.stringify(bad)), r.decision, r.reasons, r.rendered]).toEqual([String(JSON.stringify(bad)), "block", ["classifier:unavailable"], ""]);
    }
    const clean = await relayItemAsync(text("see you at 7"), baseCtx(), { hook: async () => ({ flags: [] }) });
    expect([clean.decision, clean.rendered, clean.senderNotice]).toEqual(["pass", 'Sam says: "see you at 7"', "Sent."]);
  });

  await b.run("relay: every scam and harassment template of the slop world stops on its content alone", () => {
    const T = SLOP_RELAY_TEMPLATES;
    const texts = [...T.harassment, ...T.scam.offplatform_move, ...T.scam.money_ask, ...T.scam.financial_loss];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((t, i) => relayItem(text(t, `t${i}`), baseCtx()).decision === "pass")).toEqual([]);
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
    const copy = await fileAt(`${import.meta.dirname}/../../packages/engine/src/packs/slop/copy.ts`).text();
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
    const msg = /<<<UNTRUSTED MESSAGE [0-9a-f]+>>>\n([\s\S]*?)\n<<<END UNTRUSTED [0-9a-f]+>>>/.exec(body.state)?.[1] ?? "";
    const a = pick(msg);
    if (a === "timeout") return new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    if (a === "error") return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: "internal" }] }) };
    const answers = Object.fromEntries(Object.keys(RELAY_CLEF_QUESTIONS).map(id => [id, id === "harm" ? { score: (a.harm ?? 0) * 4, confidence: 0.9 } : { noul: a[id] ?? (id === "ordinary" ? 0.9 : 0.02), confidence: a.confidence ?? 0.9 }]));
    return { ok: true, status: 200, json: async () => ({ success: true, result: { answers, usage: { input_tokens: 950 } } }) };
  };
  return { fetch, calls };
}

async function clefGates(b: Block): Promise<void> {
  await b.run("relay + Clef: clef-flash by default, the full question bank (<= 64, with the 3 direct questions), thread context; it raises a pass to a block", async () => {
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
    expect([scam.decision, scam.reasons]).toEqual(["block", ["clef:scam"]]);
    const threat = await relayItemAsync(text("it would be a shame if something happened to your car"), baseCtx(), { hook });
    expect(threat.decision).toBe("block");
    expect(threat.reasons).toContain("clef_severe:harassment");
    const big = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch, model: "clef" });
    await big({ text: "hello", kind: "text" });
    expect(f.calls.at(-1)!.url).toMatch(/\/@cf\/cloudflare\/clef$/);
  });

  await b.run("relay + Clef: Clef never lowers the rules, and an item the rules stop never reaches it (owner decision 2026-11-22, D18)", async () => {
    const f = fakeClef(() => ({ ordinary: 1 })); // Clef says everything is fine
    const hook = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch });
    expect((await relayItemAsync(text("i know where you live"), baseCtx(), { hook })).decision).toBe("block");
    const flagged = await relayItemAsync(text("venmo me 50 for the tickets"), baseCtx(), { hook });
    expect([flagged.decision, flagged.reasons.some(r => r.startsWith("scam:"))]).toEqual(["block", true]);
    expect(f.calls.length).toBe(0);
    const yes = fakeClef(() => Object.fromEntries(Object.keys(RELAY_CLEF_QUESTIONS).map(k => [k, 0.99])));
    const no = fakeClef(() => ({ ordinary: 1 }));
    for (const file of [...TUNING_FILES, HELDOUT_FILE]) for (const row of await loadCorpus(file)) {
      const rules = relayItem(text(row.text), baseCtx()).decision;
      for (const ff of [yes, no]) {
        const r = await relayItemAsync(text(row.text), baseCtx(), { hook: clefRelayClassifier({ token: "t", accountId: "acct", fetch: ff.fetch }) });
        if (rules === "block" && r.decision === "pass") throw new Error(`Clef passed an item the rules stop (${file})`);
      }
    }
  });

  await b.run("relay + Clef: a timeout, an error, no token or an offline cache miss blocks every text (classifier:unavailable); uncertain high-risk answers block", async () => {
    const events: RelayClefEvent[] = [];
    const slow = fakeClef(() => "timeout"), down = fakeClef(() => "error");
    for (const [name, hook] of [
      ["timeout", clefRelayClassifier({ token: "t", accountId: "acct", fetch: slow.fetch, timeoutMs: 20, onEvent: e => events.push(e) })],
      ["error", clefRelayClassifier({ token: "t", accountId: "acct", fetch: down.fetch, onEvent: e => events.push(e) })],
      ["no token", clefRelayClassifier({ onEvent: e => events.push(e) })],
      ["offline cache miss", clefRelayClassifier({ token: "t", accountId: "acct", fetch: down.fetch, offline: true, answers: () => undefined, onEvent: e => events.push(e) })],
    ] as const) {
      for (const t of ["see you at the corner at 7", "thinking about investing more this year, any tips?"]) {
        const r = await relayItemAsync(text(t), baseCtx(), { hook });
        expect([name, t, r.decision, r.reasons, r.rendered, r.senderNotice]).toEqual([name, t, "block", ["classifier:unavailable"], "", "I couldn't check that message just now, so I didn't send it. Please try again in a few minutes."]);
      }
    }
    expect(down.calls.length).toBe(2);
    expect(events.map(e => e.outcome)).toContain("timeout");
    expect(events.map(e => e.outcome)).toContain("error");
    expect(events.map(e => e.outcome)).toContain("miss");
    const unsure = fakeClef(() => ({ direct_scam: 0.45, money: 0.3, confidence: 0.4, ordinary: 0.3 }));
    const r = await relayItemAsync(text("would be nice to get dinner sometime"), baseCtx(), { hook: clefRelayClassifier({ token: "t", accountId: "acct", fetch: unsure.fetch, weights: directRelayClefWeights({ scam: 0.6 }) }) });
    expect([r.decision, r.reasons]).toEqual(["block", ["clef:uncertain"]]);
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

  await b.run("relay + Clef: a classifier minor_signal flag is the item's age signal in the engine record, as a flag or a severe flag; other flags are not", async () => {
    const f = fakeClef(m => (/saturday/.test(m) ? { minor: 0.99 } : {}));
    const clef = await relayItemAsync(text("see you saturday, cant wait"), baseCtx(), { hook: clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch }) });
    expect([clef.decision, clef.reasons, clef.record.ageSignal]).toEqual(["block", ["clef:minor_signal"], true]);
    const severe = await relayItemAsync(text("see you sunday then"), baseCtx(), { hook: async () => ({ flags: [], block: ["Minor_Signal"] }) });
    expect([severe.decision, severe.reasons, severe.record.ageSignal]).toEqual(["block", ["clef_severe:minor_signal"], true]);
    const scam = await relayItemAsync(text("see you sunday then"), baseCtx(), { hook: async () => ({ flags: ["scam"] }) });
    expect([scam.decision, scam.reasons, scam.record.ageSignal]).toEqual(["block", ["clef:scam"], false]);
    const plain = await relayItemAsync(text("see you sunday then"), baseCtx(), { hook: async () => ({ flags: [] }) });
    expect([plain.decision, plain.record.ageSignal]).toEqual(["pass", false]);
  });

  // ---- the rules + Clef arm from recorded answers (never live) ---------------------------------------
  const cache = await loadClefCache(CLEF_CACHE);
  if (!cache?.size) {
    b.track("relay + Clef arm (recorded answers): skipped, no evals/relay/clef-answers.jsonl (fill it with `pnpm run relay-eval --live`)", false, "rules-only gates above still block");
    return;
  }
  const weights = (await fileAt(CLEF_WEIGHTS).exists()) ? await loadRelayClefWeights(CLEF_WEIGHTS) : DEFAULT_RELAY_CLEF_WEIGHTS;
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
    b.gate(`relay + Clef ${file}: honest blocked <= 5% (n ${s.counts.honest})`, s.falseHold <= 0.05, pct(s.falseHold), !tracked);
    b.track(`relay + Clef ${file}: recall scam ${pct(s.recall.scam)}, harassment ${pct(s.recall.harassment)}, contact ${pct(s.recall.contact)}, rating ${pct(s.recall.rating)}`, Math.min(s.recall.scam, s.recall.harassment) >= 0.9, tracked ? "heldout-2: never fitted on" : "tuning set");
  }
}

interface FakeHost extends RelayHost { sent: { to: string; body: string; key: string; contact?: string }[]; sendOptions: string[][]; members: Map<string, RelayMember>; t: number; match: RelayMatch; minorSignals: string[]; severeBlocks: string[] }
function fakeHost(over: { ratesPhotos?: boolean; members?: Partial<Record<"a" | "b", Partial<RelayMember>>> } = {}): FakeHost {
  const members = new Map<string, RelayMember>([
    ["a", { id: "a", firstName: "Sam", age: 29, optedOut: false, held: false, markedMinor: false, ...over.members?.a }],
    ["b", { id: "b", firstName: "Riley", age: 31, optedOut: false, held: false, markedMinor: false, ...over.members?.b }],
  ]);
  const h: FakeHost = {
    app: "slop", ratesPhotos: over.ratesPhotos ?? true, t: NOW, sent: [], sendOptions: [], members, minorSignals: [], severeBlocks: [],
    match: { id: "op1", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual", negativeFeedback: false, at: NOW - 86_400_000 },
    now: () => h.t,
    member: id => members.get(id),
    matchesOf: id => (h.match.participants.includes(id) ? [h.match] : []),
    blocked: () => false,
    privateFacts: () => ({ forbidden: [{ text: "Halcyon Biotech", owner: "b" }], canaries: [] }),
    send: (to, body, o) => { h.sent.push({ to, body, key: o.key, ...(o.contact ? { contact: o.contact } : {}) }); h.sendOptions.push(Object.keys(o).sort()); return "sent"; },
    minorSignal: id => { h.minorSignals.push(id); const m = members.get(id); if (m) members.set(id, { ...m, markedMinor: true }); },
    severeBlock: id => { h.severeBlocks.push(id); },
    classifierFailed: () => {},
  };
  return h;
}
const phones: Record<string, string> = { a: "+12125550147", b: "+13475550123" };
const contactOf = (id: string) => phones[id];

async function deskGates(b: Block): Promise<void> {
  await b.run("relay desk: an honest text passes and only the engine's rendered wording goes out (outbound id relay:<item>)", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const r = await d.request({ itemId: "t1", from: "a", kind: "text", text: "running 10 min late, see you at the cafe" }, { hook: simulatedRelayClassifier });
    expect(r).toMatchObject({ decision: "sent", reason: "Sent." });
    expect(h.sent).toEqual([{ to: "b", body: 'Sam says: "running 10 min late, see you at the cafe"', key: "relay:t1" }]);
    expect(await d.request({ itemId: "t1", from: "a", kind: "text", text: "running 10 min late, see you at the cafe" }, { hook: simulatedRelayClassifier })).toMatchObject({ decision: "sent", replayed: true });
    expect(h.sent.length).toBe(1);
    const log = JSON.stringify(d.records());
    expect(log).not.toContain("running");
  });

  await b.run("relay desk: a scam or an off-platform move is blocked at once with its notice (nothing sent, no text kept; owner decision 2026-11-22, D18)", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const scam = "can you venmo me 200 for the tickets? my card got frozen";
    expect(await d.request({ itemId: "s1", from: "a", kind: "text", text: scam }, { hook: simulatedRelayClassifier })).toEqual({ itemId: "s1", decision: "refused", reason: "I didn't send that, so it didn't reach them." });
    expect(await d.request({ itemId: "s2", from: "a", kind: "text", text: "add me on telegram, it's easier" }, { hook: simulatedRelayClassifier }))
      .toEqual({ itemId: "s2", decision: "refused", reason: "I didn't send that. I don't pass on contact details, handles, addresses or other apps inside a message." });
    expect(h.sent).toEqual([]);
    expect(d.records().map(x => [x.itemId, x.decision])).toEqual([["s1", "block"], ["s2", "block"]]);
    const state = d.exportState();
    expect(Object.keys(state).sort()).toEqual(["log", "swaps", "threads"]);
    for (const word of ["venmo", "telegram", "frozen"]) expect(JSON.stringify(state)).not.toContain(word);
    expect(await d.request({ itemId: "s1", from: "a", kind: "text", text: scam }, { hook: simulatedRelayClassifier }))
      .toEqual({ itemId: "s1", decision: "refused", delivered: false, reason: "I didn't send that, so it didn't reach them.", replayed: true });
    expect(h.sent).toEqual([]);
  });

  await b.run("relay desk: a classifier that cannot run blocks the text with the retry notice; a clean answer sends it (owner decision 2026-11-22, D18)", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const down = await d.request({ itemId: "u1", from: "a", kind: "text", text: "see you at 7!" }, { hook: async () => { throw new Error("down"); } });
    expect(down).toEqual({ itemId: "u1", decision: "refused", reason: "I couldn't check that message just now, so I didn't send it. Please try again in a few minutes." });
    expect(h.sent).toEqual([]);
    expect(d.records().at(-1)).toMatchObject({ itemId: "u1", decision: "block", reasons: ["classifier:unavailable"] });
    h.t += 60_000;
    expect(await d.request({ itemId: "u2", from: "a", kind: "text", text: "see you at 7!" }, { hook: async () => ({ flags: [] }) })).toMatchObject({ decision: "sent", reason: "Sent." });
    expect(h.sent.map(x => x.key)).toEqual(["relay:u2"]);
  });

  await b.run("relay desk: a teen-pair text that the classifier cannot read is blocked, and a text the classifier cleared is sent (owner decision 2026-11-22, D18)", async () => {
    const h = fakeHost({ members: { a: { age: 16 }, b: { age: 17 } } }), d = new RelayDesk(h);
    h.teenPair = () => true;
    const unread = await d.request({ itemId: "tp1", from: "a", kind: "text", text: "see you at the climbing gym on saturday" }, { hook: async () => { throw new Error("down"); } });
    expect(unread).toEqual({ itemId: "tp1", decision: "refused", reason: "I couldn't check that message just now, so I didn't send it. Please try again in a few minutes." });
    expect(h.sent).toEqual([]);
    expect(d.records().at(-1)).toMatchObject({ itemId: "tp1", decision: "block", reasons: ["classifier:unavailable"] });
    h.t += 60_000;
    const read = await d.request({ itemId: "tp2", from: "a", kind: "text", text: "see you at the climbing gym on saturday" }, { hook: async () => ({ flags: [], block: [] }) });
    expect(read).toMatchObject({ decision: "sent", reason: "Sent." });
    expect(h.sent.map(x => x.key)).toEqual(["relay:tp2"]);
  });

  await b.run("relay desk: a text that the send rules refuse answers the same notice when it is asked again", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    h.send = () => "refused";
    const first = await d.request({ itemId: "sr1", from: "a", kind: "text", text: "see you at 7!" }, { hook: simulatedRelayClassifier });
    expect(first).toEqual({ itemId: "sr1", decision: "refused", reason: "I couldn't pass that on right now." });
    expect(d.records().at(-1)).toMatchObject({ itemId: "sr1", decision: "block", reasons: ["send:refused"] });
    expect(await d.request({ itemId: "sr1", from: "a", kind: "text", text: "see you at 7!" }, { hook: simulatedRelayClassifier }))
      .toEqual({ itemId: "sr1", decision: "refused", delivered: false, reason: "I couldn't pass that on right now.", replayed: true });
  });

  await b.run("relay desk: a safety hold on either adult blocks the text, and the desk keeps no text of it (owner decision 2026-11-22, D18)", async () => {
    for (const id of ["a", "b"]) {
      const host = fakeHost(), desk = new RelayDesk(host);
      host.members.get(id)!.held = true;
      const request = { itemId: `held-${id}`, from: "a", kind: "text" as const, text: "see you at the cafe at 7" };
      expect((await desk.request(request, { hook: simulatedRelayClassifier })).decision).toBe("refused");
      expect(host.sent).toEqual([]);
      expect(desk.records().at(-1)).toMatchObject({ itemId: request.itemId, decision: "block" });
      expect(desk.records().at(-1)!.reasons).toContain(id === "a" ? "safety:sender_held" : "safety:recipient_held");
      expect(JSON.stringify(desk.exportState())).not.toContain(request.text);
    }
  });

  await b.run("relay desk: a number is shared only after both members asked; each gets the other's, once", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const first = await d.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    expect(first.decision).toBe("waiting");
    expect(h.sent.length).toBe(1);
    expect(h.sent[0]!.to).toBe("b");
    expect(h.sent[0]!.body).not.toContain(phones.a!);
    expect(h.sent[0]!.body).not.toMatch(/\d{7,}/);
    h.t += 60_000;
    const second = await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    expect(second.decision).toBe("sent");
    const shares = h.sent.slice(1);
    expect(shares.map(x => [x.to, x.contact])).toEqual([["b", phones.a], ["a", phones.b]]);
    expect(shares[0]!.body).toContain(phones.a!);
    expect(shares[1]!.body).toContain(phones.b!);
    expect(d.contactShareFrom("relay:c1")).toBe("a");
    expect(d.contactShareFrom("relay:t9")).toBeUndefined();
    h.t += 60_000;
    expect((await d.request({ itemId: "c3", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).not.toBe("sent");
    expect(h.sent.length).toBe(3);
    expect(JSON.stringify(d.records())).not.toContain("555");
    // One side only: nothing goes.
    const h2 = fakeHost(), d2 = new RelayDesk(h2);
    await d2.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    h2.t += 73 * 3_600_000;
    await d2.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    expect(h2.sent.some(x => x.body.includes(phones.a!))).toBe(false);
  });

  await b.run("relay desk: a swapped number is never kept in the thread (stored state, classifier context); the Clef prompt is PII-masked", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    await d.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    h.t += 60_000;
    expect((await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).toBe("sent");
    const threads = JSON.stringify(d.exportState().threads);
    expect(threads).toContain("shared their number.");
    for (const p of Object.values(phones)) { expect(threads).not.toContain(p); expect(threads).not.toContain(p.slice(-4)); }
    // The relay hook's prompt: contact details in the message or in the thread context are masked (PRD 32.14).
    const f = fakeClef(() => ({}));
    const hook = clefRelayClassifier({ token: "t", accountId: "acct", fetch: f.fetch });
    await relayItemAsync(text("see you at 7 then"), baseCtx({ thread: ["Sam asked me to send you their number: +1 (212) 555-0147", "Riley says: \"mail me at riley@example.com\""] }), { hook });
    expect(f.calls[0]!.state).not.toContain("555-0147");
    expect(f.calls[0]!.state).not.toContain("riley@example.com");
    expect(f.calls[0]!.state).toContain("[phone]");
  });

  await b.run("relay desk: a swap request lasts only as long as the engine's consent (never backdated) and can be taken back", async () => {
    // 16 minutes between the two requests: the first consent is stale, nothing is shared, the second request waits instead.
    const h = fakeHost(), d = new RelayDesk(h);
    await d.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    h.t += 16 * 60_000;
    expect((await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).toBe("waiting");
    expect(h.sent.some(x => x.contact)).toBe(false);
    // Withdrawn: "don't send my number" (or the relay action's cancel) removes the pending request.
    for (const t of ["actually don't send my number", "cancel the number swap", "never mind about my number"]) expect(withdrawsSwap(t)).toBe(true);
    for (const t of ["send them my number", "my number is in my profile", "don't be late"]) expect(withdrawsSwap(t)).toBe(false);
    // A yes, or a message that only mentions the number, never takes the request back.
    for (const t of ["I dont mind, send them my number", "don't wait, send them my number", "send them my number, I don't care", "yes send my number, stop asking", "lol never had to wait this long for someone to want my number", "no worries, send my number", "no problem, send them my number", "send my number, no rush", "I don't mind sharing my number", "never had someone ask to swap numbers before"]) expect([t, withdrawsSwap(t)]).toEqual([t, false]);
    // A withdrawal in any wording still withdraws (a swap left pending after a no would share the number).
    for (const t of ["I'd rather not share my number", "please don't give them my number", "changed my mind about my number", "scratch the swap", "stop sharing my number", "hold off for now, my number can wait", "cancel, I'll keep my number",
      "I don't want to swap numbers anymore", "actually I don't want to swap numbers", "I changed my mind about sharing my number", "never mind, I'd rather keep my number", "cancel that, keep my number", "I don't want you to send my number", "I don't want them to have my number",
      "I don't mind waiting, but don't send my number yet", "don't worry, cancel the swap", "I don't mind, but I'd rather keep my number", "no worries, I'll keep my number to myself", "no, not my number", "hmm not sure about sharing my number", "please keep my number private"]) expect([t, withdrawsSwap(t)]).toEqual([t, true]);
    expect(d.cancelSwaps("b")).toBe(1);
    h.t += 60_000;
    expect((await d.request({ itemId: "c3", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).toBe("waiting");
    expect(h.sent.some(x => x.contact)).toBe(false);
  });

  await b.run("relay desk: a number swap never goes one way: a refused first share stops the second, and neither is logged as shared", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    h.send = (to, body, o) => { if (o.contact && to === "b") return "refused"; h.sent.push({ to, body, key: o.key, ...(o.contact ? { contact: o.contact } : {}) }); return "sent"; };
    await d.request({ itemId: "c1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    h.t += 60_000;
    expect((await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).toBe("refused");
    expect(h.sent.some(x => x.contact)).toBe(false);
    expect([d.contactShareFrom("relay:c1"), d.contactShareFrom("relay:c2")]).toEqual([undefined, undefined]);
    expect(d.records().filter(r => r.contactShared)).toEqual([]);
    // A replay of either request never answers "Sent.".
    expect((await d.request({ itemId: "c2", from: "b", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).not.toBe("sent");
  });

  await b.run("relay desk: a minor's number (or words) is never relayed; the desk carries no photo", async () => {
    const h = fakeHost({ members: { a: { age: undefined } } }), d = new RelayDesk(h);
    const r = await d.request({ itemId: "p1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
    expect(r.decision).toBe("refused");
    const t = await d.request({ itemId: "t1", from: "a", kind: "text", text: "hey!" }, { hook: simulatedRelayClassifier });
    expect(t.decision).toBe("refused");
    expect(h.sent).toEqual([]);
    const h2 = fakeHost(), d2 = new RelayDesk(h2);
    const said = await d2.request({ itemId: "t2", from: "a", kind: "text", text: "im 16 is that ok" }, { hook: simulatedRelayClassifier });
    expect(said).toEqual({ itemId: "t2", decision: "refused", reason: "I didn't send that, so it didn't reach them." });
    expect(d2.records()[0]!.ageSignal).toBe(true);
    expect(h2.minorSignals).toEqual(["a"]);
    expect(h2.severeBlocks).toEqual([]);
    expect(h2.sent).toEqual([]);
    const h3 = fakeHost(), d3 = new RelayDesk(h3);
    const plain = await d3.request({ itemId: "p2", from: "a", kind: "text", text: "see you at 7!" }, { hook: simulatedRelayClassifier });
    expect(plain.decision).toBe("sent");
    expect(h3.sent.map(x => x.key)).toEqual(["relay:p2"]);
    expect(h3.sendOptions).toEqual([["from", "key", "matchId"]]);
  });

  await b.run("relay desk: a minor signal that only the classifier finds starts the minors policy at once, blocks the text and keeps no text", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const hook = async () => ({ flags: ["minor_signal"] });
    const r = await d.request({ itemId: "m1", from: "a", kind: "text", text: "see you saturday, cant wait" }, { hook });
    expect(r).toEqual({ itemId: "m1", decision: "refused", reason: "I didn't send that, so it didn't reach them." });
    expect(h.sent).toEqual([]);
    expect(h.minorSignals).toEqual(["a"]);
    expect(JSON.stringify(d.exportState())).not.toContain("saturday");
    expect(d.records().at(-1)).toMatchObject({ ageSignal: true });
    expect(d.records().at(-1)!.reasons).toContain("clef:minor_signal");
    await d.request({ itemId: "m2", from: "a", kind: "text", text: "see you sunday then" }, { hook });
    expect(h.minorSignals).toEqual(["a"]);
  });

  await b.run("relay desk: a minor age in the sender's own words starts the minors policy; the age of the sender's child or relative blocks the text only", async () => {
    const rows: [string, boolean][] = [
      ["my 15yo ass is tired lol", true], ["my 16 y/o heart cant take this", true], ["my 16 year old self is nervous", true],
      ["ur 16 yo bf says hi", true], ["your 15 y/o date is on the way", true], ["my 16 year old body is sore", true],
      ["tell them I heard her say, \"I'm 16\"", true], ["homeroom starts soon", true],
      ["my 15 year old will be with me", false], ["my 15yo son is coming too", false], ["her 16 yo brother will drive", false], ["bringing my 16 year old.", false],
    ];
    for (const [i, [t, starts]] of rows.entries()) {
      const h = fakeHost(), d = new RelayDesk(h);
      const r = await d.request({ itemId: `s${i}`, from: "a", kind: "text", text: t }, { hook: simulatedRelayClassifier });
      expect([t, r.decision, h.minorSignals, h.sent]).toEqual([t, "refused", starts ? ["a"] : [], []]);
    }
  });

  await b.run("relay desk: a block for the sender's severe words reaches the sender's safety case at once; a block for other reasons does not", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    expect((await d.request({ itemId: "v1", from: "a", kind: "text", text: "can you venmo me 200 for the tickets? my card got frozen" }, { hook: simulatedRelayClassifier })).decision).toBe("refused");
    expect(h.severeBlocks).toEqual([]);
    expect((await d.request({ itemId: "v2", from: "a", kind: "text", text: "answer me or else, watch your back" }, { hook: simulatedRelayClassifier })).decision).toBe("refused");
    expect(h.severeBlocks).toEqual(["a"]);
    expect(h.minorSignals).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  await b.run("relay desk: appearance and rating talk never passes on an app that rates photos", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    for (const [i, t] of ["you two have similar looks apparently", "what did the app rate me?", "you seem petite, love that"].entries()) {
      const r = await d.request({ itemId: `a${i}`, from: "a", kind: "text", text: t }, { hook: simulatedRelayClassifier });
      expect([t, r.decision, r.reason]).toEqual([t, "refused", "I didn't send that. I can't share anything like that, and I don't pass questions about it on."]);
    }
    expect(h.sent).toEqual([]);
    expect(d.records().every(r => r.reasons.some(x => x.startsWith("rating:")))).toBe(true);
  });

  await b.run("relay desk: a burst is rate-limited (blocked with the rate notice) and the limit survives a restart", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    for (let i = 0; i < 6; i++) { h.t += 1000; expect((await d.request({ itemId: `r${i}`, from: "a", kind: "text", text: `see you at ${i + 1}` }, { hook: simulatedRelayClassifier })).decision).toBe("sent"); }
    const saved = d.exportState();
    const d2 = new RelayDesk(h);
    d2.importState(JSON.parse(JSON.stringify(saved)));
    h.t += 1000;
    const r = await d2.request({ itemId: "r6", from: "a", kind: "text", text: "one more thing" }, { hook: simulatedRelayClassifier });
    expect(r).toEqual({ itemId: "r6", decision: "refused", reason: "I didn't send that: you've sent a lot in a short time. Please try again a bit later." });
    expect(d2.records().at(-1)!.reasons).toEqual(["rate:burst"]);
    h.t += 11 * 60_000;
    expect((await d2.request({ itemId: "r7", from: "a", kind: "text", text: "ok last one" }, { hook: simulatedRelayClassifier })).decision).toBe("sent");
  });

  await b.run("relay desk: private facts of the other member, a closed match and no match are refused", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    expect((await d.request({ itemId: "l1", from: "a", kind: "text", text: "do you still work at Halcyon Biotech?" }, { hook: simulatedRelayClassifier })).decision).not.toBe("sent");
    h.match = { ...h.match, status: "cancelled" };
    expect((await d.request({ itemId: "l2", from: "a", kind: "text", text: "hi" }, { hook: simulatedRelayClassifier })).decision).toBe("refused");
    h.match = { ...h.match, status: "closed" };
    expect((await d.request({ itemId: "l3", from: "a", kind: "text", text: "hi" }, { hook: simulatedRelayClassifier })).decision).toBe("refused");
    expect(h.sent).toEqual([]);
  });

  // Founder decision 2026-10-11 (#22, P7): a persistent thread. The week-after-the-date expiry is gone.
  await b.run("relay desk: the thread persists after the date (a text 8 days after the meeting is sent)", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    h.match = { ...h.match, status: "mutual", metAt: NOW - 8 * 86_400_000 };
    expect((await d.request({ itemId: "p1", from: "a", kind: "text", text: "want to get dinner again next week?" }, { hook: simulatedRelayClassifier })).decision).toBe("sent");
  });

  await b.run("relay desk: arrival-window safety ([-30, +45]m) and panic exit immediately halt relays and cancel pending swaps", async () => {
    const h = fakeHost(), d = new RelayDesk(h);
    const startMs = NOW + 20 * 60_000;
    const baseArrival = {
      matchId: "op1", senderId: "a", recipientId: "b",
      senderConfirmed: true, recipientConfirmed: true,
      startMs, alreadyMet: false, passedSafetyAndLeakCheck: true,
    };
    // Inside [-30, +45]m arrival window (T-20m, T+0m, T+40m) -> allowed
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(true);
    h.t = startMs;
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(true);
    h.t = startMs + 40 * 60_000;
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(true);
    // Outside arrival window (T-31m, T+46m) -> blocked
    h.t = startMs - 31 * 60_000;
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(false);
    h.t = startMs + 46 * 60_000;
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(false);
    // Back inside window: minor, unconfirmed, or failed leak check -> blocked
    h.t = startMs - 10 * 60_000;
    expect(d.canRelayArrivalSafe({ ...baseArrival, anyMinorInEvent: true })).toBe(false);
    expect(d.canRelayArrivalSafe({ ...baseArrival, senderConfirmed: false })).toBe(false);
    expect(d.canRelayArrivalSafe({ ...baseArrival, passedSafetyAndLeakCheck: false })).toBe(false);
    // Queue a pending contact swap, then trigger panic exit
    expect((await d.request({ itemId: "pw1", from: "a", kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier })).decision).toBe("waiting");
    const sentBeforePanic = h.sent.length;
    const panic = d.triggerPanicExit("a", "op1");
    expect(panic.haltedMatches).toContain("op1");
    expect(panic.cancelledSwaps).toBeGreaterThanOrEqual(1);
    expect(panic.notice).toMatch(/911/);
    expect(d.isPanicTriggered("a", "op1")).toBe(true);
    expect(d.canRelayArrivalSafe(baseArrival)).toBe(false);
    // Both sides are immediately halted for subsequent texts and swaps
    const rA = await d.request({ itemId: "pa1", from: "a", kind: "text", text: "still here?" }, { hook: simulatedRelayClassifier });
    const rB = await d.request({ itemId: "pb1", from: "b", kind: "text", text: "where are you?" }, { hook: simulatedRelayClassifier });
    expect([rA.decision, rB.decision]).toEqual(["refused", "refused"]);
    expect(h.sent.length).toBe(sentBeforePanic);
  });

  await b.run("vampire_pitch_slap_defense: pitch-slaps block, internal ranking leaks block, newcomers stay clean, and vampire tiers throttle/quarantine", () => {
    for (const pitch of [
      "Hey, book a free discovery call with me this week!",
      "Check out my startup and join our waitlist!",
      "Use my promo code for 20% off today.",
      "You should hire my agency for growth.",
      "Can I send you my pitch deck before we meet?",
      "We help founders scale and generate leads fast.",
    ]) {
      const r = relayItem(text(pitch), baseCtx());
      expect([pitch, r.decision, r.rendered]).toEqual([pitch, "block", ""]);
      expect(r.reasons).toContain("promo:pitch_slap");
    }
    for (const okText of [
      "I'm building a small tools startup and love bouldering.",
      "I run a design studio in Brooklyn, want to grab coffee Thursday?",
      "Would love to hear what you're working on this month.",
    ]) {
      expect([okText, relayItem(text(okText), baseCtx()).decision]).toEqual([okText, "pass"]);
    }

    for (const leak of [
      "You're out of your league with this person.",
      "Their status score is 88.",
      "Your wealth tier doesn't match theirs.",
      "Looks rating 8/10 on our internal scale.",
      "This account is in vampire tier.",
      "High extraction risk score flagged.",
      "SpringRank standing is 92.",
    ]) {
      const coreLeaks = findLeaks(leak, {});
      expect([leak, coreLeaks.includes("internal:ranking")]).toEqual([leak, true]);
      const judgeCheck = checkMemberFacing(leak, new Set());
      expect([leak, judgeCheck.ok, judgeCheck.reasons.includes("internal_ranking_leak")]).toEqual([leak, false, true]);
    }
    for (const benign of [
      "Do you play in a weekend soccer league?",
      "Your membership status is paused until Friday.",
      "We were standing in line at the coffee shop.",
    ]) {
      expect([benign, findLeaks(benign, {})]).toEqual([benign, []]);
      expect([benign, checkMemberFacing(benign, new Set()).ok]).toEqual([benign, true]);
    }

    expect(lawNewcomerNeverThrottledWithoutPitch(2, 0, 2)).toBe(true);
    expect(vampireTier(2, 0, 2, 0, 0)).toBe("VampireClean");
    expect(vampireTier(0, 0, 0, 1, 0)).toBe("VampireWatch");
    expect(vampireWeeklyCap("VampireWatch", 4)).toBe(2);
    expect(vampireAllowedTarget("VampireWatch", true, false)).toBe(false);
    expect(vampireAllowedTarget("VampireWatch", false, false)).toBe(true);

    expect(vampireTier(0, 0, 0, 2, 0)).toBe("VampireThrottled");
    expect(vampireTier(0, 0, 0, 0, 1)).toBe("VampireThrottled");
    expect(vampireWeeklyCap("VampireThrottled", 4)).toBe(1);
    expect(vampireAllowedTarget("VampireThrottled", true, false)).toBe(false);
    expect(vampireAllowedTarget("VampireThrottled", false, true)).toBe(false);
    expect(vampireAllowedTarget("VampireThrottled", false, false)).toBe(true);

    expect(vampireTier(0, 0, 0, 0, 2)).toBe("VampireQuarantined");
    expect(vampireTier(0, 0, 0, 4, 0)).toBe("VampireQuarantined");
    expect(vampireWeeklyCap("VampireQuarantined", 4)).toBe(0);
    expect(vampireAllowedTarget("VampireQuarantined", false, false)).toBe(false);

    const w = new EngineWorld({
      ...emptyInput(NOW),
      members: [
        baseMember("watch", { age: 31, homeCity: "nyc", joinedAt: NOW - 40 * DAY }),
        baseMember("throttled", { age: 31, homeCity: "nyc", joinedAt: NOW - 40 * DAY }),
        baseMember("quarantined", { age: 31, homeCity: "nyc", joinedAt: NOW - 40 * DAY }),
        baseMember("vip", { age: 35, homeCity: "nyc", joinedAt: NOW - 90 * DAY }),
        baseMember("newbie", { age: 27, homeCity: "nyc", joinedAt: NOW - 3 * DAY }),
        baseMember("regular", { age: 30, homeCity: "nyc", joinedAt: NOW - 60 * DAY }),
      ],
      vampireByMember: {
        watch: { introsReceived90d: 1, positiveCounterpartVotes90d: 0, asymmetricNegativeVotes90d: 0, pitchSignals90d: 1, distinctSelfPromoReports90d: 0 },
        throttled: { introsReceived90d: 2, positiveCounterpartVotes90d: 0, asymmetricNegativeVotes90d: 1, pitchSignals90d: 2, distinctSelfPromoReports90d: 1 },
        quarantined: { introsReceived90d: 4, positiveCounterpartVotes90d: 0, asymmetricNegativeVotes90d: 3, pitchSignals90d: 4, distinctSelfPromoReports90d: 2 },
      },
    }, resolveConfig({ cities: ["nyc"] }), localEmbed, networkPack);

    expect(memberVampireTierOf(w, "watch")).toBe("VampireWatch");
    expect(memberVampireTierOf(w, "throttled")).toBe("VampireThrottled");
    expect(memberVampireTierOf(w, "quarantined")).toBe("VampireQuarantined");
    expect(pairLeagueAndVampireReason(w, "watch", "vip", "Intro", 50, 88)).toBe("vampire_target_blocked");
    expect(pairLeagueAndVampireReason(w, "throttled", "newbie", "Intro", 50, 50)).toBe("vampire_target_blocked");
    expect(pairLeagueAndVampireReason(w, "quarantined", "regular", "Intro", 50, 50)).toBe("vampire_quarantine");
  });

  await b.run("photo ids: every platform-issued id is opaque; phone-number-like ids still fail", () => {
    for (let i = 0; i < 10_000; i++) { const id = newPhotoId(); if (!isOpaquePhotoId(id)) throw new Error(`issued id ${id} fails isOpaquePhotoId`); }
    for (const bad of ["ph_2125550147", "212-555-0147", "ph_12125550147abcd", "https://x.test/p.jpg", "+12125550147"]) expect([bad, isOpaquePhotoId(bad)]).toEqual([bad, false]);
  });
}

// ------------------------------------------------------------------------------------ adversarial
const ADV_SEEDS = [13, 14, 15, 16];
const ADV_MIN: Record<AdversarialResult["scenario"], number> = { scam_after_reveal: 200, swap_before_yes: 1000, leak_other_member: 400, minor_in_relay: 400, photo_in_probe: 1500, catfish_photos: 1000, probing_asks: 2000 };
const ADV_NAME: Record<AdversarialResult["scenario"], string> = {
  scam_after_reveal: "scam after the reveal: scammer reach <= 1 scam item, a sender hold, then nothing delivered from them",
  swap_before_yes: "number swap (share, number in text, photo) before both yeses: every item blocked, no number in the output or the log",
  leak_other_member: "leak of the other member's details (full name, number, private fact, canary): none delivered, stopped by the leak guard, a canary blocks",
  minor_in_relay: "minor in the relay (age slip, declared minor, unknown age): the slip blocks, then every item both ways blocked",
  photo_in_probe: "photo in the probe with no photo ids, no consent, a minor or a held member: never a photo or the photo line; relayed photo never passes",
  catfish_photos: "catfish photos (the match's, a third member's, an unowned id, one smuggled among the sender's own): never delivered, never a partial set; the sender's own photo passes",
  probing_asks: "probing asks (how hot did you rate me, prompt injection for a number or rating, fishing for the match's contact or address): every ask blocked with its family, nothing delivered; friendly text passes",
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

  await b.run("relay adversarial (live path): the slop probe hook never attaches a photo (adults, minors, unknown ages; probeCarriesNoPhoto)", () => {
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

  await b.run("relay adversarial (live path): the desk refuses a number swap before both yeses, and blocks a scam after the reveal without sending", async () => {
    for (const [status, acceptedBy] of [["probing", []], ["probing", ["a"]], ["mutual", ["b"]]] as const) {
      const h = fakeHost(), d = new RelayDesk(h);
      h.match = { ...h.match, status, acceptedBy: [...acceptedBy] };
      for (const from of ["a", "b"] as const) {
        const r = await d.request({ itemId: `c-${status}-${acceptedBy.length}-${from}`, from, kind: "contact_share" }, { contactOf, hook: simulatedRelayClassifier });
        expect([status, acceptedBy.length, from, r.decision]).toEqual([status, acceptedBy.length, from, "refused"]);
        const t = await d.request({ itemId: `t-${status}-${acceptedBy.length}-${from}`, from, kind: "text", text: `text me at ${phones[from]!.slice(2, 5)} ${phones[from]!.slice(5, 8)} ${phones[from]!.slice(8)}` }, { hook: simulatedRelayClassifier });
        expect(t.decision).not.toBe("sent");
      }
      expect(h.sent).toEqual([]);
      expect(JSON.stringify(d.records())).not.toContain("555");
    }
    const h = fakeHost(), d = new RelayDesk(h);
    expect((await d.request({ itemId: "h1", from: "a", kind: "text", text: "so glad we matched, see you Saturday" }, { hook: simulatedRelayClassifier })).decision).toBe("sent");
    for (const [i, t] of ["Do you have Telegram? Much easier to chat there.", "My card got frozen, can you send me $200 through cash app until it clears?", "Can you grab two Apple gift cards and send me the codes? I'll explain later."].entries()) {
      h.t += 60_000;
      expect([t, (await d.request({ itemId: `s${i}`, from: "a", kind: "text", text: t }, { hook: simulatedRelayClassifier })).decision]).toEqual([t, "refused"]);
    }
    expect(h.sent.length).toBe(1);
    expect(d.records().filter(r => r.decision === "block").map(r => r.itemId)).toEqual(["s0", "s1", "s2"]);
  });
}
