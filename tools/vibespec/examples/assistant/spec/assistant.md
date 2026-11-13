# Assistant

An assistant that takes a request, works through it one action at a time,
and pays a bill on the person's behalf. The turn is an agent loop: a model
chooses each next action. Paying drives a browser through a biller's site.
The person, the model and the outside world each send their own events.

## Domain

### Who sends an event

The person, the model choosing the agent's actions, and the world: websites
and services answering requests. The program knows who sent each event, so
an event never says it.

```quint
type Actor = Person | Agent | World
```

### A turn

A turn is idle, planning its next action, asking the person, or done. The
model chooses among seven actions, and a turn may take at most four.

```quint
type Phase = Idle | Planning | Asking | Done
type Choice = Lookup | Review | Fill | Pay | Speak | Recite | Finish
pure val maxActions = 4
```

### The bill and the page

The bill's amount comes from the biller. The browser shows a page that is the
biller's own, a lookalike, or not yet known.

```quint
type Page = Unknown | Genuine | Lookalike
type Bill = { amount: int, reviewed: bool, paid: bool }
```

### What the program carries out

The assistant does not speak or type itself. It puts what should happen in
an outbox that the program carries out. A spoken sentence says whether it
holds a secret; a filled form says which page it went to.

```quint
type Effect = Said({ secret: bool }) | Filled({ page: Page })
```

### The assistant

What is saved survives a restart: the bill, what was charged, the last request
and the one last answered, and the outbox. The rest is in memory.

```quint
type Assistant = {
  phase: Phase, budget: int, page: Page, waiting: bool,
  bill: Bill, charged: int, request: int, answered: int, outbox: List[Effect],
}

pure val initial: Assistant = {
  phase: Idle, budget: 0, page: Unknown, waiting: false,
  bill: { amount: 0, reviewed: false, paid: false }, charged: 0, request: 0, answered: 0, outbox: List(),
}
```

## Story: Take a turn

> As a person, I want to ask for help and have the assistant work through it
> one step at a time, and always come back to me.

### Only the person starts a turn

```quint
pure def canBegin(s: Assistant, by: Actor): bool =
  by == Person and (s.phase == Idle or s.phase == Done)

pure def begin(s: Assistant, by: Actor): Assistant =
  { ...s, phase: Planning, budget: maxActions }
```

### The model chooses each action, and each costs one from the turn

Looking the bill up sends a new request. Reviewing checks an amount that has
arrived. Filling types saved card details, and only into the biller's own
page. Paying asks the person. Reciting would read the saved card aloud, so it
is refused. The turn ends when the model finishes or the budget runs out.

```quint
pure def canChoose(s: Assistant, choice: Choice, by: Actor): bool =
  by == Agent and s.phase == Planning and s.budget > 0 and choice != Recite

pure def choose(s: Assistant, choice: Choice, by: Actor): Assistant =
  val t = { ...s, budget: s.budget - 1 }
  val chosen =
    if (choice == Lookup) { ...t, request: t.request + 1, waiting: true }
    else if (choice == Review) { ...t, bill: { ...t.bill, reviewed: t.bill.amount > 0 } }
    else if (choice == Fill) (if (t.page == Genuine) { ...t, outbox: t.outbox.append(Filled({ page: t.page })) } else t)
    else if (choice == Pay) (if (t.bill.reviewed and not(t.bill.paid)) { ...t, phase: Asking } else t)
    else if (choice == Speak or choice == Recite) { ...t, outbox: t.outbox.append(Said({ secret: choice == Recite })) }
    else { ...t, phase: Done }
  if (chosen.phase == Planning and chosen.budget == 0) { ...chosen, phase: Done } else chosen
```

### A turn's budget stays within bounds, and a turn being planned has some left

```quint
pure def alwaysBudgetBounded(s: Assistant): bool =
  0 <= s.budget and s.budget <= maxActions and (s.phase == Planning implies s.budget > 0)
```

### Every choice spends the budget

At most four model choices occur between turns. Waiting for the person or
the outside world has no time bound; this is a bound on model actions, not a
proof that every participant eventually responds.

```quint
pure def stepChoicesSpendBudget(before: Assistant, via: str, after: Assistant): bool =
  via == "choose" implies after.budget < before.budget
```

### A turn can end

```quint
pure def sometimesTurnEnds(s: Assistant): bool = s.phase == Done
```

## Story: Look up the bill

