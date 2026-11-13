# Contributing

Everything about how this repository works, for people and agents alike, is
in [AGENTS.md](AGENTS.md); [README.md](README.md) is the overview and
tutorial. **Every agent reads both in full before doing any work.**

In short:

- Each application has one source of truth, `spec/<name>.md`: user stories,
  the rules each implies, and under every rule the Quint that says it exactly.
  `gen/` is derived from it and never edited by hand.
- `npm run check` simulates the model, compares the generated TypeScript with
  it and proves it. An agent resolves what it reports by following the
  [`sync` skill](.claude/skills/sync/SKILL.md); the user signs off with
  `npm run accept`.
- Verified logic lives in the spec. Hand-written TypeScript in `src/` is only
  for what Quint cannot express or what touches the outside world.
- Tests cover only what the checks cannot: whole user journeys through the
  real shell, against real services (AGENTS.md, "Tests").
- A change to `tools/` passes `npm run selftest`, with a new case for each new
  kind of mistake it catches.
