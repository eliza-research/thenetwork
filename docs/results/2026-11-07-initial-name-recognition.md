# Recognize last initials in simulator messages

Date: 2026-11-07. Base: a0ed7bc6495d9e524afc3d500738212a28dc7bc2.
Environment: Windows, Bun 1.4.2, PostgreSQL 16.15, PowerShell 7.6.9.

## Requirement, cause and change

This reproduced simulator defect falls within the approved contribution scope.
PRD 34.3 requires persona decisions driven by hidden compatibility.
PRD 34.4 requires useful measurements of matching quality and member experience.
The SimMeta contract permits messages without participant annotations.
In that case, the persona policy infers participants from the message text.

The name index explicitly builds aliases such as "Alex B." for "Alex Brown".
Its final word-boundary check rejects the period before a space, punctuation or the end of the message.
With two people named Alex, the first name alone also cannot identify either person.
The policy therefore judges a text-only invitation without the named counterpart.
The resulting enjoyment score is zero, even when the full name produces a useful introduction.

The index now rejects a following word character instead of requiring a word boundary.
This permits punctuation-ending names while still excluding longer surnames such as "Alex Brownstone".
Initial aliases must also be unique, just as first-name aliases already must be.
If Alex Brown and Alex Baker both exist, "Alex B." remains unresolved.
An explicit full name still resolves.

Two alternatives:

1. Require participant metadata on every invitation. This would remove the documented text-inference fallback and change caller requirements.
2. Remove the final boundary entirely. That would also accept longer names and would not address ambiguous initial aliases.

Normal annotated proposals already identify their participants.
This fix concerns the simulator's text-only inference path, not production identity resolution.
Case sensitivity, name splitting and policy thresholds do not change.

## measurement

One integration case sends messages through the real World, channel, persona policy and oracle.
It uses generated personas, scripted joins and the existing StubNetwork with random introductions disabled.
A subclass only exposes the NetworkContext supplied during initialization.
No persona response, oracle result or channel behavior is mocked.
Messages have proactive metadata, but no type, proposal ID or participant annotation.

Seeds 1 and 2 each exercise nine fresh worlds:
full name, initial, initial at message end, two initials, unique first name,
ambiguous first name, longer surname, ambiguous initial and full-name disambiguation.
The case checks the participants stored by the actual persona response.

~~~sh
bun test --conditions eliza-source packages/sim/test/initial-names.integration.test.ts
~~~

| Check | Before | After |
|---|---:|---:|
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |
| Assertions | 1 | 1 |
| Case duration | 43.51 ms | 45.15 ms |
| Command duration | 197 ms | 98 ms |

Timings are observations, not a performance claim.

The held-out measurement uses seeds 11-30, separate from the regression seeds.
Each revision produces 240 rows: 220 named-message worlds and 20 ordinary control worlds.
The named-message worlds each run for two simulated days with four or five generated adults.
Every test message is delivered.
The controls each use 40 generated personas and 14 simulated days with ordinary StubNetwork behavior.

| Held-out check | Before | After |
|---|---:|---:|
| Correct counterpart IDs, all name forms | 160 / 220 | 220 / 220 |
| Correct IDs for unambiguous initials | 0 / 60 | 60 / 60 |
| Initials match full-name decisions and replies | 0 / 60 | 60 / 60 |
| Initial invitations accepted | 0 / 60 | 8 / 60 |
| Other name cases | 160 | All unchanged |
| Ordinary control worlds | 20 | All unchanged |

Full-name parity compares the entire stored proposal and subsequent replies, including timestamps.
The eight changed decisions occur on seeds 20, 22 and 29.
For example, seed 22 previously declined "Alex B." with enjoyment zero.
It now accepts with enjoyment 0.785, exactly as "Alex Brown" does on the same seed.
This corrects a deterministic identity error; it does not establish a general increase in matching quality.
No significance claim is made from the acceptance count.

Control records, metrics, channel messages and persona memories match.
Only wall-clock durations are normalized for comparison; control run IDs are deterministic.
All other name cases retain identical outputs, including ambiguous initial and longer-surname exclusions.

## Reproduce the paired measurement

Save the following program as ../initial-names-measure.ts beside two installed checkouts.
Use a clean base checkout named ../friends-crew-base at the commit above.
Run from the fixed checkout with live-send and deployment flags unset:

~~~sh
bun run --conditions eliza-source ../initial-names-measure.ts ../friends-crew-base > ../initial-names-before.jsonl
bun run --conditions eliza-source ../initial-names-measure.ts . > ../initial-names-after.jsonl
~~~

Compare rows by kind, seed and label.
Expect exactly the 60 rows with a paired full-name form to change.
Their proposal and replies fields must equal those of the paired full-name row after the fix.
Expect all other rows to match after normalizing wallMs.

