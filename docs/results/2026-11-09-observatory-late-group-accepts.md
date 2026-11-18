# Count each accepting group member once

Date: 2026-11-09 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for the official suites.

## Problem and requirement

In the Observatory simulation, six members can say yes to one group and produce fifteen acceptances.
The opt-in score becomes 250%. Some members receive three acceptance credits for one opportunity.
This is a reproduced analytics defect under PRD 28.2 and 35, and CONTRIBUTING 3.1.

The stub Network books a group when it reaches quorum.
A later yes adds that person and reports the same meeting again, including its existing participants.
`World.scheduleMeeting` explicitly supports this update.
The projector changes the first participants from `accepted` to `confirmed` on the first booking record.
On the next record, its acceptance guard excludes `accepted` and `countered`, but not `confirmed`.
It therefore counts the confirmed participants again.

Exclude `confirmed` from that increment. Keep updating the meeting and its participants.
New members still receive their first credit through the existing decision or booking path.

Alternatives considered:

1. Ignore every repeated meeting ID. That would also ignore the newly joined member's confirmation.
2. Track a separate set of counted member/opportunity pairs. The existing participant status already records this information.

The change is in the record projector. There is no UI, style, copy, scheduling, or consent-policy change.
It is separate from PR #404, which retracts a member's acceptance count after a decline.

## measurement

The single regression case starts the real HTTP server and drives its control and state endpoints.
It uses GameSource, TakeoverAgent, StubNetwork, the simulated channel, World, and Projector without mocks.
After seven days of onboarding, it takes over six joined adults and proposes one group.
It answers each real prompt with `yes` while advancing one day.
The Network books the first four, then adds the fifth and sixth through its normal late-join path.
The test requires six confirmed members, six acceptances, one meeting, a 100% opt-in score, and one acceptance per member.

Command, with the same new test copied into the base checkout:

```sh
bun test --conditions eliza-source packages/observatory/test/late-group-accepts.integration.test.ts
```

| Result | Base | Fix |
|---|---|---|
| Regression | 0 pass, 1 fail; 86.56 ms | 1 pass, 0 fail; 86.73 ms; 4 assertions |
| Acceptances for six members | 15 | 6 |
| Opt-in score | 2.5 | 1 |
| Per-member acceptance counts | 3, 3, 3, 3, 2, 1 | 1, 1, 1, 1, 1, 1 |

The paired measurement below uses initial populations of 24 and 80, seeds 1, 7, 11, and 23, and groups of 2-6.
Each world lasts twelve days, uses the stub Network, and disables automatic engine proposals.
It uses the same HTTP commands and answers as the regression.
It reads results after booking on day eight and after reminders, attendance, and feedback on day twelve.
There are 40 worlds and 80 observations on each revision.
The initial reproduction used seed 1 and 24 personas; the other populations and seeds confirm it without tuning.

| Members saying yes | Booking records per world | Base accepts | Fixed accepts | Base opt-in | Fixed opt-in |
|---|---|---|---|---|---|
| 2 | 1 | 2 | 2 | 100% | 100% |
| 3 | 1 | 3 | 3 | 100% | 100% |
| 4 | 2 | 7 | 4 | 175% | 100% |
| 5 | 2 | 9 | 5 | 180% | 100% |
| 6 | 3 | 15 | 6 | 250% | 100% |

All eight configurations give these results at both observation times.
Correct counts increase from 32/80 to 80/80. The 32 single-booking control observations remain correct.
Every fixed member count is one.
Channel hashes match in all 80 comparisons.
Run-record hashes also match after removing the wall-clock run ID and elapsed duration.
The remaining compared state matches after excluding acceptance counters and the opt-in score.
The program below specifies these fields exactly. Timing and generated run IDs are not behavioral evidence.

The first ordinary engine runs did not produce a late group join.
They used 80 personas, seeds 1, 4, 7, and 11, and ten simulated days.
The controlled-member reproduction then exercised the existing late-join path directly.
The measurement harness initially omitted an `await` on `server.source()` and stopped; no results from that attempt are used.
Raw run hashes initially differed because run IDs contain wall-clock timestamps; the final comparison normalizes only those metadata fields.

## safety_gates

All 80 observations have zero judge invariant violations, zero canary leaks, and zero minor contacts before and after.
Only joined adults participate. The stub baseline has no reviewer or leak guard; this is not production safety qualification.
The unchanged channel and record hashes show that the projector correction does not change the simulated conversation or meeting execution.

`bun run sim --only audit,ops --json <output>` passes 30/30 blocking gates on both revisions, with no tracked misses.
All 31 gate records match after excluding elapsed time, including the backup-drill duration in its name.
Base duration: 32.2 seconds. Fixed duration: 25.7 seconds.
These blocks use the real isolated PostgreSQL cluster and the repository's fixed fixtures.
The full simulation was not repeated: AGENTS.md permits one full run per agent, already used for PR #355.

## Validation

`bun install --frozen-lockfile`: 50 installs across 44 packages checked, with no changes.
`bun run typecheck`: all four configurations pass.

`bun run test:integration`: 676 pass, 8 skip, 6 fail; 13,745 assertions across 69 files; 443.84 seconds.
The new regression passes inside this suite in 53.08 ms. The official integration command includes the security suite.
The six failures match the previously reproduced base failures in both test names and causes:

