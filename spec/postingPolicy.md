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

### A posting has between one and fifty openings

The opening count is an integer. The shell validates the numeric type before calling this rule.

```quint
pure val maxOpenings: int = 50

pure def openingsInRange(openings: int): bool =
  openings >= 1 and openings <= maxOpenings
```

### The low end of the pay range comes first

The pay range is in thousands of dollars per year. The low end is at least ten and the high end is at most 999. The staff endpoint can supply a fractional value within those bounds.

```quint
pure def payRangeAllowed(low: int, high: int): bool =
  low >= 10 and high >= low and high <= 999

pure def lawPayRangeIsOrdered(low: int, high: int): bool =
  payRangeAllowed(low, high) implies low <= high
```
