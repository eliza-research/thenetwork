// The simulator must not turn a real refusal into explicit repeat interest for the matcher.
import { expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { ConsentNetwork } from "../../network/src/network.ts";
import { nycPersonas } from "../../network/harness/experiment.ts";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { World } from "../src/world.ts";

test("plan refusals reach the channel without creating repeat-interest edges", async () => {
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const seed = 4;
  const make = async () => new World({
    seed, personas: await nycPersonas(), days: 21, start, writeLog: false,
    network: new ConsentNetwork({ seed, review: "auto" }), plans: true, failureRate: 0.15,
  });
  const discovery = await make();
  await discovery.begin();
  // Find a delivered question following a held plan. No proposal, attendance, or feedback record is fabricated.
  let question: { t: number; member: string; proposal: string } | undefined;
  while (!question && discovery.clock.now() < discovery.end) {
    await discovery.advanceTo(discovery.clock.now() + 6 * HOUR);
    for (const r of discovery.records) {
      if (r.type !== "message" || r.msg.direction !== "outbound" || r.msg.status !== "delivered"
        || r.msg.meta?.type !== "feedback_request" || !r.msg.meta.plan || !r.msg.meta.proposalId) continue;
      const outcome = discovery.records.find(o => o.type === "outcome" && o.proposalId === r.msg.meta!.proposalId);
      if (outcome?.type !== "outcome" || !outcome.attendance[r.msg.memberId]?.showed
        || Object.values(outcome.attendance).filter(a => a.showed).length < 2) continue;
      question = { t: r.t, member: r.msg.memberId, proposal: r.msg.meta.proposalId };
      break;
    }
  }
  expect(question).toBeDefined();
  const q = question!;
  const cases: [string, boolean][] = [
    ["Never again.", false], ["Not again, thanks.", false],
    ["I won't do that again.", false], ["Nope, not doing that again.", false],
    ["Yes, I'd do it again!", true], ["Yes, I won't miss doing that again.", true],
  ];
  const results: { text: string; edges: string[]; expected: string[] }[] = [];
  for (const [text, again] of cases) {
    const w = await make();
    await w.begin();
    await w.advanceTo(q.t);
    const outcome = w.records.find(r => r.type === "outcome" && r.proposalId === q.proposal);
    if (outcome?.type !== "outcome") throw new Error("held plan did not replay");
    const others = Object.entries(outcome.attendance).filter(([id, a]) => id !== q.member && a.showed).map(([id]) => id).sort();
    expect(others.length).toBeGreaterThan(0);
    expect(w.snapshot().edges.filter(e => e.from === q.member && e.type === "would_interact_again")).toEqual([]);
    w.act({ do: "say", persona: q.member, text });
    await w.advanceTo(q.t + 1);
    expect(w.records.some(r => r.type === "message" && r.msg.direction === "inbound"
      && r.msg.memberId === q.member && r.msg.body === text && r.msg.status === "delivered")).toBe(true);
    results.push({ text, edges: w.snapshot().edges.filter(e => e.from === q.member && e.type === "would_interact_again").map(e => e.to).sort(), expected: again ? others : [] });
  }
  expect(results.map(r => ({ text: r.text, edges: r.edges })))
    .toEqual(results.map(r => ({ text: r.text, edges: r.expected })));
}, 120_000);
