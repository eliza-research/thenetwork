# Preserve full salary amounts in job postings

A manager posts `$90,000-$120,500`. Peon reads it back and stores it as
`$90k-$120k`. A candidate whose stated minimum is $120,250 then receives no match.
Valid `$90.5k-$120.5k` and `$90000-$120000` ranges fail intake. Conversely, an
out-of-range `$90k-$1200k` offer becomes a valid-looking `$90k-$120k` job.

This is a reproduced hiring defect under the approved scope and PRD 40.6.
The matcher should apply the stated job constraints. The old regular expressions
capture only two or three leading digits and can stop inside a monetary amount.
They also assume particular `k` or `,000` suffixes.

The parser now reads complete monetary endpoints, then converts annual dollars
to the pack's existing thousands representation. It preserves decimals and shared
`k` shorthand. A range needs a dollar or `k` marker, so an experience range is
not pay. The number boundary rejects a comma or decimal point followed by another digit.
The existing bounds remain: minimum 10, maximum 999, and maximum at least minimum,
all in thousands per year.

Keeping only leading digits silently changes an offer. Requiring managers to
rewrite valid dollar amounts leaves the intake defect. Full-amount normalization
repairs the parser while keeping the storage format, read-back templates and
matching rules. Invalid new posts use the existing pay-range question.

## Revisions and setup

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Fix and regression: `d09e795804bf2893df3d5d36cc86442eec2c1676`.
- Local combined compatibility code: `54e1431c8cf1efce7adc9484d258aa2922b71dd1`; never pushed.
- Native Windows, Bun 1.4.2 and PostgreSQL 16.15; frozen dependencies.

## measurement

Run the same command before and after:

```sh
bun run sim --only peon,peon-seats --json result.json
```

For the baseline, apply only the `scripts/sim/peon-seats.ts` diff to the base.
Production remains at the base revision. Both runs use the same method and seeds.

One gate drives nine cases on seeds 1, 2 and 3 through the existing SeatWorld
harness and real Peon wiring. A synthetic verified manager posts through text
intake. The test checks the read-back, restarts, sends the confirmation, and
restarts again. It checks saved amounts and the projected engine pay tags.
The engine then selects the candidate, staff approve the review item, and the
candidate receives the actual probe with the same range. No probe precedes review.

Candidate pay floors are declared synthetic profile inputs. The fractional cases
use a $120,250 floor, between the truncated and actual ceilings. No matching,
history or trust result is injected. Messages remain in a recording channel.

| Input, three seeds each | Before | After |
|---|---|---|
| `$90,000-$120,500` | Saves 90–120; no eligible match | Saves 90–120.5; one reviewed probe |
| `$90.5k-$120.5k` | Asks for pay again; no job | Saves 90.5–120.5; one reviewed probe |
| `$90000-$120000` | Asks for pay again; no job | Saves 90–120; one reviewed probe |
| `$90,000-$120,000` | Saves 90–120; one reviewed probe | Identical |
| `$90k-$120k` | Saves 90–120; one reviewed probe | Identical |
| `90-120k` | Saves 90–120; one reviewed probe | Identical |
| `2-3 years of experience; salary $90k-$120k` | Saves 90–120; one reviewed probe | Identical |
| `$90k-$1200k` | Saves 90–120 and sends a probe | Asks for valid pay; no saved job or probe |
| `$90,000-$120,50` | Saves 90–120 and sends a probe | Asks for valid pay; no saved job or probe |

Correct cases improve **12/27 → 27/27**. The nine newly supported valid cases
produce **0 → 9** reviewed probes. The six malformed or out-of-range cases produce
**6 → 0** saved jobs and probes. All 12 control rows stay identical. These are
deterministic case counts, not a population estimate or aggregate hiring-quality claim.

An initial local amount-boundary check also rejected a comma separating pay from
the next job field. That attempt passed only **28/37** blocking gates. It was
rejected before service validation and never submitted. The final check rejects
a numeric comma continuation while allowing normal sentence punctuation.

The final hiring run passes **37/37**, up from **36/37** on the base plus the new
gate. All 37 prior records stay identical, excluding elapsed time. The hiring-world
fingerprint remains `b7736da857812394`. No tracked target changes or fails.

The combined branch passes **55/55** blocking gates. All 55 prior output records
(54 blocking and one fingerprint) stay identical. The 27 new rows match standalone.
The comparison is against the hiring run at
`6b60dc2ded003ab59cea03b3c022db60442f5885`. Shared-file reconciliation preserves
all earlier gates and parser fixes, including refused work modes and role seniority.

## safety_gates

```sh
REQUIRE_PG=1 bun run sim --only safety --json safety.json
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

PostgreSQL safety passes **17/17** before and after with identical records.
All four typecheck configurations pass before, after and combined. Existing
minor, consent, review, block and leak assertions retain their values.
Database suites run sequentially on isolated port 54339, role `postgres`, with
`PG_BIN_DIR`, `OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339` set.

Standalone integration includes the repository's security subset:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [490.38s]
```

The six known Windows failures are the `/bin/bash` lookup, SIGTERM exit 143
instead of 0, and four site path comparisons. The path fix is separate PR #223,
absent from this branch. Skips are opt-in cleanup reconciliation and hooks.
Full integration remains red.

Standalone E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [41.45s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. Hosted fork CI needs
maintainer approval. No live sends, deployment, UI, message templates, real member
data, dependencies or database schema changed.

## llm_evidence

Deterministic text intake: zero validation model calls/$0. No model-backed
behavior is qualified. The repository's one-full-simulation allowance was used
for #136. Only the two affected hiring blocks and safety were run here.
No new full simulation claim.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0, from package inventory rather than a running-executable claim.
No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, an elizaOS agent or Cursor.

## Limits

This parser reads annual dollar ranges under the existing posting contract.
It does not convert hourly, monthly or foreign-currency pay. It is not a semantic
classifier for competing salary and bonus ranges. Already-saved truncated amounts
are not reconstructed. Managers still confirm the read-back, and all matches
still require staff review. These runs do not qualify a live deployment.
