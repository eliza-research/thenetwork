// The evals block: hand-written corpora (evals/, append-only) scored against the offline parsers.
// Every row was written by hand in members' own words, never by the simulator's templates. A misread
// found in the wild is added to the corpus, then fixed; never delete a row to make a change pass.
//   network/*      the Network's understanding rules (consent replies, abuse, teen ages, wants, areas, negations)
//   replies.jsonl  core parseReply (yes / no / unsure)
//   opt-out*.jsonl the opt-out readers (core parseOptOut; the platform consent ledger's detectKeyword)
//   guard/         the shared leak guard (contacts in disguise, private facts, homoglyphs, benign text)
import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { classifyYesNo, findLeaks, maskPii, parseOptOut, parseReply, type ReplyAnswer } from "../../packages/core/src/index.ts";
import { ageAnswer, birthDateAnswer, birthDateStated, classify, extractProfile, otherAgeStated, parseProbeReply } from "../../packages/network/src/classify.ts";
import { mergeConsent } from "../../packages/network/src/extract.ts";
import { detectKeyword, leaveTarget, optOutPhrase } from "../../packages/platform/src/consent.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { APPS, keywordApp, lookingFor, lookingForReading, type AppId } from "../../packages/platform/src/apps.ts";
import { parseJoinText } from "../../packages/network/service/service.ts";
import { phoneChangeLinkRequest } from "../../packages/network/service/phone-change-link.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { outputLeaks } from "../../packages/mcp/src/leaks.ts";
import { parseReviewJudgeReply } from "../../packages/engine/src/reviewJudge.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { riskTerms } from "../../packages/engine/src/filters.ts";
import { Block, expect } from "./gate.ts";
import { planAgainOf } from "../../packages/network/src/classify.ts";
import { readPhotoMessage, type PhotoReading, type PhotoSlot, type ReaderContext, type ReaderDraft, type ReaderThread } from "../../packages/network/service/photoReference.ts";

