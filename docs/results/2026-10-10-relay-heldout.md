# Relay classifier on held-out 2, and the relay and photo adversarial scenarios

Date: 2026-10-10. Base: `origin/main` b53bd86. Relay policy `relay-1.0.0` (`packages/engine/src/relay.ts`), no threshold or rule changed. Issue #10 ("the relay classifier measured on `evals/relay/relay-heldout-2.jsonl` without tuning on it") and #11 (sims-and-e2e: "the relay and photo adversarial scenarios").

## 1. What was measured

- **Corpus.** `evals/relay/relay-heldout-2.jsonl`: 65 hand-written rows (25 honest, 10 scam, 10 harassment, 10 contact, 10 rating), written after the rules were tuned (commit 0a5740f) and never tuned on. No row was added, removed or relabelled. The second false-hold set is `evals/network/benign-adult.txt` (221 hand-written benign adult messages, label "honest").
- **Arms.**
  1. Rules only: `relayItem` with the engine defaults, a mutual adult match and no history (`scripts/relay-clef-lib.ts` `baseCtx`). This is `classifyRelayText` plus the leak guard plus the item checks.
  2. Rules + slop `appearanceLeak`: the same, with the extra hold rule that the RelayDesk adds on an app that rates photos (`packages/network/src/relay.ts`). This is the rules path that production runs on slop.
  3. Rules + Clef (`clefRelayClassifier`, clef-flash, offline from recorded answers): **not measured: needs CLOUDFLARE_AI_TOKEN.** `evals/relay/clef-answers.jsonl` does not exist, so no recorded answer covers any row. No Workers AI call was made.
- **Model and request settings.** None: no model call. Deterministic: the same command gives the same numbers.
- **"Stopped"** means hold or block. Recall is stopped / rows of the class. False hold is honest rows stopped / honest rows. Leak recall is contact and rating rows stopped (a contact detail or a rating that would reach the other member). Intervals are Wilson 95%.

Command (generated output; the numbers below are copied from it):

```
bun run relay-eval rules --json <out.json>
```

`rules` is a new offline subcommand of `scripts/relay-eval.ts`. It takes `--file` (default `relay/relay-heldout-2.jsonl`), and it prints aggregates and reason families only, never row text.

## 2. Results

### Confusion (rows: label; columns: decision)

Rules only:

| Class | pass | hold | block |
|---|---|---|---|
| honest (25) | 25 | 0 | 0 |
| scam (10) | 4 | 6 | 0 |
| harassment (10) | 5 | 4 | 1 |
| contact (10) | 2 | 8 | 0 |
| rating (10) | 5 | 5 | 0 |

Rules + slop `appearanceLeak` (the slop desk): the same, except one harassment row (body-shaming) moves from pass to hold (harassment 4 pass, 5 hold, 1 block).

### Rates

| Measure | Rules only | Rules + slop appearanceLeak |
|---|---|---|
| Scam recall | 6/10 = 60.0% (31.3-83.2%) | 6/10 = 60.0% (31.3-83.2%) |
| Harassment recall | 5/10 = 50.0% (23.7-76.3%) | 6/10 = 60.0% (31.3-83.2%) |
| Contact recall | 8/10 = 80.0% (49.0-94.3%) | 8/10 = 80.0% (49.0-94.3%) |
| Rating recall | 5/10 = 50.0% (23.7-76.3%) | 5/10 = 50.0% (23.7-76.3%) |
| **Leak recall** (contact + rating) | 13/20 = 65.0% (43.3-81.9%) | 13/20 = 65.0% (43.3-81.9%) |
| **False hold**, held-out 2 honest | 0/25 = 0.0% (0.0-13.3%) | 0/25 = 0.0% (0.0-13.3%) |
| False hold, benign-adult.txt | 0/221 = 0.0% (0.0-1.7%) | 1/221 = 0.5% (0.1-2.5%) |
| False hold, both sets | 0/246 = 0.0% (0.0-1.5%) | 1/246 = 0.4% (0.1-2.3%) |
| Rules + Clef | not measured: needs CLOUDFLARE_AI_TOKEN | not measured |

Reason families on the stopped rows (rules only): scam 5 `scam`, 1 `offplatform`; harassment 3 `harass`, 1 `harass_severe`, 1 `offplatform`; contact 5 `contact`, 3 `fishing`, 1 `offplatform`; rating 5 `rating`.

### Reading

