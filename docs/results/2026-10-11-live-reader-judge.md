# Live LLM runs: the slop onboarding reader and the message judge (2026-10-11)

Hand-written: this file. Generated: every number, copied from the command output. Both runs used `gpt-6-luna` on Surplus Intelligence (`defaultLLM()` and `judgeLLM()`; no fallback was needed). The key came from the production Railway service through `railway run`, and the database URLs and the Cloudflare token were removed from the environment. Request settings are the defaults: 60 s timeout (`LLM_TIMEOUT_MS`), at most 4 retries.

## 1. The onboarding LLM reader (#22 "live LLM run of the member-text reader")

Command: `bun run sim --only onboard --llm` (main at `6656397`; before #60's parser fix). Wall time: 1,643 s. Result: **19/19 blocking gates pass** (the rules arm). The LLM arm is tracked only.

| LLM arm gate | Result |
|---|---|
| Hard fields, accuracy (160 rows, 302 fields) | 100.0% |
| Hard fields, held-out (40 rows, 70 fields) | 100.0% |
| 0 wrong gender or seeking parses (corpus, held-out, corrections, after confirm) | pass |
| Teen ages caught (n 38); adults never read as minors (n 32); under 13 declined 100% | pass |
| Corrections and confirmations (n 45) | 100.0% |
| Soft fields (66 rows, 72 fields) | 98.6% |
| P4: hard fields filled within 24 h (57 adult personas, seed 13) | 88.4% of fields; 75.4% of personas fully filled; median 6 member messages |
| Confirmed within 24 h | 19.3% (rules arm: 63.5%) |
| **Ambiguous inputs: 0 guessed values (n 68)** | **fail**: "man, this is a lot of questions" was read as gender man; "30" was read as age range 30-30 |
| **Ported parser rows: 0 wrong values (n 128)** | **fail**: "same borough" was read as distance city; "1,11211" was read as zip 11211 |
| Ported parser rows, fields read | 91.9% (171/186) (rules arm on main: 90.3%; rules arm with #60: 94.1%) |
| **Read-back: 0 unstated facts over every corpus row** | **fail**: 5 read-backs repeat a gender, seeks or range the member did not state |

**Reading.** The LLM reader is as accurate as the rules on the hard fields. But it guesses on ambiguous text and repeats unstated facts in the read-back. The rules never do either, and both are privacy and consent rules of the read-back (onboard.ts: "the read-back repeats only what the member said"). Keep the LLM reader off (the default) until those three gates pass. The sample is small: 68 ambiguous rows, so one guess is 1.5 points.

## 2. The LLM judge on delivered messages (#22 "live LLM run of ... the judge")

Command: `bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts --judge 20`.

- **Judges (surplus/gpt-6-luna):** 20 sampled delivered messages. Quality passed on 12 (60.0%), mean 3.5. Privacy leaks: **0** over 42 private facts.
- **Run:** 301 proposals, oracle precision 34.6%, accept rate 43.9%, worthwhile 52.6% (n 367), 0 canary leaks, 0 minor contacts, style 0 failing of 1,654.
- **Reported, not caused by this change:** `invariants: violations=4 (over_budget=4)` and `undisclosedMinorProposals=4` (age-lying adversaries). This run uses the simulator's `StubNetwork`, which has no review, budget or leak layer (AGENTS.md). The ConsentNetwork runs (`bun run sim`, block network) are where those invariants are gated.

The quality pass rate is measured on 20 messages: its 95% Wilson interval is 38.7%-78.1%. Judge calibration and a judge from a different model family stay founder items (cross-family audits need founder approval, AGENTS.md).
