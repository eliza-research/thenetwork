import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { DEFAULT_START, Rng, classifyMessage, generatePersonas, localHour, parseYesNo, replyDelay, skillFirstPerson } from "../src/index.ts";

describe("persona policy helpers", () => {
  test("classifies Network messages without meta", () => {
    expect(classifyMessage("Hi Maya, I think you'd enjoy meeting Sam C.: you both climb. Want an intro?")).toBe("proposal");
    expect(classifyMessage("How did it go with Sam?")).toBe("feedback_request");
    expect(classifyMessage("Reminder: today at 7pm. Have fun!")).toBe("reminder");
    expect(classifyMessage("What would you like more of in your life right now?")).toBe("question");
    expect(classifyMessage("Thanks, noted.")).toBe("info");
  });

  test("parses yes / no / counter replies", () => {
    expect(parseYesNo("Yes, I'd like that!")).toBe("yes");
    expect(parseYesNo("yeah im in lol")).toBe("yes");
    expect(parseYesNo("No thanks, not right now.")).toBe("no");
    expect(parseYesNo("I'll pass this time")).toBe("no");
    // A yes with a time constraint is not a yes to the proposed time (re-offer a slot).
    expect(parseYesNo("sure, not this week though")).toBe("counter");
    expect(parseYesNo("yes but not Thursday")).toBe("counter");
    expect(parseYesNo("yes, thursday works")).toBe("yes");
    expect(parseYesNo("Interested, but could we do a different day?")).toBe("counter");
    expect(parseYesNo("hmm")).toBe("unclear");
    // A conditional yes followed by a "no" is not consent: ask again (audit network-consent-2).
    expect(parseYesNo("Fine, intro me. If she\u2019s into cooking, I\u2019m in. And no, it\u2019s not a therapy group.")).toBe("unclear");
    expect(parseYesNo("absolutely not")).toBe("no");
    expect(parseYesNo("not sure")).toBe("unclear");
    expect(parseYesNo("ok no")).toBe("no");
    expect(parseYesNo("omg yes intro!! no heavy networking vibes lol")).toBe("yes");
  });

  test("reply delays respect sleep (replies land while awake)", () => {
    const ps = generatePersonas({ n: 40, seed: 2, adversarialRate: 0 });
    const r = new Rng(1);
    for (const p of ps) for (let k = 0; k < 10; k++) {
      const now = DEFAULT_START + r.int(0, 6) * DAY + r.int(0, 23) * HOUR;
      const t = now + replyDelay(p, now, r);
      const h = localHour(t, p.homeCity);
      const { wake, sleep } = p.routine;
      const awake = wake <= sleep ? h >= wake && h < sleep : h >= wake || h < sleep;
      expect(awake).toBe(true);
    }
  });

  test("first-person skill phrasing", () => {
    expect(skillFirstPerson("guitar")).toBe("I play guitar");
    expect(skillFirstPerson("ml_engineering")).toBe("I'm an ML engineer");
    expect(skillFirstPerson("climate_policy")).toBe("I work in climate policy");
  });
});
