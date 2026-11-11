# Wave 3 sweep: concurrency, leases, locks, receipts, timers

Hand-written, 2026-11-11. Read-only research on branch `claude/quint-state-machines`. No file in the repository was
changed. No Quint model was run for this sweep: every result below comes from reading the code and the models.
"Covered" means that a model in `quint/` has the states and the transitions. A model that treats the machine as an
oracle does not count as coverage.

## 0. Method

1. I searched the production code for `FOR UPDATE`, `pg_advisory_*`, `ON CONFLICT`, `lease_*`, `setInterval`,
   `setTimeout`, process-level `Map`/`Set` fields and the receipt and idempotency columns
   (`action_receipts`, `x-ntwrk-svc-id` keys, `msg_id`, `delivery_id`). The search covered `packages/network/service`,
   `packages/network/src`, `packages/platform/src`, `packages/mcp/src`, `packages/blooio/src`, `packages/notify/src`,
   `deploy/backend` and `packages/observatory/src`.
2. For each hit, I found the machine in the catalog (section 2 of `docs/research/2026-11-07-state-machines.md`) and
   in the model headers. Then I checked whether the model has the states. I also read the "not modelled" notes in
   `docs/research/quint-findings/*.md`.
3. I followed the row locks of every transaction that writes to `network.members`, `platform.people`,
   `platform.memberships` and `platform.inbound`. Rule 2 of `quint/README.md` makes one SQL transaction one atomic
   action. Because of that rule, no model can show a lock-order cycle. The documented order is in
   `docs/research/state-machines/implicit-sweep.md:73`.

Most of the area is covered: `turn_consent` (signed-turn lease, sender locks), `outbound_queue` (line lock, row
lease, person-cap slot, admission fence), `runtime_ops` (store unit of work, tick loop, bias-report lock,
alert dispatcher), `relay` (relay action receipt), `profile_learning` (collect and withdrawal receipts),
`notify_capital` (delivery record and weekly cap), `auth_edge` (rate buckets, OTP, sessions) and `staff_console`
(tickets, reveals, grant reload). The findings below are the parts that are left over.

## 1. New machines (no model has their states)

### NM-1 (P1). Shared-agent action receipts for set-state, signals and updates

- Where: `packages/network/service/service.ts:2141-2266` (`sharedAction`). The claim is at 2183-2196, the lock is
  at 2172-2181, `complete` is at 2198-2203, the updates path is at 2204-2224, the set-state and signals paths are
  at 2225-2257, and the catch path is at 2258-2263.
- State: one key per action in the JSON column `platform.inbound.action_receipts` of the original open turn row.
  The key is `sha256([turnId, path, key])`. The value is `{requestHash, state}`, where state is
  `absent | processing | completed{response} | unresolved`.
- Transitions:
  - The claim transaction: `absent -> processing`. It is refused with `action_limit` when the row has 16 keys or
    more. It is refused with `expired_state_window` when the window has ended.
  - The work transaction: `processing -> completed` together with the effect. The effects are the member row
    `participation_state` and `participation_window` and an event row (set-state), the proposed facets and an
    event (signals), or the notify items marked seen (updates).
  - The catch path: `processing -> unresolved`. The response is 409 `action_unresolved` and it is not retryable.
  - A replay of a completed key returns the stored response. A different digest returns `action_conflict`. A
    key in `processing` or `unresolved` returns `action_unresolved`.
  - Other actors that act on the same row: the forget path seals the turn row and sets `action_receipts` to `'{}'`
    (`packages/network/service/runtime.ts:599-602`). `Inbox.purge` seals done rows after 7 days
    (`packages/network/service/inbox.ts:247-249`).
- Why `relay.qnt` does not cover it: `relay.qnt` models only `relay-endpoint.ts:175-263` (catalog M-125 is mapped
  to `relay`). The set-state, signals and updates paths use a separate copy of the same protocol. That copy has
  three differences:
  1. It takes one more lock (`network.members ... for update`, service.ts:2176).
  2. It checks the route authority again in `complete` (service.ts:2199). When that check throws, the catch at
     service.ts:2259 returns 403 before it writes `unresolved`, so the key stays `processing`.
  3. All action families share one limit of 16 keys on one turn row: relay (`relay-endpoint.ts:199`),
     set-state, signals, updates, and the `profile-collect` and `profile-withdrawal-v2` keys of
     `profile_learning`. No model has two families on one row.
