# Count only acceptances in experiment acceptance rates

Date: 2026-11-10 (Asia/Tokyo).
Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Runtime: Bun 1.4.2 on Windows, PostgreSQL 16.15 for the required database checks.

## Problem and requirement

The Network experiment counts a counteroffer as an accepted invitation.
This inflates `inviteYes`, `inviteAcceptRate`, `proposalsAllYes` and `proposalAllYesRate`.
The CLI prints these fields. The Observatory Lab reads the two rates.
The Network simulation gates also consume these counts.
This is a reproduced reporting defect under approved scope, CONTRIBUTING 3.1 and PRD 34.4's simulation measurements.

The report already reads native decisions and distinguishes accept, counter and decline.
Its acceptance set nevertheless admitted both accept and counter.
Only accept now enters that set.
The existing treatment of booked invitations remains: their recorded decision is used even when the response intent is silence.
A recorded accept with a silent response still counts; a recorded counter does not.
The invitation denominator and proposal cohort remain unchanged.

Alternatives considered:

1. Use the judge's acceptance result. That replaces this report's distinct cohort and booked-invitation treatment.
2. Change persona or Network decisions. That changes simulation behavior to hide a reporting error.
3. Filter counters out of the denominator. That inflates the rate by removing invitations which did not receive acceptance.

The selected change removes one condition from the existing reporting loop.
No parser, message, matching, safety, review or policy decision changes.
PR #271 corrects the judge, and #433 corrects Observatory projection and scoring; neither changes this experiment report.
PRs #426, #430, #431 and #432 change separate experiment fields or CLI validation.
Each current experiment patch applies cleanly alongside this change.

## measurement

The same native experiment program runs sixteen configurations on each revision:

- Consent, push baseline and push-v2: seeds 1, 7, 11 and 23, each for seven days.
- The four Network gate configurations: push baseline seed 1 and consent seeds 1-3, each for 21 days.

Each uses the existing 250-person synthetic NYC dataset and its seeded invited friends.
ConsentNetwork uses automatic simulated review. Default plan settings and policy personas are unchanged.
Seeds 7, 11 and 23 were not used to select the fix.
No join, message, decision, outcome or model response is mocked or inserted.

The reference counts native accept decisions by opportunity and member.
It then checks whether every invited participant accepted, retaining the existing minimum of two recipients.
Booked invitations use their recorded decision, preserving the experiment's existing convention.
The reference separately counts counteroffers without a recorded acceptance and silent accepted decisions.

| Arm | Seed | Days | Accepts: before → after | All-yes: before → after | Silent accepts retained |
|---|---:|---:|---:|---:|---:|
| consent | 1 | 7 | 37 → 36 | 17 → 17 | 2 |
| push_baseline | 1 | 7 | 68 → 68 | 20 → 20 | 0 |
| push_v2 | 1 | 7 | 120 → 118 | 32 → 31 | 11 |
| consent | 7 | 7 | 50 → 50 | 22 → 22 | 3 |
| push_baseline | 7 | 7 | 58 → 57 | 16 → 15 | 0 |
| push_v2 | 7 | 7 | 128 → 127 | 33 → 33 | 13 |
| consent | 11 | 7 | 45 → 43 | 21 → 19 | 3 |
| push_baseline | 11 | 7 | 58 → 58 | 17 → 17 | 0 |
| push_v2 | 11 | 7 | 102 → 101 | 24 → 24 | 5 |
| consent | 23 | 7 | 48 → 46 | 22 → 20 | 3 |
| push_baseline | 23 | 7 | 60 → 58 | 15 → 15 | 0 |
| push_v2 | 23 | 7 | 139 → 138 | 37 → 36 | 16 |
| push_baseline | 1 | 21 | 172 → 169 | 48 → 46 | 0 |
| consent | 1 | 21 | 138 → 136 | 65 → 64 | 11 |
| consent | 2 | 21 | 154 → 150 | 69 → 65 | 9 |
| consent | 3 | 21 | 140 → 134 | 65 → 59 | 16 |

13 worlds had overstated acceptance counts; all now match the reference.
44 reported field values changed. All 3 counter-free controls retain their complete reports.
All sixteen native record hashes and all other report fields remain identical.
Hash normalization removes only the generated run ID and wall-clock execution time.
All decision records, message bodies and delivery states remain in the hashes.

The actual CLI was also run on each revision:

```sh
bun run --conditions eliza-source packages/network/harness/experiment.ts --only push_v2 --days 7 --seed 1
```

It reports 120 accepted invitations before the fix and 118 after it.
The acceptance rate changes from 0.492 to 0.484.
Everyone-accepted proposals change from 32 to 31; their rate changes from 0.227 to 0.220.
Every other CLI JSON field matches, and both commands exit zero.

