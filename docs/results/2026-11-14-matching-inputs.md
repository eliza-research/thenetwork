# Match selection and plan inputs

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-11-14-matching-inputs.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

On November 14, 2026, three integration regressions failed on
`a8b60e7` and passed after the fix with 294 assertions. They exercise
a duplicate candidate hiding its eligible counterpart, expired profile
facts in request matching, and a closer venue too small for the agreed
group. The last case keeps the group at a feasible public venue.

Run the three integration files changed by the commit with
`pnpm exec vitest run --conditions eliza-source`. These are fixed fixtures with no
LLM provider, model calls, or external agent client.
