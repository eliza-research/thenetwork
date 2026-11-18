# Takeover confirmations that negate cancellation

## Requirement and cause

This fixes a reproduced simulation defect under CONTRIBUTING 3.1, PRD 34.3,
and the member role in `docs/observatory.md` section 4. That role requires the
world to act on the player's reply and attendance commitment.

At base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, a player answers an actual
booked-proposal prompt with `Yes, keep the plan; do not cancel it`.
Takeover returns `intent: flake_notice`, `decision: none`, and sets the
persona's `plannedShow` to false. The native meeting records cancellation
notice and no attendance. The existing Network reply reader reads this text
as yes. Takeover never reaches it: its earlier cancellation expression
matches the word `cancel` inside the negation.

The fix excludes a cancellation match immediately after `don't`, `do not`,
`not`, or `never`, including an intervening `ever`, `please`, or `just`.
The contraction also accepts the existing apostrophe forms used in replies.
This applies to that match, not to the whole message. A separate `cancel`,
`can't come`, `can't make it`, or `have to bail` still reaches the cancellation
branch. The player's original text is retained.

The guard does not set a consent decision. The existing reply reader still
decides whether the original text is a confirmation, refusal, counteroffer,
or unclear reply.
Unclear replies retain the existing persona-policy fallback.

Alternatives considered:

1. Replace the local predicate with `classify(text).kind === "cancel"`.
   An earlier investigation reproduced the confirmation fix this way, but
   rejected it because the classifier does not recognize the existing bare
   `cancel` command. That patch was reverted and was not published.
2. Check yes before cancellation. `Yes ... actually, cancel it` is read as yes
   by the current reply reader; this would suppress a real cancellation.
3. Skip the whole cancellation branch whenever a negation occurs. This would
   lose `Do not cancel the restaurant; I can't come`.

PRs #218 and #261 change Network cancellation parsing. PR #429 normalizes
Takeover's input punctuation. They do not fix this local negated-keyword
precedence. This branch starts from main and includes none of those changes.
There is no UI, copy, dependency, production Network, or threshold change.

## measurement

Runtime: Bun 1.4.2, Windows. Both revisions use the same program below.
The worlds are generated, synthetic NYC personas, with the native
ConsentNetwork and policy persona agent. No world records or replies are
mocked. The simulated reviewer uses the game's existing automatic review.

Each run creates a real local HTTP server with 80 personas and a 14-day
horizon. It advances seven days, takes over joined adults, then advances four
days while answering earlier prompts through the persona policy. It answers
the first native booked-proposal prompt with the selected text. After
releasing control, it awaits the existing step and observes the real meeting.
The source API is used to read native evidence and release control during
cleanup; setup, stepping, takeover, and the selected reply use HTTP.

There are 17 texts for each of seeds 1, 7, 11, and 23: 68 worlds per revision.
Eight texts are clear confirmations with a negated cancellation; one contains
`never` and remains unclear to the shared reader; eight are controls.
Seed 1 supplied the initial reproduction. The other seeds were not used to
change the predicate. This is a deterministic semantic comparison, not a
statistical estimate of real users or matching quality.

| Result | Before | After |
|---|---:|---:|
| Clear confirmations followed by native attendance | 0/32 | 32/32 |
| Clear confirmations wrongly recorded as cancellation with notice | 32/32 | 0/32 |
| Keyword-only `flake_notice` decisions among the nine negated texts | 36/36 | 0/36 |
| Unclear `never` replies matching the ordinary unclear control | Cancellation override | 4/4 |
| Entire ordinary and mixed-clause control rows unchanged | Reference | 32/32 |
| Original player texts retained | 68/68 | 68/68 |
| Judge invariants, canary leaks, minor contacts | 0, 0, 0 | 0, 0, 0 |

Each corrected confirmation has the same native attendance and enjoyment as
its ordinary yes control. Enjoyment is 0.782, 0.209, 0.551, and 0.506 for seeds
1, 7, 11, and 23 respectively. These are simulated outcomes, not estimates
of actual user enjoyment. The four `never` replies follow the same policy
decisions and outcomes as `Maybe`: seed 1 declines with notice, seed 7 accepts
but does not attend, and seeds 11 and 23 accept and attend. This is the existing
unclear-reply fallback, not a claim that those player texts express consent.

All worlds begin at identical native record and message hashes for each
paired reply. Control comparisons require the entire output row to match,
including native record, message, and persona-memory hashes. Record hashes
exclude only `run_start.runId` and `run_end.wallMs`; messages and memories are
not normalized. Every original player reply must remain in message history.
Changed replies must match their ordinary yes or unclear control in decision,
persona memory, and native attendance outcome.

The committed regression uses one real HTTP integration case with four
replies. On main it fails on the first confirmation: 0 pass, 1 fail, 1
assertion, 1712.66 ms. With the fix it passes all four replies: 1 pass, 0 fail,
4 assertions, 7125.61 ms. The case covers two confirmations, bare `cancel`,
and a negated clause followed by a real refusal.

