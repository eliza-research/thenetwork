import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { evaluateExpectations, loadScenario, runScenario, scenarioWorldOptions, type ScenarioActionSpec } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld, World, type WorldResult } from "../src/world.ts";

const persona = "quitter";
const resumeText = "START";
const followupText = "Any gardening classes nearby this weekend?";

async function stopScenario() {
  const scenario = await loadScenario(fileURLToPath(new URL("../scenarios/stop-keyword.json", import.meta.url)));
  scenario.background = { personas: 0 };
  return scenario;
}

const runOptions = (seed = 1) => ({
  seed,
  network: () => new StubNetwork({ seed, randomIntros: false }),
});
const say = (day: number, text: string, hour = 11): ScenarioActionSpec => ({ do: "say", persona, text, at: { day, hour } });
const stop = (day: number, hour = 11): ScenarioActionSpec => ({ do: "opt_out", persona, at: { day, hour } });
const messages = (world: WorldResult) => world.records.flatMap(r => r.type === "message" && r.msg.memberId === persona ? [r.msg] : []);

test.each([2, 3])("the STOP scenario grades acknowledged resume on day %i and a later STOP", async resumeDay => {
  const scenario = await stopScenario();
  scenario.actions.push(say(resumeDay, resumeText), say(resumeDay, followupText, 12), stop(4));
  const { world, results } = await runScenario(scenario, runOptions());
  const [firstStop, secondStop] = world.records.filter(r => r.type === "opt_out" && r.memberId === persona);
  const resume = world.records.find(r => r.type === "opt_in" && r.memberId === persona);
  const welcome = world.records.find(r => r.type === "message" && r.msg.memberId === persona && resume
    && r.t === resume.t && r.msg.direction === "outbound" && !r.msg.system && r.msg.status === "delivered");
  const command = world.records.find(r => r.type === "message" && r.msg.memberId === persona && r.msg.keyword === "START");
  const acknowledgement = world.records.find(r => r.type === "message" && r.msg.memberId === persona && r.t === firstStop?.t && r.msg.system);
  if (!firstStop || !secondStop || !resume || !welcome || !command || !acknowledgement) throw new Error("Expected the real STOP, START and delivered records.");
  expect(world.channel.isOptedOut(persona)).toBe(true);
  expect(results.map(r => r.status)).toEqual(["pass", "pass"]);
  const grade = (records: WorldResult["records"]) => evaluateExpectations(scenario, { ...world, records }, "stub")[0]?.status;
  expect(grade([welcome])).toBe("fail");
  expect(grade([firstStop, acknowledgement, command, welcome])).toBe("fail");
  expect(grade([firstStop, acknowledgement, secondStop])).toBe("pass");
  expect(grade([firstStop, resume, welcome, secondStop])).toBe("pass");
  expect(welcome.t === firstStop.t).toBe(resumeDay === 2);
  if (resumeDay === 2) {
    expect(grade([welcome, firstStop])).toBe("pass");
    expect(grade([firstStop, welcome])).toBe("fail");
  }
});

test("only normalized START commands reopen the simulated channel", async () => {
  const cases = [
    ["START", true], ["UNSTOP", true], ["SUBSCRIBE", true], ["RESUME", true], ["start.", true], ["ＳＴＡＲＴ", true],
    ["YES", false], ["restart", false], ["start later", false],
  ] as const;
  const outcomes = [];
  for (const [text] of cases) {
    const scenario = await stopScenario();
    scenario.actions.push(say(3, text), say(4, followupText), stop(5));
    const opts = scenarioWorldOptions(scenario, runOptions());
    const command = opts.actions?.find(({ action }) => action.do === "say" && action.text === text);
    if (!command) throw new Error("Expected the scheduled resume attempt.");
    const runner = new World(opts);
    await runner.begin();
    runner.scheduler.at(command.at - 1, "persona_send", { personaId: persona, text: resumeText, reaction: "like" });
    await runner.advanceTo(runner.end);
    const world = await runner.complete();
    const records = messages(world);
    outcomes.push({
      text,
      resumes: world.records.some(r => r.type === "opt_in" && r.memberId === persona),
      followup: records.some(m => m.direction === "inbound" && m.body === followupText),
      stopped: world.channel.isOptedOut(persona) && world.memories.get(persona)?.optedOut,
      tapback: records.some(m => m.ts === command.at - 1 && m.meta?.reaction === "like"),
    });
  }
  expect(outcomes).toEqual(cases.map(([text, resumes]) => ({ text, resumes, followup: resumes, stopped: true, tapback: false })));
});

test.each([1, 2, 3])("START restores the same single routine on seed %i", async seed => {
  const scenario = await stopScenario();
  scenario.days = 45;
  scenario.actions = [stop(0, 20), say(7, resumeText), say(7, resumeText)];
  const resumed = await runWorld(scenarioWorldOptions(scenario, runOptions(seed)));
  scenario.actions = [stop(0, 20)];
  const stopped = await runWorld(scenarioWorldOptions(scenario, runOptions(seed)));
  scenario.actions = [];
  const active = await runWorld(scenarioWorldOptions(scenario, runOptions(seed)));
  const stopAt = resumed.records.find(r => r.type === "opt_out" && r.memberId === persona)?.t;
  const resumeAt = resumed.records.find(r => r.type === "opt_in" && r.memberId === persona)?.t;
  if (stopAt === undefined || resumeAt === undefined) throw new Error("Expected both consent transitions.");
  const askTimes = (world: WorldResult) => (world.memories.get(persona)?.signals ?? [])
    .filter(x => x.source === "ask" && x.at > resumeAt && messages(world).some(m => m.direction === "inbound" && m.ts === x.at))
    .map(x => x.at);
  expect(messages(resumed).filter(m => m.direction === "inbound" && m.ts > stopAt && m.ts < resumeAt)).toEqual([]);
  expect(messages(stopped).filter(m => m.direction === "inbound" && m.ts > stopAt)).toEqual([]);
  const activeAskTimes = askTimes(active);
  expect(activeAskTimes.length).toBeGreaterThan(0);
  expect(askTimes(resumed)).toEqual(activeAskTimes);
});
