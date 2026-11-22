# Guided signup witnesses

The signup model has three rare paths through the native connector. It
can save an approved profile on an open app or after a valid invitation.
It can also read a current membership without sending the profile again.
Each path now has a concrete example in the Quint model. Quint runs the
same guards, transitions, and safety rules from the initial state. The
checker replays the recorded trace in generated TypeScript. If an example
stops before its goal, the original search runs.

On one Apple Silicon host, Node 26.13.0 and Quint's 0.7.1 evaluator ran the
full isolated normal-profile signup simulation at seed 1. Each run began
with an empty cache and included model generation. The baseline and
candidate ran in separate projections while other processes used the host.
The signup spec, its imported brand spec, and the simulation tools used
for the baseline match the integration base. No model API was called.

| Run | Elapsed seconds | User and system CPU seconds | Completed tool actions |
| --- | ---: | ---: | ---: |
| Original search | 400.56 | 468.00 | 54 |
| Three concrete examples, first run | 12.12 | 30.67 | 43 |
| Three concrete examples, repeat | 22.32 | 29.57 | 43 |

All runs passed 12,000 safety and probe samples, all 16 reachability
goals, all nine guard controls, and TypeScript replay of 416 traces. The
candidate used one sample per guided example. The two saves needed nine
transitions each. The existing-member example needed seven and reached
its goal with zero submissions. The normal safety and probe harness,
generated TypeScript, and Dafny proof inputs matched byte for byte. The
vendored fixture checked a successful example, a rejected guard with
successful search fallback, an unsafe example, and malformed arguments.

This comparison measures one model. Hosted full verification also runs
the other models, proofs, typecheck, and application journeys.
[Upstream implementation](https://github.com/lalalune/vibestack/commit/2ca104bacd7dcfc0a366e2656fb64b9cd2fad2f5)
