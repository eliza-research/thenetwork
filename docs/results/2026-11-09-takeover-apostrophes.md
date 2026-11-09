# Preserve cancellation notice for apostrophe variants

Date: 2026-11-09. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2, Windows, PostgreSQL 16.15.

## Requirement and cause

This is a reproduced simulation defect under the approved Slop scope and
CONTRIBUTING 3.1. PRD 34.3 covers the world simulator. The member role in
`docs/observatory.md` section 4 requires the world to act on the player's reply
and attendance commitment.

Takeover checks cancellation phrases against raw text before reading yes/no.
Its pattern recognizes an ASCII apostrophe in `can't`. A curly apostrophe
misses that branch and reaches the existing normalized yes/no parser instead.
The same cancellation becomes `decline` instead of `flake_notice`. The World
does not register cancellation notice for that decision.

In the native seed-7 run, `I can't make it` produces an absence with notice.
`I can’t make it` produces an absence without notice. This changes the meeting
record's no-show classification merely because punctuation changed.

Apply the existing `normText` helper only to the cancellation predicate.
The helper already normalizes apostrophe variants for other Network readers.
The original reply text continues through the HTTP response and channel.

Alternatives considered:

1. Add apostrophe alternatives to each local phrase. This duplicates the
   shared normalization rules and is easier to leave incomplete.
2. Replace the cancellation rule with `classify(text)`. That classifier has
   different phrase coverage, including different handling of bare `cancel`.
3. Normalize the entire reply before processing it. That needlessly changes
   the player's recorded text.

This change preserves the existing cancellation phrase rules. It does not
resolve the separate false cancellation from negated mentions of `cancel`.
PR #301 normalizes the Network classifier; it does not touch TakeoverAgent.
This change uses an existing export and does not depend on that PR.

## measurement

The committed integration case runs the real HTTP server, FileAudit, native
World, ConsentNetwork and policy personas. It advances a seed-7 generated
world with 80 personas for seven days, then takes over joined adults.
While advancing four more days, it auto-answers prompts until a booked
proposal arrives. The player answers `I can’t make it` through HTTP.
The case checks the control response and the native meeting outcome.

```sh
bun test --conditions eliza-source packages/observatory/test/takeover-apostrophes.integration.test.ts
```

On base: 0 pass, 1 fail, 2 assertions, 2248.94 ms. Cancellation notice is false.
With the fix: 1 pass, 0 fail, 2 assertions, 2311.92 ms. Notice is true.
No method, clock, response, record or persona memory is mocked.

The wider program below runs 32 cases per revision. Each uses 80 personas,
a 14-day horizon, and eleven days of actual advancement. Seeds: 1, 7, 11, 23.
The eight replies per seed are:

- `I can't make it`, plus right-curly, left-curly and modifier-apostrophe variants.
- `I can't come`, plus its right-curly variant.
- `Yes, I'll be there` and bare `cancel` as additional controls.

Each run selects the first native booked proposal after day seven. Earlier
prompts use the persona's own policy. After the selected reply, control is
released and the world advances to the outcome. Consent review uses the
simulated reviewer (`review: "auto"`). Policy defaults apply; time-aware mode
is off.

| Result | Before | After |
|---|---:|---:|
| Apostrophe variants match their ASCII reference's decision, memory and outcome | 0/16 | 16/16 |
| Variant absence records missing cancellation notice | 12/16 | 0/16 |
| ASCII control runs preserved exactly | 16 | 16 |
| Original player text delivered unchanged | 32/32 | 32/32 |

Four base variants later receive notice from an automatic reminder reply.
Their initial cancellation decision is still wrong; that later notice masks
the final attendance difference. The other twelve retain the missing notice.

All 32 paired cases start the selected reply with identical record and
message hashes. All 16 ASCII controls retain identical HTTP results, memories,
meeting outcomes, full record hashes, message hashes and memory hashes.
Record hashing removes only generated `run_start.runId` and elapsed
`run_end.wallMs`. Changed variants are compared with their ASCII reference
for cancellation semantics, not claimed to have unchanged full histories.

## safety_gates

All 32 measured worlds have zero judge invariants, canary leaks and minor
contacts on both revisions. Every judge field matches its paired baseline.
The observation ends after eleven simulated days.

Fresh audit and operations blocks pass 30/30 blocking gates on both revisions,
with zero tracked misses. All 31 gate records match after excluding durations,
including the restore duration embedded in the backup-drill label.
Runtime: 25.3 seconds before and 24.3 seconds after; these timings are incidental.

## Validation and limits

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | Passed; no dependency changes |
| `bun run typecheck` | All four configurations passed |
| Regression command above | Base fails; candidate passes, 2 assertions |
| `bun run test:integration` | 676 pass, 8 skip, 6 fail; 13,743 assertions; 431.58 seconds |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail; 654 assertions; 34.13 seconds |

