# no_contact misses a member named by first name only

## Problem and requirement

The `no_contact` scenario check grades a run by whether a member was ever
contacted. One of its three message signals matches the member's name in a
message body — but it matches the full name (`Ana Diaz`). Real messages name
members by first name only: invitations say `Ana D.`, scheduling says
`You're all set with Ana`, feedback asks `How did it go with Ana?`. A
first-name-only mention is therefore not contact as far as the check is
concerned, and the check passes a run that contacted the member.

This is a reproduced grading defect under the approved contribution scope
and PRD 34.3–34.4. It changes scenario grading only: no production behavior,
matching outcome, message text, or threshold changes. The branch starts from
current main, `ebf3e61`.

The nearest open PR, #393, fixes the same shape in the neighbouring
`blocked_pair_kept_apart` check (first-name matching with word boundaries)
but does not touch `no_contact`. This change is that check's counterpart,
not a duplicate: #393's diff leaves `no_contact` exactly as it was.

## Fix and alternatives

Match any form that identifies this member alone — the bare first name, the
first name with surname initial (`Ana D.`), or the full name — each only
when no other member in this world shares it. A bare first name is used
only when it is unique in the world roster; a first name with surname
initial only when no other member shares that pair. Forms are matched with
Unicode word boundaries: a first name inside another name (`Ana` in
`Diana`) is not a mention. Letters, combining marks, numbers, and
underscores remain part of the surrounding word. Escape the name before
constructing the regular expression, so punctuation stays literal. Preserve
the existing case sensitivity and detection of possessive forms. The
proposal, meeting, proposal-id, and participants branches keep their
existing behavior.

A plain first-name match is wrong on its own, and the sim proved it: the
first version of this change matched the bare first name unconditionally,
and the network block then failed `minor-joins-single-player.json`
(65/66 gates). The scenario's background roster holds a second adult named
Milo (`Milo Haddad`, `Milo Quinn`) beside the teen `Milo Reyes`, so
introductions of the adult Milo (`Hi Ada, I think you'd enjoy meeting
Milo H.`) were attributed to the teen. The uniqueness guard above is the
correction: a bare `Milo` names neither Milo when two of them are present,
and `Milo R.` / `Milo Reyes` still identify the teen.

Two alternatives were rejected:

- Keeping the full-name check beside the first-name check would add a second
  path for no gain: every full name contains an identifying form already
  matched above.
- Requiring the first name plus surname initial (`Ana D.`) would miss bare
  first names (`How did it go with Ana?`), which real messages use.

This is not a new identity-resolution system; when two members share a
first name and a surname initial, even the initial form is ambiguous and is
not matched — only the full name is. The same limit #393 states for the
blocked-pair check applies here, with the difference that this check
refuses to guess instead of failing the scenario.

## Full-sim evidence: the messages are real

The reproduction runs complete seven-day worlds with the real StubNetwork
and policy persona agent. Maya Rivera and Ana Diaz join on day zero; a
scenario proposal introduces them on day two. Random introductions are
disabled so the targeted behavior is isolated.

Seed survey (scenario name `no-contact-first-name`, seeds 1–6, stable
across repeated runs):

| Seed | Meeting with Ana | First-name-only messages naming Ana |
|---:|---|---|
| 1 | yes | `You're all set with Ana: Sun 10/11 19:00 near Noe Valley.` |
| 2 | yes | `You're all set with Ana: Sat 10/10 19:00 near Noe Valley.` |
| 3 | yes | scheduling as above, plus `How did it go with Ana?` |
| 4 | yes | scheduling as above, plus `How did it go with Ana?` |
| 5 | no | none (Ana declined; only invitations, which carry participants metadata) |
| 6 | yes | scheduling as above, plus `How did it go with Ana?` |

Both messages are real, unmodified sim deliveries. They carry no
`participants` metadata — only the scenario proposal id, which the
proposal-id branch does not resolve here because the isolated grading below
sets the proposal records aside. The complete-world grade does not flip in
these worlds: the same messages are also caught by the proposal-id branch
(the proposal-id set includes scenario proposals), and the meeting record
fails the check on its own. The name branch is the fallback for messages
whose metadata does not identify the person, and it is that fallback this
change repairs.

## Measurement: the new integration cases

