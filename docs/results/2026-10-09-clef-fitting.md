# Clef weight fitting for P2: fitter, labelling tool, extraction, bias audit (2026-10-09)

Branch `engine/clef-fit` (from `origin/main` @ `6a55050`). **No Workers AI or LLM calls, $0.** Every number below comes from simulation: synthetic labels drawn from the slop world's hidden appearance. Validation is `bun run sim` (new `clef` block).

**Founder decisions (authoritative):**
- the Clef attractiveness rater is on;
- scores are never shared;
- adults only;
- the shipped weights are a placeholder and need fitting from labelled pairs (prototype P2; MVP plan, open decision 6).

This work rebuilds the fitter that was deleted in the dead-code cleanup (`47a46c3`; the old `fitClef.ts` and `fit-clef-weights.ts` are at `1446718`). It adds the tools P2 needs around it.

## Result in brief

- **The fitter recovers the hidden ranking.** It was fitted on 2,000 synthetic labels per dimension from 6 raters, one of them careless. On 172 photos that appear in no label, Kendall's tau against the hidden truth is:

  | | overall | face | body |
  |---|---|---|---|
  | Fitted head | **0.737** | 0.653 | 0.678 |
  | Placeholder weights | 0.601 | 0.509 | 0.396 |

  The blocking gate is overall tau ≥ 0.6. The fitter beats the placeholder because it learns to discount Clef's photo-quality confound (`aux.photo_quality` gets a negative weight) and to use the auxiliary answers.
- **Label budget.** Ranking recovery saturates at about **1,000 labels per dimension**: tau 0.674 against a ceiling of 0.686 (pooled seeds 1-5). Calibration needs about **2,000** (ECE 0.035). The careless rater is flagged from 500 labels.
- **Recommendation for P2:**
  - 2,000 overall labels first, plus 1,000 each for face and body if those dimensions are kept;
  - 6 or more raters, 20% overlap;
  - 600-1,000 consented photos;
  - about 4,000 labels, roughly 2-3 rater-hours in total;
  - about $0.36-$0.43 of Clef for 1,000 photos (list price).
- **The bias audit catches a biased model.** A Clef that under-rates a group by 0.35 SD drops that group's top-two-quintile selection ratio to 0.74x, which is flagged. At 0.7 SD the ratio is 0.60x, with SMD −0.62.
  - The label-side check (`fit --groups`) shows the fitted head under-rates the group relative to unbiased raters: +0.054 ± 0.018 on overall.
  - At no bias, nothing is flagged.
  - **A linear head on Clef's answers cannot remove a bias that is already in those answers.** Only the audit finds it.
- **`bun run sim`:** the new `clef` block has 10 blocking gates and 2 tracked gates, all passing, in about 8 s. `tsc` is clean. The full `bun run sim` did not finish on the loaded machine (see Validation).

## What was built

| Piece | Where |
|---|---|
| Fitter, agreement, calibration (pure) | `packages/engine/src/packs/slop/clef-fit/fit.ts` |
| Bias audit (pure, wraps `biasMonitor`) | `packages/engine/src/packs/slop/clef-fit/audit.ts` |
| Feature-extraction plan and runner (pure, rater injected) | `packages/engine/src/packs/slop/clef-fit/features.ts` |
| Weights provenance type, fitted files must carry it | `packages/engine/src/packs/slop/clefWeights.ts` |
| Operator CLI: `bun run clef <fit, calibrate, features, audit, synth>` | `scripts/clef-fit.ts` |
| Labelling page (static, local only) and the consent and handling rules | `tools/clef-label/index.html`, `tools/clef-label/README.md` |
| Synthetic data from the slop world's hidden appearance | `packages/sim/src/apps/slop/clefSynth.ts` |
| Sim block | `scripts/sim/clef.ts` (in `bun run sim` by default) |

## Method

### Model