const ROOT = `${import.meta.dirname}/../../evals`;
const jsonl = async <T>(name: string): Promise<T[]> => (await fileAt(`${ROOT}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function evalsBlock(b: Block): Promise<void> {
  await b.run("child-care requests recognize stated ages and split transport verbs", () => {
    const cfg = resolveConfig();
    const risky = [
      ...["6yo", "6 y/o", "6 y.o.", "6 y o", "6 y-old", "6 yrs old", "six-year-old", "sixteen-year-old"]
        .map(age => "watch my " + age + " Saturday"),
      "pick my kid up", "who can pick my two kids up", "drop my kid off",
      "dropping the kids off", "drop my 5 y.o. off", "pick up my kid",
    ];
    const benign = ["parents with young kids", "watch my kidney stone symptoms", "watch my 6 y.o. startup",
      "pick a book for my child up", "pick the parcel up", "pick me up at the airport", "dog sitter available"];
    expect(risky.filter(body => riskTerms(cfg, body).length === 0)).toEqual([]);
    expect(benign.filter(body => riskTerms(cfg, body).length > 0)).toEqual([]);
  });

  await b.run("Settings consent: paused is not STOP; global STOP and newer app START project independently", async () => {
    let at = Date.parse("2026-10-09T12:00:00Z");
    const e164 = "+12125550301", store = new MemoryPeopleStore();
    const person = await store.createPerson({id: "consent-projection-person", e164, method: "inbound_message", at, lowestAge: 25});
    const api = createPublicApi({store, env: {PLATFORM_ENV: "dev"}, now: () => at,
      otp: {name: "unused", send: async () => {throw new Error("Consent projection must not send OTP");}}});
    const cookies = new Map<AppId, string>();
    for (const app of ["slop", "friends"] as const) {
      await store.putMembership({app, personId: person.id, memberId: `${app}_consent`, state: "paused", review: null, firstName: "Consent Fixture", profile: {}, joinedAt: at, leftAt: null});
      await api.accounts.recordConsent({e164, app, state: "opted_in", source: "simulation", at});
      const {token} = await api.sessions.create(app, e164, person.id);
      cookies.set(app, `sid_${app}=${token}`);
    }
    const request = async (app: "slop" | "friends", path = "/api/me", body?: object) => {
      const response = (await api.fetch(new Request(`https://${APPS[app].domain}${path}`, {
        method: body ? "POST" : "GET", headers: {host: APPS[app].domain, origin: `https://${APPS[app].domain}`, cookie: cookies.get(app)!, "content-type": "application/json"},
        ...(body ? {body: JSON.stringify(body)} : {}),
      })))!;
      expect(response.status).toBe(200);
      return await response.json() as {smsOptedIn: boolean; membership: {state: string}};
    };
    const paused = await request("slop");
    expect(paused.membership.state).toBe("paused"); expect(paused.smsOptedIn).toBe(true);
    at++;
    await request("slop", "/api/me/stop", {});
    expect((await request("slop")).smsOptedIn).toBe(false);
    expect((await request("friends")).smsOptedIn).toBe(false);
    at++;
    await api.accounts.recordConsent({e164, app: "friends", state: "opted_in", source: "simulation-app-START", at});
    expect((await request("friends")).smsOptedIn).toBe(true);
    expect((await request("slop")).smsOptedIn).toBe(false);
  });
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

  // spec/probeReply.md, "A suggested alternative needs a separate yes before asking for new times";
  // spec/probeReply.md, "A model reading cannot replace a definite or qualified answer"
  const slots = await jsonl<{ text: string; labels?: string[]; answer: "yes" | "no" | "unclear"; keys: string[] }>("network/probe-offered-slots.jsonl");
  const wrongSlots = slots.filter(row => {
    const options = row.labels?.map((label, i) => ({ key: OPTIONS[i]!.key, label, start: i, end: i + 1 })) ?? OPTIONS;
    const reply = parseProbeReply(row.text, options);
    if (reply.answer !== row.answer || JSON.stringify(reply.keys) !== JSON.stringify(row.keys)) return true;
    // An ambiguous, unoffered or counter-offered time stays unclear: a model yes for an offered key cannot replace it.
    if (row.answer === "unclear") {
      const merged = mergeConsent(reply, { consent: "yes", times: options.slice(0, 1).map(o => o.key), wants: [], notWanted: [], interests: [], skills: [] }, options);
      return merged.answer !== "unclear";
    }
    return false;
  });
  b.gate("probe replies keep accepted, ambiguous and unoffered times distinct", slots.length >= 25 && wrongSlots.length === 0,
    wrongSlots.map(row => row.text).join(" | "));

  const benign = (await fileAt(`${ROOT}/network/benign-adult.txt`).text()).trim().split("\n");
  const flagged = benign.filter(t => classify(t).abuse.length);
  b.gate(`benign adult phrasing: precision >= 99% (n ${benign.length})`, benign.length >= 200 && 1 - flagged.length / benign.length >= 0.99, pct(1 - flagged.length / benign.length));
  const benignMinor = benign.filter(t => classify(t).minorSignal);
  b.gate("benign adult phrasing: 0 minor signals", benignMinor.length === 0, benignMinor.slice(0, 5).join(" | "));

  const abuse = await jsonl<{ text: string; kind: string }>("network/abuse.jsonl");
  const caught = abuse.filter(l => classify(l.text).abuse.length);
  const wrongKind = abuse.filter(l => classify(l.text).abuse.length && !classify(l.text).abuse.includes(l.kind as never));
  b.gate(`abuse: recall >= 95% (n ${abuse.length})`, abuse.length >= 100 && caught.length / abuse.length >= 0.95, pct(caught.length / abuse.length));
  b.gate("abuse: wrong kind <= 5%", wrongKind.length / abuse.length <= 0.05, pct(wrongKind.length / abuse.length));
  // Phones type a curly apostrophe by default ("can’t", "what’s"): every row reads the same with it.
  const readAs = (t: string) => { const c = classify(t); return JSON.stringify([c.kind, [...c.abuse].sort(), c.minorSignal, c.statedAge ?? null, c.desireId ?? null, c.target ?? null]); };
  const benignLines = benign.map(text => ({ text }));
  const replyLines = await jsonl<{ text: string }>("replies.jsonl");
  const apos = [...abuse, ...benignLines, ...replyLines].filter(l => l.text.includes("'"));
  const curlyMiss = apos.filter(l => readAs(l.text.replace(/'/g, "’")) !== readAs(l.text)).map(l => `${JSON.stringify(l.text.replace(/'/g, "’"))} -> ${readAs(l.text.replace(/'/g, "’"))}`);
  b.gate(`curly apostrophes (n ${apos.length} rows with '): classify reads every row the same with ’`, apos.length >= 100 && curlyMiss.length === 0, curlyMiss.slice(0, 5).join("; "));

  const teen = await jsonl<{ text: string; teen?: boolean; other?: number | null; age?: number }>("network/teen-age.jsonl");
  const minor = (t: string) => { const c = classify(t); return c.minorSignal || (c.statedAge !== undefined && c.statedAge < 18); };
  const teens = teen.filter(l => l.teen === true), adults = teen.filter(l => l.teen === false);
  b.gate(`teen ages: recall >= 95% (n ${teen.length})`, teen.length >= 150 && teens.filter(l => minor(l.text)).length / teens.length >= 0.95, pct(teens.filter(l => minor(l.text)).length / teens.length));
  const adultAsMinor = adults.filter(l => minor(l.text)).map(l => l.text);
  b.gate("teen ages: 0 adults (or teachers) read as minors", adultAsMinor.length === 0, adultAsMinor.slice(0, 5).join(" | "));
  const thirdParty = teen.filter(l => l.other !== undefined && (otherAgeStated(l.text) ?? null) !== (l.other ?? null)).map(l => l.text);
  b.gate("third-party ages are read exactly", thirdParty.length === 0, thirdParty.slice(0, 5).join(" | "));
  const statedMiss = teen.filter(l => l.age !== undefined && classify(l.text).statedAge !== l.age).map(l => `${JSON.stringify(l.text)} -> ${classify(l.text).statedAge ?? "none"} (want ${l.age})`);
  b.gate("stated ages: the youngest real age in the message", statedMiss.length === 0, statedMiss.slice(0, 5).join(" | "));

  const ageAnswers = await jsonl<{ text: string; age: number | null }>("network/age-answers.jsonl");
  const wrongAgeAnswers = ageAnswers.filter(row => (ageAnswer(row.text) ?? null) !== row.age);
  b.gate(`the age question accepts spelled-out answers (n ${ageAnswers.length})`, wrongAgeAnswers.length === 0,
    wrongAgeAnswers.slice(0, 5).map(row => row.text).join("; "));

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
  // spec/planFormation.md, "A known trip must fit the member's travel limit"
  await b.run("areas: recognize Fort Greene's abbreviations in a member's home area", () => {
    const inputs = ["based in Ft Greene", "I'm in ft. greene", "live in ft greene near the park",
      "I live in Fort Greene", "I work in Ft. Greene", "I live in Ft. Green"];
    expect(inputs.map(text => extractProfile(text).area))
      .toEqual(["Fort Greene", "Fort Greene", "Fort Greene", "Fort Greene", undefined, undefined]);
  });

  const neg = await jsonl<{ text: string }>("network/negations.jsonl");
  const negBad = neg.filter(l => { const x = extractProfile(l.text); return x.desireIds.length || x.interests.length || classify(l.text).kind === "people_request"; }).map(l => l.text);
  b.gate(`negated wants (n ${neg.length}): 0 read as a want, interest or request`, neg.length >= 100 && negBad.length === 0, negBad.slice(0, 5).join(" | "));
  await b.run("negated wants: contrast clauses after 'anything but' keep positive wants", () => {
    expect(extractProfile("open to anything but would love to meet founders").desireIds).toContain("meet_founders");
    expect(extractProfile("down for anything, but mostly looking for founders").desireIds).toContain("meet_founders");
    expect(extractProfile("I'm open to anything but I'd love to meet founders").desireIds).toContain("meet_founders");
    expect(extractProfile("I don't want anything but dating").notWanted).not.toContain("dating");
    expect(extractProfile("anything but dating").notWanted).toContain("dating");
  });

  const again = await jsonl<{ text: string; label: "yes" | "no" | "unclear" }>("network/plan-again.jsonl");
  const againMiss = again.filter(l => planAgainOf(l.text) !== l.label).map(l => `${JSON.stringify(l.text)} -> ${planAgainOf(l.text)} (want ${l.label})`);
  b.gate(`plan again answers (n ${again.length}): every row read as labelled`, again.length >= 40 && againMiss.length === 0, againMiss.slice(0, 5).join("; "));

  const phoneLink = await jsonl<{ text: string; request: boolean }>("network/phone-change-link.jsonl");
  const phoneLinkMiss = phoneLink.filter(l => phoneChangeLinkRequest(l.text) !== l.request || (l.request && (detectKeyword(l.text) !== undefined || leaveTarget(l.text) !== undefined)))
    .map(l => `${JSON.stringify(l.text)} -> ${phoneChangeLinkRequest(l.text)} (want ${l.request})`);
  b.gate(`phone change link requests (n ${phoneLink.length}): every row read as labelled, and no request is a carrier keyword or an app leave`, phoneLink.length >= 25 && phoneLinkMiss.length === 0, phoneLinkMiss.slice(0, 5).join("; "));

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
    for (const [t, app] of [["stop slop", "slop"], ["quit slop", "slop"], ["Stop slop.date", "slop"], ["unsubscribe from peon", "peon"], ["cancel friends.help", "friends"], ["exit peon.biz", "peon"], ["leave the network", "ntwrk"],
      // A courtesy or urgency word at the end does not change which app the person asked to leave, and it
      // must never turn "leave one app" into a stop of every app ("unsubscribe from slop now" used to read as STOP).
      ["leave slop now", "slop"], ["unsubscribe from slop now", "slop"], ["quit peon now", "peon"], ["exit friends now", "friends"], ["leave the network now", "ntwrk"], ["leave slop asap", "slop"], ["leave slop now please", "slop"], ["leave slop thanks", "slop"]] as const) {
      expect([t, detectKeyword(t) ?? null, leaveTarget(t) ?? null]).toEqual([t, null, app]);
    }
    for (const t of ["cancel the date", "stop by at 7", "quit my job", "I have to leave early", "leave slop alone lol", "leave the party now", "quit smoking now", "exit the building now"]) expect([t, leaveTarget(t) ?? null]).toEqual([t, null]);
    expect(optOutPhrase(`${"I had a long day at work and the train was late again. ".repeat(3)}stop texting me`)).toBe(false);
  });
  await b.run("platform lookingFor: 'all apps'/'everything' joins every app; a bare 'all' does not", () => {
    const sorted = (t: string) => [...lookingFor(t)].sort();
    // Explicit "every app" answers still enroll in all three (founder decision 2).
    for (const t of ["I want everything", "all three", "give me all of them", "all apps please"]) expect([t, sorted(t)]).toEqual([t, ["friends", "peon", "slop"]]);
    // A stray "all" is not a request to join dating and work: an opt-out answer must never enroll anyone.
    expect(["not interested at all", sorted("not interested at all")]).toEqual(["not interested at all", []]);
    expect(["just friends, that's all", sorted("just friends, that's all")]).toEqual(["just friends, that's all", ["friends"]]);
    // A negated "all apps"/"everything" answer must not enroll anyone (the all-apps branch obeys the negation guard).
    for (const t of ["I don't want all apps", "not everything", "dont want all of them", "without all apps"]) expect([t, sorted(t)]).toEqual([t, []]);
    expect([sorted("all apps except dating"), sorted("all of these but work")]).toEqual([["friends", "peon"], ["friends", "slop"]]);
  });

  type Routing = { kind: "first" | "join" | "lookingFor"; text: string; reading: Record<string, unknown> };
  const routing = await jsonl<Routing>("network/line-routing.jsonl");
  const lineCommand = { stop: "LineStop", stop_all: "LineStop", help: "LineHelp", start: "LineStart" } as const;
  const routingReading = (row: Routing): Record<string, unknown> => {
    if (row.kind === "first") {
      const keyword = detectKeyword(row.text);
      return { command: keyword ? lineCommand[keyword] : "LineNoCommand", app: keywordApp(row.text) ?? null };
    }
    if (row.kind === "join") {
      const said = parseJoinText(row.text, APP_WORDS, true, BIRTHDAY_DAY);
      return { age: said.age ?? null, ...("name" in row.reading ? { name: said.name } : {}) };
    }
    return { ...lookingForReading(row.text) };
  };
  const routingMiss = routing.filter(row => JSON.stringify(routingReading(row)) !== JSON.stringify(row.reading))
    .map(row => `${row.kind} ${JSON.stringify(row.text)} -> ${JSON.stringify(routingReading(row))}`);
  const routingKinds = (["first", "join", "lookingFor"] as const).map(kind => routing.filter(row => row.kind === kind).length);
  b.gate(`shared-line routing readings (n ${routing.length}): every row read as labelled`,
    routing.length >= 60 && routingKinds.every(n => n >= 15) && routingMiss.length === 0, routingMiss.slice(0, 5).join("; "));
  await birthdayBlock(b);
  await photoReferenceBlock(b);

  // ---- leak guard ------------------------------------------------------------------------------------
  type G = { text: string; want: "contact" | "leak" | "clean"; note: string; facts?: string[]; forbidden?: string[]; privateVocab?: string[]; canaries?: string[]; allow?: string[]; publicPhrases?: string[]; contacts?: boolean };
  const guard = await jsonl<G>("guard/leaks.jsonl");
  const guardMiss = guard.filter(({ text, want, note: _n, ...opts }) => {
    const r = findLeaks(text, opts);
    return want === "contact" ? !r.some(x => x.startsWith("contact:")) : want === "leak" ? r.length === 0 : r.length > 0;
  }).map(r => `${r.want}: ${JSON.stringify(r.text)} (${r.note})`);
  b.gate(`leak guard (n ${guard.length}): evasions caught, benign text clean`, guardMiss.length === 0, guardMiss.slice(0, 5).join("; "));

  const contactRows = guard.filter(row => row.want === "contact");
  const unmasked = contactRows.filter(row => findLeaks(maskPii(row.text)).some(reason => reason.startsWith("contact:")));
  const profile = maskPii("I am 31 and I like climbing. My email is m a y a at g m a i l dot c o m.");
  b.gate(`model input privacy (n ${contactRows.length}): contact hidden, nearby profile facts kept`,
    unmasked.length === 0 && /i am 31 and i like climbing/i.test(profile) && !findLeaks(profile).some(reason => reason.startsWith("contact:")),
    `${unmasked.length} contact rows unmasked`);

  await b.run("MCP output gate: update summaries with a phone, email, internal id or timestamp are withheld; plain ones pass", () => {
    for (const t of [
      "call me at (415) 555-0102",
      "call me at 555-0102",
      "call two one two five five five zero one zero two",
      "call ٢١٢-٥٥٥-٠١٠٢",
      "text 212·555·0102",
      "Maya's cell #4155550102",
      "Maya id: 4155550102",
      "Maya: case +14155550102",
      "maya [at] example [dot] test",
      "sam[@]example[.]com",
      "sam<at>example<dot>com",
      "sam at gmail",
      "sam . lee @ example . com",
      "your match is mem_8f2k1",
      "meeting at 2026-10-08T19:30",
      "sam@example.com",
    ]) expect(outputLeaks(t).length).toBeGreaterThan(0);
    for (const t of [
      "Someone nearby wants to play tennis this weekend. Reply in the text thread.",
      "Your plan is booked: Saturday 11 AM at McCarren Park (Williamsburg).",
      "Open https://peon.biz to review your profile.",
      "Nothing new right now.",
    ]) expect(outputLeaks(t)).toEqual([]);
    expect(outputLeaks("she is going through a divorce", { facts: ["is going through a divorce"] }).length).toBeGreaterThan(0);
  });

  const judgeReplies = await jsonl<{ kind: string; rubric: "adult" | "minor"; reply: string; verdict: string; reason: string }>("review/judge-replies.jsonl");
  const judgeMiss = judgeReplies.map(row => ({ row, read: parseReviewJudgeReply(row.reply, row.rubric) }))
    .filter(({ row, read }) => read.verdict !== row.verdict || read.reason !== row.reason || (row.reason === "unparseable" && read.explanation !== ""))
    .map(({ row, read }) => `${row.kind} (${row.rubric}) -> ${read.verdict}/${read.reason} (want ${row.verdict}/${row.reason})`);
  b.gate(`review judge parser: every row (n ${judgeReplies.length})`, judgeReplies.length >= 48 && judgeMiss.length === 0, judgeMiss.slice(0, 5).join("; "));
}