`packages/sim/test/no-contact-first-name.integration.test.ts` runs complete
worlds and grades the message-name branch. The first case (seeds 3 and 4)
sets the meeting and proposal records aside so the grade depends only on
the two real first-name-only messages above. Replay controls replace only
the name in those two real messages. The second case (seeds 1 and 2) shares
the first name between two members (Ana Diaz and Ana Kim) and guards the
disambiguation: messages about Ana Kim must not be attributed to Ana Diaz.

| Check | Base | Naive first-name match | After (uniqueness-guarded) |
|---|---|---:|---:|
| First-name-only messages detected (2 worlds) | 0 / 2 | 2 / 2 | 2 / 2 |
| Full name `Ana Diaz` detected | 2 / 2 | 2 / 2 | 2 / 2 |
| Possessive `Ana's friend` detected | 0 / 2 | 2 / 2 | 2 / 2 |
| Longer name `Diana` (contains `Ana`) not detected | 2 / 2 | 2 / 2 | 2 / 2 |
| Shared first name not misattributed (2 worlds) | 2 / 2 | 0 / 2 | 2 / 2 |
| Surname initial `Ana D.` detected for Ana Diaz | 0 / 2 | 2 / 2 | 2 / 2 |
| Surname initial `Ana K.` not attributed to Ana Diaz | 2 / 2 | 0 / 2 | 2 / 2 |
| Invariants / runtime errors in every world | 0 | 0 | 0 |

The naive column is the first version of this change, measured before the
uniqueness guard was added: it detects the first-name mentions but
misattributes the shared name on both worlds — and it fails the graded
`minor-joins-single-player.json` scenario in the network block (65/66).

## Validation

- `bun run sim --only network`: base 66/66 blocking gates pass (428.2s);
  after 66/66 pass (496.4s). Gate-by-gate comparison of the two JSON runs
  shows identical gate names and results — no gate changed. The first
  (unconditional first-name) version of this change measured 65/66, failing
  only `minor-joins-single-player.json (pass^3)` on `no_contact`; the
  uniqueness guard above restores it.
- `bun run typecheck`: pass (four `tsc` projects, exit 0).
- New integration cases: both fail on base and pass after (2 pass / 0 fail).
  The shared-first-name case also fails under the unconditional first-name
  match, which is the regression it guards.
- The nine existing scenarios run inside the network block above; their
  grades are identical before and after (see the sim result).
- `bun run test:integration` (dev Postgres on 54339, `REQUIRE_PG=1`):
  440 pass / 241 skip / 11 fail / 2 errors, 692 tests, 242.48s. Every
  failure is the same environment cause — `devPgUp()` throws `initdb not
  found` (`packages/observatory/db/dev-pg.ts` looks for Postgres in macOS
  Homebrew paths or on `PATH`, and this box runs as root, which `initdb`
  refuses). The five failing files
  (`packages/mcp/test/cloud-authority.pg.test.ts`,
  `packages/network/test/profile-suggestion-disconnect.integration.test.ts`,
  `packages/network/test/profile-suggestion-withdrawal.integration.test.ts`,
  `packages/network/test/profile-suggestions.integration.test.ts`,
  `packages/network/test/staging-authority.integration.test.ts`) fail
  identically on base: 0 pass / 9 fail. None of them touches `scenario.ts`.
- `bun run test:e2e` (`REQUIRE_PG=1`): 0 pass / 5 skip / 1 fail / 1 error,
  6 tests, 241ms. `tests/e2e/platform.e2e.test.ts` throws `tests/e2e needs
  Postgres (REQUIRE_PG=1)` because `pgAvailable` is false here (`pg_ctl`
  is not on `PATH`); identical on base (0 pass / 5 skip / 1 fail). The
  other five e2e tests skip without Postgres.

## llm_evidence and agent_clients

Real-model qualification is N/A for this deterministic scenario-grading
change. `bun run sim` never calls a model: it clears the provider keys
before it starts, and no key was set in this environment. The measured
policy agent makes no model calls. Model calls: zero; cost: $0.

| Client or runtime | Version | Provider/model | Result |
|---|---|---|---|
| Muse (authoring agent) | Muse Spark | Meta; model identifier unavailable in this session | Direct file, shell, and GitHub CLI workflow |
| Bun | 1.4.4 | No model | Paired worlds and local checks above |
| Other agent clients | Not tested | N/A | No changed member-facing workflow |