- Rules that must hold:
  - `completedIffCommitted` for every family.
  - At most one effect for each key.
  - No key completes after the turn row left `done/open`, or after the membership changed (the lock rechecks
    `authorized()`).
  - The keys in a turn row count toward one limit of 16, whatever their family.
  - Liveness: a key does not stay `processing` with no worker (the same property as `noStuckKey`, SD-093). This
    copy has no lease or sweep either. A crash between the claim and the work leaves the key `processing` until
    the 7-day purge.
- Proposal: a new module, `quint/shared_actions.qnt`. It holds one turn row, the families
  `{relay, setState, signals, updates, collect}`, and the actions claim, work, crash, throw, routeExpire, forget,
  purge and replay. The model rules do not let one model import another, so `relay.qnt` keeps its endpoint part
  and the new module owns the shared row. This is valuable in Quint: the machine is a small finite map with
  several actors and a shared counter, and the receipts already follow the one-transaction-one-action form.

### NM-2 (P1). The participation window (M-111), assigned to `turn_consent` but not modelled

- Evidence: `docs/research/quint-findings/turn_consent.md:78` says "SD-217 ... not modelled (participation
  window)". `quint/turn_consent.qnt` has no participation state.
- State: `network.members.participation_state` is one of `normal | open | receiving | quiet | paused`.
  `participation_window` is null or `{state: open|busy|traveling|paused, from, until, note}`. The effective state
  is computed by `effectiveParticipation` (`packages/network/service/snapshot.ts:21-34`) from the row and the
  Clock. This is an implicit timer: a window is scheduled before `from`, active between `from` and `until`, and
  over after `until`. Nothing writes a row at those edges.
- Writers:
  - set-state (`service.ts:2226-2240`, under `members FOR UPDATE`).
  - `resumeMember` (`service.ts:977-990`, `FOR UPDATE`). The website account portal is withdrawn (founder correction
    2026-10-19), so check whether this writer still has a caller.
  - `endPause` on START (`service.ts:995-1003`, one UPDATE statement).
  - forget (`runtime.ts:618`, which sets the window to null).
- Readers:
  - The unit snapshot (`loadSnapshot`), which builds the Network's in-memory member state.
  - The open-turn context (`runtime.ts:816-843`).
  - The member-state read (`service.ts:960-969`).
  - The queue recipient policy (`channel.ts:189`), through the in-memory `rt.net` of the replica.
- Rules that must hold:
  - After a set-state to `paused` commits, no proactive send is admitted for that member while the window is
    active.
  - START ends a pause, but it does not end a busy or traveling window.
  - A window that is over has no effect.
  - The event row and the change commit together. An unchanged request writes no event (`stateUnchanged`).
- Race: see SD-W3-3 in section 3. The queue fence `stateCurrent` (`runtime.ts:711-715`) compares only the
  `xmin` of `network.network_state`. Set-state writes `network.members` and does not change that row, so a
  replica whose snapshot is older than the pause still counts as current.
- Proposal: extend `turn_consent.qnt` with the window (it already owns M-111 and START), and add the send-time
  read to `outbound_queue.qnt` as a per-row fact read from the replica view. Another option is a small new module,
  `quint/participation.qnt`. Its parts would be the window, the clock edges, set-state, START, a unit's snapshot
  read, and the admission. Quint is a good fit here: the timer edges and the stale view are the interleavings that
  matter, and both are small.

### NM-3 (P1). Lock order across transactions (implicit; README rule 2 makes it invisible)

- Facts:
  - `PgStore.save` (`packages/network/src/store.ts:302-311`) upserts `network.network_state` and then inserts every
    participation of every opportunity in the state. The foreign key `participations_member_app_fk`
    (`packages/observatory/db/migrations/0004_network_apps.sql:94`) takes `FOR KEY SHARE` on each participant's
    `network.members` row.
  - `writeUnit` (`runtime.ts:520`, `560`) inserts `network.messages`. That table also has a foreign key to
    `network.members`.
  - After those inserts, the same transaction locks `platform.people`:
    - forget, `for update of person` (`runtime.ts:494-497`);
    - an age statement, `update platform.people` (`runtime.ts:512-513`);
    - the relay `completeAction`, `lock(tx)`, `people ... for update` (`relay-endpoint.ts:178`).
  - Set-state, signals and updates lock in the opposite order (`service.ts:2173-2177`): `people FOR UPDATE`, then
    `memberships FOR UPDATE`, then `network.members FOR UPDATE`, then `inbound FOR UPDATE`. `FOR UPDATE`
    conflicts with `FOR KEY SHARE`.
  - The documented order is "network_state, people, memberships, members, inbound"
    (`implicit-sweep.md:73`). The unit save does not keep it: it takes a members lock (key share) before the
    people lock.
  - The queue admission (`outbound-queue.ts:542-548`) is safe. It takes `network_state FOR SHARE` first, so it
    serializes with the save at the first lock.