const BIRTHDAY_DAY = 20261122;
const APP_WORDS = Object.values(APPS).flatMap(a => [a.id, ...a.domain.split(".")]);

type BirthdayRow =
  | { kind: "answer" | "stated"; text: string; birthDate: number | null }
  | { kind: "join"; text: string; reading: { age: number | null; birthDate: number | null; name: string | null } }
  | { kind: "self"; text: string; oldestAge: number | null };

async function birthdayBlock(b: Block): Promise<void> {
  const rows = await jsonl<BirthdayRow>("birthdays.jsonl");
  const reading = (row: BirthdayRow): unknown => {
    if (row.kind === "answer") return birthDateAnswer(row.text, BIRTHDAY_DAY) ?? null;
    if (row.kind === "stated") return birthDateStated(row.text, BIRTHDAY_DAY) ?? null;
    if (row.kind === "self") return classify(row.text).oldestAge ?? null;
    const said = parseJoinText(row.text, APP_WORDS, true, BIRTHDAY_DAY);
    return { age: said.age ?? null, birthDate: said.birthDate ?? null, name: said.name ?? null };
  };
  const want = (row: BirthdayRow): unknown => row.kind === "join" ? row.reading : row.kind === "self" ? row.oldestAge : row.birthDate;
  const misses = rows.filter(row => JSON.stringify(reading(row)) !== JSON.stringify(want(row)))
    .map(row => `${row.kind} ${JSON.stringify(row.text)} -> ${JSON.stringify(reading(row))}`);
  const kinds = (["answer", "stated", "join", "self"] as const).map(kind => rows.filter(row => row.kind === kind).length);
  b.gate(`birthday readings (n ${rows.length}): every form read as labelled, two-digit years, impossible and future dates refused`,
    kinds.every(n => n >= 4) && misses.length === 0, misses.slice(0, 5).join("; "));
}

