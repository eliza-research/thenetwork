// The consent ledger's words (PLAT-12, PLAT-13, PLAT-16): STOP stops every app on the shared line,
// "leave <app>" stops one, and a person may opt out in their own words (English and Spanish), from a
// hand-labelled corpus (fixtures/opt-out.jsonl; append-only).
import { describe, expect, test } from "bun:test";
import { APP_IDS, APPS } from "../src/apps.ts";
import { detectKeyword, keywordEvent, lastEvents, leaveTarget, optOutPhrase, resolveConsent, stopScope } from "../src/consent.ts";

const corpus = (await Bun.file(new URL("./fixtures/opt-out.jsonl", import.meta.url)).text()).trim().split("\n").map(l => JSON.parse(l) as { text: string; label: "stop" | "stop_all" | "not_stop"; lang: string });

describe("per-app leave in the person's words (audit: 'stop slop' and 'quit slop' did nothing)", () => {
  test("stop, quit, cancel, unsubscribe or exit an app is a leave of that app only; a sentence is not", () => {
    for (const [t, app] of [["stop slop", "slop"], ["quit slop", "slop"], ["Stop slop.date", "slop"], ["unsubscribe from peon", "peon"], ["cancel friends.help", "friends"], ["exit peon.biz", "peon"], ["leave the network", "ntwrk"]] as const) {
      expect([t, detectKeyword(t) ?? null, leaveTarget(t) ?? null]).toEqual([t, null, app]);
    }
    for (const t of ["cancel the date", "stop by at 7", "quit my job"]) expect([t, leaveTarget(t) ?? null]).toEqual([t, null]);
  });
});

describe("opt-out in the person's own words (reasonable means)", () => {
  test("the corpus is big enough and labelled in both languages", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(80);
    expect(corpus.filter(c => c.lang === "es" && c.label === "stop").length).toBeGreaterThanOrEqual(15);
    expect(corpus.filter(c => c.label === "not_stop").length).toBeGreaterThanOrEqual(15);
  });

  test("every opt-out line is a STOP; every other line is not", () => {
    const wrong = corpus.filter(c => {
      const k = detectKeyword(c.text);
      return c.label === "not_stop" ? k === "stop" || k === "stop_all" : k !== c.label;
    }).map(c => `${c.label}: ${c.text} -> ${detectKeyword(c.text) ?? "none"}`);
    expect(wrong).toEqual([]);
  });

  test("a long message that only mentions stopping is not an opt-out", () => {
    expect(optOutPhrase(`${"I had a long day at work and the train was late again. ".repeat(3)}stop texting me`)).toBe(false);
  });
});

describe("STOP is every app; leave is one app", () => {
  test("the default scope is global; only PLATFORM_STOP_SCOPE=app keeps STOP to one app", () => {
    expect(stopScope({})).toBe("global");
    expect(stopScope({ PLATFORM_STOP_SCOPE: "global" })).toBe("global");
    expect(stopScope({ PLATFORM_STOP_SCOPE: "app" })).toBe("app");
    const p = "+12125550199";
    const { event, reply } = keywordEvent("stop", p, APPS.slop, 1, { scope: stopScope({}), ref: "in:1" });
    expect(event).toMatchObject({ app: null, state: "opted_out", ref: "in:1" });
    expect(reply).toBe(APPS.slop.brand.stop);
    const events = [{ e164: p, app: "slop" as const, state: "opted_in" as const, source: "j", at: 1 }, { e164: p, app: "peon" as const, state: "opted_in" as const, source: "j", at: 1 }, event!];
    for (const a of APP_IDS) expect(resolveConsent(lastEvents(events, p, a))).toBe("opted_out");
  });

  test("leave <app> names one app by its id, its domain or its name; anything else is not a leave", () => {
    for (const a of APP_IDS) {
      for (const say of [`leave ${a}`, `Leave ${APPS[a].domain}`, `leave ${APPS[a].domain}.`, `please leave www.${APPS[a].domain}`]) expect([say, leaveTarget(say)]).toEqual([say, a]);
    }
    expect(leaveTarget("leave the network")).toBe("ntwrk");
    expect(leaveTarget("I have to leave early")).toBeUndefined();
    expect(leaveTarget("leave slop alone lol")).toBeUndefined();
    expect(detectKeyword("leave slop.date")).toBeUndefined();
  });
});
