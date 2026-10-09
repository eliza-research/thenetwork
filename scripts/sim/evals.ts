// The evals block: hand-written corpora (evals/, append-only) scored against the offline parsers.
// Every row was written by hand in members' own words, never by the simulator's templates. A misread
// found in the wild is added to the corpus, then fixed; never delete a row to make a change pass.
//   network/*      the Network's understanding rules (consent replies, abuse, teen ages, wants, areas, negations)
//   replies.jsonl  core parseReply (yes / no / unsure)
//   opt-out*.jsonl the opt-out readers (core parseOptOut; the platform consent ledger's detectKeyword)
//   guard/         the shared leak guard (contacts in disguise, private facts, homoglyphs, benign text)
//   slop/          slop.date's onboarding parsers (orientation with negations, age ranges, distance, zip)
import { classifyYesNo, findLeaks, parseOptOut, parseReply, type ReplyAnswer } from "../../packages/core/src/index.ts";
import { classify, extractProfile, otherAgeStated, parseProbeReply } from "../../packages/network/src/classify.ts";
import { detectKeyword, leaveTarget, optOutPhrase } from "../../packages/platform/src/consent.ts";
import { outputLeaks } from "../../packages/mcp/src/leaks.ts";
import { parseAgeRange, parseDistance, parseOrientation, parseZip } from "../../packages/network/service/slopParse.ts";
import { Block, expect } from "./gate.ts";

