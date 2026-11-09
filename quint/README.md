# Quint state-machine models

These files are formal models of the state machines in this repository. Each model is written in
[Quint](https://quint-lang.org). The research that finds the machines is in
[docs/research/2026-11-07-state-machines.md](../docs/research/2026-11-07-state-machines.md). Section 6 of that
report is the module plan. Section 5 is the defect register.

## Run the checks

```bash
bun run quint:check                    # every model: typecheck, run tests, safety simulation, witnesses
bun run quint:check quint/relay.qnt    # one model
bun run quint:check --verify           # also bounded model checking with Apalache (needs Java 17 or later)
```

CI runs `bun run quint:check` in the `offline` job. CI does not run `--verify`. Run it locally before you
change a model.

## Drift

A model is only useful while it says what the code does. Each PR that changes code compares the models of
that code with the code, fixes the model (if the code is right) or the code (if the code is wrong, with a
case that fails before the fix), and records the comparison:

```bash
bun run quint:drift                                  # the models whose model file or mapped code changed since their last comparison
bun run quint:drift --stamp quint/relay.qnt          # record a comparison of one model
bun run quint:drift --stamp quint/relay.qnt --drift "text"   # record a known drift that this PR does not fix
```

`docs/formal-coverage.md` maps each source file to its models. `drift.json` keeps a hash of each model and of
each mapped file at the last comparison. The formal block of `bun run sim` fails for a model when one of
those files changed after its stamp. Do not stamp a model that you did not compare. AGENTS.md ("Formal
modeling requirement") has the full procedure.

## Rules for each model

1. One file for each module. The module name is the file name without `.qnt`. A model does not import
   another model.
2. `action init` and `action step` define the machine. One SQL transaction is one action. Each `await`
   between two transactions is a point where the process can stop or another actor can run.
3. `val safety` is the conjunction of all safety invariants. Each invariant has a comment that gives the
   rule it comes from (an AGENTS.md item, a PRD section or a code comment) and the code location.
4. Each model has one or more `val witness_<name>`. A witness is the negation of a state that must be
   reachable (for example `val witness_stopRecorded = not(stopRecorded)`). The check fails if the simulator
   cannot reach that state. This makes a vacuous pass visible.
5. `run <name>Test` values replay concrete traces from the code and the integration tests.
6. A model can set its bounds on one line:
   `// quint-check: max-steps=20 max-samples=4000 verify-steps=8`.
7. Readers, the leak guard, HMAC, Clef and matching scores are oracles. A model gives them nondeterministic
   output. The corpora in `evals/` test the readers themselves.
8. A model that finds a defect names the register id (SD-NNN) in a comment. The code fix comes with an
   integration test, an e2e test, a sim gate or a corpus row that fails before the fix
   ([docs/tests-policy.md](../docs/tests-policy.md)).
