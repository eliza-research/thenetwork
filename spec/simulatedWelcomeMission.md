# Welcome mission in the simulated game

## Story: Arrange a meeting for a newcomer

> As a player in the Observatory simulation, I want a meeting I arrange to count for the welcome mission when a newcomer attends.

### Use the member's join time and the meeting start

The welcome mission uses the recorded start of a held meeting and its attendance evidence. A member is a newcomer from the time they joined through thirty days later. If their join time or the meeting start is missing, that attendance supplies no credit.

```quint
pure val welcomeWindowMs = 2592000000

pure def welcomeMissionRecentAttendee(joinedAt: int, meetingAt: int): bool =
  joinedAt <= meetingAt and meetingAt - joinedAt <= welcomeWindowMs

pure def lawWelcomeMissionCannotPredateJoin(joinedAt: int, meetingAt: int): bool =
  meetingAt < joinedAt implies not(welcomeMissionRecentAttendee(joinedAt, meetingAt))
```
