// quint-check: max-steps=25 max-samples=6000 verify-steps=3
//
// The single inbox (packages/notify) and the network capital ledger (packages/capital), as they are
// at commit ad67275. Plan: docs/research/2026-11-07-state-machines.md section 6.17. Source reports:
// docs/research/state-machines/blooio-notify.md sections 15-22 and capital.md sections 1-10.
// Findings: docs/research/quint-findings/notify_capital.md.
//
// Two parts in one file, with no shared state:
//  - Part A (Notify). One person, two apps (ntwrk, slop), two inbox subjects (1 is ntwrk, 2 is slop),
//    three Network texts, two scheduler replicas, one assistant surface (claude), the outbound queue
//    as an oracle that can send or refuse a row.
//  - Part B (Capital). Three members, one plan (o1), one help round (o2), the in-memory ledger of the
//    runtime, the unit of work, network.capital_events, forget and restart.
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
// Each invariant names its rule. A failing invariant names the register id (SD-NNN).
module notify_capital {

  // ================================================================================================
  // Part A: Notify
  // ================================================================================================

  pure val APPS = Set("ntwrk", "slop")
  pure val SUBJECTS = Set(1, 2)
  pure val TEXTS = Set(1, 2, 3)
  pure val REPLICAS = Set("r1", "r2")
  // weeklyCap. The code default is 2 (scheduler.ts:59). The model uses 1 so that two counting texts
  // are already over the cap; the cap logic (scheduler.ts:135-143) is the same for any value.
  pure val CAP = 1
  // surface.ts:39
  pure val MAX_IGNORED_STREAK = 2

  // The dedupe key is person|app|event|subject (store.ts dedupeKey). One person and one event type:
  // the subject is the key, and each subject belongs to one app.
  pure def subjApp(s: int): str = if (s == 1) "ntwrk" else "slop"

  // notify.inbox_items. `notified` is "" (null), "net" (a net:<message id> delivery from recordSent)
  // or "ntf" (a scheduler delivery). `text` is the Network text that created the item.
  type Item = { exists: bool, text: int, requested: bool, seen: bool, notified: str }
  // A member-facing Network text (network.messages) and the state of its projection into the inbox
  // (runtime.ts:621-647): stage 0 not projected, 1 after `add` committed (scheduler.ts:107), 2 done.
  // `needRecord` is the value of `r.item.notifiedAt === undefined` read at `add` time (scheduler.ts:108).
  type NetText = { sent: bool, subj: int, proactive: bool, stage: int, needRecord: bool }
  // notify.deliveries. The scheduler's delivery id is a hash of the person and the item ids
  // (scheduler.ts:84-85), so a delivery is keyed by its original item set.
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

  // peopleWithPending and unseen().filter(notifiedAt undefined) (pg-store.ts:75-89, scheduler.ts:126).
  def pending: Set[int] = SUBJECTS.filter(s => items.get(s).exists and not(items.get(s).seen) and items.get(s).notified == "")

  // The notify recipient: the first live member, The Network first (service.ts:649-660). It does not
  // read the item's app, and proactiveAllowed is always true (service.ts:657).
  def recipientApp: str =
    if (ms.get("ntwrk") == "active") "ntwrk" else if (ms.get("slop") == "active") "slop" else ""

  // capSendsSince: deliveries that count toward the cap, net: and ntf_ alike (pg-store.ts:124-130).
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
  action netSend(t: int, s: int, proactive: bool): bool = all {
    not(net.get(t).sent),
    ms.get(subjApp(s)) == "active",
    not(proactive and paused.get(subjApp(s))),
    net' = net.set(t, { sent: true, subj: s, proactive: proactive, stage: 0, needRecord: false }),
    items' = items, netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
    sig' = sig, ms' = ms, paused' = paused,
  }

