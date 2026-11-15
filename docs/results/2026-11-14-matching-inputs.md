# Match selection and plan inputs

On November 14, 2026, three integration regressions failed on
`a8b60e7` and passed after the fix with 294 assertions. They exercise
a duplicate candidate hiding its eligible counterpart, expired profile
facts in request matching, and a closer venue too small for the agreed
group. The last case keeps the group at a feasible public venue.

Run the three integration files changed by the commit with
`bun test --conditions eliza-source`. These are fixed fixtures with no
LLM provider, model calls, or external agent client.