The integration command includes all security-suite files. Its six failures
match the previously reproduced Windows baseline by name and cause: Wrangler
cannot spawn `/bin/bash`; SIGTERM returns 143 instead of 0; four site builds
fail slash-sensitive asset assertions. No new failure appears. The regression
also passes within the full run, 2620.04 ms. Eight optional reconciliation cases
are skipped; the end-to-end skip requires the optional SDK/Playwright setup.
Local PostgreSQL was required and available for integration and end-to-end tests.

The initial gate attempts used the wrong local PostgreSQL port and skipped
database gates. They are excluded from the final evidence. Both blocks were
rerun with the database verified on port 54339.

AGENTS.md permits at most one full simulation per agent, already used during
earlier work. These fresh affected-block results are not another full-suite run.
No UI, style, copy, dependency or cancellation-policy change is included.

## llm_evidence

N/A: deterministic handling of the player's text. The other personas use
PolicyPersonaAgent. Model calls: 0. Provider/model for calls: N/A. Cost: 0.

## agent_clients

Codex desktop 26.1103.4239.0 drove the local commands on Windows.
Authoring provider: OpenAI. Exact authoring model: unavailable to this session.
No signup, MCP or external messaging workflow changes. Other clients were
not tested. The HTTP server and all persona data are local and synthetic.

## Reproduce the paired measurement

Save the first program as `../takeover-apostrophes-measure.ts` outside the
repository. Run it from each checkout using different output paths.
Use local test configuration without provider credentials or live-send flags.
The audit and operations blocks require local PostgreSQL.

