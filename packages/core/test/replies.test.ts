// Held-out, human-written corpus for the shared reply parser (audit network-consent-2).
// Written by hand for this test, not by the persona generator: real members do not use the
// simulator's templates. Append new misreads here; never delete a row to make a change pass.
import { describe, expect, test } from "bun:test";
import { classifyYesNo, parseOptOut, parseReply, type ReplyAnswer } from "../src/index.ts";

const Y: ReplyAnswer = "yes", N: ReplyAnswer = "no", U: ReplyAnswer = "unsure";

const CORPUS: [string, ReplyAnswer][] = [
  // plain yes
  ["yes", Y], ["Yes!", Y], ["yesss", Y], ["yeah", Y], ["yea sure", Y], ["yep", Y], ["yup!", Y], ["ya", Y],
  ["sure", Y], ["Sure thing", Y], ["ok", Y], ["okay", Y], ["OK!", Y], ["k", Y], ["kk", Y], ["k.", Y],
  ["absolutely", Y], ["definitely", Y], ["for sure", Y], ["of course!", Y], ["I'm in", Y], ["im in", Y],
  ["count me in", Y], ["I'm down", Y], ["down!", Y], ["sounds good", Y], ["sounds like a plan", Y],
  ["that works", Y], ["works for me", Y], ["perfect", Y], ["love to!", Y], ["I'd love that", Y],
  ["would love to", Y], ["bet", Y], ["say less", Y], ["let's do it", Y], ["why not!", Y], ["no problem, I'm in", Y],
  ["can't wait", Y], ["Wouldn't miss it", Y], ["happy to", Y], ["sign me up", Y], ["I guess so", Y],
  ["fine", Y], ["alright, I'm in", Y], ["I'm good with that", Y], ["yes please", Y], ["totally", Y],
  ["Yeah, I am in.", Y], ["omg yes intro!! no heavy networking vibes lol", Y],
  // emoji
  ["👍", Y], ["👍🏽", Y], ["✅", Y], ["🙌🙌", Y], ["👎", N], ["❌", N], ["🤔", U], ["🤷‍♀️", U],
  ["yes 👍", Y], ["no 👍", N], ["sounds good 🔥", Y],
  // plain no
  ["no", N], ["No.", N], ["nope", N], ["nah", N], ["naw", N], ["no thanks", N], ["No thank you.", N],
  ["no way", N], ["hard pass", N], ["I'll pass", N], ["pass", N], ["not for me", N], ["not interested", N],
  ["not really", N], ["I'd rather not", N], ["don't think so", N], ["I can't", N], ["can't make it", N],
  ["cant", N], ["I'm busy", N], ["count me out", N], ["I'm out", N], ["I'm good, thanks", N], ["I'm all set", N],
  ["probably not", N], ["doubt it", N], ["i guess not", N], ["that doesn't work for me", N],
  // negation of yes words
  ["absolutely not", N], ["definitely not", N], ["hell no", N], ["of course not", N], ["really not", N],
  ["not ok", N], ["I'm not in", N], ["not down", N], ["I don't think I'm down", N], ["not great tbh", N],
  ["ok no", N], ["yeah no", N], ["yeah... no", N], ["sure... no", N], ["Sounds fun. No.", N],
  ["Yes. Actually no, I can't.", N], ["Sure! wait no, I have a thing", N], ["nvm, can't", N],
  // refusals that name a day
  ["No. Saturday I'm at a wedding", N], ["no, not tonight", N], ["Not this week, thanks.", N],
  ["can't tonight", N], ["I can't make it today", N], ["Can't this week, maybe another time.", N],
  ["No sorry, Thursday is bad", N],
  // hedges
  ["not sure", U], ["not sure yet", U], ["I'm not sure", U], ["really not sure", U], ["maybe", U],
  ["mayyybe", U], ["perhaps", U], ["possibly", U], ["probably", U], ["idk", U], ["i don't know", U],
  ["dunno", U], ["let me check", U], ["let me check my calendar and get back to you", U], ["it depends", U],
  ["we'll see", U], ["hmm", U], ["who is it?", U], ["who is it? thursday maybe", U], ["who else is going?", U],
  ["yes maybe", U], ["yeah, probably", U], ["what time?", U], ["thanks!", U], ["lol", U], ["", U],
  // conflicts and conditions: ask again
  ["Sounds fun. I can't though.", U], ["sure, but only with a woman", U], ["yes if it's not too loud", U],
  ["ok as long as she's not a founder", U], ["yes but I'd rather not go to a bar", U],
  ["Fine, intro me. If she's into cooking, I'm in. And no, it's not a therapy group.", U],
  // yes with a time constraint
  ["yes but not Thursday", Y], ["yes, except fridays", Y], ["sure, just not on weekends", Y],
  ["yes for Saturday, not Sunday", Y], ["yes if it's after 7pm", Y], ["sure but only after 6pm", Y],
  ["yeah! sure if that works for everyone", Y],
  // counter-offers (not a yes to the asked time)
  ["Interested, but could we do a different day?", U], ["Maybe, but this week is packed. Next week instead?", U],
  ["can we do another time?", U], ["rain check?", U], ["Not Thursday, but Friday works", U],
  // Spanish basics
  ["sí", Y], ["si", Y], ["Sí, claro", Y], ["claro", Y], ["dale", Y], ["vale", Y], ["me apunto", Y], ["por supuesto", Y],
  ["de acuerdo", Y], ["¡me encantaría!", Y], ["por qué no", Y], ["no", N], ["no gracias", N], ["no puedo", N],
  ["para nada", N], ["claro que no", N], ["mejor no", N], ["paso", N], ["tal vez", U], ["quizás", U],
  ["no sé", U], ["a lo mejor", U], ["Sí, pero no el jueves", Y], ["no puedo el viernes", N],
  ["si puedo ir, sí", U], ["si tengo tiempo", U],
];

