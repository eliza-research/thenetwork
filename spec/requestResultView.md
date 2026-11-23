# Request results in the staff feed

## Story: Read the current outcome of a member request

> As a staff member, I want to distinguish a booked request from a fulfilled request in the member timeline and search.

### The request feed distinguishes a booking from fulfillment

The timeline and search show a booked request as booked and keep its elapsed
time. Attendance can fulfill the request later. A request still finding
participants remains in its probing or waiting state.

```quint
type RequestEventView = RequestBooked | RequestFulfilled | RequestProbing | RequestWaiting | RequestOther

pure def requestEventView(requestStatus: str): RequestEventView =
  if (requestStatus == "booked") RequestBooked
  else if (requestStatus == "fulfilled") RequestFulfilled
  else if (requestStatus == "probing") RequestProbing
  else if (requestStatus == "waiting") RequestWaiting
  else RequestOther

pure def lawBookedRequestIsNotFulfilled(requestStatus: str): bool =
  requestStatus == "booked" implies requestEventView(requestStatus) == RequestBooked
```
