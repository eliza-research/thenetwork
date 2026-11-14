# Newcomer welcomes need an eligible host

## Requirement and cause

PRD 28.3 includes newcomer welcomes. PRD 33.4 requires a host for the welcome group.

The composer counted a host tag as host coverage, even when that member could not take the host role.
The newcomer generator then discarded the winning group because it had no assigned host.
Another group with an eligible host could lose before that final check.

## Reproduction

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

One hand-written scenario uses four synthetic adults, two past help interactions, and seed 7.
The newcomer and guest can meet either host. The hosts are in town on different days.
The stronger match has reached the default contribution limit. The other host is eligible.
Only the newcomer-welcome generator runs. Scoring, budgets, thresholds, and safety settings keep their defaults.
The engine uses its deterministic local hashing embedding. No LLM or mock model is supplied.

| Same engine scenario | Before | After |
|---|---|---|
| Both hosts present | No candidate or proposal | One welcome with the eligible host |
| Unavailable host removed (control) | One welcome with the eligible host | Same welcome |
| Contribution limit | Respected | Respected |

The regression gate in `scripts/sim/network.ts` checks the complete engine output against the positive control.
It fails before the production fix and passes after it.
This is a deterministic counterexample, not an estimate of population-wide quality or recall.

## Fix and alternatives

Host coverage now uses the existing host-role eligibility check, as role assignment already does.
The composer can therefore select the group whose host can actually serve.

Two alternatives were rejected:

1. Remove the unavailable host from the whole pool. That would also remove a valid guest.
2. Retry composition after the newcomer generator rejects the winner. That repeats the search and leaves the scoring inconsistency elsewhere.

## Reproduce the gate

Run `bun run sim --only network`.
The gate is `newcomer welcome: an unavailable host does not hide an eligible host`.
Restore only `packages/engine/src/group.ts` from the base commit and rerun to see the failure.
The original result is an empty proposal list; the expected result contains the newcomer, guest, and eligible host.

## Validation and limits (2026-11-03)

Tested source head: `ad041a90d653ab803a8fca6430b2afc16a818d3d`.
Base and current upstream main: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Both refs were checked again after the runs. No tracked source file changed during validation.
These results describe that immutable source head; they do not describe a later report commit.

Environment: Bun 1.4.2 (`744846f84`), PostgreSQL 16.15, Linux x86_64.
Postgres used only disposable local databases. The image was the CI-pinned
`postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`.
Provider keys were blank. `REQUIRE_PG=1` was set. No paid call or live send ran.

- The original sim gate's body was run unchanged through the repository's assertion helper on separate base and head worktrees. Base failed: the result was empty while the positive control contained the newcomer, guest and available host. Head passed.
- `bun run typecheck`: pass across packages, sites, Observatory and deploy.
- `bun run sim --json /workspace/validation-227/sim-head.json`: 331/331 blocking gates pass; 14 tracked metrics off target; 366.7 seconds. No Postgres gate was skipped. The Network simulation uses its simulated reviewer.
- Network block on head: 62/62 blocking gates pass. `bun run sim --only network --json /workspace/validation-227/network-base.json` on unchanged base: 61/61 pass, 201.4 seconds. The added newcomer gate is the only added Network gate.
- Seed 3's invariant fingerprint is `24bb81f068060b33` on both trees. Reported consent metrics remain 0.847 everyone-yes, 0.919 invite-yes, and 144 pooled meetings.
- The consent-arm fingerprint changes from `361f8cc2648fb9a6` to `cf66385a85b8ff71`. This report does not claim identical outputs everywhere.
- `bun run test:integration`: 687 pass, zero skip, zero fail; 14,044 assertions across 68 files; 210.80 seconds. This final run used a network-disabled container, a separate local dev cluster, `NETWORK_RETRY_RECONCILIATION_TEST=1`, and the initially empty `NETWORK_RETRY_POSTGRES_URL=postgres://agent@127.0.0.1:54339/network_retry_227a0001`. The initial proxy-configured attempt had 677 pass, eight skip and four failures because local fake-S3 requests received `Domain forbidden` from the proxy. The final run kept all services on loopback and enabled the isolated retry lane; all of those cases then executed and passed.
- `bun run test:e2e`, with `PLAYWRIGHT_MODULE=/workspace/validation-227/playwright-container.mjs`: 43 pass, zero skip, zero fail; 670 assertions; 16.09 seconds. This ran in a network-disabled container with disposable Postgres, Playwright Core 1.64.1 and system Chromium 154.0.8037.57. The external launch adapter selected Chromium and local fonts, with `--no-sandbox`, `--disable-dev-shm-usage` and `--disable-gpu`. Test source stayed unchanged. An earlier container browser attempt failed because that image had no fonts; supplying local font files resolved it.
- `bun run plugins/build.ts --check`: pass.
- `DEPLOY_TARGET=production bun run sites/sites.ts`: pass, with the expected warning that no Turnstile site key was configured. This was a local build, not a deploy.
- No real-model run was made. The changed path is deterministic group composition and does not invoke a model. CONTRIBUTING.md 7.2 still requires paid real-model evidence; that requirement remains unmet.
- No interactive agent-client flow was tested. No MCP schema, onboarding prompt, consent flow or member-facing text changed. The browser case above is the repository's existing local e2e case, not a multi-client agent test.
- Optional-host groups also receive corrected host-coverage scores. The full pack conformance checks passed.
- No production data, live message, external comment, deployment, push or merge was used.

## Overlap with PR #288

PR #227 was opened by `water-bear86` on 2026-10-30 at 07:18:42 UTC.
PR #288 was opened by `danghuy174` on 2026-10-30 at 22:05:00 UTC.
Both have the same base. PR #288's tested comparison head is
`b46bc1f0b882acd266e8c5eda1fb19a4c4340ffe`.

Both changes make `evaluateGroup` require the existing host-role eligibility check
before awarding host coverage. The original #227 scenario also passes against
#288's exact head. This confirms overlapping behavior; it does not establish how
either author developed the change.

PR #288 also uses its `canHost` helper to sort unforced host-required seeds and
extracts the existing role-assignment predicate into that helper. The seed-sort
change is distinct, but the only production `needHost: true` caller is
`newcomerWelcome`, which supplies `forced: [n]` and bypasses that seed-sort branch.
No separate shipped newcomer improvement from seed ordering is claimed here.

Do not copy #288's code or tests into this PR without preserving its authorship.
Keep #227's existing sim gate and disclose the overlap to the maintainer when
publication is approved. Maintainers should consolidate the overlapping work;
this report does not request a duplicate contribution or claim credit for #288.

## Authoring disclosure

The original implementation disclosure below is retained. The 2026-11-03 validation used OpenAI Codex. Its exact runtime model ID is not exposed in this task and is not inferred from the original implementation disclosure. No production change from PR #288 was incorporated.


The operator reported the task's model selector as "Sol 6.1".
OpenAI's model documentation maps "6.1 Sol" to `gpt-6.1-sol`: <https://learn.chatgpt.com/docs/models>.
The declared authoring provider is OpenAI and the client is Codex.
This is operator-reported selection, not independent runtime attestation or real-model test evidence.
