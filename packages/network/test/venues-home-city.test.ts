// Public venue ideas only for members in New York (docs/research/2026-11-07-state-machines.md, module
// matching_engine, SD-435): the real ConsentNetwork and engine in the small NYC world (mini.ts). Every
// venue in geo.ts is in New York, and nearbyVenues uses Midtown for an area it does not know. A member
// whose home is San Francisco (they share the NYC runtime) who asked for plans got "A few ideas nearby:"
// with New York parks, and an SF member aged 13-17 got New York places as their concierge answer.
import { describe, expect, test } from "bun:test";
import { HOUR, type MemberId } from "@thenetwork/core";
import { VENUES } from "../src/geo.ts";
import { Mini } from "./mini.ts";

/** Move a member's home to San Francisco (snapshot member and home presence). */
function toSf(w: Mini, id: MemberId) {
  w.members.find(m => m.id === id)!.homeCity = "sf";
  const p = w.presence.find(x => x.memberId === id)!;
  p.city = "sf"; p.areas = ["Mission"];
}
const nycVenue = (body: string) => VENUES.some(v => body.includes(v.name));

describe("venue ideas and the member's city", () => {
  test("an SF member who asks for plans gets no New York venues", async () => {
    const w = new Mini([{ id: "a", name: "Ana Diaz", age: 30, interests: ["climbing", "hiking"] }, { id: "n", name: "Nia Cole", age: 30, area: "Greenpoint", interests: ["climbing", "hiking"] }], { app: "friends" });
    toSf(w, "a");
    await w.onboard("a", "n");
    await w.run(HOUR);
    // Control: the NYC member gets New York ideas.
    let from = w.mark();
    await w.say("n", "Anything fun this weekend?");
    expect(w.to("n", from).some(s => nycVenue(s.body))).toBe(true);
    from = w.mark();
    const r = await w.net.onInbound({ id: "late-a", memberId: "a", body: "Anything fun this weekend?", ts: w.clock.now(), channel: "sms" });
    expect(w.to("a", from).filter(s => nycVenue(s.body)).map(s => s.body)).toEqual([]);
    // The agent answers instead.
    expect(r).toBe("open");
  });

  test("an SF member aged 13-17 gets no New York venues from the concierge", async () => {
    const w = new Mini([{ id: "k", name: "Kai Lee", age: 15, interests: ["climbing"] }]);
    toSf(w, "k");
    await w.onboard("k");
    await w.run(HOUR);
    const from = w.mark();
    const r = await w.net.onInbound({ id: "late-k", memberId: "k", body: "I'm bored, what should I do after school today?", ts: w.clock.now(), channel: "sms" });
    expect(w.to("k", from).filter(s => nycVenue(s.body)).map(s => s.body)).toEqual([]);
    expect(r).toBe("open");
  });
});
