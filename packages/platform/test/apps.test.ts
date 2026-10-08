// PLAT-25: the app registry equals PRD 40 and the founder decisions of 2026-10-08 (AGENTS.md): ids,
// domains, ages and join modes; the host maps; the keyword routing on the shared line; and what a
// person who joined with no keyword says they are looking for.
import { describe, expect, test } from "bun:test";
import { APP_IDS, APP_KEYWORDS, APPS, appForHost, DEFAULT_HOST_MAP, DEV_HOST_MAP, keywordApp, lookingFor, PAGES_PROJECT, POWERED_BY, publicAppInfo, siteHosts } from "../src/apps.ts";

describe("app registry (PRD 40.2, founder decisions 1, 2 and 6)", () => {
  test("ids, domains, join and match ages, join modes", () => {
    // Checked in from PRD 40.2 and AGENTS.md "Platform decisions": 13+ to join every app, 18+ to be matched.
    expect(APP_IDS.map(a => [a, APPS[a].domain, APPS[a].minJoinAge, APPS[a].minMatchAge, APPS[a].joinMode])).toEqual([
      ["ntwrk", "ntwrk.love", 13, 18, "invite"],
      ["slop", "slop.date", 13, 18, "open"],
      ["peon", "peon.biz", 13, 18, "open"],
      ["friends", "friends.help", 13, 18, "open"],
    ]);
    expect(JSON.stringify(APPS).toLowerCase()).not.toContain("buddies");
  });

  test("the production host map has only the four domains, their www names and their Pages names; dev adds the local ports", () => {
    expect(Object.keys(DEFAULT_HOST_MAP).sort()).toEqual(APP_IDS.flatMap(a => [APPS[a].domain, `www.${APPS[a].domain}`, `${PAGES_PROJECT[a]}.pages.dev`]).sort());
    // Founder decision 8: each site answers on <project>.pages.dev before (and besides) its own domain;
    // before the fix its join form got 403 origin there. A preview deployment is never a host.
    expect(appForHost("slop-date.pages.dev")).toBe("slop");
    expect(appForHost("friends-help.pages.dev")).toBe("friends");
    expect(appForHost("1a2b3c.slop-date.pages.dev")).toBeUndefined();
    expect(siteHosts("slop")).toEqual(["slop.date", "www.slop.date", "slop-date.pages.dev"]);
    expect(Object.keys(DEFAULT_HOST_MAP).some(h => /localhost|127\.0\.0\.1/.test(h))).toBe(false);
    expect(appForHost("localhost:5104")).toBeUndefined();
    expect(appForHost("localhost:5104", DEV_HOST_MAP)).toBe("friends");
    expect(appForHost("FRIENDS.HELP.")).toBe("friends");
  });

  test("keyword routing: the whole message names the app; a word in a sentence does not", () => {
    for (const a of APP_IDS) for (const k of APP_KEYWORDS[a]) { expect(keywordApp(k)).toBe(a); expect(keywordApp(`join ${k}`)).toBe(a); }
    expect(keywordApp("Slop.date!")).toBe("slop");
    expect(keywordApp("my ex is on slop.date lol")).toBeUndefined();
    expect(keywordApp("friends")).toBe("friends");
    expect(keywordApp("hello")).toBeUndefined();
  });

  test("what a person is looking for: friends, dating, work, all; a negation or a description of themselves does not count", () => {
    expect(lookingFor("friends")).toEqual(["friends"]);
    expect(lookingFor("Dating and new friends")).toEqual(["friends", "slop"]);
    expect(lookingFor("work stuff, mostly a new job")).toEqual(["peon"]);
    expect(lookingFor("all of these")).toEqual(["friends", "slop", "peon"]);
    expect(lookingFor("friends, not dating")).toEqual(["friends"]);
    expect(lookingFor("I work at a bank, looking for friends")).toEqual(["friends"]);
    expect(lookingFor("not sure yet")).toEqual([]);
  });

  test("GET /api/app tells the site its keyword, its ages, the powered-by line and the opt-in wording to show", () => {
    const info = publicAppInfo(APPS.friends);
    expect(info).toMatchObject({ id: "friends", domain: "friends.help", minJoinAge: 13, minMatchAge: 18, keywords: ["friends", "friends.help", "www.friends.help"], poweredBy: POWERED_BY });
    expect(info.consent.text).toContain("Reply STOP to stop");
    expect(POWERED_BY).toBe("All of these apps are powered by The Network.");
  });
});