Clef answers a fixed bank of 13 questions per photo (`CLEF_QUESTIONS`, `clef.ts`), which gives 18 features in the range 0-1. Per dimension d (face, body, overall), the Bradley-Terry model is:

> P(photo a beats photo b on d) = sigmoid(w_d · (x_a − x_b))

- **Features.** The head uses 9 features: the three zero-shot ratings and the six auxiliary answers.
  - Gate answers are never used; they decide whether a photo is rated at all.
  - **Body-type one-hots are excluded by default.** Body type is already a separate categorical matching attribute. Letting the attractiveness head learn a body-type penalty would bake the raters' body-size preferences into every score (iteration 4, I4.5). `--include-body-type` opts in.
- **Objective.** Mean log-loss plus (l2/2)|w|², solved by Newton's method. It is exact and deterministic: 9 parameters converge in under 10 steps.
- **L2.** `--l2 auto` (the default) picks from a grid of 0.0003-0.3 by 4-fold cross-validation on the training split. Folds are by unordered pair, so repeated labels of one pair never straddle folds.
- **Split.** 20% of labels are held out:
  - **by unordered pair** (the default);
  - or **by photo** (`--split photo`, stricter): a label is test only if both photos are test photos, and labels that straddle the split are dropped.

  After evaluation, the shipped head is refitted on train plus test (`--no-refit` keeps the train-only head).
- **Calibration.** The bias cancels in a difference, so the head is b = 0. `calibrateClefWeights` sets the mean and SD of each head's raw output on a population, so the score reads as a z-score:
  - by default on the labelled photos;
  - then on the live member population with `bun run clef calibrate`.

### Report

- **Held-out metrics per dimension:**
  - pairwise accuracy, log-loss and Brier score;
  - **calibration**: reliability bins on P(predicted favourite wins), 0.5-1.0 in steps of 0.1, and the expected calibration error (ECE);
  - **the base weights' held-out accuracy on the same labels.** This is P2's "do ratings help at all" baseline.
- **Inter-rater reliability:**
  - Krippendorff's alpha (binary, nominal) per dimension, over pairs labelled by 2 or more raters;
  - pairwise percent agreement.
- **Per rater:**
  - agreement with the model on held-out labels;
  - agreement with the leave-one-out majority of the other raters;
  - self-agreement on repeated pairs;
  - left-click share.
- **Rater flags.** A rater is flagged when:
  - agreement with others or with the model is more than 10 points below the median rater, or under 55%;
  - self-repeat agreement is under 55%;
  - the left share is outside 35-65% (100+ labels).

  Flags are for review. Dropping a rater is a manual `--exclude-raters` decision, never automatic.
