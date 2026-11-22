# Observatory opportunity rosters

## Story: F35 — Inspect a member's experience as staff

The authorized staff view shows the participant and alternate evidence that the Network recorded for the opportunity. It keeps these two lists as separate fields.

### A replacement uses the Network's recorded roster

Use the participant and alternate lists taken when the Network replaces a seat. A backfill can add a participant without replacing an existing entry. For an older replacement without roster lists, add the incoming entry once or substitute it for the outgoing entry, and remove the incoming entry from the alternates.

```quint
pure def replacementRosterMode(recordedRoster: bool, outgoingSeat: bool, incomingAlreadyListed: bool): str =
  if (recordedRoster) "recorded"
  else if (outgoingSeat) "substitute"
  else if (incomingAlreadyListed) "retain" else "append"

pure def lawReplacementPrefersRecorded(outgoingSeat: bool, incomingAlreadyListed: bool): bool =
  replacementRosterMode(true, outgoingSeat, incomingAlreadyListed) == "recorded"

pure def lawLegacyBackfillAddsOnce(incomingAlreadyListed: bool): bool =
  replacementRosterMode(false, false, incomingAlreadyListed) ==
    (if (incomingAlreadyListed) "retain" else "append")
```

### A probe closure keeps the final alternate evidence

Use the final alternate list when a probe closure carries it. An older closure without that list keeps the last known list. Updating the alternate evidence can apply to an already closed opportunity and leaves its terminal state unchanged.

```quint
pure def closedProbeUpdate(terminal: bool, recordedAlternates: bool): bool =
  not(terminal) or recordedAlternates

pure def lawClosedReplayWithoutRosterKeepsTerminal(terminal: bool): bool =
  closedProbeUpdate(terminal, false) == not(terminal)
```