- The numbers are the same as the one scoring recorded in docs/results/2026-10-09-relay.md section 3 (scam 60%, harassment 50%, contact 80%, rating 50%, honest 0%). The rules did not change since, so this confirms that report; it is not new evidence of improvement.
- The rules are precise (no honest row held; 0 of 221 benign adult messages held) and have low recall on new wording. Every block is correct, and every miss is a pass, not a wrong block. With n = 10 per class the intervals are wide: the scam recall on new wording is somewhere between about 30% and 85%.
- The misses are the kinds the 2026-10-09 report named: soft money asks with no payment word, entitlement and contempt without an insult word, and rating questions without a rating word. Fixing them by adding rules for these rows would tune on held-out 2. Do not do that: write `relay-heldout-3.jsonl` first.
- On slop the desk's `appearanceLeak` adds one harassment catch and one benign-adult hold (0.5%). Both arms stay under the 5% honest and 2% benign gates.
- **What protects members today** is not the recall above but the path: a held or stopped scam puts the sender on hold for staff (the world rule), contacts go out only after both members ask, and nothing is relayed before both yeses (section 3). The Clef layer is the planned second layer; its recall on new wording is still unknown.
- **Bug check.** No bug in `packages/engine/src/relay*.ts` was found by this measurement. One design note from the scenarios (section 3): the core leak guard does not match a one- or two-word forbidden string on its own (by design, `packages/core/src/guard.ts`); the RelayDesk compensates by also passing multi-word facts as fuzzy facts. A caller that builds `relayGuard` with `forbidden` alone would not catch the other member's two-word full name.

### To measure Clef

With `CLOUDFLARE_AI_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: `bun run relay-eval --live` (estimate about $0.05 on clef-flash for every corpus), then `bun run relay-eval rules`. The `rules` command scores rules + Clef from the recorded answers with the shipped weights (or the placeholder) on the slop desk's rules, and the relay sim block scores the same arm. Fit only on the tuning sets (`bun run relay-eval fit --live`); held-out 2 stays scored only.

## 3. Adversarial scenarios in the slop world (#11 sims-and-e2e)

New: `packages/sim/src/apps/slop/adversarial.ts`, gated in the relay block (`scripts/sim/relay.ts`, "relay adversarial"). Personas come from the slop world generator (`generateSlopPersonas`, 250 per city, raised adversary shares so each scenario has enough cases); every item goes through `relayItem`, every probe photo through `probePhotoRefs` and `slopProbeMessage`. Seeds 13-16. The scenario scripts and templates are sim-written (generated), separate from the hand-written corpus.

`bun run sim --only relay`: **46/46 blocking gates pass** (39 before, plus 7 new), 5 tracked off target (the 4 rules-only held-out 2 gates and the skipped Clef arm, unchanged).

| Scenario (blocking) | Cases (4 seeds) | Controls | Result |
|---|---|---|---|
| Scam after the reveal: small talk, then 8 scam items per scammer (off-platform, money, gift card or crypto; each template once), then a text, a number swap and a photo from the scammer | 1,320 (120 scammers) | the victim's first message: 120/120 pass | 953/960 scam items stopped; max reach 1 scam item per scammer; every scammer held; 0 of 1,193 items after the hold delivered |
| Number swap before both yeses: share with fresh consent, a number in text, a photo; probing with no yes, probing with one yes, "mutual" with one yes | 4,320 | the same share after both yeses: 480/480 pass with the number | 4,320/4,320 blocked; no number in the output or the log |
| Leak of the other member's details: full name, number, a private fact, the canary | 1,920 | the sender's own private fact: 480/480 pass | 0 delivered; every stop comes from the leak guard (or the contact rule for the number); 480/480 canaries blocked |
| Minor in the relay: a hidden minor who claimed 18+ lets their age slip; a declared minor and an unknown age in a mutual match | 2,040 | before the slip: 120/120 pass | 120/120 slips blocked with the age signal; afterwards every text, share and photo both ways blocked (`minor:party`); declared minors and unknown ages blocked both ways; no probe photo after the slip |
| Photo in the probe: flag off (the live call: no consent, no ids), no consent, minor subject or recipient (age slip, declared, unknown), held subject; and the same subject relaying a photo | 6,720 | adults with consent: 480/480 probes with one photo and the photo line | 0 probes with a photo or the photo line; 0 relayed photos passed |
| Live path: the slop probe hook (`appWiring("slop").hooks.probe`) with `SLOP_PROBE_PHOTOS` off | adult, minor and unknown-age pairs | | never the photo line; the flag is off |
| Live path: the RelayDesk with a fake host | number swap before both yeses (3 states, both members); a scam after the reveal | an honest text is sent | swaps refused, nothing sent, no number in the log; 3 scam texts held for staff, none sent |

7 of 960 scam items passed the rules, all the same sim template (a soft hospital-bill ask with no payment word). Reach 1 means one soft ask can reach the victim before the sender is held. That matches the held-out 2 recall above.