```sh
bun install --frozen-lockfile
bun run --conditions eliza-source ../takeover-apostrophes-measure.ts ../takeover-apostrophes-before.json
bun run sim --only audit,ops --json ../takeover-apostrophes-gates-before.json
# From the candidate checkout:
bun run --conditions eliza-source ../takeover-apostrophes-measure.ts ../takeover-apostrophes-after.json
bun run sim --only audit,ops --json ../takeover-apostrophes-gates-after.json
```

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const root = process.cwd().replaceAll("\\", "/");
const { createServer } = await import(pathToFileURL(`${root}/packages/observatory/src/server.ts`).href);
const { FileAudit } = await import(pathToFileURL(`${root}/packages/observatory/src/staff.ts`).href);
const hash = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex");
const records = (source: any) => source.world.records.map((r: any) => {
  if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
  if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
  return r;
});
const cases = [
  { id: "ascii_make", text: "I can't make it", reference: "ascii_make" },
  { id: "right_make", text: "I can’t make it", reference: "ascii_make" },
  { id: "left_make", text: "I can‘t make it", reference: "ascii_make" },
  { id: "modifier_make", text: "I canʼt make it", reference: "ascii_make" },
  { id: "ascii_come", text: "I can't come", reference: "ascii_come" },
  { id: "right_come", text: "I can’t come", reference: "ascii_come" },
  { id: "yes", text: "Yes, I'll be there", reference: "yes" },
  { id: "cancel", text: "cancel", reference: "cancel" },
];
const rows = [];
for (const seed of [1, 7, 11, 23]) for (const variant of cases) {
  const dir = await mkdtemp(join(tmpdir(), "takeover-apostrophes-measure-"));
  const token = "local-takeover-apostrophes-000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") },
    game: { seed, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  const control = async (cmd: unknown) => {
    const r = await fetch(`${server.url}/api/control`, { method: "POST", headers, body: JSON.stringify(cmd) });
    const result = await r.json();
    if (r.status !== 200 || !result.ok) throw Error(`Control failed: ${JSON.stringify(result)}`);
    return result;
  };
  const source = await server.source("game");
  let step: Promise<any> | undefined;
  try {
    await control({ type: "step", ms: 7 * 86_400_000 });
    for (const m of source.state().members.filter((m: any) => m.joined && !m.minor))
      await control({ type: "takeover", memberId: m.id, on: true });
    let done = false, selected: any;
    step = control({ type: "step", ms: 4 * 86_400_000 }).finally(() => { done = true; });
    const deadline = performance.now() + 40_000;
    while (!done && !selected && performance.now() < deadline) {
      const state = await fetch(`${server.url}/api/state`, { headers }).then(r => r.json());
      for (const prompt of state.game?.prompts ?? []) {
        const message = source.world.channel.messagesFor(prompt.memberId).find((m: any) => m.id === prompt.messageId);
        if (message?.meta?.booked && prompt.proposalId) {
          const preRecordsHash = hash(records(source)), preMessagesHash = hash(source.world.channel.all());
          const reply = await control({ type: "reply", promptId: prompt.id, text: variant.text });
          selected = { memberId: prompt.memberId, proposalId: prompt.proposalId, messageId: prompt.messageId,
            preRecordsHash, preMessagesHash, reply,
            memory: structuredClone(source.world.memories.get(prompt.memberId)?.proposals[prompt.proposalId]) };
          break;
        }
        await control({ type: "reply", promptId: prompt.id, auto: true });
      }
      await Bun.sleep(1);
    }
    if (!selected) throw Error(`No booked prompt for seed ${seed}`);
    for (const memberId of source.state().game?.controlled ?? [])
      await source.control({ type: "takeover", memberId, on: false });
    await step;
    const outcomes = source.world.records.filter((r: any) => r.type === "outcome" && r.proposalId === selected.proposalId)
      .map((r: any) => r.attendance[selected.memberId]);
    if (outcomes.length !== 1) throw Error("Expected one native meeting outcome");
    const decision = source.world.records.find((r: any) => r.type === "decision" && r.messageId === selected.messageId);
    const textPreserved = source.world.channel.messagesFor(selected.memberId)
      .some((m: any) => m.direction === "inbound" && m.body === variant.text);
    rows.push({ seed, ...variant, selected, decision, outcome: outcomes[0], textPreserved,
      recordsHash: hash(records(source)), messagesHash: hash(source.world.channel.all()),
      memoriesHash: hash([...source.world.memories]), judge: source.state().stats.judge });
    console.log(JSON.stringify({ seed, id: variant.id, intent: decision?.intent, outcome: outcomes[0], textPreserved }));
  } finally {
    for (const memberId of source.state().game?.controlled ?? [])
      await source.control({ type: "takeover", memberId, on: false });
    await step;
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}
await Bun.write(process.argv[2]!, JSON.stringify(rows, null, 2) + "\n");
```

Save the next program as `../takeover-apostrophes-compare.ts`, then run:

```sh
bun run ../takeover-apostrophes-compare.ts ../takeover-apostrophes-before.json ../takeover-apostrophes-after.json ../takeover-apostrophes-gates-before.json ../takeover-apostrophes-gates-after.json
```

Expect all 16 variants to match their ASCII references, zero missing notices,
16 unchanged controls, unchanged judge values and all 30 blocking gates passing.

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
if (before.length !== 32 || after.length !== 32) throw Error("Expected 32 native runs per revision");
const same = (a: any, b: any, why: string) => { if (!isDeepStrictEqual(a, b)) throw Error(why); };
const semantics = (r: any) => ({ reply: { ok: r.selected.reply.ok, intent: r.selected.reply.data?.intent, decision: r.selected.reply.data?.decision },
  intent: r.decision?.intent, decision: r.decision?.decision,
  proposalId: r.decision?.proposalId, memory: r.selected.memory, outcome: r.outcome });
let variants = 0, controls = 0, equalBefore = 0, equalAfter = 0, missingBefore = 0, missingAfter = 0;
for (const row of after) {
  const old = before.find((r: any) => r.seed === row.seed && r.id === row.id);
  if (!old) throw Error("Missing baseline case");
  same([row.selected.memberId, row.selected.proposalId, row.selected.messageId,
    row.selected.preRecordsHash, row.selected.preMessagesHash],
  [old.selected.memberId, old.selected.proposalId, old.selected.messageId,
    old.selected.preRecordsHash, old.selected.preMessagesHash], "Native state before reply changed");
  same(row.judge, old.judge, "Judge safety values changed");
  if (!old.textPreserved || !row.textPreserved) throw Error("Original reply text was not delivered");
  if (row.reference === row.id) { controls++; same(row, old, "ASCII control changed"); continue; }
  variants++;
  const bRef = before.find((r: any) => r.seed === row.seed && r.id === row.reference);
  const aRef = after.find((r: any) => r.seed === row.seed && r.id === row.reference);
  same([row.selected.preRecordsHash, row.selected.preMessagesHash],
    [aRef.selected.preRecordsHash, aRef.selected.preMessagesHash], "Variant and reference worlds differed before the reply");
  equalBefore += Number(isDeepStrictEqual(semantics(old), semantics(bRef)));
  equalAfter += Number(isDeepStrictEqual(semantics(row), semantics(aRef)));
  same(semantics(row), semantics(aRef), "Apostrophe variant differs from its ASCII reference");
  if (!old.outcome.cancelledWithNotice) missingBefore++;
  if (!row.outcome.cancelledWithNotice) missingAfter++;
}
const b = await Bun.file(process.argv[4]!).json(), a = await Bun.file(process.argv[5]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
same(gates(b), gates(a), "Audit/operations gate values changed");
if (a.gates.length !== 31 || a.gates.filter((g: any) => g.blocking).length !== 30 || a.gates.some((g: any) => !g.pass))
  throw Error("Expected all 30 blocking and one tracked gate to pass");
console.log(JSON.stringify({ runs: after.length, variants, unchangedControls: controls,
  equivalentBefore: equalBefore, equivalentAfter: equalAfter,
  missingNoticeBefore: missingBefore, missingNoticeAfter: missingAfter,
  unchangedSafety: after.map(({ seed, id, judge }: any) => ({ seed, id, judge })),
  gateRecords: a.gates.length, blockingGates: a.gates.filter((g: any) => g.blocking).length,
  failingGates: a.gates.filter((g: any) => !g.pass).length }, null, 2));
```