- Rule: every pair of transactions that can run at the same time takes its locks in one global order, or else
  each deadlock victim is retryable and its loss is safe.
- Proposal: a new module, `quint/row_locks.qnt`. Each transaction is a list of `(resource, mode)` steps. The model
  has a lock table with the Postgres conflict matrix (KEY SHARE, SHARE, NO KEY UPDATE, UPDATE), a wait-for
  relation, and the deadlock abort of one waiter. The invariant `noWaitCycle`, or the weaker
  `victimRetryable`, is checked over these transactions: unit save, sharedAction, the relay claim, the relay unit,
  queue admission, `acceptReceipt`, `correctHome` and `resumeMember`. This is valuable in Quint: a model can list
  every pair of paths, and no current model can see a cycle. The limit is that the lock lists must be copied by
  hand from the SQL, so the drift ledger has to map the module to each of those files.

### NM-4 (P2). The platform join lock is one process-wide queue

- Where: `packages/platform/src/pg-store.ts:309-322`. `withLock(key)` chains every call in the process on one
  `lockTail`, whatever the key. It then takes `pg_advisory_lock('platform:'+key)` on a reserved connection. The
  memory store (`packages/platform/src/store.ts:393-399`) chains per key. The two stores do not behave the same.
- Callers:
  - `Accounts.join` (`accounts.ts:357`), which serves the web join (`api.ts:559`) and the MCP signup.
  - `Accounts` number change (`accounts.ts:262`).
  - The text join inside a signed turn (`service.ts:1320`).
- The text-join critical section runs `memberMessage` and `rt.unitOfWork` (service.ts:1680-1722 region). Those
  wait for the network advisory lock (`store.ts:330-344`, a session lock held for the whole tick). They also run
  `deliver()` after the commit, which makes provider HTTP calls (`runtime.ts:778-781`).
- States: `idle`, `queued(key)`, `waitingAdvisory(key)` and `held(key)`, for each process. The cross-process
  advisory lock is per key.
- Rules: two joins of one phone do not interleave (this holds). A join of phone A does not wait for a join of
  phone B (this fails). A `withLock` callback does not call `withLock` (a convention only, see the comment at
  `accounts.ts:261`). With the global tail, a nested call waits for itself for ever. With the memory store, a
  nested call with another key works, so the tests do not catch it.
- Proposal: extend `join_age.qnt`. Its findings say that two concurrent turns are not modelled
  (`join_age.md:59`). Add two phones, one process tail, and a network lock held by a tick. In Quint this is a
  liveness and starvation property (a temporal property, or a witness that a join of B finishes while A waits).
  It is less useful than a safety model, and an integration test with two phones would be cheaper.

## 2. Model gaps (covered machines that miss part of this area)

### MG-1 (P1). `relay.qnt`: the action-receipt limit and the other families on the same turn row

`relay.qnt:88` keeps `receipt: str -> str` for relay keys only. It has no limit of 16
(`relay-endpoint.ts:199`, `service.ts:2192`), and no other family can use slots on that row. The relay keys,
the set-state, signals and updates keys, and the `profile-collect` keys share the limit. A turn that used 16 slots
on other actions refuses a relay with `action_limit` (429, not retryable). Fix this through NM-1, or add a
nondeterministic `otherKeys` counter to `relay.qnt`.

### MG-2 (P2). `outbound_queue.qnt`: the person cap is per person across apps

The model has one recipient and one app (`outbound_queue.qnt` header, CAP scaled to 1). `slotOnlyForLiveRow`
(`outbound_queue.qnt:1022`) allows a slot to stay when the member is gone. In the code, `person_cap_take`
(`0007_friends_platform_safety.sql:168-189`) counts `platform.person_sends` per person across every app, under
one global advisory lock. Forget sets rows to `dropped_forgotten` in SQL (`runtime.ts:621-623`, `631-633`) and does
not call `person_cap_release`. When a row of app A took a slot (dispatch takes the slot at
`outbound-queue.ts:471-473`, and the admission can then return `stale_view` or `busy`), and the person then leaves
app A before the row is sent, the slot stays for 24 hours. App B can then send only 2 proactive messages that day.
The error is on the safe side (fewer messages), but it is a wrong count. Add a second app to the person-cap part of
the model, or state the carve-out in the header.

### MG-3 (P2). `auth_edge.qnt`: the Cloud validation cache outside production

