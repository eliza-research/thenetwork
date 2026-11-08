// quint-check: max-steps=25 max-samples=6000 verify-steps=3
//
// The single inbox (packages/notify) and the network capital ledger (packages/capital), as they are
// on branch wave2/notify_capital (base ad67275 plus the fixes for SD-049, SD-150, SD-151, SD-153,
// SD-154, SD-156, SD-303 (dedupe key), SD-341 and SD-350). Plan: docs/research/2026-11-07-state-machines.md
// section 6.17. Source reports: docs/research/state-machines/blooio-notify.md sections 15-22 and
// capital.md sections 1-10. Findings: docs/research/quint-findings/notify_capital.md.
//
// Two parts in one file, with no shared state:
//  - Part A (Notify). One person, two apps (ntwrk, slop), two Network texts (each its own inbox
//    subject, SD-303), two items from Notifier.add, two scheduler replicas, one assistant surface
//    (claude), the outbound queue as an oracle that can send or refuse a row.
//  - Part B (Capital). Three members, one plan (o1), one help round (o2), the in-memory ledger of the
//    runtime, the unit of work, network.capital_events (in seq order), forget and restart.
//
// Machines: notify-item, notify-weekly-cap, assistant-surface-signal (Part A); capital-member-eligibility,
// capital-event-intake, capital-vouch-lifecycle, capital-plan-commitment, capital-entry-reversal (credit
// only), capital-service-persistence (Part B). capital-fraud-review, capital-rate-windows and
// capital-lever-locks have no production trigger (runtime.ts:118 builds the ledger with reader: false,
// so no flag, no fraud item, no lever read), so their actions are left out. Multipliers, decay and the
// period cap are fixed at 1 (an abstraction: they change amounts, not which state is reached).
//
// Oracles (quint/README.md rule 7): due time, quiet hours, the surface score in resolveDelivery, the
// outbound queue decision (consent ledger, person cap, provider), and the clock skew.
//
// `safety` holds every invariant that the code on this branch keeps. The invariants that still fail
// are named values outside `safety`; each has a comment with the register id and the reason it is
// not fixed (skipped, not reproduced, refuted, or a residual found by this model).
module notify_capital {

  // ================================================================================================
  // Part A: Notify
  // ================================================================================================

  pure val APPS = Set("ntwrk", "slop")
  // Network texts. Since SD-303 (service.ts:625-628) the inbox subject of a Network text is the
  // text's own id, so text t is subject t.
  pure val TEXTS = Set(1, 2)
  // Items from Notifier.add (scheduler.ts:95-98). No production producer calls it yet (notify
  // README "Not yet: producers"); the API, its tests and a future producer do. Only these items can
  // be pending, so only they reach dispatch.
  pure val ADDED = Set(3, 4)
  pure val SUBJECTS = TEXTS.union(ADDED)
  pure val REPLICAS = Set("r1", "r2")
  // weeklyCap. The code default is 2 (scheduler.ts:59). The model uses 1 so that two counting texts
  // are already over the cap; the cap logic (scheduler.ts:134-142) is the same for any value.
  pure val CAP = 1
  // surface.ts:39
  pure val MAX_IGNORED_STREAK = 2

  // The dedupe key is person|app|event|subject (store.ts dedupeKey). One person: the subject is the
  // key, and each subject belongs to one app (odd: ntwrk, even: slop).
  pure def subjApp(s: int): str = if (s % 2 == 1) "ntwrk" else "slop"

  // notify.inbox_items. `notified` is "" (null), "net" (a net:<message id> delivery from recordSent)
  // or "ntf" (a scheduler delivery). `text` is the Network text that created the item (0 for add).
  type Item = { exists: bool, text: int, requested: bool, seen: bool, notified: str }
  // A member-facing Network text (network.messages) and its projection into the inbox
  // (runtime.ts:621-647, service.ts:615-631).
  type NetText = { sent: bool, proactive: bool, projected: bool }
  // notify.deliveries. The scheduler's delivery id is a hash of the person and the item ids
  // (scheduler.ts:84-85), so a delivery is keyed by its item set.
  type Deliv = { items: Set[int], counts: bool, target: str, outcome: str }
  // platform.outbound row of a scheduler text (row id = delivery id). `via` is the app of the network
  // member the text goes out on (service.ts:649-660). `pausedLeak` records, at send time, that the
  // text carried a proactive item of an app whose member was paused.
  type QRow = { status: str, proactive: bool, via: str, pausedLeak: bool }
  // One replica's dispatch in flight (scheduler.ts:176-203).
  type Rep = { phase: str, items: Set[int], counts: bool, target: str, via: str }
  // notify.surface_signals for the assistant surface "claude".
  type Sig = { exists: bool, everCreated: bool, active: bool, streak: int, usedWhileDropped: bool }

  var items: int -> Item
  var net: int -> NetText
  var netDel: int -> bool
  var netDelCounts: int -> bool
  var ntf: Set[int] -> Deliv
  var queue: Set[int] -> QRow
  var rep: str -> Rep
  var sig: Sig
  // platform.memberships.state per app: "active", "invited" or "removed".
  var ms: str -> str
  // network.members participation of the person's member in each app (paused or held).
  var paused: str -> bool

  pure val NO_ITEM: Item = { exists: false, text: 0, requested: false, seen: false, notified: "" }
  pure val IDLE: Rep = { phase: "idle", items: Set(), counts: false, target: "", via: "" }

  // ------------------------------------------------------------------------------------------------
  // Derived reads

  // peopleWithPending and unseen().filter(notifiedAt undefined) (pg-store.ts, scheduler.ts:125).
  def pending: Set[int] = SUBJECTS.filter(s => items.get(s).exists and not(items.get(s).seen) and items.get(s).notified == "")

  // The notify recipient: the first live member, The Network first (service.ts:649-660). It does not
  // read the item's app, and proactiveAllowed is always true (service.ts:657).
  def recipientApp: str =
    if (ms.get("ntwrk") == "active") "ntwrk" else if (ms.get("slop") == "active") "slop" else ""

  // capSendsSince: deliveries that count toward the cap, net: and ntf_ alike (pg-store.ts capSendsSince).
  // The model has no time: every delivery is inside the 7-day window.
  def capCount: int =
    TEXTS.filter(t => netDel.get(t) and netDelCounts.get(t)).size()
    + ntf.keys().filter(k => ntf.get(k).counts).size()

  // A surface is usable when active and its streak is under 2 (surface.ts:47).
  def claudeUsable: bool = sig.exists and sig.active and sig.streak < MAX_IGNORED_STREAK

  // resolveDelivery is an oracle (a score): it can pick the assistant only when it is usable.
  def targets: Set[str] = if (claudeUsable) Set("imessage", "claude") else Set("imessage")

  // The surface_signals insert trigger (retention.sql:58-76): a person with a membership that is not
  // removed keeps or gets signals; after erasure the insert is skipped.
  def signalsAllowed: bool = APPS.exists(a => ms.get(a) != "removed")

  // ------------------------------------------------------------------------------------------------
  // Actions: the Network side

  // A Network send that the adapter accepted (runtime.ts:590-597). The Network does its own consent
  // checks; it does not send a proactive text to a paused member.
  action netSend(t: int, proactive: bool): bool = all {
    not(net.get(t).sent),
    ms.get(subjApp(t)) == "active",
    not(proactive and paused.get(subjApp(t))),
    net' = net.set(t, { sent: true, proactive: proactive, projected: false }),
    items' = items, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    sig' = sig, ms' = ms, paused' = paused,
  }

