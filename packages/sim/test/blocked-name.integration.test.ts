import { expect, test } from "bun:test";
import { evaluateExpectations, runScenario, type Scenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("blocked-pair scenarios distinguish longer names while rejecting actual blocked names", async () => {
  const failures: string[] = [];
  let worlds = 0, rejectedMentions = 0;
  for (const seed of [1, 4]) for (const [blocked, other] of [["Al", "Alex"], ["Ann", "JoAnn"], ["Zoë", "Zoëlla"], ["李", "李明"], ["A.", "A.J."], ["Al", "Toby"]]) for (const reverse of [false, true]) {
    const receiver = reverse ? "b" : "a", target = reverse ? "a" : "b";
    const s: Scenario = { name: "blocked-name", description: "A blocked name is distinct from another member's longer name.", seed, days: 7,
      personas: [{ ref: "a", name: reverse ? `${blocked} Brennan` : "Maya Rivera" }, { ref: "b", name: reverse ? "Maya Rivera" : `${blocked} Brennan` }, { ref: "c", name: `${other} Parker` }]
        .map((p, i) => ({ ...p, age: 30, city: "sf", homeArea: "Noe Valley", interests: ["coffee", "hiking"], desires: ["new_friends"], capacity: 0.9,
          responsiveness: { ignoreProb: 0, latencyMedianMin: 5 }, join: { day: 0, hour: 9, minute: i * 10 } })),
      actions: [{ at: { day: 1, hour: 12 }, do: "say", persona: receiver, text: `block ${blocked} Brennan` },
        { at: { day: 2, hour: 11 }, do: "propose", kind: "intro", participants: [receiver, "c"], objective: "coffee", city: "sf" }],
      expectations: [{ check: "blocked_pair_kept_apart", personas: ["a", "b"] }],
    };
    const network = new StubNetwork({ seed, randomIntros: false });
    const result = await runScenario(s, { network: () => network });
    const block = result.world.records.find(r => r.type === "block" && r.from === receiver && r.to === target);
    const invite = result.world.records.find(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.status === "delivered"
      && r.msg.memberId === receiver && r.t > (block?.t ?? Infinity) && r.msg.meta?.type === "proposal" && r.msg.body.includes(`${other} P.`));
    if (!block || !invite || invite.type !== "message") throw new Error("The complete world must block the target and introduce the other member");
    worlds++;
    const label = `${seed}/${blocked}/${other}/${reverse}`;
    if (!result.pass) failures.push(`${label}: longer or unrelated name failed`);
    if (result.world.metrics.invariants.total || result.world.metrics.errors) failures.push(`${label}: invariant or runtime error`);
    // Negative replay controls replace only the name in a real delivered invitation.
    for (const mention of [`${blocked} B.`, `${blocked}'s friend`]) {
      const records = result.world.records.map(r => r === invite ? { ...r, msg: { ...r.msg, body: r.msg.body.replace(`${other} P.`, mention) } } : r);
      const grade = evaluateExpectations(s, { ...result.world, records }, network.name);
      if (grade[0]?.status === "fail") rejectedMentions++;
      else failures.push(`${label}: actual blocked name passed`);
    }
  }
  expect({ worlds, rejectedMentions, failures }).toEqual({ worlds: 24, rejectedMentions: 48, failures: [] });
}, 60_000);