The model follows production only (`auth_edge.qnt:477-478`: "In production every request asks Cloud (no cache)").
`api.ts:264-283` keeps `validated: Map<sessionHash, until>` with a 60 s TTL when `!productionCloud` (staging and
dev). Race: request A calls `validate` and the call is in flight. Cloud revokes the session. Request B gets
`invalid` and deletes the entry (`api.ts:281`). Then A's late `valid` answer writes the entry again
(`api.ts:279-280`). The revoked session is then accepted for 60 s without a Cloud call. The fix would store the
entry only when no denial arrived after the request started (a generation counter). Add a `cacheOn` flag to the
model with the actions `validateStart` and `validateEnd`.

### MG-4 (P2). `runtime_ops.qnt` and `relay.qnt`: the SLA alert set is process memory

`slaAlerted: Set<string>` (`service.ts:322`, used at 544, logic at 2870-2881) keeps the alert dedupe in each
process. `afterTick` runs on whichever replica ran the tick (`runtime.ts:769`). The effects are:

- Two replicas each raise an alert for the same overdue review item.
- A restart raises the alert again for every overdue item.
- A replica that does not see an item in its queue snapshot prunes the item's key.

No rule is broken, because these are alerts. But the `heldSlaAlerted` rule in `relay.qnt` assumes one alerter.
Model it as a set for each replica, or state the abstraction in the model header.

### MG-5 (P2). `turn_consent.qnt`: the routing machine is an oracle

The header of `turn_consent.qnt` says "The routing decision (service.ts:964-1010) is an oracle". `join_age.qnt` has
the pending and invite branches. The other branches are not modelled: the `share` pending, the newest open item
or last writer, and `met`, which are rules 4 and 5 (`service.ts:1070-1130`). They read `platform.pending_texts`
(a TTL of one day, `service.ts:120`) and the last-item routing view. Concurrency is not the risk here, because the
sender lock serializes turns of one sender. The risk is stale TTL state. A `share` pending that is still within
its day routes a later "SHARE" to the app that asked for it. That holds only while the person is still a member of
that app, which `service.ts:1124` checks. I found no defect in this branch. The gap is only that no model has the
TTL states.

## 3. Suspected defects

### SD-W3-1 (P1, plausible, not reproduced). Deadlock between a unit save and set-state, signals or updates loses the action or the member turn

Trigger (member X of person P, where X is a participant of an opportunity in the network state, for example the
match of a relay thread):

1. Eliza runs SET_STATE (for example "pause me for a week") for X's open turn T1. `sharedAction` takes
   `platform.people(P) FOR UPDATE` (`service.ts:2173`).
2. At the same time, a unit of X's network commits:
   - a RELAY action of the same Eliza turn (`relay-endpoint.ts:213-243`), or
   - X's next member turn T2 that states an age (`runtime.ts:505-514`).
   The unit's save upserts `network_state`, then inserts participations. Through the foreign key, this takes
   `FOR KEY SHARE` on `network.members(X)` (`store.ts:311`).
3. `sharedAction` asks for `network.members(X) FOR UPDATE` (`service.ts:2176`). It waits for the key share.
4. The unit reaches `completeAction` (`lock(tx)`: `people(P) FOR UPDATE`, `relay-endpoint.ts:178`) or the age
   update (`update platform.people`, `runtime.ts:512`). It waits for step 1. This is a cycle.
5. Postgres aborts the first waiter after `deadlock_timeout`. Two outcomes are possible:
   - The set-state is aborted. The catch (`service.ts:2260-2262`) marks the key `unresolved` and answers 409
     `action_unresolved` (not retryable). The pause is lost, and the agent cannot try the same id again.
   - The unit is aborted. A relay ends `unresolved` (`relay-endpoint.ts:258-262`). A member turn ends with
     `turn_unresolved`, not retryable (`inbox.ts:160-170`). An age statement in that turn, including a minor
     age, is rolled back with the unit. The comment at `runtime.ts:501-504` says that a failure "cannot lose" this
     safety fact.

`gap-active-member-journey.md:530` says "Network units do not write these columns, so there is no lost update".
That is true for the columns, but the foreign-key lock was not considered. There is no retry on SQLSTATE 40P01
anywhere in `packages/network`, `packages/platform` or `packages/blooio`.

Fix options (not applied):
- (a) `sharedAction` takes `network.members` with `FOR NO KEY UPDATE`, which does not conflict with KEY SHARE.
  It needs only to exclude other writers of the window columns.
- (b) Take the people lock in the unit before the participations insert. A locked pre-step in `save` is one way.
- (c) Retry the unit and the action once on `40P01` with the same ids.

The test that should fail before the fix is an integration test that holds a unit save open with a barrier
between the participations insert and `completeAction`, and runs set-state for the same member.

