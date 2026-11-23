# Job posting policy

## Story: Only the manager's own text controls a job posting

> As a hiring manager, I want only my own words in the thread to start, confirm or close a job posting, so text that my AI assistant wrote for my profile cannot publish or end a job.

### Only the member's own text in the thread issues a command

An inbound text has a source. "thread" is text that the member wrote in the conversation. "mcp" is profile text that the member's AI assistant sent through the connector's submit_profile tool. The Network learns profile facts from both sources: age, wants, interests, skills and availability. Profile text never pauses, closes or withdraws anything ([standing changes](standingIntentManagement.md)). Only thread text is a command: a job post, its confirmation or its close, STOP, START, HELP and leave, a yes or no to a probe, a plan, a crew or a booked date, a cancellation, a reschedule, feedback, a block or a report, a number swap, a friend invitation, a standing-intent change, a participation control, a survey answer and every other member command. Changed (owner decision 2026-11-22, D5): assistant profile text reached job posting intake and the invitation survey reader, and a want missing from profile text read as a withdrawal -> profile text only adds, because the text "Yes, post it" could publish a job without the manager's own yes and a paraphrase by an assistant is not the member's decision.

```quint
pure def inboundMayCommand(source: str): bool = source == "thread"

pure def lawAssistantProfileNeverCommands(source: str): bool =
  inboundMayCommand(source) implies source != "mcp"
```

## Story: Publish a job with a clear pay range

> As a hiring manager, I want Eliza to collect the title and pay range, read the details back, and publish only a posting the Network can use.

### Job drafts need a title and pay range before read-back

A new or updated post needs both fields. A close request uses the existing posting and needs no new fields. Ask for the title before the pay range when both are missing.

```quint
pure def missingPostingFields(isClose: bool, hasTitle: bool, hasPay: bool): List[str] =
  if (isClose) List()
  else if (hasTitle) { if (hasPay) List() else List("pay") }
  else if (hasPay) List("title")
  else List("title", "pay")
```

### A posting has between one and fifty openings

The opening count is an integer. The shell validates the numeric type before calling this rule.

```quint
pure val maxOpenings: int = 50

pure def openingsInRange(openings: int): bool =
  openings >= 1 and openings <= maxOpenings
```

### The low end of the pay range comes first

The pay range is in thousands of dollars per year. The low end is at least ten and the high end is at most 999. The model states these comparisons on whole numbers. The text reader and the staff endpoint can supply a fractional value, and the shell applies the same three comparisons to the exact value without rounding, so a stated range such as $90,500-$120,750 is kept in full.

```quint
pure def payRangeAllowed(low: int, high: int): bool =
  low >= 10 and high >= low and high <= 999

pure def lawPayRangeIsOrdered(low: int, high: int): bool =
  payRangeAllowed(low, high) implies low <= high
```

### Confirm only the posting shown in the read-back

Save a text draft only after an affirmative reply to its read-back. A reply that also changes a field needs another read-back. The shell reads the fields of the reply and passes `edited`. When a draft edits or closes a saved posting, the posting shown in the read-back must still be current and open. The shell compares the exact stored fields with the revision that the read-back showed and passes `revisionMatches`. A human hiring team still makes every hiring decision: this rule only decides whether the manager's own posting text is saved.

```quint
pure def confirmPosting(ready: bool, affirmative: bool, edited: bool, revisionMatches: bool): bool =
  ready and affirmative and not(edited) and revisionMatches

pure def lawEditedPostingNeedsReadback(ready: bool, affirmative: bool, revisionMatches: bool): bool =
  not(confirmPosting(ready, affirmative, true, revisionMatches))

pure def lawStalePostingCannotBeConfirmed(ready: bool, affirmative: bool, edited: bool): bool =
  not(confirmPosting(ready, affirmative, edited, false))
```

### A stale yes never reopens or overwrites a posting that staff changed or closed

A draft that read back a saved posting carries that posting's revision. It is current only while the stored posting exists, is open, and is unchanged. A new draft is current only while no posting with its id exists, and a new draft never closes a posting. So a yes to an old read-back cannot reopen a closed job or replace the fields that staff changed after the read-back.

```quint
pure def postingDraftCurrent(readsSavedPosting: bool, storedExists: bool, storedOpen: bool, storedUnchanged: bool, isClose: bool): bool =
  if (readsSavedPosting) storedExists and storedOpen and storedUnchanged
  else not(storedExists) and not(isClose)

pure def lawClosedPostingIsNeverCurrent(readsSavedPosting: bool, storedUnchanged: bool, isClose: bool): bool =
  not(postingDraftCurrent(readsSavedPosting, true, false, storedUnchanged, isClose))

pure def lawChangedPostingIsNeverCurrent(readsSavedPosting: bool, storedOpen: bool, isClose: bool): bool =
  not(postingDraftCurrent(readsSavedPosting, true, storedOpen, false, isClose))

pure def lawNewDraftNeverOverwrites(storedOpen: bool, storedUnchanged: bool, isClose: bool): bool =
  not(postingDraftCurrent(false, true, storedOpen, storedUnchanged, isClose))
```