type PhotoReferenceFixture = {
  now: string;
  timeZone: string;
  photos: (Omit<PhotoSlot, "addedAt"> & { addedAt: string })[];
  threads: Record<string, ReaderThread>;
  contexts: Record<string, { threads: string[]; current: string | null; draft: (Omit<ReaderDraft, "recipientMemberId"> & { recipient: string }) | null }>;
};

type PhotoReferenceRow = { ctx: string; text: string; expect: Record<string, unknown> };

function photoReadingView(r: PhotoReading): Record<string, unknown> {
  switch (r.kind) {
    case "send":
      return { kind: r.kind, pick: r.result.pick, numbers: r.numbers, thread: r.target.kind === "one" ? r.target.thread.threadId : null,
        recipients: r.target.kind === "one" ? 1 : r.target.recipients, why: r.why, alsoText: r.alsoText, wantsSet: r.wantsSet };
    case "draft":
      return { kind: r.kind, pick: r.result?.pick ?? null, numbers: r.numbers, yes: r.yes, no: r.no, hasReference: r.hasReference, why: r.why, wantsSet: r.wantsSet };
    case "holdings": return { kind: r.kind, firstName: r.firstName };
    case "name": return { kind: r.kind, n: r.n, label: r.label };
    case "name_refused": return { kind: r.kind, reason: r.reason };
    case "delete": return { kind: r.kind, pick: r.result.pick, numbers: r.numbers };
    case "take_back": return { kind: r.kind, thread: r.threadId, numbers: r.numbers };
    case "none": case "ambiguous_match": case "photos_ok": case "no_more_photos": return { kind: r.kind };
    default: { const _exhaustive: never = r; return _exhaustive; }
  }
}