### SD-W3-2 (P2, plausible). A text join blocks every other join of the process for a whole tick

- `PgPlatformStore.withLock` puts every key in the process on one tail (`pg-store.ts:309-313`). The text join holds
  the tail while it runs `rt.unitOfWork` (`service.ts:1320` -> `join` -> `memberMessage` or `unitOfWork`, with
  `deliver()` after the commit).
- Trigger: replica R runs a matching tick on `ntwrk:nyc` that holds `network-tick-ntwrk:nyc` for a long time.
  Person A's first text is a join on R, so R's tail is held and A's join waits for the network lock. Then person B
  submits the web join (`api.ts:559` -> `accounts.join` -> `withLock("join:B")`) on R. B waits behind A even though
  B's key is different. The web request times out.
- A second trigger has no tick in it: A's join waits on the cross-replica advisory lock `platform:join:A`, which
  another replica holds.
- Fix: use a tail for each key (as the memory store does), and keep the cross-process advisory lock.
- Test: an integration test with two phones, where the first join is held at a barrier inside the unit.

### SD-W3-3 (P2, plausible). A proactive text can reach a member right after the pause commits

- Set-state commits `paused` on `network.members` (`service.ts:2238`) and changes nothing in `network.network_state`.
- Trigger: replica A's tick unit loaded its snapshot at t0. Set-state commits at t1 > t0. The unit saves (A's `seen`
  becomes the new `xmin`), then `deliver -> drainQueue`.
- `stateCurrent` is true (`runtime.ts:697`, `711-715`), so `blooioRecipientPolicy` reads the stale in-memory
  participation of t0 (`channel.ts:189`). The admission transaction checks `account_status` and `opted_out`
  (`outbound-queue.ts:546-561`) but not the participation. A due proactive row is admitted and sent.
- The comment at `outbound-queue.ts:113` says that the recipient check covers "paused at send time".
- The window lasts as long as one unit. It is narrow, but it breaks the rule that the member was just told holds.
- Fix: read `participation_state` and `participation_window` in the admission transaction (the member row is
  already locked there) for proactive rows.
- Test: an integration test that pauses a member between a unit's load and its save.

### SD-W3-4 (P2). An action receipt stays `processing` when the route authority expires between the claim and the work

- `complete` calls `assertLockedRoute(b.networkAuthority)` (`service.ts:2199`). Its throw rolls back the work
  transaction. The catch returns 403 at `service.ts:2259` before the `unresolved` update at 2260-2262. The key
  that the claim transaction committed stays `processing` until the 7-day purge.
- Effects: it uses one of the 16 slots of the turn row, and a replay gets `action_unresolved`. That reply is safe
  but wrong: the action did nothing.
- Trigger: a route-authority envelope with `admitUntil` that ends between the claim transaction and the work
  transaction (the cut-over window of `route-authority.ts`).
- Fix: write `unresolved` in the RouteAuthority branch as well.
- The same machine without the route check is SD-093 in `relay.qnt` (`noStuckKey`, outside `safety`).

## 4. Checked and found covered (no item)

- Signed-turn claim, lease renew timer and sweep, the compliance reclaim, and the old run that is still alive:
  `turn_consent` (`inbox.ts:85-188`).
- The per-sender legacy chain (`inbox.ts:79`, `271-285`), process `Map` plus session advisory lock: the
  `handleWaiting` path is in `turn_consent`. In production the gateway path does not write pending rows.
- The line lock, row lease, admission fence, the `capTake` that is idempotent per `msg_id`, the `failed_unknown`
  slot and receipt reconcile: `outbound_queue`.
- The network advisory lock (`store.ts:320-344`), the in-process queue `busy`, `readState`, the bias-report
  `pg_advisory_xact_lock` (`service.ts:566-579`) and the tick loop with `tickDone` and shutdown drain:
  `runtime_ops`.
- The notify delivery record (items `FOR UPDATE`, `notify/pg-store.ts:123-138`) and the weekly cap read outside
  the transaction. Overlapping plans always share an item, so the second plan is refused. `notifyTargets`
  (`service.ts:297`, `700-722`) is set in the same call chain before `enqueue`. Covered by `notify_capital`.
- The rate buckets with sorted `pg_advisory_xact_lock` (`platform/pg-store.ts:278-303`): `auth_edge`,
  `turn_consent`.
- The profile cleanup receipts without `FOR UPDATE` (`profile-suggestions.ts:376`), which the person and member
  locks serialize: `profile_learning`.
- The staff grant reload, tickets, reveals and photo previews: `staff_console`.
- `cost.ts` budgets only raise alerts (there is no spend gate), so there is no machine to model.
