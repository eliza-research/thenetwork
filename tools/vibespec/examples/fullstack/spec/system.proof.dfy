// Proofs that the network, the server and the two tabs keep the system's
// rules. What each part does to its own rules comes from the laws the server
// and client specs state (and prove) about themselves; what is left is about
// copies of the list: every copy in a tab or on the network is the list as it
// was at its version.

// Taking a message off the network leaves only messages that were on it.
lemma DropFrom(net: seq<Msg>, i: int, rest: seq<Msg>, from: Cut)
  requires forall x :: x in from.out ==> x in net
  requires forall x :: x in rest ==> x in net
  ensures forall x :: x in Std.Collections.Seq.FoldLeft((acc: Cut, m: Msg) => Cut((if (acc.k == i) then acc.out else (acc.out + [m])), (acc.k + 1)), from, rest).out ==> x in net
  decreases |rest|
{
  if |rest| > 0 {
    var f := (acc: Cut, m: Msg) => Cut((if (acc.k == i) then acc.out else (acc.out + [m])), (acc.k + 1));
    assert rest[0] in net;
    assert forall x :: x in rest[1..] ==> x in rest;
    DropFrom(net, i, rest[1..], f(from, rest[0]));
  }
}

lemma DropAtSubset(net: seq<Msg>, i: int)
  ensures forall x :: x in dropAt(net, i) ==> x in net
{
  DropFrom(net, i, net, uncut);
}

// A copy that was the list at its version still is after the history grows.
lemma PastExtends(h: seq<seq<todo_Todo>>, x: seq<todo_Todo>, v: int, t: seq<todo_Todo>)
  requires isPast(h, v, t)
  ensures isPast(h + [x], v, t)
{
  assert pastAt(h + [x], v) == pastAt(h, v);
}

// What the rule says of every message on the network, for one message.
lemma OnTheWire(sys: System, x: Msg)
  requires alwaysEveryCopyIsTheListAtItsVersion(sys)
  requires x in sys.net
  ensures isRequest(x) || isPast(sys.history, x.version, x.todos)
{
  var j :| 0 <= j < |sys.net| && sys.net[j] == x;
}

