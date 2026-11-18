# A go-ahead does not withdraw a number swap

On November 16, 2026 the relay simulator passed 61 of 63 blocking
gates before the change and 63 of 63 after it. The changed gate covers
six go-ahead wordings ("don't hesitate", "don't delay", "don't hold
back", "no need to wait", "no need to hesitate") that the reader used
to take for a withdrawal, and a second gate drives the member's own
go-ahead through the real inbound path: a pending swap survives the
message, no `relay_swap_withdrawn` is logged, and the swap still
completes when the other member asks. A real withdrawal ("don't send
my number") still cancels the pending swap. The simulation uses a
fixed clock and a synthetic match. The parser and cancellation step
call no model and send no live messages.

Run `bun run sim --only relay`. The pre-existing four tracked
targets stayed off target.