Artifact SHA-256 values:

- experiment-acceptance-before.json: `a34655986fff76cdbe186a4cf5590c05aec0ef77d09f459072e186de8344e2ff`.
- experiment-acceptance-after.json: `b9747c669e14b2124b6babe23567c4eba8c68402328155968fb609e27b9f8c33`.
- experiment-acceptance-cli-before.json: `363ebec39096dd655886400fab4deb54c2c1e7f52731ea3e46225229a927c2bd`.
- experiment-acceptance-cli-after.json: `556fee619798d8ff70ce0f1bd18a49a291f3c2f1de18adbcfd786ec8cefde1a9`.
- lab-matching-gates-before.json: `3f270a8380a1ba214b2351acaa9d877c1ad25464c8171fb295edd582cb63043c`.
- experiment-acceptance-gates-after.json: `073c1af1c438357bf24c0da38ad1902c4df2bb98d646388dc04f99407016b607`.

## Regression

One integration case runs the real seven-day push-v2 experiment with seed 1.
It verifies the two counteroffer records and eleven silent accepted decisions, then checks all four acceptance fields.
No recorded outcome is altered to create the fixture.

- Base: 0 pass, 1 fail, three assertions, 7.85 seconds.
- Fixed: 1 pass, 0 fail, three assertions, 7.88 seconds.
- Official integration run: the same case passes in 8398.00ms.

An earlier consent-only fixture reproduced 37 reported acceptances versus 36 actual acceptances.
The final fixture uses push-v2 to cover the everyone-accepted count in the same test case.
The production fix passed both fixtures on its first run.

## safety_gates

All sixteen judge results remain identical, including these existing baseline findings:

| Arm | Seed | Days | Existing invariants |
|---|---:|---:|---|
| push_baseline | 23 | 7 | 3 decliner_exposed |
| push_baseline | 1 | 21 | 6 over_budget, 3 decliner_exposed |

The other fourteen worlds have zero invariant violations.
All sixteen have zero canary leaks and minor contacts.
These are reporting corrections; they do not claim improved matching or fewer unsafe outcomes.

`bun run sim --only network,audit,ops --json <output>` passes 91/91 blocking gates and all three tracked gates.
The unchanged base evidence comes from the same main commit and dependency environment, in 249.6 seconds.
The candidate runs afresh in 243.6 seconds.
All gate states and blocking classifications remain unchanged.
90 of 94 semantic gate records are identical after execution times are removed.
The remaining details are independently reconstructed from the paired native experiment results:

| Gate detail | Before | After |
|---|---|---|
| fingerprint: consent vs push arms | 361f8cc2648fb9a6 | eb6b0abb27c8ef14 |
| consent vs push: everyone-yes (pooled seeds 1-3) > 0.73 | 0.847 | 0.800 |
| consent vs push: invite-yes (pooled) > 0.85 | 0.919 | 0.894 |
| consent vs push: push all-yes < 0.25 | 0.152 | 0.146 |

The fingerprint is the hash of the four pinned arm results, in their original order.
The comparator checks both fingerprints, both pooled rates and the push all-yes rate.
No threshold is changed.
The full simulation was not repeated: AGENTS.md's one-full-run-per-agent limit was already used earlier.
No earlier full-run result is claimed for this revision.

## Required validation

- Frozen install: 50 installs across 44 packages checked; no changes.
- Typecheck: all four configurations passed.
- Integration, including the security files: 676 pass, 8 skip, 6 fail; 13744 assertions; 690 tests in 69 files, 463.80s.
- Six failures match the reproduced Windows baseline by name and cause: missing `/bin/bash`, SIGTERM exit 143 versus 0, four path-separator assertions.
- Eight integration skips match the prior full validation.
- End-to-end: 42 pass, 1 skip, 0 fail; 654 assertions; 43 tests in 3 files, 47.48s. The optional browser SDK case remains skipped.
- `git diff --check`: passed.

The local integration suite is not fully green. No failure is suppressed or reclassified.
Database checks use an isolated PostgreSQL cluster on port 54339, stopped after all tests with zero other clients.
Provider, live-send and deploy flags were cleared. All people and data are synthetic.

## llm_evidence and agent_clients

N/A: the correction reads completed simulation decisions and makes no model calls.
Real-model calls: 0; model API cost: $0; model request settings: N/A.
There is no changed member-facing agent flow.
Codex desktop 26.1103.4239.0 drove Bun 1.4.2 on Windows.
Provider: OpenAI; the exact assistant model identifier was unavailable and is not inferred.
No other client, browser or computer-use workflow is claimed as tested.

## Reproduce