## safety_gates

Frozen install checked 50 installs without changes. All four typecheck
configurations pass. Audit/operations pass 30/30 blocking gates with zero
tracked gates off target on both revisions: 26.5 seconds before, 27.7 after.
All 31 gate records match after excluding per-gate elapsed time and the
backup-drill label's restore time. The backup keeps 69 tables, 71 rows and a
274 KiB dump; only elapsed restore time is normalized.

Official integration, including security: 676 pass, 8 skip, 6 fail; 13,745
assertions across 690 tests and 69 files in 446.31 seconds. The new regression
passes in that suite in 9225.19 ms. The validator requires the exact six
baseline failure names and diagnostic causes: missing `/bin/bash`, the
backend SIGTERM exit 143 rather than 0, and four Windows site-path assertions.
The integration skip names also match the previous baseline run.

Official end-to-end: 42 pass, 1 skip, 0 fail; 654 assertions in 35.90 seconds.
The optional browser SDK recovery-feedback case is skipped. The six Windows
integration failures remain; a fully green local integration suite is not
claimed. Postgres was stopped after validation, with zero active clients.

Live-send, deploy, and provider flags were cleared for validation. Postgres
uses the isolated local test directory on port 54339.
The full simulation is not repeated: AGENTS.md allows one full run per agent,
already used for PR #355. The affected audit and operations blocks run on
both revisions. No earlier full-run result is claimed for this commit.

## llm_evidence

N/A: the defect and fix are deterministic in the local simulator's player
reply adapter. Policy personas and the shared rule reader handle these
replies. No model-backed behavior is changed or validated. Real-model calls:
0; cost: $0. This does not claim real-LLM qualification.

## agent_clients

Codex desktop 26.1103.4239.0 drove Bun and the local HTTP API. Provider:
OpenAI. The exact assistant model identifier is unavailable in this session.
No browser or computer use was performed. There is no change to site skills,
MCP, production agent integrations, or their clients. Other agent clients
are not claimed as tested.

## Limits

This is a bounded correction to the local cancellation predicate, not a new
general language parser. Quoted, conditional, or distant negations remain
subject to the existing readers. In particular, the shared reader still
treats `Yes, never cancel this plan` as unclear. Its native policy fallback
is measured explicitly; this fix does not force an acceptance for it.
The separate Network `no need to cancel` work remains in PR #218.
Only synthetic simulation behavior is claimed. No production service,
real member, live send, or deployment was used.

## Replay

Save the following programs outside the checkout with their named filenames. Use clean checkouts of
the base above and this PR, with frozen dependencies installed. The program
imports the source under its current working directory. Run from each:

```sh
bun run --conditions eliza-source ../takeover-negated-measure.ts ../before.json
# Run the same command in the candidate checkout, with ../after.json.
bun run --conditions eliza-source ../takeover-negated-compare.ts ../before.json ../after.json
bun test --conditions eliza-source packages/observatory/test/takeover-negated-cancel.integration.test.ts
bun run typecheck
bun run sim --only audit,ops --json ../gates.json
# Run on each revision, then compare its two saved gate files:
bun run ../takeover-negated-gates-compare.ts ../gates-before.json ../gates-after.json
bun run test:integration
bun run test:e2e
```

The last two commands require local Postgres and include the security suite.
Use the same seeds and commands on both revisions. Run the regression on the
base by copying only its test file into the base checkout, or run it before
applying the production change, as done here.


Measurement output SHA-256 digests:

- Before: `5d129c43a7a577462a3ae7619d4f6befdb552cbd87fb83a53b37f1eab2766294`.
- After: `f7e3a31f1860128c932b2ba56889b0ebb96369fe9c45eda603e7dbaa60b7893e`.

## Measurement program