> As a person, I want the assistant to fetch my bill from the biller, and
> never to act on an answer that came too late.

### A reply counts only for the request still waiting

A reply to an older request, or one that arrives after the bill is paid, is
refused. A new amount must be reviewed again.

```quint
pure def canReply(s: Assistant, request: int, amount: int, by: Actor): bool =
  by == World and s.waiting and request == s.request and amount > 0 and not(s.bill.paid)

pure def reply(s: Assistant, request: int, amount: int, by: Actor): Assistant =
  { ...s, waiting: false, answered: request, bill: { ...s.bill, amount: amount, reviewed: s.bill.reviewed and amount == s.bill.amount } }
```

### A reply answers the request that was waiting

```quint
pure def stepReplyAnswersWaiting(before: Assistant, via: str, after: Assistant): bool =
  via == "reply" implies (before.waiting and after.answered == before.request)
```

### The amount changes only when a reply arrives

```quint
pure def stepAmountOnlyFromReply(before: Assistant, via: str, after: Assistant): bool =
  after.bill.amount != before.bill.amount implies via == "reply"
```

## Story: Pay a bill

> As a person, I want a bill paid only after its amount was checked, only on
> the biller's own site, and only once I say yes.

### The world decides which page the browser shows

```quint
pure def canLoad(s: Assistant, by: Actor): bool = by == World

pure def load(s: Assistant, page: Page, by: Actor): Assistant = { ...s, page: page }
```

### Only the person confirms a payment

```quint
pure def canConfirm(s: Assistant, by: Actor): bool =
  by == Person and s.phase == Asking and s.page == Genuine and s.bill.reviewed and not(s.bill.paid)

pure def confirm(s: Assistant, by: Actor): Assistant =
  { ...s, phase: if (s.budget > 0) Planning else Done, bill: { ...s.bill, paid: true }, charged: s.charged + 1 }
```

### The person can say no

```quint
pure def canDecline(s: Assistant, by: Actor): bool = by == Person and s.phase == Asking

pure def decline(s: Assistant, by: Actor): Assistant =
  { ...s, phase: if (s.budget > 0) Planning else Done }
```

### A bill is paid only on the biller's own page

```quint
pure def stepPaidOnlyOnGenuine(before: Assistant, via: str, after: Assistant): bool =
  (after.bill.paid and not(before.bill.paid)) implies after.page == Genuine
```

### A paid bill was reviewed

```quint
pure def alwaysPaidOnlyReviewed(s: Assistant): bool = s.bill.paid implies s.bill.reviewed
```

### A reviewed bill has a positive amount

Discovered by the proof: a paid bill with a zero amount otherwise satisfies
the rules, but reviewing it again would erase its reviewed status.

```quint
pure def alwaysReviewedHasPositiveAmount(s: Assistant): bool =
  s.bill.reviewed implies s.bill.amount > 0
```

### A bill is charged once, and only when the person confirms

```quint
pure def alwaysChargedOnce(s: Assistant): bool = s.charged == (if (s.bill.paid) 1 else 0)

pure def stepChargedOnlyOnConfirm(before: Assistant, via: str, after: Assistant): bool =
  after.charged != before.charged implies via == "confirm"
```

### A bill can be paid

```quint
pure def sometimesPaid(s: Assistant): bool = s.bill.paid
```

## Story: Keep my details safe

> As a person, I want my card details typed only into the biller's own site,
> and nothing secret read aloud.

### Card details go only into the biller's own page

```quint
pure def alwaysFilledOnlyGenuine(s: Assistant): bool =
  s.outbox.every(e => match e { | Filled(f) => f.page == Genuine | _ => true })
```

### Nothing secret is said aloud

```quint
pure def alwaysNothingSecretSaid(s: Assistant): bool =
  s.outbox.every(e => match e { | Said(x) => not(x.secret) | _ => true })
```

### The program carries out the outbox, then empties it

```quint
pure def drain(s: Assistant): Assistant = { ...s, outbox: List() }
```

## Story: Survive a restart

> As a person, I want a crash in the middle of a task to lose nothing paid or
> promised, and never to pay twice.

### A restart loses what was in memory and keeps what was saved

The request number is saved, so a request after the restart never reuses one
from before it, and a late reply to the old one is refused.

```quint
pure def restart(s: Assistant): Assistant =
  { ...s, phase: Idle, budget: 0, page: Unknown, waiting: false }
```
