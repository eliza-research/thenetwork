import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { DAY, type Category, type Facet, type Member, type MemberId, type Presence } from "@thenetwork/core";
import { ConsentNetwork, type NetworkState } from "../src/index.ts";
import { Mini, START, type Spec } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const AREAS = ["Williamsburg", "Bushwick", "East Village", "Park Slope", "Harlem", "Astoria", "Chelsea", "Nowhere"];
const INTERESTS = ["startups", "climbing", "film", "running", "cooking", "chess", "ai"];
const SKILLS = ["design", "fundraising", "climbing_belay", "chess_strong"];
const REQUESTS: { category: Category; desireId?: string; tags: string[] }[] = [
  { category: "professional", desireId: "meet_founders", tags: ["startups"] },
  { category: "hobby", desireId: "climbing_partner", tags: ["climbing"] },
  { category: "social", tags: ["film"] },
  { category: "hobby", tags: ["chess", "running"] },
];
const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

async function templates() {
  const x = new Mini([{ id: "a", name: "Alice Able", age: 30 }, { id: "b", name: "Boris Bell", age: 32, skills: ["design"], interests: ["startups"], shareable: true }], { inlineJudge: holdEveryItem.inline });
  await x.onboard("a", "b");
  await x.say("a", "I want to meet other founders.");
  const state = x.net.exportState();
  return { member: state.members.find(m => m.id === "b")!, opp: state.opps[0]! };
}

interface Counts { members: number; presence: number; facets: number; opps: number }

async function world(n: number) {
  const t = await templates();
  const rnd = (i: number, k: number) => ((i * 2654435761 + k * 40503) >>> 0) % 1000;
  const specs: Spec[] = Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, name: `${i % 37 === 5 ? "Sam" : `N${i}`} L${i}`, age: i % 41 === 7 ? 16 : 22 + (i % 30), area: AREAS[rnd(i, 1) % AREAS.length],
    interests: INTERESTS.filter((_, k) => rnd(i, k + 2) < 300), skills: SKILLS.filter((_, k) => rnd(i, k + 20) < 120), shareable: i % 3 === 0,
    state: i % 29 === 3 ? "receiving" : "normal",
  }));
  const mini = new Mini(specs, { inlineJudge: holdEveryItem.inline });
  const now = mini.clock.now();
  for (let i = 0; i < n; i++) {
    if (i % 7 === 1) mini.presence.push({ memberId: `m${i}`, city: "sf", type: "temporary", areas: [], from: now + DAY, to: now + 3 * DAY });
    if (i % 11 === 2) mini.presence.push({ memberId: `m${i}`, city: "sf", type: "temporary", areas: [], from: now + 10 * DAY, to: now + 12 * DAY });
    if (i % 13 === 4) mini.presence.push({ memberId: `m${i}`, city: "nyc", type: "routine", areas: ["Chelsea"] });
  }
  const state: NetworkState = mini.net.exportState();
  state.members = specs.map((s, i) => ({
    ...t.member, id: s.id, name: s.name, first: s.name.split(" ")[0]!, display: s.name, area: s.area, stage: "active", age: s.age,
    minor: false, state: s.state ?? "normal", outbound: i % 17 === 6 ? 2 : 0, optedOut: i % 23 === 8,
  }));
  state.opps = Array.from({ length: Math.floor(n / 4) }, (_, i) => {
    const a = `m${rnd(i, 30) % n}`, b = `m${rnd(i, 31) % n}`;
    return {
      ...t.opp, id: `x${i}`, participants: [a, b], alternates: [], requester: a, primed: [], contacted: [], explanations: {},
      origin: i % 3 === 0 ? "engine" : "request", stage: (["review", "probing", "scheduled", "closed"] as const)[i % 4]!,
      status: [[a, "yes"], [b, i % 5 === 0 ? "no" : "probing"]] satisfies typeof t.opp.status, createdAt: now - (i % 10) * DAY,
    };
  });
  const asker = (i: number, k: number) => `m${(7 * (rnd(i, k) % 40)) % n}`;
  state.interactions = Array.from({ length: 4 * n }, (_, i) => ({
    id: `int${i}`, kind: "intro" as const, category: "social" as const, participants: [asker(i, 40), `m${rnd(i, 41) % n}`],
    at: now - (i % 90) * DAY, outcome: (["completed", "no_show", "declined", "cancelled"] as const)[i % 4]!,
  }));
  state.declined = Array.from({ length: n / 2 }, (_, i) => [pair(asker(i, 50), `m${rnd(i, 51) % n}`), now - (i % 40) * DAY] as [string, number]);
  state.blocks = Array.from({ length: n / 10 }, (_, i) => pair(asker(i, 60), `m${rnd(i, 61) % n}`));
  state.avoid = Array.from({ length: n / 10 }, (_, i) => pair(asker(i, 70), `m${rnd(i, 71) % n}`));

  const counts: Counts = { members: 0, presence: 0, facets: 0, opps: 0 };
  const counted = <T extends object>(rows: T[], key: keyof Counts): T[] => new Proxy(rows, {
    get(target, p, r) { if (typeof p === "string" && /^\d+$/.test(p)) counts[key]++; return Reflect.get(target, p, r); },
  });
  const ctx = mini.ctx();
  const net = new ConsentNetwork({ seed: 1, inlineJudge: holdEveryItem.inline, maxNewPerDay: 0, engine: { cities: ["nyc"] } });
  net.init({
    ...ctx,
    snapshot: () => ({ ...ctx.snapshot(), members: counted<Member>(mini.members, "members"), presence: counted<Presence>(mini.presence, "presence"), facets: counted<Facet>(mini.facets, "facets") }),
  });
  net.importState(state);
  const values = net.opps.values.bind(net.opps);
  Object.defineProperty(net.opps, "values", { value: () => [...values()].map(o => { counts.opps++; return o; }).values() });
  const search = (id: MemberId, i: number) => net.searchFor(net.member(id), REQUESTS[i % REQUESTS.length]!);
  return { net, counts, search };
}

test("the request search returns exactly the partners, scores and tie order it returned before indexing", async () => {
  expect(START).toBe(Date.UTC(2026, 9, 5, 17));
  const { search } = await world(300);
  const found: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) found[`m${i * 7}#${i % REQUESTS.length}`] = search(`m${i * 7}`, i);
  expect(Object.values(found).filter(x => (x as unknown[]).length > 0).length).toBeGreaterThan(20);
  expect(JSON.parse(JSON.stringify(found))).toEqual(JSON.parse(readFileSync(new URL("fixtures/request-search-300.json", import.meta.url), "utf8")));
});

test("the work per request grows linearly with the number of members", async () => {
  const work = async (n: number) => {
    const { counts, search } = await world(n);
    search("m0", 0);
    const before = { ...counts };
    for (let i = 1; i <= 4; i++) search(`m${i}`, i);
    return (counts.members - before.members) + (counts.presence - before.presence) + (counts.facets - before.facets) + (counts.opps - before.opps);
  };
  const small = await work(200), large = await work(2000);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(20);
});