async function photoReferenceBlock(b: Block): Promise<void> {
  const fixture = JSON.parse(await fileAt(`${ROOT}/photo-references.fixture.json`).text()) as PhotoReferenceFixture;
  const rows = await jsonl<PhotoReferenceRow>("photo-references.jsonl");
  const photos = fixture.photos.map(p => ({ ...p, addedAt: Date.parse(p.addedAt) }));
  const contextOf = (name: string): ReaderContext => {
    const c = fixture.contexts[name]!;
    return {
      photos, now: Date.parse(fixture.now), timeZone: fixture.timeZone, threads: c.threads.map(id => fixture.threads[id]!), currentThreadId: c.current,
      draft: c.draft ? { recipientMemberId: fixture.threads[c.draft.recipient]!.recipientMemberId, shown: c.draft.shown, proposed: c.draft.proposed, wantsSet: c.draft.wantsSet, listed: c.draft.listed } : null,
    };
  };
  const misses: string[] = [], guesses: string[] = [], foreign: string[] = [];
  for (const row of rows) {
    const seen = photoReadingView(readPhotoMessage(row.text, contextOf(row.ctx)));
    if (Object.entries(row.expect).some(([key, want]) => JSON.stringify(seen[key] ?? null) !== JSON.stringify(want))) misses.push(`${row.ctx} ${JSON.stringify(row.text)} -> ${JSON.stringify(seen)}`);
    const numbers = (seen.numbers ?? []) as number[];
    if (seen.pick === "ProposePhotos" && seen.wantsSet === false && numbers.length !== 1) guesses.push(`guess ${JSON.stringify(row.text)}`);
    if (numbers.some(n => n < 1 || n > photos.length)) foreign.push(`foreign ${JSON.stringify(row.text)}`);
  }
  b.gate(`photo references (n ${rows.length}): every reference read as labelled, no guess, no foreign photo`,
    rows.length >= 90 && misses.length === 0 && guesses.length === 0 && foreign.length === 0, [...misses, ...guesses, ...foreign].slice(0, 5).join("; "));
}
