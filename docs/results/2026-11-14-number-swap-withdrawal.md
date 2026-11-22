# A wait instruction does not withdraw a number swap

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-11-14-number-swap-withdrawal.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

On November 14, 2026 the relay simulator passed 61 of 62 blocking
gates before the change and 62 of 62 after it. The changed gate
covers positive instructions, ordinary contact mentions, explicit
withdrawal, and mixed replies where the withdrawal wins. It also
checks cancellation of the pending swap through the relay desk.
The simulation uses a fixed clock and a synthetic match. The parser
and cancellation step call no model and send no live messages.

Run `pnpm run sim --only relay`. The pre-existing four tracked
targets stayed off target.