~~~ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(process.argv[2]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { World, runWorld, DEFAULT_START } = await from("packages/sim/src/world.ts");
const { StubNetwork } = await from("packages/sim/src/stubNetwork.ts");
const { generatePersonas } = await from("packages/sim/src/generator.ts");
const { DAY, HOUR } = await from("packages/core/src/clock.ts");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (k, v) => k === "wallMs" ? 0 : v instanceof Map || v instanceof Set ? [...v] : v)).digest("hex");
class TextNetwork extends StubNetwork {
  channelContext: any;
  init(ctx: any) { super.init(ctx); this.channelContext = ctx; }
}
const cases = [
  { label: "full", names: "Alex Brown", ids: ["m0002"] },
  { label: "initial", names: "Alex B.", ids: ["m0002"], paired: "full" },
  { label: "full at end", names: "Alex Brown", ids: ["m0002"], end: true },
  { label: "initial at end", names: "Alex B.", ids: ["m0002"], end: true, paired: "full at end" },
  { label: "full group", names: "Alex Brown and Alex Jones", ids: ["m0002", "m0003"] },
  { label: "initial group", names: "Alex B. and Alex J.", ids: ["m0002", "m0003"], paired: "full group" },
  { label: "unique first", names: "Jamie", ids: ["m0004"] },
  { label: "ambiguous first", names: "Alex", ids: [] },
  { label: "longer last name", names: "Alex Brownstone", ids: [] },
  { label: "ambiguous initial", names: "Alex B.", ids: [], ambiguous: true },
  { label: "full with ambiguous initial", names: "Alex Brown", ids: ["m0002"], ambiguous: true },
];
for (let seed = 11; seed <= 30; seed++) {
  for (const c of cases) {
    const personas = generatePersonas({ n: c.ambiguous ? 5 : 4, seed, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 } });
    for (const [i, p] of personas.entries()) {
      p.name = ["Robin Cole", "Alex Brown", "Alex Jones", "Jamie Stone", "Alex Baker"][i]!;
      p.joinDay = 0; p.hidden.responsiveness = { latencyMedianMin: 1, latencySigma: 0, ignoreProb: 0 };
    }
    const network = new TextNetwork({ seed, randomIntros: false });
    const world = new World({ seed, personas, days: 2, network, writeLog: false,
      runId: "initial-names-" + seed + "-" + c.label,
      actions: personas.map((p: any) => ({ at: DEFAULT_START + 9 * HOUR, action: { do: "join", persona: p.id } })) });
    await world.begin(); await world.advanceTo(DEFAULT_START + DAY + 12 * HOUR);
    const body = c.end ? "For coffee, would you like to meet " + c.names : "Would you like to meet " + c.names + " for coffee? Reply STOP to pause.";
    const message = network.channelContext.send(personas[0]!.id, body, { meta: { proactive: true } });
    await world.advanceTo(world.end); const r = await world.complete();
    const proposal = r.memories.get(personas[0]!.id)!.proposals["inferred:" + message.id];
    const replies = r.channel.all().filter((x: any) => x.direction === "inbound" && x.memberId === personas[0]!.id && x.ts > message.ts).map((x: any) => ({ ts: x.ts, body: x.body }));
    console.log(JSON.stringify({ kind: "name", seed, label: c.label, paired: c.paired, expected: c.ids,
      joined: r.metrics.run.joined, delivered: message.status, proposal, replies }));
  }
  const personas = generatePersonas({ n: 40, seed });
  const r = await runWorld({ seed, personas, days: 14, network: new StubNetwork({ seed }), writeLog: false, runId: "initial-names-control-" + seed });
  console.log(JSON.stringify({ kind: "control", seed, trace: hash(r.records), metrics: r.metrics, messages: hash(r.channel.all()), memories: hash(r.memories) }));
}
~~~

## safety_gates and qualification

| Check | Result |
|---|---|
| bun run typecheck | All four configurations pass; exit 0 |
| Network and Friends simulation, base | 79/79 blocking gates pass; 245.3 seconds |
| Same simulation command, fixed revision | 79/79 blocking gates pass; 223.9 seconds |
| bun run test:integration | 676 pass, 8 skip, 6 known failures; 13,742 assertions; 557.39 seconds |
| bun run test:e2e | 42 pass, 1 skip, 0 fail; 654 assertions; 78.26 seconds |

All 84 simulation gate records are identical after excluding elapsed time.
The five tracked records include one existing miss: undetected-adversary harm remains 17.5 versus 10.5 per seed (1.67x).
Invariant, canary-leak and minor-contact gates retain their passing values.

The new regression passed inside the official integration command in 20.90 ms.
The six failures match the recorded base by test name and underlying error:
missing /bin/bash for Wrangler, SIGTERM exit 143 instead of 0, and four Windows site-build path assertions.
The integration command includes the security suite. It exited 1; a fully green integration suite is not claimed.
Eight optional isolated-cleanup cases skipped. The optional browser SDK end-to-end case also skipped.
The task-owned database was stopped after both suites finished and no client sessions remained.

The paired gate command is bun run sim --only network,friends --json OUTPUT, without --quick.
The baseline is the earlier successful run at the same unchanged main commit, reused from the fractional-hours qualification.
Network uses its checked-in seed 3 invariant run, seeds 1-3 consent arms, scenarios and conformance checks.
Friends uses seeds 5-8, 400 personas, eight weeks and its additional conformance and planner checks.
Simulated reviewers handle approvals in these offline runs.

The full simulation was not repeated: AGENTS.md permits one per agent, already used for PR #355.
No gate threshold changes.
Live sends and deployments were disabled.
Service tests use isolated local PostgreSQL on port 54339.

## llm_evidence and agent_clients

N/A for real-model qualification: this change fixes deterministic participant lookup before persona decisions or voice generation.
No prompt, provider adapter or model-backed behavior changes or claims.
Real-model calls: 0; cost: $0; request settings: N/A.
Real-model phrasing quality has not been tested.

Codex desktop 26.1103.3517.0 drove the local commands on 2026-11-07.
Assistant provider: OpenAI. Its exact model identifier was not exposed and is reported as unavailable.
No member-facing agent-client workflow changes; no other client is claimed as tested.
No browser or computer use was performed, as instructed by the operator.
No production member data, secrets or raw run logs are included.
