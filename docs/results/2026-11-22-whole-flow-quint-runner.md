# Whole-flow Quint runner benchmark

The whole-flow runner compiles each model once before it checks safety and reachability. It then uses the existing Vibestack bridge to run each invariant with the pinned Quint Rust evaluator. A named test still runs through the original Quint command. The Apalache command keeps its separate bound and runs after the simulation steps.

The runner keeps the existing seed, step and sample counts, safety sample override, and Quint Rust thread count. Every simulated invariant still gets its own execution. An expected result from the compiled path requires a trace from that execution. If compilation or the evaluator fails, the original CLI supplies the result. A safety counterexample still fails the check if the CLI retry cannot reproduce it.

## Method

- Baseline commit `f662eda0` and the candidate runner on the same Apple Silicon host, with Node 26.13.0 and pinned Quint 0.33.1.
- One model, `phone_identity`. Seed `0x5eed`, 4,000 samples, 12 steps, 18 logical CPU threads, and one model-check process at a time. This model has one safety invariant, four reachability checks and three named tests.
- Run order was before, after, after, before, before, after. Process CPU is user time plus system time reported by `/usr/bin/time`. Other jobs shared the host, so elapsed time varied. These three samples per variant do not establish a confidence interval.

```bash
/usr/bin/time -p pnpm run quint:check --jobs 1 phone_identity
```

| Measure | Before | After |
|---|---:|---:|
| Process CPU, median | 7.38 s | 3.96 s |
| Process CPU, range | 7.36–7.47 s | 3.85–3.97 s |
| Elapsed, median | 11.44 s | 6.76 s |
| Elapsed, range | 10.86–17.58 s | 6.55–9.83 s |

All seven runner results matched. An independent evaluator comparison also matched the legacy result and normalized state trace of each of the five invariants. That comparison removes only the trace header, which includes the source path.

## Focused checks

The final runner passed all seven checks on `phone_identity`. Directed checks used temporary two-state models and the real installed Quint and Apalache commands. They covered a reached witness, an unreached witness, a safety counterexample, invalid model syntax, a failed named test, the safety-only sample override, and `--typecheck-only`. Injected process exits checked fallback after a compile failure, an evaluator error, and an evaluator result without a trace. An injected successful retry could not erase a real safety counterexample. Apalache checked the temporary model using its requested bound of two steps. The targeted TypeScript check and `actionlint` also passed.

## Design

The legacy CLI-only approach reads, parses and typechecks the model for every invariant. One Rust execution for all invariants would stop at the first counterexample and could leave other witness checks without their full sample budget. Compiling once with a separate execution per invariant removes repeated front-end work and retains the individual witness searches.

The affected command covers 31 current whole-flow models, 271 reachability declarations and 560 named runs. The other models still need a timed comparison.
