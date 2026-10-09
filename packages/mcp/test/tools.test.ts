// submit_profile's argument check (tools.ts checkArgs): a 5-digit zip is part of a dating profile;
// a phone number, an email address and anything that looks like a code are refused.
import { describe, expect, test } from "bun:test";
import { defaultApps } from "../src/apps.ts";
import { checkArgs, contactOrCode } from "../src/tools.ts";

const slop = defaultApps().slop;
const submit = (about: string) => checkArgs("submit_profile", { about }, [], slop);

describe("submit_profile: zip codes and contact details", () => {
  test("a standalone zip is accepted, also next to an age range and miles", () => {
    for (const about of [
      "I'm a woman looking for men 28-35, zip 11211, within 5 miles.",
      "Bushwick (11237). Into climbing and live music. Something serious.",
      "Zip 10001 or 10003 works, 25 - 35, up to 10 miles.",
    ]) expect([about, submit(about).ok]).toEqual([about, true]);
  });

  test("a phone number is refused, however it is written", () => {
    for (const about of [
      "Text me at 415-555-0102, I like hiking.",
      "My number is (415) 555-0102 if needed.",
      "call +1 415 555 0102 anytime ok",
      "reach me at 4155550102 please",
      "my cell 555 0102 for the date",
    ]) expect([about, submit(about).ok]).toEqual([about, false]);
  });

  test("a code (4 or 6 to 10 digits) and an email are refused", () => {
    for (const about of ["My code is 482913, I love dogs.", "the code was 4821 and I like jazz", "verification 1234567890 here", "Email me at maya@example.com, I like art."]) {
      const r = submit(about);
      expect([about, r.ok]).toEqual([about, false]);
      if (!r.ok) expect(r.message).toContain("phone numbers, codes and email addresses");
    }
  });

  test("contactOrCode on its own", () => {
    expect(contactOrCode("11211")).toBe(false);
    expect(contactOrCode("123456")).toBe(true);
    expect(contactOrCode("11211-1234")).toBe(true);
    expect(contactOrCode("555 123 456")).toBe(true);
  });
});