describe("parseReply: human-written corpus", () => {
  test(`corpus has 100+ rows (${CORPUS.length})`, () => expect(CORPUS.length).toBeGreaterThanOrEqual(100));
  for (const [text, want] of CORPUS) {
    test(JSON.stringify(text), () => expect(classifyYesNo(text)).toBe(want));
  }
  test("only 'yes' is yes: no negated or hedged reply is read as yes", () => {
    const negs = CORPUS.filter(([t]) => /\b(not|no|n't|nah|nope|maybe|sure\.\.\.)\b/i.test(t) && !/no problem|no heavy|can't wait|wouldn't miss|why not|por qué no|pero no|except|not thursday|not on|not sunday|not too|just not/i.test(t));
    for (const [t, want] of negs) if (want !== "yes") expect(classifyYesNo(t)).not.toBe("yes");
  });
});

describe("parseReply: structure", () => {
  test("yes with a time constraint keeps the constraint", () => {
    const r = parseReply("yes but not Thursday");
    expect(r.answer).toBe("yes");
    expect(r.constraints).toEqual([{ kind: "time", text: "not thursday" }]);
  });
  test("conditional yes is unsure, leaning yes, with the condition", () => {
    const r = parseReply("sure, but only with a woman");
    expect(r).toMatchObject({ answer: "unsure", leaning: "yes" });
    expect(r.constraints[0]?.kind).toBe("condition");
  });
  test("counter-offers set counter", () => {
    expect(parseReply("could we do a different day?").counter).toBe(true);
    expect(parseReply("Can't this week, maybe another time.")).toMatchObject({ answer: "no", counter: true });
  });
  test("reason never carries member text", () => {
    for (const [t] of CORPUS) expect(parseReply(t).reason).toMatch(/^[a-z_]+$/);
  });
});

describe("parseOptOut", () => {
  const cases: [string, "exact" | "likely" | "none"][] = [
    ["STOP", "exact"], ["stop", "exact"], ["Stop.", "exact"], ["UNSUBSCRIBE", "exact"], ["cancel", "exact"], ["quit", "exact"],
    ["stop all", "exact"], ["para", "exact"], ["PARAR", "exact"], ["baja", "exact"], ["no más", "exact"],
    ["please stop texting me", "likely"], ["Stop messaging me", "likely"], ["don't text me again", "likely"],
    ["take me off this list", "likely"], ["remove me", "likely"], ["no more texts please", "likely"],
    ["leave me alone", "likely"], ["wrong number", "likely"], ["pls stop", "likely"], ["STOP!!!", "exact"],
    ["stop it", "likely"], ["ok stop", "likely"], ["unsubscribe me pls", "likely"],
    ["no me escribas más", "likely"], ["deja de mandarme mensajes", "likely"], ["quiero darme de baja", "likely"],
    ["no quiero mensajes", "likely"], ["número equivocado", "likely"],
    ["how do I stop these?", "none"], ["my friend said stop by", "none"], ["can't stop thinking about the hike!", "none"],
    ["yes", "none"], ["no thanks", "none"], ["the bus stop on 5th", "none"],
    ["don't stop", "none"], ["dont stop", "none"], ["stop by later", "none"], ["Stop it, I love this", "none"], ["I'll stop at the store", "none"],
  ];
  for (const [t, want] of cases) test(JSON.stringify(t), () => expect(parseOptOut(t).match).toBe(want));
  test("leave <app> is app-scoped when the app is known", () => {
    expect(parseOptOut("leave slop", { apps: ["slop", "ntwrk"] })).toMatchObject({ match: "likely", scope: "app" });
    expect(parseOptOut("STOP", { apps: ["slop"] }).scope).toBe("all");
  });
  test("Spanish is tagged", () => expect(parseOptOut("no me escribas").lang).toBe("es"));
});
