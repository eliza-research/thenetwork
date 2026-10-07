import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isAllowed, parseRobots } from "../src/http";

const rb = (h: string, ua?: string) => parseRobots(readFileSync(`${import.meta.dir}/../fixtures/robots/${h}.txt`, "utf8"), ua);

describe("robots.txt", () => {
  test("meetup: repeated '*' groups are merged (RFC 9309); ?source= search URLs disallowed", () => {
    const r = rb("www.meetup.com");
    expect(isAllowed(r, "/find/?location=us--ca--San%20Francisco&source=EVENTS")).toBe(false);
    expect(isAllowed(r, "/find/us--ca--san-francisco/")).toBe(true);
    expect(isAllowed(r, "/some-group/events/rss/")).toBe(false);
  });
  test("cerebral valley: /api/ off limits, public pages and llms-full.txt allowed", () => {
    const r = rb("cerebralvalley.ai");
    expect(isAllowed(r, "/api/events")).toBe(false);
    expect(isAllowed(r, "/events/san-francisco")).toBe(true);
    expect(isAllowed(r, "/llms-full.txt")).toBe(true);
    expect(isAllowed(r, "/e/foo.json")).toBe(false);
  });
  test("eventbrite: feeds and destination API disallowed", () => {
    const r = rb("www.eventbrite.com");
    expect(isAllowed(r, "/rss/")).toBe(false);
    expect(isAllowed(r, "/api/v3/destination/events/")).toBe(false);
  });
  test("partiful: no '*' group (generic UA unrestricted by robots) but AI crawlers are named and blocked", () => {
    expect(isAllowed(rb("partiful.com"), "/e/abc")).toBe(true);
    expect(isAllowed(rb("partiful.com", "claudebot"), "/e/abc")).toBe(false);
  });
  test("longest match wins, Allow wins ties", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\n");
    expect(isAllowed(r, "/a/x")).toBe(false);
    expect(isAllowed(r, "/a/b/c")).toBe(true);
  });
});
