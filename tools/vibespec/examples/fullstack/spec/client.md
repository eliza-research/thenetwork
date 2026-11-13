# Todo client

The frontend: one browser tab. It keeps the last copy of the list the server
confirmed, the version of that copy, and a queue of the user's edits that the
server has not answered yet. What the user sees is the queue applied over the
confirmed copy, so an edit shows at once, online or not. The React page uses
`step` from this spec as its reducer: every user action and every message
from the server is an event.

## Domain

### A client holds a confirmed copy, its version, and a queue of unanswered edits

Each queued edit carries the number the client gave it, which the server
uses to recognise a retry. `made` counts the edits the client has numbered.

```quint
import todo.* from "./todo"

type Pending = { seq: int, op: { kind: str, id: str, title: str, done: bool } }
type Client = {
  confirmed: List[{ id: str, title: str, done: bool, deleted: bool }],
  seen: int, pending: List[Pending], online: bool, made: int, refusals: int,
}
```

The to-do and the edit are written out in full rather than as `Todo` and
`Op`, because the system spec imports this one under a name, and the tools
can only follow a type of an imported machine back to that machine's own
types. They are the same types.

### A new client is online, has seen version 0 and has nothing queued

```quint
pure val initial: Client =
  { confirmed: List(), seen: 0, pending: List(), online: true, made: 0, refusals: 0 }
```

### What the simulator tries

Two ids, an empty and a real title, the first versions and sequence numbers,
and a few lists the server might send.

```quint
pure val idValues = Set("x", "y")
pure val titleValues = Set("", "milk")
pure val seqValues = Set(1, 2, 3)
pure val versionValues = Set(0, 1, 2, 3)
pure val todosValues =
  Set(List()).union(Set(List({ id: "x", title: "milk", done: false, deleted: false })))
    .union(Set(List({ id: "x", title: "milk", done: true, deleted: false }, { id: "y", title: "eggs", done: false, deleted: true })))
pure val psValues =
  Set(List()).union(Set(List({ seq: 1, op: { kind: "create", id: "x", title: "milk", done: false } })))
    .union(Set(List({ seq: 1, op: { kind: "create", id: "x", title: "milk", done: false } }, { seq: 2, op: { kind: "remove", id: "x", title: "", done: false } })))
```

## Story: Edit the list in the browser

> As a user, I want my edit to show the moment I make it, even when the
> server has not answered yet or I am offline, so that the page never feels
> slow.

### The user sees the queued edits applied over the confirmed copy, in order

A removed to-do is not shown.

```quint
pure def view(c: Client): List[Todo] = c.pending.foldl(c.confirmed, (acc, p) => applyOp(acc, p.op))
pure def visible(c: Client): List[Todo] = view(c).select(t => not(t.deleted))
```

### An edit the user makes is checked against what they see, numbered and queued

```quint
pure def queue(op: Op, c: Client): Client =
  { ...c, made: c.made + 1, pending: c.pending.append({ seq: c.made + 1, op: op }) }

pure def canCreate(c: Client, id: str, title: str): bool =
  opAllowed(view(c), { kind: "create", id: id, title: title, done: false })
pure def create(c: Client, id: str, title: str): Client =
  queue({ kind: "create", id: id, title: title, done: false }, c)

pure def canSetDone(c: Client, id: str, done: bool): bool =
  opAllowed(view(c), { kind: "done", id: id, title: "", done: done })
pure def setDone(c: Client, id: str, done: bool): Client =
  queue({ kind: "done", id: id, title: "", done: done }, c)

pure def canRename(c: Client, id: str, title: str): bool =
  opAllowed(view(c), { kind: "rename", id: id, title: title, done: false })
pure def rename(c: Client, id: str, title: str): Client =
  queue({ kind: "rename", id: id, title: title, done: false }, c)

pure def canRemove(c: Client, id: str): bool =
  opAllowed(view(c), { kind: "remove", id: id, title: "", done: false })
pure def remove(c: Client, id: str): Client =
  queue({ kind: "remove", id: id, title: "", done: false }, c)
```

### Every queued edit was numbered here, and no two share a number

```quint
pure def alwaysEveryQueuedEditWasNumberedHere(c: Client): bool =
  c.pending.every(p => p.seq >= 1 and p.seq <= c.made)

pure def alwaysQueuedEditsHaveDistinctNumbers(c: Client): bool =
  c.pending.every(p => c.pending.select(q => q.seq == p.seq).length() == 1)
```

### The count of numbered edits is never negative