- **Label-side bias check (`--groups`):** for labels where exactly one photo is in group g, the mean of (g won − the model's P(g wins)).
  - A positive value means the model rates g lower than the raters do.
  - It is flagged at |residual| > max(0.05, 2 SE). Groups with fewer than 50 labels are suppressed.
- **Aggregates only:** reports print no photo id and no per-photo score (a sim gate checks the CLI output).

### Weights file

`clefWeights.json` has the same shape as before (`heads`, `calibration`, `gate`, `bodyType`, `confidence`), plus:

- `placeholder: false`;
- **`provenance`:** fitter version, date, git commit, sha256 of the label and feature files (the files themselves stay local), counts of photos, labels, raters and flagged photos, the split, the features, and per dimension the source (fitted or base), labels, l2, held-out accuracy and ECE, plus Krippendorff's alpha and what the file was calibrated on.

`validateClefWeights` now refuses a fitted file without provenance. A dimension with fewer than `--min-pairs` (50) training labels keeps the base head, and the provenance records that.

## Sim check (synthetic labels from hidden appearance)

**Photos** (`clefSynth.ts`):
- one photo per real adult persona in the slop world (seed 1, 250 per city, so 693 photos);
- the truth is `trueAppearance` (desirability plus per-person face and body terms), standardised;
- 25% of photos never appear in a label.

**Synthetic Clef answers:**
- the zero-shot ratings track the truth with noise **plus a photo-quality confound**;
- grooming, fitness and style carry partial signal; expression and smile carry none;
- body type is the persona's own.

**Labels:**
- Bradley-Terry on the truth, with sharpness k = 2 and a 5% lapse rate for five raters;
- one careless rater with a 60% lapse rate who leans left;
- 20% of pairs go to 3 raters, and 5% of each rater's pairs repeat with the sides swapped.

**Pinned (seed 1, 2,000 labels per dimension, 6,000 lines in total):**

| | face | body | overall |
|---|---|---|---|
| Tau on unseen photos, fitted | 0.653 | 0.678 | **0.737** |
| Tau, placeholder weights | 0.509 | 0.396 | 0.601 |
| Held-out label accuracy, fitted | 75.8% | 68.4% | 75.3% |
| Held-out label accuracy, placeholder | 72.3% | 64.7% | 68.2% |
| Held-out ECE | 0.046 | 0.047 | 0.025 |
| Krippendorff's alpha | 0.42 | 0.35 | 0.44 |

- **Rater flags.** The careless rater is flagged on all four counts:
  - agreement with others 65% (median rater 79%);
  - agreement with the model 63% (median 74%);
  - self-repeat 44%;
  - left share 71%.

  No careful rater is flagged.
- **Learned overall head:** rate.face 2.29, rate.overall 2.23, rate.body 1.51, aux.fitness 1.32, aux.grooming 0.65, **aux.photo_quality −1.95**, the rest small.

**Label count vs recovery (overall; pooled seeds 1-5; `bun run clef synth --curve --seeds 1-5`):**

| Labels (overall) | Tau on unseen photos | Held-out label accuracy | ECE | Alpha | Careless rater flagged |
|---|---|---|---|---|---|
| 125 | 0.595 ± 0.048 | 75.6% | 0.190 | 0.33 | no |
| 250 | 0.625 ± 0.019 | 68.8% | 0.137 | 0.37 | no |
| 500 | 0.653 ± 0.012 | 73.3% | 0.080 | 0.40 | yes, all seeds |
| 1,000 | 0.674 ± 0.014 | 71.5% | 0.057 | 0.41 | yes |
| **2,000** | **0.682 ± 0.017** | 73.1% | **0.035** | 0.40 | yes |
| 4,000 | 0.684 ± 0.015 | 73.1% | 0.026 | 0.39 | yes |
| 8,000 | 0.687 ± 0.015 | 74.0% | 0.033 | 0.39 | yes |

- The placeholder gives 0.551.
- The **ceiling** is 0.686: 20,000 noiseless labels, the best any linear head on these features can do.
- Held-out label accuracy is capped by label noise (the raters themselves agree about 70% pairwise). It is noisy at small n because the test set is small.

**Rater bias vs model bias (pinned seed, scores audited by the synthetic group B, 30% of photos):**

| Scenario | B mean SMD | B top-2-quintile selection ratio | Audit flag | Label-side residual, B (overall) |
|---|---|---|---|---|
| No bias | −0.10 | 0.86 | none | −0.014 ± 0.018 |
| Clef under-rates B by 0.35 SD | −0.36 | 0.74 | selection | not run |
| Clef under-rates B by 0.7 SD | −0.62 | 0.60 | selection, SMD | **+0.054 ± 0.018 (flag)** |
| Raters under-rate B by 0.5 SD | −0.11 | 0.86 | none | not run |
| Raters under-rate B by 1 SD | −0.12 | 0.85 | none | not run |

**Reading (honest):**

- **The ranking check measures the fitter and the label budget, not Clef.** The synthetic answers are linear in the truth by construction, which is the easy case for a linear head. Real Clef answers may be noisier, nonlinear or carry less signal. Real raters' taste varies more than k = 2 and a shared truth assume. Only P2 can say whether Clef predicts our raters.
- **Model bias passes straight through.** Fitting on unbiased labels did not remove a Clef bias against B: the residual says the model still rates B lower than the raters do. A group-blind linear head can only reweight features, and every zero-shot rating carries the same shift.
- **Rater bias did not reach the scores here,** because the synthetic features carry no group signal. Real Clef answers may correlate with demographics (skin tone, age cues, body size), and then rater bias can leak through. Audit the labels as well as the scores.
- **The audit's selection ratio is noisy at about 200 opt-in members per group:** 0.86 with no bias. Groups need about 100 or more members before a 0.8x flag means much.

### Gates in `bun run sim` (block `clef`; pinned seed 1)

**Blocking:**

1. Overall tau ≥ 0.6 on unseen photos (0.737).
2. Face and body tau ≥ 0.5 (0.653 / 0.678).
3. Fitted beats the placeholder on every dimension.
4. The careless rater is flagged and no careful rater is.
5. **The weights file round-trips:**
   - it is written and loaded by `loadClefWeights`, with `placeholder: false` and provenance, and no gate or body-type feature in a head;
   - Clef answers round-trip to the same features;
   - it rates 172 unseen photos through `WorkersAIClefRater` with a **fake fetch**, at tau ≥ 0.6;
   - under-18 and unverified subjects make no call.
6. **The fit is deterministic** (same digest twice):
   - flagged photos and excluded raters drop the exact label counts;
   - a dimension with no labels keeps the base head;
   - the labelling tool's lines parse, and skips and malformed lines do not.
7. **Feature extraction:**
   - consent manifest, adults only (17 and unverified are refused), no consent reference, rater flags and the cache each skip;
   - an edited photo is re-rated;
   - only eligible photos are read and sent;
   - a resumed run sends nothing.
8. **The CLI**, run as a subprocess with the Cloudflare env removed:
   - `fit` writes a file that loads, with a 64-hex pairs hash, and prints no photo id;
   - `features` without `--live` prints the cost estimate and reads nothing;
   - `features --live` prints the estimate and then refuses for lack of the env (exit 2), writing no file.
9. **Bias audit:**
   - flags B at a Clef bias of 0.7 SD and nothing at 0;
   - the label-side residual is positive under model bias and not flagged at 0;
   - a bottom quintile with 0.6x dates is flagged by `biasMonitor`;
   - a group under n = 15 is suppressed;
   - the report holds no photo id.
10. **The labelling page cannot make a network request:**
    - its CSP has `default-src 'none'`, `connect-src 'none'`, `form-action 'none'` and `img-src blob:` only;
    - it contains no `fetch(`, XHR, beacon, WebSocket, EventSource, remote URL, `<link>`, `<form>` or dynamic import;
    - the consent rules are on the page.

**Tracked:**
- held-out ECE ≤ 0.05 (0.025);
- the one-seed label curve (250 / 500 / 1,000 / 2,000 labels: tau 0.687 / 0.694 / 0.721 / 0.737).

## Label budget guidance for P2

| Item | Guidance | Why |
|---|---|---|
| Overall labels | **2,000 minimum** | Ranking saturates near 1,000 in the sim; calibration (ECE ≤ 0.05) needs about 2,000; real data is harder than the sim |
| Face and body | 1,000 each if those dimensions stay in matching (iteration 4 uses face 0.25, body 0.25, overall 0.5); otherwise keep the base head (the file records it) | Same curve, smaller weight in matching |
| Raters | 6 or more, each at least 300 labels | Rater flags need about 80-100 labels per rater; overlap needs several raters |
| Overlap | 20% of pairs to 3 raters (the tool's shared stream: one pair in five, same seed for everyone) | Alpha and agreement with others |
| Photos | 600-1,000 consented photos from 300 or more subjects; for each self-reported group to be audited, 100 or more subjects | Ranking generalises across people; the audit's ratios are noisy under about 100 per group |
| Rater time | About 4,000 labels at 2-3 s each is about 2.5-3.5 rater-hours, plus breaks. The tool records `ms` per decision: check it after the first session | |
| Clef cost | 1,000 photos is about 1.5-1.8M input tokens: **$0.36-$0.43 on `clef`**, $0.14-$0.16 on `clef-flash` (list prices; output is not billed) | One call per photo; cached, never repeated |

### Suggested P2 decision rule (for the founder; not a decision)

**Ship the fitted weights** if all of these hold:
- held-out overall accuracy is at least 65% **and** at least 2 points above the base weights' held-out accuracy on the same labels;
- overall alpha is at least 0.3;
- ECE is at most 0.05;
- the bias audit has no flag.

**Ratings do not help** if either:
- held-out accuracy is under 60%;
- or alpha is under 0.2, meaning the raters do not agree with each other.

In that case P2 answers "do ratings help" with no. The options then are `appearance.mode = "off"`, or keeping the placeholder knowingly.

## Bias-audit procedure

1. **Groups are opt-in self-reports.** A photo subject (for P2) or a member (after launch) may state a demographic group on the consent form. It is never inferred from photos or names. Unreported is the default, and the audit shows the share reporting by rating quintile, so a skew in who opts in is visible.
2. **Label side (P2, before shipping weights).** Run `bun run clef fit ... --groups groups.jsonl` (`{"photo", "group"}` per line) and read the label-side check:
   - a FLAG means the model rates the group differently from the raters;
   - with unbiased raters, that is a Clef bias the head cannot fix.

   Do not ship a file with a flag. The options are:
   - more labels for that group;
   - dropping the biased zero-shot feature from the head (`--exclude-features rate.face`, for example) and refitting;
   - `appearance.mode` off.
3. **Score side (P2 and weekly after launch).** Run `bun run clef audit --members members.jsonl` with `{"id", "overall" | "photos", "group"?, "memberMonths"?, "proposals"?, "dates"?, "secondDates"?}` per line. Add `--weights` and `--features` to score from photos. Flags:
   - **selection:** a group's share of the top two rating quintiles is under 0.8x its share of reporters;
   - **SMD:** a group's mean is more than 0.5 SD below the other groups;
   - **outcome:** `biasMonitor` reports proposals, dates or second dates per member-month under 0.8x the overall rate, by group and by rating quintile.

   Groups under n = 15 are suppressed (count only). The exit code is 3 when there is any flag, so a weekly job can alert.
4. **Review rule** (unchanged from iteration 4, I4.5): any group under 0.8x on dates or second dates for two consecutive weeks goes to review. The remedies are the soft weight → 0 or `appearance.mode` → "off". The MVP plan's weekly pilot gate is 0.85x or more by rating quintile and group.
5. **Admin only, aggregates only.** No audit or fit output names a person or a photo, and none of it goes to members.

## Operator runbook for P2

**Prerequisites:**
- the founder's sign-off;
- signed rater agreements;
- a signed release per photo subject covering rating research;
- verified ages (ID or selfie check);
- an encrypted working folder on the operator's machine.

Legal note (unchanged, iteration 4): face-derived scores may be biometric data under BIPA, CUBI or Washington law. Have counsel review the release text first.

1. **Collect and record consent.**
   - Put the photos in `p2/photos/<subject>/<n>.jpg`: resized to about 1,000 px (Clef's limit is 4 MiB, and smaller images use fewer tokens).
   - Write `p2/consent.jsonl`, one row per photo: `{"photo": "s012/1.jpg", "subject": "s012", "age": 31, "ageVerified": true, "consent": "release-2026-10-12-012"}`.
   - Optionally write `p2/groups.jsonl` (`{"photo", "group"}`) for subjects who opted in.
2. **Rehearse with synthetic data (no real photos):**

   ```bash
   bun run clef synth --write p2/rehearsal
   bun run clef fit --features p2/rehearsal/features.jsonl --pairs p2/rehearsal/labels.jsonl --groups p2/rehearsal/groups.jsonl --out p2/rehearsal/w.json
   bun run clef audit --members p2/rehearsal/members.jsonl --weights p2/rehearsal/w.json --features p2/rehearsal/features.jsonl
   ```

3. **Featurise.** First a dry run: it reads no photo and prints the plan, the skips and the cost.

   ```bash
   bun run clef features --photos p2/photos --manifest p2/consent.jsonl --out p2/features.jsonl
   ```

   Then the live run. It needs the env, refuses if the estimate is over `--budget-usd` (default $5), and is resumable:

   ```bash
   CLOUDFLARE_AI_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bun run clef features --photos p2/photos --manifest p2/consent.jsonl --out p2/features.jsonl --live
   ```

   - Photos without a manifest row, under 18, unverified, without a consent reference, flagged, or over 4 MiB are never read.
   - Raw Clef answers are not stored; only the feature row is.
4. **Label.**
   - Give each rater the photo folder (encrypted drive), `tools/clef-label/index.html`, a pseudonymous rater id and a session seed. Use the same seed for everyone so the shared pairs overlap.
   - Sessions of 30-45 minutes. Collect the `labels-<rater>-seed<n>.jsonl` files the same way the photos went out.
   - Rules: `tools/clef-label/README.md`.
5. **Re-featurise after flags.** If raters flagged photos, remove them and run `features --labels p2/labels/*.jsonl` (flagged photos are skipped).
6. **Fit:**

   ```bash
   bun run clef fit --features p2/features.jsonl --pairs p2/labels/a.jsonl,p2/labels/b.jsonl,... --groups p2/groups.jsonl --version p2-2026-11 --out p2/clefWeights.json --report p2/fit-report.json
   ```

   - Review the per-rater table. Re-run with `--exclude-raters` only for a rater whose flags are confirmed on review.
   - Check the decision rule above and the label-side check.
7. **Audit the scores** on the P2 population (`audit --members` with `photos` and `group`).
8. **Recalibrate on members** once real members have photos rated, so 0 means the member mean:

   ```bash
   bun run clef calibrate --weights p2/clefWeights.json --population member-features.jsonl --out clefWeights.json
   ```

9. **Deploy.**
   - Set `CLEF_WEIGHTS_PATH` to the file on the backend. **The platform does not read `CLEF_WEIGHTS_PATH` yet:** wiring photo upload and Clef rating into `server.ts` is MVP item 5. Until then, the file is loaded with `loadClefWeights(path)` and passed as `weights` to `makeClefRaterFromEnv`.
   - Re-rate members whose rating came from the placeholder.
10. **Weekly after launch:** run `bun run clef audit` with outcomes, by group and rating quintile; exit code 3 means flags, so alert on it. Refit when 1,000 or more new labels exist, or after a Clef model change, with a new `--version`.
11. **Retention.** When P2 ends, archive the labels, features, manifest and releases encrypted, or delete them. On a subject's withdrawal, delete their photos, labels and feature rows and refit.

## Validation

**`bun run sim --only clef`:** 10/10 blocking, 2 tracked, about 8 s.

**Full `bun run sim` on this branch: not completed.** The machine was running about ten other worktrees' sims, with a load average of 200-500. The run passed evals 24/24 and the network gates it reached, then got about 4 CPU-minutes in 85 minutes and was stopped. Two points bear on the other blocks:

- `peon`, `friends` and `network` import nothing from Clef.
- `slop` uses the placeholder weights unchanged. The only change on its path is the new `validateClefWeights` check, which applies only to files with `placeholder: false`.

Re-run `bun run sim` on an idle machine before merging.

**`tsc --noEmit -p .` and `-p sites/tsconfig.json`:** clean. The repo's `typecheck` script also typechecks `packages/plugin-network`. That fails in a fresh worktree whose `eliza` submodule is not checked out (`@elizaos/core` not found); the failure is unrelated to this change, which touches no plugin code.

**Not done:** no live Workers AI call, and no real photos or labels. P2 itself is the next step.