1. Run `bun install --frozen-lockfile`.
2. Run `bun test --conditions eliza-source packages/network/test/experiment-acceptance.integration.test.ts`.
3. Expect one passing case with three assertions.
4. Run the CLI command above. Expect 118 acceptances and 31 everyone-accepted proposals.
5. Save the programs below beside separate base and candidate checkouts.
6. Run the following commands from the base checkout, then repeat with `after` output names from the candidate.

```sh
bun run --conditions eliza-source ../experiment-acceptance-measure.ts ../experiment-acceptance-before.json
bun run sim --only network,audit,ops --json ../experiment-acceptance-gates-before.json
# After both revisions finish:
bun ../experiment-acceptance-compare.ts ../experiment-acceptance-before.json ../experiment-acceptance-after.json
bun ../experiment-acceptance-gates-compare.ts ../experiment-acceptance-gates-before.json ../experiment-acceptance-gates-after.json ../experiment-acceptance-before.json ../experiment-acceptance-after.json
```

The audit and operations blocks require local PostgreSQL.
Put its binaries on `PATH`; set `USER=postgres`, `OBSERVATORY_PG_PORT=54339`, `OBSERVATORY_PG_DIR` to the isolated cluster, and `REQUIRE_PG=1`.

### experiment-acceptance-measure.ts

```ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { runArm } = await import(pathToFileURL(join(process.cwd(), "packages/network/harness/experiment.ts")).href);
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const cases = [
  ...[1, 7, 11, 23].flatMap(seed => ["consent", "push_baseline", "push_v2"].map(arm => ({ arm, seed, days: 7 }))),
  { arm: "push_baseline", seed: 1, days: 21 },
  ...[1, 2, 3].map(seed => ({ arm: "consent", seed, days: 21 })),
];
const rows: any[] = [];
for (const c of cases) {
  let records: any[] = [];
  const result = await runArm(c.arm, { seed: c.seed, days: c.days, onRecords: (r: any[]) => records = r });
  const props = records.filter(r => r.type === "proposal" && r.source !== "scenario");
  const ids = new Set(props.map(r => r.proposal.id));
  const invitations = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.type === "proposal" && ids.has(r.msg.meta?.proposalId));
  const booked = new Set(invitations.filter(r => r.msg.meta?.booked).map(r => r.msg.id));
  const decisions = records.filter(r => r.type === "decision" && r.messageType === "proposal" && ids.has(r.proposalId));
  const accepted = new Set<string>(), countered = new Set<string>();
  let silentAccepts = 0, normalAccepts = 0;
  for (const d of decisions) {
    const verdict = booked.has(d.messageId) && d.decision && d.decision !== "none" ? d.decision : d.intent;
    const key = `${d.proposalId}|${d.memberId}`;
    if (verdict === "accept") {
      accepted.add(key);
      if (d.intent === "ignore") silentAccepts++; else normalAccepts++;
    }
    if (verdict === "counter") countered.add(key);
  }
  const allYes = props.filter(p => {
    const recipients = new Set(invitations.filter(r => r.msg.meta?.proposalId === p.proposal.id).map(r => r.msg.memberId));
    return recipients.size >= 2 && [...recipients].every(id => accepted.has(`${p.proposal.id}|${id}`));
  }).length;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const expected = { inviteYes: accepted.size, inviteAcceptRate: r3(accepted.size / Math.max(1, invitations.length)),
    proposalsAllYes: allYes, proposalAllYesRate: r3(allYes / Math.max(1, props.length)) };
  const native = records.map(r => {
    if (r.type === "run_start") { const { runId, ...rest } = r; return rest; }
    if (r.type === "run_end") { const { wallMs, ...rest } = r; return rest; }
    return r;
  });
  const countersWithoutAcceptance = [...countered].filter(key => !accepted.has(key)).length;
  assert.equal(result.invitations, invitations.length);
  rows.push({ ...c, expected, countersWithoutAcceptance, silentAccepts, normalAccepts,
    nativeHash: new Bun.CryptoHasher("sha256").update(JSON.stringify(native)).digest("hex"), result });
  console.error(JSON.stringify({ ...c, expected, countersWithoutAcceptance, silentAccepts, actual: Object.fromEntries(Object.keys(expected).map(k => [k,result[k]])), judge: result.judge }));
}
await Bun.write(output, JSON.stringify(rows, null, 2) + "\n");
```

### experiment-acceptance-compare.ts

