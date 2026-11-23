# Acknowledgments for booking withdrawals

## Story: Withdraw from more than one meeting

> As a member with more than one booking, I want each valid withdrawal saved without getting the same acknowledgment twice within ten minutes.

### Keep each withdrawal and limit its neutral reply

Record every valid withdrawal and apply its own booking and notice rules.
The neutral reply to the withdrawing member can send on a direct withdrawal
if there is no accepted acknowledgment in the last ten minutes. A reply on
another topic does not clear that interval. Keep the timestamp across a
restart. Acknowledgment timing does not affect booking state.

```quint
pure val bookingAcknowledgmentIntervalMs = 600000

pure def bookingWithdrawalAcknowledgmentAllowed(direct: bool, hasAcknowledged: bool, elapsedMs: int): bool =
  direct and (not(hasAcknowledged) or elapsedMs >= bookingAcknowledgmentIntervalMs)

pure def lawRecentBookingAcknowledgmentCannotRepeat(direct: bool, elapsedMs: int): bool =
  elapsedMs < bookingAcknowledgmentIntervalMs implies not(bookingWithdrawalAcknowledgmentAllowed(direct, true, elapsedMs))

pure def lawBookingAcknowledgmentRequiresDirectWithdrawal(hasAcknowledged: bool, elapsedMs: int): bool =
  not(bookingWithdrawalAcknowledgmentAllowed(false, hasAcknowledged, elapsedMs))
```