  // projectNotifications -> delivered -> recordSent, first commit: `add` (scheduler.ts:107,
  // pg-store.ts:55-65, service.ts:625-628). A retry after a throw runs this again from stage 1
  // (the marker notification_recorded_at is still null, runtime.ts:629).
  action projAdd(t: int): bool = {
    val x = net.get(t)
    val it = items.get(x.subj)
    all {
      x.sent, x.stage < 2,
      // projection selects members whose account is not removed (runtime.ts:628); the inbox insert
      // trigger refuses a removed scope (retention.sql:29-38).
      ms.get(subjApp(x.subj)) != "removed",
      if (not(it.exists)) all {
        items' = items.set(x.subj, { exists: true, text: t, requested: not(x.proactive), seen: false, notified: "" }),
        net' = net.set(t, { ...x, stage: 1, needRecord: true }),
      } else if (it.notified != "") all {
        // scheduler.ts:108: the item is already notified, no delivery is written.
        items' = items,
        net' = net.set(t, { ...x, stage: 2, needRecord: false }),
      } else all {
        items' = items,
        net' = net.set(t, { ...x, stage: 1, needRecord: true }),
      },
      netDel' = netDel, netDelCounts' = netDelCounts, ntf' = ntf, queue' = queue, rep' = rep,
      sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // recordSent, second commit: recordDelivery(net:<id>) (scheduler.ts:109, pg-store.ts:104-117).
  // The delivery trigger keeps only surviving items and skips the insert when none is left
  // (retention.sql:40-56). The update sets notified_at only where it is null (pg-store.ts:112-114).
  action projRecord(t: int): bool = {
    val x = net.get(t)
    val it = items.get(x.subj)
    all {
      x.stage == 1, x.needRecord,
      ms.get(subjApp(x.subj)) != "removed",
      netDel' = if (it.exists) netDel.set(t, true) else netDel,
      netDelCounts' = if (it.exists) netDelCounts.set(t, x.proactive) else netDelCounts,
      items' = if (it.exists and it.notified == "") items.set(x.subj, { ...it, notified: "net" }) else items,
      net' = net.set(t, { ...x, stage: 2 }),
      ntf' = ntf, queue' = queue, rep' = rep, sig' = sig, ms' = ms, paused' = paused,
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Actions: the scheduler (Notifier.dispatch, one replica). Each await between two commits is a
  // separate action, so the other replica, the projection and the member can run in between.

  // plan (scheduler.ts:120-147, 157-173). Writes nothing but tokens (not modelled). Due time and
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

  // recordDelivery for the scheduler's delivery, one transaction (scheduler.ts:186-190,
  // pg-store.ts:104-117). It dedupes on the delivery id only.
  action recordDelivery(r: str): bool = {
    val x = rep.get(r)
    val surviving = x.items.filter(s => items.get(s).exists)
    all {
      x.phase == "checked",
      if (ntf.keys().contains(x.items) or surviving == Set()) all {
        rep' = rep.set(r, IDLE), ntf' = ntf, items' = items,
      } else all {
        rep' = rep.set(r, { ...x, phase: "recorded" }),
        ntf' = ntf.put(x.items, { items: surviving, counts: x.counts, target: x.target, outcome: "open" }),
        items' = SUBJECTS.mapBy(s => if (surviving.contains(s) and items.get(s).notified == "") { ...items.get(s), notified: "ntf" } else items.get(s)),
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
  // obsolete (stale: stillNeeded is false). Notify is not told (no feedback path).
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

  // readUpdates without a token (scheduler.ts:236-248; service.ts:635-639; MCP get_updates): touch,
  // then mark the app's unseen items seen. touch writes last_used_at only (pg-store.ts:186-190).
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
  // (scheduler.ts:217-229): the token's items are seen, the delivery is "acted", the streak resets.
  action redeem(k: Set[int]): bool = all {
    ntf.keys().contains(k), ntf.get(k).target == "claude", ntf.get(k).outcome == "open",
    queue.keys().contains(k), queue.get(k).status == "sent",
    items' = SUBJECTS.mapBy(s => if (k.contains(s) and items.get(s).exists) { ...items.get(s), seen: true } else items.get(s)),
    ntf' = ntf.set(k, { ...ntf.get(k), outcome: "acted" }),
    sig' = if (signalsAllowed) { ...sig, exists: true, everCreated: true, streak: 0 } else sig,
    net' = net, netDel' = netDel, netDelCounts' = netDelCounts, queue' = queue, rep' = rep, ms' = ms, paused' = paused,
  }

  // sweep (scheduler.ts:277-280): an open scheduler delivery past the outcome window is "ignored",
  // and the target surface's streak goes up (pg-store.ts:199-202).
  action sweepOne(k: Set[int]): bool = all {
    ntf.keys().contains(k), ntf.get(k).outcome == "open",
    ntf' = ntf.set(k, { ...ntf.get(k), outcome: "ignored" }),
    sig' = if (ntf.get(k).target == "claude" and signalsAllowed)
             if (sig.exists) { ...sig, streak: sig.streak + 1 } else { ...sig, exists: true, everCreated: true, streak: 1 }
           else sig,
    items' = items, net' = net, netDel' = netDel, netDelCounts' = netDelCounts, queue' = queue, rep' = rep,
    ms' = ms, paused' = paused,
  }

  // OAuth grant on or off (service.ts:644-646, pg-store.ts:180-184). It does not touch the streak.
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
  // (runtime.ts:517-555, retention.sql:78-128). Items of the app go, deliveries are trimmed and an
  // empty one is deleted, queue rows of that member are dropped. Signals stay only if another
  // membership is in a state other than removed or invited (retention.sql:118-127).
  action leave(app: str): bool = {
    val keep = APPS.exists(a => a != app and ms.get(a) != "removed" and ms.get(a) != "invited")
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
  // deploy/backend/backend.ts:407-408. An inbox item is in at most one scheduler text.
  // Fails: SD-150 (replica overlap with different item sets).
  val oneNotifyTextPerItem: bool =
    SUBJECTS.forall(s => sentRows.filter(k => k.contains(s)).size() <= 1)

  // service.ts:611-612 "already delivered ... nothing texts them again"; scheduler.ts:100-104
  // recordSent "the scheduler never texts it again". An item made from a Network text is never in
  // a scheduler text. Fails: SD-151 (the gap between the two commits of recordSent).
  val noRepeatOfNetworkText: bool =
    sentRows.forall(k => k.forall(s => not(TEXTS.exists(t => net.get(t).sent and net.get(t).subj == s))))

  // PRD 32.9 interruption budget: the weekly cap counts messages the member got. A scheduler
  // delivery whose text ended unsent does not count. Fails: SD-095.
  val refusedNotCounted: bool =
    ntf.keys().forall(k => not(ntf.get(k).counts and queue.keys().contains(k)
      and queue.get(k).status.in(Set("refused", "expired", "dropped"))))

  // scheduler.ts:3-5: every unnotified item goes in the next message. An item whose only text was
  // refused stays pending for a later text or a surface. Fails: SD-095.
  val refusedItemsStayPending: bool =
    SUBJECTS.forall(s => not(items.get(s).exists and not(items.get(s).seen) and items.get(s).notified == "ntf"
      and queue.keys().filter(k => k.contains(s)).forall(k => queue.get(k).status.in(Set("refused", "expired")))
      and queue.keys().exists(k => k.contains(s))))

  // scheduler.ts:6-7 and PRD 32.9: at most weeklyCap counting scheduler texts in 7 days.
  // Fails: SD-150 (two replicas each pass the cap check).
  val schedulerRespectsCap: bool =
    sentRows.filter(k => queue.get(k).proactive).size() <= CAP

  // scheduler.ts:29-30: paused or held, only requested items go out; AGENTS.md per-app consent.
  // No proactive item of a paused app goes out in a scheduler text. Fails: SD-152.
  val pausedAppGetsNoProactive: bool =
    sentRows.forall(k => not(queue.get(k).pausedLeak))

  // surface.ts:3-4: a surface whose links went unused twice drops out "until the member uses it
  // again". After a use, the surface is not dropped. Fails: SD-339.
  val droppedSurfaceReturnsOnUse: bool =
    not(sig.usedWhileDropped) or sig.streak < MAX_IGNORED_STREAK

  // retention.sql:116-117: "Preserve them for another live or pending membership". Signals that
  // existed are gone only when every membership is removed. Fails: SD-341.
  val signalsKeptForPending: bool =
    not(sig.everCreated and not(sig.exists) and APPS.exists(a => ms.get(a) != "removed"))

  // packages/notify/README.md "every event becomes one inbox item". Each projected Network text has
  // its own inbox item. Fails: SD-303 (the permanent dedupe key, NT-5).
  val everyNetworkTextInInbox: bool =
    TEXTS.forall(t => not(net.get(t).stage == 2 and ms.get(subjApp(net.get(t).subj)) != "removed")
      or (items.get(net.get(t).subj).exists and items.get(net.get(t).subj).text == t))

  val notifySafety: bool = and {
    oneNotifyTextPerItem,
    noRepeatOfNetworkText,
    refusedNotCounted,
    refusedItemsStayPending,
    schedulerRespectsCap,
    pausedAppGetsNoProactive,
    droppedSurfaceReturnsOnUse,
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

  // One CapitalEvent. id = `${typ}:${key}` (network.ts:2684). member: the event's `member` field
  // (helper events use it for the recipient). other: vouchedBy or helper. others: with,
  // counterparts and confirmers. flag: adult age (member_joined), useful (help_confirmed), or a
  // non-empty confirmedBy (value_received).
  type Ev = { typ: str, key: str, t: int, member: str, other: str, others: Set[str], flag: bool }

  type MRec = { known: bool, eligible: bool, vouchedBy: str, activated: bool, valueIn: bool, vouchCredited: bool }
  type PRec = { exists: bool, resolved: bool, attended: bool, feedback: bool }
  type HRec = { exists: bool, helper: str, recipient: str, resolved: bool }
  type Entry = { member: str, cat: str, amount: int }
  // The CapitalLedger state (ledger.ts:40-54), abstracted.
  type Ledger = { members: str -> MRec, plans: str -> PRec, help: HRec, entries: List[Entry],
                  seen: Set[(str, str)], lastT: int, rejects: int }

  pure val NO_M: MRec = { known: false, eligible: false, vouchedBy: "", activated: false, valueIn: false, vouchCredited: false }
  pure val NO_P: PRec = { exists: false, resolved: false, attended: false, feedback: false }
  pure val NO_H: HRec = { exists: false, helper: "", recipient: "", resolved: false }
  pure val EMPTY_LEDGER: Ledger = { members: MEMBERS.mapBy(_ => NO_M), plans: MEMBERS.mapBy(_ => NO_P), help: NO_H,
                                    entries: [], seen: Set(), lastT: -1, rejects: 0 }

  pure def eligibleIn(L: Ledger, m: str): bool = L.members.get(m).known and L.members.get(m).eligible

  // credit (ledger.ts:378-411) with multipliers fixed at 1: only an eligible member earns.
  pure def credit(L: Ledger, m: str, cat: str, amount: int): Ledger =
    if (eligibleIn(L, m)) { ...L, entries: L.entries.append({ member: m, cat: cat, amount: amount }) } else L

  pure def balance(L: Ledger, m: str): int =
    L.entries.foldl(0, (s, e) => if (e.member == m) s + e.amount else s)

  pure def hasCredit(L: Ledger, m: str, cat: str): bool =
    L.entries.foldl(false, (b, e) => b or (e.member == m and e.cat == cat))

  // tryVouchCredit (ledger.ts:356-364).
  pure def tryVouch(L: Ledger, m: str): Ledger = {
    val r = L.members.get(m)
    if (r.vouchedBy == "" or r.vouchCredited or not(r.eligible) or not(r.activated) or not(r.valueIn)) L
    else if (not(eligibleIn(L, r.vouchedBy))) L
    else {
      val L2 = credit(L, r.vouchedBy, "vouch", VOUCH)
      { ...L2, members: L2.members.set(m, { ...r, vouchCredited: true }) }
    }
  }

  // The switch in record (ledger.ts:141-328), for the event types the model emits.
  pure def applyEv(L: Ledger, e: Ev): Ledger =
    if (e.typ == "member_joined") {
      if (L.members.get(e.member).known) L
      else { ...L, members: L.members.set(e.member, { ...NO_M, known: true, eligible: e.flag,
               vouchedBy: if (e.other == e.member) "" else e.other }) }
    } else if (e.typ == "member_activated") {
      val r = L.members.get(e.member)
      if (not(r.known)) L else tryVouch({ ...L, members: L.members.set(e.member, { ...r, activated: true }) }, e.member)
    } else if (e.typ == "value_received") {
      val r = L.members.get(e.member)
      val providers = e.others.filter(w => w != r.vouchedBy and w != e.member and eligibleIn(L, w))
      // confirmed = providers in confirmedBy; verified = a non-counterpart verifier (ledger.ts:179-181).
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
        val L2 = credit(L, e.member, "attendance", ATTEND)
        { ...L2, plans: L2.plans.set(e.member, { ...p, resolved: true, attended: eligibleIn(L, e.member) }) }
      }
    } else if (e.typ == "feedback_given") {
      val p = L.plans.get(e.member)
      if (not(p.exists) or not(p.attended) or p.feedback) L
      else { ...credit(L, e.member, "feedback", FEEDBACK), plans: L.plans.set(e.member, { ...p, feedback: true }) }
    } else if (e.typ == "help_given") {
      if (e.other == e.member or L.help.exists) L
      else { ...L, help: { exists: true, helper: e.other, recipient: e.member, resolved: false } }
    } else if (e.typ == "help_confirmed") {
      val h = L.help
      if (not(h.exists) or h.resolved or h.recipient != e.member) L
      else {
        val L2 = { ...L, help: { ...h, resolved: true } }
        if (not(e.flag) or not(eligibleIn(L2, h.recipient))) L2 else credit(L2, h.helper, "help", HELP)
      }
    } else L

  // record (ledger.ts:131-138): idempotent by id, refuses an event older than lastT. The caller
  // (capital.ts:57, runtime.ts:343) catches the refusal; only the count changes.
  pure def record(L: Ledger, e: Ev): Ledger =
    if (L.seen.contains((e.typ, e.key))) L
    else if (e.t < L.lastT) { ...L, rejects: L.rejects + 1 }
    else applyEv({ ...L, seen: L.seen.union(Set((e.typ, e.key))), lastT: e.t }, e)

  pure def recordAll(L: Ledger, es: List[Ev]): Ledger = es.foldl(L, (acc, e) => record(acc, e))

  // `order by t, id` (runtime.ts:342). The id is `<type>:<key>`; type names sort first. Keys in the
  // model sort as their strings do ("o1:a" < "o1:b").
  pure val TYPES_SORTED = ["feedback_given", "help_confirmed", "help_given", "member_activated",
                           "member_joined", "plan_accepted", "plan_attended", "value_received"]
  pure val KEYS_SORTED = ["a", "b", "c", "o1a", "o1b", "o1c", "o2"]
  pure def sortedLog(S: Set[Ev]): List[Ev] =
    range(0, TMAX + 1).foldl([], (acc, t) =>
      TYPES_SORTED.foldl(acc, (acc2, ty) =>
        KEYS_SORTED.foldl(acc2, (acc3, k) =>
          S.filter(e => e.t == t and e.typ == ty and e.key == k).fold(acc3, (a, e) => a.append(e)))))

  pure def replay(S: Set[Ev]): Ledger = recordAll(EMPTY_LEDGER, sortedLog(S))

  // What a restart must keep (ledger.ts:59-60): balances, eligibility, vouch and plan state.
  pure def view(L: Ledger): { bal: str -> int, members: str -> MRec, plans: str -> PRec, help: HRec } =
    { bal: MEMBERS.mapBy(m => balance(L, m)), members: L.members, plans: L.plans, help: L.help }

  pure def names(e: Ev, m: str): bool = e.member == m or e.other == m or e.others.contains(m)
  pure def ids(S: Set[Ev]): Set[(str, str)] = S.map(e => (e.typ, e.key))
  pure def store(S: Set[Ev], es: List[Ev]): Set[Ev] =
    es.foldl(S, (acc, e) => if (ids(acc).contains((e.typ, e.key))) acc else acc.union(Set(e)))

  // The Network's own view of a member (network.ts MemberState), the part that drives emits.
  type NetM = { joined: bool, minor: bool, activated: bool, invitedBy: str, left: bool, gotValue: bool }
  type NetC = { m: str -> NetM, plan: Set[str], planDone: bool, helpDone: bool }
  pure val NO_NETM: NetM = { joined: false, minor: false, activated: false, invitedBy: "", left: false, gotValue: false }
  pure val NET0: NetC = { m: MEMBERS.mapBy(_ => NO_NETM), plan: Set(), planDone: false, helpDone: false }

  // The runtime's in-memory ledger (runtime.ts:118, capital.ts:50-58).
  var mem: Ledger
  // Unit.capital (runtime.ts:60, 162): every emitted event, accepted or refused.
  var unit: List[Ev]
  // network.capital_events (migration 0007; runtime.ts:504-507, 537).
  var pg: Set[Ev]
  // Ghost: every event any unit ever committed (pg before forget deletes rows).
  var pgAll: Set[Ev]
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

  // onLedger (runtime.ts:162): the live ledger records the event (a refusal is caught), and the event
  // goes into the unit whether it was accepted or not.
  action emit(es: List[Ev], n2: NetC): bool = all {
    mem' = recordAll(mem, es),
    unit' = unit.concat(es),
    netc' = n2,
    pg' = pg, pgAll' = pgAll, netCommitted' = netCommitted, now' = now, clockSteppedBack' = clockSteppedBack,
    forgotten' = forgotten, aborted' = aborted, restarts' = restarts,
  }

  def live(m: str): bool = netc.m.get(m).joined and not(netc.m.get(m).left)

  // Join with a known age (ledgerJoined, network.ts:2690-2696): a member treated as a minor is sent
  // with age null, so the ledger stores them as not eligible.
  action cJoin(m: str, adult: bool, inviter: str): bool = all {
    not(netc.m.get(m).joined), not(m.in(forgotten)),
    inviter == "" or (live(inviter) and not(netc.m.get(inviter).minor) and inviter != m),
    emit([ev("member_joined", m, now, m, inviter, Set(), adult)],
         { ...netc, m: netc.m.set(m, { ...NO_NETM, joined: true, minor: not(adult), invitedBy: inviter }) }),
  }

  // Onboarding done (activate, network.ts:2699-2705): adults only, once.
  action cActivate(m: str): bool = all {
    live(m), not(netc.m.get(m).minor), not(netc.m.get(m).activated),
    emit([ev("member_activated", m, now, m, "", Set(), false)],
         { ...netc, m: netc.m.set(m, { ...netc.m.get(m), activated: true }) }),
  }

  // The Network learns the member is a minor (a stated age of 16, a minor signal; network.ts:715-727).
  // It sets m.minor and drops the member. No ledger event is emitted.
  action cLearnMinor(m: str): bool = all {
    live(m), not(netc.m.get(m).minor),
    emit([], { ...netc, m: netc.m.set(m, { ...netc.m.get(m), minor: true }) }),
  }

  // The reveal of a two-person plan (network.ts:4083): plan_accepted for each.
  action cPlanAccept(m1: str, m2: str): bool = all {
    m1 != m2, netc.plan == Set(),
    live(m1), live(m2), not(netc.m.get(m1).minor), not(netc.m.get(m2).minor),
    emit(MEMBERS_SORTED.select(p => p == m1 or p == m2).foldl([], (acc, p) => acc.append(ev("plan_accepted", planKey(p), now, p, "", Set(), false))),
         { ...netc, plan: Set(m1, m2) }),
  }

  // finalize (network.ts:2733-2769): both said they came. For each booked member in order:
  // plan_attended (verified by the other as counterpart), then feedback_given, at the same t.
  action cFinalize: bool = all {
    netc.plan != Set(), not(netc.planDone),
    netc.plan.forall(p => live(p) and not(netc.m.get(p).minor)),
    emit(MEMBERS_SORTED.select(p => netc.plan.contains(p)).foldl([], (acc, p) =>
           acc.append(ev("plan_attended", planKey(p), now, p, "", netc.plan.exclude(Set(p)), false))
              .append(ev("feedback_given", planKey(p), now, p, "", Set(), false))),
         { ...netc, planDone: true }),
  }

  // The positive check-in after a meeting (onFeedback, network.ts:2604): value_received with the
  // others who came. The product sends no confirmedBy and no verifiedBy (flag false).
  action cValue(m: str, provider: str): bool = all {
    live(m), live(provider), m != provider, not(netc.m.get(m).minor), not(netc.m.get(provider).minor),
    netc.m.get(m).activated, not(netc.m.get(m).gotValue), provider != netc.m.get(m).invitedBy,
    emit([ev("value_received", planKey(m), now, m, "", Set(provider), false)],
         { ...netc, m: netc.m.set(m, { ...netc.m.get(m), gotValue: true }) }),
  }

  // helpFeedback (network.ts:2787-2804): help_given then help_confirmed, same t, useful.
  action cHelp(helper: str, recipient: str): bool = all {
    helper != recipient, not(netc.helpDone),
    live(helper), live(recipient), not(netc.m.get(helper).minor), not(netc.m.get(recipient).minor),
    emit([ev("help_given", "o2", now, recipient, helper, Set(), false),
          ev("help_confirmed", "o2", now, recipient, "", Set(), true)],
         { ...netc, helpDone: true }),
  }

  // writeUnit (runtime.ts:504-507): the unit's events are stored in the save transaction,
  // `on conflict (app_id, id) do nothing`. The Network state commits with them.
  action cCommit: bool = all {
    unit != [],
    pg' = store(pg, unit), pgAll' = store(pgAll, unit),
    unit' = [], netCommitted' = netc,
    mem' = mem, netc' = netc, now' = now, clockSteppedBack' = clockSteppedBack, forgotten' = forgotten,
    aborted' = aborted, restarts' = restarts,
  }

  // The unit fails before commit: the unit is dropped and the Network state reloads at the next
  // unit (runStored). The in-memory ledger keeps what it recorded (runtime.ts:162).
  action cAbort: bool = all {
    unit != [],
    unit' = [], netc' = netCommitted, aborted' = true,
    mem' = mem, pg' = pg, pgAll' = pgAll, netCommitted' = netCommitted, now' = now,
    clockSteppedBack' = clockSteppedBack, forgotten' = forgotten, restarts' = restarts,
  }

  // Leave or delete: a unit that forgets the member (runtime.ts:517-555). It deletes every stored
  // event whose JSON names the id (runtime.ts:537). The in-memory ledger is not changed.
  action cForget(m: str): bool = all {
    unit == [], live(m),
    pg' = pg.filter(e => not(names(e, m))),
    netc' = { ...netc, m: netc.m.set(m, { ...netc.m.get(m), left: true }) },
    netCommitted' = { ...netc, m: netc.m.set(m, { ...netc.m.get(m), left: true }) },
    forgotten' = forgotten.union(Set(m)),
    mem' = mem, unit' = unit, pgAll' = pgAll, now' = now, clockSteppedBack' = clockSteppedBack,
    aborted' = aborted, restarts' = restarts,
  }

  // Process restart (runtime.ts:340-344): the ledger replays the stored events, `order by t, id`.
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
  // ledger.ts:6-7 and :152-153 "a member found to be a minor stops accruing now". A member the
  // Network treats as a minor is not eligible in the ledger. Fails: SD-049 (age_updated is never emitted).
  val noMinorEligible: bool =
    MEMBERS.forall(m => not(netc.m.get(m).minor and eligibleIn(mem, m)))

  // ledger.ts:59-60 "A restart keeps balances, levers and audit"; store.ts:1-2 and capital.md I5:
  // the ledger state is a function of the accepted events in accepted order. After a commit, the
  // replay of everything stored equals the live ledger (no forget, no failed unit in the trace;
  // those have their own invariants). Fails: SD-153 (same-t order) and SD-156 (refused, then stored).
  val replayEqualsLive: bool =
    not(unit == [] and forgotten == Set() and not(aborted)) or view(replay(pgAll)) == view(mem)

  // capital.md S4: forgetting one member leaves the other members' ledgers as they were. Compares
  // the replay of what is stored after forget with the replay of everything committed, for the
  // members that were not forgotten. Fails: SD-155 (refuted in the register; see the findings).
  val forgetKeepsOthers: bool = {
    val after = replay(pg)
    val before = replay(pgAll)
    MEMBERS.forall(m => m.in(forgotten) or (balance(after, m) == balance(before, m) and after.members.get(m) == before.members.get(m)))
  }

  // PRD 39.2.2: the voucher earns when the invitee is active and gets value from a member other than
  // the voucher inside 30 days, with no safety flag. AGENTS.md decision 11 (fixes-core 26).
  // Fails: SD-154 (value_received carries no confirmedBy, so the ledger drops it).
  val vouchCreditFollowsValue: bool =
    MEMBERS.forall(m => {
      val n = netc.m.get(m)
      val r = mem.members.get(m)
      not(n.gotValue and n.invitedBy != "" and r.activated and eligibleIn(mem, m) and eligibleIn(mem, n.invitedBy)
          and not(netc.m.get(n.invitedBy).minor))
      or r.vouchCredited
    })

  val capitalSafety: bool = and {
    noMinorEligible,
    replayEqualsLive,
    forgetKeepsOthers,
    vouchCreditFollowsValue,
  }

  val safety: bool = notifySafety and capitalSafety

  // ================================================================================================
  // Machine

  action notifyInit(slopState: str): bool = all {
    items' = SUBJECTS.mapBy(_ => NO_ITEM),
    net' = TEXTS.mapBy(_ => { sent: false, subj: 1, proactive: false, stage: 0, needRecord: false }),
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
    mem' = EMPTY_LEDGER, unit' = [], pg' = Set(), pgAll' = Set(), netc' = NET0, netCommitted' = NET0,
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

  action notifyStep: bool = {
    nondet t = TEXTS.oneOf()
    nondet s = SUBJECTS.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet r = REPLICAS.oneOf()
    nondet target = Set("imessage", "claude").oneOf()
    nondet app = APPS.oneOf()
    nondet surface = Set("claude", "web").oneOf()
    nondet endStatus = Set("refused", "expired", "obsolete").oneOf()
    nondet k = Set(Set(1), Set(2), Set(1, 2)).oneOf()
    any {
      netSend(t, s, b),
      projAdd(t),
      projRecord(t),
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
      cFinalize,
      cValue(m, m2),
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

  // A scheduler text (a digest) is planned, recorded and sent.
  val witness_digestSent: bool = sentRows == Set()
  // A Network text is projected into the inbox as already delivered.
  val witness_networkTextProjected: bool = not(TEXTS.exists(t => net.get(t).stage == 2 and netDel.get(t)))
  // A link to the assistant goes unused and the sweep records it against the surface. (A dropped
  // surface, streak 2, is too deep for the random simulator; the Apalache trace for
  // droppedSurfaceReturnsOnUse reaches it.)
  val witness_assistantLinkIgnored: bool = sig.streak < 1
  // A plan attended gives one attendance credit.
  val witness_attendanceCredited: bool = not(MEMBERS.exists(m => hasCredit(mem, m, "attendance")))
  // A confirmed help round credits the helper.
  val witness_helpCredited: bool = not(MEMBERS.exists(m => hasCredit(mem, m, "help")))
  // A restart replays stored events.
  val witness_restartWithEvents: bool = not(restarts > 0 and pg != Set() and mem.seen != Set())

  // ================================================================================================
  // Run tests: concrete traces from the code and the tests.

  // packages/network/service/service.ts:615-630 and tests/e2e/notify.e2e.test.ts:32-43: a delivered
  // send becomes one item with delivery net:<id>, and the scheduler has nothing to send.
  run projectionRecordsTest =
    initWith("notify", "active")
      .then(all { netSend(1, 1, true), capitalUnchanged })
      .then(all { projAdd(1), capitalUnchanged })
      .then(all { projRecord(1), capitalUnchanged })
      .expect(and { items.get(1).notified == "net", netDel.get(1), pending == Set(), safety })

  // SD-151: recordDelivery throws (or the process stops) after `add`; a notifyTick plans the item
  // and texts again what the Network already delivered.
  run projectionGapDuplicateTest =
    initWith("notify", "active")
      .then(all { netSend(1, 1, false), capitalUnchanged })
      .then(all { projAdd(1), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { queueSend(Set(1)), capitalUnchanged })
      .expect(not(noRepeatOfNetworkText))

  // SD-150: r1 plans {1}; item 2 arrives; r2 plans {1,2}; both re-reads see 1 unnotified; the ids
  // differ, so both record and both texts go. Item 1 is in two texts; two counting texts.
  run replicaOverlapTest =
    initWith("notify", "active")
      .then(all { netSend(1, 1, true), capitalUnchanged })
      .then(all { projAdd(1), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { netSend(2, 2, true), capitalUnchanged })
      .then(all { projAdd(2), capitalUnchanged })
      .then(all { plan("r2", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { reread("r2", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { recordDelivery("r2"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { enqueue("r2"), capitalUnchanged })
      .then(all { queueSend(Set(1)), capitalUnchanged })
      .then(all { queueSend(Set(1, 2)), capitalUnchanged })
      .expect(not(oneNotifyTextPerItem) and not(schedulerRespectsCap))

  // SD-095: the queue refuses the text (person cap, consent); the delivery still counts and the item
  // stays notified, so no later text carries it.
  run refusedStillCountsTest =
    initWith("notify", "active")
      .then(all { netSend(1, 1, true), capitalUnchanged })
      .then(all { projAdd(1), capitalUnchanged })
      .then(all { plan("r1", "imessage"), capitalUnchanged })
      .then(all { reread("r1", "imessage"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { queueEnd(Set(1), "refused"), capitalUnchanged })
      .expect(and { not(refusedNotCounted), not(refusedItemsStayPending), capCount == 1, pending == Set() })

  // capital: join a and b, a help round, commit. The live ledger credits the helper (3 NC). The
  // replay in `order by t, id` reads help_confirmed first and loses it (SD-153). After a restart the
  // balance is 0.
  run helpReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cHelp("a", "b"), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { balance(mem, "a") == HELP, balance(replay(pg), "a") == 0, not(replayEqualsLive) })
      .then(all { cRestart, notifyUnchanged })
      .expect(balance(mem, "a") == 0)

  // packages/network/test/service-platform.test.ts:575-585: join stores member_joined; leave deletes it.
  run joinThenLeaveTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(pg.exists(e => e.typ == "member_joined" and e.member == "a"))
      .then(all { cForget("a"), notifyUnchanged })
      .expect(and { pg.forall(e => not(names(e, "a"))), safety })

  // SD-049: an adult joins; a text shows 16 (m.minor); no age_updated; the ledger keeps them eligible.
  run minorStaysEligibleTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cLearnMinor("a"), notifyUnchanged })
      .expect(not(noMinorEligible))

  // SD-154: an invitee activates and a member other than the voucher gives value; the product's
  // value_received has no confirmedBy, so the voucher gets no credit.
  run vouchNeverCreditedTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cJoin("b", true, "a"), notifyUnchanged })
      .then(all { cJoin("c", true, ""), notifyUnchanged })
      .then(all { cActivate("b"), notifyUnchanged })
      .then(all { cValue("b", "c"), notifyUnchanged })
      .expect(and { not(vouchCreditFollowsValue), balance(mem, "a") == 0 })

  // SD-156: the clock steps back after a later event. The live ledger refuses the next event
  // (t < lastT): member b stays unknown live. runtime.ts:162 still puts the event in the unit, so it
  // is stored, and the replay (sorted by t) accepts it: after a restart b is a known, eligible member.
  run clockBackReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("a", true, ""), notifyUnchanged })
      .then(all { cTick, notifyUnchanged })
      .then(all { cTick, notifyUnchanged })
      .then(all { cActivate("a"), notifyUnchanged })
      .then(all { cClockBack, notifyUnchanged })
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { mem.rejects == 1, not(mem.members.get("b").known), replay(pg).members.get("b").known, not(replayEqualsLive) })

  // SD-153 (second form): activate() emits member_joined then member_activated at one t
  // (network.ts:2699-2705). `order by t, id` puts member_activated first; the replay drops it
  // (unknown member), so after a restart the member is not activated.
  run activateReplayTest =
    initWith("capital", "active")
      .then(all { cJoin("b", true, ""), notifyUnchanged })
      .then(all { cActivate("b"), notifyUnchanged })
      .then(all { cCommit, notifyUnchanged })
      .expect(and { mem.members.get("b").activated, not(replay(pg).members.get("b").activated), not(replayEqualsLive) })

  // SD-339: two links to Claude go unused and the sweep drops the surface. The member then uses
  // Claude (get_updates: touch) and turns the grant off and on; the streak stays at 2, so no
  // later notification points at Claude again.
  run droppedSurfaceStaysTest =
    initWith("notify", "active")
      .then(all { setActive(true), capitalUnchanged })
      .then(all { netSend(1, 1, false), capitalUnchanged })
      .then(all { projAdd(1), capitalUnchanged })
      .then(all { plan("r1", "claude"), capitalUnchanged })
      .then(all { reread("r1", "claude"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { netSend(2, 2, false), capitalUnchanged })
      .then(all { projAdd(2), capitalUnchanged })
      .then(all { plan("r1", "claude"), capitalUnchanged })
      .then(all { reread("r1", "claude"), capitalUnchanged })
      .then(all { recordDelivery("r1"), capitalUnchanged })
      .then(all { enqueue("r1"), capitalUnchanged })
      .then(all { sweepOne(Set(1)), capitalUnchanged })
      .then(all { sweepOne(Set(2)), capitalUnchanged })
      .then(all { setActive(false), capitalUnchanged })
      .then(all { setActive(true), capitalUnchanged })
      .then(all { readApp("ntwrk", "claude"), capitalUnchanged })
      .expect(and { sig.streak == 2, not(claudeUsable), targets == Set("imessage"), not(droppedSurfaceReturnsOnUse) })
}

