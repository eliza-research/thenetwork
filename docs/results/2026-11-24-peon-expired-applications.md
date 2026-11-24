# Peon simulation: count expired applications accurately

Date: 2026-11-24. Baseline: `590f2538c7fe8f66eee63da27511b63fe7277378`.
Related story: [F33, Choose a hiring introduction](../../spec/product/stories.md#story-f33--choose-a-hiring-introduction).
The [Peon simulation report](2026-10-08-peon-pack.md) reports employer timeouts
separately from closed-role losses.

## Reproduce

Run the shipped Peon CLI on the baseline and on the fix with the same inputs:

```sh
for seed in 13 16; do
  env -i PATH="$PATH" HOME="$PWD" node --import tsx --conditions=eliza-source \
    packages/sim/src/apps/peon/cli.ts --seeds "$seed" --arms pack
done
```

The two runs use Node 26.13.0 and Peon realism v2. Each run simulates 8 weeks
with 400 candidates and 80 jobs per city in New York and San Francisco.
The population is synthetic. There is no model, provider, or model request.

| Metric | Seed 13 before | Seed 13 after | Seed 16 before | Seed 16 after |
|---|---:|---:|---:|---:|
| Applications expired unreviewed | 267 | 102 | 225 | 84 |
| Applications ghosted (no answer) | 102 | 102 | 84 | 84 |
| Applications lost to a closed role | 173 | 173 | 143 | 143 |
| Hires | 36 | 36 | 46 | 46 |

The old metric counted all applications removed from the review queue,
including cancellations. The new metric also checks the recorded terminal
outcome. This changes only the expired-applications row for these inputs. It
does not change the simulated queue or the application outcomes.

## Regression gate

```sh
env -i PATH="$PATH" HOME="$PWD" node --import tsx --conditions=eliza-source \
  scripts/sim.ts --only peon
```

The gate uses the existing pack, keyword, and oracle runs on seeds 13–16.
It compares each reported count with recorded employer timeouts. It also
checks that the runs contain candidate timeouts and cancelled applications,
which must not be counted as employer timeouts.