lemma act_ensures(sys: System, who: string, op: todo_Op)
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysEachPartKeepsItsRules(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysNoTabIsAheadOfTheServer(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysTheHistoryEndsWithTheCurrentList(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysEveryCopyIsTheListAtItsVersion(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysAnAcknowledgedEditWasApplied(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysARetryIsTheSameEdit(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysEveryMessageBelongsToANumberedEdit(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysTheForgeryCountIsNotNegative(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysALoneUsersEditIsNeverRefused(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysAPushFollowsAnotherEdit(act(sys, who, op)))
  ensures (inv(sys) ==> canAct(sys, who, op) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(act(sys, who, op)))
{
  if inv(sys) && canAct(sys, who, op) {
    ActInStep(sys, who, op, "a");
    ActInStep(sys, who, op, "b");
    var after := act(sys, who, op);
    client_lawQueueingKeepsTheRules_ensures(clientOf(sys, who), op);
    forall j | 0 <= j < |after.net|
      ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
    {
      if j < |sys.net| {
        assert after.net[j] == sys.net[j];
        OnTheWire(sys, sys.net[j]);
      }
    }
  }
}

lemma serve_ensures(sys: System, i: int)
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysEachPartKeepsItsRules(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysNoTabIsAheadOfTheServer(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysTheHistoryEndsWithTheCurrentList(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysEveryCopyIsTheListAtItsVersion(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysAnAcknowledgedEditWasApplied(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysARetryIsTheSameEdit(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysEveryMessageBelongsToANumberedEdit(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysTheForgeryCountIsNotNegative(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysALoneUsersEditIsNeverRefused(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysAPushFollowsAnotherEdit(serve(sys, i)))
  ensures (inv(sys) ==> canServe(sys, i) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(serve(sys, i)))
{
  if inv(sys) && canServe(sys, i) {
    ServeInStep(sys, i, "a");
    ServeInStep(sys, i, "b");
    var m := msgAt(sys.net, i);
    var rest := dropAt(sys.net, i);
    DropAtSubset(sys.net, i);
    var after := serve(sys, i);
    assert sys.server.version >= 0;
    if server_answered(sys.server, m.client, m.seq_) {
      assert after == repeatAnswer(m, rest, sys);
      forall j | 0 <= j < |after.net|
        ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
      {
        if j < |rest| { OnTheWire(sys, rest[j]); }
      }
    } else if server_allows(sys.server, m.client, m.seq_, m.op) {
      var s := server_commit(m.client, sys.server, m.seq_, m.op);
      assert after == applyRequest(m, rest, sys);
      server_lawACommitKeepsTheRules_ensures(sys.server, m.client, m.seq_, m.op);
      todo_lawAListIsTheSameAsItself_ensures(s.todos);
      assert pastAt(after.history, s.version) == s.todos;
      PastExtends(sys.history, s.todos, sys.a.seen, sys.a.confirmed);
      PastExtends(sys.history, s.todos, sys.b.seen, sys.b.confirmed);
      forall j | 0 <= j < |after.net|
        ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
      {
        if j < |rest| {
          OnTheWire(sys, rest[j]);
          if !isRequest(rest[j]) { PastExtends(sys.history, s.todos, rest[j].version, rest[j].todos); }
        }
      }
    } else {
      assert after == refuseRequest(m, rest, sys);
      server_lawARefusalKeepsTheRules_ensures(sys.server, m.client, m.seq_, m.op);
      forall j | 0 <= j < |after.net|
        ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
      {
        if j < |rest| { OnTheWire(sys, rest[j]); }
      }
    }
  }
}

lemma deliver_ensures(sys: System, i: int)
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysEachPartKeepsItsRules(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysNoTabIsAheadOfTheServer(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysTheHistoryEndsWithTheCurrentList(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysEveryCopyIsTheListAtItsVersion(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysAnAcknowledgedEditWasApplied(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysARetryIsTheSameEdit(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysEveryMessageBelongsToANumberedEdit(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysTheForgeryCountIsNotNegative(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysALoneUsersEditIsNeverRefused(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysAPushFollowsAnotherEdit(deliver(sys, i)))
  ensures (inv(sys) ==> canDeliver(sys, i) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(deliver(sys, i)))
{
  if inv(sys) && canDeliver(sys, i) {
    DeliverInStep(sys, i, "a");
    DeliverInStep(sys, i, "b");
    var m := msgAt(sys.net, i);
    var c := clientOf(sys, m.client);
    var after := deliver(sys, i);
    assert m == sys.net[i];
    OnTheWire(sys, m);
    DropAtSubset(sys.net, i);
    client_lawAnAnswerKeepsTheRules_ensures(c, m.seq_, m.version, m.todos);
    forall j | 0 <= j < |after.net|
      ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
    {
      OnTheWire(sys, after.net[j]);
    }
  }
}

lemma lose_ensures(sys: System, i: int)
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysEachPartKeepsItsRules(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysNoTabIsAheadOfTheServer(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysTheHistoryEndsWithTheCurrentList(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysEveryCopyIsTheListAtItsVersion(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysAnAcknowledgedEditWasApplied(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysARetryIsTheSameEdit(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysEveryMessageBelongsToANumberedEdit(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysTheForgeryCountIsNotNegative(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysALoneUsersEditIsNeverRefused(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysAPushFollowsAnotherEdit(lose(sys, i)))
  ensures (inv(sys) ==> canLose(sys, i) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(lose(sys, i)))
{
  if inv(sys) && canLose(sys, i) {
    var after := lose(sys, i);
    DropAtSubset(sys.net, i);
    WireSubset(sys, dropAt(sys.net, i));
    forall j | 0 <= j < |after.net|
      ensures isRequest(after.net[j]) || isPast(after.history, after.net[j].version, after.net[j].todos)
    {
      OnTheWire(sys, after.net[j]);
    }
  }
}

// List equality in the spec agrees with the sequence equality used in proofs.
lemma CompareFrom(rest: seq<todo_Todo>, ys: seq<todo_Todo>, k: int, ok: bool)
  requires 0 <= k && k + |rest| <= |ys|
  ensures Std.Collections.Seq.FoldLeft((acc: todo_Walk, t: todo_Todo) => todo_Walk((acc.ok && todo_sameAt(ys, acc.i, t)), (acc.i + 1)), todo_Walk(ok, k), rest).ok == (ok && forall j :: 0 <= j < |rest| ==> rest[j] == ys[k + j])
  decreases |rest|
{
  if |rest| > 0 {
    var f := (acc: todo_Walk, t: todo_Todo) => todo_Walk((acc.ok && todo_sameAt(ys, acc.i, t)), (acc.i + 1));
    CompareFrom(rest[1..], ys, k + 1, ok && todo_sameAt(ys, k, rest[0]));
    assert forall j :: 0 <= j < |rest[1..]| ==> rest[1..][j] == rest[j + 1];
  }
}

lemma SameLists(xs: seq<todo_Todo>, ys: seq<todo_Todo>)
  ensures todo_sameTodos(xs, ys) == (xs == ys)
{
  if |xs| == |ys| {
    CompareFrom(xs, ys, 0, true);
    if todo_sameTodos(xs, ys) {
      assert forall j :: 0 <= j < |xs| ==> xs[j] == ys[j];
      assert xs == ys;
    }
  }
}

lemma ReplayAppend(todos: seq<todo_Todo>, ps: seq<client_Pending>, p: client_Pending)
  ensures replay(todos, ps + [p]) == todo_applyOp(replay(todos, ps), p.op)
  decreases |ps|
{
  if |ps| > 0 {
    ReplayAppend(todo_applyOp(todos, ps[0].op), ps[1..], p);
  }
}

lemma PlanAppend(plan: Plan, ps: seq<client_Pending>, item: client_Pending)
  ensures Std.Collections.Seq.FoldLeft((acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op)), plan, ps + [item]) ==
    (var before := Std.Collections.Seq.FoldLeft((acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op)), plan, ps);
      Plan((before.ok && todo_opAllowed(before.todos, item.op)), todo_applyOp(before.todos, item.op)))
  decreases |ps|
{
  if |ps| > 0 {
    var f := (acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op));
    PlanAppend(f(plan, ps[0]), ps[1..], item);
  }
}

lemma goOffline_ensures(sys: System, who: string)
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysEachPartKeepsItsRules(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysNoTabIsAheadOfTheServer(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysTheHistoryEndsWithTheCurrentList(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysEveryCopyIsTheListAtItsVersion(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysAnAcknowledgedEditWasApplied(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysARetryIsTheSameEdit(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysEveryMessageBelongsToANumberedEdit(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysTheForgeryCountIsNotNegative(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysALoneUsersEditIsNeverRefused(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysAPushFollowsAnotherEdit(goOffline(sys, who)))
  ensures (inv(sys) ==> canGoOffline(sys, who) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(goOffline(sys, who)))
{
}

lemma goOnline_ensures(sys: System, who: string)
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysEachPartKeepsItsRules(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysNoTabIsAheadOfTheServer(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysTheHistoryEndsWithTheCurrentList(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysEveryCopyIsTheListAtItsVersion(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysAnAcknowledgedEditWasApplied(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysARetryIsTheSameEdit(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysEveryMessageBelongsToANumberedEdit(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysTheForgeryCountIsNotNegative(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysALoneUsersEditIsNeverRefused(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysAPushFollowsAnotherEdit(goOnline(sys, who)))
  ensures (inv(sys) ==> canGoOnline(sys, who) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(goOnline(sys, who)))
{
  if inv(sys) && canGoOnline(sys, who) {
    var c := clientOf(sys, who);
    var connected := withClient(who, client_goOnline(c), sys);
    assert inv(connected);
    if |c.pending| > 0 {
      OldestFacts(connected, who);
      WireAppend(connected, request(who, oldest(c)));
    }
  }
}

lemma resend_ensures(sys: System, who: string)
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysEachPartKeepsItsRules(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysNoTabIsAheadOfTheServer(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysTheHistoryEndsWithTheCurrentList(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysEveryCopyIsTheListAtItsVersion(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysAnAcknowledgedEditWasApplied(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysARetryIsTheSameEdit(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysEveryMessageBelongsToANumberedEdit(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysTheForgeryCountIsNotNegative(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysALoneUsersEditIsNeverRefused(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysAPushFollowsAnotherEdit(resend(sys, who)))
  ensures (inv(sys) ==> canResend(sys, who) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(resend(sys, who)))
{
  if inv(sys) && canResend(sys, who) {
    OldestFacts(sys, who);
    WireAppend(sys, request(who, oldest(clientOf(sys, who))));
  }
}

lemma duplicate_ensures(sys: System, i: int)
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysEachPartKeepsItsRules(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysNoTabIsAheadOfTheServer(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysTheHistoryEndsWithTheCurrentList(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysEveryCopyIsTheListAtItsVersion(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysAnAcknowledgedEditWasApplied(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysARetryIsTheSameEdit(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysEveryMessageBelongsToANumberedEdit(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysTheForgeryCountIsNotNegative(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysALoneUsersEditIsNeverRefused(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysAPushFollowsAnotherEdit(duplicate(sys, i)))
  ensures (inv(sys) ==> canDuplicate(sys, i) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(duplicate(sys, i)))
{
  if inv(sys) && canDuplicate(sys, i) {
    var m := msgAt(sys.net, i);
    WireProperties(sys, m);
    WireAppend(sys, m);
  }
}

lemma forge_ensures(sys: System, who: string, seq_: int, op: todo_Op)
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysOnlyTheOldestQueuedEditIsOnItsWay(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysEachPartKeepsItsRules(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysNoTabIsAheadOfTheServer(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysTheHistoryEndsWithTheCurrentList(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysEveryCopyIsTheListAtItsVersion(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysAnAcknowledgedEditWasApplied(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysARetryIsTheSameEdit(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysEveryMessageBelongsToANumberedEdit(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysTheForgeryCountIsNotNegative(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysALoneUsersEditIsNeverRefused(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysWithoutForgeriesOnlyNumberedEditsWereAnswered(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysAPushFollowsAnotherEdit(forge(sys, who, seq_, op)))
  ensures (inv(sys) ==> canForge(sys, who, seq_, op) ==> alwaysALoneUsersTabKeepsInStepWithTheServer(forge(sys, who, seq_, op)))
{
  if inv(sys) && canForge(sys, who, seq_, op) {
    var base := sys.(forged := sys.forged + 1);
    assert inv(base);
    WireAppend(base, Msg(Forged, who, seq_, op, 0, []));
  }
}

lemma WireProperties(sys: System, m: Msg)
  requires inv(sys) && m in sys.net
  ensures (isRequest(m) || isPast(sys.history, m.version, m.todos))
  ensures (!m.kind.Request? || server_answered(sys.server, m.client, m.seq_) || (|clientOf(sys, m.client).pending| > 0 && m.seq_ == oldest(clientOf(sys, m.client)).seq_))
  ensures (!m.kind.Ack? || forall p :: p in clientOf(sys, m.client).pending ==> p.seq_ != m.seq_ || server_acceptedAs(sys.server, m.client, p.seq_, p.op))
  ensures (!m.kind.Request? || forall p :: p in clientOf(sys, m.client).pending ==> p.seq_ != m.seq_ || todo_sameOp(p.op, m.op))
  ensures (m.kind.Forged? || m.kind.Push? || (numbered(sys, m.client, m.seq_) && (m.kind.Request? || server_answered(sys.server, m.client, m.seq_))))
  ensures (sys.forged != 0 || !m.kind.Forged?)
  ensures (!m.kind.Push? || clientOf(sys, other(m.client)).made >= 1 || sys.forged >= 1)
  ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!m.kind.Ack? || m.client != who || |clientOf(sys, who).pending| == 0 || m.seq_ != oldest(clientOf(sys, who)).seq_ || m.version == sys.server.version))
  ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (isRequest(m) || m.client != who || m.version <= clientOf(sys, who).seen || m.version == sys.server.version))
  ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!m.kind.Refusal? || m.client != who || !client_waiting(clientOf(sys, who), m.seq_)))
{
  var j :| 0 <= j < |sys.net| && sys.net[j] == m;
}

lemma WireAppend(sys: System, m: Msg)
  requires inv(sys)
  requires (isRequest(m) || isPast(sys.history, m.version, m.todos))
  requires (!m.kind.Request? || server_answered(sys.server, m.client, m.seq_) || (|clientOf(sys, m.client).pending| > 0 && m.seq_ == oldest(clientOf(sys, m.client)).seq_))
  requires (!m.kind.Ack? || forall p :: p in clientOf(sys, m.client).pending ==> p.seq_ != m.seq_ || server_acceptedAs(sys.server, m.client, p.seq_, p.op))
  requires (!m.kind.Request? || forall p :: p in clientOf(sys, m.client).pending ==> p.seq_ != m.seq_ || todo_sameOp(p.op, m.op))
  requires (m.kind.Forged? || m.kind.Push? || (numbered(sys, m.client, m.seq_) && (m.kind.Request? || server_answered(sys.server, m.client, m.seq_))))
  requires (sys.forged != 0 || !m.kind.Forged?)
  requires (!m.kind.Push? || clientOf(sys, other(m.client)).made >= 1 || sys.forged >= 1)
  requires (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!m.kind.Ack? || m.client != who || |clientOf(sys, who).pending| == 0 || m.seq_ != oldest(clientOf(sys, who)).seq_ || m.version == sys.server.version))
  requires (forall who :: who in {"a", "b"} && lone(sys, who) ==> (isRequest(m) || m.client != who || m.version <= clientOf(sys, who).seen || m.version == sys.server.version))
  requires (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!m.kind.Refusal? || m.client != who || !client_waiting(clientOf(sys, who), m.seq_)))
  ensures inv(sys.(net := sys.net + [m]))
{
  var after := sys.(net := sys.net + [m]);
  forall j | 0 <= j < |after.net|
    ensures (isRequest(after.net[j]) || isPast(sys.history, after.net[j].version, after.net[j].todos))
    ensures (!after.net[j].kind.Request? || server_answered(sys.server, after.net[j].client, after.net[j].seq_) || (|clientOf(sys, after.net[j].client).pending| > 0 && after.net[j].seq_ == oldest(clientOf(sys, after.net[j].client)).seq_))
    ensures (!after.net[j].kind.Ack? || forall p :: p in clientOf(sys, after.net[j].client).pending ==> p.seq_ != after.net[j].seq_ || server_acceptedAs(sys.server, after.net[j].client, p.seq_, p.op))
    ensures (!after.net[j].kind.Request? || forall p :: p in clientOf(sys, after.net[j].client).pending ==> p.seq_ != after.net[j].seq_ || todo_sameOp(p.op, after.net[j].op))
    ensures (after.net[j].kind.Forged? || after.net[j].kind.Push? || (numbered(sys, after.net[j].client, after.net[j].seq_) && (after.net[j].kind.Request? || server_answered(sys.server, after.net[j].client, after.net[j].seq_))))
    ensures (sys.forged != 0 || !after.net[j].kind.Forged?)
    ensures (!after.net[j].kind.Push? || clientOf(sys, other(after.net[j].client)).made >= 1 || sys.forged >= 1)
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!after.net[j].kind.Ack? || after.net[j].client != who || |clientOf(sys, who).pending| == 0 || after.net[j].seq_ != oldest(clientOf(sys, who)).seq_ || after.net[j].version == sys.server.version))
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (isRequest(after.net[j]) || after.net[j].client != who || after.net[j].version <= clientOf(sys, who).seen || after.net[j].version == sys.server.version))
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!after.net[j].kind.Refusal? || after.net[j].client != who || !client_waiting(clientOf(sys, who), after.net[j].seq_)))
  {
    if j < |sys.net| { WireProperties(sys, sys.net[j]); }
  }
}

lemma WireSubset(sys: System, kept: seq<Msg>)
  requires inv(sys)
  requires forall m :: m in kept ==> m in sys.net
  ensures inv(sys.(net := kept))
{
  forall j | 0 <= j < |kept|
    ensures (isRequest(kept[j]) || isPast(sys.history, kept[j].version, kept[j].todos))
    ensures (!kept[j].kind.Request? || server_answered(sys.server, kept[j].client, kept[j].seq_) || (|clientOf(sys, kept[j].client).pending| > 0 && kept[j].seq_ == oldest(clientOf(sys, kept[j].client)).seq_))
    ensures (!kept[j].kind.Ack? || forall p :: p in clientOf(sys, kept[j].client).pending ==> p.seq_ != kept[j].seq_ || server_acceptedAs(sys.server, kept[j].client, p.seq_, p.op))
    ensures (!kept[j].kind.Request? || forall p :: p in clientOf(sys, kept[j].client).pending ==> p.seq_ != kept[j].seq_ || todo_sameOp(p.op, kept[j].op))
    ensures (kept[j].kind.Forged? || kept[j].kind.Push? || (numbered(sys, kept[j].client, kept[j].seq_) && (kept[j].kind.Request? || server_answered(sys.server, kept[j].client, kept[j].seq_))))
    ensures (sys.forged != 0 || !kept[j].kind.Forged?)
    ensures (!kept[j].kind.Push? || clientOf(sys, other(kept[j].client)).made >= 1 || sys.forged >= 1)
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!kept[j].kind.Ack? || kept[j].client != who || |clientOf(sys, who).pending| == 0 || kept[j].seq_ != oldest(clientOf(sys, who)).seq_ || kept[j].version == sys.server.version))
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (isRequest(kept[j]) || kept[j].client != who || kept[j].version <= clientOf(sys, who).seen || kept[j].version == sys.server.version))
    ensures (forall who :: who in {"a", "b"} && lone(sys, who) ==> (!kept[j].kind.Refusal? || kept[j].client != who || !client_waiting(clientOf(sys, who), kept[j].seq_)))
  { WireProperties(sys, kept[j]); }
}

lemma ClientDistinctBridge(c: client_Client)
  ensures client_alwaysQueuedEditsHaveDistinctNumbers(c) == Std.Collections.Seq.All(c.pending, (p: client_Pending) => (|ProofLib.Filter((q: client_Pending) => (q.seq_ == p.seq_), c.pending)| == 1))
{ }

lemma OldestFacts(sys: System, who: string)
  requires inv(sys) && isClient(who) && |clientOf(sys, who).pending| > 0
  ensures numbered(sys, who, oldest(clientOf(sys, who)).seq_)
  ensures forall q :: q in clientOf(sys, who).pending && q.seq_ == oldest(clientOf(sys, who)).seq_ ==> q == oldest(clientOf(sys, who))
{
  var c := clientOf(sys, who);
  var p := c.pending[0];
  ClientDistinctBridge(c);
  ProofLib.FilterCountOneIffUnique((q: client_Pending) => (q.seq_ == p.seq_), c.pending, (q: client_Pending) => q.seq_, 0);
  forall q | q in c.pending && q.seq_ == p.seq_
    ensures q == p
  {
    var j :| 0 <= j < |c.pending| && c.pending[j] == q;
    assert j == 0;
  }
}

lemma PlanReplay(plan: Plan, ps: seq<client_Pending>)
  ensures Std.Collections.Seq.FoldLeft((acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op)), plan, ps).todos == replay(plan.todos, ps)
  ensures !plan.ok ==> !Std.Collections.Seq.FoldLeft((acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op)), plan, ps).ok
  decreases |ps|
{
  if |ps| > 0 {
    var f := (acc: Plan, p: client_Pending) => Plan((acc.ok && todo_opAllowed(acc.todos, p.op)), todo_applyOp(acc.todos, p.op));
    PlanReplay(f(plan, ps[0]), ps[1..]);
  }
}

lemma AllowedAppend(todos: seq<todo_Todo>, ps: seq<client_Pending>, item: client_Pending)
  ensures allowedInTurn(todos, ps + [item]) == (allowedInTurn(todos, ps) && todo_opAllowed(replay(todos, ps), item.op))
{
  PlanAppend(Plan(true, todos), ps, item);
  PlanReplay(Plan(true, todos), ps);
}

lemma AllowedTail(todos: seq<todo_Todo>, ps: seq<client_Pending>)
  requires |ps| > 0 && allowedInTurn(todos, ps)
  ensures todo_opAllowed(todos, ps[0].op)
  ensures allowedInTurn(todo_applyOp(todos, ps[0].op), ps[1..])
{
  var plan := Plan(todo_opAllowed(todos, ps[0].op), todo_applyOp(todos, ps[0].op));
  PlanReplay(plan, ps[1..]);
}

lemma ApplyTwice(todos: seq<todo_Todo>, op: todo_Op)
  ensures todo_applyOp(todo_applyOp(todos, op), op) == todo_applyOp(todos, op)
{
  if op.kind == "create" {
    if !todo_has(todos, op.id) {
      assert todo_Todo(op.id, op.title, false, false) in todo_applyOp(todos, op);
    }
  } else {
    forall j | 0 <= j < |todos|
      ensures todo_edit(todo_edit(todos[j], op), op) == todo_edit(todos[j], op)
    {
      todo_lawEditingTwiceIsEditingOnce_ensures(todos[j], op);
    }
  }
}

lemma WithoutBridge(ps: seq<client_Pending>, seq_: int)
  ensures client_without(ps, seq_) == ProofLib.Filter((p: client_Pending) => (p.seq_ != seq_), ps)
{ }

lemma WithoutIdentity(ps: seq<client_Pending>, seq_: int)
  requires forall p :: p in ps ==> p.seq_ != seq_
  ensures client_without(ps, seq_) == ps
  decreases |ps|
{
  WithoutBridge(ps, seq_);
  if |ps| > 0 {
    ProofLib.FilterCons((p: client_Pending) => (p.seq_ != seq_), ps);
    WithoutIdentity(ps[1..], seq_);
  } else {
    ProofLib.FilterNil((p: client_Pending) => (p.seq_ != seq_), ps);
  }
}

lemma WithoutOldest(sys: System, who: string)
  requires inv(sys) && isClient(who) && |clientOf(sys, who).pending| > 0
  ensures client_without(clientOf(sys, who).pending, oldest(clientOf(sys, who)).seq_) == clientOf(sys, who).pending[1..]
{
  var c := clientOf(sys, who);
  OldestFacts(sys, who);
  var first := c.pending[0];
  WithoutBridge(c.pending, first.seq_);
  ProofLib.FilterCons((p: client_Pending) => (p.seq_ != first.seq_), c.pending);
  forall j | 1 <= j < |c.pending| ensures c.pending[j].seq_ != first.seq_ {
    ClientDistinctBridge(c);
    ProofLib.FilterCountOneIffUnique((q: client_Pending) => (q.seq_ == first.seq_), c.pending, (q: client_Pending) => q.seq_, 0);
  }
  WithoutIdentity(c.pending[1..], first.seq_);
}

lemma UnmadeNotAnswered(sys: System, who: string, n: int)
  requires inv(sys) && sys.forged == 0 && n > clientOf(sys, who).made
  ensures !server_answered(sys.server, who, n)
{
  if server_answered(sys.server, who, n) {
    var h :| h in sys.server.log && h.client == who && h.seq_ == n;
    var j :| 0 <= j < |sys.server.log| && sys.server.log[j] == h;
    assert numbered(sys, h.client, h.seq_);
  }
}

lemma UnmadeNotOnWire(sys: System, who: string, n: int)
  requires inv(sys) && n > clientOf(sys, who).made
  ensures forall m :: m in sys.net && m.client == who && (m.kind.Request? || m.kind.Ack? || m.kind.Refusal?) ==> m.seq_ != n
{
  forall m | m in sys.net && m.client == who && (m.kind.Request? || m.kind.Ack? || m.kind.Refusal?)
    ensures m.seq_ != n
  {
    WireProperties(sys, m);
  }
}

// Queueing preserves a lone tab's relation to the server and its pending edits.
lemma ActInStep(sys: System, who: string, op: todo_Op, owner: string)
  requires inv(sys) && canAct(sys, who, op) && isClient(owner)
  ensures lone(act(sys, who, op), owner) ==> inStep(act(sys, who, op), owner)
{
  var after := act(sys, who, op);
  var c := clientOf(sys, who);
  var s := sys.server;
  var item := client_Pending(c.made + 1, op);
  var queued := client_queue(op, c);
  if lone(after, owner) {
    assert c.made >= 0;
    assert who == owner;
    assert lone(sys, who) && inStep(sys, who);
    assert sys.forged == 0;
    assert clientOf(after, who) == queued;
    assert queued.pending == c.pending + [item];
    UnmadeNotAnswered(sys, who, item.seq_);
    UnmadeNotOnWire(sys, who, item.seq_);
    if |c.pending| > 0 {
      assert oldest(clientOf(after, who)) == oldest(clientOf(sys, who));
    } else {
      assert oldest(clientOf(after, who)) == item;
    }
    assert oldestAnswered(after, who) == oldestAnswered(sys, who);
    assert unapplied(after, who) == unapplied(sys, who) + [item];

    SameLists(client_view(c), replay(s.todos, c.pending));
    ReplayAppend(c.confirmed, c.pending, item);
    ReplayAppend(s.todos, c.pending, item);
    assert client_view(queued) == replay(s.todos, queued.pending);
    SameLists(client_view(queued), replay(s.todos, queued.pending));
    if oldestAnswered(sys, who) {
      SameLists(todo_applyOp(s.todos, oldest(c).op), s.todos);
      assert replay(s.todos, c.pending) == replay(s.todos, c.pending[1..]);
    }
    assert replay(s.todos, c.pending) == replay(s.todos, unapplied(sys, who));
    AllowedAppend(s.todos, unapplied(sys, who), item);
    assert allowedInTurn(s.todos, unapplied(after, who));

    forall j | 0 <= j < |queued.pending|
      ensures !server_answered(s, who, queued.pending[j].seq_) || server_acceptedAs(s, who, queued.pending[j].seq_, queued.pending[j].op)
    {
      if j < |c.pending| {
        assert queued.pending[j] == c.pending[j];
      }
    }
    forall j | 0 <= j < |after.net|
      ensures !after.net[j].kind.Ack? || after.net[j].client != who || after.net[j].seq_ != oldest(queued).seq_ || after.net[j].version == s.version
      ensures isRequest(after.net[j]) || after.net[j].client != who || after.net[j].version <= queued.seen || after.net[j].version == s.version
      ensures !after.net[j].kind.Refusal? || after.net[j].client != who || !client_waiting(queued, after.net[j].seq_)
    {
      if j < |sys.net| {
        var m := sys.net[j];
        assert after.net[j] == m;
        WireProperties(sys, m);
        if m.client == who && (m.kind.Ack? || m.kind.Refusal?) {
          assert numbered(sys, who, m.seq_);
          assert m.seq_ <= c.made;
          assert m.seq_ != item.seq_;
          assert client_waiting(queued, m.seq_) == client_waiting(c, m.seq_);
        }
      } else {
        assert after.net[j].kind.Request?;
      }
    }
    assert inStep(after, owner);
  }
}

// A lone tab's only new request applies the head of its queue; retries leave it in place.
lemma ServeInStep(sys: System, i: int, owner: string)
  requires inv(sys) && canServe(sys, i) && isClient(owner)
  ensures lone(serve(sys, i), owner) ==> inStep(serve(sys, i), owner)
{
  var after := serve(sys, i);
  if lone(after, owner) {
    var m := msgAt(sys.net, i);
    var rest := dropAt(sys.net, i);
    var c := clientOf(sys, owner);
    var s := sys.server;
    assert lone(sys, owner) && inStep(sys, owner);
    WireProperties(sys, m);
    DropAtSubset(sys.net, i);
    assert m.kind.Request?;
    assert m.client == owner;
    if !server_answered(s, owner, m.seq_) {
      assert |c.pending| > 0 && m.seq_ == oldest(c).seq_;
      OldestFacts(sys, owner);
      assert todo_sameOp(oldest(c).op, m.op);
      assert oldest(c).op == m.op;
      assert !oldestAnswered(sys, owner);
      AllowedTail(s.todos, c.pending);
      assert server_allows(s, owner, m.seq_, m.op);
      ApplyTwice(s.todos, m.op);
      SameLists(client_view(c), replay(s.todos, c.pending));
      assert after.server.todos == todo_applyOp(s.todos, m.op);
      assert replay(after.server.todos, c.pending) == replay(s.todos, c.pending);
      SameLists(client_view(c), replay(after.server.todos, c.pending));
      SameLists(todo_applyOp(after.server.todos, oldest(c).op), after.server.todos);
      assert oldestAnswered(after, owner);
      assert allowedInTurn(after.server.todos, unapplied(after, owner));
    } else {
      if client_waiting(c, m.seq_) {
        var p :| p in c.pending && p.seq_ == m.seq_;
        assert server_acceptedAs(s, owner, p.seq_, p.op);
        assert todo_sameOp(p.op, m.op);
        assert p.op == m.op;
        assert server_acceptedAs(s, owner, m.seq_, m.op);
      }
    }
    forall j | 0 <= j < |c.pending|
      ensures !server_answered(after.server, owner, c.pending[j].seq_) || server_acceptedAs(after.server, owner, c.pending[j].seq_, c.pending[j].op)
    {
      var p := c.pending[j];
      if after.server != s && p.seq_ == m.seq_ {
        OldestFacts(sys, owner);
        assert p.op == m.op;
      }
    }
    forall j | 0 <= j < |after.net|
      ensures !after.net[j].kind.Ack? || after.net[j].client != owner || |c.pending| == 0 || after.net[j].seq_ != oldest(c).seq_ || after.net[j].version == after.server.version
      ensures isRequest(after.net[j]) || after.net[j].client != owner || after.net[j].version <= c.seen || after.net[j].version == after.server.version
      ensures !after.net[j].kind.Refusal? || after.net[j].client != owner || !client_waiting(c, after.net[j].seq_)
    {
      if j < |rest| {
        var prior := rest[j];
        WireProperties(sys, prior);
        if after.server != s {
          assert c.seen == s.version;
          if prior.kind.Ack? && prior.client == owner && prior.seq_ == oldest(c).seq_ {
            assert server_answered(s, owner, prior.seq_);
          }
        }
      }
    }
    assert inStep(after, owner);
  }
}

// Delivering an answer drops at most the answered head and keeps versioned copies aligned.
lemma DeliverInStep(sys: System, i: int, owner: string)
  requires inv(sys) && canDeliver(sys, i) && isClient(owner)
  ensures lone(deliver(sys, i), owner) ==> inStep(deliver(sys, i), owner)
{
  var after := deliver(sys, i);
  if lone(after, owner) {
    var m := msgAt(sys.net, i);
    var rest := dropAt(sys.net, i);
    var c := clientOf(sys, owner);
    var s := sys.server;
    assert lone(sys, owner) && inStep(sys, owner);
    WireProperties(sys, m);
    DropAtSubset(sys.net, i);
    WireSubset(sys, rest);
    if m.client == owner {
      assert !m.kind.Push? && !isRequest(m);
      var d := clientOf(after, owner);
      if client_waiting(c, m.seq_) {
        assert m.kind.Ack?;
        assert server_answered(s, owner, m.seq_);
        assert |c.pending| > 0 && m.seq_ == oldest(c).seq_;
        assert oldestAnswered(sys, owner);
        WithoutOldest(sys, owner);
        assert d.pending == c.pending[1..];
        assert m.version == s.version;
        SameLists(todo_applyOp(s.todos, oldest(c).op), s.todos);
        assert replay(s.todos, c.pending) == replay(s.todos, d.pending);
        assert !oldestAnswered(after, owner);
      } else {
        assert forall p :: p in c.pending ==> p.seq_ != m.seq_;
        WithoutIdentity(c.pending, m.seq_);
        assert d.pending == c.pending;
      }
      if m.version > c.seen || (client_waiting(c, m.seq_) && c.seen == s.version) {
        assert m.version == s.version;
        SameLists(pastAt(sys.history, s.version), s.todos);
        SameLists(pastAt(sys.history, m.version), m.todos);
        assert m.todos == s.todos;
        if m.version == c.seen {
          SameLists(pastAt(sys.history, c.seen), c.confirmed);
          assert c.confirmed == s.todos;
        }
        assert d.confirmed == s.todos;
        assert d.seen == s.version;
      }
      SameLists(client_view(c), replay(s.todos, c.pending));
      assert client_view(d) == replay(s.todos, d.pending);
      SameLists(client_view(d), replay(s.todos, d.pending));
      assert d.refusals == 0;
      WithoutBridge(c.pending, m.seq_);
      ProofLib.FilterSubset((p: client_Pending) => (p.seq_ != m.seq_), c.pending);
      forall j | 0 <= j < |rest|
        ensures !rest[j].kind.Ack? || rest[j].client != owner || |d.pending| == 0 || rest[j].seq_ != oldest(d).seq_ || rest[j].version == s.version
        ensures isRequest(rest[j]) || rest[j].client != owner || rest[j].version <= d.seen || rest[j].version == s.version
        ensures !rest[j].kind.Refusal? || rest[j].client != owner || !client_waiting(d, rest[j].seq_)
      {
        WireProperties(sys, rest[j]);
      }
    } else {
      assert clientOf(after, owner) == c;
    }
    assert inStep(after, owner);
  }
}
