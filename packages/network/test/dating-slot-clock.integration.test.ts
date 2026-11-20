// A dating slot is the next New York wall time at that hour, including the hour itself.
// spec/quietHours.md keeps 14:00 outside a 22:00-08:00 quiet window, so the Network may offer it.
import { expect, test } from "vitest";
import { fromLocal, localParts, MINUTE } from "@thenetwork/core";
import { makeSlopPack } from "@thenetwork/engine";
import { baseMember, emptyInput, facet } from "../../engine/src/testkit.ts";
import { allowedAt, nextAt } from "../src/outreach.ts";
import { slopHooks } from "../service/packs.ts";

const NY = "America/New_York";
const QUIET: [number, number] = [22, 8];

function datingInput(now: number) {
  const input = emptyInput(now);
  for (const [id, gender, seeks] of [["a", "woman", "man"], ["b", "man", "woman"]] as const) {
    input.members.push(baseMember(id, {
      homeCity: "nyc", age: 30,
      prefs: { romanceOptIn: true, categoriesOptIn: ["romance"], quietHours: QUIET },
    }));
    input.facets.push(facet(id, 0, "preference", "dating", [
      `romance:is:${gender}`, `romance:seeks:${seeks}`, "romance:age:25-40",
      "slop:zip:11222", "slop:max_miles:10", "slop:free:sat_day", "slop:free:fri_eve",
    ], "agent_private"));
  }
  return input;
}

test("a date on the hour stays in this week, outside quiet hours", () => {
  const hooks = slopHooks(makeSlopPack({ verification: { required: false } }).options);
  const offer = (now: number) => hooks.timeOptions!(
    { id: "date", category: "romance", participants: ["a", "b"], first: "a" },
    now, () => datingInput(now),
  );

  // Friday 14:00 is inside the default send window (12:00 plus 6 hours). Saturday 14:00 is one day later.
  const fridayTwo = fromLocal(2026, 10, 9, 14, NY);
  const saturdayAfternoon = fromLocal(2026, 10, 10, 14, NY);
  const nextSaturdayAfternoon = fromLocal(2026, 10, 17, 14, NY);
  expect(localParts(fridayTwo, NY)).toMatchObject({ weekday: 4, hour: 14, minute: 0 });
  const atTwo = offer(fridayTwo);
  expect(atTwo?.some(slot => slot.start === saturdayAfternoon)).toBe(true);
  expect(allowedAt(saturdayAfternoon, QUIET)).toBe(true);

  // Ten minutes later, this Saturday is less than a day away, so the offer waits for the next Saturday.
  const tenPast = fridayTwo + 10 * MINUTE;
  const later = offer(tenPast);
  expect(later?.some(slot => slot.start === saturdayAfternoon)).toBe(false);
  expect(later?.some(slot => slot.start === nextSaturdayAfternoon)).toBe(true);

  // A learned evening send at Thursday 19:00 can offer Friday 19:00. Quiet hours start at 22:00.
  const thursdayEvening = fromLocal(2026, 10, 8, 19, NY);
  const fridayEvening = fromLocal(2026, 10, 9, 19, NY);
  expect(offer(thursdayEvening)?.some(slot => slot.start === fridayEvening)).toBe(true);
  expect(allowedAt(fridayEvening, QUIET)).toBe(true);

  // The booked-plan fallback uses the same search: Saturday 11:00 is a valid outdoors time.
  const saturdayMorning = fromLocal(2026, 10, 10, 11, NY);
  expect(nextAt(saturdayMorning, 11, day => day === "Sat" || day === "Sun")).toBe(saturdayMorning);
  expect(nextAt(saturdayMorning + MINUTE, 11, day => day === "Sat" || day === "Sun")).toBe(fromLocal(2026, 10, 11, 11, NY));

  // A time before the hour is unchanged: Friday noon still offers this Saturday afternoon.
  const fridayNoon = fromLocal(2026, 10, 9, 12, NY);
  expect(offer(fridayNoon)?.some(slot => slot.start === saturdayAfternoon)).toBe(true);
});
