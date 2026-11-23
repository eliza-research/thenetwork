# Formal action cache

The Network builds a temporary copy of the executable specs for each
Vibestack command. The base branch discards the tool results from `gen`,
`check`, and focused conformance when it removes that copy. Snapshot checks
have a separate cache for Quint generation.

The change gives generation, snapshot checks, normal checks, and normal
focused conformance one local directory at `.spec-cache/formal`. It retains
completed tool actions with the existing installed tool and input keys.
Each run regenerates its outputs and computes its own stage results. The
application journeys use that run's input. Nightly and acceptance commands
use a fresh projection with an empty cache.

## Generation

Run `/usr/bin/time -p corepack pnpm@10.24.0 run gen` on the same worktree and
the same 150 spec modules. Run the changed command once to fill the cache.
Alternate the base and the changed wrapper with that cache available to the
changed wrapper. Compare a SHA-256 over the sorted output paths and each
file's SHA-256. This benchmark uses no model API. There is no sampling seed
for generation.

The first two pairs ran on an 18-core Apple Silicon host with other work
active. Node was `26.13.0`, pnpm was `10.24.0`, and Dafny was `4.11.0`.
Processor time is user time plus system time and includes child tools.

| Run | Elapsed seconds | Processor seconds |
| --- | ---: | ---: |
| Changed, empty cache | 74.62 | 108.33 |
| Base 1 | 63.71 | 110.63 |
| Changed, warm 1 | 20.38 | 3.06 |
| Base 2 | 66.93 | 111.42 |
| Changed, warm 2 | 20.53 | 2.87 |

All runs exited zero and wrote 688 identical artifacts. Their combined
SHA-256 was `e107b82848fbd4399c9d70a56d40a2ac3d5f4af0d6ee26e18e155735b00976f7`.
The warm cache held 150 action files and took 3.5 MiB on disk. A separate
worktree used that generation cache for `pnpm run spec:check-generated` and
checked all 232 TypeScript and VibeLang artifacts in 38.30 seconds elapsed
and 4.18 processor seconds.

The Vibestack regression used real Quint and Dafny. The second projection
reported the same results without emitting new simulator or verifier output.
A concurrent projection with an invalid spec edit reported a failed model.
[Vibestack #141](https://github.com/lalalune/vibestack/pull/141)

The full cold Network check was stopped after it reported all 150 models.
Its scratch directory had reached 232 MiB when free disk space reached
323 MiB. Those local measurements cover generation and cache reuse.

## Hosted archive selection

Both runs used tree `ac22cbd6f92af2ec9b0ed863f10b165f9e2667e0` on
`ubuntu-24.04` and ran `pnpm run check` over 150 spec modules. The normal
profile used seed 1 with the pinned Quint Rust evaluator v0.7.1 and Dafny
4.11.0. There were no model API calls. This comparison is one run per
archive. The check time excludes cache restore and setup.

| Restored archive | Archive bytes | Restore seconds | Check seconds | Job seconds |
| --- | ---: | ---: | ---: | ---: |
| Successful full check | 40,310,306 | 3 | 64 | 132 |
| Checkpoint from a stopped check | 38,136,370 | 3 | 250 | 324 |

Both archives had the same restore prefix. GitHub picked the newer
checkpoint, adding 186 seconds to the check. The stopped run wrote its
completed actions after the check reached its 27-minute limit. [Successful
archive run](https://github.com/eliza-research/thenetwork/actions/runs/45103938245/job/137460812146)
· [Checkpoint restore](https://github.com/eliza-research/thenetwork/actions/runs/45105686125/job/137466305804)
· [Stopped cold check](https://github.com/eliza-research/thenetwork/actions/runs/45101900073)

The workflow gives successful archives and checkpoints separate prefixes.
The successful key also names the three tool files that can invalidate all
action receipts or all compiled simulator receipts: `action.ts`, `run.ts`,
and `simulator.ts`. A normal run checks its pull request and base branch
scopes for a completed archive with that key. On a hit, the full job
downloads one archive. A same-run retry can use its own checkpoint.
An earlier completed archive, another checkpoint, or generation actions
can supply reusable receipts while the two jobs precompute missing
simulation actions. Explicit cold dispatches start with empty caches. A
single full check still decides the result and publishes the completed
archive.

Nine hosted controls exercised the actual cache steps with small files.
A completed archive in the base scope took priority over an earlier tool
revision in the pull request scope. Each of the three input files triggered
precompute when changed. The controls also passed for v2 migration, retry,
an unrelated checkpoint, an empty cache, and an explicit cold dispatch.
[GitHub cache scope controls](https://github.com/lalalune/thenetwork-1/actions/runs/45116324801)

## Two-runner cold qualification

A normal fork dispatch of the two-runner workflow found no completed,
checkpoint, legacy, or generation archive. The main shard ran for 11m 58s
and the generation shard ran for 6m 21s. The full job verified 1,147 peer
receipts, imported 1,076 new ones, and passed `pnpm run check` in 7m 26s.
The job took 20m 30s from setup through archive upload and cleanup. It
reported 150 model, safety, replay, and proof results and 448 reachability
results, all passing. [Cold cache-miss run](https://github.com/lalalune/thenetwork-1/actions/runs/45115613254/job/137497646669)

The observed main shard had two seconds to spare under its 12-minute
limit. The workflow now gives the main shard up to 16 minutes. The shared
27-minute deadline and bounded peer wait leave about 10 minutes for the
full verifier if the shard reaches its new cap. The 30-minute job limit
stays in place.

## Whole-flow simulator probe

`pnpm run quint:check` has 31 executable whole-flow models. It calls Quint
separately for each safety and witness run. The pinned Quint CLI uses the
host's CPU count for Rust simulation threads. The outer runner can launch
that many tools at once.

The `phone_identity` probe compared the pinned CLI with the existing compiled
Vibestack simulator. Both used seed `0x5eed`, 4,000 samples, 12 steps,
18 threads, and one ITF trace. The safety check passed in both paths. All four
witness runs returned their expected invariant violation. Each pair had
identical ITF data after removing the metadata header. The CLI took 48.09
seconds across the five runs. The compiled path took 29.35 seconds including
7.99 seconds for its one compile. This was one serial pair per invariant on
the shared host.

To qualify the compiled path, repeat this comparison for every model and
check each exit status, counterexample trace, and failure diagnostic on the
pinned seed. Keep Quint trace tests and Apalache checks on their current
commands. Benchmark process pool sizes 1, 2, and 4 with the existing Rust
thread count before choosing a new default.