  // projectNotifications -> delivered -> recordSent -> store.addDelivered: ONE transaction
  // (scheduler.ts:105-110, pg-store.ts addDelivered; SD-151 fix 472cecb). It inserts the item (or
  // finds it by its dedupe key, subject = the text id since SD-303 fix 893944f) and, when the item is
  // not notified, records the net:<id> delivery of that item alone. A throw rolls back both, so an
  // item made from a Network text is never pending. The projection selects members whose account is
  // not removed (runtime.ts:628); the inbox insert trigger refuses a removed scope (retention.sql:29-38).
  action projRecord(t: int): bool = {
    val x = net.get(t)
    val it = items.get(t)
    all {
      x.sent, not(x.projected),
      ms.get(subjApp(t)) != "removed",
      if (it.exists) all {
        // A repeat of the same text (the projection after a crash): the item is already notified.
        items' = items, netDel' = netDel, netDelCounts' = netDelCounts,
      } else all {
        items' = items.set(t, { exists: true, text: t, requested: not(x.proactive), seen: false, notified: "net" }),
        netDel' = netDel.set(t, true),
        netDelCounts' = netDelCounts.set(t, x.proactive),
      },
      net' = net.set(t, { ...x, projected: true }),
      ntf' = ntf, queue' = queue, rep' = rep, sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // Notifier.add -> store.addItem (scheduler.ts:95-98): insert or find by the dedupe key. No
  // production producer calls it (see ADDED). The insert trigger refuses a removed scope.
  action notifyAdd(s: int, requested: bool): bool = all {
    ADDED.contains(s),
    not(items.get(s).exists),
    ms.get(subjApp(s)) != "removed",
    items' = items.set(s, { exists: true, text: 0, requested: requested, seen: false, notified: "" }),
    net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    sig' = sig, ms' = ms, paused' = paused,
  }

  // ------------------------------------------------------------------------------------------------
  // Actions: the scheduler (Notifier.dispatch, one replica). Each await between two commits is a
  // separate action, so the other replica, the projection and the member can run in between.

  // plan (scheduler.ts:118-147, 157-173). Writes nothing but tokens (not modelled). Due time and
  // quiet hours are oracles: a hold is simply no step.
  action plan(r: str, target: str): bool = {
    val via = recipientApp
    val p = pending
    val overCap = capCount >= CAP and p.exists(s => not(items.get(s).requested))
    val send = if (overCap) p.filter(s => items.get(s).requested) else p
    all {
      rep.get(r).phase == "idle",
      via != "",
      p != Set(),
      send != Set(),
      target.in(targets),
      rep' = rep.set(r, { phase: "planned", items: send, counts: send.exists(s => not(items.get(s).requested)), target: target, via: via }),
      items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // The re-read before record (scheduler.ts:181-183): keep items still unseen and unnotified. With
  // fewer items the plan is rebuilt (a new id, a new surface choice); the cap is not checked again.
  action reread(r: str, target: str): bool = {
    val x = rep.get(r)
    val fresh = x.items.filter(s => items.get(s).exists and not(items.get(s).seen) and items.get(s).notified == "")
    all {
      x.phase == "planned",
      target.in(targets),
      rep' = if (fresh == Set()) rep.set(r, IDLE)
             else if (fresh == x.items) rep.set(r, { ...x, phase: "checked" })
             else rep.set(r, { ...x, phase: "checked", items: fresh, counts: fresh.exists(s => not(items.get(s).requested)), target: target }),
      items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // recordDelivery for the scheduler's delivery, one transaction (scheduler.ts:186-191,
  // pg-store.ts deliveryIn). SD-150 fix a66f44e: it locks the items (select for update) and records
  // nothing when the delivery id exists, or an item is gone or already notified. dispatch then
  // cancels the plan (scheduler.ts:191).
  action recordDelivery(r: str): bool = {
    val x = rep.get(r)
    val open = x.items.forall(s => items.get(s).exists and items.get(s).notified == "")
    all {
      x.phase == "checked",
      if (ntf.keys().contains(x.items) or not(open)) all {
        rep' = rep.set(r, IDLE), ntf' = ntf, items' = items,
      } else all {
        rep' = rep.set(r, { ...x, phase: "recorded" }),
        ntf' = ntf.put(x.items, { items: x.items, counts: x.counts, target: x.target, outcome: "open" }),
        items' = SUBJECTS.mapBy(s => if (x.items.contains(s)) { ...items.get(s), notified: "ntf" } else items.get(s)),
      },
      net' = net, netDel' = netDel, netDelCounts' = netDelCounts, queue' = queue, sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // sink.enqueue -> notifySink (service.ts:667-675): a unit of work queues a system send on the
  // member of `via`. The queue row id is the delivery id; a second enqueue of the same id is a no-op.
  action enqueue(r: str): bool = {
    val x = rep.get(r)
    all {
      x.phase == "recorded",
      rep' = rep.set(r, IDLE),
      queue' = if (queue.keys().contains(x.items)) queue
               else queue.put(x.items, { status: "queued", proactive: x.counts, via: x.via, pausedLeak: false }),
      items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // A replica stops (crash, deploy, a throw) anywhere in dispatch. "A crash after this and before
  // enqueue loses one text, never sends two" (scheduler.ts:185).
  action crash(r: str): bool = all {
    rep.get(r).phase != "idle",
    rep' = rep.set(r, IDLE),
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue,
    sig' = sig, ms' = ms, paused' = paused,
  }

  // ------------------------------------------------------------------------------------------------
  // Actions: the outbound queue (oracle)

  // stillNeeded at send time (scheduler.ts:209-215, channel.ts:180): the delivery exists, every
  // original item exists and is not expired, and at least one item is unseen.
  def stillNeeded(k: Set[int]): bool =
    ntf.keys().contains(k) and k.forall(s => items.get(s).exists) and k.exists(s => not(items.get(s).seen))

  // The queue sends the row. Assumption: the queue refuses a proactive row to a paused member of the
  // row's own app (the member checks of the app the row is queued on), and the row's member must be live.
  action queueSend(k: Set[int]): bool = {
    val q = queue.get(k)
    all {
      queue.keys().contains(k), q.status == "queued",
      stillNeeded(k),
      ms.get(q.via) == "active",
      not(q.proactive and paused.get(q.via)),
      queue' = queue.set(k, { ...q, status: "sent",
        pausedLeak: q.proactive and k.exists(s => items.get(s).exists and not(items.get(s).requested) and paused.get(subjApp(s))) }),
      items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, rep' = rep,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // The queue ends the row unsent: refused (consent ledger, person cap, opted out), expired, or
  // obsolete (stale: stillNeeded is false). Notify is not told (no feedback path, SD-095).
  action queueEnd(k: Set[int], status: str): bool = {
    val q = queue.get(k)
    all {
      queue.keys().contains(k), q.status == "queued",
      if (stillNeeded(k)) status.in(Set("refused", "expired")) else status == "obsolete",
      queue' = queue.set(k, { ...q, status: status }),
      items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, rep' = rep,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Actions: the member and the assistant

  // readUpdates without a token (scheduler.ts readUpdates; service.ts:635-639; MCP get_updates): touch,
  // then mark the app's unseen items seen. touch writes last_used_at only (pg-store.ts touch).
  action readApp(app: str, surface: str): bool = all {
    ms.get(app) == "active",
    // A read with nothing new is a stutter, except a use of a dropped surface.
    SUBJECTS.exists(s => items.get(s).exists and subjApp(s) == app and not(items.get(s).seen))
      or (surface == "claude" and sig.exists and sig.streak >= MAX_IGNORED_STREAK),
    items' = SUBJECTS.mapBy(s => if (items.get(s).exists and subjApp(s) == app) { ...items.get(s), seen: true } else items.get(s)),
    sig' = if (surface == "claude" and signalsAllowed)
             if (sig.exists) { ...sig, usedWhileDropped: sig.usedWhileDropped or (sig.active and sig.streak >= MAX_IGNORED_STREAK) }
             else { ...sig, exists: true, everCreated: true }
           else sig,
    net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    ms' = ms, paused' = paused,
  }

  // The member opens the deeplink of a sent text on Claude and the assistant redeems its token
  // (scheduler.ts redeem): the token's items are seen, the delivery is "acted", the streak resets.
  action redeem(k: Set[int]): bool = all {
    ntf.keys().contains(k), ntf.get(k).target == "claude", ntf.get(k).outcome == "open",
    queue.keys().contains(k), queue.get(k).status == "sent",
    items' = SUBJECTS.mapBy(s => if (k.contains(s) and items.get(s).exists) { ...items.get(s), seen: true } else items.get(s)),
    ntf' = ntf.set(k, { ...ntf.get(k), outcome: "acted" }),
    sig' = if (signalsAllowed) { ...sig, exists: true, everCreated: true, streak: 0 } else sig,
    net' = net, netDel' = netDel, netDelCounts' = netDelCounts, queue' = queue, rep' = rep, ms' = ms, paused' = paused,
  }

  // sweep (scheduler.ts sweep): an open scheduler delivery past the outcome window is "ignored",
  // and the target surface's streak goes up (pg-store.ts recordOutcome).
  action sweepOne(k: Set[int]): bool = all {
    ntf.keys().contains(k), ntf.get(k).outcome == "open",
    ntf' = ntf.set(k, { ...ntf.get(k), outcome: "ignored" }),
    sig' = if (ntf.get(k).target == "claude" and signalsAllowed)
             if (sig.exists) { ...sig, streak: sig.streak + 1 } else { ...sig, exists: true, everCreated: true, streak: 1 }
           else sig,
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, queue' = queue, rep' = rep,
    ms' = ms, paused' = paused,
  }

  // OAuth grant on or off (service.ts:644-646, pg-store.ts setActive). It does not touch the streak.
  action setActive(b: bool): bool = all {
    signalsAllowed, not(sig.exists and sig.active == b),
    sig' = if (sig.exists) { ...sig, active: b } else { ...sig, exists: true, everCreated: true, active: b },
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    ms' = ms, paused' = paused,
  }

  // The member pauses or resumes in one app (participation state, safety hold).
  action setPaused(app: str, b: bool): bool = all {
    paused.get(app) != b,
    paused' = paused.set(app, b),
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    sig' = sig, ms' = ms,
  }

  // An invited membership completes its join.
  action acceptInvite(app: str): bool = all {
    ms.get(app) == "invited",
    ms' = ms.set(app, "active"),
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    sig' = sig, paused' = paused,
  }

  // "leave <app>": the canonical removal and notify.forget_data(person, app) in one transaction
  // (runtime.ts:517-555, retention.sql:78-129). Items of the app go, deliveries are trimmed and an
  // empty one is deleted, queue rows of that member are dropped. SD-341 fix 428e246 (retention.sql
  // and migration 0057): signals stay when another membership is not removed (active or invited),
  // the same rule as the insert trigger.
  action leave(app: str): bool = {
    val keep = APPS.exists(a => a != app and ms.get(a) != "removed")
    val left = SUBJECTS.filter(s => items.get(s).exists and subjApp(s) != app)
    all {
      ms.get(app) == "active",
      // One app at a time; the person keeps one other membership. Full erasure of the person is the
      // identity_sagas model.
      APPS.exists(a => a != app and ms.get(a) != "removed"),
      ms' = ms.set(app, "removed"),
      items' = SUBJECTS.mapBy(s => if (subjApp(s) == app) NO_ITEM else items.get(s)),
      ntf' = ntf.keys().filter(k => ntf.get(k).items.intersect(left) != Set())
               .mapBy(k => { ...ntf.get(k), items: ntf.get(k).items.intersect(left) }),
      queue' = queue.keys().mapBy(k => if (queue.get(k).via == app and queue.get(k).status == "queued") { ...queue.get(k), status: "dropped" } else queue.get(k)),
      sig' = if (keep) sig else { ...sig, exists: false, active: false, streak: 0, usedWhileDropped: false },
      netDel' = netDel, netDelCounts' = netDelCounts, net' = net, rep' = rep, paused' = paused,
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Invariants (Part A)

  def sentRows: Set[Set[int]] = queue.keys().filter(k => queue.get(k).status == "sent")

  // packages/notify/README.md "each person gets at most one message per send" and "replicas may
  // overlap safely: a delivery id is recorded once"; scheduler.ts:185 "never sends two";
  // deploy/backend/backend.ts:407-408. An inbox item is in at most one scheduler delivery (and so in
  // at most one text). Was SD-150; holds since a66f44e (recordDelivery refuses a notified item).
  val oneNotifyTextPerItem: bool =
    SUBJECTS.forall(s => ntf.keys().filter(k => k.contains(s)).size() <= 1)
    and SUBJECTS.forall(s => sentRows.filter(k => k.contains(s)).size() <= 1)

  // service.ts:611-612 "already delivered ... nothing texts them again"; scheduler.ts:100-104
  // recordSent "the scheduler never texts it again". An item made from a Network text is never in a
  // scheduler delivery. Was SD-151; holds since 472cecb (addDelivered is one transaction).
  val noRepeatOfNetworkText: bool =
    ntf.keys().forall(k => k.forall(s => not(TEXTS.contains(s))))
    and TEXTS.forall(t => not(items.get(t).exists) or items.get(t).notified == "net")

  // PRD 32.9 interruption budget: the weekly cap counts messages the member got. A scheduler
  // delivery whose text ended unsent does not count.
  // NOT IN `safety`: SD-095, skipped (needs a design decision: a feedback path from the outbound
  // queue to the inbox that undoes the notified mark and the cap count and gives a retry a new
  // identity; no production code calls Notifier.add, so no production item is pending).
  val refusedNotCounted: bool =
    ntf.keys().forall(k => not(ntf.get(k).counts and queue.keys().contains(k)
      and queue.get(k).status.in(Set("refused", "expired", "dropped"))))

  // scheduler.ts:3-5: every unnotified item goes in the next message. An item whose only text was
  // refused stays pending for a later text or a surface.
  // NOT IN `safety`: SD-095, skipped (same reason as refusedNotCounted).
  val refusedItemsStayPending: bool =
    SUBJECTS.forall(s => not(items.get(s).exists and not(items.get(s).seen) and items.get(s).notified == "ntf"
      and queue.keys().filter(k => k.contains(s)).forall(k => queue.get(k).status.in(Set("refused", "expired")))
      and queue.keys().exists(k => k.contains(s))))

  // scheduler.ts:6-7 and PRD 32.9: at most weeklyCap counting scheduler texts in 7 days.
  // NOT IN `safety`: SD-150, residual found by this model after a66f44e. The fix stops one item in
  // two texts, but two overlapping replicas still pass the cap: r1 plans {3}; item 4 arrives; r2
  // plans {3,4} (the cap check sees no delivery yet); r1 records {3}; r2's re-read keeps {4} and
  // dispatch rebuilds the plan without a new cap check (scheduler.ts:182-183), so {4} is recorded
  // and sent too. Run test `replicaRebuildCapTest`. It needs two replicas (backend.ts guards one
  // process) and a Notifier.add producer (none in production), so no production path reaches it.
  // A fix (a cap check when dispatch rebuilds a plan) needs its own failing integration test.
  val schedulerRespectsCap: bool =
    sentRows.filter(k => queue.get(k).proactive).size() <= CAP

  // scheduler.ts:29-30: paused or held, only requested items go out; AGENTS.md per-app consent.
  // No proactive item of a paused app goes out in a scheduler text.
  // NOT IN `safety`: SD-152, skipped (needs a founder or product decision on which app's member
  // carries a digest of several apps and on per-item per-app consent in the Recipient contract; no
  // production item reaches dispatch since the SD-151 fix).
  val pausedAppGetsNoProactive: bool =
    sentRows.forall(k => not(queue.get(k).pausedLeak))

  // surface.ts:3-4: a surface whose links went unused twice drops out "until the member uses it
  // again". After a use, the surface is not dropped.
  // NOT IN `safety`: SD-339, not reproduced in production (disputed). Production prefs have no
  // explicit surface and no production dispatch points at an assistant since the SD-151 fix; the
  // model still reaches it through Notifier.add. A reset on touch would not bring the surface back
  // through the score path (ignored*2 keeps the score under MIN_SCORE): a fix needs a new scoring
  // rule, a product decision.
  val droppedSurfaceReturnsOnUse: bool =
    not(sig.usedWhileDropped) or sig.streak < MAX_IGNORED_STREAK

  // retention.sql:116-118: "Preserve them for another live or pending (invited) membership".
  // Signals that existed are gone only when every membership is removed. Was SD-341; holds since 428e246.
  val signalsKeptForPending: bool =
    not(sig.everCreated and not(sig.exists) and APPS.exists(a => ms.get(a) != "removed"))

  // packages/notify/README.md "every event becomes one inbox item". Each projected Network text has
  // its own inbox item. Was SD-303 (the dedupe-key part, NT-5); holds since 893944f.
  val everyNetworkTextInInbox: bool =
    TEXTS.forall(t => not(net.get(t).projected and ms.get(subjApp(t)) != "removed")
      or (items.get(t).exists and items.get(t).text == t))

  val notifySafety: bool = and {
    oneNotifyTextPerItem,
    noRepeatOfNetworkText,
    signalsKeptForPending,
    everyNetworkTextInInbox,
  }

  // ================================================================================================
  // Part B: Capital
  // ================================================================================================

  pure val MEMBERS = Set("a", "b", "c")
  pure val MEMBERS_SORTED = ["a", "b", "c"]
  pure val TMAX = 3
  // Amounts in tenths of NC (config.ts:67-68): attendance 2, feedback 0.5, help 3, vouch 10.
  pure val ATTEND = 20
  pure val FEEDBACK = 5
  pure val HELP = 30
  pure val VOUCH = 100

  // One CapitalEvent. id = `${typ}:${key}` (network.ts emit). member: the event's `member` field
  // (helper events use it for the recipient). other: vouchedBy or helper. others: with,
  // counterparts and confirmers. flag: adult age (member_joined, age_updated), useful
  // (help_confirmed), or confirmedBy = with (value_received).
  type Ev = { typ: str, key: str, t: int, member: str, other: str, others: Set[str], flag: bool }

  type MRec = { known: bool, eligible: bool, vouchedBy: str, activated: bool, valueIn: bool, vouchCredited: bool }
  type PRec = { exists: bool, resolved: bool, attended: bool, feedback: bool }
  type HRec = { exists: bool, helper: str, recipient: str, resolved: bool }
  // A ledger entry. `peer` is the counterpart of a help credit (its recipient), "" otherwise.
  type Entry = { member: str, cat: str, amount: int, peer: str }
  // The CapitalLedger state (ledger.ts:40-54), abstracted.
  type Ledger = { members: str -> MRec, plans: str -> PRec, help: HRec, entries: List[Entry],
                  seen: Set[(str, str)], lastT: int, rejects: int }

  pure val NO_M: MRec = { known: false, eligible: false, vouchedBy: "", activated: false, valueIn: false, vouchCredited: false }
  pure val NO_P: PRec = { exists: false, resolved: false, attended: false, feedback: false }
  pure val NO_H: HRec = { exists: false, helper: "", recipient: "", resolved: false }
  pure val EMPTY_LEDGER: Ledger = { members: MEMBERS.mapBy(_ => NO_M), plans: MEMBERS.mapBy(_ => NO_P), help: NO_H,
                                    entries: [], seen: Set(), lastT: -1, rejects: 0 }

  pure def eligibleIn(L: Ledger, m: str): bool = L.members.get(m).known and L.members.get(m).eligible

  // credit (ledger.ts credit) with multipliers fixed at 1: only an eligible member earns.
  pure def credit(L: Ledger, m: str, cat: str, amount: int, peer: str): Ledger =
    if (eligibleIn(L, m)) { ...L, entries: L.entries.append({ member: m, cat: cat, amount: amount, peer: peer }) } else L

  pure def balance(L: Ledger, m: str): int =
    L.entries.foldl(0, (s, e) => if (e.member == m) s + e.amount else s)

  pure def hasCredit(L: Ledger, m: str, cat: str): bool =
    L.entries.foldl(false, (b, e) => b or (e.member == m and e.cat == cat))

  // tiesOf (ledger.ts:345-357): members tied to `v` by member-controlled credits in either
  // direction. In the model the only member-controlled credit is help (the plan is an engine intro,
  // so its attendance is not pair-chosen). SD-350 fix 5781195: the window is
  // controlledPairWindowDays (90 days); the model's four time points are all inside it.
  pure def tied(L: Ledger, v: str, w: str): bool =
    L.entries.foldl(false, (b, e) => b or (e.cat == "help" and ((e.member == v and e.peer == w) or (e.member == w and e.peer == v))))

  // tryVouchCredit (ledger.ts:359-367).
  pure def tryVouch(L: Ledger, m: str): Ledger = {
    val r = L.members.get(m)
    if (r.vouchedBy == "" or r.vouchCredited or not(r.eligible) or not(r.activated) or not(r.valueIn)) L
    else if (not(eligibleIn(L, r.vouchedBy))) L
    else {
      val L2 = credit(L, r.vouchedBy, "vouch", VOUCH, "")
      { ...L2, members: L2.members.set(m, { ...r, vouchCredited: true }) }
    }
  }

  // The switch in record (ledger.ts:141-330), for the event types the model emits.
  pure def applyEv(L: Ledger, e: Ev): Ledger =
    if (e.typ == "member_joined") {
      if (L.members.get(e.member).known) L
      else { ...L, members: L.members.set(e.member, { ...NO_M, known: true, eligible: e.flag,
               vouchedBy: if (e.other == e.member) "" else e.other }) }
    } else if (e.typ == "age_updated") {
      // ledger.ts:151-157: eligibility follows the current age.
      val r = L.members.get(e.member)
      if (not(r.known)) L else { ...L, members: L.members.set(e.member, { ...r, eligible: e.flag }) }
    } else if (e.typ == "member_activated") {
      val r = L.members.get(e.member)
      if (not(r.known)) L else tryVouch({ ...L, members: L.members.set(e.member, { ...r, activated: true }) }, e.member)
    } else if (e.typ == "value_received") {
      val r = L.members.get(e.member)
      val providers = e.others.filter(w => w != r.vouchedBy and w != e.member and not(tied(L, r.vouchedBy, w)) and eligibleIn(L, w))
      // confirmed = providers in confirmedBy (ledger.ts:176-181); no organizer check-in in the model.
      val confirmed = if (e.flag) providers else Set()
      if (not(r.known) or r.vouchedBy == "" or r.valueIn) L
      else if (providers == Set() or confirmed == Set()) L
      else tryVouch({ ...L, members: L.members.set(e.member, { ...r, valueIn: true }) }, e.member)
    } else if (e.typ == "plan_accepted") {
      if (L.plans.get(e.member).exists) L else { ...L, plans: L.plans.set(e.member, { ...NO_P, exists: true }) }
    } else if (e.typ == "plan_attended") {
      val p = L.plans.get(e.member)
      val confirmers = e.others.filter(x => x != e.member and eligibleIn(L, x))
      if (not(p.exists) or p.resolved) L
      else if (confirmers == Set()) { ...L, plans: L.plans.set(e.member, { ...p, resolved: true }) }
      else {
        val L2 = credit(L, e.member, "attendance", ATTEND, "")
        { ...L2, plans: L2.plans.set(e.member, { ...p, resolved: true, attended: eligibleIn(L, e.member) }) }
      }
    } else if (e.typ == "feedback_given") {
      val p = L.plans.get(e.member)
      if (not(p.exists) or not(p.attended) or p.feedback) L
      else { ...credit(L, e.member, "feedback", FEEDBACK, ""), plans: L.plans.set(e.member, { ...p, feedback: true }) }
    } else if (e.typ == "help_given") {
      if (e.other == e.member or L.help.exists) L
      else { ...L, help: { exists: true, helper: e.other, recipient: e.member, resolved: false } }
    } else if (e.typ == "help_confirmed") {
      val h = L.help
      if (not(h.exists) or h.resolved or h.recipient != e.member) L
      else {
        val L2 = { ...L, help: { ...h, resolved: true } }
        if (not(e.flag) or not(eligibleIn(L2, h.recipient))) L2 else credit(L2, h.helper, "help", HELP, h.recipient)
      }
    } else L

  // record (ledger.ts:131-138): idempotent by id, refuses an event older than lastT.
  pure def accepts(L: Ledger, e: Ev): bool = L.seen.contains((e.typ, e.key)) or e.t >= L.lastT
  pure def record(L: Ledger, e: Ev): Ledger =
    if (L.seen.contains((e.typ, e.key))) L
    else if (e.t < L.lastT) { ...L, rejects: L.rejects + 1 }
    else applyEv({ ...L, seen: L.seen.union(Set((e.typ, e.key))), lastT: e.t }, e)

  pure def recordAll(L: Ledger, es: List[Ev]): Ledger = es.foldl(L, (acc, e) => record(acc, e))

  // SD-153 fix 777711f: a restart replays network.capital_events `order by seq` (migration 0057),
  // the insert order, which is the emit order. The stored events are a list in seq order.
  pure def replay(S: List[Ev]): Ledger = recordAll(EMPTY_LEDGER, S)

  // What a restart must keep (ledger.ts:59-60): balances, eligibility, vouch and plan state.
  pure def view(L: Ledger): { bal: str -> int, members: str -> MRec, plans: str -> PRec, help: HRec } =
    { bal: MEMBERS.mapBy(m => balance(L, m)), members: L.members, plans: L.plans, help: L.help }

  pure def names(e: Ev, m: str): bool = e.member == m or e.other == m or e.others.contains(m)
  pure def ids(S: List[Ev]): Set[(str, str)] = S.foldl(Set(), (acc, e) => acc.union(Set((e.typ, e.key))))
  // `insert ... on conflict (app_id, id) do nothing`: a stored id keeps its row and its seq.
  pure def store(S: List[Ev], es: List[Ev]): List[Ev] =
    es.foldl(S, (acc, e) => if (ids(acc).contains((e.typ, e.key))) acc else acc.append(e))

  // The Network's own view of a member (network.ts MemberState), the part that drives emits.
  // saidGood: the post-meeting answer "it went well" (o.post[m].good). gotValue: value_received emitted.
  type NetM = { joined: bool, minor: bool, activated: bool, invitedBy: str, left: bool, saidGood: bool, gotValue: bool }
  type NetC = { m: str -> NetM, plan: Set[str], planDone: bool, helpDone: bool }
  pure val NO_NETM: NetM = { joined: false, minor: false, activated: false, invitedBy: "", left: false, saidGood: false, gotValue: false }
  pure val NET0: NetC = { m: MEMBERS.mapBy(_ => NO_NETM), plan: Set(), planDone: false, helpDone: false }

  // The runtime's in-memory ledger (runtime.ts:118, capital.ts capitalWiring).
  var mem: Ledger
  // Unit.capital (runtime.ts:60, 162): since SD-156 fix 95c3d82, only the events the live ledger accepted.
  var unit: List[Ev]
  // network.capital_events in seq order (migrations 0007 and 0057; runtime.ts:504-507, 537).
  var pg: List[Ev]
  // Ghost: every event any unit ever committed (pg before forget deletes rows), in seq order.
  var pgAll: List[Ev]
  // The Network state in memory and the last committed state (runStored reloads on a failed unit).
  var netc: NetC
  var netCommitted: NetC
  var now: int
  var clockSteppedBack: bool
  var forgotten: Set[str]
  var aborted: bool
  var restarts: int

  pure def ev(typ: str, key: str, t: int, member: str, other: str, others: Set[str], flag: bool): Ev =
    { typ: typ, key: key, t: t, member: member, other: other, others: others, flag: flag }

  pure def planKey(m: str): str = if (m == "a") "o1a" else if (m == "b") "o1b" else "o1c"

  // onLedger (runtime.ts:162, capital.ts capitalWiring): the live ledger records the event (a refusal
  // is caught and counted). SD-156 fix 95c3d82: onLedger returns whether the ledger accepted it, and
  // only accepted events go into the unit. All events of one emit share t = now, so they are all
  // accepted or all refused (except an id the ledger saw, which is accepted as a no-op).
  action emit(es: List[Ev], n2: NetC): bool = all {
    mem' = recordAll(mem, es),
    unit' = unit.concat(es.select(e => accepts(mem, e))),
    netc' = n2,
    pg' = pg, pgAll' = pgAll, netCommitted' = netCommitted, now' = now, clockSteppedBack' = clockSteppedBack,
    forgotten' = forgotten, aborted' = aborted, restarts' = restarts,
  }

  def live(m: str): bool = netc.m.get(m).joined and not(netc.m.get(m).left)

  // Join with a known age (ledgerJoined, network.ts ledgerJoined): a member treated as a minor is
  // sent with age null, so the ledger stores them as not eligible.
  action cJoin(m: str, adult: bool, inviter: str): bool = all {
    not(netc.m.get(m).joined), not(m.in(forgotten)),
    inviter == "" or (live(inviter) and not(netc.m.get(inviter).minor) and inviter != m),
    emit([ev("member_joined", m, now, m, inviter, Set(), adult)],
         { ...netc, m: netc.m.set(m, { ...NO_NETM, joined: true, minor: not(adult), invitedBy: inviter }) }),
  }

  // Onboarding done (activate, network.ts activate): adults only, once.
  action cActivate(m: str): bool = all {
    live(m), not(netc.m.get(m).minor), not(netc.m.get(m).activated),
    emit([ev("member_activated", m, now, m, "", Set(), false)],
         { ...netc, m: netc.m.set(m, { ...netc.m.get(m), activated: true }) }),
  }

  // The Network learns the member is a minor (a stated age of 16, a minor signal, a report, the
  // record; network.ts:715-727, 1556, 4438). It sets m.minor and drops the member. SD-049 fix
  // f3f09b7: ledgerAge emits age_updated with age null for a member the ledger knows. The key is
  // `${id}:minor:${now}`; the model flips a member to minor at most once, so the key is the member.
  action cLearnMinor(m: str): bool = all {
    live(m), not(netc.m.get(m).minor),
    emit([ev("age_updated", m, now, m, "", Set(), false)],
         { ...netc, m: netc.m.set(m, { ...netc.m.get(m), minor: true }) }),
  }

  // The reveal of a two-person plan (network.ts reveal): plan_accepted for each.
  action cPlanAccept(m1: str, m2: str): bool = all {
    m1 != m2, netc.plan == Set(),
    live(m1), live(m2), not(netc.m.get(m1).minor), not(netc.m.get(m2).minor),
    emit(MEMBERS_SORTED.select(p => p == m1 or p == m2).foldl([], (acc, p) => acc.append(ev("plan_accepted", planKey(p), now, p, "", Set(), false))),
         { ...netc, plan: Set(m1, m2) }),
  }

  // The positive check-in after the meeting (onFeedback, network.ts:2600-2608). SD-154 fix 226f278:
  // onFeedback no longer emits; it keeps "it went well" in o.post, and finalize emits value_received.
  action cSayGood(m: str): bool = all {
    netc.plan.contains(m), not(netc.planDone), live(m), not(netc.m.get(m).saidGood),
    emit([], { ...netc, m: netc.m.set(m, { ...netc.m.get(m), saidGood: true }) }),
  }

  // finalize (network.ts:2747-2790): both said they came and nobody missing. For each booked member
  // in order: plan_attended (verified by the other as counterpart), feedback_given, and (SD-154 fix)
  // value_received when they said it went well, with confirmedBy = the other attendee (flag true).
  action cFinalize: bool = all {
    netc.plan != Set(), not(netc.planDone),
    netc.plan.forall(p => live(p) and not(netc.m.get(p).minor)),
    emit(MEMBERS_SORTED.select(p => netc.plan.contains(p)).foldl([], (acc, p) => {
           val base = acc.append(ev("plan_attended", planKey(p), now, p, "", netc.plan.exclude(Set(p)), false))
                         .append(ev("feedback_given", planKey(p), now, p, "", Set(), false))
           if (netc.m.get(p).saidGood) base.append(ev("value_received", planKey(p), now, p, "", netc.plan.exclude(Set(p)), true)) else base
         }),
         { ...netc, planDone: true,
           m: MEMBERS.mapBy(p => if (netc.plan.contains(p) and netc.m.get(p).saidGood) { ...netc.m.get(p), gotValue: true } else netc.m.get(p)) }),
  }

  // helpFeedback (network.ts helpFeedback): help_given then help_confirmed, same t, useful.
  action cHelp(helper: str, recipient: str): bool = all {
    helper != recipient, not(netc.helpDone),
    live(helper), live(recipient), not(netc.m.get(helper).minor), not(netc.m.get(recipient).minor),
    emit([ev("help_given", "o2", now, recipient, helper, Set(), false),
          ev("help_confirmed", "o2", now, recipient, "", Set(), true)],
         { ...netc, helpDone: true }),
  }

  // writeUnit (runtime.ts:504-507): the unit's events are stored in the save transaction,
  // `on conflict (app_id, id) do nothing`, each new row with the next seq. The Network state commits
  // with them (a unit with only Network state, such as a post answer, commits too).
  action cCommit: bool = all {
    unit != [] or netc != netCommitted,
    pg' = store(pg, unit), pgAll' = store(pgAll, unit),
    unit' = [], netCommitted' = netc,
    mem' = mem, netc' = netc, now' = now, clockSteppedBack' = clockSteppedBack, forgotten' = forgotten,
    aborted' = aborted, restarts' = restarts,
  }

  // The unit fails before commit: the unit is dropped and the Network state reloads at the next
  // unit (runStored). The in-memory ledger keeps what it recorded (runtime.ts:162).
  action cAbort: bool = all {
    unit != [] or netc != netCommitted,
    unit' = [], netc' = netCommitted, aborted' = true,
    mem' = mem, pg' = pg, pgAll' = pgAll, netCommitted' = netCommitted, now' = now,
    clockSteppedBack' = clockSteppedBack, forgotten' = forgotten, restarts' = restarts,
  }

  // Leave or delete: a unit that forgets the member (runtime.ts:517-555). It deletes every stored
  // event whose JSON names the id (runtime.ts:537). The in-memory ledger is not changed.
  action cForget(m: str): bool = all {
    unit == [], netc == netCommitted, live(m),
    pg' = pg.select(e => not(names(e, m))),
    netc' = { ...netc, m: netc.m.set(m, { ...netc.m.get(m), left: true }) },
    netCommitted' = { ...netc, m: netc.m.set(m, { ...netc.m.get(m), left: true }) },
    forgotten' = forgotten.union(Set(m)),
    mem' = mem, unit' = unit, pgAll' = pgAll, now' = now, clockSteppedBack' = clockSteppedBack,
    aborted' = aborted, restarts' = restarts,
  }

  // Process restart (runtime.ts:340-345): the ledger replays the stored events `order by seq`.
  action cRestart: bool = all {
    restarts < 2,
    mem' = replay(pg), unit' = [], netc' = netCommitted, restarts' = restarts + 1,
    pg' = pg, pgAll' = pgAll, netCommitted' = netCommitted, now' = now, clockSteppedBack' = clockSteppedBack,
    forgotten' = forgotten, aborted' = aborted,
  }

  // The Clock (wall time). It can step back once (NTP): a bounded skew oracle.
  action cTick: bool = all {
    now < TMAX, now' = now + 1,
    mem' = mem, unit' = unit, pg' = pg, pgAll' = pgAll, netc' = netc, netCommitted' = netCommitted,
    clockSteppedBack' = clockSteppedBack, forgotten' = forgotten, aborted' = aborted, restarts' = restarts,
  }
  action cClockBack: bool = all {
    now > 0, not(clockSteppedBack), now' = now - 1, clockSteppedBack' = true,
    mem' = mem, unit' = unit, pg' = pg, pgAll' = pgAll, netc' = netc, netCommitted' = netCommitted,
    forgotten' = forgotten, aborted' = aborted, restarts' = restarts,
  }

  // ------------------------------------------------------------------------------------------------
  // Invariants (Part B)

  // AGENTS.md age policy and decision 1 (minors are never matched); PRD 39.2.6 "under-18s excluded";
  // ledger.ts:6-7 and :151-157 "a member found to be a minor stops accruing now". A member the
  // Network treats as a minor is not eligible in the ledger.
  // NOT IN `safety` in this full form. SD-049 is fixed (f3f09b7, age_updated), and the fixed rule is
  // `noMinorEligibleInOrder` below. Two residual routes remain, both found by this model:
  //  (1) a failed unit: the ledger keeps the adult member_joined of the failed unit (memory before
  //      commit, SD-344, refuted in the register); the Network reloads, the member joins again as a
  //      minor, and the ledger skips the same id (ledger.ts:134). Run test `minorAfterAbortTest`.
  //  (2) the wall clock steps back: the live ledger refuses age_updated (t < lastT, ledger.ts:135);
  //      since SD-156 the refused event is not stored either. Run test `minorClockBackTest`.
  // Both are latent: nothing reads the ledger in production (runtime.ts:118, reader: false). A fix
  // needs a design decision (a ledger that follows the committed state, or a clock-skew rule).
  val noMinorEligible: bool =
    MEMBERS.forall(m => not(netc.m.get(m).minor and eligibleIn(mem, m)))

  // The SD-049 rule for traces where every unit committed and the clock did not step back.
  val noMinorEligibleInOrder: bool = aborted or clockSteppedBack or noMinorEligible

  // ledger.ts:59-60 "A restart keeps balances, levers and audit"; store.ts:1-2 and capital.md I5:
  // the ledger state is a function of the accepted events in accepted order. After a commit, the
  // replay of everything stored equals the live ledger (no forget, no failed unit in the trace;
  // those have their own invariants). Was SD-153 and SD-156; holds since 777711f and 95c3d82.
  val replayEqualsLive: bool =
    not(unit == [] and forgotten == Set() and not(aborted)) or view(replay(pgAll)) == view(mem)

  // capital.md S4: forgetting one member leaves the other members' ledgers as they were. Compares
  // the replay of what is stored after forget with the replay of everything committed, for the
  // members that were not forgotten.
  // NOT IN `safety`: SD-155, refuted in the register (latent: nothing reads the replayed ledger in
  // production). member_joined:c names its voucher b, so forget(b) deletes it (runtime.ts:537).
  val forgetKeepsOthers: bool = {
    val after = replay(pg)
    val before = replay(pgAll)
    MEMBERS.forall(m => m.in(forgotten) or (balance(after, m) == balance(before, m) and after.members.get(m) == before.members.get(m)))
  }

  // PRD 39.2.2: the voucher earns when the invitee is active and gets value from a member other than
  // the voucher (and not from the voucher's close circle, SD-350) inside 30 days, with no safety flag.
  // AGENTS.md decision 11 (fixes-core 26). Was SD-154; holds since 226f278 (value_received at
  // finalize with confirmedBy). The provider is the other plan member. The rule is checked on traces
  // where the ledger saw every event: no failed unit, no clock step back (the ledger refuses events,
  // SD-156 design), and no restart after a forget (SD-155).
  val vouchCreditFollowsValue: bool =
    aborted or clockSteppedBack or (restarts > 0 and forgotten != Set()) or
    MEMBERS.forall(m => {
      val n = netc.m.get(m)
      val r = mem.members.get(m)
      val v = n.invitedBy
      not(n.gotValue and v != "" and r.activated and eligibleIn(mem, m) and eligibleIn(mem, v)
          and netc.plan.exclude(Set(m)).exists(w => w != v and eligibleIn(mem, w) and not(tied(mem, v, w))))
      or r.vouchCredited
    })

  val capitalSafety: bool = and {
    noMinorEligibleInOrder,
    replayEqualsLive,
    vouchCreditFollowsValue,
  }

  val safety: bool = notifySafety and capitalSafety

  // ================================================================================================
  // Machine

  action notifyInit(slopState: str): bool = all {
    items' = SUBJECTS.mapBy(_ => NO_ITEM),
    net' = TEXTS.mapBy(_ => { sent: false, proactive: false, projected: false }),
    netDel' = TEXTS.mapBy(_ => false),
    netDelCounts' = TEXTS.mapBy(_ => false),
    ntf' = Map(),
    queue' = Map(),
    rep' = REPLICAS.mapBy(_ => IDLE),
    sig' = { exists: false, everCreated: false, active: false, streak: 0, usedWhileDropped: false },
    ms' = Map("ntwrk" -> "active", "slop" -> slopState),
    paused' = APPS.mapBy(_ => false),
  }

  action capitalInit: bool = all {
    mem' = EMPTY_LEDGER, unit' = [], pg' = [], pgAll' = [], netc' = NET0, netCommitted' = NET0,
    now' = 0, clockSteppedBack' = false, forgotten' = Set(), aborted' = false, restarts' = 0,
  }

  // The two parts share no state. The simulator runs one part per trace, so that a random trace
  // reaches deep states of the part it runs; Apalache explores both values.
  var part: str

  action initWith(p: str, slopState: str): bool = all { notifyInit(slopState), capitalInit, part' = p }

  // The slop membership starts active or invited (open join, eliza.app entry).
  action init = {
    nondet p = Set("notify", "capital").oneOf()
    nondet slopState = Set("active", "invited").oneOf()
    initWith(p, slopState)
  }

  action notifyUnchanged: bool = all {
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue,
    rep' = rep, sig' = sig, ms' = ms, paused' = paused, part' = part,
  }
  action capitalUnchanged: bool = all {
    mem' = mem, unit' = unit, pg' = pg, pgAll' = pgAll, netc' = netc, netCommitted' = netCommitted,
    now' = now, clockSteppedBack' = clockSteppedBack, forgotten' = forgotten, aborted' = aborted, restarts' = restarts,
    part' = part,
  }

  // Every non-empty set of subjects: a queue key or a delivery key.
  pure val KEYS = SUBJECTS.powerset().exclude(Set(Set()))

  action notifyStep: bool = {
    nondet t = TEXTS.oneOf()
    nondet s = ADDED.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet r = REPLICAS.oneOf()
    nondet target = Set("imessage", "claude").oneOf()
    nondet app = APPS.oneOf()
    nondet surface = Set("claude", "web").oneOf()
    nondet endStatus = Set("refused", "expired", "obsolete").oneOf()
    nondet k = KEYS.oneOf()
    any {
      netSend(t, b),
      projRecord(t),
      notifyAdd(s, b),
      plan(r, target),
      reread(r, target),
      recordDelivery(r),
      enqueue(r),
      crash(r),
      queueSend(k),
      queueEnd(k, endStatus),
      readApp(app, surface),
      redeem(k),
      sweepOne(k),
      setActive(b),
      setPaused(app, b),
      acceptInvite(app),
      leave(app),
    }
  }

  action capitalStep: bool = {
    nondet m = MEMBERS.oneOf()
    nondet m2 = MEMBERS.oneOf()
    nondet inviter = Set("", "a", "b", "c").oneOf()
    nondet adult = Set(true, false).oneOf()
    any {
      cJoin(m, adult, inviter),
      cActivate(m),
      cLearnMinor(m),
      cPlanAccept(m, m2),
      cSayGood(m),
      cFinalize,
      cHelp(m, m2),
      cCommit,
      cAbort,
      cForget(m),
      cRestart,
      cTick,
      cClockBack,
    }
  }

  // One part alone, for `quint verify --init initNotify --step stepNotify` (shorter counterexamples).
  action initNotify = { nondet slopState = Set("active", "invited").oneOf() initWith("notify", slopState) }
  action stepNotify = all { notifyStep, capitalUnchanged }
  action initCapital = initWith("capital", "active")
  action stepCapital = all { capitalStep, notifyUnchanged }

  action step = any {
    all { part == "notify", notifyStep, capitalUnchanged },
    all { part == "capital", capitalStep, notifyUnchanged },
  }

  // ================================================================================================
  // Witnesses: each is the negation of a state that must be reachable (quint/README.md rule 4).

  // A scheduler text (a digest of Notifier.add items) is planned, recorded and sent.
  val witness_digestSent: bool = sentRows == Set()
  // A Network text is projected into the inbox as already delivered.
  val witness_networkTextProjected: bool = not(TEXTS.exists(t => net.get(t).projected and netDel.get(t)))
  // A link to the assistant goes unused and the sweep records it against the surface.
  val witness_assistantLinkIgnored: bool = sig.streak < 1
  // A plan attended gives one attendance credit.
  val witness_attendanceCredited: bool = not(MEMBERS.exists(m => hasCredit(mem, m, "attendance")))
  // A confirmed help round credits the helper.
  val witness_helpCredited: bool = not(MEMBERS.exists(m => hasCredit(mem, m, "help")))
  // A member found to be a minor stops being eligible in the ledger (SD-049 fix).
  val witness_minorExcluded: bool = not(MEMBERS.exists(m => netc.m.get(m).minor and mem.members.get(m).known and not(mem.members.get(m).eligible) and mem.seen.contains(("age_updated", m))))
  // A restart replays stored events.
  val witness_restartWithEvents: bool = not(restarts > 0 and pg != [] and mem.seen != Set())

  // ================================================================================================
  // Run tests: concrete traces from the code and the tests.

  // packages/network/service/service.ts:615-631 and tests/e2e/notify.e2e.test.ts: a delivered send
  // becomes one item with delivery net:<id>, and the scheduler has nothing to send.
  run projectionRecordsTest =
    initWith("notify", "active")
      .then(all { netSend(1, true), capitalUnchanged })
      .then(all { projRecord(1), capitalUnchanged })
      .expect(and { items.get(1).notified == "net", netDel.get(1), pending == Set(), safety })

  // SD-151 (fixed, 472cecb; packages/notify/test/notify-delivery.integration.test.ts "SD-151 a
  // Network text whose record fails half way is never texted again by the scheduler"). The item and
  // its net: delivery are one transaction, so after the projection nothing is pending and no
  // replica can plan; before the projection there is no item at all.
  run projectionAtomicTest =
    initWith("notify", "active")
      .then(all { netSend(1, false), capitalUnchanged })
      .expect(and { not(items.get(1).exists), pending == Set() })
      .then(all { projRecord(1), capitalUnchanged })
      .expect(and { items.get(1).notified == "net", pending == Set(), noRepeatOfNetworkText })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .fail()

  // SD-150 (fixed, a66f44e; notify-delivery.integration.test.ts "SD-150 two scheduler replicas that
  // overlap never put one item in two texts"). r1 plans {3}; item 4 arrives; r2 plans {3,4}; both
  // re-reads see 3 unnotified; r1 records {3}; r2's recordDelivery finds 3 notified and records
  // nothing, so dispatch cancels it. Item 4 stays pending for the next tick.
  run replicaOverlapTest =
    initWith("notify", "active")
      .then(all { notifyAdd(3, false), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { notifyAdd(4, false), capitalUnchanged })
      .then(all { plan("r2", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { reread("r2", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { recordDelivery("r2"), capitalUnchanged })
      .expect(and { rep.get("r2").phase == "idle", ntf.keys() == Set(Set(3)), pending == Set(4) })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { queueSend(Set(3)), capitalUnchanged })
      .expect(and { oneNotifyTextPerItem, schedulerRespectsCap, safety })

  // SD-150 residual (cap part, see schedulerRespectsCap): r2's re-read runs after r1's record, so
  // dispatch rebuilds r2's plan with {4} and records it without a new cap check. Each item is in
  // one text (the SD-150 fix holds), but two counting texts go out with a cap of 1.
  run replicaRebuildCapTest =
    initWith("notify", "active")
      .then(all { notifyAdd(3, false), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { notifyAdd(4, false), capitalUnchanged })
      .then(all { plan("r2", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { reread("r2", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r2"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { enqueue("r2"), capitalUnchanged })
      .then(all { queueSend(Set(3)), capitalUnchanged })
      .then(all { queueSend(Set(4)), capitalUnchanged })
      .expect(and { oneNotifyTextPerItem, not(schedulerRespectsCap), safety })

  // SD-095 (skipped): the queue refuses the text (person cap, consent); the delivery still counts
  // and the item stays notified, so no later text carries it. Only through Notifier.add.
  run refusedStillCountsTest =
    initWith("notify", "active")
      .then(all { notifyAdd(3, false), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { queueEnd(Set(3), "refused"), capitalUnchanged })
      .expect(and { not(refusedNotCounted), not(refusedItemsStayPending), capCount == 1, pending == Set(), safety })

  // SD-152 (skipped): a slop item goes out on the ntwrk member while slop is paused. Only through
  // Notifier.add.
  run pausedSlopViaNtwrkTest =
    initWith("notify", "active")
      .then(all { notifyAdd(4, false), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { setPaused("slop", true), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { queueSend(Set(4)), capitalUnchanged })
      .expect(and { not(pausedAppGetsNoProactive), safety })

  // SD-303 (dedupe-key part fixed, 893944f; packages/network/test/notify-inbox.integration.test.ts
  // "SD-303 a second Network text about one opportunity becomes its own inbox item and counts
  // toward the cap"). Two proactive texts: two items, two counted net: deliveries.
  run twoTextsTwoItemsTest =
    initWith("notify", "active")
      .then(all { netSend(1, true), capitalUnchanged })
      .then(all { projRecord(1), capitalUnchanged })
      .then(all { netSend(2, true), capitalUnchanged })
      .then(all { projRecord(2), capitalUnchanged })
      .expect(and { items.get(1).text == 1, items.get(2).text == 2, capCount == 2, everyNetworkTextInInbox, safety })

  // SD-341 (fixed, 428e246; packages/platform/test/notify-signals-erasure.pg.test.ts "SD-341 leaving
  // one app keeps the signals of a person whose other membership is invited").
  run leaveKeepsInvitedSignalsTest =
    initWith("notify", "invited")
      .then(all { setActive(true), capitalUnchanged })
      .then(all { leave("ntwrk"), capitalUnchanged })
      .expect(and { sig.exists, signalsKeptForPending, safety })

  // capital: join a and b, a help round, commit. The live ledger credits the helper (3 NC). SD-153
  // (fixed, 777711f; packages/network/test/capital-ledger.integration.test.ts "SD-153 a restart
  // replays the stored ledger events in the order the ledger accepted them"): the replay in seq order
  // keeps the credit, and after a restart the balance is still 3 NC.
  run helpReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cHelp("a", "b"), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { balance(mem, "a") == HELP, balance(replay(pg), "a") == HELP, replayEqualsLive })
      .then(all { cRestart, notifyUnchanged })
      .expect(and { balance(mem, "a") == HELP, mem.rejects == 0, safety })

  // packages/network/test/service-platform.test.ts: join stores member_joined; leave deletes it.
  run joinThenLeaveTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(pg.select(e => e.typ == "member_joined" and e.member == "a").length() == 1)
      .then(all { cForget("a"), notifyUnchanged })
      .expect(and { pg.select(e => names(e, "a")) == [], safety })

  // SD-049 (fixed, f3f09b7; capital-ledger.integration.test.ts "SD-049 an adult member who then
  // states a minor age stops being eligible in the ledger, live and after a restart").
  run minorLosesEligibilityTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .then(all { cLearnMinor("a"), notifyUnchanged })
      .expect(and { not(eligibleIn(mem, "a")), noMinorEligible })
      .then(all { cCommit, notifyUnchanged })
      .then(all { cRestart, notifyUnchanged })
      .expect(and { mem.members.get("a").known, not(eligibleIn(mem, "a")), noMinorEligible, safety })

  // SD-049 residual (1): the adult join is in a unit that fails; the ledger keeps it; the member
  // joins again as a minor with the same event id, which the ledger skips.
  run minorAfterAbortTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cAbort, notifyUnchanged })
      .then(all { cJoin("a", false, ""), notifyUnchanged })
      .expect(and { netc.m.get("a").minor, eligibleIn(mem, "a"), not(noMinorEligible), safety })

  // SD-049 residual (2): the clock steps back before the member states a minor age; the ledger
  // refuses age_updated (t < lastT) and the event is not stored (SD-156 fix).
  run minorClockBackTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cTick, notifyUnchanged })
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cClockBack, notifyUnchanged })
      .then(all { cLearnMinor("a"), notifyUnchanged })
      .expect(and { mem.rejects == 1, unit.select(e => e.typ == "age_updated") == [], eligibleIn(mem, "a"),
                    not(noMinorEligible), safety })

  // SD-154 (fixed, 226f278; packages/network/test/capital-vouch.integration.test.ts "SD-154 an
  // invitee who meets a member and says it went well earns the voucher the vouch credit"). Both say
  // it went well; finalize emits value_received with confirmedBy; the voucher earns 10 NC, also
  // after a restart.
  run vouchCreditedTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cJoin("b", true, "a"), notifyUnchanged })
      .then(all { cJoin("c", true, ""), notifyUnchanged })
      .then(all { cActivate("b"), notifyUnchanged })
      .then(all { cPlanAccept("b", "c"), notifyUnchanged })
      .then(all { cSayGood("b"), notifyUnchanged })
      .then(all { cSayGood("c"), notifyUnchanged })
      .then(all { cFinalize, notifyUnchanged })
      .expect(and { mem.members.get("b").vouchCredited, balance(mem, "a") == VOUCH, vouchCreditFollowsValue })
      .then(all { cCommit, notifyUnchanged })
      .then(all { cRestart, notifyUnchanged })
      .expect(and { balance(mem, "a") == VOUCH, mem.rejects == 0, safety })

  // SD-350 (fixed, 5781195; packages/network/test/capital-ties.integration.test.ts "SD-350 a member
  // who helped the voucher 40 days ago does not earn the voucher the vouch credit"). c helped the
  // voucher a; a's invitee b then meets c and both say it went well: no vouch credit.
  run tiedProviderNoVouchTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cJoin("c", true, ""), notifyUnchanged })
      .then(all { cHelp("c", "a"), notifyUnchanged })
      .then(all { cJoin("b", true, "a"), notifyUnchanged })
      .then(all { cActivate("b"), notifyUnchanged })
      .then(all { cPlanAccept("b", "c"), notifyUnchanged })
      .then(all { cSayGood("b"), notifyUnchanged })
      .then(all { cFinalize, notifyUnchanged })
      .expect(and { netc.m.get("b").gotValue, not(mem.members.get("b").vouchCredited),
                    balance(mem, "a") == 0, balance(mem, "c") == HELP + ATTEND + FEEDBACK, safety })

  // SD-156 (fixed, 95c3d82; capital-ledger.integration.test.ts "SD-156 an event the live ledger
  // refuses (the wall clock stepped back) is not stored, so a restart does not accept it").
  run clockBackReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cTick, notifyUnchanged })
      .then(all { cTick, notifyUnchanged })
      .then(all { cActivate("a"), notifyUnchanged })
      .then(all { cClockBack, notifyUnchanged })
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { mem.rejects == 1, not(mem.members.get("b").known), not(replay(pg).members.get("b").known), replayEqualsLive })
      .then(all { cRestart, notifyUnchanged })
      .expect(and { not(mem.members.get("b").known), safety })

  // SD-153 (second form, fixed): activate() emits member_joined then member_activated at one t.
  // The replay in seq order keeps the activation.
  run activateReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cActivate("b"), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { mem.members.get("b").activated, replay(pg).members.get("b").activated, replayEqualsLive })

  // SD-155 (refuted in the register): forget(b) deletes member_joined:c, which names b as voucher.
  run forgetVoucherTest =
    initWith("capital", "active")
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cJoin("c", true, "b"), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .then(all { cForget("b"), notifyUnchanged })
      .expect(and { not(forgetKeepsOthers), not(replay(pg).members.get("c").known) })

  // SD-339 (not reproduced in production): two links to Claude go unused and the sweep drops the
  // surface. The member then uses Claude (get_updates: touch) and turns the grant off and on; the
  // streak stays at 2, so no later notification points at Claude again. Only through Notifier.add.
  run droppedSurfaceStaysTest =
    initWith("notify", "active")
      .then(all { setActive(true), capitalUnchanged })
      .then(all { notifyAdd(3, true), capitalUnchanged })
      .then(all { plan("r1", "claude"), capitalUnchanged })
      .then(all { reread("r1", "claude"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { notifyAdd(4, true), capitalUnchanged })
      .then(all { plan("r1", "claude"), capitalUnchanged })
      .then(all { reread("r1", "claude"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { sweepOne(Set(3)), capitalUnchanged })
      .then(all { sweepOne(Set(4)), capitalUnchanged })
      .then(all { setActive(false), capitalUnchanged })
      .then(all { setActive(true), capitalUnchanged })
      .then(all { readApp("ntwrk", "claude"), capitalUnchanged })
      .expect(and { sig.streak == 2, not(claudeUsable), targets == Set("imessage"), not(droppedSurfaceReturnsOnUse) })
}