`takeover-negated-measure.ts`

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
  { id: "do_not", text: "Yes, keep the plan; do not cancel it", reference: "yes" },
  { id: "dont", text: "Yes, please don't cancel it", reference: "yes" },
  { id: "curly_dont", text: "Yes, please don’t cancel it", reference: "yes" },
  { id: "bare_dont", text: "Yes, please dont cancel it", reference: "yes" },
  { id: "before_yes", text: "Please do not cancel, yes I can make it", reference: "yes" },
  { id: "ever", text: "Yes, don't ever cancel this plan", reference: "yes" },
  { id: "not", text: "Yes, keep it, not cancel it", reference: "yes" },
  { id: "modifier_dont", text: "Yes, please donʼt cancel it", reference: "yes" },
  { id: "never", text: "Yes, never cancel this plan", reference: "unclear" },
  { id: "yes", text: "Yes, I'll be there", reference: "yes" },
  { id: "unclear", text: "Maybe", reference: "unclear" },
  { id: "cancel", text: "cancel", reference: "cancel" },
  { id: "please_cancel", text: "Please cancel this plan", reference: "please_cancel" },
  { id: "cant", text: "I can't make it", reference: "cant" },
  { id: "bail", text: "I have to bail", reference: "bail" },
  { id: "mixed_cancel", text: "Yes, keep the plan; do not cancel it. Actually, cancel it", reference: "mixed_cancel" },
  { id: "mixed_cant", text: "Do not cancel the restaurant; I can't come", reference: "mixed_cant" },
];
const rows = [];
for (const seed of [1, 7, 11, 23]) for (const variant of cases) {
  const dir = await mkdtemp(join(tmpdir(), "takeover-negated-measure-"));
  const token = "local-takeover-negated-000000000";
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

## Paired comparison

`takeover-negated-compare.ts`

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const same = (a: unknown, b: unknown, why: string) => { if (!isDeepStrictEqual(a, b)) throw Error(why); };
if (before.length !== 68 || after.length !== 68) throw Error("Expected 68 native worlds per revision");
const semantics = (r: any) => ({ reply: { ok: r.selected.reply.ok, intent: r.selected.reply.data?.intent, decision: r.selected.reply.data?.decision },
  intent: r.decision?.intent, decision: r.decision?.decision, proposalId: r.decision?.proposalId,
  memory: r.selected.memory, outcome: r.outcome });
let changed = 0, controls = 0, falseNoticeBefore = 0, falseNoticeAfter = 0, confirmations = 0, unclear = 0;
for (const row of after) {
  const old = before.find((r: any) => r.seed === row.seed && r.id === row.id);
  if (!old) throw Error("Missing baseline world");
  same([row.selected.memberId, row.selected.proposalId, row.selected.messageId, row.selected.preRecordsHash, row.selected.preMessagesHash],
    [old.selected.memberId, old.selected.proposalId, old.selected.messageId, old.selected.preRecordsHash, old.selected.preMessagesHash], "Native state before reply changed");
  same(row.judge, old.judge, "Judge values changed");
  same([row.judge.invariants, row.judge.canaryLeaks, row.judge.minorContacts], [0, 0, 0], "Nonzero safety result");
  if (!old.textPreserved || !row.textPreserved) throw Error("Original reply was not delivered");
  if (row.id === row.reference) { controls++; same(row, old, `Control changed: ${row.seed}/${row.id}`); continue; }
  changed++;
  const ref = after.find((r: any) => r.seed === row.seed && r.id === row.reference);
  same([row.selected.preRecordsHash, row.selected.preMessagesHash], [ref.selected.preRecordsHash, ref.selected.preMessagesHash], "Variant and reference start differently");
  same(semantics(row), semantics(ref), `Reply or native outcome differs from reference: ${row.seed}/${row.id}`);
  if (row.reference === "yes") {
    confirmations++;
    same([old.decision.intent, old.selected.memory.plannedShow, old.outcome.showed, old.outcome.cancelledWithNotice],
      ["flake_notice", false, false, true], "Baseline did not reproduce false cancellation");
    same([row.decision.intent, row.decision.decision, row.selected.memory.plannedShow, row.outcome.showed, row.outcome.cancelledWithNotice],
      ["accept", "accept", true, true, false], "Confirmation or attendance was not kept");
  } else unclear++;
  falseNoticeBefore += Number(old.decision?.intent === "flake_notice");
  falseNoticeAfter += Number(row.decision?.intent === "flake_notice");
}
same([changed, controls, confirmations, unclear, falseNoticeBefore, falseNoticeAfter], [36, 32, 32, 4, 36, 0], "Unexpected measurement totals");
console.log(JSON.stringify({ worldsPerRevision: after.length, confirmations, unclearRepliesDelegatedToPolicy: unclear,
  keywordFlakeDecisionsBefore: falseNoticeBefore, keywordFlakeDecisionsAfter: falseNoticeAfter,
  confirmedAttendanceBefore: 0, confirmedAttendanceAfter: confirmations,
  unchangedControlWorlds: controls, originalTextPreserved: after.length,
  invariants: 0, canaryLeaks: 0, minorContacts: 0 }, null, 2));
```

## Gate comparison

`takeover-negated-gates-compare.ts`

```ts
import { isDeepStrictEqual } from "node:util";
const before = await Bun.file(process.argv[2]!).json(), after = await Bun.file(process.argv[3]!).json();
const gates = (r: any) => r.gates.map(({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name,
}));
if (!isDeepStrictEqual(gates(before), gates(after))) throw Error("Audit/operations gate values changed");
if (after.gates.length !== 31 || after.gates.filter((g: any) => g.blocking).length !== 30 || after.gates.some((g: any) => !g.pass))
  throw Error("Expected all 30 blocking gates and one tracked gate to pass");
console.log(JSON.stringify({ identicalGateRecords: 31, blockingGatesPassed: 30, trackedOffTarget: 0 }, null, 2));
```
