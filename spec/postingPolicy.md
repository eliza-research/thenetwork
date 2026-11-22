# Job posting policy

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

### A post with a workplace needs a supported area

Ask for the job's neighborhood before the manager confirms a new or updated onsite or hybrid post. The default mode is onsite. A named worksite that the reader cannot place also needs an answer. Keep a known area during an unrelated edit, and ask again if the manager changes it to an unsupported site. A remote post and a close request need no area. Apply the same check before saving a text draft saved before this rule.

```quint
pure def postingNeedsArea(isClose: bool, remote: bool, hasArea: bool): bool =
  not(isClose or remote or hasArea)

pure def lawOnsiteDraftWithoutAreaNeedsAnswer(isClose: bool, remote: bool): bool =
  postingNeedsArea(isClose, remote, false) == not(isClose or remote)
```

### A posting has between one and fifty openings

The opening count is an integer. The shell validates the numeric type before calling this rule.

An omitted count defaults to one. When text supplies an invalid count, ask for a valid count before showing the draft for confirmation. The text reader records an invalid numeric form as zero so it remains distinct from an omitted count. Closing a post uses the existing terms and does not ask for a count.

```quint
pure val maxOpenings: int = 50

pure def openingsInRange(openings: int): bool =
  openings >= 1 and openings <= maxOpenings

pure def openingCountNeedsCorrection(isClose: bool, supplied: bool, openings: int): bool =
  not(isClose) and supplied and not(openingsInRange(openings))

pure def lawOmittedCountUsesDefault(isClose: bool, openings: int): bool =
  not(openingCountNeedsCorrection(isClose, false, openings))

pure def lawInvalidStatedCountNeedsCorrection(openings: int): bool =
  not(openingsInRange(openings)) implies openingCountNeedsCorrection(false, true, openings)
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
