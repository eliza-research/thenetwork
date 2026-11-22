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
323 MiB. These measurements cover generation and cache reuse. The full
Network validation suite remains open.

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