- `deploy/wrangler.integration.test.ts`: `/bin/bash` is unavailable on Windows.
- `deploy/backend/backend.test.ts`: SIGTERM returns 143 instead of the expected 0.
- `sites/test/sites.test.ts`: four assertions expect slash-separated paths, while Windows returns backslashes.

The eight skips are the existing optional cleanup-reconciliation cases.
`bun run test:e2e`: 42 pass, 1 skip, 0 fail; 654 assertions; 35.36 seconds.
The skipped case requires the optional browser SDK environment. Browser acceptance is not claimed.
All test processes finished; the isolated database had no other clients and was stopped afterwards.
A fully green local integration suite is not claimed.

## llm_evidence

N/A: the defect and fix are deterministic record accounting. No model-backed behavior changes.
Real-model calls: 0. Cost: $0. No provider request settings apply.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun 1.4.2 and the local HTTP API, with OpenAI assistance.
The exact assistant model identifier was not exposed; disclosure uses the helper's supported `unavailable` value.
N/A for other agent clients: this changes simulation analytics, not a member-facing agent integration.
No browser or computer use was performed. No other client is claimed as tested.

## Limits

This proves the documented group-booking path in the stub simulation.
It does not qualify production matching, alter acceptance policy, or claim general event-stream deduplication.
Historical results are not rewritten. The corrected counts apply when the projector processes the records.
No secrets, real member data, or raw conversation logs are included.

## Reproduce the paired measurement

Save the following program outside each checkout as `../late-group-measure.ts`.
Run it from the base and fixed repository roots with the same program.
Clear live-send flags and provider keys; use only the synthetic local configuration below.

```powershell
$env:LATE_GROUP_OUTPUT = '../late-group-before.json' # use late-group-after.json on the fixed branch
bun run --conditions eliza-source ../late-group-measure.ts
```

Compare rows by population, seed, group size, and phase.
Expect `accepts === expected`, every `memberCounts` entry equal to one, and `optIn === 1` after the fix.
Expect `unchangedHash`, `recordsHash`, `channelHash`, and `safety` to match before and after.

```ts
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const DAY = 86_400_000, results = [];
const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
for (const personas of [24, 80]) for (const seed of [1, 7, 11, 23]) for (const size of [2, 3, 4, 5, 6]) {
  const dir = await mkdtemp(join(tmpdir(), "late-group-measure-"));
  const token = "late-group-local-measure-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed, personas, days: 12, network: "stub", engine: "off", pushMs: 3_600_000, tickMs: 3_600_000 } });
  const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
  const control = async (command: unknown) => {
    const response = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(command) });
    const body = await response.json();
    if (response.status !== 200 || !body.ok) throw Error(JSON.stringify(body));
    return body;
  };
  async function step(ms: number) {
    let done = false;
    const pending = control({ type: "step", ms }).finally(() => { done = true; });
    const deadline = performance.now() + 10_000;
    while (!done && performance.now() < deadline) {
      const prompt = (await state()).game?.prompts[0];
      if (prompt) await control({ type: "reply", promptId: prompt.id, text: "yes" });
      else await Bun.sleep(1);
    }
    if (!done) throw Error("Step did not finish");
    await pending;
  }
  try {
    await step(7 * DAY);
    const members = (await state()).members.filter((m: any) => m.joined && !m.minor && !m.declined && m.state !== "opted_out").slice(0, size);
    if (members.length !== size) throw Error("Insufficient joined adults");
    for (const m of members) await control({ type: "takeover", memberId: m.id, on: true });
    const proposalId = (await control({ type: "propose", participants: members.map((m: any) => m.id) })).data.id;
    for (const [phase, duration] of [["booked", DAY], ["finished", 4 * DAY]] as const) {
      await step(duration);
      const s = await state(), game = await server.source() as any;
      const meetingRecords = game.world.records.filter((r: any) => r.type === "meeting_scheduled" && r.proposalId === proposalId);
      if (!meetingRecords.length) throw Error(`No booking: ${personas}/${seed}/${size}`);
      const { accepts, scorecard, ...stats } = s.stats;
      const optIn = scorecard.find((m: any) => m.key === "opt_in");
      const memberCounts = s.members.filter((m: any) => members.some((p: any) => p.id === m.id)).map((m: any) => m.counters.accepted);
      const unchanged = { clock: s.clock, opportunities: s.opportunities, game: s.game, requests: s.requests, edges: s.edges,
        stats: { ...stats, scorecard: scorecard.filter((m: any) => m.key !== "opt_in") },
        members: s.members.map((m: any) => { const { accepted, ...counters } = m.counters; return { ...m, counters }; }) };
      results.push({ personas, seed, size, phase, accepts, expected: size, memberCounts, optIn: optIn.value,
        invites: s.stats.invites, meetingUpdates: meetingRecords.length, meetings: s.stats.meetingsScheduled,
        state: s.opportunities.find((o: any) => o.id === proposalId).state,
        safety: s.stats.judge, unchangedHash: hash(unchanged), recordsHash: hash(game.world.records.map((r: any) => {
          if (r.type === "run_start") { const { runId, ...record } = r; return record; }
          if (r.type === "run_end") { const { wallMs, ...record } = r; return record; }
          return r;
        })), channelHash: hash(game.world.channel.all()) });
    }
  } finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
}
await Bun.write(process.env.LATE_GROUP_OUTPUT!, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ personas, seed, size, phase, accepts, memberCounts, optIn, meetingUpdates, state, safety }) =>
  ({ personas, seed, size, phase, accepts, memberCounts, optIn, meetingUpdates, state, safety }))));
```
