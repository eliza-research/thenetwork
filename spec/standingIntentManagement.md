# Manage your standing intents

[Story F9](product/stories.md#story-f9--keep-a-standing-intent) lets a member list, pause, and close their intents. The [freshness rules](standingIntent.md) supply the active deadline. The shell binds the command to the canonical member of the current app, lists only the member's rows, and stores controls in that network's persisted member state.

## Story: See and manage the things the Network is looking for

> As a member, I want to see my saved intents and pause or close the exact one I choose.

### Only the canonical member can list or manage the app's own intents

Use a member turn with current membership and consent. A refused command never creates a membership. A matching replay requires that the same member still owns the app binding. A list shows only owned standing intents, with a stable reference and current status. Job postings use their own flow.

```quint
type IntentCommand = ListIntents | PauseIntent | CloseIntent
type IntentCommandPhase = AwaitingMember | ShowIntents | SelectIntent | MemberRefused |
  UnknownIntent | AmbiguousIntent | IntentUnchanged | PauseSelected | CloseSelected
type IntentManagement = { phase: IntentCommandPhase, command: IntentCommand }

pure val initial: IntentManagement = { phase: AwaitingMember, command: ListIntents }

pure def intentManagementAllowed(canonicalMembership: bool, ownNetworkMember: bool, optedOut: bool): bool =
  canonicalMembership and ownNetworkMember and not(optedOut)

pure def canAuthorizeIntentCommand(s: IntentManagement): bool = s.phase == AwaitingMember
pure def authorizeIntentCommand(s: IntentManagement, allowed: bool, command: IntentCommand): IntentManagement =
  { command: command, phase: if (not(allowed)) MemberRefused else if (command == ListIntents) ShowIntents else SelectIntent }

pure def standingIntentReplayAllowed(canonicalMember: bool): bool = canonicalMember
```

### Change only the single matching reference the member supplied

Pause a live intent. Close a live or paused intent. A missing or ambiguous reference leaves every intent unchanged. An already paused, closed, or expired intent stays as it is when the requested action has already taken effect. Store the selected change before acknowledging it. A stored close takes priority over a pause.

```quint
pure def canChooseOwnedIntent(s: IntentManagement): bool = s.phase == SelectIntent
pure def chooseOwnedIntent(s: IntentManagement, matches: int, live: bool, paused: bool): IntentManagement =
  { ...s, phase: if (matches == 0) UnknownIntent
    else if (matches != 1) AmbiguousIntent
    else if (s.command == PauseIntent and live) PauseSelected
    else if (s.command == CloseIntent and (live or paused)) CloseSelected
    else IntentUnchanged }

pure val matchesValues = Set(0, 1, 2)

type IntentControl = PauseControl | CloseControl

pure def effectiveStandingControl(storedStatus: str, control: IntentControl): IntentControl =
  if (storedStatus == "closed" or control == CloseControl) CloseControl else PauseControl

pure def stepChangeRequiresSelection(before: IntentManagement, after: IntentManagement): bool =
  (before.phase != after.phase and (after.phase == PauseSelected or after.phase == CloseSelected)) implies before.phase == SelectIntent

pure def sometimesPausesAnIntent(s: IntentManagement): bool = s.phase == PauseSelected
pure def sometimesClosesAnIntent(s: IntentManagement): bool = s.phase == CloseSelected
```

### Commit a stored intent change with its acknowledgment

A selected stored intent writes to the same member's row in the current app in the transaction that saves the control and acknowledgment. If its stored status changes or the row leaves that scope before the write, the whole transaction fails. A learned intent keeps its control in member state. Controls saved before row updates began still apply.

```quint
pure def writesStandingIntentRow(s: IntentManagement, stored: bool): bool =
  stored and (s.phase == PauseSelected or s.phase == CloseSelected)
```

### A pause or close stops only the work linked to that intent

Retire a directly anchored opportunity if it is still in review or probing. Stop searches for the same named desire when it has no other live record. Preserve transport send holds and outstanding replies. A scheduled or completed meeting stays in its own consent and cancellation flow.

```quint
pure def retireIntentOpportunity(directAnchor: bool, beforeBooking: bool): bool = directAnchor and beforeBooking

pure def retireIntentSearch(recognizedDesire: bool, stillLive: bool): bool = recognizedDesire and not(stillLive)
```