Discovered by the proof: nothing said so, and a client whose count was
negative would give its next edit a number below 1.

```quint
pure def alwaysTheEditCountIsNotNegative(c: Client): bool = c.made >= 0
```

### Edits can be queued while offline

```quint
pure def canGoOffline(c: Client): bool = c.online
pure def goOffline(c: Client): Client = { ...c, online: false }
pure def canGoOnline(c: Client): bool = not(c.online)
pure def goOnline(c: Client): Client = { ...c, online: true }

pure def sometimesQueuedWhileOffline(c: Client): bool = not(c.online) and c.pending.length() >= 2
```

## Story: Hear back from the server

> As a user, I want my page to follow the server's answers and other
> people's changes, and to tell me when an edit of mine was refused.

### An answer takes its edit out of the queue

The server answers an edit, accepted or refused, with the list as it now is.

```quint
pure def without(ps: List[Pending], seq: int): List[Pending] = ps.select(p => p.seq != seq)
pure def waiting(c: Client, seq: int): bool = c.pending.some(p => p.seq == seq)

pure def lawAnAnsweredEditLeavesTheQueue(ps: List[Pending], seq: int): bool =
  not(without(ps, seq).some(p => p.seq == seq))
```

### A copy of the list replaces the confirmed copy only if it is newer

Messages can arrive out of order; an older copy is ignored.

```quint
pure def catchUp(version: int, todos: List[Todo], c: Client): Client =
  if (version > c.seen) { ...c, confirmed: todos, seen: version } else c

pure def stepTheConfirmedVersionNeverGoesBack(before: Client, after: Client): bool =
  after.seen >= before.seen

pure def alwaysTheConfirmedVersionIsNotNegative(c: Client): bool = c.seen >= 0
```

### The client hears answers and other people's changes only while online

```quint
pure def canReceiveAck(c: Client, seq: int, version: int, todos: List[Todo]): bool = c.online
pure def receiveAck(c: Client, seq: int, version: int, todos: List[Todo]): Client =
  catchUp(version, todos, { ...c, pending: without(c.pending, seq) })

pure def canReceiveRefusal(c: Client, seq: int, version: int, todos: List[Todo]): bool = c.online
pure def receiveRefusal(c: Client, seq: int, version: int, todos: List[Todo]): Client =
  catchUp(version, todos, {
    ...c, pending: without(c.pending, seq), refusals: c.refusals + (if (waiting(c, seq)) 1 else 0),
  })

pure def canReceiveSnapshot(c: Client, version: int, todos: List[Todo]): bool = c.online
pure def receiveSnapshot(c: Client, version: int, todos: List[Todo]): Client = catchUp(version, todos, c)
```

### A client can catch up after editing, and can be told of a refusal

```quint
pure def sometimesCaughtUpAfterEditing(c: Client): bool =
  c.made >= 1 and c.pending.length() == 0 and c.seen >= 1

pure def sometimesRefused(c: Client): bool = c.refusals >= 1
```

## Story: Other specs can rely on the client's rules

> As the author of a spec that runs clients inside a larger system, I want
> the client's rules stated as laws, so that my proofs can use them rather
> than prove them again.

### Queueing an edit or hearing an answer keeps every rule of the client

What is proved about the transitions of a spec cannot be called from a spec
that imports it; a law can.

```quint
pure val cValues =
  Set(initial).union(Set({
    ...initial,
    made: 2,
    seen: 1,
    pending: List({ seq: 2, op: { kind: "done", id: "x", title: "", done: true } }),
  }))
pure val opValues =
  Set({ kind: "create", id: "y", title: "eggs", done: false })
    .union(Set({ kind: "done", id: "x", title: "", done: true }))

pure def rulesHold(c: Client): bool = and {
  alwaysEveryQueuedEditWasNumberedHere(c),
  alwaysQueuedEditsHaveDistinctNumbers(c),
  alwaysTheEditCountIsNotNegative(c),
  alwaysTheConfirmedVersionIsNotNegative(c),
}

pure def lawQueueingKeepsTheRules(c: Client, op: Op): bool =
  rulesHold(c) implies rulesHold(queue(op, c))

pure def lawAnAnswerKeepsTheRules(c: Client, seq: int, version: int, todos: List[Todo]): bool =
  rulesHold(c) implies and {
    rulesHold(receiveAck(c, seq, version, todos)),
    rulesHold(receiveRefusal(c, seq, version, todos)),
    rulesHold(receiveSnapshot(c, version, todos)),
  }
```