const ROOT = `${import.meta.dir}/../../evals`;
const jsonl = async <T>(name: string): Promise<T[]> => (await Bun.file(`${ROOT}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function evalsBlock(b: Block): Promise<void> {
  // ---- the Network's parser gates (accuracy >= 97%, refusals read as yes = 0) -------------------
  const OPTIONS = [{ key: "a", start: 1, end: 2, label: "Thursday 7pm" }, { key: "b", start: 3, end: 4, label: "Saturday 11am" }, { key: "c", start: 5, end: 6, label: "Sunday 2pm" }];
  for (const file of ["consent-replies.jsonl", "consent-heldout.jsonl"]) {
    const lines = await jsonl<{ text: string; label: "yes" | "no" | "unclear"; keys?: string[] }>(`network/${file}`);
    let ok = 0;
    const notYesAsYes: string[] = [];
    for (const l of lines) {
      const r = parseProbeReply(l.text, OPTIONS);
      if (r.answer === l.label && (!l.keys || JSON.stringify(r.keys) === JSON.stringify(l.keys))) ok++;
      if (l.label !== "yes" && r.answer === "yes") notYesAsYes.push(l.text);
    }
    b.gate(`consent replies ${file}: accuracy >= 97% (n ${lines.length})`, lines.length >= (file === "consent-replies.jsonl" ? 300 : 75) && ok / lines.length >= 0.97, pct(ok / lines.length));
    b.gate(`consent replies ${file}: no refusal or hedge read as yes`, notYesAsYes.length === 0, notYesAsYes.slice(0, 5).join(" | "));
  }

  const benign = (await Bun.file(`${ROOT}/network/benign-adult.txt`).text()).trim().split("\n");
  const flagged = benign.filter(t => classify(t).abuse.length);
  b.gate(`benign adult phrasing: precision >= 99% (n ${benign.length})`, benign.length >= 200 && 1 - flagged.length / benign.length >= 0.99, pct(1 - flagged.length / benign.length));
  const benignMinor = benign.filter(t => classify(t).minorSignal);
  b.gate("benign adult phrasing: 0 minor signals", benignMinor.length === 0, benignMinor.slice(0, 5).join(" | "));

  const abuse = await jsonl<{ text: string; kind: string }>("network/abuse.jsonl");
  const caught = abuse.filter(l => classify(l.text).abuse.length);
  const wrongKind = abuse.filter(l => classify(l.text).abuse.length && !classify(l.text).abuse.includes(l.kind as never));
  b.gate(`abuse: recall >= 95% (n ${abuse.length})`, abuse.length >= 100 && caught.length / abuse.length >= 0.95, pct(caught.length / abuse.length));
  b.gate("abuse: wrong kind <= 5%", wrongKind.length / abuse.length <= 0.05, pct(wrongKind.length / abuse.length));

  const teen = await jsonl<{ text: string; teen?: boolean; other?: number | null }>("network/teen-age.jsonl");
  const minor = (t: string) => { const c = classify(t); return c.minorSignal || (c.statedAge !== undefined && c.statedAge < 18); };
  const teens = teen.filter(l => l.teen === true), adults = teen.filter(l => l.teen === false);
  b.gate(`teen ages: recall >= 95% (n ${teen.length})`, teen.length >= 150 && teens.filter(l => minor(l.text)).length / teens.length >= 0.95, pct(teens.filter(l => minor(l.text)).length / teens.length));
  const adultAsMinor = adults.filter(l => minor(l.text)).map(l => l.text);
  b.gate("teen ages: 0 adults (or teachers) read as minors", adultAsMinor.length === 0, adultAsMinor.slice(0, 5).join(" | "));
  const thirdParty = teen.filter(l => l.other !== undefined && (otherAgeStated(l.text) ?? null) !== (l.other ?? null)).map(l => l.text);
  b.gate("third-party ages are read exactly", thirdParty.length === 0, thirdParty.slice(0, 5).join(" | "));

  const para = await jsonl<{ text: string; desire: string | null }>("network/paraphrases.jsonl");
  const ids = [...new Set(para.map(l => l.desire).filter((x): x is string => !!x))];
  const badWants: string[] = [];
  for (const id of ids) {
    const pos = para.filter(l => l.desire === id), neg = para.filter(l => l.desire !== id);
    const recall = pos.filter(l => extractProfile(l.text).desireIds.includes(id)).length / pos.length;
    const fpr = neg.filter(l => extractProfile(l.text).desireIds.includes(id)).length / neg.length;
    if (recall < 0.8 || fpr > 0.05) badWants.push(`${id} recall ${recall.toFixed(2)} fpr ${fpr.toFixed(3)}`);
  }
  b.gate(`wants (${ids.length}): recall >= 0.8 and false positives <= 0.05 each`, ids.length === 20 && badWants.length === 0, badWants.join("; "));

  const areas = await jsonl<{ text: string; area: string | null }>("network/areas.jsonl");
  const known = areas.filter(l => l.area), unknown = areas.filter(l => !l.area);
  const areaRecall = known.filter(l => extractProfile(l.text).area === l.area).length / known.length;
  b.gate(`areas: recall >= 0.9 (n ${areas.length})`, areas.length >= 190 && areaRecall >= 0.9, areaRecall.toFixed(3));
  const defaulted = unknown.filter(l => extractProfile(l.text).area !== undefined).map(l => l.text);
  b.gate("areas: an unknown place is never defaulted", defaulted.length === 0 && extractProfile("I live in Hoboken").areaUnknown === true, defaulted.slice(0, 5).join(" | "));

  const neg = await jsonl<{ text: string }>("network/negations.jsonl");
  const negBad = neg.filter(l => { const x = extractProfile(l.text); return x.desireIds.length || x.interests.length || classify(l.text).kind === "people_request"; }).map(l => l.text);
  b.gate(`negated wants (n ${neg.length}): 0 read as a want, interest or request`, neg.length >= 100 && negBad.length === 0, negBad.slice(0, 5).join(" | "));

  // ---- core reply parser -------------------------------------------------------------------------
  const replies = await jsonl<{ text: string; label: ReplyAnswer }>("replies.jsonl");
  const replyMiss = replies.filter(r => classifyYesNo(r.text) !== r.label).map(r => `${JSON.stringify(r.text)} -> ${classifyYesNo(r.text)} (want ${r.label})`);
  b.gate(`core replies (n ${replies.length}): every row read as labelled`, replies.length >= 100 && replyMiss.length === 0, replyMiss.slice(0, 5).join("; "));
  const negs = replies.filter(r => r.label !== "yes" && /\b(not|no|n't|nah|nope|maybe|sure\.\.\.)\b/i.test(r.text));
  b.gate("core replies: no negated or hedged reply read as yes", negs.every(r => classifyYesNo(r.text) !== "yes"));
  await b.run("core replies: reason never carries member text; constraints and counters", () => {
    for (const r of replies) expect(parseReply(r.text).reason).toMatch(/^[a-z_]+$/);
    expect(parseReply("yes but not Thursday").constraints).toEqual([{ kind: "time", text: "not thursday" }]);
    expect(parseReply("sure, but only with a woman")).toMatchObject({ answer: "unsure", leaning: "yes" });
    expect(parseReply("Can't this week, maybe another time.")).toMatchObject({ answer: "no", counter: true });
  });

  // ---- opt-out (core parseOptOut and the platform consent ledger) --------------------------------
  const parse = await jsonl<{ text: string; match: "exact" | "likely" | "none" }>("opt-out-parse.jsonl");
  const parseMiss = parse.filter(r => parseOptOut(r.text).match !== r.match).map(r => `${JSON.stringify(r.text)} -> ${parseOptOut(r.text).match}`);
  b.gate(`core parseOptOut (n ${parse.length}): every row read as labelled`, parseMiss.length === 0, parseMiss.join("; "));
  await b.run("core parseOptOut: leave <app> is app-scoped; Spanish is tagged", () => {
    expect(parseOptOut("leave slop", { apps: ["slop", "ntwrk"] })).toMatchObject({ match: "likely", scope: "app" });
    expect(parseOptOut("STOP", { apps: ["slop"] }).scope).toBe("all");
    expect(parseOptOut("no me escribas").lang).toBe("es");
  });

  const optOut = await jsonl<{ text: string; label: "stop" | "stop_all" | "not_stop"; lang: string }>("opt-out.jsonl");
  const wrong = optOut.filter(c => { const k = detectKeyword(c.text); return c.label === "not_stop" ? k === "stop" || k === "stop_all" : k !== c.label; })
    .map(c => `${c.label}: ${c.text} -> ${detectKeyword(c.text) ?? "none"}`);
  b.gate(`platform opt-out (n ${optOut.length}, en + es): every opt-out line is a STOP, no other line is`,
    optOut.length >= 80 && optOut.filter(c => c.lang === "es" && c.label === "stop").length >= 15 && wrong.length === 0, wrong.slice(0, 5).join("; "));
  await b.run("platform: leave <app> is that app only; a sentence about stopping is not an opt-out", () => {
    for (const [t, app] of [["stop slop", "slop"], ["quit slop", "slop"], ["Stop slop.date", "slop"], ["unsubscribe from peon", "peon"], ["cancel friends.help", "friends"], ["exit peon.biz", "peon"], ["leave the network", "ntwrk"]] as const) {
      expect([t, detectKeyword(t) ?? null, leaveTarget(t) ?? null]).toEqual([t, null, app]);
    }
    for (const t of ["cancel the date", "stop by at 7", "quit my job", "I have to leave early", "leave slop alone lol"]) expect([t, leaveTarget(t) ?? null]).toEqual([t, null]);
    expect(optOutPhrase(`${"I had a long day at work and the train was late again. ".repeat(3)}stop texting me`)).toBe(false);
  });

  // ---- leak guard ------------------------------------------------------------------------------------
  type G = { text: string; want: "contact" | "leak" | "clean"; note: string; facts?: string[]; forbidden?: string[]; privateVocab?: string[]; canaries?: string[]; allow?: string[]; publicPhrases?: string[]; contacts?: boolean };
  const guard = await jsonl<G>("guard/leaks.jsonl");
  const guardMiss = guard.filter(({ text, want, note: _n, ...opts }) => {
    const r = findLeaks(text, opts);
    return want === "contact" ? !r.some(x => x.startsWith("contact:")) : want === "leak" ? r.length === 0 : r.length > 0;
  }).map(r => `${r.want}: ${JSON.stringify(r.text)} (${r.note})`);
  b.gate(`leak guard (n ${guard.length}): evasions caught, benign text clean`, guardMiss.length === 0, guardMiss.slice(0, 5).join("; "));

  // ---- slop.date parsers (a wrong gender or seeking set would match the wrong people: zero allowed) ----
  type O = { text: string; bare: boolean; is: string | null; seeks: string[] | null; negation?: boolean };
  const orient = await jsonl<O>("slop/orientation.jsonl");
  const orientMiss = orient.filter(l => { const r = parseOrientation(l.text, l.bare); return (r.is ?? null) !== l.is || JSON.stringify(r.seeks ?? null) !== JSON.stringify(l.seeks); })
    .map(l => `${JSON.stringify(l.text)} -> ${JSON.stringify(parseOrientation(l.text, l.bare))}`);
  b.gate(`slop orientation (n ${orient.length}, ${orient.filter(l => l.negation).length} negations): 0 wrong gender or seeking`,
    orient.length >= 50 && orient.filter(l => l.negation).length >= 15 && orientMiss.length === 0, orientMiss.slice(0, 5).join("; "));
  const ages = await jsonl<{ text: string; bare: boolean; age?: number; range: [number, number] | null }>("slop/age-range.jsonl");
  const ageMiss = ages.filter(l => JSON.stringify(parseAgeRange(l.text, l.bare, l.age) ?? null) !== JSON.stringify(l.range)).map(l => `${JSON.stringify(l.text)} -> ${JSON.stringify(parseAgeRange(l.text, l.bare, l.age))}`);
  b.gate(`slop age ranges (n ${ages.length}): every range exact`, ages.length >= 30 && ageMiss.length === 0, ageMiss.slice(0, 5).join("; "));
  const dist = await jsonl<{ text: string; bare: boolean; miles?: number | null; city?: boolean }>("slop/distance.jsonl");
  const distMiss = dist.filter(l => {
    const r = parseDistance(l.text, l.bare);
    if (l.city) return !r?.city;
    if (l.miles === null || l.miles === undefined) return r !== undefined;
    return r?.miles === undefined || Math.abs(r.miles - l.miles) > 1;
  }).map(l => `${JSON.stringify(l.text)} -> ${JSON.stringify(parseDistance(l.text, l.bare))}`);
  b.gate(`slop distance (n ${dist.length}): within 1 mile, the city read as the city`, dist.length >= 15 && distMiss.length === 0, distMiss.slice(0, 5).join("; "));
  const zips = await jsonl<{ text: string; zip: string | null }>("slop/zip.jsonl");
  const zipMiss = zips.filter(l => (parseZip(l.text) ?? null) !== l.zip).map(l => `${JSON.stringify(l.text)} -> ${parseZip(l.text)}`);
  b.gate(`slop zip (n ${zips.length}): every zip exact, never part of a longer number`, zips.length >= 10 && zipMiss.length === 0, zipMiss.slice(0, 5).join("; "));

  await b.run("MCP output gate: update summaries with a phone, email, internal id or timestamp are withheld; plain ones pass", () => {
    for (const t of ["call me at (415) 555-0102", "maya [at] example [dot] test", "your match is mem_8f2k1", "meeting at 2026-10-08T19:30", "sam@example.com"]) expect(outputLeaks(t).length).toBeGreaterThan(0);
    for (const t of ["Someone nearby wants to play tennis this weekend. Reply in the text thread.", "Your plan is booked: Saturday 11 AM at McCarren Park (Williamsburg).", "Nothing new right now."]) expect(outputLeaks(t)).toEqual([]);
    expect(outputLeaks("she is going through a divorce", { facts: ["is going through a divorce"] }).length).toBeGreaterThan(0);
  });
}
