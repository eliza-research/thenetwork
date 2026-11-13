# Shared to-do list, modelled end to end

A small full-stack application: a Node.js backend with an HTTP API and a
React page, sharing one to-do list between browser tabs that may go offline.
Both halves run the state machines generated from `spec/`, and a fourth spec
puts the server, two tabs and an unreliable network together and checks the
rules only the whole system can state.

```sh
npm run check      # the whole pipeline (from this directory)
npm start          # then open http://localhost:3000 in two windows
```

Needs Node 24+ (the server strips TypeScript types itself, so there is no
build step) and Dafny on the path. The page loads React 18 from esm.sh.

| Path | Kind | What it covers |
|---|---|---|
| `spec/todo.md` | library, 4 laws | A to-do, the four edits, when an edit makes sense, how it is applied, list equality |
| `spec/server.md` | state machine, 5 transitions | The backend: one request per edit, each request answered once and recognised as a retry only with the same edit, version = number of changes, ids never reused |
| `spec/client.md` | state machine, 9 transitions | One tab: confirmed copy + queue of unanswered edits, optimistic view, offline, answers and pushes |
| `spec/system.md` | state machine, 9 transitions | Server + tabs `a` and `b` + a network that loses, repeats and reorders + anyone forging requests in a tab's name; a ghost history of every version |
| `spec/*.proof.dfy` | proofs | Everything Dafny could not prove alone (uniqueness under append/filter/map, fold lemmas, the system rules) |
| `src/server.ts`, `src/main.ts` | backend shell, tested | `node:http`: `POST /api/events`, `GET /api/snapshot`, `GET /api/stream` (server-sent pushes), and the frontend's files |
| `src/protocol.ts` | shared shell | Wire format; a queued edit as a server event |
| `src/web/app.ts`, `index.html` | frontend shell | React page; `useReducer` with the generated client `step` |
| `src/web/sync.ts` | frontend shell, tested | fetch/stream code shared by the page and the end-to-end test |
| `src/inbox.ts` | hand-written, proved | `drain`: a batch of pushes applied in a loop, proved to keep the client's rules |
| `test/` | tests | server over HTTP, the reducer, two tabs converging against the real server |

## How the halves fit

- **Backend.** `TodoStore.handle` passes the request body through
  `parseEvent` of `gen/server.ts`, and answers 400 to `refuse`, which only
  the server may decide. A request whose client and number the log already
  holds is not applied again: it is told it was accepted only if the log
  accepted that same edit (`acceptedAs`), so a request that reuses a number
  for another edit is refused rather than taken for a retry. A new request is
  applied with `step` if `enabled` says so, and otherwise refused with the
  machine's `refuse` event, which is logged too. Every change is pushed to
  the open tabs. The rules are checked once, of the initial state; every
  transition is proved to keep them.
- **Frontend.** The page's state is a `Client` and its reducer is `step` from
  `gen/client.ts`. Clicks dispatch `create`/`setDone`/`rename`/`remove`;
  answers dispatch `receiveAck`/`receiveRefusal`; pushes dispatch
  `receiveSnapshot`. Buttons are enabled by the generated guards
  (`canCreate`, …). The page keeps one request in flight: it sends the
  oldest queued edit, and the next once that one is answered, also after
  coming back online. Sending the whole queue at once would let the network
  reorder a user's own edits, so that ticking off a to-do could arrive
  before creating it and be refused; the system spec requires that a user
  editing alone is never refused.
- **Ids.** A tab names a new to-do `<tab>-<n>`, so it can create and edit
  to-dos offline. Removing leaves a tombstone, so an id is never reused.

## What is proved, simulated and trusted

- **Proof obligations** (205, none accepted as simulated only): every
  transition of the server, the client and the system must keep every
  `always` and `step` rule, every law must hold, and `drain` must meet its
  contract. `npm run check` reports the current proof result. At the system
  level that includes: each part keeps its
  own rules, no tab is ahead of the server, and every copy of the list, in a
  tab or in flight, is exactly the list as it was at the version it carries.
- **Simulated**: all of the above on 10,000 random traces per spec, and the
  `sometimes` rules, among them that two tabs that both edited can converge
  on the server's list despite loss, duplication and reordering.
- **Tested**: the HTTP shell, the push stream, the page's network code and a
  two-tab run against the real server (`test/`).
- **Trusted**: the shell (`src/server.ts`, `src/web/`), React, the
  generator, LemmaScript, Dafny and Quint. Convergence is a `sometimes`
  rule: the model shows it can happen, not that it always does (liveness
  needs fairness, which the tools do not check).

## What the checks found

- **A negative edit count.** The client rule "every queued edit was numbered
  here" could not be proved for a new edit: nothing said `made` is not
  negative, and with a negative count the next number is below 1. Now a
  rule, marked "Discovered by the proof".
- **Copies in flight need a rule of their own.** "A tab's copy is the list at
  its version" is only inductive together with the same statement for every
  answer on the network; the system spec states both.
- **A request number does not identify its edit.** A retry must carry the
  same edit before an earlier acceptance can acknowledge it.
- **A user's dependent edits must arrive in order.** Sending the oldest
  unanswered edit first prevents a later edit reaching the server before
  the to-do it changes has been created.
- **The forgery count is nonnegative.** Otherwise a forgery could change a
  negative count to zero and incorrectly restore the lone-user guarantee.

## Limits of the spec language met here

- **An imported machine's types could only mention its own types.** This
  example found the bug: `import client as C` qualified every type name
  inside `Client` with `C::`, including `Todo` and `Op`, which `client`
  imported from `todo`, and the check stopped with `unknown type C::Op`. The
  tools now bring an imported machine's imported types along (selftest: "a
  machine whose state holds a library's type can be imported under a name").
  The specs here still use the workaround they were written with: the server
  and client state types write the to-do and edit records out in full (the
  tools match them back to `Todo` and `Op` by shape), and the edit's kind is
  a string. Simplifying them is a good first exercise.
- **A machine cannot be imported with `.*`**, and two machines whose
  transitions share names (`create`, `initial`) could not be anyway; the
  system spec uses `S::` and `C::`.
- **Proofs about an imported machine's transitions cannot be reused.** The
  system unit is proved against the server's and client's definitions, not
  their proofs. The server and client therefore restate "a commit / refusal /
  queued edit / answer keeps the rules" as laws, which the system proof file
  calls as `server_law…_ensures` and `client_law…_ensures`.
- **No equality on records or lists.** `sameTodos` compares two lists by a
  fold with a position counter; that list equality is reflexive is a law
  with an inductive proof.
- **No list indexing operations besides `nth`.** Taking the i-th message off
  the network is a fold (`dropAt`), and the proof that it only keeps messages
  that were there is an induction.
- **Folds over records need a named type.** `foldl` with an anonymous record
  accumulator is refused (`unsupported type rec`), hence `Walk` and `Cut`.
- **A helper that takes the state first and returns it is a transition**, so
  helpers such as `commit`, `queue`, `withClient` take it second.
- **Sample sets are per spec.** `<param>Values` in an imported library is
  not used for the importing spec's parameters, and two specs that define the
  same name cannot be imported `.*` together, so the library's sets have
  their own names (`changeValues`, `xsValues`).
- **No liveness.** "Both tabs eventually agree" can only be stated as
  "sometimes they agree".
- **Hand-written loops see only definitions, not proofs.** `drain` could not
  call the generated `step` and keep `inv`, because the client's transition
  proofs live in its proof file; it calls `receiveSnapshot`, which Dafny
  proves on its own.
- **The HTTP and React layers are outside the model.** Retry timing, the
  push stream and the DOM are tested, not proved.
