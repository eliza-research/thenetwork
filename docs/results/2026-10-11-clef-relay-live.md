# Clef relay classifier: first live run and fit (2026-10-11)

Hand-written: this file. Generated: the numbers in the tables, copied from the command output below; `evals/relay/clef-answers.jsonl` (576 cached Clef answers, hashed keys, no text) and `evals/relay/clef-relay-weights.json` (written by the fitter).

## Setup

- **Model:** `@cf/cloudflare/clef-flash` on Cloudflare Workers AI. Question bank `relay-clef-bank-1`. The token and account came from the production Railway service through `railway run` and were never printed.
- **Request settings:** the `relay-eval` defaults: concurrency 4, 15 s timeout, `--budget-usd 1`.
- **Commands:**
  - `bun run relay-eval fit --live --model clef-flash --budget-usd 1`
  - `bun run relay-eval --live --model clef-flash --budget-usd 1` (this fills benign-adult)
- **Corpora:** the tuning sets (`relay.jsonl`, `relay-paraphrases.jsonl`, `relay-heldout-1.jsonl`; 290 rows with answers), `relay-heldout-2.jsonl` (65 rows Clef sees; **never fitted on**), and `network/benign-adult.txt` (221 honest adult texts; a second false-hold check, never fitted on).
- **Cost:** 576 answers; 0 timeouts and 0 errors. The first fill used 796,884 input tokens ($0.07); benign-adult added about $0.02.
- **Fit:** one-vs-rest L2 logistic regression per head, l2 0.003. The head threshold keeps honest false holds at or under 2%. Modes are compared by 5-fold cross-validation on the tuning rows.

## Results (rules + Clef unless marked)

| Mode | Tuning CV recall (scam / harass / contact / rating) | Tuning CV honest held | heldout-2 recall | heldout-2 honest held | benign-adult honest held |
|---|---|---|---|---|---|
| rules only | 100 / 100 / 100 / 100 (tuned on these) | 0% | 60 / 50 / 80 / 50 | 0% | (not scored) |
| direct | 100 / 100 / 100 / 100 (Clef alone: 100 / 84.4 / 95.6 / 100) | 2.7% | 100 / 80 / 90 / 100 | 16.0% | **15.4%** |
| **bank (shipped)** | 100 / 100 / 100 / 100 (Clef alone: 96.0 / 88.9 / 93.3 / 100) | 0.0% | **100 / 90 / 100 / 100** | **4.0%** | **3.6%** |
| both | 100 / 100 / 100 / 100 (Clef alone: 98.0 / 86.7 / 93.3 / 100) | 0.0% | 100 / 90 / 100 / 100 | 4.0% | 3.6% |
| placeholder (`relay-clef-0-placeholder`) | in-sample: 100 / 100 / 100 / 100 | 0.0% | 100 / 80 / 90 / 100 | 4.0% | (not scored) |

The sample sizes are small: heldout-2 has 10 rows per harmful class and 25 honest rows. A difference of one row is 10 points of recall or 4 points of honest held. The 95% Wilson interval for 4.0% honest held (1 of 25) is 0.7%-19.5%. For 3.6% (8 of 221) it is 1.8%-7.0%. For 15.4% (34 of 221) it is 11.2%-20.7%. The benign-adult difference between direct and bank does not overlap.

## Decision

The mode rule written before this run picked **direct**. It ranks by the best Clef-alone cross-validated mean recall: direct 95.0%, bank 94.6%, both 94.5%. Its eligibility limit was 5% false hold, and direct had 2.7%. Live, direct holds 15.4% of honest adult texts (benign-adult), about 1 in 7, for 0.4 points more recall.

**Founder decision (2026-10-11): ship bank.** Mode eligibility now uses the same false-hold limit as each head's threshold (`--max-false-hold`, 2%) and not a separate 5%. With that rule, `auto` picks bank, which is the file written here.

This rule change was made after seeing the benign-adult numbers. That corpus was never fitted on, but it has now informed a model choice. heldout-2 has been seen through reporting. **Write `relay-heldout-3.jsonl` before any more tuning**, and treat these numbers as optimistic.

## Production wiring

The backend reads fitted weights from `RELAY_CLEF_WEIGHTS_PATH` (the image now contains `evals/relay/clef-relay-weights.json`, and no other eval file). If the file does not validate, the backend does not start. Without the variable, the hand-set placeholder is used, as before. The start log names the weights version.

## Simulator gates

Same command on main and on this change: `bun run sim --only evals,relay,ops`.

| | Blocking | Tracked off target |
|---|---|---|
| main (no Clef cache: the Clef arm is skipped) | 86/86 | 5 |
| this change (cache + bank weights) | 96/96 | 4 (the rules-only heldout-2 gates) |