```ts
import assert from "node:assert/strict";
const [before, after] = await Promise.all(process.argv.slice(2).map(p => Bun.file(p).json()));
assert.equal(before.length, 16); assert.equal(after.length, 16);
const fields = ["inviteYes", "inviteAcceptRate", "proposalsAllYes", "proposalAllYesRate"];
const withoutRates = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !fields.includes(k)));
let changedWorlds = 0, controls = 0, correctedFields = 0;
const changes = [];
for (let i = 0; i < before.length; i++) {
  const { result: a, ...oldRest } = before[i], { result: b, ...newRest } = after[i];
  assert.deepEqual(newRest, oldRest, `Native evidence changed in world ${i}`);
  assert.deepEqual(withoutRates(b), withoutRates(a), `Unrelated report fields changed in world ${i}`);
  for (const field of fields) {
    assert.equal(b[field], newRest.expected[field]);
    if (a[field] !== b[field]) { assert.ok(a[field] > b[field]); correctedFields++; }
  }
  assert.equal(a.inviteYes - b.inviteYes, newRest.countersWithoutAcceptance);
  if (newRest.countersWithoutAcceptance) changedWorlds++;
  else { assert.deepEqual(b, a); controls++; }
  changes.push({ arm: newRest.arm, seed: newRest.seed, days: newRest.days,
    counterOnly: newRest.countersWithoutAcceptance, silentAccepts: newRest.silentAccepts,
    before: Object.fromEntries(fields.map(k => [k, a[k]])), after: Object.fromEntries(fields.map(k => [k, b[k]])) });
}
assert.ok(changedWorlds > 0 && controls > 0);
console.log(JSON.stringify({ worlds: 16, changedWorlds, controls, correctedFields, nativeHashesUnchanged: 16,
  otherReportFieldsUnchanged: 16, changes,
  nonzeroJudges: after.filter((r: any) => r.result.judge.invariants || r.result.judge.canaryLeaks || r.result.judge.minorContacts)
    .map((r: any) => ({ arm:r.arm, seed:r.seed, days:r.days, judge:r.result.judge })) }, null, 2));
```

### experiment-acceptance-gates-compare.ts

```ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const [before, after, a, b] = await Promise.all(process.argv.slice(2).map(p => Bun.file(p).json()));
const pinned = (rows: any[]) => [rows.find(r => r.arm === "push_baseline" && r.days === 21).result,
  ...[1, 2, 3].map(seed => rows.find(r => r.arm === "consent" && r.days === 21 && r.seed === seed).result)];
const digest = (rows: any[]) => createHash("sha256").update(JSON.stringify(pinned(rows))).digest("hex").slice(0, 16);
const expected = (rows: any[], name: string) => {
  const [push, ...consent] = pinned(rows);
  const sum = (field: string) => consent.reduce((n, r) => n + r[field], 0);
  if (name === "fingerprint: consent vs push arms") return digest(rows);
  if (name.startsWith("consent vs push: everyone-yes (pooled seeds 1-3) >")) return (sum("proposalsAllYes") / sum("proposals")).toFixed(3);
  if (name === "consent vs push: invite-yes (pooled) > 0.85") return (sum("inviteYes") / sum("invitations")).toFixed(3);
  if (name === "consent vs push: push all-yes < 0.25") return push.proposalAllYesRate.toFixed(3);
};
const normalize = ({ ms, ...rest }: any) => ({ ...rest,
  name: rest.name.startsWith("backup drill:") ? rest.name.replace(/restore \d+ ms$/, "restore <elapsed> ms") : rest.name });
assert.equal(before.gates.length, 94); assert.equal(after.gates.length, 94);
assert.equal(after.gates.filter((g: any) => g.blocking).length, 91);
assert.ok(before.gates.every((g: any) => g.pass) && after.gates.every((g: any) => g.pass));
const changes: any[] = [];
let identical = 0;
for (let i = 0; i < before.gates.length; i++) {
  const oldGate = normalize(before.gates[i]), newGate = normalize(after.gates[i]);
  assert.equal(newGate.name, oldGate.name);
  const oldExpected = expected(a, oldGate.name), newExpected = expected(b, newGate.name);
  if (oldExpected !== undefined) {
    assert.equal(oldGate.detail, oldExpected); assert.equal(newGate.detail, newExpected);
    const { detail: oldDetail, ...oldRest } = oldGate, { detail: newDetail, ...newRest } = newGate;
    assert.deepEqual(newRest, oldRest);
    if (oldDetail === newDetail) identical++;
    else changes.push({ name: oldGate.name, before: oldDetail, after: newDetail });
  } else { assert.deepEqual(newGate, oldGate); identical++; }
}
console.log(JSON.stringify({ gates: 94, blocking: 91, tracked: 3, failed: 0, identical,
  changedDetails: changes, allStatesAndClassificationsUnchanged: true, fingerprintBefore: digest(a), fingerprintAfter: digest(b),
  baseSeconds: before.total, candidateSeconds: after.total }, null, 2));
```
