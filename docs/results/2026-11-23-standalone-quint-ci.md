# Standalone Quint CI

The VibeStack projection omits `spec/models/`. Its full check had no
continuous check for those standalone action-based models. For example,
the merged relay change updated `spec/models/relay.md` and had maintainer
evidence for a scoped model run. The ordinary GitHub jobs did not run that
model. [Relay PR](https://github.com/eliza-research/thenetwork/pull/604)

The standalone workflow selects changed executable Markdown models. All
31 current model blocks have no imports. It runs the full suite on shared
runner, toolchain, version or lockfile changes, model removals, unavailable
comparison commits, or possible Quint imports. A manual dispatch also runs
all models. Each check uses a clean runner with the pinned evaluator and
keeps the configured bounds, fixed seed, safety checks, witnesses, and
named traces. VibeStack paths continue to cover its executable specs and
browser inputs. A change restricted to `spec/models/` no longer starts
VibeStack jobs.

## Hosted qualification

All measurements used `ubuntu-24.04`, pinned Node 26.13.0, pnpm 10.24.0,
and Quint Rust evaluator v0.7.1. The command was `pnpm run quint:check
--jobs 4`, with `relay` as the only model name for targeted runs. The
standalone runner used seed `0x5eed`. The relay policy uses 25 steps and
10,000 samples per simulation. No model API calls were made. There was one
hosted run for each case.

| Run | Models | Check seconds | Job duration | Result |
| --- | ---: | ---: | ---: | --- |
| Earlier full suite | 31 | 1,415.34 | 23m 58s | Pass |
| Changed relay model only | 1 | 19.39 | 38s | Pass |
| Relay with one unreachable witness | 1 | 20.46 | 43s | Fail at the added witness |

Both model-only pull request revisions selected only `relay`. GitHub
launched only the whole-flow check. The positive fixture used the current
relay module. The negative fixture added a witness whose invariant stays
true, so the runner could not reach the requested violation. The existing
checks still ran at their normal bounds. [Full suite](https://github.com/lalalune/thenetwork-1/actions/runs/45075026551/job/137370258382)
· [Positive](https://github.com/lalalune/thenetwork-1/actions/runs/45126101719/job/137530674294)
· [Negative](https://github.com/lalalune/thenetwork-1/actions/runs/45126236023/job/137531095751)
