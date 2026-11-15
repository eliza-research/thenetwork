# Todo list

The shared vocabulary of the to-do application: what a to-do is, which edits
exist, when an edit makes sense and what it does. It has no state of its own;
the server, the client and the whole system import it, so all three apply an
edit in exactly the same way.

## Domain

### A to-do has an id, a title, a done mark and a deleted mark

The id is chosen by the client that creates the to-do, so that a client can
create a to-do while offline and keep editing it before the server has seen
it. A removed to-do stays in the list as a tombstone with `deleted` set, so an
id is never used for a second to-do.

```quint
type Todo = { id: str, title: str, done: bool, deleted: bool }
```

### An edit creates a to-do, sets its done mark, renames it or removes it

Every edit is one record, whatever its kind; the fields a kind does not use
are ignored. Setting the done mark carries the value to set, not "flip it", so
that an edit applied twice has the same effect as once.

The kind is one of the strings `"create"`, `"done"`, `"rename"` and
`"remove"` rather than a variant type: the server and client specs keep their
state in records written out in full (see the README), and a variant type
cannot be written out that way.

```quint
type Op = { kind: str, id: str, title: str, done: bool }

pure def isKind(k: str): bool = k == "create" or k == "done" or k == "rename" or k == "remove"
```

### What the simulator tries

For the laws: edits of every kind, a few to-dos and lists of them.

```quint
pure val changeValues =
  Set({ kind: "create", id: "x", title: "milk", done: false })
    .union(Set({ kind: "create", id: "y", title: "", done: false }))
    .union(Set({ kind: "done", id: "x", title: "", done: true }))
    .union(Set({ kind: "rename", id: "x", title: "eggs", done: false }))
    .union(Set({ kind: "remove", id: "x", title: "", done: false }))
pure val tValues =
  Set({ id: "x", title: "milk", done: false, deleted: false })
    .union(Set({ id: "x", title: "eggs", done: true, deleted: true }))
pure val xsValues =
  Set(List()).union(Set(List({ id: "x", title: "milk", done: false, deleted: false })))
    .union(Set(List({ id: "x", title: "milk", done: true, deleted: false }, { id: "y", title: "eggs", done: false, deleted: true })))
```

## Story: Keep a shared list of things to do

> As a member of a household, I want to add things to do, tick them off,
> rename them and remove them, so that everyone sees what is left.

### A to-do can be found by its id

`live` means it is there and not removed.

```quint
pure def has(todos: List[Todo], id: str): bool = todos.some(t => t.id == id)
pure def live(todos: List[Todo], id: str): bool = todos.some(t => t.id == id and not(t.deleted))
```

### A new to-do needs a title and an id never used before; other edits need a live to-do

A rename also needs a title. An edit of an unknown kind is never allowed. An id that was removed stays used.

```quint
pure def opAllowed(todos: List[Todo], op: Op): bool =
  if (op.kind == "create") op.title != "" and not(has(todos, op.id))
  else if (op.kind == "rename") op.title != "" and live(todos, op.id)
  else isKind(op.kind) and live(todos, op.id)
```

### Applying an edit changes only the to-do it names

A new to-do is added at the end, not done. Creating an id that already exists
changes nothing.

```quint
pure def edit(t: Todo, op: Op): Todo =
  if (t.id != op.id) t
  else if (op.kind == "done") { ...t, done: op.done }
  else if (op.kind == "rename") { ...t, title: op.title }
  else if (op.kind == "remove") { ...t, deleted: true }
  else t

pure def applyOp(todos: List[Todo], op: Op): List[Todo] =
  if (op.kind == "create")
    (if (has(todos, op.id)) todos else todos.append({ id: op.id, title: op.title, done: false, deleted: false }))
  else todos.listMap(t => edit(t, op))
```

### Two lists of to-dos are the same when they agree position by position

`==` does not compare records, so this is spelled out.

```quint
pure def sameTodo(a: Todo, b: Todo): bool =
  a.id == b.id and a.title == b.title and a.done == b.done and a.deleted == b.deleted

type Walk = { ok: bool, i: int }

pure def sameAt(ys: List[Todo], i: int, t: Todo): bool =
  i >= 0 and i < ys.length() and sameTodo(ys.nth(i), t)

pure val start: Walk = { ok: true, i: 0 }

pure def sameTodos(xs: List[Todo], ys: List[Todo]): bool =
  xs.length() == ys.length()
    and xs.foldl(start, (acc, t) => { ok: acc.ok and sameAt(ys, acc.i, t), i: acc.i + 1 }).ok
```

### Two edits are the same when they agree field by field

```quint
pure def sameOp(a: Op, b: Op): bool =
  a.kind == b.kind and a.id == b.id and a.title == b.title and a.done == b.done
```

## Story: Edits survive being sent twice

> As someone on a bad connection, I want an edit that reaches the server twice
> to count once, so that a retry never undoes or doubles my change.

### Applying an edit to a to-do twice is the same as applying it once

```quint
pure def lawEditingTwiceIsEditingOnce(t: Todo, change: Op): bool =
  sameTodo(edit(edit(t, change), change), edit(t, change))
```

### Creating a to-do twice adds it once

```quint
pure def lawCreatingTwiceAddsOnce(xs: List[Todo], change: Op): bool =
  change.kind == "create" implies applyOp(applyOp(xs, change), change).length() == applyOp(xs, change).length()
```

### An edit other than a creation never changes the number of to-dos

```quint
pure def lawAnEditKeepsTheLength(xs: List[Todo], change: Op): bool =
  change.kind != "create" implies applyOp(xs, change).length() == xs.length()
```

## Story: Copies of the list can be compared

> As the author of a spec that copies the list between machines, I want to
> know that a list is the same as itself, so that a copy taken without change
> can be shown to be the same list.

### A list of to-dos is the same as itself

```quint
pure def lawAListIsTheSameAsItself(xs: List[Todo]): bool = sameTodos(xs, xs)
```
